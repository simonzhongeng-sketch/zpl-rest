// Development-environment full functional regression (one command, repeatable).
//
//   node test/dev_func_test.js
//
// Starts an ISOLATED instance of the service (ZPL_DATA_DIR -> a temp folder, so
// the real db/ + config.json of the project are never touched), a mock Zebra
// printer on 127.0.0.1:9100 (+ vendor page on 8080) and then exercises:
//
//   A startup / UI pages / static assets
//   B printer address normalisation + error codes (400/409, edit, usb vs tcp)
//   C POST /rest/discover/probe (reachable / unreachable / hostile input / <5s)
//   D GET  /rest/discover/diag  (interfaces, target, hostile input, ?probe=1)
//   E subnet scanning (loopback finds the mock, auto reports its subnets,
//     empty subnet records the degraded sweep mode, scan timings)
//   F print chain to the mock only (preview PNG, ZPL ^XA/^FD/^MD/^PR, 3-column
//     value split into rows, queue drain -> history with source=manual)
//   G MCP (initialize / tools/list / tools/call list_printers)
//   H WebSocket connect on 18421
//   I ui language persistence + i18n keys of the new scan/probe inputs
//   J data files on disk, crash.log without uncaught errors, clean exit
//   K zero pollution of the project's db/ and config.json (md5 before/after)
//
// NO real printer is ever contacted with print data: every print job goes to
// the mock on loopback. Env switches:
//   ZPL_DEV_DATA_DIR=<absolute dir>  keep the isolated data directory here
//   ZPL_DEV_KEEP=1                   do not delete the isolated data directory

const { spawn } = require('child_process');
const crypto = require('crypto');
const fs = require('fs');
const net = require('net');
const os = require('os');
const path = require('path');
const vm = require('vm');

const ROOT = path.join(__dirname, '..');
const PORT = 18420;
const WSPORT = 18421;
const MCPORT = 18422;
const BASE = 'http://127.0.0.1:' + PORT;
const MCP = 'http://127.0.0.1:' + MCPORT + '/mcp';
const MOCK_PORT = 9100;

// absolute Windows path: a posix-looking "/tmp/x" would be rewritten by Git
// Bash (MSYS) or resolved onto the current drive letter by path.resolve()
const DATA_DIR = process.env.ZPL_DEV_DATA_DIR
  ? path.resolve(process.env.ZPL_DEV_DATA_DIR)
  : path.join(os.tmpdir(), 'zpl-dev-func');
const RECV_LOG = path.join(__dirname, 'mock_printer_received.txt');

const results = [];
function record(section, name, pass, detail) {
  results.push({ section, name, pass: !!pass, detail: detail || '' });
  console.log('  ' + (pass ? '[PASS] ' : '[FAIL] ') + section + ' / ' + name + (detail ? '  -- ' + detail : ''));
}
function info(msg) { console.log('  .... ' + msg); }

// ---------------------------------------------------------------- utilities
function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

async function waitFor(fn, timeoutMs, everyMs) {
  const end = Date.now() + timeoutMs;
  while (Date.now() < end) {
    const v = await fn();
    if (v) return v;
    await sleep(everyMs || 300);
  }
  return null;
}

// fetch with a hard timeout, JSON parsed when possible.
// undici (node fetch) ignores HTTP_PROXY, so the corporate proxy in the
// environment can not hijack these loopback requests.
async function fetchJson(url, opts, timeoutMs) {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), timeoutMs || 15000);
  try {
    const r = await fetch(url, Object.assign({ signal: ctl.signal }, opts || {}));
    const text = await r.text();
    let json = null;
    try { json = JSON.parse(text); } catch (e) { /* not json */ }
    return { code: r.status, text, json, headers: r.headers };
  } finally { clearTimeout(t); }
}
function postJson(url, body, timeoutMs) {
  return fetchJson(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  }, timeoutMs);
}

function md5File(file) {
  try {
    return crypto.createHash('md5').update(fs.readFileSync(file)).digest('hex');
  } catch (e) { return 'MISSING'; }
}
// snapshot the project data the test must not touch
function snapshotProjectData() {
  const snap = { 'config.json': md5File(path.join(ROOT, 'config.json')) };
  const dbDir = path.join(ROOT, 'db');
  let names = [];
  try { names = fs.readdirSync(dbDir); } catch (e) { names = []; }
  names.forEach(n => { snap['db/' + n] = md5File(path.join(dbDir, n)); });
  return snap;
}
function diffSnapshots(before, after) {
  const keys = new Set(Object.keys(before).concat(Object.keys(after)));
  const changed = [];
  keys.forEach(k => { if (before[k] !== after[k]) changed.push(k + ' ' + before[k] + ' -> ' + after[k]); });
  return changed;
}

function portFree(port) {
  return new Promise(resolve => {
    const srv = net.createServer();
    srv.once('error', () => resolve(false));
    srv.once('listening', () => srv.close(() => resolve(true)));
    srv.listen(port, '0.0.0.0');
  });
}

// load a browser locale file (I18N.register(lang, dict)) inside a sandbox
function loadLocale(file) {
  const src = fs.readFileSync(file, 'utf8');
  const box = { __dict: null };
  box.I18N = { register: (code, dict) => { box.__dict = dict; } };
  vm.runInNewContext(src, box, { filename: file });
  return box.__dict || {};
}

function recvSize() { try { return fs.statSync(RECV_LOG).size; } catch (e) { return 0; } }
function recvChunk(from) {
  try {
    const buf = fs.readFileSync(RECV_LOG);
    return buf.length > from ? buf.slice(from).toString() : '';
  } catch (e) { return ''; }
}
// mock_printer.js appends "=== ts ===\n<zpl>\n" per received job
function receipts(chunk) {
  return chunk.split(/^=== [^\n]+ ===\n/m).map(s => s.trim()).filter(Boolean);
}

// ---------------------------------------------------------------- main
let child = null;
let mock = null;
let serverOut = '';

(async function main() {
  const t0 = Date.now();
  const pollutionBefore = snapshotProjectData();

  console.log('dev functional regression');
  console.log('  project : ' + ROOT);
  console.log('  data dir: ' + DATA_DIR + '  (ZPL_DATA_DIR, isolated)');
  console.log('  ports   : ' + PORT + '/' + WSPORT + '/' + MCPORT + ', mock printer on ' + MOCK_PORT + '\n');

  // ---- preflight: ports must be free, data dir must be writable
  for (const p of [PORT, WSPORT, MCPORT, MOCK_PORT, 8080]) {
    const free = await portFree(p);
    record('preflight', 'port ' + p + ' free', free, free ? '' : 'already in use - stop the running service first');
    if (!free) { finish(); return; }
  }

  fs.rmSync(DATA_DIR, { recursive: true, force: true });
  fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.writeFileSync(path.join(DATA_DIR, 'config.json'), JSON.stringify({
    port: PORT, websocket_port: WSPORT, mcp_port: MCPORT,
    public: true, secret: 'dev_test_secret', mcp_token: '',
    tray: false, open_browser: false,
    // no periodic rebind scan during the test run (it would race the
    // explicit scan checks and touch the LAN unnecessarily)
    discovery_interval: 3600,
    ui_lang: 'zh'
  }, null, 2));

  // seeded records, written BEFORE diskdb connects:
  //  - a USB printer whose address string is identical to a TCP one: the
  //    duplicate check must compare within the same connection type only
  //  - a legacy bare-IP TCP record (no ":9100"): the duplicate check must
  //    still recognise 127.0.0.9:9100 as the same device
  fs.mkdirSync(path.join(DATA_DIR, 'db'), { recursive: true });
  fs.writeFileSync(path.join(DATA_DIR, 'db', 'printer.json'), JSON.stringify([
    { _id: 'seedusb00000000000000000000001', name: 'SEED-USB', address: '127.0.0.1:9100', conn: 'usb', density: 12 },
    { _id: 'seedlegacy0000000000000000001', name: 'SEED-LEGACY', address: '127.0.0.9', density: 12 }
  ], null, 2));

  try { fs.rmSync(RECV_LOG, { force: true }); } catch (e) { /* ignore */ }

  // ---- mock Zebra printer (9100 + vendor page 8080), loopback only
  mock = spawn(process.execPath, [path.join(__dirname, 'mock_printer.js')],
    { cwd: __dirname, windowsHide: true });
  let mockOut = '';
  mock.stdout.on('data', d => { mockOut += d; });
  mock.stderr.on('data', d => { mockOut += d; });
  const mockUp = await waitFor(() => /listening on 0\.0\.0\.0:9100/.test(mockOut), 10000, 200);
  record('preflight', 'mock printer up on 9100 (+8080 vendor page)', !!mockUp, mockUp ? 'loopback only' : mockOut.slice(-200));
  if (!mockUp) { finish(); return; }

  // ---- the service under test
  const env = Object.assign({}, process.env, {
    ZPL_DATA_DIR: DATA_DIR,   // absolute path, never the project db/
    ZPL_SKIP_TRAY_MOD: '1',   // no tray icon / no browser window
    NO_PROXY: '*', no_proxy: '*'
  });
  delete env.HTTP_PROXY; delete env.http_proxy;
  delete env.HTTPS_PROXY; delete env.https_proxy;
  delete env.ALL_PROXY; delete env.all_proxy;

  child = spawn(process.execPath, ['main.js'], { cwd: ROOT, env, windowsHide: true });
  let dead = false;
  child.stdout.on('data', d => { serverOut += d; });
  child.stderr.on('data', d => { serverOut += d; });
  child.on('exit', code => { dead = true; serverOut += '\n[process exited code=' + code + ']'; });

  const up = await waitFor(async () => {
    if (dead) return 'DEAD';
    try { const r = await fetchJson(BASE + '/label', {}, 2000); if (r.code === 200) return true; } catch (e) { /* not yet */ }
    return null;
  }, 40000, 300);
  record('A-startup', 'service up on ' + PORT, up === true,
    up === 'DEAD' ? 'process died during startup:\n' + serverOut.slice(-800) : '');
  if (up !== true) { finish(); return; }

  record('A-startup', 'data dir isolated (ZPL_DATA_DIR honoured)',
    fs.existsSync(path.join(DATA_DIR, 'db', 'printer.json')),
    'db seen in ' + path.join(DATA_DIR, 'db'));
  record('A-startup', 'logs REST/WS/MCP ports 18420/18421/18422',
    new RegExp('REST is listening on port ' + PORT).test(serverOut)
    && new RegExp('Websocket is listening on port ' + WSPORT).test(serverOut)
    && new RegExp('MCP is listening on port ' + MCPORT).test(serverOut),
    serverOut.split('\n').filter(l => /listening on port/.test(l)).join(' | '));

  // ================================================================ A: UI
  for (const p of ['/', '/printer', '/label', '/label/edit', '/queue', '/queue/new', '/reprint', '/manual']) {
    const r = await fetchJson(BASE + p, {}, 10000);
    record('A-ui', 'page ' + p, r.code === 200 && r.text.indexOf('accordionSidebar') >= 0,
      r.code + ', ' + r.text.length + ' bytes');
  }
  for (const s of ['/js/i18n.js', '/js/visual_editor.js', '/css/custom.css']) {
    const r = await fetchJson(BASE + s, {}, 10000);
    record('A-ui', 'static ' + s, r.code === 200 && r.text.length > 0, r.code + ', ' + r.text.length + ' bytes');
  }

  // =============================================== B: address normalisation
  const p1 = await postJson(BASE + '/rest/printer', {
    name: 'DEV-TCP-MOCK', address: '127.0.0.1', conn: 'tcp', density: 12, device_model: 'ZT510',
    settings: { mode: 'direct_thermal', darkness: 15, speed: 2 }
  });
  const printerId = p1.json && p1.json._id;
  record('B-address', 'bare IP normalised to host:9100',
    p1.code === 200 && p1.json && p1.json.address === '127.0.0.1:9100',
    p1.code + ' ' + JSON.stringify(p1.json && p1.json.address || p1.text).slice(0, 90));
  record('B-address', 'usb record with the same string does not block a tcp printer',
    p1.code === 200 && !!printerId,
    'seeded usb record address=127.0.0.1:9100, tcp create -> ' + p1.code);
  record('B-address', 'save returns reachability of the endpoint',
    p1.json && p1.json.reachable === true, 'reachable=' + (p1.json || {}).reachable);

  const fw = await postJson(BASE + '/rest/printer', { name: 'DEV-FULLWIDTH', address: '127.0.0.2\uff1a9100', density: 12 });
  record('B-address', 'full-width colon (: -> :) accepted',
    fw.code === 200 && fw.json && fw.json.address === '127.0.0.2:9100',
    fw.code + ' ' + JSON.stringify(fw.json && fw.json.address || fw.text).slice(0, 90));

  const scheme = await postJson(BASE + '/rest/printer', { name: 'DEV-SCHEME', address: 'http://127.0.0.3/' });
  record('B-address', 'scheme + trailing slash stripped (http://127.0.0.3/)',
    scheme.code === 200 && scheme.json && scheme.json.address === '127.0.0.3:9100',
    scheme.code + ' ' + JSON.stringify(scheme.json && scheme.json.address || scheme.text).slice(0, 90));

  const trimmed = await postJson(BASE + '/rest/printer', { name: 'DEV-TRIM', address: '  127.0.0.4/  ' });
  record('B-address', 'surrounding spaces + trailing slash stripped',
    trimmed.code === 200 && trimmed.json && trimmed.json.address === '127.0.0.4:9100',
    trimmed.code + ' ' + JSON.stringify(trimmed.json && trimmed.json.address || trimmed.text).slice(0, 90));

  const badCases = [
    ['::::', 'colons only'],
    ['', 'empty string'],
    ['garbage!!', 'junk characters'],
    ['-t', 'ping option injection'],
    ['127.0.0.1:99999', 'port out of range'],
    ['127.0.0.1:abc', 'non numeric port']
  ];
  for (const [value, label] of badCases) {
    const r = await postJson(BASE + '/rest/printer', { name: 'DEV-BAD', address: value });
    record('B-address', 'reject ' + label + ' -> 400 address_invalid',
      r.code === 400 && r.json && r.json.error === 'address_invalid',
      JSON.stringify(value) + ' -> ' + r.code + ' ' + (r.text || '').slice(0, 70));
  }

  const dup1 = await postJson(BASE + '/rest/printer', { name: 'DEV-DUP-BARE', address: '127.0.0.1' });
  record('B-address', 'duplicate (bare vs stored host:9100) -> 409 duplicate_address',
    dup1.code === 409 && dup1.json && dup1.json.error === 'duplicate_address',
    dup1.code + ' ' + (dup1.text || '').slice(0, 80));
  const dup2 = await postJson(BASE + '/rest/printer', { name: 'DEV-DUP-SCHEME', address: 'http://127.0.0.1:9100/' });
  record('B-address', 'duplicate (scheme spelling) -> 409',
    dup2.code === 409 && dup2.json && dup2.json.error === 'duplicate_address',
    dup2.code + ' ' + (dup2.text || '').slice(0, 80));
  const dup3 = await postJson(BASE + '/rest/printer', { name: 'DEV-DUP-LEGACY', address: '127.0.0.9:9100' });
  record('B-address', 'duplicate against legacy bare-IP record -> 409',
    dup3.code === 409 && dup3.json && dup3.json.error === 'duplicate_address',
    'seeded legacy 127.0.0.9 -> ' + dup3.code + ' ' + (dup3.text || '').slice(0, 80));

  const editSame = await postJson(BASE + '/rest/printer', {
    _id: printerId, name: 'DEV-TCP-MOCK-RENAMED', address: '127.0.0.1', conn: 'tcp', density: 12,
    settings: { mode: 'direct_thermal', darkness: 15, speed: 2 }
  });
  const afterEdit = await fetchJson(BASE + '/rest/printer', {}, 10000);
  const stored = (Array.isArray(afterEdit.json) ? afterEdit.json : []).filter(x => x._id === printerId)[0] || {};
  record('B-address', 'edit same printer with same address -> 200 (no false 409)',
    editSame.code === 200 && !!stored._id,
    editSame.code + ' stored=' + JSON.stringify({ name: stored.name, address: stored.address }));
  record('B-address', 'edit persists name/address and keeps settings (darkness 15 / speed 2)',
    stored.name === 'DEV-TCP-MOCK-RENAMED' && stored.address === '127.0.0.1:9100'
    && !!stored.settings && stored.settings.darkness === 15 && stored.settings.speed === 2,
    JSON.stringify({ name: stored.name, address: stored.address, settings: stored.settings }));
  record('B-address', 'edit response carries the reachability flag',
    !!editSame.json && editSame.json.reachable === true, JSON.stringify(editSame.json).slice(0, 120));
  // observation (not asserted): an update answers with diskdb's {updated,inserted}
  // summary while a create answers with the stored document. The UI only reads
  // `reachable` and the WS clients ignore the payload of update events, so this
  // is an API asymmetry, not a functional defect.
  info('note: create answers with the document, update answers with '
    + JSON.stringify(editSame.json) + ' + reachable (documented asymmetry)');

  // =========================================================== C: probe
  let t = Date.now();
  const probeOk = await postJson(BASE + '/rest/discover/probe', { address: '127.0.0.1:9100' }, 15000);
  const probeOkMs = Date.now() - t;
  record('C-probe', 'reachable endpoint reports tcp.open + ms',
    probeOk.code === 200 && probeOk.json && probeOk.json.tcp && probeOk.json.tcp.reachable === true
    && typeof probeOk.json.tcp.ms === 'number' && !!probeOk.json.ping,
    probeOk.code + ' tcp=' + JSON.stringify((probeOk.json || {}).tcp) + ' ping.ok=' + ((probeOk.json || {}).ping || {}).ok
    + ', ' + probeOkMs + 'ms total');
  record('C-probe', 'probe answers in < 5s (reachable)', probeOkMs < 5000, probeOkMs + 'ms');

  t = Date.now();
  const probeRefused = await postJson(BASE + '/rest/discover/probe', { address: '127.0.0.1:1' }, 20000);
  const probeRefusedMs = Date.now() - t;
  record('C-probe', 'refused port -> reachable:false with detail',
    probeRefused.code === 200 && probeRefused.json && probeRefused.json.tcp
    && probeRefused.json.tcp.reachable === false && !!probeRefused.json.tcp.error,
    probeRefused.code + ' ' + JSON.stringify((probeRefused.json || {}).tcp) + ', ' + probeRefusedMs + 'ms');
  record('C-probe', 'probe answers in < 5s (refused)', probeRefusedMs < 5000, probeRefusedMs + 'ms');

  t = Date.now();
  const probeDead = await postJson(BASE + '/rest/discover/probe', { address: '192.168.99.254' }, 25000);
  const probeDeadMs = Date.now() - t;
  record('C-probe', 'unreachable host -> ping + tcp detail, no hang',
    probeDead.code === 200 && probeDead.json && probeDead.json.tcp.reachable === false
    && probeDead.json.ping && probeDead.json.ping.ok === false,
    probeDead.code + ' ping.ok=' + ((probeDead.json || {}).ping || {}).ok
    + ' tcp=' + JSON.stringify((probeDead.json || {}).tcp) + ', ' + probeDeadMs + 'ms');
  record('C-probe', 'probe answers in < 5s (unreachable)', probeDeadMs < 5000, probeDeadMs + 'ms');

  for (const bad of ['garbage!!', '-t', '']) {
    t = Date.now();
    const r = await postJson(BASE + '/rest/discover/probe', { address: bad }, 10000);
    const ms = Date.now() - t;
    record('C-probe', 'probe rejects ' + JSON.stringify(bad) + ' -> 400 address_invalid',
      r.code === 400 && r.json && r.json.error === 'address_invalid',
      r.code + ' ' + (r.text || '').slice(0, 70) + ', ' + ms + 'ms');
  }

  // ============================================================ D: diag
  const diag = await fetchJson(BASE + '/rest/discover/diag', {}, 20000);
  const dj = diag.json || {};
  record('D-diag', 'diag 200 with interfaces / chosen / network / gateway',
    diag.code === 200 && Array.isArray(dj.interfaces) && typeof dj.chosen === 'string'
    && Array.isArray(dj.network) && 'gateway' in dj && 'last_sweep' in dj,
    diag.code + ' ifaces=' + (dj.interfaces || []).length + ' chosen=' + dj.chosen + ' gw=' + dj.gateway);
  // ARP neighbours are what prove a printer is alive on the link even when the
  // sweep missed it — the field diagnostic for "one printer is not listed"
  record('D-diag', 'diag lists ARP neighbours of the scanned subnet',
    Array.isArray(dj.arp_neighbors),
    'neighbours=' + (Array.isArray(dj.arp_neighbors) ? dj.arp_neighbors.length : 'missing'));

  const diagT = await fetchJson(BASE + '/rest/discover/diag?target=127.0.0.1', {}, 20000);
  const target = (diagT.json || {}).target || {};
  record('D-diag', '?target=127.0.0.1 returns ping + tcp detail',
    diagT.code === 200 && target.host === '127.0.0.1' && target.port === 9100
    && !!target.ping && !!target.tcp && target.tcp.reachable === true,
    JSON.stringify(target).slice(0, 180));

  for (const [q, label] of [['target=%25%25%25', 'junk (%%)'], ['target=a&target=b', 'repeated (?target=a&target=b)'], ['target=-t', 'option injection (-t)']]) {
    const r = await fetchJson(BASE + '/rest/discover/diag?' + q, {}, 20000);
    record('D-diag', 'hostile ' + label + ' -> still 200',
      r.code === 200 && r.json && Array.isArray(r.json.interfaces),
      r.code + ' target=' + JSON.stringify((r.json || {}).target));
  }

  const diagP = await fetchJson(BASE + '/rest/discover/diag?probe=1', {}, 25000);
  const ps = (diagP.json || {}).powershell_probe;
  record('D-diag', '?probe=1 reports powershell_probe',
    diagP.code === 200 && !!ps && typeof ps.ok === 'boolean',
    JSON.stringify(ps).slice(0, 120));

  // ========================================================== E: scanning
  t = Date.now();
  const scanLo = await postJson(BASE + '/rest/discover', { subnet: '127.0.0' }, 120000);
  const scanLoMs = Date.now() - t;
  const loList = Array.isArray(scanLo.json) ? scanLo.json : [];
  const hit = loList.filter(p => p.ip === '127.0.0.1');
  record('E-scan', 'loopback scan finds the mock Zebra (9100 + vendor page)',
    scanLo.code === 200 && hit.length === 1 && hit[0].is_zebra === true,
    scanLo.code + ', ' + loList.length + ' results, 127.0.0.1=' + JSON.stringify(hit[0] || null).slice(0, 160));
  record('E-scan', 'mock identified with model + dpi',
    hit.length === 1 && hit[0].model === 'ZT510' && (hit[0].dpi === 203 || hit[0].dpi === null),
    hit.length ? ('model=' + hit[0].model + ' dpi=' + hit[0].dpi + ' density=' + hit[0].density + ' serial=' + hit[0].serial) : 'no hit');
  info('loopback scan (127.0.0/24, 254 hosts) took ' + scanLoMs + 'ms, ' + loList.length
    + ' entries (all 127.0.0.x answer because the mock binds 0.0.0.0 — a test-setup artifact, not a scanner bug)');

  t = Date.now();
  const scanAuto = await postJson(BASE + '/rest/discover', { subnet: 'auto' }, 240000);
  const scanAutoMs = Date.now() - t;
  const scannedHdr = scanAuto.headers.get('x-scanned-subnets') || '';
  record('E-scan', 'auto scan 200 + reports the scanned subnets',
    scanAuto.code === 200 && scannedHdr.length > 0 && Array.isArray(scanAuto.json),
    scanAuto.code + ' scanned=' + scannedHdr + ', results=' + (Array.isArray(scanAuto.json) ? scanAuto.json.length : '?'));
  record('E-scan', 'auto scan covers at most 3 subnets',
    scannedHdr.split(',').filter(Boolean).length <= 3,
    scannedHdr.split(',').filter(Boolean).length + ' subnet(s)');
  // a missing printer must be explainable: "9100 open on N hosts, M confirmed
  // Zebra" separates "the scan never reached it" from "it answered and was
  // not identified as a Zebra"
  const openHdr = scanAuto.headers.get('x-sweep-open');
  const zebraHdr = scanAuto.headers.get('x-sweep-zebra');
  record('E-scan', 'scan reports 9100-open vs Zebra-confirmed counts',
    openHdr !== null && zebraHdr !== null
    && parseInt(openHdr, 10) >= parseInt(zebraHdr, 10) && parseInt(zebraHdr, 10) >= 0,
    'open=' + openHdr + ' zebra=' + zebraHdr);
  info('auto scan took ' + scanAutoMs + 'ms (subnets: ' + scannedHdr + ')');

  const scanEmpty = await postJson(BASE + '/rest/discover', { subnet: '10.99.99' }, 180000);
  const emptyList = Array.isArray(scanEmpty.json) ? scanEmpty.json : [];
  const netHits = emptyList.filter(p => p && p.ip);
  // note: the endpoint also returns the Zebra printers installed in the local
  // Windows spooler, so an "empty" scan is not an empty array — what must be
  // empty is the network part of the result
  record('E-scan', 'empty subnet -> 200 with no network results',
    scanEmpty.code === 200 && Array.isArray(scanEmpty.json) && netHits.length === 0,
    scanEmpty.code + ', network=' + netHits.length
    + ', usb=' + emptyList.filter(p => p && p.conn === 'usb').length + ' of ' + emptyList.length + ' entries');

  const diagAfter = await fetchJson(BASE + '/rest/discover/diag', {}, 20000);
  const lastSweep = (diagAfter.json || {}).last_sweep || {};
  record('E-scan', 'diag.last_sweep records the degraded sweep',
    lastSweep.base === '10.99.99' && lastSweep.count === 0 && !!lastSweep.mode
    && (!!lastSweep.ps_error || lastSweep.mode !== 'powershell' || typeof lastSweep.ps_ms === 'number'),
    JSON.stringify(lastSweep).slice(0, 220));
  // the "PowerShell answered []" branch is only credible when the node re-check
  // actually ran: total ms must clearly exceed the PowerShell part
  const nodeRecheck = lastSweep.ps_error
    || /node/.test(String(lastSweep.mode))
    || (typeof lastSweep.ps_ms === 'number' && typeof lastSweep.ms === 'number'
      && (lastSweep.ms - lastSweep.ps_ms) > 1000);
  record('E-scan', 'empty scan was corroborated by the node re-check (not a silent PS "[]")',
    !!nodeRecheck,
    'mode=' + lastSweep.mode + ' ps_ms=' + lastSweep.ps_ms + ' total_ms=' + lastSweep.ms
    + (lastSweep.ps_error ? (' ps_error=' + String(lastSweep.ps_error).slice(0, 80)) : ''));

  // ============================================================ F: printing
  const lb = await postJson(BASE + '/rest/label', {
    name: 'DEV-SINGLE', width: 60, height: 20, type: 'visual', printer_id: printerId,
    template: {
      elements: [
        { type: 'text', props: { x_mm: 3, y_mm: 3, content: 'SN ${sn}', height_mm: 4 } },
        { type: 'qrcode', props: { x_mm: 3, y_mm: 9, content: '${sn}', size_mm: 8 } }
      ],
      print_settings: { mode: 'direct_thermal', darkness: 15, speed: 2, quantity: 1 }
    }
  });
  const labelId = lb.json && lb.json._id;
  record('F-print', 'create single-value label', lb.code === 200 && !!labelId, lb.code + ' id=' + labelId);

  const lb3 = await postJson(BASE + '/rest/label', {
    name: 'DEV-3COL', width: 66, height: 10, type: 'visual', printer_id: printerId,
    print_layout: { cols: 3, rows: 0 },
    template: {
      elements: [{ type: 'text', props: { x_mm: 1, y_mm: 2, content: '${v}', height_mm: 4 } }],
      print_settings: { mode: 'direct_thermal', darkness: 15, speed: 2, quantity: 1 }
    }
  });
  const labelId3 = lb3.json && lb3.json._id;
  record('F-print', 'create 3-column label', lb3.code === 200 && !!labelId3, lb3.code + ' id=' + labelId3);

  if (labelId) {
    const pv = await fetchJson(BASE + '/rest/preview?printer=' + printerId + '&label=' + labelId, {}, 40000);
    const img = (pv.json && pv.json.img) || '';
    record('F-print', 'preview renders PNG locally (WASM, no network)',
      pv.code === 200 && img.indexOf('iVBORw0KGgo') === 0 && img.length > 500,
      pv.code + ', png ~' + Math.round(img.length * 3 / 4) + ' bytes');

    let mark = recvSize();
    const add1 = await postJson(BASE + '/rest/queue/add', {
      label_id: labelId, printer_id: printerId, data: { sn: 'DEV-ABC-001' }
    }, 15000);
    record('F-print', 'queue/add single value accepted', add1.code === 200, add1.code + ' ' + add1.text.slice(0, 90));

    const zpl1 = await waitFor(() => {
      for (const r of receipts(recvChunk(mark))) if (r.indexOf('DEV-ABC-001') >= 0) return r;
      return null;
    }, 25000, 300);
    record('F-print', 'mock received ZPL with ^XA and ^FD',
      !!zpl1 && zpl1.indexOf('^XA') >= 0 && zpl1.indexOf('^FD') >= 0,
      zpl1 ? (zpl1.length + ' bytes') : 'nothing received in 25s');
    record('F-print', 'print settings compiled into ZPL (^MD15 / ^PR2)',
      !!zpl1 && /\^MD15/.test(zpl1) && /\^PR2/.test(zpl1),
      zpl1 ? ((zpl1.match(/\^(MD|PR|MT)\S*/g) || []).join(' ')) : '-');
  } else {
    record('F-print', 'single-value print chain', false, 'no label created');
  }

  if (labelId3) {
    const mark = recvSize();
    const addN = await postJson(BASE + '/rest/queue/add', {
      label_id: labelId3, printer_id: printerId, values: ['A1', 'A2', 'A3', 'B1', 'B2', 'B3']
    }, 15000);
    record('F-print', 'queue/add 6 values for cols=3 accepted', addN.code === 200, addN.code + ' ' + addN.text.slice(0, 90));

    const rows = await waitFor(() => {
      const withFd = receipts(recvChunk(mark)).filter(r => /\^FD/.test(r));
      return withFd.length >= 2 ? withFd : null;
    }, 30000, 300);
    const fds = (rows || []).map(r => (r.match(/\^FD([^\^]*)/g) || []).map(s => s.slice(3).trim()).join('|'));
    const row1 = !!rows && fds.length >= 2 && /A1.*A2.*A3/.test(fds[0].replace(/\s+/g, ''));
    const row2 = !!rows && fds.length >= 2 && /B1.*B2.*B3/.test(fds[fds.length - 1].replace(/\s+/g, ''));
    record('F-print', '6 values split into 2 rows of 3 (row1 A1|A2|A3)',
      row1 && rows.length === 2,
      'rows=' + (rows ? rows.length : 0) + ' fds=[' + fds.join(' ; ') + ']');
    record('F-print', 'row2 carries B1|B2|B3', row2, rows ? 'fds=[' + fds.join(' ; ') + ']' : 'no rows');
  } else {
    record('F-print', '3-column print chain', false, 'no label created');
  }

  const q = await waitFor(async () => {
    const r = await fetchJson(BASE + '/rest/queue', {}, 10000);
    if (r.code !== 200 || !r.json) return null;
    if (Array.isArray(r.json.items) && r.json.items.length === 0
      && Array.isArray(r.json.history) && r.json.history.length >= 3) return r.json;
    return null;
  }, 30000, 500);
  record('F-print', 'queue drained into history (items empty)',
    !!q, q ? ('history=' + q.history.length) : 'timeout waiting for the queue to drain');
  record('F-print', 'history entries carry source=manual',
    !!q && q.history.every(h => h.source === 'manual'),
    q ? q.history.map(h => h.source).join(',') : '-');

  // =============================================================== G: MCP
  const mcpHeaders = { 'Content-Type': 'application/json', 'Accept': 'application/json, text/event-stream' };
  function mcpParse(r) {
    let body = r.text;
    if ((r.headers.get('content-type') || '').indexOf('event-stream') >= 0) {
      const m = body.match(/^data: (.+)$/m);
      body = m ? m[1] : '';
    }
    try { return JSON.parse(body); } catch (e) { return null; }
  }
  const init = await fetchJson(MCP, {
    method: 'POST', headers: mcpHeaders,
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'dev-func-test', version: '1.0' } } })
  }, 20000);
  const sessionId = init.headers.get('mcp-session-id');
  if (sessionId) mcpHeaders['Mcp-Session-Id'] = sessionId;
  const initJson = mcpParse(init);
  record('G-mcp', 'initialize on ' + MCPORT,
    init.code === 200 && !!initJson && !!initJson.result && !!initJson.result.serverInfo,
    init.code + (sessionId ? ' session=' + sessionId.slice(0, 8) + '..' : ' stateless'));

  const toolsRes = await fetchJson(MCP, { method: 'POST', headers: mcpHeaders, body: JSON.stringify({ jsonrpc: '2.0', id: 2, method: 'tools/list', params: {} }) }, 20000);
  const toolsJson = mcpParse(toolsRes);
  const toolNames = ((toolsJson || {}).result || {}).tools ? toolsJson.result.tools.map(x => x.name) : [];
  record('G-mcp', 'tools/list returns 16 tools', toolNames.length === 16, 'count=' + toolNames.length);

  const call = await fetchJson(MCP, {
    method: 'POST', headers: mcpHeaders,
    body: JSON.stringify({ jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: 'list_printers', arguments: {} } })
  }, 25000);
  record('G-mcp', 'tools/call list_printers sees the created printer',
    call.code === 200 && JSON.stringify(mcpParse(call) || {}).indexOf('DEV-TCP-MOCK') >= 0, String(call.code));

  // ================================================================ H: WS
  const wsConn = await new Promise(resolve => {
    let done = false;
    const finish = v => { if (!done) { done = true; resolve(v); } };
    // no protocol argument: faye/websocket answer a subprotocol request with
    // 400, which would look like a server fault
    const client = new (require('websocket').client)();
    client.on('connect', c => finish(c));
    client.on('connectFailed', e => finish(null));
    try { client.connect('ws://127.0.0.1:' + WSPORT + '/'); } catch (e) { finish(null); }
    setTimeout(() => finish(null), 8000);
  });
  record('H-ws', 'websocket opens on ' + WSPORT, !!wsConn, wsConn ? 'connected' : 'connect failed/timeout');

  // ============================================================== I: i18n
  const langAr = await postJson(BASE + '/rest/lang', { lang: 'ar' }, 10000);
  let cfgOnDisk = {};
  try { cfgOnDisk = JSON.parse(fs.readFileSync(path.join(DATA_DIR, 'config.json'), 'utf8')); } catch (e) { /* ignore */ }
  record('I-lang', 'POST /rest/lang ar persists ui_lang=ar in the isolated config.json',
    langAr.code === 200 && cfgOnDisk.ui_lang === 'ar',
    langAr.code + ' ui_lang=' + cfgOnDisk.ui_lang);
  const langBad = await postJson(BASE + '/rest/lang', { lang: 'xx' }, 10000);
  record('I-lang', 'unsupported language rejected (400)', langBad.code === 400, String(langBad.code));
  await postJson(BASE + '/rest/lang', { lang: 'zh' }, 10000);

  const printerPage = await fetchJson(BASE + '/printer', {}, 10000);
  const phSubnet = /id="discover-subnet"[^>]*data-i18n-placeholder="pr\.subnet_ph"/.test(printerPage.text);
  const phProbe = /id="probe-address"[^>]*data-i18n-placeholder="pr\.probe_ph"/.test(printerPage.text);
  record('I-lang', '/printer inputs use data-i18n-placeholder (not data-i18n-ph)',
    phSubnet && phProbe && printerPage.text.indexOf('data-i18n-ph"') < 0,
    'subnet=' + phSubnet + ' probe=' + phProbe
    + ', sloppy data-i18n-ph attrs=' + (printerPage.text.match(/data-i18n-ph="/g) || []).length);

  const newKeys = ['pr.subnet_ph', 'pr.probe_ph', 'pr.subnet_hint', 'pr.subnet_label'];
  const locales = {};
  ['zh', 'en', 'ar'].forEach(code => {
    locales[code] = loadLocale(path.join(ROOT, 'html', 'js', 'locales', code + '.js'));
  });
  const missing = [];
  ['zh', 'en', 'ar'].forEach(code => {
    newKeys.forEach(k => { if (typeof locales[code][k] !== 'string' || !locales[code][k]) missing.push(code + ':' + k); });
  });
  record('I-lang', 'zh/en/ar all define the new pr.* keys', missing.length === 0,
    missing.length ? ('missing ' + missing.join(', ')) : newKeys.join(', '));
  // full key-set comparison against en (reported, not asserted: pre-existing gaps)
  const enKeys = Object.keys(locales.en || {});
  ['zh', 'ar'].forEach(code => {
    const gaps = enKeys.filter(k => !(k in (locales[code] || {})));
    info('locale ' + code + ': ' + Object.keys(locales[code] || {}).length + ' keys, '
      + gaps.length + ' missing vs en' + (gaps.length ? ' [' + gaps.slice(0, 6).join(', ') + ']' : ''));
  });

  // =============================================================== J: data
  const dbDir = path.join(DATA_DIR, 'db');
  const collections = ['label', 'printer', 'jobs', 'queue', 'meta', 'draft'];
  const present = [];
  collections.forEach(c => { if (fs.existsSync(path.join(dbDir, c + '.json'))) present.push(c); });
  record('J-data', 'isolated db has all 6 collections', present.length === 6, present.join(',') || 'none');

  const crashFile = path.join(DATA_DIR, 'logs', 'crash.log');
  record('J-data', 'logs/crash.log exists in the isolated dir', fs.existsSync(crashFile), crashFile);
  const crashTxt = fs.existsSync(crashFile) ? fs.readFileSync(crashFile, 'utf8') : '';
  const badCrash = (crashTxt.match(/^\[[^\]]+\] (uncaughtException|unhandledRejection)/gm) || []);
  record('J-data', 'crash.log contains no uncaught exception / unhandled rejection',
    badCrash.length === 0, badCrash.length ? badCrash.join(' | ') : 'clean (' + crashTxt.length + ' bytes of normal log)');

  record('J-data', 'service still alive at the end of the run', !dead,
    dead ? serverOut.slice(-600) : '');

  // ---------------------------------------------------------- clean exit
  if (wsConn) { try { wsConn.close(); } catch (e) { /* ignore */ } }
  if (child) { try { child.kill(); } catch (e) { /* ignore */ } }
  const exited = await waitFor(() => dead, 10000, 200);
  record('J-data', 'service exits on terminate', !!exited, exited ? 'exit recorded' : 'still running after 10s');
  let released = false;
  if (exited) {
    released = await waitFor(async () => (await portFree(PORT)) && (await portFree(WSPORT)) && (await portFree(MCPORT)), 15000, 300);
  }
  record('J-data', 'ports released after exit', !!released, released ? PORT + '/' + WSPORT + '/' + MCPORT + ' free' : 'still bound');

  // =========================================================== K: pollution
  const pollutionAfter = snapshotProjectData();
  const changed = diffSnapshots(pollutionBefore, pollutionAfter);
  record('K-pollution', 'project db/ + config.json unchanged (md5 before/after)',
    changed.length === 0,
    changed.length ? ('changed: ' + changed.join(' ; ')) : (Object.keys(pollutionAfter).length + ' files identical'));

  finish();

  function finish() {
    const keep = !!process.env.ZPL_DEV_KEEP;
    try { if (mock) mock.kill(); } catch (e) { /* ignore */ }
    try { if (child && !dead) child.kill(); } catch (e) { /* ignore */ }
    if (!keep) { try { fs.rmSync(DATA_DIR, { recursive: true, force: true }); } catch (e) { /* ignore */ } }

    const pass = results.filter(r => r.pass).length;
    const fail = results.length - pass;
    console.log('\n===== SUMMARY =====');
    console.log('total=' + results.length + '  pass=' + pass + '  fail=' + fail
      + '  (' + ((Date.now() - t0) / 1000).toFixed(1) + 's)');
    if (fail) {
      console.log('\n--- FAILED ---');
      results.filter(r => !r.pass).forEach(r => console.log('  ' + r.section + ' / ' + r.name + '  -- ' + r.detail));
    }
    if (fail) {
      const tail = serverOut.split('\n').filter(Boolean).slice(-10).join('\n');
      console.log('\n--- service output tail ---\n' + tail);
    }
    console.log('\ndata dir ' + (keep ? 'kept at ' + DATA_DIR : 'removed: ' + DATA_DIR));
    process.exit(fail ? 1 : 0);
  }
})().catch(e => {
  console.error('FATAL', e);
  try { if (child) child.kill(); } catch (e2) { /* ignore */ }
  try { if (mock) mock.kill(); } catch (e2) { /* ignore */ }
  process.exit(1);
});

// Full functional test for the packaged exe.
// usage: node test/exe_func_test.js <path-to-exe>
//
// Runs the exe in an isolated folder on ports 18440/18441/18442, with a mock
// Zebra printer on 127.0.0.1:9100, and exercises: UI pages, static assets,
// printer/label CRUD, variables endpoint, local ZPL->PNG preview render,
// websocket, single-label print to the mock, 3-column multi-value print
// (values -> per-row queue jobs), queue status API, language persistence,
// MCP (initialize / tools/list / tools/call), loopback discovery, Windows
// printer enumeration, data files on disk, crash.log, clean exit.
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');

const exe = process.argv[2];
if (!exe) { console.error('usage: node exe_func_test.js <path-to-exe>'); process.exit(1); }

const PORT = 18440, WSPORT = 18441, MCPORT = 18442;
const BASE = 'http://127.0.0.1:' + PORT;
const dir = path.join(__dirname, 'exe_func');
const recvLog = path.join(__dirname, 'mock_printer_received.txt');

const results = [];
function record(section, name, pass, detail) {
  results.push({ section, name, pass, detail: detail || '' });
  console.log('  ' + (pass ? '[PASS] ' : '[FAIL] ') + section + ' / ' + name + (detail ? '  -- ' + detail : ''));
}

async function fetchJson(url, opts, timeoutMs) {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), timeoutMs || 15000);
  try {
    const r = await fetch(url, Object.assign({ signal: ctl.signal }, opts));
    const text = await r.text();
    let json = null;
    try { json = JSON.parse(text); } catch (e) {}
    return { code: r.status, text, json, headers: r.headers };
  } finally { clearTimeout(t); }
}

function recvSize() { try { return fs.statSync(recvLog).size; } catch (e) { return 0; } }
function recvChunk(from) {
  try {
    const buf = fs.readFileSync(recvLog);
    return buf.length > from ? buf.slice(from).toString() : '';
  } catch (e) { return ''; }
}
// each mock receipt is "=== ts ===\n<zpl>\n"; split a chunk into receipts
function receipts(chunk) {
  return chunk.split(/^=== [^\n]+ ===\n/m).map(s => s.trim()).filter(Boolean);
}

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

(async function main() {
  // ---- setup isolated exe folder
  fs.rmSync(dir, { recursive: true, force: true });
  fs.mkdirSync(dir, { recursive: true });
  const target = path.join(dir, path.basename(exe));
  fs.copyFileSync(exe, target);
  fs.writeFileSync(path.join(dir, 'config.json'), JSON.stringify({
    port: PORT, websocket_port: WSPORT, mcp_port: MCPORT,
    tray: false, open_browser: false, public: true,
    discovery_interval: 300
  }, null, 2));
  try { fs.rmSync(recvLog, { force: true }); } catch (e) {}

  // ---- start mock zebra printer (TCP 9100 + HTTP 8080)
  const mock = spawn(process.execPath, [path.join(__dirname, 'mock_printer.js')], { cwd: __dirname, windowsHide: true });
  await sleep(600);

  // ---- start the exe
  console.log('exe: ' + target + ' (' + (fs.statSync(target).size / 1024 / 1024).toFixed(1) + ' MB)');
  console.log('sections: startup/ui/crud/preview/ws/print/queue/lang/mcp/discover/windows/data/exit\n');
  const child = spawn(target, [], { cwd: dir, windowsHide: true });
  let out = '', dead = false;
  child.stdout.on('data', d => { out += d; });
  child.stderr.on('data', d => { out += d; });
  child.on('exit', (code) => { dead = true; out += '\n[process exited code=' + code + ']'; });
  const alive = () => !dead;

  let up = await waitFor(async () => {
    if (dead) return 'DEAD';
    try { const r = await fetchJson(BASE + '/label', {}, 3000); if (r.code === 200) return true; } catch (e) {}
    return null;
  }, 40000, 500);
  record('startup', 'service up on 18440', up === true, up === 'DEAD' ? 'exe died during startup:\n' + out.slice(-800) : '');
  if (up !== true) { finish(); return; }

  const boot = out.split('\n').filter(l => l.indexOf('listening') >= 0).join(' | ');
  record('startup', 'ports 18440/18441/18422 announced', /REST is listening on port 18440/.test(out) && /Websocket is listening on port 18441/.test(out) && /MCP is listening on port 18442/.test(out), boot);

  // ---- UI pages
  const pages = ['/', '/printer', '/label', '/label/edit', '/queue', '/queue/new', '/reprint', '/manual'];
  for (const p of pages) {
    const r = await fetchJson(BASE + p, {}, 8000);
    record('ui', 'page ' + p, r.code === 200 && r.text.indexOf('accordionSidebar') >= 0, r.code + ', ' + r.text.length + ' bytes');
  }
  // static assets are mounted at the site root (express.static(html/)):
  // views reference them relatively, e.g. css/custom.css -> /css/custom.css
  for (const s of ['/js/i18n.js', '/js/visual_editor.js', '/css/custom.css']) {
    const r = await fetchJson(BASE + s, {}, 8000);
    record('ui', 'static ' + s, r.code === 200, r.code + ', ' + r.text.length + ' bytes');
  }

  // ---- printer + label CRUD
  const pr = await fetchJson(BASE + '/rest/printer', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({
    name: 'FUNC-TCP-MOCK', address: '127.0.0.1:9100', conn: 'tcp', density: 12,
    settings: { mode: 'direct_thermal', darkness: 15, speed: 2 }
  }) });
  const printerId = pr.json && pr.json._id;
  record('crud', 'create printer (tcp mock)', pr.code === 200 && !!printerId, pr.code + ' id=' + printerId);

  // address tolerance: users type a bare IP; the server must add :9100 and
  // answer a machine-readable error code instead of cryptic English text.
  // Use .2/.3 rather than .1: the mock printer above already owns
  // 127.0.0.1:9100, and the canonical duplicate check would (correctly)
  // answer 409 for a second record with the same host:port.
  const bare = await fetchJson(BASE + '/rest/printer', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: 'FUNC-BARE', address: '127.0.0.2', density: 12 }) });
  record('crud', 'bare IP accepted and normalised to :9100', bare.code === 200 && bare.json && bare.json.address === '127.0.0.2:9100', bare.code + ' ' + ((bare.json || {}).address || bare.text).slice(0, 80));

  const fw = await fetchJson(BASE + '/rest/printer', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: 'FUNC-FULLWIDTH', address: '127.0.0.3\uff1a9100', density: 12 }) });
  record('crud', 'full-width colon accepted', fw.code === 200 && fw.json && fw.json.address === '127.0.0.3:9100', fw.code + ' ' + ((fw.json || {}).address || fw.text).slice(0, 80));

  const bad = await fetchJson(BASE + '/rest/printer', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: 'FUNC-BAD', address: '' }) });
  record('crud', 'empty address -> 400 address_invalid', bad.code === 400 && bad.json && bad.json.error === 'address_invalid', bad.code + ' ' + (bad.text || '').slice(0, 80));

  const dupe = await fetchJson(BASE + '/rest/printer', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: 'FUNC-DUP', address: '127.0.0.1' }) });
  record('crud', 'duplicate address -> 409 duplicate_address', dupe.code === 409 && dupe.json && dupe.json.error === 'duplicate_address', dupe.code + ' ' + (dupe.text || '').slice(0, 80));
  if (bare.json && bare.json._id) await fetchJson(BASE + '/rest/printer/' + bare.json._id, { method: 'DELETE' }, 8000);
  if (fw.json && fw.json._id) await fetchJson(BASE + '/rest/printer/' + fw.json._id, { method: 'DELETE' }, 8000);

  const lb = await fetchJson(BASE + '/rest/label', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({
    name: 'FUNC-SINGLE', width: 60, height: 20, type: 'visual', printer_id: printerId,
    template: {
      elements: [
        { type: 'text', props: { x_mm: 3, y_mm: 3, content: 'SN ${sn}', height_mm: 4 } },
        { type: 'qrcode', props: { x_mm: 3, y_mm: 9, content: '${sn}', size_mm: 8 } }
      ],
      print_settings: { mode: 'direct_thermal', darkness: 15, speed: 2, quantity: 1 }
    }
  }) });
  const labelId = lb.json && lb.json._id;
  record('crud', 'create single label', lb.code === 200 && !!labelId, lb.code + ' id=' + labelId);

  const lb2 = await fetchJson(BASE + '/rest/label', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({
    name: 'FUNC-3COL', width: 66, height: 10, type: 'visual', printer_id: printerId,
    print_layout: { cols: 3, rows: 0 },
    template: {
      elements: [ { type: 'text', props: { x_mm: 1, y_mm: 2, content: '${v}', height_mm: 4 } } ],
      print_settings: { mode: 'direct_thermal', darkness: 15, speed: 2, quantity: 1 }
    }
  }) });
  const labelId2 = lb2.json && lb2.json._id;
  record('crud', 'create 3-col label', lb2.code === 200 && !!labelId2, lb2.code + ' id=' + labelId2);

  const vars = await fetchJson(BASE + '/rest/label/variables/' + labelId, {}, 8000);
  const varOk = vars.code === 200 && JSON.stringify(vars.json).indexOf('sn') >= 0;
  record('crud', 'variables endpoint lists ${sn}', varOk, vars.code + ' ' + JSON.stringify(vars.json).slice(0, 120));

  const list = await fetchJson(BASE + '/rest/label', {}, 8000);
  record('crud', 'label list contains both', list.code === 200 && JSON.stringify(list.json).indexOf('FUNC-SINGLE') >= 0 && JSON.stringify(list.json).indexOf('FUNC-3COL') >= 0, '');

  // ---- preview render (local Zebrash WASM)
  const pv = await fetchJson(BASE + '/rest/preview?printer=' + printerId + '&label=' + labelId, {}, 30000);
  const img = (pv.json && pv.json.img) || '';
  record('preview', 'local render returns PNG', pv.code === 200 && img.indexOf('iVBORw0KGgo') === 0 && img.length > 500, pv.code + ', png ~' + Math.round(img.length * 3 / 4) + ' bytes');

  // ---- websocket connect
  let wsMsgs = 0, wsOpen = false;
  function wsConnect() {
    return new Promise(resolve => {
      const WebSocketClient = require('websocket').client;
      const c = new WebSocketClient();
      c.on('connect', conn => { wsOpen = true; conn.on('message', () => { wsMsgs++; }); resolve(conn); });
      c.on('connectFailed', () => resolve(null));
      c.connect('ws://127.0.0.1:' + WSPORT + '/');
    });
  }
  const conn = await Promise.race([wsConnect(), sleep(5000).then(() => null)]);
  record('ws', 'websocket connects on 18441', !!conn && wsOpen, conn ? 'connected' : 'connect failed/timeout');

  // ---- print single label
  let mark = recvSize();
  const t0 = Date.now();
  const add1 = await fetchJson(BASE + '/rest/queue/add', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({
    label_id: labelId, printer_id: printerId, data: { sn: 'FUNC-ABC-001' }
  }) }, 10000);
  record('print', 'queue/add single accepted', add1.code === 200, add1.code + ' ' + add1.text.slice(0, 100));

  const zpl1 = await waitFor(() => {
    const rs = receipts(recvChunk(mark));
    for (const r of rs) if (r.indexOf('FUNC-ABC-001') >= 0) return r;
    return null;
  }, 20000, 300);
  record('print', 'mock printer received ZPL with data', !!zpl1, zpl1 ? (zpl1.length + ' bytes, has ^XA=' + (zpl1.indexOf('^XA') >= 0) + ', has ^FD=' + (zpl1.indexOf('^FD') >= 0)) : 'nothing received in 20s');
  record('print', 'print settings compiled (^MD/^PR/^MT)', !!zpl1 && /\^MD15/.test(zpl1) && /\^PR2/.test(zpl1), zpl1 ? (zpl1.match(/\^(MD|PR|MT)\S*/g) || []).join(' ') : '-');

  // ---- 3-column multi-value print -> per-row jobs
  mark = recvSize();
  const addN = await fetchJson(BASE + '/rest/queue/add', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({
    label_id: labelId2, printer_id: printerId, values: ['A1', 'A2', 'A3', 'B1', 'B2', 'B3']
  }) }, 10000);
  record('print', 'queue/add 6 values (cols=3) accepted', addN.code === 200, addN.code + ' ' + addN.text.slice(0, 100));

  const rows = await waitFor(() => {
    const rs = receipts(recvChunk(mark));
    const withFd = rs.filter(r => /\^FD/.test(r));
    if (withFd.length >= 2) return withFd;
    return null;
  }, 25000, 300);
  const fds = (rows || []).map(r => (r.match(/\^FD([^\^]*)/g) || []).map(s => s.slice(3).trim()).join('|'));
  const row1ok = !!rows && fds.length >= 2 && /A1.*A2.*A3|A1\|A2\|A3/.test(fds[0].replace(/\s+/g, ''));
  const row2ok = !!rows && fds.length >= 2 && /B1.*B2.*B3|B1\|B2\|B3/.test(fds[fds.length - 1].replace(/\s+/g, ''));
  record('print', 'row 1 ZPL carries values A1|A2|A3', !!row1ok, rows ? 'rows=' + rows.length + ' fds=[' + fds.join(' ; ') + ']' : 'no rows received');
  record('print', 'row 2 ZPL carries values B1|B2|B3', !!row2ok, rows ? 'rows=' + rows.length : 'no rows received');

  // ---- queue status: everything finished into history
  const q = await waitFor(async () => {
    const r = await fetchJson(BASE + '/rest/queue', {}, 8000);
    if (r.code !== 200 || !r.json) return null;
    if (Array.isArray(r.json.items) && r.json.items.length === 0 && Array.isArray(r.json.history) && r.json.history.length >= 3) return r.json;
    return null;
  }, 25000, 500);
  record('queue', 'all jobs done -> history (items empty)', !!q, q ? ('history=' + q.history.length + ', active=' + JSON.stringify(q.active || null).slice(0, 80)) : 'timeout waiting for drain');
  const srcOk = q && q.history.every(h => h.source === 'manual');
  record('queue', 'history entries marked source=manual', !!srcOk, q ? q.history.map(h => h.source).join(',') : '-');

  // ---- language persistence
  const lang1 = await fetchJson(BASE + '/rest/lang', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ lang: 'ar' }) }, 8000);
  let cfgOnDisk = {};
  try { cfgOnDisk = JSON.parse(fs.readFileSync(path.join(dir, 'config.json'), 'utf8')); } catch (e) {}
  record('lang', 'POST /rest/lang ar -> persisted to config.json', lang1.code === 200 && cfgOnDisk.ui_lang === 'ar', 'ui_lang=' + cfgOnDisk.ui_lang);
  const langBad = await fetchJson(BASE + '/rest/lang', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ lang: 'xx' }) }, 8000);
  record('lang', 'unsupported lang rejected (400)', langBad.code === 400, String(langBad.code));
  await fetchJson(BASE + '/rest/lang', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ lang: 'zh' }) }, 8000);

  // ---- MCP: initialize -> tools/list -> tools/call
  const MCP = 'http://127.0.0.1:' + MCPORT + '/mcp';
  const mcpHeaders = { 'Content-Type': 'application/json', 'Accept': 'application/json, text/event-stream' };
  let sessionId = null;
  function mcpParse(r) {
    let body = r.text;
    if ((r.headers.get('content-type') || '').indexOf('event-stream') >= 0) {
      const m = body.match(/^data: (.+)$/m);
      body = m ? m[1] : '';
    }
    try { return JSON.parse(body); } catch (e) { return null; }
  }
  const init = await fetchJson(MCP, { method: 'POST', headers: mcpHeaders, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'func-test', version: '1.0' } } }) }, 15000);
  sessionId = init.headers.get('mcp-session-id');
  if (sessionId) mcpHeaders['Mcp-Session-Id'] = sessionId;
  const initOk = init.code === 200 && mcpParse(init) && mcpParse(init).result && mcpParse(init).result.serverInfo;
  record('mcp', 'initialize on 18442', !!initOk, init.code + (sessionId ? ' session=' + sessionId.slice(0, 8) + '..' : ' stateless'));

  const tools = await fetchJson(MCP, { method: 'POST', headers: mcpHeaders, body: JSON.stringify({ jsonrpc: '2.0', id: 2, method: 'tools/list', params: {} }) }, 15000);
  const toolNames = ((mcpParse(tools) || {}).result || {}).tools ? mcpParse(tools).result.tools.map(t => t.name) : [];
  record('mcp', 'tools/list returns 16 tools', toolNames.length === 16, 'count=' + toolNames.length + (toolNames.length ? ': ' + toolNames.join(',') : ''));
  const call = await fetchJson(MCP, { method: 'POST', headers: mcpHeaders, body: JSON.stringify({ jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: 'list_printers', arguments: {} } }) }, 20000);
  const callText = JSON.stringify(mcpParse(call) || {});
  record('mcp', 'tools/call list_printers sees the printer', call.code === 200 && callText.indexOf('FUNC-TCP-MOCK') >= 0, call.code);

  // ---- discovery on loopback subnet (mock answers 9100 SGD + 8080 vendor page)
  const disc = await fetchJson(BASE + '/rest/discover', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ subnet: '127.0.0' }) }, 90000);
  const dtext = JSON.stringify(disc.json || disc.text || '');
  record('discover', 'loopback scan finds mock Zebra (9100+8080)', disc.code === 200 && dtext.indexOf('127.0.0.1') >= 0 && dtext.indexOf('ZT510') >= 0, disc.code + ', ' + dtext.slice(0, 200));

  // interface list + diagnostics (the "printers not found from another PC" path)
  const subs = await fetchJson(BASE + '/rest/discover/subnets', {}, 8000);
  record('discover', 'subnets endpoint lists local interfaces', subs.code === 200 && Array.isArray(subs.json) && subs.json.length > 0, JSON.stringify(subs.json).slice(0, 160));

  const diag = await fetchJson(BASE + '/rest/discover/diag', {}, 8000);
  const diagOk = diag.code === 200 && diag.json && Array.isArray(diag.json.interfaces) && !!diag.json.last_sweep;
  record('discover', 'diag reports interfaces and last sweep mode', diagOk, diag.json ? ('mode=' + ((diag.json.last_sweep || {}).mode) + ', chosen=' + diag.json.chosen) : String(diag.code));

  // auto = every local interface, not just the first one
  const auto = await fetchJson(BASE + '/rest/discover', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ subnet: 'auto' }) }, 180000);
  const scannedHdr = auto.headers.get('x-scanned-subnets') || '';
  record('discover', 'auto scan covers all interfaces (header set)', auto.code === 200 && scannedHdr.length > 0, 'scanned=' + scannedHdr + ', results=' + (Array.isArray(auto.json) ? auto.json.length : '?'));

  // ---- rediscover (rebind) endpoint answers
  const redis = await fetchJson(BASE + '/rest/printer/rediscover', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' }, 60000);
  record('discover', 'POST /rest/printer/rediscover completes', redis.code === 200, redis.code + ' ' + (redis.text || '').slice(0, 120));

  // ---- connectivity tester: POST /rest/discover/probe (ping + TCP + ms)
  let pT0 = Date.now();
  const probeOk = await fetchJson(BASE + '/rest/discover/probe', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ address: '127.0.0.1:9100' }) }, 15000);
  const probeOkMs = Date.now() - pT0;
  const probeOkJson = probeOk.json || {};
  record('probe', 'reachable endpoint reports tcp.open + ms',
    probeOk.code === 200 && probeOkJson.tcp && probeOkJson.tcp.reachable === true && typeof probeOkJson.tcp.ms === 'number' && !!probeOkJson.ping,
    probeOk.code + ' tcp=' + JSON.stringify(probeOkJson.tcp) + ' ping.ok=' + ((probeOkJson.ping || {}).ok) + ', ' + probeOkMs + 'ms');

  pT0 = Date.now();
  const probeDead = await fetchJson(BASE + '/rest/discover/probe', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ address: '127.0.0.1:1' }) }, 20000);
  const probeDeadMs = Date.now() - pT0;
  const probeDeadJson = probeDead.json || {};
  record('probe', 'closed port -> reachable:false with detail',
    probeDead.code === 200 && probeDeadJson.tcp && probeDeadJson.tcp.reachable === false && !!probeDeadJson.tcp.error,
    probeDead.code + ' ' + JSON.stringify(probeDeadJson.tcp) + ', ' + probeDeadMs + 'ms');
  record('probe', 'probe answers in under 5s', probeOkMs < 5000 && probeDeadMs < 5000, probeOkMs + 'ms / ' + probeDeadMs + 'ms');

  for (const badProbe of ['garbage!!', '-t', '']) {
    const r = await fetchJson(BASE + '/rest/discover/probe', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ address: badProbe }) }, 10000);
    record('probe', 'rejects ' + JSON.stringify(badProbe) + ' -> 400 address_invalid',
      r.code === 400 && r.json && r.json.error === 'address_invalid',
      r.code + ' ' + (r.text || '').slice(0, 70));
  }

  // ---- diagnostics with a target: GET /rest/discover/diag?target=...
  const diagTarget = await fetchJson(BASE + '/rest/discover/diag?target=127.0.0.1', {}, 20000);
  const diagTargetJson = (diagTarget.json || {}).target || {};
  record('diag', '?target=127.0.0.1 returns ping + tcp detail',
    diagTarget.code === 200 && diagTargetJson.host === '127.0.0.1' && diagTargetJson.port === 9100
    && !!diagTargetJson.ping && !!diagTargetJson.tcp,
    JSON.stringify(diagTargetJson).slice(0, 180));

  for (const [q, label] of [['target=%25%25%25', 'junk'], ['target=a&target=b', 'repeated'], ['target=-t', 'option injection']]) {
    const r = await fetchJson(BASE + '/rest/discover/diag?' + q, {}, 20000);
    record('diag', 'hostile ' + label + ' -> still 200', r.code === 200 && r.json && Array.isArray(r.json.interfaces), r.code);
  }

  const diagProbe = await fetchJson(BASE + '/rest/discover/diag?probe=1', {}, 25000);
  const psProbe = (diagProbe.json || {}).powershell_probe;
  record('diag', '?probe=1 reports powershell_probe',
    diagProbe.code === 200 && !!psProbe && typeof psProbe.ok === 'boolean',
    JSON.stringify(psProbe).slice(0, 120));

  // ---- windows printer enumeration
  const winp = await fetchJson(BASE + '/rest/printer/windows', {}, 30000);
  record('windows', 'GET /rest/printer/windows', winp.code === 200 && Array.isArray(winp.json), winp.code + ', ' + (Array.isArray(winp.json) ? winp.json.length + ' printers' : 'not array'));

  // ---- data files, crash.log, alive
  let dbFiles = [];
  try { dbFiles = fs.readdirSync(path.join(dir, 'db')); } catch (e) {}
  record('data', 'db files created beside exe', dbFiles.indexOf('label.json') >= 0 && dbFiles.indexOf('printer.json') >= 0 && dbFiles.indexOf('queue.json') >= 0, dbFiles.join(','));
  record('data', 'logs/crash.log present (crashlog active)', fs.existsSync(path.join(dir, 'logs', 'crash.log')), '');
  record('data', 'exe still alive at end of test run', alive(), dead ? 'process exited during tests:\n' + out.slice(-600) : '');

  // ---- clean exit
  mark = recvSize();
  child.kill();
  const exited = await waitFor(async () => dead, 8000, 200);
  record('exit', 'exe terminates on request', !!exited, dead ? ('exit recorded after ' + Math.round((Date.now() - t0) / 1000) + 's of run') : 'still running after 8s');

  if (conn) { try { conn.close(); } catch (e) {} }
  mock.kill();

  finish();

  function finish() {
    const pass = results.filter(r => r.pass).length;
    const fail = results.length - pass;
    console.log('\n===== SUMMARY =====');
    console.log('total=' + results.length + '  pass=' + pass + '  fail=' + fail);
    for (const r of results) if (!r.pass) console.log('  FAILED: ' + r.section + ' / ' + r.name + '  -- ' + r.detail);
    const last = out.split('\n').filter(Boolean).slice(-8).join('\n');
    console.log('\n--- exe output tail ---\n' + last);
    process.exit(fail ? 1 : 0);
  }
})().catch(e => { console.error('FATAL', e); process.exit(1); });

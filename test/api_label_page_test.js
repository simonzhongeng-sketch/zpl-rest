// API test: label page geometry end to end (isolated service instance).
//
//   node test/api_label_page_test.js
//
// Starts main.js with ZPL_DATA_DIR pointing at a throw-away ABSOLUTE directory
// (the project's db/ is never touched — a running service writes its in-memory
// diskdb state back to disk and has wiped whole tables before), on ports that
// do not collide with test/dev_func_test.js (18420-18422), then checks:
//
//   * POST /rest/label accepts and normalises template.page
//   * a large margin is never a 400 (no safe area), offset out of range is
//   * an all-zero page is dropped again (clean JSON)
//   * a 3-column label with page.roll_width_mm compiles to ^PW1018 (not the
//     clipped ^PW792) with a single ^LH, through the print-queue path
//   * POST /rest/preview still renders a PNG with a page present
'use strict';

const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const PORT = 18430;
const WSPORT = 18431;
const MCPORT = 18432;
const BASE = 'http://127.0.0.1:' + PORT;
// absolute path: Git Bash (MSYS) rewrites a posix "/tmp/x" onto the drive
const DATA_DIR = path.resolve(process.env.ZPL_TEST_DATA_DIR ||
  path.join(os.tmpdir(), 'zpl-api-page-' + process.pid));

let failed = 0;
let child = null;
function check(name, fn) {
  try {
    fn();
    console.log('  [PASS] ' + name);
  } catch (e) {
    failed++;
    console.log('  [FAIL] ' + name + '  -- ' + (e && e.message ? e.message : e));
  }
}
function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

async function fetchJson(url, opts, timeoutMs) {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), timeoutMs || 20000);
  try {
    const r = await fetch(url, Object.assign({ signal: ctl.signal }, opts || {}));
    const text = await r.text();
    let json = null;
    try { json = JSON.parse(text); } catch (e) { /* not json */ }
    return { code: r.status, text, json };
  } finally { clearTimeout(t); }
}
function postJson(url, body) {
  return fetchJson(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });
}

async function waitFor(fn, timeoutMs, everyMs) {
  const end = Date.now() + timeoutMs;
  while (Date.now() < end) {
    const v = await fn();
    if (v) return v;
    await sleep(everyMs || 300);
  }
  return null;
}

function count(hay, needle) {
  return (hay.match(new RegExp(needle.replace(/[\^]/g, '\\^'), 'g')) || []).length;
}

// one text element with a single variable, so multi-up tiling can fill 3 cells
function tpl(variable) {
  return {
    elements: [{ type: 'text', props: { x_mm: 4.25, y_mm: 1.25, height_mm: 4, content: '${' + (variable || 'sn') + '}' } }],
    print_settings: { mode: 'direct_thermal', darkness: 15, speed: 2, quantity: 1 }
  };
}

async function run() {
  fs.rmSync(DATA_DIR, { recursive: true, force: true });
  fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.writeFileSync(path.join(DATA_DIR, 'config.json'), JSON.stringify({
    port: PORT, websocket_port: WSPORT, mcp_port: MCPORT,
    public: true, secret: 'api_page_test', mcp_token: '',
    tray: false, open_browser: false,
    discovery_interval: 3600,   // no background LAN sweeps during the test
    ui_lang: 'zh'
  }, null, 2));

  const env = Object.assign({}, process.env, {
    ZPL_DATA_DIR: DATA_DIR,
    ZPL_SKIP_TRAY_MOD: '1',
    NO_PROXY: '*', no_proxy: '*'
  });
  ['HTTP_PROXY', 'http_proxy', 'HTTPS_PROXY', 'https_proxy', 'ALL_PROXY', 'all_proxy']
    .forEach(k => { delete env[k]; });

  child = spawn(process.execPath, ['main.js'], { cwd: ROOT, env, windowsHide: true });
  let out = '';
  let dead = false;
  child.stdout.on('data', d => { out += d; });
  child.stderr.on('data', d => { out += d; });
  child.on('exit', code => { dead = true; out += '\n[process exited code=' + code + ']'; });

  const up = await waitFor(async () => {
    if (dead) return 'DEAD';
    try { const r = await fetchJson(BASE + '/label', {}, 2000); if (r.code === 200) return true; } catch (e) { /* not yet */ }
    return null;
  }, 40000, 300);
  check('service is up on ' + PORT + ' with an isolated data dir', function () {
    if (up === 'DEAD') throw new Error('process died:\n' + out.slice(-800));
    if (up !== true) throw new Error('timeout');
    if (!fs.existsSync(path.join(DATA_DIR, 'db'))) throw new Error('no db/ in ' + DATA_DIR);
  });
  if (up !== true) return;

  // ---- a bound printer (localhost:1 is closed; nothing is ever printed)
  const pr = await postJson(BASE + '/rest/printer', {
    name: 'API-PAGE-TEST', address: '127.0.0.1:1', conn: 'tcp', density: 12
  });
  const printerId = pr.json && pr.json._id;
  check('printer created for the label binding', function () {
    if (pr.code !== 200 || !printerId) throw new Error(pr.code + ' ' + pr.text.slice(0, 120));
  });
  if (!printerId) return;

  // keep the queue paused: /rest/queue/add compiles the ZPL but must not try
  // to reach the (closed) printer
  await postJson(BASE + '/rest/queue/pause', {});

  // ---- 1: page accepted and normalised
  const ok = await postJson(BASE + '/rest/label', {
    name: 'API-PAGE-1', width: 84.8, height: 23.8, type: 'visual', printer_id: printerId,
    print_layout: { cols: 1, rows: 0 },
    template: Object.assign(tpl('sn'), {
      page: { margin_mm: { top: 1, right: 1, bottom: 1, left: 1 }, offset_mm: { x: 1.5, y: -1 } }
    })
  });
  check('POST /rest/label stores the normalised page (margins + offset)', function () {
    if (ok.code !== 200) throw new Error(ok.code + ' ' + ok.text.slice(0, 200));
    const p = ok.json.template.page;
    if (!p) throw new Error('template.page missing');
    if (p.margin_mm.top !== 1 || p.margin_mm.left !== 1) throw new Error(JSON.stringify(p.margin_mm));
    if (p.offset_mm.x !== 1.5 || p.offset_mm.y !== -1) throw new Error(JSON.stringify(p.offset_mm));
    if ('roll_width_mm' in p) throw new Error('roll_width_mm should be absent');
  });

  // ---- 2: there is no safe area any more -> a large margin is never rejected,
  //          it is only clamped when the shift is compiled
  const bigW = await postJson(BASE + '/rest/label', {
    name: 'API-PAGE-BIGW', width: 84.8, height: 23.8, type: 'visual', printer_id: printerId,
    template: Object.assign(tpl('sn'), { page: { margin_mm: { top: 0, right: 40, bottom: 0, left: 45 } } })
  });
  check('margins wider than the label are accepted (no safe area)', function () {
    if (bigW.code !== 200) throw new Error(bigW.code + ' ' + bigW.text.slice(0, 150));
    const p = bigW.json.template.page;
    if (p.margin_mm.left !== 45 || p.margin_mm.right !== 40) throw new Error(JSON.stringify(p.margin_mm));
  });
  const bigH = await postJson(BASE + '/rest/label', {
    name: 'API-PAGE-BIGH', width: 84.8, height: 23.8, type: 'visual', printer_id: printerId,
    template: Object.assign(tpl('sn'), { page: { margin_mm: { top: 12, right: 0, bottom: 11.5, left: 0 } } })
  });
  check('margins taller than the label are accepted (no safe area)', function () {
    if (bigH.code !== 200) throw new Error(bigH.code + ' ' + bigH.text.slice(0, 150));
    const p = bigH.json.template.page;
    if (p.margin_mm.top !== 12) throw new Error(JSON.stringify(p.margin_mm));
  });

  // ---- 3: offset out of range -> 400 (limit is min(20mm, size/4))
  const farX = await postJson(BASE + '/rest/label', {
    name: 'API-PAGE-FARX', width: 84.8, height: 23.8, type: 'visual', printer_id: printerId,
    template: Object.assign(tpl('sn'), { page: { offset_mm: { x: 25, y: 0 } } })
  });
  check('offset x = 25mm -> 400', function () {
    if (farX.code !== 400) throw new Error('code ' + farX.code);
    if (!/offset out of range/.test(farX.text)) throw new Error(farX.text.slice(0, 150));
  });
  const farY = await postJson(BASE + '/rest/label', {
    name: 'API-PAGE-FARY', width: 84.8, height: 23.8, type: 'visual', printer_id: printerId,
    template: Object.assign(tpl('sn'), { page: { offset_mm: { x: 0, y: 6 } } })
  });
  check('offset y = 6mm on a 23.8mm label (limit 5.95) -> 400', function () {
    if (farY.code !== 400) throw new Error('code ' + farY.code);
    if (!/offset out of range/.test(farY.text)) throw new Error(farY.text.slice(0, 150));
  });

  // ---- 4: an all-zero page is not persisted
  const zero = await postJson(BASE + '/rest/label', {
    name: 'API-PAGE-ZERO', width: 84.8, height: 23.8, type: 'visual', printer_id: printerId,
    template: Object.assign(tpl('sn'), {
      page: { margin_mm: { top: 0, right: 0, bottom: 0, left: 0 }, offset_mm: { x: 0, y: 0 } }
    })
  });
  check('all-zero page is dropped (clean legacy JSON)', function () {
    if (zero.code !== 200) throw new Error(zero.code + ' ' + zero.text.slice(0, 200));
    if (zero.json.template.page !== undefined) throw new Error('page kept: ' + JSON.stringify(zero.json.template.page));
  });

  // ---- 5: three-column media on an 84.8mm roll
  const yellow = await postJson(BASE + '/rest/label', {
    name: 'API-PAGE-3COL', width: 22, height: 5, type: 'visual', printer_id: printerId,
    print_layout: { cols: 3, rows: 0 },
    template: Object.assign(tpl('sn'), {
      page: { margin_mm: { top: 1, right: 1, bottom: 1, left: 1 }, offset_mm: { x: 0, y: 0 }, roll_width_mm: 84.8 }
    })
  });
  const yellowId = yellow.json && yellow.json._id;
  check('3-column label keeps roll_width_mm = 84.8', function () {
    if (yellow.code !== 200 || !yellowId) throw new Error(yellow.code + ' ' + yellow.text.slice(0, 200));
    const p = yellow.json.template.page || {};
    if (p.roll_width_mm !== 84.8) throw new Error(JSON.stringify(p));
  });

  if (yellowId) {
    const added = await postJson(BASE + '/rest/queue/add', {
      label_id: yellowId, printer_id: printerId, values: ['A1', 'A2', 'A3']
    });
    check('queue compiles the row with ^PW1018 / ^LL60 and one ^LH', function () {
      if (added.code !== 200) throw new Error(added.code + ' ' + added.text.slice(0, 200));
      const zpl = added.json.zpl_override || '';
      if (!zpl) throw new Error('no zpl_override: ' + JSON.stringify(added.json).slice(0, 200));
      if (zpl.indexOf('^PW1018\n') === -1) throw new Error('missing ^PW1018:\n' + zpl);
      if (zpl.indexOf('^PW792') !== -1) throw new Error('^PW degraded to the label row width:\n' + zpl);
      if (zpl.indexOf('^LL60\n') === -1) throw new Error('missing ^LL60:\n' + zpl);
      if (count(zpl, '^LH') !== 1) throw new Error('^LH must appear once:\n' + zpl);
      if (count(zpl, '^FO') !== 3) throw new Error('expected 3 columns:\n' + zpl);
      const order = ['^PW', '^LL', '^LH', '^FO'].map(s => zpl.indexOf(s));
      if (!(order[0] < order[1] && order[1] < order[2] && order[2] < order[3])) {
        throw new Error('header order wrong: ' + order.join(',') + '\n' + zpl);
      }
      if (/(\$\{|\{\{)/.test(zpl)) throw new Error('placeholders not filled:\n' + zpl);
      if (zpl.indexOf('A1') === -1 || zpl.indexOf('A3') === -1) throw new Error('values missing:\n' + zpl);
    });
  }

  // ---- 6: preview still renders with a page present
  const prev = await postJson(BASE + '/rest/preview', {
    printer: printerId, label: ok.json._id, data: { sn: 'SAMPLE' }
  });
  check('POST /rest/preview returns a PNG with a page present', function () {
    if (prev.code !== 200) throw new Error(prev.code + ' ' + prev.text.slice(0, 200));
    const img = (prev.json && prev.json.img) || '';
    if (img.length < 100) throw new Error('image too small: ' + img.length);
    // PNG magic in base64: iVBORw0KGgo
    if (img.slice(0, 11) !== 'iVBORw0KGgo') throw new Error('not a PNG: ' + img.slice(0, 20));
  });

  // ---- 7: the update path takes the same page (no safe area to violate)
  const upd = await postJson(BASE + '/rest/label', {
    _id: ok.json._id, name: 'API-PAGE-1', width: 84.8, height: 23.8, type: 'visual', printer_id: printerId,
    template: Object.assign(tpl('sn'), { page: { margin_mm: { top: 0, right: 40, bottom: 0, left: 45 } } })
  });
  check('update (POST with _id) accepts a wide-margin page', function () {
    if (upd.code !== 200) throw new Error('code ' + upd.code + ' ' + upd.text.slice(0, 150));
  });
}

(async function main() {
  console.log('api label page test\n  data dir: ' + DATA_DIR + ' (isolated)\n');
  try {
    await run();
  } catch (e) {
    failed++;
    console.log('  [FAIL] unexpected error -- ' + (e && e.stack ? e.stack : e));
  } finally {
    if (child) { try { child.kill(); } catch (e) { /* ignore */ } }
    await waitFor(() => child === null || child.killed, 5000, 200);
    try { fs.rmSync(DATA_DIR, { recursive: true, force: true }); } catch (e) { /* ignore */ }
  }
  console.log('\n' + (failed ? failed + ' FAILED' : 'ALL PASS'));
  process.exit(failed ? 1 : 0);
})();

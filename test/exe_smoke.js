// Smoke test for the packaged exe: run it in an isolated folder on alternate
// ports (8100/8101/8102) so it does not collide with the dev server on 8000.
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const http = require('http');

const exe = process.argv[2];
if (!exe) { console.error('usage: node exe_smoke.js <path-to-exe>'); process.exit(1); }

const dir = path.join(__dirname, 'exe_smoke');
fs.rmSync(dir, { recursive: true, force: true });
fs.mkdirSync(dir, { recursive: true });
const target = path.join(dir, path.basename(exe));
fs.copyFileSync(exe, target);
fs.writeFileSync(path.join(dir, 'config.json'), JSON.stringify({
  port: 8100, websocket_port: 8101, mcp_port: 8102,
  tray: false, open_browser: false, public: true
}, null, 2));

function get(url) {
  return new Promise(function (resolve, reject) {
    http.get(url, function (res) {
      let buf = '';
      res.on('data', function (c) { buf += c; });
      res.on('end', function () { resolve({ code: res.statusCode, body: buf, type: res.headers['content-type'] }); });
    }).on('error', reject);
  });
}

function post(url, body) {
  return new Promise(function (resolve, reject) {
    const data = JSON.stringify(body);
    const r = http.request(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data) }
    }, function (res) {
      let buf = '';
      res.on('data', function (c) { buf += c; });
      res.on('end', function () { resolve({ code: res.statusCode, body: buf, type: res.headers['content-type'] }); });
    });
    r.on('error', reject);
    r.write(data);
    r.end();
  });
}

(async function () {
  console.log('exe: ' + target + ' (' + (fs.statSync(target).size / 1024 / 1024).toFixed(1) + ' MB)');
  const child = spawn(target, [], { cwd: dir, windowsHide: true });
  let out = '';
  child.stdout.on('data', function (d) { out += d; });
  child.stderr.on('data', function (d) { out += d; });

  let up = false;
  for (let i = 0; i < 40; i++) {
    await new Promise(function (r) { setTimeout(r, 500); });
    try {
      const r = await get('http://127.0.0.1:8100/label');
      if (r.code === 200) { up = true; console.log('  UI /label          -> 200 (' + r.body.length + ' bytes)'); break; }
    } catch (e) { /* not up yet */ }
  }
  if (!up) {
    console.log('FAILED: UI never came up');
    console.log(out.slice(-2000));
    child.kill();
    process.exit(1);
  }

  const checks = [
    ['/rest/label', 'labels json'],
    ['/rest/printer', 'printers json'],
    ['/queue', 'queue page']
  ];
  for (const c of checks) {
    const r = await get('http://127.0.0.1:8100' + c[0]);
    console.log('  ' + c[0].padEnd(18) + ' -> ' + r.code + '  (' + c[1] + ', ' + r.body.length + ' bytes)');
    if (c[0] === '/rest/label' && r.code === 200) {
      try { console.log('     labels: ' + JSON.parse(r.body).map(function (l) { return l.name; }).join(', ')); } catch (e) {}
    }
  }

  // MCP endpoint: Streamable HTTP answers a GET with 405/406 or a JSON error,
  // which is enough to prove the server is listening.
  try {
    const m = await get('http://127.0.0.1:8102/mcp');
    console.log('  /mcp (8102)        -> ' + m.code);
  } catch (e) { console.log('  /mcp (8102)        -> unreachable: ' + e.message); }

  // local ZPL renderer (Zebrash WASM, bundled as base64): the most fragile
  // part of a pkg build, so create a label and render a real preview.
  const pr = await post('http://127.0.0.1:8100/rest/printer', {
    name: 'SMOKE-TCP', address: '127.0.0.1:9999', conn: 'tcp', density: 12,
    settings: { mode: 'thermal_transfer', darkness: 15, speed: 2 }
  });
  const printerId = pr.code === 200 ? JSON.parse(pr.body)._id : null;
  const lb = await post('http://127.0.0.1:8100/rest/label', {
    name: 'SMOKE-LABEL', width: 60, height: 20, type: 'visual', printer_id: printerId,
    template: {
      elements: [
        { type: 'text', props: { x_mm: 3, y_mm: 3, content: 'SMOKE ${var}', height_mm: 4 } },
        { type: 'qrcode', props: { x_mm: 3, y_mm: 9, content: '${var}', size_mm: 8 } }
      ],
      print_settings: { mode: 'thermal_transfer', darkness: 15, speed: 2, quantity: 1 }
    }
  });
  const labelId = lb.code === 200 ? JSON.parse(lb.body)._id : null;
  console.log('  create printer     -> ' + pr.code + ' | create label -> ' + lb.code);
  if (printerId && labelId) {
    const pv = await get('http://127.0.0.1:8100/rest/preview?printer=' + printerId + '&label=' + labelId);
    // the endpoint answers {img: "<base64 png>"}; a real render starts with the
    // PNG magic bytes "iVBORw0KGgo"
    let ok = false, bytes = 0;
    try {
      const img = JSON.parse(pv.body).img || '';
      bytes = Math.round(img.length * 3 / 4);
      ok = img.indexOf('iVBORw0KGgo') === 0 && img.length > 500;
    } catch (e) { /* not json */ }
    console.log('  /rest/preview      -> ' + pv.code + '  ' + (ok ? 'RENDER OK' : 'RENDER FAILED') +
      '  (png ~' + bytes + ' bytes)');
  }

  console.log('  data files created: ' + fs.readdirSync(path.join(dir, 'db')).join(', '));
  child.kill();
  await new Promise(function (r) { setTimeout(r, 800); });
  console.log('  exited cleanly');
  console.log(out.split('\n').filter(Boolean).slice(0, 6).join('\n'));
  process.exit(0);
})().catch(function (e) { console.error('ERR', e.message); process.exit(1); });

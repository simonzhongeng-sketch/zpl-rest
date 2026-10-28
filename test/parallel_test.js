// Cross-printer parallel print test (mocked, no real media consumed).
//   A) 3 printers, 3 values each -> 1 row per printer, all should start together
//   B) 2 printers, 6 values each -> 2 rows per printer, rows parallel across
//      printers but strictly ordered inside one printer
//   C) 1 unreachable printer + 2 healthy -> offline job waits, others print
const fs = require('fs');
const http = require('http');
const path = require('path');

const BASE = 'http://127.0.0.1:18420';
const LABEL = '3e621cc23d274478b01f432bad3cea3c'; // 3G5, 22x5, cols=3
const LOG = path.join(__dirname, 'mock_parallel.log');

function req(method, p, body) {
  return new Promise(function (resolve, reject) {
    const data = body ? JSON.stringify(body) : null;
    const r = http.request(BASE + p, {
      method: method,
      headers: data ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data) } : {}
    }, function (res) {
      let buf = '';
      res.on('data', function (c) { buf += c; });
      res.on('end', function () {
        try { resolve(JSON.parse(buf)); } catch (e) { resolve(buf); }
      });
    });
    r.on('error', reject);
    if (data) r.write(data);
    r.end();
  });
}

function readLog() {
  if (!fs.existsSync(LOG)) return [];
  return fs.readFileSync(LOG, 'utf8').split('\n').filter(Boolean).map(function (l) { return JSON.parse(l); });
}

const printers = {};
const t0 = Date.now();
function log(msg) { console.log('[' + ((Date.now() - t0) / 1000).toFixed(1) + 's] ' + msg); }

async function setup() {
  for (const port of [9200, 9201, 9202]) {
    const p = await req('POST', '/rest/printer', {
      name: 'MOCK-' + port, address: '127.0.0.1:' + port, conn: 'tcp', density: 12,
      settings: { mode: 'thermal_transfer', darkness: 15, speed: 2 }
    });
    printers[port] = p._id;
  }
  const off = await req('POST', '/rest/printer', {
    name: 'MOCK-OFFLINE', address: '127.0.0.1:9999', conn: 'tcp', density: 12,
    settings: { mode: 'thermal_transfer', darkness: 15, speed: 2 }
  });
  printers.offline = off._id;
  log('created mock printers');
}

async function scenarioA() {
  fs.writeFileSync(LOG, '');
  log('--- A) one row on each of 3 printers, submitted in ONE batch');
  const items = [];
  for (const port of [9200, 9201, 9202]) {
    items.push({ label_id: LABEL, printer_id: printers[port], data: { var: 'A' + port }, source: 'manual' });
  }
  // three single-value tasks per printer -> merged into one row each
  const batch = [];
  for (const port of [9200, 9201, 9202]) {
    for (const v of ['A1', 'A2', 'A3']) batch.push({ label_id: LABEL, printer_id: printers[port], data: { var: v }, source: 'manual' });
  }
  const r = await req('POST', '/rest/queue/add-many', { items: batch });
  log('queued items: ' + batch.length + ' -> response ' + JSON.stringify(r).slice(0, 120));
  await new Promise(function (res) { setTimeout(res, 9000); });
  const rows = readLog();
  const first = {};
  rows.forEach(function (r) { if (!first[r.port]) first[r.port] = r.at; });
  const base = Math.min.apply(null, Object.values(first));
  console.log('    arrival offsets from first job:');
  Object.keys(first).sort().forEach(function (p) {
    console.log('      port ' + p + ': +' + (first[p] - base) + 'ms');
  });
  const spread = Math.max.apply(null, Object.values(first)) - base;
  console.log('    spread = ' + spread + 'ms  -> ' + (spread < 500 ? 'PARALLEL (all printers started together)' : 'SERIAL (queued behind each other)'));
  console.log('    jobs received: ' + rows.length + ' / expected 3');
}

async function scenarioB() {
  fs.writeFileSync(LOG, '');
  log('--- B) two rows on each of 2 printers (6 values each)');
  const batch = [];
  for (const port of [9200, 9201]) {
    for (const v of ['B' + port + '-1', 'B' + port + '-2', 'B' + port + '-3', 'B' + port + '-4', 'B' + port + '-5', 'B' + port + '-6']) {
      batch.push({ label_id: LABEL, printer_id: printers[port], data: { var: v }, source: 'manual' });
    }
  }
  await req('POST', '/rest/queue/add-many', { items: batch });
  log('queued 12 single-value tasks (4 rows expected)');
  await new Promise(function (res) { setTimeout(res, 12000); });
  const rows = readLog().sort(function (a, b) { return a.at - b.at; });
  const base = rows.length ? rows[0].at : 0;
  console.log('    arrival order:');
  rows.forEach(function (r) {
    console.log('      +' + String(r.at - base).padStart(5) + 'ms  port ' + r.port + '  ' + r.fds.join(' / '));
  });
  const byPort = {};
  rows.forEach(function (r) { (byPort[r.port] = byPort[r.port] || []).push(r); });
  let ok = true;
  Object.keys(byPort).forEach(function (p) {
    const seq = byPort[p];
    for (let i = 1; i < seq.length; i++) if (seq[i].at < seq[i - 1].at) ok = false;
    console.log('    port ' + p + ': ' + seq.length + ' jobs, order ' + (ok ? 'preserved' : 'BROKEN'));
  });
  const overlap = rows.length >= 2 && (rows[1].at - rows[0].at) < 500;
  console.log('    overlap between printers = ' + (overlap ? 'YES (parallel)' : 'NO'));
}

async function scenarioC() {
  fs.writeFileSync(LOG, '');
  log('--- C) unreachable printer + 2 healthy printers');
  const batch = [
    { label_id: LABEL, printer_id: printers.offline, data: { var: 'OFF1' }, source: 'manual' },
    { label_id: LABEL, printer_id: printers[9202], data: { var: 'ON1' }, source: 'manual' }
  ];
  await req('POST', '/rest/queue/add-many', { items: batch });
  await new Promise(function (res) { setTimeout(res, 9000); });
  const q = await req('GET', '/rest/queue');
  const offJobs = (q.items || []).filter(function (i) { return i.printer_id === printers.offline; });
  const onDone = (q.history || []).filter(function (i) { return i.printer_id === printers[9202]; });
  console.log('    offline printer jobs still pending: ' + offJobs.length + ' (status ' +
    (offJobs[0] ? offJobs[0].status : 'n/a') + ')');
  console.log('    healthy printer finished jobs: ' + onDone.length);
  console.log('    queue globally paused? ' + q.paused);
  const rows = readLog();
  console.log('    healthy printer received: ' + rows.map(function (r) { return r.fds.join('/'); }).join(', '));
}

async function cleanup() {
  const q = await req('GET', '/rest/queue');
  const ids = (q.items || []).concat(q.history || [])
    .filter(function (i) { return Object.values(printers).indexOf(i.printer_id) >= 0; })
    .map(function (i) { return i._id; });
  if (ids.length) {
    const r = await req('POST', '/rest/queue/delete', { ids: ids });
    log('deleted test queue items: ' + JSON.stringify(r).slice(0, 80));
  }
  for (const k of Object.keys(printers)) {
    await req('DELETE', '/rest/printer/' + printers[k]);
  }
  log('mock printers removed');
  const left = await req('GET', '/rest/printer');
  console.log('    remaining printers: ' + left.map(function (p) { return p.name; }).join(', '));
}

(async function () {
  await setup();
  await scenarioA();
  await scenarioB();
  await scenarioC();
  await cleanup();
  log('done');
  process.exit(0);
})().catch(function (e) { console.error(e); process.exit(1); });

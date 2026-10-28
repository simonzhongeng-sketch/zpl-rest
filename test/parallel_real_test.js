// Real-printer parallel test: one job on each of the three online ZT510 units,
// submitted as a single batch. Samples /rest/queue to show how many jobs are in
// flight at the same time and prints a timeline.
const http = require('http');

const BASE = 'http://127.0.0.1:18420';
const P42 = '417fd913981b4380b7b4af1086f36c1f';   // ZT510 (192.168.8.42) TCP
const P19 = 'af7df570a20d41fa804accce622f3d7f';   // ZT510 (192.168.8.19) TCP
const PUSB = 'd993da6a953244e3bd4f70c3897ab0c9';  // ZT510 (USB-02) USB

const L841 = 'ae5ca534929a41a7b3c72a6f07d53199';        // 84.8 x 23.8
const L8418 = '89b066ce6d714068a0113b1829ba127d';       // temp label tuned for .19
const L3G5 = '3e621cc23d274478b01f432bad3cea3c';        // 22 x 5, 3 up

function req(method, p, body) {
  return new Promise(function (resolve, reject) {
    const data = body ? JSON.stringify(body) : null;
    const r = http.request(BASE + p, {
      method: method,
      headers: data ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data) } : {}
    }, function (res) {
      let buf = '';
      res.on('data', function (c) { buf += c; });
      res.on('end', function () { try { resolve(JSON.parse(buf)); } catch (e) { resolve(buf); } });
    });
    r.on('error', reject);
    if (data) r.write(data);
    r.end();
  });
}

const t0 = Date.now();
function ts() { return ((Date.now() - t0) / 1000).toFixed(1) + 's'; }

(async function () {
  const payload = {
    items: [
      { label_id: L841, printer_id: P42, data: { var: 'P1 .42' }, source: 'manual' },
      { label_id: L8418, printer_id: P19, data: { var: 'P2 .19' }, source: 'manual' },
      { label_id: L3G5, printer_id: PUSB, values: ['P3-A', 'P3-B', 'P3-C'], source: 'manual' }
    ]
  };
  const r = await req('POST', '/rest/queue/add-many', payload);
  console.log(ts() + ' submitted: ' + JSON.stringify(r));

  let peak = 0;
  const timeline = [];
  for (let i = 0; i < 60; i++) {
    const q = await req('GET', '/rest/queue');
    const active = q.active || {};
    const n = Object.keys(active).length;
    if (n !== (timeline.length ? timeline[timeline.length - 1].n : -1)) {
      timeline.push({ t: ts(), n: n, detail: Object.keys(active).map(function (k) { return k.slice(0, 6); }) });
    }
    peak = Math.max(peak, n);
    const pending = (q.items || []).filter(function (i) { return i.status === 'pending'; }).length;
    if (!pending && n === 0 && i > 5) break;
    await new Promise(function (res) { setTimeout(res, 200); });
  }
  console.log(ts() + ' active-job peaks: ' + peak);
  timeline.forEach(function (x) { console.log('   ' + x.t + '  in flight: ' + x.n + '  ' + x.detail.join(',')); });

  const q = await req('GET', '/rest/queue');
  const mine = (q.history || []).concat(q.items || [])
    .filter(function (i) { return [P42, P19, PUSB].indexOf(i.printer_id) >= 0; })
    .sort(function (a, b) { return new Date(a.created_at) - new Date(b.created_at); })
    .slice(-6);
  console.log('results:');
  mine.forEach(function (i) {
    console.log('   ' + (i.job_id || '-') + ' | ' + i.status + ' | printer ' +
      (i.printer_name || i.printer_id.slice(0, 6)) + ' | created ' +
      String(i.created_at).slice(11, 23) + ' | finished ' + String(i.finished_at || '').slice(11, 23) +
      ' | err ' + (i.error || '-'));
  });
  process.exit(0);
})().catch(function (e) { console.error('ERR', e.message); process.exit(1); });

// Per-stage diagnosis for a single host: why does the scanner drop it?
// usage: node test/diag_scan_one.js 192.168.8.45 [192.168.8.43 ...]
// Read-only: ping, TCP connect, HTTP GET (never prints), then SGD getvar.
var d = require('../lib/discover.js');
var profiles = require('../lib/printer_profiles.js');
var http = require('http');

function httpGet(ip, port, timeout) {
  return new Promise(function (resolve) {
    var t0 = Date.now();
    var req = http.get({ host: ip, port: port, path: '/' }, function (res) {
      var chunks = [];
      var len = 0;
      res.on('data', function (c) { len += c.length; if (len <= 65536) chunks.push(c); });
      res.on('end', function () {
        resolve({ port: port, status: res.statusCode, ms: Date.now() - t0, body: Buffer.concat(chunks).toString('utf8') });
      });
    });
    req.setTimeout(timeout, function () { req.destroy(); resolve({ port: port, status: 'timeout', ms: Date.now() - t0 }); });
    req.on('error', function (e) { resolve({ port: port, status: 'error:' + (e.code || e.message), ms: Date.now() - t0 }); });
  });
}

var hosts = process.argv.slice(2);
if (!hosts.length) { console.log('usage: node test/diag_scan_one.js <ip> [ip...]'); process.exit(1); }

(async function () {
  for (var h of hosts) {
    console.log('\n================ ' + h + ' ================');
    var p = await d.pingHost(h, 1500);
    console.log('ping        :', p.ok ? 'OK ' + p.ms + 'ms' : 'FAIL');

    var t0 = Date.now();
    var open = await d.probePort(h, 9100, 1200);
    console.log('tcp 9100    :', open ? 'OPEN ' + (Date.now() - t0) + 'ms' : 'CLOSED/timeout ' + (Date.now() - t0) + 'ms');

    if (!open) continue;

    for (var port of [80, 631, 8080]) {
      var r = await httpGet(h, port, 1200);
      var hasZebra = r.body ? /zebra/i.test(r.body) : false;
      var head = r.body ? r.body.replace(/\s+/g, ' ').slice(0, 120) : '';
      console.log('http ' + String(port).padEnd(5) + ':', r.status, r.ms + 'ms', 'zebra=' + hasZebra, head ? '| ' + head : '');
    }

    var model = await d.sgdQuery(h, 9100, 'device.product_name', 1500);
    console.log('sgd model   :', JSON.stringify(model), 'isZebraModel=' + (model ? profiles.isZebraModel(model) : 'n/a'));

    var dpi = await d.sgdQuery(h, 9100, 'device.head.resolution.in_dpi', 1500);
    var dpmm = await d.sgdQuery(h, 9100, 'device.head.resolution.in_dots_per_mm', 1500);
    var serial = await d.sgdQuery(h, 9100, 'device.serial_number', 1500);
    var uid = await d.sgdQuery(h, 9100, 'device.unique_id', 1500);
    console.log('sgd dpi     :', JSON.stringify(dpi), 'dpmm=' + JSON.stringify(dpmm));
    console.log('sgd serial  :', JSON.stringify(serial), 'unique_id=' + JSON.stringify(uid));
  }
  process.exit(0);
})().catch(function (e) { console.error('ERR', e && e.stack || e); process.exit(1); });

// Reproduce the real auto-scan path and report the sweep vs identify split.
// usage: node test/repro_auto_scan.js [base e.g. 192.168.8] [times]
var d = require('../lib/discover.js');

var base = process.argv[2] || '192.168.8';
var times = parseInt(process.argv[3] || '3', 10);

(async function () {
  for (var n = 1; n <= times; n++) {
    d.resetScanStats();
    var t0 = Date.now();
    var list = await d.discoverPrintersAll([base]);
    console.log('\n--- run ' + n + ' (' + (Date.now() - t0) + 'ms) ---');
    console.log('found:', list.map(function (p) { return p.ip + ' ' + p.model + ' ' + (p.serial || '-') + ' ' + p.density; }).join(' | ') || '(none)');
    console.log('stats:', JSON.stringify(d.getScanStats()));
    console.log('diag :', JSON.stringify(d.getDiag().last_sweep));
  }
  process.exit(0);
})().catch(function (e) { console.error(e); process.exit(1); });

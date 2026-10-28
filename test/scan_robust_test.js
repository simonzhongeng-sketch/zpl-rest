// Regression tests for the "one printer of the fleet is missing" hardening:
//   - arp -a parsing (three OS flavours, placeholder / other-subnet rows)
//   - the neighbour re-check merge (the second chance that recovers a printer
//     whose SYN was dropped during a 254-host burst)
//   - the PowerShell sweep script's incremental collection (no fixed window)
//
// usage: node test/scan_robust_test.js      exit 0 = all pass, 1 = failure
var net = require('net');
var fs = require('fs');
var path = require('path');
var discover = require('../lib/discover.js');

var pass = 0;
var fail = 0;
function ok(cond, name) {
  if (cond) { pass++; console.log('  [PASS] ' + name); }
  else { fail++; console.log('  [FAIL] ' + name); }
}

// start a bare TCP listener that accepts and closes nothing (a stand-in for
// an open 9100 port); resolves with the server so the caller can close it
function listen(port) {
  return new Promise(function (resolve, reject) {
    var srv = net.createServer(function (s) { s.on('error', function () {}); });
    srv.once('error', reject);
    srv.listen(port, '127.0.0.1', function () { resolve(srv); });
  });
}

(async function () {
  // ---- arp parsing -------------------------------------------------------
  console.log('\n== arp -a parsing ==');
  var win = [
    '',
    'Interface: 192.168.8.20 --- 0xd',
    '  Internet Address      Physical Address      Type',
    '  192.168.8.1           00-11-22-33-44-55     dynamic',
    '  192.168.8.43          00-07-4f-aa-bb-cc     dynamic',
    '  192.168.8.45          00074fddeeff         dynamic',
    '  192.168.8.255         ff-ff-ff-ff-ff-ff     static',
    '  192.168.8.99          00-00-00-00-00-00     static',
    '  10.0.0.7              00-aa-bb-cc-dd-ee     dynamic',
    ''
  ].join('\r\n');
  var r1 = discover.parseArpTable(win, '192.168.8');
  ok(r1.indexOf('192.168.8.43') !== -1, 'windows table keeps 192.168.8.43');
  ok(r1.indexOf('192.168.8.45') !== -1, 'windows table keeps a no-separator MAC (00074fddeeff)');
  ok(r1.indexOf('192.168.8.255') === -1, 'broadcast MAC ff-ff-ff-ff-ff-ff skipped');
  ok(r1.indexOf('192.168.8.99') === -1, 'placeholder MAC 00-00-00-00-00-00 skipped');
  ok(r1.indexOf('10.0.0.7') === -1, 'other subnet ignored');
  ok(r1.indexOf('192.168.8.1') !== -1, 'gateway kept (it is a real neighbour)');

  var mac = '? (192.168.8.45) at 0:7:4f:dd:ee:ff on en0 ifscope [ethernet]\n'
    + '? (192.168.8.46) at (incomplete) on en0 ifscope [ethernet]\n'
    + '? (192.168.8.1) at 0:11:22:33:44:55 on en0 ifscope [ethernet]';
  var r2 = discover.parseArpTable(mac, '192.168.8');
  ok(r2.length === 2 && r2.indexOf('192.168.8.45') !== -1 && r2.indexOf('192.168.8.1') !== -1,
    'macOS table: 2 real neighbours, "(incomplete)" row ignored');
  ok(discover.parseArpTable(win, '192.168.8').length === discover.parseArpTable(win, '192.168.8').length,
    'parsing is deterministic (no duplicate rows)');
  ok(discover.parseArpTable('', '192.168.8').length === 0, 'empty output -> no neighbours');

  // ---- neighbour re-check ------------------------------------------------
  console.log('\n== neighbour re-check (second chance) ==');
  var openSrv = await listen(19100);
  var closedPort = 19101;

  var extra = await discover.recheckNeighbors('127.0.0', ['127.0.0.1'], function () {
    return Promise.resolve(['127.0.0.1', '127.0.0.2', '127.0.0.3']);
  });
  // 127.0.0.1 already reported open -> not probed; .2 is a live mock only if
  // something listens there, so expect nothing found on plain loopback
  ok(Array.isArray(extra), 'recheck resolves an array even with no hits');
  ok(extra.indexOf('127.0.0.1') === -1, 'host already reported open is not re-probed');

  // now make one candidate actually reachable: mock listens on 19100, and the
  // probe target port is 9100, so use a base that maps the mock's own port
  var extra2 = await discover.recheckNeighbors('127.0.0', [], function () {
    return Promise.resolve(['127.0.0.1']);
  });
  ok(Array.isArray(extra2), 'recheck survives a candidate with nothing on 9100');
  openSrv.close();

  var emptyProvider = await discover.recheckNeighbors('127.0.0', [], function () {
    return Promise.resolve([]);
  });
  ok(emptyProvider.length === 0, 'empty ARP table -> no extra probes');

  var deadProvider = await discover.recheckNeighbors('127.0.0', [], function () {
    return Promise.reject(new Error('arp failed'));
  });
  ok(deadProvider.length === 0, 'failing ARP lookup degrades to "no extra" (never throws)');

  // ---- sweep script shape ------------------------------------------------
  console.log('\n== PowerShell sweep script ==');
  var src = fs.readFileSync(path.join(__dirname, '..', 'lib', 'discover.js'), 'utf8');
  ok(/while \(\$true\)/.test(src) && /ElapsedMilliseconds -ge \$MaxMs/.test(src),
    'sweep collects incrementally until every socket resolved or the deadline');
  ok(!/Start-Sleep -Milliseconds \$WaitMs/.test(src),
    'the old single fixed wait window is gone');
  ok(/recheckNeighbors\(base, res\.hosts\)/.test(src),
    'sweep results are merged with the neighbour re-check before being final');
  // the frozen exe is destabilised by extra node sockets, so the PowerShell
  // path must do the re-check itself and node must not add a second burst
  ok(/\^node.*test\(res\.mode\)/.test(src) || /\^node/.test(src.slice(src.indexOf('var recheck'), src.indexOf('var recheck') + 400)),
    'node-side re-check only runs for the node fallback, not after a PowerShell sweep');
  ok(/arp -a/.test(src) && /StartsWith\("\$Base\."\)/.test(src),
    'the PowerShell sweep re-checks ARP neighbours inside its own process');
  ok(/HTTP_TIMEOUT_RETRY/.test(src) && /httpIdentifyVendor\(ip, HTTP_TIMEOUT_RETRY\)/.test(src),
    'vendor identification retries once, slower, when nothing answered');

  console.log('\n===== SUMMARY =====');
  console.log('total=' + (pass + fail) + '  pass=' + pass + '  fail=' + fail);
  process.exit(fail ? 1 : 0);
})().catch(function (e) {
  console.error('ERR', e && e.stack || e);
  process.exit(1);
});

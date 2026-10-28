// Verification for the discovery safety guarantee:
// devices that are not confirmed Zebra via HTTP must receive ZERO bytes
// on TCP 9100 (HP JetDirect-style devices print everything they receive).
//
// Simulates on distinct loopback IPs:
//   127.0.0.10 - fake HP printer  (9100 raw + web page saying HP LaserJet)
//   127.0.0.11 - unknown device  (9100 raw, no web server)
//   127.0.0.12 - fake Zebra      (9100 SGD answers + web page saying Zebra)
//
// Expects: only the Zebra is discovered, HP/unknown received 0 bytes.
const net = require('net');
const http = require('http');
const discover = require('../lib/discover.js');

const HP_IP = '127.0.0.10';
const UNKNOWN_IP = '127.0.0.11';
const ZEBRA_IP = '127.0.0.12';

function makeRawDevice(ip, dataHandler) {
  let bytes = 0;
  const srv = net.createServer(function (s) {
    s.on('data', function (c) { bytes += c.length; if (dataHandler) dataHandler(s, c); });
    s.on('error', function () {});
  });
  return {
    srv: srv,
    received: function () { return bytes; },
    listen: function (port) { return new Promise(function (r) { srv.listen(port, ip, r); }); },
    close: function () { srv.close(); }
  };
}

function makeWebServer(ip, html) {
  const srv = http.createServer(function (req, res) {
    res.writeHead(200, { 'Content-Type': 'text/html' });
    res.end(html);
  });
  return {
    listen: function (port) { return new Promise(function (r) { srv.listen(port, ip, r); }); },
    close: function () { srv.close(); }
  };
}

// fake HP: counts "printed" bytes, web page identifies as HP
const hp = makeRawDevice(HP_IP);
const hpWeb = makeWebServer(HP_IP,
  '<html><head><title>HP LaserJet Pro M404</title></head><body>HP Jetdirect Active</body></html>');

// unknown device: raw 9100, no web server at all
const unknownDev = makeRawDevice(UNKNOWN_IP);

// fake Zebra: answers SGD like a ZT510, web page identifies as Zebra
const zebra = makeRawDevice(ZEBRA_IP, function (s, c) {
  const m = c.toString().match(/! U1 getvar "([^"]+)"/);
  if (!m) return;
  if (m[1] === 'device.product_name') s.write('ZT510\n');
  else if (m[1] === 'device.head.resolution.in_dpi') s.write('203\n');
  else s.write('\n');
});
const zebraWeb = makeWebServer(ZEBRA_IP,
  '<html><head><title>Zebra Technologies - ZT510</title></head><body>Zebra Setup Utilities</body></html>');

(async function () {
  await Promise.all([
    hp.listen(9100), unknownDev.listen(9100), zebra.listen(9100),
    hpWeb.listen(8080), zebraWeb.listen(8080)
  ]);
  console.log('fake devices up: HP(' + HP_IP + '), unknown(' + UNKNOWN_IP + '), Zebra(' + ZEBRA_IP + ')');

  const list = await discover.discoverPrinters('127.0.0');
  console.log('discovered:', list.map(function (p) { return p.ip + ' -> ' + p.model; }).join(', ') || '(none)');

  let pass = true;

  if (hp.received() !== 0) {
    pass = false;
    console.log('FAIL: HP device received ' + hp.received() + ' bytes on 9100 (would print)');
  } else {
    console.log('PASS: HP device received 0 bytes on 9100');
  }

  if (unknownDev.received() !== 0) {
    pass = false;
    console.log('FAIL: unknown device received ' + unknownDev.received() + ' bytes on 9100');
  } else {
    console.log('PASS: unknown device received 0 bytes on 9100');
  }

  const z = list.find(function (p) { return p.ip === ZEBRA_IP; });
  if (z && z.model === 'ZT510' && z.density === '8dpmm' && zebra.received() > 0) {
    console.log('PASS: Zebra discovered correctly (model ' + z.model + ', ' + z.density + ', ' + zebra.received() + ' bytes sent)');
  } else {
    pass = false;
    console.log('FAIL: Zebra device not discovered correctly');
  }

  if (list.length !== 1) {
    pass = false;
    console.log('FAIL: expected exactly 1 result, got ' + list.length);
  } else {
    console.log('PASS: scan returned exactly 1 device (Zebra only)');
  }

  hp.close(); unknownDev.close(); zebra.close(); hpWeb.close(); zebraWeb.close();
  process.exit(pass ? 0 : 1);
})().catch(function (e) { console.error('ERROR:', e); process.exit(1); });

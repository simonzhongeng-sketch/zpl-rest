// Movable mock Zebra printer for testing the automatic rebind (DHCP address
// change) WITHOUT ever touching a real device:
//   node test/mock_zebra_movable.js <ip> [serial]
// Listens on the given loopback IP (on Windows the whole 127.0.0.0/8 range is
// local, so 127.0.0.1 -> 127.0.0.2 simulates the printer "moving"):
//   - TCP 9100: answers Zebra SGD getvar requests (product_name, head dpi,
//     serial_number, unique_id) on its own connection, like a real Zebra
//   - HTTP 80/631/8080 (whichever ports bind): a web page that identifies the
//     device as Zebra, required by the discovery vendor check
// Run it on 127.0.0.1, stop it, run it again on 127.0.0.2 with the same
// serial to simulate the printer coming up at a new DHCP address.

const net = require('net');
const http = require('http');

const ip = process.argv[2] || '127.0.0.1';
const serial = process.argv[3] || 'MOCKZEBRA0001';
const model = 'ZT510';
const dpi = '203';

const SGD_ANSWERS = {
  'device.product_name': model,
  'device.head.resolution.in_dpi': dpi,
  'device.serial_number': serial,
  'device.unique_id': serial
};

// raw 9100: SGD getvar in, one answer line out; printed ZPL only logged
net.createServer(function (socket) {
  socket.on('data', function (chunk) {
    const text = chunk.toString();
    const m = text.match(/! U1 getvar "([^"]+)"/);
    if (m) {
      socket.write((SGD_ANSWERS[m[1]] || '') + '\n');
      return;
    }
    if (!text.trim()) return;
    const fds = (text.match(/\^FD([^\^]*)/g) || []).map(s => s.slice(3).trim());
    console.log('[' + ip + ':9100] printed job, ^FD=' + fds.join('|'));
    socket.write('\x02\x06\x01\x01\x00\x00'); // printer status reply
  });
  socket.on('error', function () {});
}).listen(9100, ip, function () {
  console.log('mock zebra tcp on ' + ip + ':9100 serial=' + serial);
});

// identification page: contains the "zebra" keyword and no conflicting
// vendor keyword, so the discovery HTTP vendor check confirms the device
const PAGE = '<html><head><title>Zebra Technologies - ZTC ' + model + '-' + dpi + 'dpi ZPL</title></head>'
  + '<body>zebra printer home page, serial ' + serial + '</body></html>';

[80, 631, 8080].forEach(function (port) {
  const srv = http.createServer(function (req, res) {
    res.writeHead(200, {'Content-Type': 'text/html'});
    res.end(PAGE);
  });
  srv.on('error', function (e) {
    console.log('mock zebra http ' + ip + ':' + port + ' unavailable (' + e.code + '), skipped');
  });
  srv.listen(port, ip, function () {
    console.log('mock zebra http on ' + ip + ':' + port);
  });
});

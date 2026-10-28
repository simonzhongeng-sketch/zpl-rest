// Mock Zebra printer: listens on TCP 9100 + HTTP 8080 (vendor identification).
// - HTTP 8080: serves a page that identifies the device as Zebra (like the
//   real Zebra web UI), used by the discovery pre-check
// - TCP 9100: answers ZPL SGD getvar queries like a real ZT510 (discovery)
//   and receives ZPL print jobs, logging them to mock_printer_received.txt
const net = require('net');
const http = require('http');
const fs = require('fs');

const MODEL = 'ZT510';
const DPI = '203';
const logFile = __dirname + '/mock_printer_received.txt';

const server = net.createServer(function (socket) {
  console.log(new Date().toISOString() + ' connection from ' + socket.remoteAddress + ':' + socket.remotePort);
  socket.on('data', function (chunk) {
    const text = chunk.toString();
    // answer SGD getvar queries
    const m = text.match(/! U1 getvar "([^"]+)"/);
    if (m) {
      if (m[1] === 'device.product_name') {
        socket.write(MODEL + '\n');
      } else if (m[1] === 'device.head.resolution.in_dpi') {
        socket.write(DPI + '\n');
      } else {
        socket.write('\n');
      }
      return;
    }
    // regular print data
    if (text.trim()) {
      fs.appendFileSync(logFile, '=== ' + new Date().toISOString() + ' ===\n' + text + '\n');
      console.log('received ' + chunk.length + ' bytes:\n' + text);
      socket.write('\x02\x06\x01\x01\x00\x00');
    }
  });
  socket.on('error', function () {});
});

server.listen(9100, '0.0.0.0', function () {
  console.log('mock printer (ZT510 @203dpi) listening on 0.0.0.0:9100');
});

// vendor identification page, like the ZebraLink web UI
const web = http.createServer(function (req, res) {
  res.writeHead(200, { 'Content-Type': 'text/html', 'Server': 'Zebra-Http-Server' });
  res.end('<html><head><title>Zebra Technologies - ' + MODEL + '</title></head>' +
    '<body><h1>Zebra Technologies</h1><p>Printer model: ' + MODEL + ', ' + DPI + ' dpi</p></body></html>');
});

web.listen(8080, '0.0.0.0', function () {
  console.log('mock printer web UI listening on 0.0.0.0:8080');
});

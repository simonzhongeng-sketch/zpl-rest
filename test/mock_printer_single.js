// Single mock printer on an arbitrary port: node test/mock_printer_single.js 9999
const net = require('net');
const port = parseInt(process.argv[2], 10) || 9300;

net.createServer(function (socket) {
  socket.on('data', function (chunk) {
    const text = chunk.toString();
    if (/! U1 getvar/.test(text)) { socket.write('ZT510\n'); return; }
    if (!text.trim()) return;
    const fds = (text.match(/\^FD([^\^]*)/g) || []).map(s => s.slice(3).trim());
    console.log('[' + port + '] ' + new Date().toISOString() + ' received, ^FD=' + fds.join('|'));
    socket.write('\x02\x06\x01\x01\x00\x00');
  });
  socket.on('error', function () {});
}).listen(port, '127.0.0.1', function () {
  console.log('mock printer listening on 127.0.0.1:' + port);
});

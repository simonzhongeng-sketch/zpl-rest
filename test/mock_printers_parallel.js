// Three mock printers on 9200/9201/9202, used to prove that jobs for
// DIFFERENT printers run in parallel while one printer stays sequential.
// Every received job is timestamped into mock_parallel.log.
const net = require('net');
const fs = require('fs');

const ports = [9200, 9201, 9202];
const logFile = __dirname + '/mock_parallel.log';
fs.writeFileSync(logFile, '');

ports.forEach(function (port) {
  net.createServer(function (socket) {
    socket.on('data', function (chunk) {
      const text = chunk.toString();
      const query = text.match(/! U1 getvar "([^"]+)"/);
      if (query) {
        socket.write(query[1] === 'device.product_name' ? 'ZT510\n' : '\n');
        return;
      }
      if (!text.trim()) return;
      const fds = (text.match(/\^FD([^\^]*)/g) || []).map(s => s.slice(3).trim());
      fs.appendFileSync(logFile, JSON.stringify({ port: port, at: Date.now(), bytes: chunk.length, fds: fds }) + '\n');
      socket.write('\x02\x06\x01\x01\x00\x00');
    });
    socket.on('error', function () {});
  }).listen(port, '127.0.0.1', function () {
    console.log('mock printer listening on 127.0.0.1:' + port);
  });
});

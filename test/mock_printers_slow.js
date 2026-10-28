// Slow mock printers on 9300/9301/9302: the ack is delayed by 5s so jobs stay
// "in flight" long enough to screenshot the parallel badge on the queue page.
const net = require('net');

[9300, 9301, 9302].forEach(function (port) {
  net.createServer(function (socket) {
    socket.on('data', function (chunk) {
      const text = chunk.toString();
      const query = text.match(/! U1 getvar "([^"]+)"/);
      if (query) {
        socket.write(query[1] === 'device.product_name' ? 'ZT510\n' : '\n');
        return;
      }
      if (!text.trim()) return;
      setTimeout(function () {
        try { socket.write('\x02\x06\x01\x01\x00\x00'); } catch (e) {}
      }, 5000);
    });
    socket.on('error', function () {});
  }).listen(port, '127.0.0.1', function () {
    console.log('slow mock printer on ' + port);
  });
});

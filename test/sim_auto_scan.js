// 复现现场机（SUPCONM0106 / SUPCONM03）的网卡布局，验证 auto 扫描链路
// 用法: node test/sim_auto_scan.js [diag 里的那个 Wi-Fi IP]
// 只做 TCP 探测与 HTTP/SGD 查询，不会打印任何东西。
const os = require('os');
const path = require('path');

const wifiIp = process.argv[2] || '192.168.8.20';
const stub = {
  'Ethernet 3': [{ family: 'IPv4', internal: false, address: '169.254.229.110', netmask: '255.255.0.0', mac: '00:00:00:00:00:01' }],
  'Ethernet 2': [{ family: 'IPv4', internal: false, address: '169.254.188.70', netmask: '255.255.0.0', mac: '00:00:00:00:00:02' }],
  'Ethernet': [{ family: 'IPv4', internal: false, address: '169.254.104.203', netmask: '255.255.0.0', mac: '00:00:00:00:00:03' }],
  'Local Area Connection* 9': [{ family: 'IPv4', internal: false, address: '169.254.75.77', netmask: '255.255.0.0', mac: '00:00:00:00:00:04' }],
  'Local Area Connection* 1': [{ family: 'IPv4', internal: false, address: '169.254.186.192', netmask: '255.255.0.0', mac: '00:00:00:00:00:05' }],
  'Wi-Fi': [{ family: 'IPv4', internal: false, address: wifiIp, netmask: '255.255.255.0', mac: '00:00:00:00:00:06' }],
  'Loopback Pseudo-Interface 1': [{ family: 'IPv4', internal: true, address: '127.0.0.1', netmask: '255.0.0.0', mac: '00:00:00:00:00:00' }]
};
os.networkInterfaces = () => stub;

const d = require(path.join(__dirname, '..', 'lib', 'discover.js'));

// 这段与 main.js 的 auto 分支完全一致
const bases = d.localSubnets().map(s => s.base).slice(0, 3);
console.log('interfaces seen      :', d.localSubnets().map(s => s.name + '=' + s.address).join(', ') || '(none)');
console.log('auto would scan      :', bases.join(',') || '(none)');

if (!bases.length) { console.log('RESULT: auto has nothing to scan -> 400'); process.exit(2); }

const t0 = Date.now();
d.discoverPrintersAll(bases).then(list => {
  console.log('elapsed              :', Date.now() - t0, 'ms');
  console.log('raw results          :', list.length);
  list.forEach(p => console.log('   ', p.ip, '|', p.model || '?', '|', (p.dpi || '?') + 'dpi', '| zebra=' + !!p.is_zebra));
  console.log('last_sweep           :', JSON.stringify(d.getDiag().last_sweep));
  process.exit(0);
}).catch(e => { console.log('ERROR:', e.message); process.exit(1); });

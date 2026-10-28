// 一次性验证脚本：用 SUPCONM0106 的真实网卡布局检验网段选择逻辑
// 布局来自 diag-SUPCONM0106.txt：5 块 169.254 APIPA 网卡 + 1 块 Wi-Fi 192.168.8.20
const os = require('os');
const stub = {
  'Ethernet 3': [{ family: 'IPv4', internal: false, address: '169.254.229.110', netmask: '255.255.0.0', mac: '00:00:00:00:00:01' }],
  'Ethernet 2': [{ family: 'IPv4', internal: false, address: '169.254.188.70', netmask: '255.255.0.0', mac: '00:00:00:00:00:02' }],
  'Ethernet': [{ family: 'IPv4', internal: false, address: '169.254.104.203', netmask: '255.255.0.0', mac: '00:00:00:00:00:03' }],
  'Local Area Connection* 9': [{ family: 'IPv4', internal: false, address: '169.254.75.77', netmask: '255.255.0.0', mac: '00:00:00:00:00:04' }],
  'Local Area Connection* 1': [{ family: 'IPv4', internal: false, address: '169.254.186.192', netmask: '255.255.0.0', mac: '00:00:00:00:00:05' }],
  'Wi-Fi': [{ family: 'IPv4', internal: false, address: '192.168.8.20', netmask: '255.255.255.0', mac: '00:00:00:00:00:06' }],
  'Loopback Pseudo-Interface 1': [{ family: 'IPv4', internal: true, address: '127.0.0.1', netmask: '255.0.0.0', mac: '00:00:00:00:00:00' }]
};
os.networkInterfaces = () => stub;

const path = require('path');
const modPath = path.resolve(process.argv[2] || path.join(__dirname, '..', 'lib', 'discover.js'));
const d = require(modPath);
const list = d.localSubnets();
console.log('module:', modPath);
console.log('candidates in scan order:');
list.forEach((i, n) => console.log('  ' + (n + 1) + '. ' + i.name + ' | ' + i.address + ' | base=' + i.base + ' | rank=' + i.rank + (i.virtual ? ' | virtual' : '')));
console.log('chosen:', d.localSubnet());
console.log('auto would scan:', list.slice(0, 3).map(i => i.base).join(','));

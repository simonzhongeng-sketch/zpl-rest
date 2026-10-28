// 黄色三列小标签对位测试 v2：60mm 卷宽三等分，打网格框测贴纸实际位置
// 用法: node test/calib_yellow_60mm.js [打印机名]
const usb = require('../lib/usb_print.js');

const PRINTER = process.argv[2] || 'ZDesigner ZT510-300dpi ZPL(02)';
const D = 12;                 // 300dpi
const mm = v => Math.round(v * D);

const W = 60, H = 8;          // 卷宽 x 走纸单元高
const CELL = 20;              // 60/3 三等分

const zpl = ['^XA', '^MTT', '^MD-6', '^PR2', '^PW' + mm(W), '^LL' + mm(H), '^LH0,0'];
for (let i = 0; i < 3; i++) {
  zpl.push('^FO' + mm(i * CELL) + ',1^GB' + mm(CELL) + ',' + (mm(H) - 2) + ',2^FS');
  zpl.push('^FO' + (mm(i * CELL) + mm(CELL) / 2 - mm(1.8)) + ',' + mm(1.6) +
           '^A0N,' + mm(3.6) + ',' + mm(3.6) + '^FD' + (i + 1) + '^FS');
}
zpl.push('^PQ1', '^XZ');

usb.sendZpl(PRINTER, zpl.join('\n')).then(r => {
  console.log('printer:', PRINTER);
  console.log('result:', JSON.stringify(r));
  console.log('--- zpl ---');
  console.log(zpl.join('\n'));
});

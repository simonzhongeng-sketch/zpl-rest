// 黄色 3 列小标签对位测试：打一排，画 3 个 22x8mm 候选框
// 用法: node test/calib_yellow_3col.js [卷宽mm] [x1,x2,x3]
const usb = require('../lib/usb_print.js');

const PRINTER = 'ZDesigner ZT510-300dpi ZPL';
const D = 12;                       // 300dpi
const mm = v => Math.round(v * D);

const W = parseFloat(process.argv[2] || '84.8');   // 卷宽
const H = 8;                                       // 单枚贴纸高
const CELL_W = 22;                                 // 单枚贴纸宽
const xs = (process.argv[3] || '2,31.33,60.67').split(',').map(Number);

const zpl = ['^XA', '^MTT', '^MD-6', '^PR2', '^PW' + mm(W), '^LL' + mm(H), '^LH0,0'];
xs.forEach((x, i) => {
  zpl.push('^FO' + mm(x) + ',2^GB' + mm(CELL_W) + ',' + (mm(H) - 4) + ',3^FS');
  zpl.push('^FO' + (mm(x) + mm(CELL_W) / 2 - mm(1.6)) + ',' + mm(1.6) +
           '^A0N,' + mm(3.6) + ',' + mm(3.6) + '^FD' + (i + 1) + '^FS');
});
zpl.push('^PQ1', '^XZ');

usb.sendZpl(PRINTER, zpl.join('\n')).then(r => {
  console.log('result:', JSON.stringify(r));
  console.log('--- zpl ---');
  console.log(zpl.join('\n'));
});

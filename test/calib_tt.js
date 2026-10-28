// 热转印浓度阶梯打样：同一图案以不同 ^MD 偏移打印，供人工目选最佳浓度
'use strict';
const usb = require('../lib/usb_print.js');
// usage: node test/calib_tt.js ["Windows printer name"] ["0,-6,-12,-18"]
const PRINTER = process.argv[2] || 'ZDesigner ZT510-300dpi ZPL';
const MDS = (process.argv[3] || '0,-6,-12,-18').split(',').map(function (v) { return parseInt(v, 10); });

// 图案：大号标记 + 正文字号 + 1dot 细线 + 实心块 + 小字，覆盖糊/虚/断线判读
function pattern(md) {
  const rows = [];
  rows.push('^XA');
  rows.push('^MTT');      // 热转印（色带）
  rows.push('^PR2');      // 2 ips
  rows.push('^MD' + md);  // 相对面板的浓度偏移
  rows.push('^LH0,0');
  rows.push('^FO18,18^A0N,54,54^FDTT MD' + md + '^FS');
  rows.push('^FO18,84^A0N,28,28^FDAgBHjkmn 0123456789 zpl^FS');
  // 1dot 细线三条：糊的话会粘成一条，欠热会断
  rows.push('^FO18,126^GB700,1,1^FS');
  rows.push('^FO18,132^GB700,1,1^FS');
  rows.push('^FO18,138^GB700,1,1^FS');
  rows.push('^FO18,150^GB240,56,56^FS');   // 实心块：看边缘是否外溢
  rows.push('^FO280,150^A0N,20,20^FDsmall 6pt text^FS');
  rows.push('^FO18,222^A0N,18,18^FDhairline above / solid block left^FS');
  rows.push('^PQ1');
  rows.push('^XZ');
  return rows.join('\n');
}

(async function () {
  const mds = MDS;
  for (const md of mds) {
    const r = await usb.sendZpl(PRINTER, pattern(md));
    console.log('MD', md, '->', r.failed ? 'FAIL ' + r.error : 'sent');
    await new Promise(res => setTimeout(res, 1800));
  }
})();

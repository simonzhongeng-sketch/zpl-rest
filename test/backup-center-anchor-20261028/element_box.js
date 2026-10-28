// 元素包围盒（mm）——「元素中心」的唯一定义。
//
// 模板里 template.anchor === 'center' 时，元素的 x_mm / y_mm 是元素**中心**，
// 不再是左上角；编译时按本模块算出的盒尺寸换算成 ZPL 的 ^FO（左上角）。
// 画布（html/js/visual_editor.js 的 elementBoxMm）有一份等价副本——项目没有
// 构建步骤，前后端无法共享模块，改公式必须两边同时改。
//
// 关键性质：换算与编译用同一套公式，所以「旧模板升级成中心坐标」再编译出来的
// ^FO 与升级前逐点相同——盒尺寸估得准不准只影响画得正不正，不影响打印位置。
//
// 尺寸按可打印几何估算，不按字体度量：
//   * text / datetime：^A0N,h,w 的字符格宽 = w（width_mm=0 时等于 h），
//     宽度 = 字符数 × 格宽，高度 = h。占位符 ${var} 按字面长度算（编译发生在
//     变量替换之前）。
//   * barcode(Code128)：每字符 11 模块，加起止/校验约 3 字符，模块宽 = module_dots。
//   * code39：每字符 16 模块，加起止约 4 字符。
//   * qrcode / datamatrix：按 size_mm 取方形边长（符号实际尺寸随数据变化）。
//   * box / line / text_rev / block：直接来自属性。

'use strict';

function num(v, d) {
  v = Number(v);
  return isFinite(v) ? v : d;
}

// 编译期日期戳（编译发生在打印/预览时刻）
function stampText(fmt) {
  var n = new Date();
  function pad(v) { return (v < 10 ? '0' : '') + v; }
  var d = n.getFullYear() + '-' + pad(n.getMonth() + 1) + '-' + pad(n.getDate());
  var t = pad(n.getHours()) + ':' + pad(n.getMinutes());
  if (fmt === 'time') return t;
  if (fmt === 'datetime') return d + ' ' + t;
  return d;
}

// 元素盒尺寸（mm）。dpmm 只影响条码类：模块宽是按点定义的，换算成 mm 要除以
// 该机密度（换打印机时条码物理宽度本来就会变，中心锚点保持不动）。
function boxMm(el, dpmm) {
  var p = (el && el.props) || {};
  var d = num(dpmm, 12) || 12;
  var type = el && el.type;
  var w = 0;
  var h = 0;
  var text;

  switch (type) {
    case 'text':
    case 'datetime': {
      h = num(p.height_mm, 4);
      var cell = num(p.width_mm, 0) > 0 ? num(p.width_mm, 0) : h;
      text = type === 'datetime' ? stampText(p.format) : String(p.content == null ? '' : p.content);
      w = Math.max(cell, text.length * cell);
      break;
    }
    case 'barcode': {
      h = num(p.height_mm, 10);
      var mod = Math.max(1, Math.round(num(p.module_dots, 2)));
      var nbc = String(p.content == null ? '' : p.content).length + 3;
      w = mod * 11 * nbc / d;
      break;
    }
    case 'code39': {
      h = num(p.height_mm, 10);
      var mod39 = Math.max(1, Math.round(num(p.module_dots, 2)));
      var n39 = String(p.content == null ? '' : p.content).length + 4;
      w = mod39 * 16 * n39 / d;
      break;
    }
    case 'qrcode':
    case 'datamatrix': {
      var side = num(p.size_mm, type === 'qrcode' ? 10 : 8);
      w = side;
      h = side;
      break;
    }
    case 'box': {
      w = num(p.width_mm, 10);
      h = num(p.height_mm, 10);
      break;
    }
    case 'line': {
      w = num(p.length_mm, 20);
      h = num(p.thickness_mm, 0.5);
      break;
    }
    case 'text_rev': {
      // 编译器画的黑底宽 = max(字高, width_mm)
      h = num(p.height_mm, 4);
      w = Math.max(h, num(p.width_mm, 25));
      break;
    }
    case 'block': {
      w = num(p.width_mm, 30);
      h = num(p.height_mm, 3) * Math.max(1, Math.round(num(p.lines, 2)));
      break;
    }
    default:
      w = 0;
      h = 0;
  }

  return { w: Math.max(0, w), h: Math.max(0, h) };
}

// 是否 90/270 度旋转：ZPL 里字段在 ^FO 处互换宽高，中心换算也要跟着换，
// 否则转过的元素会整体偏半个盒
function swapped(el) {
  var r = (el && el.props && el.props.rotation) || 'N';
  return r === 'R' || r === 'B';
}

// 中心 + 盒 → ^FO 用的左上角（mm）
function toTopLeft(el, dpmm) {
  var p = (el && el.props) || {};
  var b = boxMm(el, dpmm);
  var halfW = (swapped(el) ? b.h : b.w) / 2;
  var halfH = (swapped(el) ? b.w : b.h) / 2;
  return { x: num(p.x_mm, 0) - halfW, y: num(p.y_mm, 0) - halfH };
}

// 左上角 → 中心（旧模板升级 / 画布反向换算），保留 2 位小数
function toCenter(el, dpmm) {
  var p = (el && el.props) || {};
  var b = boxMm(el, dpmm);
  var halfW = (swapped(el) ? b.h : b.w) / 2;
  var halfH = (swapped(el) ? b.w : b.h) / 2;
  return {
    x: Math.round((num(p.x_mm, 0) + halfW) * 100) / 100,
    y: Math.round((num(p.y_mm, 0) + halfH) * 100) / 100
  };
}

module.exports = {
  boxMm: boxMm,
  toTopLeft: toTopLeft,
  toCenter: toCenter,
  stampText: stampText
};

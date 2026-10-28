// ZPL compiler: visual label template (JSON, all sizes in mm) -> ZPL.
// The template is compiled per printer density (dpmm) at print/preview time,
// following the project convention: design in mm, convert to dots by density.

'use strict';

// page geometry (^PW / ^LL / ^LH) of the template
var pageGeometry = require('./page_geometry.js');
// 元素包围盒：template.anchor === 'center' 时 x_mm/y_mm 是元素中心
var elementBox = require('./element_box.js');

function dot(mm, dpmm) {
  return Math.round(mm * dpmm);
}

// valid ZPL field rotations: N=0, R=90, I=180, B=270
var ROTS = { N: 1, R: 1, I: 1, B: 1 };
function rot(p) {
  return ROTS[p && p.rotation] ? p.rotation : 'N';
}

// compile-time date/time stamp for the datetime element (compile happens at
// print/preview time, so the stamp reflects the moment of printing)
function formatStamp(fmt) {
  var n = new Date();
  function pad(v) { return (v < 10 ? '0' : '') + v; }
  var d = n.getFullYear() + '-' + pad(n.getMonth() + 1) + '-' + pad(n.getDate());
  var t = pad(n.getHours()) + ':' + pad(n.getMinutes());
  if (fmt === 'time') return t;
  if (fmt === 'datetime') return d + ' ' + t;
  return d;
}

// compile a single element; el = { type, id, props: {...} }
// anchor === 'center': x_mm/y_mm 是元素中心，这里换算成 ^FO 的左上角；
// 其它值（旧模板没有 anchor 字段）沿用左上角语义，老标签输出逐字节不变。
function compileElement(el, dpmm, anchor) {
  var p = el.props || {};
  var origin = anchor === 'center' ? elementBox.toTopLeft(el, dpmm) : { x: p.x_mm || 0, y: p.y_mm || 0 };
  var x = dot(origin.x, dpmm);
  var y = dot(origin.y, dpmm);
  var r = rot(p);
  var out = '';

  switch (el.type) {
    case 'text': {
      var h = Math.max(1, dot(p.height_mm || 4, dpmm));
      var w = Math.max(0, dot(p.width_mm || 0, dpmm)); // 0 = proportional to height
      out = '^FO' + x + ',' + y + '^A0' + r + ',' + h + ',' + (w > 0 ? w : h) + '^FD' + (p.content || '') + '^FS\n';
      break;
    }
    case 'barcode': {
      var bh = Math.max(1, dot(p.height_mm || 10, dpmm));
      var mod = Math.max(1, Math.round(p.module_dots || 2));
      out = '^BY' + mod + ',3,' + bh + '\n' +
            '^FO' + x + ',' + y + '^BC' + r + ',' + bh + ',Y,N,N\n' +
            '^FD' + (p.content || '') + '^FS\n';
      break;
    }
    case 'qrcode': {
      // mag = module size in dots: bigger modules survive thermal dot gain
      // (small modules bleed into each other and look blurry)
      var mag = Math.max(1, Math.min(10, Math.round(((p.size_mm || 10) * dpmm) / 25)));
      // ^FD <ecc><mode>,<data>: ecc L=7% M=15% Q=25% H=30%. M is the default
      // because a slightly bled QR with L stops scanning, with M it survives.
      var ecc = String(p.ecc || 'M').toUpperCase();
      if ('HQML'.indexOf(ecc) === -1) ecc = 'M';
      out = '^FO' + x + ',' + y + '^BQ' + r + ',2,' + mag + '\n^FD' + ecc + 'A,' + (p.content || '') + '^FS\n';
      break;
    }
    case 'box': {
      var w = Math.max(1, dot(p.width_mm || 10, dpmm));
      var bh2 = Math.max(1, dot(p.height_mm || 10, dpmm));
      var t = Math.max(1, dot(p.thickness_mm || 0.5, dpmm));
      out = '^FO' + x + ',' + y + '^GB' + w + ',' + bh2 + ',' + t + '^FS\n';
      break;
    }
    case 'line': {
      var len = Math.max(1, dot(p.length_mm || 20, dpmm));
      var t2 = Math.max(1, dot(p.thickness_mm || 0.5, dpmm));
      out = '^FO' + x + ',' + y + '^GB' + len + ',' + t2 + ',' + t2 + '^FS\n';
      break;
    }
    case 'datamatrix': {
      // ^BXN,magnification: approximate magnification from the wanted size
      // (symbol size depends on the payload, so this stays an approximation)
      var mag = Math.max(1, Math.min(10, Math.round(((p.size_mm || 8) * dpmm) / 22)));
      out = '^FO' + x + ',' + y + '^BX' + r + ',' + mag + ',200\n^FD' + (p.content || '') + '^FS\n';
      break;
    }
    case 'code39': {
      var bh39 = Math.max(1, dot(p.height_mm || 10, dpmm));
      var mod39 = Math.max(1, Math.round(p.module_dots || 2));
      out = '^BY' + mod39 + ',3,' + bh39 + '\n' +
            '^FO' + x + ',' + y + '^B3' + r + ',' + bh39 + ',Y,N,N\n' +
            '^FD' + (p.content || '') + '^FS\n';
      break;
    }
    case 'text_rev': {
      var hr = Math.max(1, dot(p.height_mm || 4, dpmm));
      var wr = Math.max(hr, dot(p.width_mm || 25, dpmm));
      // solid black box, then reversed (white) text on top
      out = '^FO' + x + ',' + y + '^GB' + wr + ',' + hr + ',' + hr + '^FS\n' +
            '^FO' + x + ',' + y + '^A0' + r + ',' + hr + ',' + hr + '^FR^FD' + (p.content || '') + '^FS\n';
      break;
    }
    case 'datetime': {
      var hd = Math.max(1, dot(p.height_mm || 4, dpmm));
      var wd = Math.max(0, dot(p.width_mm || 0, dpmm));
      out = '^FO' + x + ',' + y + '^A0' + r + ',' + hd + ',' + (wd > 0 ? wd : hd) + '^FD' + formatStamp(p.format) + '^FS\n';
      break;
    }
    case 'block': {
      var hb = Math.max(1, dot(p.height_mm || 3, dpmm));
      var wb = Math.max(1, dot(p.width_mm || 30, dpmm));
      var lines = Math.max(1, Math.round(p.lines || 2));
      out = '^FO' + x + ',' + y + '^A0' + r + ',' + hb + ',' + hb + '^FB' + wb + ',' + lines + ',0,L,0\n^FD' + (p.content || '') + '^FS\n';
      break;
    }
    default:
      out = '';
  }
  return out;
}

// compile the whole template; template = { elements: [...], print_settings: {...} }
// settingsOverride (optional) replaces template.print_settings — used when the
// printer record carries its own settings (printer-level configuration wins)
// opts (optional) { repeatCols, stepMm, rowWidthMm }: the whole template is
// repeated horizontally, once per label of a multi-up row. Used for media that
// was designed as a single label (e.g. 22mm wide) while the roll carries three
// of them side by side.
// opts.widthMm / opts.heightMm (optional): the physical label size. When given,
// ^PW/^LL are emitted so the printer stops using its own calibrated length
// (that mismatch is what made printed labels drift 1-2mm per label).
function compile(template, dpmm, settingsOverride, opts) {
  dpmm = dpmm || 8;
  opts = opts || {};
  var ps = settingsOverride || template.print_settings || {};
  var cols = Math.max(1, parseInt(opts.repeatCols, 10) || 1);
  var stepMm = Number(opts.stepMm) || 0;
  var zpl = '^XA\n';
  if (ps.mode === 'direct_thermal') zpl += '^MTD\n';
  else if (ps.mode === 'thermal_transfer') zpl += '^MTT\n';
  if (typeof ps.darkness === 'number' && ps.darkness !== 0) zpl += '^MD' + ps.darkness + '\n';
  if (typeof ps.speed === 'number' && ps.speed > 0) zpl += '^PR' + ps.speed + '\n';

  // ---- page geometry: ^PW / ^LL / ^LH, once per format, before the first ^FO
  // ^PW priority: page.roll_width_mm (physical roll) > multi-up row width >
  // single label width. A multi-up row must never fall back to the label width:
  // that clips the 2nd/3rd column. Callers that pass no widthMm/heightMm (older
  // unit tests) get the legacy output byte for byte.
  var page = pageGeometry.normalizePage(template.page);
  var widthMm = Number(opts.widthMm) || 0;
  var heightMm = Number(opts.heightMm) || 0;
  var pwMm = page.roll_width_mm ||
             (cols > 1 && Number(opts.rowWidthMm) > 0 ? Number(opts.rowWidthMm) : widthMm);
  if (pwMm > 0) zpl += '^PW' + dot(pwMm, dpmm) + '\n';
  if (heightMm > 0) zpl += '^LL' + dot(heightMm, dpmm) + '\n';
  // print position fine adjustment: printer base origin (media loading of
  // that machine) + left/top margin + offset, clamped in mm, rounded to dots
  // once, emitted as the single ^LH of this format (never added to the element
  // coordinates: per-element rounding would jitter the columns of a multi-up
  // row by ±1 dot)
  var lh = pageGeometry.originDots(page, dpmm, widthMm || 84.8, heightMm || 23.8, opts.baseOriginMm);
  zpl += '^LH' + lh.x + ',' + lh.y + '\n';

  var els = template.elements || [];
  var anchor = template.anchor === 'center' ? 'center' : 'topleft';
  for (var c = 0; c < cols; c++) {
    for (var i = 0; i < els.length; i++) {
      var el = els[i];
      if (c > 0) el = shiftElement(el, stepMm * c);
      zpl += compileElement(el, dpmm, anchor);
    }
  }

  var qty = (typeof ps.quantity === 'number' && ps.quantity > 0) ? ps.quantity : 1;
  zpl += '^PQ' + qty + '\n^XZ\n';
  return zpl;
}

// copy of an element moved dxMm to the right (used when a single-label design
// is repeated across a multi-up row)
function shiftElement(el, dxMm) {
  var props = {};
  var src = el.props || {};
  for (var k in src) { if (Object.prototype.hasOwnProperty.call(src, k)) props[k] = src[k]; }
  props.x_mm = Number(props.x_mm || 0) + dxMm;
  var out = {};
  for (var e in el) { if (Object.prototype.hasOwnProperty.call(el, e)) out[e] = el[e]; }
  out.props = props;
  return out;
}

// collect all ${variable} placeholders used in element contents
var VAR_REG = /\$\{([^}]+)\}/g;
function collectVariables(template) {
  var vars = [];
  (template.elements || []).forEach(function (el) {
    var c = (el.props || {}).content;
    if (typeof c !== 'string') return;
    var m;
    VAR_REG.lastIndex = 0;
    while ((m = VAR_REG.exec(c)) !== null) {
      if (vars.indexOf(m[1]) === -1) vars.push(m[1]);
    }
  });
  return vars;
}

module.exports = {
  compile: compile,
  compileElement: compileElement,
  collectVariables: collectVariables
};

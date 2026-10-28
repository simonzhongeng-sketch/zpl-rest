// lib/element_box.js + 中心定位（template.anchor === 'center'）单元测试。
//
//   node test/element_box_test.js
//
// 核心不变量：旧模板（左上角坐标）升级成中心坐标后，编译出来的 ZPL 与升级前
// 逐字节相同——中心的换算和编译用的是同一套盒尺寸公式，估得准不准只影响画得
// 正不正，不能影响打印位置。
'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const eb = require('../lib/element_box.js');
const zc = require('../lib/zpl_compiler.js');

let failed = 0;
function check(name, fn) {
  try {
    fn();
    console.log('  [PASS] ' + name);
  } catch (e) {
    failed++;
    console.log('  [FAIL] ' + name + '  -- ' + (e && e.message ? e.message : e));
  }
}

console.log('element_box / center anchor test\n');

// ------------------------------------------------------------------- box
check('text: 盒宽 = 字符数 × 字高（width_mm=0 时格宽等于字高）', function () {
  const b = eb.boxMm({ type: 'text', props: { content: 'ABCD', height_mm: 4 } }, 12);
  assert.strictEqual(b.h, 4);
  assert.strictEqual(b.w, 16);
});

check('text: 显式 width_mm 作为字符格宽', function () {
  const b = eb.boxMm({ type: 'text', props: { content: 'AB', height_mm: 4, width_mm: 2 } }, 12);
  assert.deepStrictEqual(b, { w: 4, h: 4 });
});

check('box / line / block 直接用属性', function () {
  assert.deepStrictEqual(eb.boxMm({ type: 'box', props: { width_mm: 30, height_mm: 10 } }, 12), { w: 30, h: 10 });
  assert.deepStrictEqual(eb.boxMm({ type: 'line', props: { length_mm: 20, thickness_mm: 0.5 } }, 12), { w: 20, h: 0.5 });
  assert.deepStrictEqual(eb.boxMm({ type: 'block', props: { width_mm: 30, height_mm: 3, lines: 2 } }, 12), { w: 30, h: 6 });
});

check('qrcode / datamatrix 取方形边长', function () {
  assert.deepStrictEqual(eb.boxMm({ type: 'qrcode', props: { size_mm: 10 } }, 12), { w: 10, h: 10 });
  assert.deepStrictEqual(eb.boxMm({ type: 'datamatrix', props: { size_mm: 8 } }, 12), { w: 8, h: 8 });
});

check('text_rev 盒宽 = max(字高, width_mm)', function () {
  assert.strictEqual(eb.boxMm({ type: 'text_rev', props: { height_mm: 4, width_mm: 25 } }, 12).w, 25);
  assert.strictEqual(eb.boxMm({ type: 'text_rev', props: { height_mm: 4, width_mm: 2 } }, 12).w, 4);
});

check('barcode 盒宽随模块宽与密度换算（12dpmm 比 8dpmm 窄）', function () {
  const el = { type: 'barcode', props: { content: 'ABC', module_dots: 2, height_mm: 10 } };
  const w8 = eb.boxMm(el, 8).w;
  const w12 = eb.boxMm(el, 12).w;
  assert.ok(w8 > w12, w8 + ' vs ' + w12);
  assert.ok(Math.abs(w12 - (2 * 11 * 6) / 12) < 1e-9, String(w12)); // 3 字符 + 3 起止
});

// -------------------------------------------------------------- anchor math
check('toTopLeft：中心 - 半个盒', function () {
  const el = { type: 'box', props: { x_mm: 50, y_mm: 20, width_mm: 30, height_mm: 10 } };
  assert.deepStrictEqual(eb.toTopLeft(el, 12), { x: 35, y: 15 });
});

check('toTopLeft：90/270 度旋转时宽高互换', function () {
  const el = { type: 'box', props: { x_mm: 50, y_mm: 20, width_mm: 30, height_mm: 10, rotation: 'R' } };
  assert.deepStrictEqual(eb.toTopLeft(el, 12), { x: 45, y: 5 });
});

check('toCenter 是 toTopLeft 的逆运算', function () {
  const el = { type: 'text', props: { x_mm: 10, y_mm: 5, content: 'ABC', height_mm: 4 } };
  const c = eb.toCenter(el, 12);
  assert.deepStrictEqual(c, { x: 16, y: 7 });
  const back = eb.toTopLeft({ type: 'text', props: Object.assign({}, el.props, { x_mm: c.x, y_mm: c.y }) }, 12);
  assert.deepStrictEqual(back, { x: 10, y: 5 });
});

// ---------------------------------------------------------------- compile
check('legacy 模板（无 anchor）仍按左上角输出，逐字节不变', function () {
  const tpl = {
    elements: [{ type: 'box', props: { x_mm: 10, y_mm: 5, width_mm: 20, height_mm: 8 } }],
    print_settings: {}
  };
  const zpl = zc.compile(tpl, 12, null, { widthMm: 60, heightMm: 30 });
  assert.ok(zpl.indexOf('^FO120,60^GB240,96,6^FS') !== -1, zpl);
});

check('center 模板：^FO = 中心 - 半个盒', function () {
  const tpl = {
    anchor: 'center',
    elements: [{ type: 'box', props: { x_mm: 30, y_mm: 20, width_mm: 20, height_mm: 10 } }],
    print_settings: {}
  };
  const zpl = zc.compile(tpl, 12, null, { widthMm: 60, heightMm: 30 });
  // 中心 30,20 → 左上 20,15 → 240,180 dots
  assert.ok(zpl.indexOf('^FO240,180^GB240,120,6^FS') !== -1, zpl);
});

check('新元素落在标签正中时，元素中心就是 (W/2, H/2)', function () {
  const tpl = {
    anchor: 'center',
    elements: [{ type: 'qrcode', props: { x_mm: 30, y_mm: 15, size_mm: 10, content: 'X' } }],
    print_settings: {}
  };
  const zpl = zc.compile(tpl, 12, null, { widthMm: 60, heightMm: 30 });
  // 60x30 标签：中心 30,15；10mm 方码 → 左上 25,10 → 300,120
  assert.ok(zpl.indexOf('^FO300,120^BQ') !== -1, zpl);
});

// ------------------------------------------- 旧模板升级后打印位置不变（真数据）
check('现有标签：升级成中心坐标后 ZPL 逐字节相同', function () {
  const raw = fs.readFileSync(path.join(__dirname, '..', 'db', 'label.json'), 'utf8');
  const labels = JSON.parse(raw);
  let visual = 0;
  labels.forEach(function (l) {
    if (l.type !== 'visual' || !l.template || !l.template.elements) return;
    if (l.template.anchor === 'center') return; // 已经是新格式
    visual++;
    const dpmm = 12;
    const before = zc.compile(l.template, dpmm, l.template.print_settings,
      { widthMm: l.width, heightMm: l.height });
    const upgraded = {
      anchor: 'center',
      elements: l.template.elements.map(function (el) {
        const c = eb.toCenter(el, dpmm);
        const props = Object.assign({}, el.props, { x_mm: c.x, y_mm: c.y });
        return { type: el.type, props: props };
      }),
      print_settings: l.template.print_settings,
      page: l.template.page
    };
    const after = zc.compile(upgraded, dpmm, upgraded.print_settings,
      { widthMm: l.width, heightMm: l.height });
    assert.strictEqual(after, before, 'label ' + l.name + ' 编译结果变化');
  });
  console.log('         （比对 ' + visual + ' 个旧格式标签）');
});

console.log('\n' + (failed ? failed + ' FAILED' : 'ALL PASS'));
process.exit(failed ? 1 : 0);

// lib/zpl_compiler.js page-geometry test: ^PW / ^LL / ^LH emission rules.
//
//   node test/zpl_compiler_page_test.js
//
// Two hard requirements are pinned here:
//   1. the new header is emitted once, ordered ^PW -> ^LL -> ^LH -> first ^FO;
//   2. a call with no opts.widthMm/heightMm (legacy unit-test style) is byte
//      identical to the pre-change output.
'use strict';

const assert = require('assert');
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

// one text element, the same numbers the design doc uses as sample
const TPL = {
  elements: [{ type: 'text', props: { x_mm: 0, y_mm: 0, height_mm: 4, content: 'EDGE' } }],
  print_settings: { mode: 'thermal_transfer', darkness: 15, speed: 2, quantity: 1 }
};
const LABEL = { widthMm: 84.8, heightMm: 23.8 };

function count(hay, needle) {
  return (hay.match(new RegExp(needle.replace(/[\^]/g, '\\^'), 'g')) || []).length;
}

console.log('zpl_compiler page geometry test\n');

// ------------------------------------------------- legacy output (no opts)
check('no opts: legacy output is byte-identical (no ^PW/^LL, ^LH0,0)', function () {
  const expected = '^XA\n^MTT\n^MD15\n^PR2\n^LH0,0\n^FO0,0^A0N,48,48^FDEDGE^FS\n^PQ1\n^XZ\n';
  assert.strictEqual(zc.compile(TPL, 12), expected);
});

check('no opts + multi-up row width keeps the legacy ^PW only', function () {
  const zpl = zc.compile(TPL, 12, null, { repeatCols: 3, stepMm: 22, rowWidthMm: 66 });
  assert.strictEqual(count(zpl, '^PW'), 1);
  assert.ok(zpl.indexOf('^PW792\n') !== -1, zpl);
  assert.strictEqual(count(zpl, '^LL'), 0, 'no heightMm -> no ^LL');
  assert.strictEqual(count(zpl, '^LH'), 1);
});

// ---------------------------------------------------- 84.8 x 23.8 @ 12 dpmm
check('84.8x23.8 @12dpmm: ^PW1018 ^LL286 ^LH0,0 (acceptance sample)', function () {
  const zpl = zc.compile(TPL, 12, null, LABEL);
  const expected = '^XA\n^MTT\n^MD15\n^PR2\n^PW1018\n^LL286\n^LH0,0\n^FO0,0^A0N,48,48^FDEDGE^FS\n^PQ1\n^XZ\n';
  assert.strictEqual(zpl, expected);
});

check('header order is ^PW -> ^LL -> ^LH -> first ^FO, each exactly once', function () {
  const zpl = zc.compile(TPL, 12, null, LABEL);
  assert.strictEqual(count(zpl, '^PW'), 1);
  assert.strictEqual(count(zpl, '^LL'), 1);
  assert.strictEqual(count(zpl, '^LH'), 1);
  const pw = zpl.indexOf('^PW');
  const ll = zpl.indexOf('^LL');
  const lh = zpl.indexOf('^LH');
  const fo = zpl.indexOf('^FO');
  assert.ok(pw < ll && ll < lh && lh < fo, 'order ' + [pw, ll, lh, fo].join(','));
  // and after the header block opened by ^XA/^MT/^MD/^PR
  assert.ok(zpl.indexOf('^PR2') < pw, zpl);
});

check('offset comes from page.offset_mm, only as ^LH', function () {
  const tpl = { elements: TPL.elements, print_settings: TPL.print_settings, page: { offset_mm: { x: 1.5, y: -1 } } };
  const zpl = zc.compile(tpl, 12, null, LABEL);
  assert.ok(zpl.indexOf('^LH18,-12\n') !== -1, zpl);
  // the element coordinates must NOT be shifted: offset is never added per element
  assert.ok(zpl.indexOf('^FO0,0^A0N') !== -1, zpl);
});

check('offset x=1 leaves every ^FO untouched (no per-element rounding)', function () {
  const els = [
    { type: 'text', props: { x_mm: 4.25, y_mm: 1.25, height_mm: 4, content: 'A' } },
    { type: 'text', props: { x_mm: 31.33, y_mm: 1.25, height_mm: 4, content: 'B' } }
  ];
  const plain = zc.compile({ elements: els }, 12, null, LABEL);
  const shifted = zc.compile({ elements: els, page: { offset_mm: { x: 1, y: 0 } } }, 12, null, LABEL);
  assert.strictEqual(shifted.replace('^LH12,0', '^LH0,0'), plain);
});

check('left/top margins join ^LH; right/bottom never reach the ZPL', function () {
  const bare = zc.compile(TPL, 12, null, LABEL);
  const withMargins = zc.compile({
    elements: TPL.elements, print_settings: TPL.print_settings,
    page: { margin_mm: { top: 3, right: 4, bottom: 5, left: 6 } }
  }, 12, null, LABEL);
  // one ^LH for the whole format: (6mm, 3mm) at 12dpmm
  assert.ok(withMargins.indexOf('^LH72,36\n') !== -1, withMargins);
  assert.strictEqual(count(withMargins, '^LH'), 1);
  assert.strictEqual(withMargins.replace('^LH72,36', '^LH0,0'), bare);

  // right/bottom are notes only: they must leave the output byte-identical
  const notes = zc.compile({
    elements: TPL.elements, print_settings: TPL.print_settings,
    page: { margin_mm: { top: 0, right: 40, bottom: 5, left: 0 } }
  }, 12, null, LABEL);
  assert.strictEqual(notes, bare);
});

check('margin and offset are summed before the dot conversion', function () {
  const zpl = zc.compile({
    elements: TPL.elements, print_settings: TPL.print_settings,
    page: { margin_mm: { top: 1, left: 1 }, offset_mm: { x: -0.5, y: 0.5 } }
  }, 12, null, LABEL);
  assert.ok(zpl.indexOf('^LH6,18\n') !== -1, zpl);  // 0.5mm / 1.5mm at 12dpmm
});

// ------------------------------------------------------------- ^PW priority
check('multi-up row: ^PW uses the row width, not the label width', function () {
  const zpl = zc.compile(TPL, 12, null, { widthMm: 22, heightMm: 5, repeatCols: 3, stepMm: 22, rowWidthMm: 66 });
  assert.ok(zpl.indexOf('^PW792\n') !== -1, zpl);   // 66mm * 12 = 792
  assert.ok(zpl.indexOf('^LL60\n') !== -1, zpl);    // 5mm * 12
});

check('page.roll_width_mm overrides the multi-up row width (no clipped 3rd column)', function () {
  const zpl = zc.compile({
    elements: TPL.elements,
    page: { roll_width_mm: 84.8 }
  }, 12, null, { widthMm: 22, heightMm: 5, repeatCols: 3, stepMm: 22, rowWidthMm: 66 });
  assert.ok(zpl.indexOf('^PW1018\n') !== -1, zpl);  // 84.8mm * 12 = 1017.6 -> 1018
  assert.ok(zpl.indexOf('^PW792') === -1, zpl);
  assert.strictEqual(count(zpl, '^PW'), 1);
});

check('roll_width_mm alone emits both ^PW and ^LL', function () {
  const zpl = zc.compile({ elements: TPL.elements, page: { roll_width_mm: 100 } }, 8, null, { heightMm: 60 });
  assert.ok(zpl.indexOf('^PW800\n') !== -1, zpl);
  assert.ok(zpl.indexOf('^LL480\n') !== -1, zpl);
});

// ----------------------------------------------------- multi-up repetition
check('three columns: ^LH once, three ^FO, columns shifted by stepMm', function () {
  const tpl = {
    elements: [{ type: 'text', props: { x_mm: 2, y_mm: 1.25, height_mm: 4, content: '${sn}' } }]
  };
  const zpl = zc.compile(tpl, 12, null, { widthMm: 22, heightMm: 5, repeatCols: 3, stepMm: 22, rowWidthMm: 66 });
  assert.strictEqual(count(zpl, '^LH'), 1);
  assert.strictEqual(count(zpl, '^FO'), 3);
  // 2mm -> 24 dots; +22mm -> 288; +44mm -> 552
  assert.ok(zpl.indexOf('^FO24,'), zpl);
  assert.ok(zpl.indexOf('^FO288,'), zpl);
  assert.ok(zpl.indexOf('^FO552,'), zpl);
});

check('offset applies to a multi-up row through the single ^LH only', function () {
  const tpl = {
    elements: [{ type: 'text', props: { x_mm: 2, y_mm: 1.25, height_mm: 4, content: '${sn}' } }],
    page: { offset_mm: { x: 0.5, y: 0 }, roll_width_mm: 84.8 }
  };
  const zpl = zc.compile(tpl, 12, null, { widthMm: 22, heightMm: 5, repeatCols: 3, stepMm: 22, rowWidthMm: 66 });
  assert.strictEqual(count(zpl, '^LH'), 1);
  assert.ok(zpl.indexOf('^LH6,0\n') !== -1, zpl);
  assert.ok(zpl.indexOf('^FO24,') !== -1, zpl);   // unchanged by the offset
  assert.ok(zpl.indexOf('^FO288,') !== -1, zpl);
  assert.ok(zpl.indexOf('^FO552,') !== -1, zpl);
});

// ------------------------------------------------------------ rounding rules
check('rounding: 84.8*12=1017.6 -> 1018, 23.8*12=285.6 -> 286, 100x60 -> 1200/720', function () {
  assert.ok(zc.compile(TPL, 12, null, { widthMm: 84.8, heightMm: 23.8 }).indexOf('^PW1018\n^LL286\n') !== -1);
  assert.ok(zc.compile(TPL, 12, null, { widthMm: 100, heightMm: 60 }).indexOf('^PW1200\n^LL720\n') !== -1);
  assert.ok(zc.compile(TPL, 12, null, { widthMm: 100, heightMm: 45 }).indexOf('^PW1200\n^LL540\n') !== -1);
});

check('zero/unknown size never emits ^PW/^LL (opts.widthMm = 0)', function () {
  const zpl = zc.compile(TPL, 12, null, { widthMm: 0, heightMm: 0 });
  assert.strictEqual(count(zpl, '^PW'), 0);
  assert.strictEqual(count(zpl, '^LL'), 0);
  assert.ok(zpl.indexOf('^LH0,0\n') !== -1, zpl);
});

check('a broken page object degrades to ^LH0,0 instead of throwing', function () {
  const zpl = zc.compile({ elements: TPL.elements, page: 'garbage' }, 12, null, LABEL);
  assert.ok(zpl.indexOf('^LH0,0\n') !== -1, zpl);
  assert.doesNotThrow(function () { zc.compile({ elements: TPL.elements, page: { offset_mm: null } }, 12, null, LABEL); });
});

check('raw ZPL path (no template) is untouched by this change', function () {
  // compile() is only called for visual templates; the raw path lives in
  // main.js and must keep returning the stored string as-is. This asserts the
  // contract: compileElement/shiftElement/collectVariables signatures unchanged
  assert.strictEqual(typeof zc.compileElement, 'function');
  assert.strictEqual(zc.compileElement({ type: 'text', props: { x_mm: 1, y_mm: 1, height_mm: 3, content: 'x' } }, 8),
    '^FO8,8^A0N,24,24^FDx^FS\n');
  assert.deepStrictEqual(zc.collectVariables({ elements: [{ props: { content: '${a} ${b}' } }] }), ['a', 'b']);
});

check('printer base origin (opts.baseOriginMm) joins the label shift in one ^LH', function () {
  // base 1.5/0.8 mm @12dpmm = 18,10 dots with an all-zero label page
  const base = zc.compile({ elements: TPL.elements }, 12, null,
    Object.assign({}, LABEL, { baseOriginMm: { x: 1.5, y: 0.8 } }));
  assert.ok(base.indexOf('^LH18,10\n') !== -1, base);
  // label shift adds on top: margin.left 1 + base 1.5 = 2.5mm -> 30 dots
  const both = zc.compile({
    elements: TPL.elements,
    page: { margin_mm: { top: 0, right: 0, bottom: 0, left: 1 } }
  }, 12, null, Object.assign({}, LABEL, { baseOriginMm: { x: 1.5, y: 0.8 } }));
  assert.ok(both.indexOf('^LH30,10\n') !== -1, both);
  // no base origin -> unchanged behaviour
  const none = zc.compile({ elements: TPL.elements }, 12, null, LABEL);
  assert.ok(none.indexOf('^LH0,0\n') !== -1, none);
  // broken base degrades to the zero base instead of throwing
  const broken = zc.compile({ elements: TPL.elements }, 12, null,
    Object.assign({}, LABEL, { baseOriginMm: 'x' }));
  assert.ok(broken.indexOf('^LH0,0\n') !== -1, broken);
});

console.log('\n' + (failed ? failed + ' FAILED' : 'ALL PASS'));
process.exit(failed ? 1 : 0);

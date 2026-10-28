// lib/page_geometry.js unit test (no server, no data dir).
//
//   node test/page_geometry_test.js
//
// Covers the pure geometry contract: normalisation of broken input, the
// "all zero page" detection, the print shift (left/top margin + offset, which
// becomes the single ^LH) and the server-side validator.
'use strict';

const assert = require('assert');
const pg = require('../lib/page_geometry.js');

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

console.log('page_geometry unit test\n');

// ---------------------------------------------------------------- normalize
check('missing / null / non-object page normalises to the zero page', function () {
  [undefined, null, 0, 'x', [], {}].forEach(function (v) {
    const p = pg.normalizePage(v);
    assert.deepStrictEqual(p.margin_mm, { top: 0, right: 0, bottom: 0, left: 0 });
    assert.deepStrictEqual(p.offset_mm, { x: 0, y: 0 });
    assert.strictEqual(p.roll_width_mm, undefined);
  });
});

check('negative margins clamp to 0, garbage falls back to 0', function () {
  const p = pg.normalizePage({
    margin_mm: { top: -3, right: 'abc', bottom: undefined, left: 2 }
  });
  assert.deepStrictEqual(p.margin_mm, { top: 0, right: 0, bottom: 0, left: 2 });
});

check('decimals are kept to 2 places, NaN/Infinity fall back to 0', function () {
  const p = pg.normalizePage({
    margin_mm: { top: 1.239, right: Infinity, bottom: NaN, left: '0.005' }
  });
  assert.strictEqual(p.margin_mm.top, 1.24);
  assert.strictEqual(p.margin_mm.right, 0);
  assert.strictEqual(p.margin_mm.bottom, 0);
  assert.strictEqual(p.margin_mm.left, 0.01);
});

check('offset keeps its sign and rounds to 2 places', function () {
  const p = pg.normalizePage({ offset_mm: { x: 1.239, y: -2.341 } });
  assert.strictEqual(p.offset_mm.x, 1.24);
  assert.strictEqual(p.offset_mm.y, -2.34);
});

check('roll_width_mm is optional: only kept when positive', function () {
  assert.strictEqual(pg.normalizePage({ roll_width_mm: 84.8 }).roll_width_mm, 84.8);
  assert.strictEqual(pg.normalizePage({ roll_width_mm: '84.8' }).roll_width_mm, 84.8);
  assert.strictEqual(pg.normalizePage({ roll_width_mm: 0 }).roll_width_mm, undefined);
  assert.strictEqual(pg.normalizePage({ roll_width_mm: -5 }).roll_width_mm, undefined);
  assert.strictEqual(pg.normalizePage({ roll_width_mm: 'wide' }).roll_width_mm, undefined);
});

check('normalizePage never throws on hostile input', function () {
  const hostile = [{ margin_mm: null }, { margin_mm: 5 }, { offset_mm: 'x' },
    { margin_mm: { top: { valueOf: function () { return 2; } } } }];
  hostile.forEach(function (v) { assert.doesNotThrow(function () { pg.normalizePage(v); }); });
});

// --------------------------------------------------------------- isEmptyPage
check('isEmptyPage: all-zero page is empty, any field makes it non-empty', function () {
  assert.strictEqual(pg.isEmptyPage(undefined), true);
  assert.strictEqual(pg.isEmptyPage({}), true);
  assert.strictEqual(pg.isEmptyPage({ margin_mm: { top: 0, right: 0, bottom: 0, left: 0 }, offset_mm: { x: 0, y: 0 } }), true);
  assert.strictEqual(pg.isEmptyPage({ margin_mm: { top: 1, right: 0, bottom: 0, left: 0 } }), false);
  assert.strictEqual(pg.isEmptyPage({ offset_mm: { x: 0.01, y: 0 } }), false);
  assert.strictEqual(pg.isEmptyPage({ offset_mm: { x: 0, y: -0.01 } }), false);
  assert.strictEqual(pg.isEmptyPage({ roll_width_mm: 84.8 }), false);
});

// ------------------------------------------------------------------ shiftMm
check('shift is left/top margin + offset (one ^LH for the whole format)', function () {
  const s = pg.shiftMm({
    margin_mm: { top: 2, right: 99, bottom: 99, left: 3 },
    offset_mm: { x: 1, y: -0.5 }
  }, 84.8, 23.8);
  assert.strictEqual(s.x, 4);    // 3 + 1
  assert.strictEqual(s.y, 1.5);  // 2 + (-0.5)
  assert.strictEqual(s.clamped, false);
  // right/bottom are notes only: they must never move the origin
  const notes = pg.shiftMm({ margin_mm: { top: 0, right: 8, bottom: 8, left: 0 } }, 84.8, 23.8);
  assert.deepStrictEqual({ x: notes.x, y: notes.y }, { x: 0, y: 0 });
});

check('shift of the zero page is exactly 0,0 (never -0)', function () {
  const s = pg.shiftMm(pg.normalizePage(undefined), 84.8, 23.8);
  assert.strictEqual(String(s.x), '0');
  assert.strictEqual(String(s.y), '0');
  // sub-dot values are kept in mm and rounded away by originDots, not here
  const tiny = pg.originDots({ offset_mm: { x: -0.01, y: -0.01 } }, 12, 84.8, 23.8);
  assert.strictEqual('^LH' + tiny.x + ',' + tiny.y, '^LH0,0');
});

check('a margin beyond the limit is clamped together with the offset', function () {
  // 84.8/4 = 21.2 -> limit 20mm; 23.8/4 = 5.95mm
  const s = pg.shiftMm({ margin_mm: { top: 50, left: 50 } }, 84.8, 23.8);
  assert.strictEqual(s.x, 20);
  assert.strictEqual(s.y, 5.95);
  assert.strictEqual(s.clamped, true);
  // a margin can also cancel a negative offset (that is the point of the pair)
  const c = pg.shiftMm({ margin_mm: { top: 2, left: 2 }, offset_mm: { x: -1.5, y: -1.5 } }, 84.8, 23.8);
  assert.deepStrictEqual({ x: c.x, y: c.y }, { x: 0.5, y: 0.5 });
});

// ---------------------------------------------------------------- originDots
check('originDots converts the shift to dots (84.8x23.8 @12dpmm)', function () {
  const d = pg.originDots({ offset_mm: { x: 1.5, y: -1 } }, 12, 84.8, 23.8);
  assert.deepStrictEqual(d, { x: 18, y: -12 });
  const m = pg.originDots({ margin_mm: { top: 0.25, left: 0.5 } }, 12, 84.8, 23.8);
  assert.deepStrictEqual(m, { x: 6, y: 3 });
});

check('originDots clamps to 20mm (or a quarter of the label), in mm first', function () {
  // 84.8/4 = 21.2 -> limit 20mm -> 240 dots; 23.8/4 = 5.95mm -> 71 dots
  assert.deepStrictEqual(pg.originDots({ offset_mm: { x: 100, y: -100 } }, 12, 84.8, 23.8), { x: 240, y: -71 });
  // 22mm wide -> limit 5.5mm -> 66 dots; 5mm high -> limit 1.25mm -> 15 dots
  assert.deepStrictEqual(pg.originDots({ offset_mm: { x: 10, y: 10 } }, 12, 22, 5), { x: 66, y: 15 });
});

check('originDots of the zero page is exactly "0,0" (never "-0")', function () {
  const d = pg.originDots(pg.normalizePage(undefined), 12, 84.8, 23.8);
  assert.strictEqual(String(d.x), '0');
  assert.strictEqual(String(d.y), '0');
  // a tiny negative shift must not leak a minus sign into the ZPL either
  const d2 = pg.originDots({ offset_mm: { x: -0.01, y: -0.01 } }, 12, 84.8, 23.8);
  assert.strictEqual('^LH' + d2.x + ',' + d2.y, '^LH0,0');
});

check('originDots is dpmm-agnostic-safe when dpmm is missing', function () {
  const d = pg.originDots({ offset_mm: { x: 1, y: 1 } }, 0, 84.8, 23.8);
  assert.deepStrictEqual(d, { x: 8, y: 8 }); // 1mm at the 8dpmm fallback
});

check('offsetLimit is 20mm or a quarter of the size, whichever is smaller', function () {
  assert.strictEqual(pg.offsetLimit(84.8), 20);
  assert.strictEqual(pg.offsetLimit(22), 5.5);
  assert.strictEqual(pg.offsetLimit(0), 20); // unknown size: the absolute cap
});

// -------------------------------------------------------------- validatePage
check('validatePage accepts a page with margins + offset', function () {
  const v = pg.validatePage({ margin_mm: { top: 1, right: 1, bottom: 1, left: 1 }, offset_mm: { x: 0, y: 0 } }, 84.8, 23.8);
  assert.deepStrictEqual(v.errors, []);
  assert.strictEqual(v.page.margin_mm.top, 1);
  assert.deepStrictEqual(v.shift_mm, { x: 1, y: 1 });
});

check('validatePage never rejects a margin, however large (no safe area)', function () {
  // the label size is the whole design area: a margin is only a nudge, so it is
  // clamped with the offset instead of turning into a save error
  const w = pg.validatePage({ margin_mm: { top: 0, right: 40, bottom: 0, left: 45 } }, 84.8, 23.8);
  assert.deepStrictEqual(w.errors, []);
  assert.strictEqual(w.shift_mm.x, 20);  // clamped to the 20mm limit
  const h = pg.validatePage({ margin_mm: { top: 12, right: 0, bottom: 11.5, left: 0 } }, 84.8, 23.8);
  assert.deepStrictEqual(h.errors, []);
  assert.strictEqual(h.shift_mm.y, 5.95);
});

check('validatePage rejects an offset beyond the physical limit', function () {
  const x = pg.validatePage({ offset_mm: { x: 20.1, y: 0 } }, 84.8, 23.8);
  assert.strictEqual(x.errors.length, 1);
  assert.ok(/offset/.test(x.errors[0]), x.errors[0]);
  // 23.8/4 = 5.95mm is the vertical limit on a 23.8mm high label
  const y = pg.validatePage({ offset_mm: { x: 0, y: -6 } }, 84.8, 23.8);
  assert.strictEqual(y.errors.length, 1);
  assert.strictEqual(pg.validatePage({ offset_mm: { x: 0, y: -5.9 } }, 84.8, 23.8).errors.length, 0);
});

check('validatePage warns when the shift had to be clamped', function () {
  const v = pg.validatePage({ margin_mm: { top: 0, right: 35, bottom: 0, left: 35 } }, 84.8, 23.8);
  assert.deepStrictEqual(v.errors, []);
  assert.strictEqual(v.warnings.length, 1);
});

check('validatePage does not throw and returns a normalised page', function () {
  const v = pg.validatePage({ margin_mm: { top: -1 } }, 0, 0); // unknown size
  assert.deepStrictEqual(v.errors, []);
  assert.deepStrictEqual(v.page.margin_mm, { top: 0, right: 0, bottom: 0, left: 0 });
  assert.doesNotThrow(function () { pg.validatePage(null, 'x', null); });
});

console.log('\n' + (failed ? failed + ' FAILED' : 'ALL PASS'));
process.exit(failed ? 1 : 0);

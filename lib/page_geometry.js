// Page geometry of a label template: fine adjustment of the print position.
//
// Coordinate contract (fixed, do not "improve" it):
//   * The label size IS the whole design area. Element x_mm / y_mm are ALWAYS
//     relative to the physical top-left corner of the label and may sit
//     anywhere on it: there is no safe area, no inner box, no implicit inset.
//   * `page.margin_mm` and `page.offset_mm` are fine adjustments of the print
//     position. ZPL has exactly one origin (^LH), so only the left and top
//     margins can act on the output: shift = (left + offset.x, top + offset.y).
//     Right/bottom stay in the data as a note and never reach the ZPL — a
//     single origin cannot pull content in from those two sides.
//   * `page.roll_width_mm` is the physical web width ^PW is compiled from.
//
// Everything here is a pure function and never throws: a missing, partial or
// broken `page` object normalises to the zero page, which reproduces the
// output of a label saved before this module existed. This module is also the
// server-side validator (main.js), so the front-end only mirrors it.

'use strict';

// numeric fallback: non-numbers, NaN, Infinity and undefined all collapse to d
function num(v, d) {
  v = Number(v);
  return isFinite(v) ? v : d;
}

// keep 2 decimals: sub-0.01mm precision is printer noise
function round2(v) {
  return Math.round(v * 100) / 100;
}

var ZERO_MARGIN = { top: 0, right: 0, bottom: 0, left: 0 };

// normalise any input into { margin_mm, offset_mm[, roll_width_mm] }.
// negative margins degrade to 0 (there is nothing to pull in from a side)
function normalizePage(page) {
  page = (page && typeof page === 'object') ? page : {};
  var m = (page.margin_mm && typeof page.margin_mm === 'object') ? page.margin_mm : ZERO_MARGIN;
  var o = (page.offset_mm && typeof page.offset_mm === 'object') ? page.offset_mm : {};
  var out = {
    margin_mm: {
      top: round2(Math.max(0, num(m.top, 0))) || 0,
      right: round2(Math.max(0, num(m.right, 0))) || 0,
      bottom: round2(Math.max(0, num(m.bottom, 0))) || 0,
      left: round2(Math.max(0, num(m.left, 0))) || 0
    },
    offset_mm: { x: round2(num(o.x, 0)) || 0, y: round2(num(o.y, 0)) || 0 }
  };
  // roll_width_mm is optional: only present when it is a positive length
  var rw = num(page.roll_width_mm, 0);
  if (rw > 0) out.roll_width_mm = round2(rw);
  return out;
}

// true when the page carries no information at all (callers then omit the
// field, so untouched/legacy labels keep clean JSON)
function isEmptyPage(page) {
  var p = normalizePage(page);
  return !p.roll_width_mm &&
         !p.margin_mm.top && !p.margin_mm.right &&
         !p.margin_mm.bottom && !p.margin_mm.left &&
         !p.offset_mm.x && !p.offset_mm.y;
}

// allowed shift of one axis: 20mm, but never more than a quarter of the label.
// A quarter is enough to absorb any realistic media / print-head misalignment
// and small enough that the content stays on the label.
function offsetLimit(sizeMm) {
  var s = num(sizeMm, 0);
  return s > 0 ? Math.min(20, s / 4) : 20;
}

function clamp(v, lim) {
  return Math.max(-lim, Math.min(lim, v));
}

// The single physical compensation of the whole design, in millimetres: the
// left/top margins join the offset and become one ^LH per format. Clamped in
// millimetres first and rounded to dots once — adding the shift to each
// element coordinate instead would round per element and produce ±1 dot
// jitter between the columns of a multi-up row.
function shiftMm(page, wMm, hMm) {
  var p = normalizePage(page);
  var m = p.margin_mm;
  var limX = offsetLimit(num(wMm, 0) || 84.8);
  var limY = offsetLimit(num(hMm, 0) || 23.8);
  var rawX = round2(m.left + p.offset_mm.x) || 0;
  var rawY = round2(m.top + p.offset_mm.y) || 0;
  var x = round2(clamp(rawX, limX)) || 0;
  var y = round2(clamp(rawY, limY)) || 0;
  return { x: x, y: y, clamped: x !== rawX || y !== rawY };
}

// ^LH payload in dots. baseMm (optional) is the printer-level base origin
// (printer.settings.base_origin_mm, {x,y} in mm): the physical compensation of
// that machine's media loading, applied to EVERY label before the label's own
// margins/offset. Added in millimetres and rounded to dots once, together with
// the label shift — never per part, or the two roundings could differ by a dot.
function originDots(page, dpmm, wMm, hMm, baseMm) {
  var s = shiftMm(page, wMm, hMm);
  var b = (baseMm && typeof baseMm === 'object') ? baseMm : {};
  var d = num(dpmm, 8) || 8;
  return {
    x: Math.round((s.x + num(b.x, 0)) * d) || 0,
    y: Math.round((s.y + num(b.y, 0)) * d) || 0
  };
}

// server-side authority for a page proposal: returns the normalised page plus
// the reasons to reject it. wMm/hMm <= 0 means "size unknown" and only the
// offset limits are checked.
function validatePage(page, wMm, hMm) {
  var errors = [];
  var warnings = [];
  var p = normalizePage(page);
  var w = num(wMm, 0);
  var h = num(hMm, 0);

  // only the offset is rejected when it alone is out of range. Margins are
  // clamped together with it: the label size is the whole design area, so a
  // large margin must never make a label unsaveable.
  if (Math.abs(p.offset_mm.x) > offsetLimit(w)) errors.push('offset out of range');
  if (Math.abs(p.offset_mm.y) > offsetLimit(h)) errors.push('offset out of range');

  var s = shiftMm(p, w, h);
  if (s.clamped) warnings.push('print shift clamped to the allowed range');

  return { errors: errors, warnings: warnings, page: p, shift_mm: { x: s.x, y: s.y } };
}

module.exports = {
  normalizePage: normalizePage,
  isEmptyPage: isEmptyPage,
  offsetLimit: offsetLimit,
  shiftMm: shiftMm,
  originDots: originDots,
  validatePage: validatePage
};

// Migration: add the default `page` block to visual labels that have none.
//
//   node scripts/migrate_page.js                                   # dry run
//   ZPL_DATA_DIR=D:/some/data node scripts/migrate_page.js --write  # write
//
// Historical note (2026-10-28): this script is no longer needed — a label
// without `page` already compiles to ^LH0,0, i.e. exactly the zero page
// written here. The default used to be margin 1mm x 4 while margins were a
// design-only guideline; now that the left/top margins join ^LH, a non-zero
// default would nudge every legacy label by 1mm on the media. Hence 0.
//
// Why ZPL_DATA_DIR is mandatory: the service keeps its collections in memory
// (diskdb) and writes them back on change, so editing the repository's db/
// while it runs can be overwritten (that has wiped a whole table before).
// Without an explicit data directory this script refuses to run.
'use strict';

const fs = require('fs');
const path = require('path');
const pageGeometry = require('../lib/page_geometry.js');

const DEFAULT_PAGE = {
  margin_mm: { top: 0, right: 0, bottom: 0, left: 0 },
  offset_mm: { x: 0, y: 0 }
};

function cloneDefault() {
  return {
    margin_mm: { top: DEFAULT_PAGE.margin_mm.top, right: DEFAULT_PAGE.margin_mm.right,
                 bottom: DEFAULT_PAGE.margin_mm.bottom, left: DEFAULT_PAGE.margin_mm.left },
    offset_mm: { x: 0, y: 0 }
  };
}

function fail(msg) {
  console.error('migrate_page: ' + msg);
  process.exit(1);
}

function main() {
  const raw = process.env.ZPL_DATA_DIR;
  if (!raw) {
    fail('ZPL_DATA_DIR is not set. Point it at the data directory to migrate '
      + '(the repository db/ is never touched while the service may be running).');
  }
  const dataDir = path.resolve(raw);
  const write = process.argv.indexOf('--write') !== -1;
  const file = path.join(dataDir, 'db', 'label.json');

  if (!fs.existsSync(file)) fail('label.json not found: ' + file);

  let labels;
  try {
    labels = JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (e) {
    fail('label.json is not valid JSON: ' + e.message);
  }
  if (!Array.isArray(labels)) fail('label.json does not contain an array');

  console.log('migrate_page: data dir ' + dataDir);
  console.log('migrate_page: ' + labels.length + ' label(s), mode = ' + (write ? 'WRITE' : 'dry run'));
  console.log('');

  const changed = [];
  let skippedVisual = 0;
  let skippedRaw = 0;

  labels.forEach(function (l) {
    const name = (l && l.name) || '(no name)';
    if (!l || l.type !== 'visual' || !l.template || typeof l.template !== 'object') {
      // raw ZPL labels do not use the page model at all
      skippedRaw++;
      return;
    }
    const page = l.template.page;
    if (page && typeof page === 'object') {
      const size = '^PW/^LL ' + (l.width || '?') + 'x' + (l.height || '?') + 'mm';
      console.log('  keep    ' + l._id + '  ' + name + '  (page already present: '
        + JSON.stringify(pageGeometry.normalizePage(page)) + ') ' + size);
      skippedVisual++;
      return;
    }
    console.log('  add     ' + l._id + '  ' + name + '  -> zero page (margins 0, offset 0,0)');
    changed.push(l);
  });

  console.log('');
  console.log('migrate_page: ' + changed.length + ' to change, '
    + skippedVisual + ' already have a page, ' + skippedRaw + ' not visual');

  if (!changed.length) {
    console.log('migrate_page: nothing to do');
    return;
  }
  if (!write) {
    console.log('migrate_page: dry run only — re-run with --write to persist');
    return;
  }

  changed.forEach(function (l) {
    l.template.page = cloneDefault();
  });

  // atomic replace: a half written label.json would lose every label
  const tmp = file + '.tmp-' + process.pid;
  fs.writeFileSync(tmp, JSON.stringify(labels, null, 2));
  fs.renameSync(tmp, file);
  console.log('migrate_page: wrote ' + file + ' (' + changed.length + ' label(s) updated)');
  console.log('migrate_page: stop the service and start it again to pick the file up '
    + '(it caches collections in memory)');
}

main();

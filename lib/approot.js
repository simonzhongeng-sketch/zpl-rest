// Application root for runtime data (db/, config.json, logs/).
//
// Resolution order (first match wins):
//   1. ZPL_DATA_DIR — explicit data directory. Used by development sandboxes
//      and automated tests: `ZPL_DATA_DIR=/tmp/zpltest node main.js` keeps
//      db/, config.json and logs/crash.log inside that directory instead of
//      the project tree, so a test run can never overwrite the real production
//      printers/labels/jobs sitting in ./db. Relative values are resolved
//      against the current working directory; the directory (and the db/
//      subdirectory the caller relies on) is created when missing.
//   2. packaged exe (pkg): the directory containing the .exe, so data survives
//      next to the binary (the snapshot filesystem inside the exe is read-only)
//   3. normal run: the project directory
//
// Read-only assets (views/, html/) keep using __dirname: under pkg they are
// read from the embedded snapshot and must NOT follow ZPL_DATA_DIR.
var fs = require('fs');
var path = require('path');

// explicit data directory (development / test isolation). An empty or
// whitespace-only value is treated as "not set" so an empty env var in a
// shell script cannot silently redirect production data somewhere unexpected.
function resolveFromEnv() {
  var raw = process.env.ZPL_DATA_DIR;
  if (!raw) return null;
  var value = String(raw).trim();
  if (!value) return null;
  var dir = path.resolve(value); // absolute; relative values resolve on cwd
  try {
    fs.mkdirSync(dir, { recursive: true });
  } catch (e) {
    // A directory we cannot create is not usable as a data root: fall back to
    // the normal project/exe directory rather than crashing on startup (the
    // actual write attempts below then fail loudly at their own call sites).
    console.error('ZPL_DATA_DIR "' + value + '" is not usable (' + e.message + '), falling back to the default data directory');
    return null;
  }
  return dir;
}

var fromEnv = resolveFromEnv();

module.exports = fromEnv
  ? fromEnv
  : (process.pkg ? path.dirname(process.execPath) : path.join(__dirname, '..'));

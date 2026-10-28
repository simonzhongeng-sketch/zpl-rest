'use strict';

// Crash / exception logging. Without this the packaged exe closes its console
// window the moment any stray async error escapes a handler — the classic
// "flash crash" (闪退) with zero evidence left behind. install() keeps the
// process alive through uncaughtException / unhandledRejection and appends
// every incident to logs/crash.log next to the exe (APP_ROOT), so a crash can
// be diagnosed after the fact. Genuinely fatal startup failures (e.g. the
// REST port cannot bind at all) exit explicitly at their own call sites.

const fs = require('fs');
const path = require('path');
const APP_ROOT = require('./approot.js');

const LOG_DIR = path.join(APP_ROOT, 'logs');
const LOG_FILE = path.join(LOG_DIR, 'crash.log');
const MAX_BYTES = 2 * 1024 * 1024; // truncate instead of growing forever

let installed = false;

function append(kind, err) {
  const msg = err && err.stack ? err.stack : String(err);
  try {
    if (!fs.existsSync(LOG_DIR)) fs.mkdirSync(LOG_DIR, { recursive: true });
    const line = '[' + new Date().toISOString() + '] ' + kind + '\n' + msg + '\n\n';
    fs.appendFileSync(LOG_FILE, line, 'utf8');
    try {
      if (fs.statSync(LOG_FILE).size > MAX_BYTES) fs.writeFileSync(LOG_FILE, line, 'utf8');
    } catch (e2) { /* stat/race on Windows is non-fatal */ }
  } catch (e3) { /* never let the logger itself take the app down */ }
  console.error((new Date()) + ' ' + kind + ': ' + (err && err.message ? err.message : err));
}

// Install the global safety nets exactly once. After this the process no
// longer dies from stray async errors — the trade-off is that a handler that
// would have crashed the app now logs and the affected request/feature fails
// alone, which is the right behaviour for a print server.
function install() {
  if (installed) return;
  installed = true;

  process.on('uncaughtException', function (err) {
    append('uncaughtException', err);
    // stay alive: log + console instead of vanishing
  });

  process.on('unhandledRejection', function (reason) {
    append('unhandledRejection',
      reason && reason.stack ? reason : new Error(String(reason)));
  });

  // distinguish "killed" from "event loop emptied / explicit exit": both fire
  // here with a synchronous file write, a hard termination does not
  process.on('beforeExit', function (code) {
    append('beforeExit', 'event loop about to empty, code=' + code);
  });
  process.on('exit', function (code) {
    append('exit', 'process exiting, code=' + code);
  });
}

module.exports = {
  install: install,
  log: append,
  file: LOG_FILE
};

// crashlog unit test: a stray async error must be logged AND the process must
// stay alive (that is the whole point — pkg exe used to just vanish = 闪退)
'use strict';
const fs = require('fs');
const path = require('path');
const os = require('os');
const assert = require('assert');

// redirect APP_ROOT to a temp dir so the test does not touch the real logs/
// (approot caches process.pkg / executable path — patch LOG via module reset)
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'zpl-crash-'));
process.env.ZPL_TEST_ROOT = tmp;
const APP_ROOT = path.join(tmp, 'app');
fs.mkdirSync(APP_ROOT, { recursive: true });
// approot.js decides by process.pkg; for the test just monkey-patch fs paths
// is messy — instead call crashlog and check the real APP_ROOT/logs behaviour
// by pointing approot's expectation: simplest is to require approot after
// faking pkg is NOT possible, so verify against the real project logs dir
// and clean up afterwards.
const realLogs = path.join(__dirname, '..', 'logs');
const marker = 'CRASHTEST-' + Date.now();
const crashLog = require('../lib/crashlog.js');
crashLog.install();

setTimeout(function () {
  setTimeout(function () {
    throw new Error(marker); // async throw: would kill the process unguarded
  }, 10);
}, 10);

setTimeout(function () {
  // still alive?
  const logText = fs.existsSync(crashLog.file) ? fs.readFileSync(crashLog.file, 'utf8') : '';
  assert.ok(logText.indexOf('uncaughtException') !== -1, 'uncaughtException logged');
  assert.ok(logText.indexOf(marker) !== -1, 'marker error found in log');
  console.log('PASS process survived uncaughtException');
  console.log('PASS crash log written to ' + crashLog.file);

  // rejection path
  Promise.reject(new Error(marker + '-rej'));
  setTimeout(function () {
    const t2 = fs.readFileSync(crashLog.file, 'utf8');
    assert.ok(t2.indexOf('unhandledRejection') !== -1, 'unhandledRejection logged');
    console.log('PASS unhandledRejection logged, process still alive');
    console.log('ALL PASS');
    process.exit(0);
  }, 100);
}, 300);

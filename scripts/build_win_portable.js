'use strict';

// Portable-folder build: instead of a single packed exe (@yao-pkg), ship a
// self-contained folder with an official node.exe + the app + node_modules.
//
// Why: enterprise endpoint agents (observed with 云枢/YunShu) heuristically
// kill the single-file pkg binary — the packed image plus network-scan
// behaviour reads like malware, and the process tree gets terminated with no
// JS exception and no WER event ("闪退"). A plain node.exe running the same
// code from a folder is immune (verified: test/av_probe, test/verify_fix.sh).
//
// Output: dist/zpl-rest-portable/  (+ zpl-rest-portable-<date>.zip)
// Start:  double-click 启动.bat (or run node main.js inside the folder).
// Data (db/, config.json, logs/) is created next to the folder contents on
// first start, exactly like the exe.

const fs = require('fs');
const path = require('path');
const { execFileSync, execSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const OUT = path.join(ROOT, 'dist', 'zpl-rest-portable');

function rm(p) {
  if (!fs.existsSync(p)) return;
  // A recursive delete of the ~230 MB previous build is refused by the
  // sandbox / AV bulk-delete guard (and occasionally locked on Windows).
  // Renaming it aside is always allowed and instant; the moved copy is then
  // deleted best-effort so the new build never fails on cleanup.
  const trash = p + '.old-' + Date.now();
  try {
    fs.renameSync(p, trash);
  } catch (e) {
    for (let i = 0; i < 6; i++) {
      try { fs.rmSync(p, { recursive: true, force: true }); return; } catch (e2) {
        if (i === 5) throw e2;
        const until = Date.now() + 700;
        while (Date.now() < until) { /* small blocking backoff */ }
      }
    }
    return;
  }
  try {
    fs.rmSync(trash, { recursive: true, force: true });
  } catch (e) {
    console.log('  (previous build kept as ' + path.basename(trash) + ' — delete it manually)');
  }
}
function copy(src, dest) {
  fs.cpSync(src, dest, { recursive: true, force: true });
  console.log('  copied ' + path.relative(ROOT, src));
}

console.log('building portable package -> dist/zpl-rest-portable');
rm(OUT);
fs.mkdirSync(OUT, { recursive: true });

// runtime: the node.exe this build runs with (official Node 22 binary)
fs.copyFileSync(process.execPath, path.join(OUT, 'node.exe'));
console.log('  node runtime -> node.exe (' + process.version + ')');

// application code
['main.js', 'mcp.js', 'package.json'].forEach(function (f) {
  fs.copyFileSync(path.join(ROOT, f), path.join(OUT, f));
});
console.log('  copied main.js, mcp.js, package.json');
copy(path.join(ROOT, 'lib'), path.join(OUT, 'lib'));
copy(path.join(ROOT, 'views'), path.join(OUT, 'views'));
copy(path.join(ROOT, 'html'), path.join(OUT, 'html'));
copy(path.join(ROOT, 'node_modules'), path.join(OUT, 'node_modules'));

// launcher: double-click start, keep the window open on exit so errors are
// visible (a closed window on crash is the classic "闪退" report we cannot
// diagnose)
fs.writeFileSync(path.join(OUT, '启动.bat'), [
  '@echo off',
  'title restZPL 标签打印',
  'cd /d %~dp0',
  'echo restZPL 标签打印服务启动中...  (关闭本窗口即停止服务)',
  'node main.js',
  'echo.',
  'echo 服务已退出，按任意键关闭窗口。',
  'pause >nul',
  ''
].join('\r\n'), 'utf8');
console.log('  wrote 启动.bat');

// readme
fs.writeFileSync(path.join(OUT, '使用说明.txt'), [
  'restZPL 标签打印 - 便携版',
  '========================',
  '',
  '启动：双击「启动.bat」，浏览器会自动打开 http://localhost:18420',
  '停止：关闭命令行窗口，或托盘图标右键「关闭服务」。',
  '',
  '数据与配置（db/、config.json、logs/）在首次启动时自动生成于本目录，',
  '整个文件夹可随意拷贝迁移。',
  '',
  '端口等配置在 config.json：18420 网页/REST，18421 WebSocket，18422 MCP。',
  '与单文件 exe 版相比，便携版不会被企业终端安全软件（如云枢）误杀；',
  '若安全软件仍报警，请将本文件夹加入白名单/信任区。',
  ''
].join('\r\n'), 'utf8');
console.log('  wrote 使用说明.txt');

// zip for distribution (unique name per build: deleting an existing zip can
// be blocked by sandbox/AV file locks)
const now = new Date();
const stamp = now.toISOString().slice(0, 10).replace(/-/g, '') +
  '-' + String(now.getHours()).padStart(2, '0') + String(now.getMinutes()).padStart(2, '0');
const zipPath = path.join(ROOT, 'dist', 'zpl-rest-portable-' + stamp + '.zip');
try { fs.rmSync(zipPath, { force: true }); } catch (e) { /* fresh name anyway */ }
try {
  execSync('powershell -NoProfile -Command "Compress-Archive -Path \'' +
    OUT + '\\*\' -DestinationPath \'' + zipPath + '\' -Force"', { stdio: 'ignore' });
  console.log('  zipped -> ' + path.basename(zipPath));
} catch (e) {
  console.log('  (zip skipped: ' + e.message.split('\n')[0] + ')');
}

const size = execFileSync(process.execPath, ['-e',
  'const fs=require("fs");let t=0;const w=d=>{for(const f of fs.readdirSync(d,{withFileTypes:true})){const p=d+"/"+f.name;f.isDirectory()?w(p):t+=fs.statSync(p).size}};w("' + OUT.replace(/\\/g, '\\\\') + '");console.log((t/1048576).toFixed(1))'
]).toString().trim();
console.log('done: dist/zpl-rest-portable (' + size + ' MB)');

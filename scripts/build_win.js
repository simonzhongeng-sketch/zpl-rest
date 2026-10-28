// 打包脚本：Brotli 压缩快照 + 时间戳命名 → dist/zpl-rest-<yyyyMMdd-HHmm>.exe
const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const now = new Date();
const p = (n, w = 2) => String(n).padStart(w, '0');
const stamp = `${now.getFullYear()}${p(now.getMonth() + 1)}${p(now.getDate())}-${p(now.getHours())}${p(now.getMinutes())}`;
const out = path.join('dist', `zpl-rest-${stamp}.exe`);

if (!fs.existsSync('dist')) fs.mkdirSync('dist');

console.log(`pkg building -> ${out} (Brotli)`);

// Run pkg's entry script with the current node binary: spawning bare "npx"
// fails on Windows (ENOENT: npx is a .cmd shim, not an executable).
const pkgBin = require.resolve('@yao-pkg/pkg/lib-es5/bin.js');
execFileSync(process.execPath, [
  pkgBin, '.',
  '--targets', 'node22-win-x64',
  '--compress', 'Brotli',
  '--output', out
], { stdio: 'inherit' });

const size = (fs.statSync(out).size / 1024 / 1024).toFixed(1);
console.log(`done: ${out} (${size} MB)`);

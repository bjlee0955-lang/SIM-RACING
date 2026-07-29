// Copies only the runtime files (not .git, node_modules, scripts, docs)
// into www/ so Capacitor packages a clean webview bundle.
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const OUT = path.join(ROOT, 'www');

const INCLUDE = ['index.html', 'src', 'vendor'];

function rmrf(p) {
  if (fs.existsSync(p)) fs.rmSync(p, { recursive: true, force: true });
}

function copyRecursive(src, dest) {
  const stat = fs.statSync(src);
  if (stat.isDirectory()) {
    fs.mkdirSync(dest, { recursive: true });
    for (const entry of fs.readdirSync(src)) {
      copyRecursive(path.join(src, entry), path.join(dest, entry));
    }
  } else {
    fs.copyFileSync(src, dest);
  }
}

rmrf(OUT);
fs.mkdirSync(OUT, { recursive: true });

for (const item of INCLUDE) {
  const src = path.join(ROOT, item);
  if (!fs.existsSync(src)) {
    console.warn(`[build-www] skip missing: ${item}`);
    continue;
  }
  copyRecursive(src, path.join(OUT, item));
  console.log(`[build-www] copied ${item}`);
}

console.log('[build-www] done ->', OUT);

// Development tool: turns screenshots (PNG or JPEG) into gray pictures a script can read without an image library.
// For each file it writes <name>.gray (one byte a cell, rows top to bottom) and <name>.json ({cols, rows, w, h}).
//
//   env -u ELECTRON_RUN_AS_NODE npx electron scripts/page-gray.cjs --out <dir> [--cols 960] <image> [<image> ...]

const { app, nativeImage } = require('electron');
const fs = require('node:fs');
const path = require('node:path');

const argv = process.argv.slice(2);
const files = [];
let out;
let cols = 960;
for (let i = 0; i < argv.length; i++) {
  if (argv[i] === '--out') out = argv[++i];
  else if (argv[i] === '--cols') cols = Number(argv[++i]);
  else files.push(argv[i]);
}
if (!out || files.length === 0) {
  console.error('usage: electron scripts/page-gray.cjs --out <dir> [--cols 960] <image> [<image> ...]');
  process.exit(2);
}

app.whenReady().then(() => {
  fs.mkdirSync(out, { recursive: true });
  for (const file of files) {
    const img = nativeImage.createFromPath(file);
    const size = img.getSize();
    if (size.width === 0) {
      console.error(`cannot read ${file}`);
      continue;
    }
    const width = Math.min(cols, size.width);
    const small = size.width > width ? img.resize({ width, quality: 'best' }) : img;
    const { width: w, height: h } = small.getSize();
    const bgra = small.toBitmap();
    const gray = Buffer.alloc(w * h);
    for (let i = 0; i < gray.length; i++) gray[i] = Math.round(bgra[i * 4 + 2] * 0.3 + bgra[i * 4 + 1] * 0.59 + bgra[i * 4] * 0.11);
    const name = path.basename(file).replace(/\.[^.]+$/, '');
    fs.writeFileSync(path.join(out, `${name}.gray`), gray);
    fs.writeFileSync(path.join(out, `${name}.json`), JSON.stringify({ cols: w, rows: h, w: size.width, h: size.height }));
  }
  app.exit(0);
});

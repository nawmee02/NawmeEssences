const sharp = require('sharp');
const fs = require('fs');
const path = require('path');

const ORIGINALS_DIR = path.join(__dirname, '..', 'assets', 'images', 'originals');
const GENERATED_DIR = path.join(__dirname, '..', 'assets', 'images', 'generated');

// Must stay in sync with upload-original.js — that script produced the files
// currently in Storage, and a narrower thumb here would silently downgrade
// every live thumbnail the next time these are regenerated + uploaded.
const SIZES = [
  { name: 'thumb',  width: 450,  quality: 80 },
  { name: 'medium', width: 800,  quality: 85 },
  { name: 'large',  width: 1600, quality: 90 },
];

const SUPPORTED = new Set(['.jpg', '.jpeg', '.png', '.webp', '.avif', '.tiff']);

function isUpToDate(srcMtime, destPath) {
  try {
    return fs.statSync(destPath).mtimeMs >= srcMtime;
  } catch {
    return false;
  }
}

async function processImage(srcPath, srcMtime) {
  const basename = path.parse(srcPath).name;
  const outDir = path.join(GENERATED_DIR, basename);
  fs.mkdirSync(outDir, { recursive: true });

  let anyGenerated = false;

  for (const { name, width, quality } of SIZES) {
    const destPath = path.join(outDir, `${name}.webp`);
    if (isUpToDate(srcMtime, destPath)) continue;

    await sharp(srcPath)
      .resize({ width, withoutEnlargement: true })
      .webp({ quality })
      .toFile(destPath);

    anyGenerated = true;
  }

  return anyGenerated;
}

async function run() {
  if (!fs.existsSync(ORIGINALS_DIR)) {
    throw new Error(`Originals directory not found: ${ORIGINALS_DIR}`);
  }

  const files = fs.readdirSync(ORIGINALS_DIR).filter(f =>
    SUPPORTED.has(path.extname(f).toLowerCase())
  );

  if (files.length === 0) {
    console.log('No images found in assets/images/originals/');
    return { ok: true, generated: 0, skipped: 0, errors: 0 };
  }

  let generated = 0, skipped = 0, errors = 0;

  for (const file of files) {
    const srcPath = path.join(ORIGINALS_DIR, file);
    const srcMtime = fs.statSync(srcPath).mtimeMs;

    try {
      const wasGenerated = await processImage(srcPath, srcMtime);
      if (wasGenerated) { console.log(`  generated  ${file}`); generated++; }
      else { skipped++; }
    } catch (err) {
      console.error(`  error      ${file}: ${err.message}`);
      errors++;
    }
  }

  console.log(`\n✓ skipped ${skipped}   generated ${generated}   errors ${errors}   total ${files.length}`);
  return { ok: errors === 0, generated, skipped, errors };
}

module.exports = { run };

if (require.main === module) {
  run().then(r => process.exit(r.ok ? 0 : 1));
}

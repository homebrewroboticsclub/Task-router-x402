#!/usr/bin/env node
/**
 * Builds dark-theme-friendly brand assets from temp/HBR.jpg (black mark on white).
 * Output: white glyph on transparent PNG for /brand and favicon.ico.
 */
const fs = require('fs');
const path = require('path');
const os = require('os');
const sharp = require('sharp');
const pngToIco = require('png-to-ico');

const ROOT = path.join(__dirname, '..');
const SRC = path.join(ROOT, 'temp', 'HBR.jpg');
const BRAND_DIR = path.join(ROOT, 'public', 'brand');
const OUT_MARK = path.join(BRAND_DIR, 'hbr-mark.png');
const OUT_APPLE = path.join(BRAND_DIR, 'apple-touch-icon.png');
const OUT_ICO = path.join(ROOT, 'public', 'favicon.ico');

/** Pixels at or above this average RGB are treated as background (transparent). */
const BG_THRESHOLD = 236;

async function jpgToWhiteOnTransparentPngBuffer(inputPath) {
  const { data, info } = await sharp(inputPath)
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });

  const { width, height, channels } = info;
  const out = Buffer.alloc(width * height * 4);

  for (let i = 0, p = 0; p < data.length; i += 1, p += channels) {
    const r = data[p];
    const g = data[p + 1];
    const b = data[p + 2];
    const lum = (r + g + b) / 3;
    const o = i * 4;
    if (lum >= BG_THRESHOLD) {
      out[o] = 0;
      out[o + 1] = 0;
      out[o + 2] = 0;
      out[o + 3] = 0;
    } else {
      out[o] = 255;
      out[o + 1] = 255;
      out[o + 2] = 255;
      out[o + 3] = 255;
    }
  }

  return sharp(out, { raw: { width, height, channels: 4 } })
    .png()
    .toBuffer();
}

async function main() {
  if (!fs.existsSync(SRC)) {
    console.error(`Missing source ${SRC} (add temp/HBR.jpg or set SOURCE path).`);
    process.exit(1);
  }

  fs.mkdirSync(BRAND_DIR, { recursive: true });

  const trimmed = await sharp(await jpgToWhiteOnTransparentPngBuffer(SRC))
    .trim()
    .png()
    .toBuffer();

  await sharp(trimmed)
    .resize(512, 512, {
      fit: 'contain',
      background: { r: 0, g: 0, b: 0, alpha: 0 },
    })
    .png()
    .toFile(OUT_MARK);

  await sharp(trimmed)
    .resize(180, 180, {
      fit: 'contain',
      background: { r: 0, g: 0, b: 0, alpha: 0 },
    })
    .png()
    .toFile(OUT_APPLE);

  const tmp256 = path.join(os.tmpdir(), `hbr-mark-256-${process.pid}.png`);
  await sharp(trimmed)
    .resize(256, 256, {
      fit: 'contain',
      background: { r: 0, g: 0, b: 0, alpha: 0 },
    })
    .png()
    .toFile(tmp256);

  try {
    const icoBuf = await pngToIco(tmp256);
    fs.writeFileSync(OUT_ICO, icoBuf);
  } finally {
    try {
      fs.unlinkSync(tmp256);
    } catch {
      /* ignore */
    }
  }

  console.log('Wrote', path.relative(ROOT, OUT_MARK));
  console.log('Wrote', path.relative(ROOT, OUT_APPLE));
  console.log('Wrote', path.relative(ROOT, OUT_ICO));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

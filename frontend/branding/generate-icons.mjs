import sharp from 'sharp';
import pngToIco from 'png-to-ico';
import { writeFile, readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const SRC = fileURLToPath(new URL('./logo-source.svg', import.meta.url));
const MASKABLE = fileURLToPath(new URL('./logo-maskable.svg', import.meta.url));
const OUT = new URL('../public/icons/', import.meta.url);
const PUBLIC = new URL('../public/', import.meta.url);

async function png(srcPath, size, outName, dir = OUT) {
  const buf = await sharp(srcPath).resize(size, size).png().toBuffer();
  await writeFile(new URL(outName, dir), buf);
  return buf;
}

async function main() {
  // standard app icons
  await png(SRC, 192, 'icon-192.png');
  await png(SRC, 512, 'icon-512.png');

  // maskable icons (full-bleed, safe-area padded)
  await png(MASKABLE, 192, 'maskable-192.png');
  await png(MASKABLE, 512, 'maskable-512.png');

  // apple touch icon (iOS applies its own squircle mask, wants full-bleed square)
  await png(MASKABLE, 180, 'apple-touch-icon.png', PUBLIC);

  // favicons
  const fav16 = await png(SRC, 16, 'favicon-16.png');
  const fav32 = await png(SRC, 32, 'favicon-32.png');
  await png(SRC, 48, 'favicon-48.png');

  const ico = await pngToIco([
    Buffer.from(fav16),
    Buffer.from(fav32),
  ]);
  await writeFile(new URL('favicon.ico', PUBLIC), ico);

  // vector favicon for modern browsers
  const svg = await readFile(SRC);
  await writeFile(new URL('favicon.svg', PUBLIC), svg);

  console.log('icons generated');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

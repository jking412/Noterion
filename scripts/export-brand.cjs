// Optional authoring tool: sharp 0.35.5. No client runtime dependency.
// Run from any directory; all generated assets stay inside this checkout.
const fs = require('node:fs/promises');
const path = require('node:path');
const sharp = require('sharp');
const root = path.resolve(__dirname, '..');
const brand = path.join(root, 'assets/brand');
const sizes = [16, 20, 24, 32, 40, 48, 64, 128, 256];

async function main() {
  const source = await fs.readFile(path.join(brand, 'noterion-icon.svg'));
  const images = await Promise.all(sizes.map(size => sharp(source, { density: 384 })
    .resize(size, size).png().toBuffer()));
  const header = Buffer.alloc(6 + sizes.length * 16);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(sizes.length, 4);
  let offset = header.length;
  sizes.forEach((size, index) => {
    const entry = 6 + index * 16;
    header[entry] = header[entry + 1] = size === 256 ? 0 : size;
    header.writeUInt16LE(1, entry + 4);
    header.writeUInt16LE(32, entry + 6);
    header.writeUInt32LE(images[index].length, entry + 8);
    header.writeUInt32LE(offset, entry + 12);
    offset += images[index].length;
  });
  const ico = Buffer.concat([header, ...images]);
  await fs.writeFile(path.join(brand, 'noterion.ico'), ico);
  await fs.copyFile(path.join(brand, 'noterion.ico'), path.join(root, 'app/src-tauri/icons/icon.ico'));
  await fs.copyFile(path.join(brand, 'noterion-icon.svg'), path.join(root, 'app/public/favicon.svg'));
  await sharp(source, { density: 384 }).resize(1024).png().toFile(path.join(brand, 'noterion-icon.png'));
  await fs.writeFile(path.join(root, 'app/src-tauri/icons/icon.png'), images.at(-1));
  await fs.writeFile(path.join(root, 'app/public/brand-icon.png'), images[7]);
  await fs.writeFile(path.join(root, 'app/public/favicon.png'), images[3]);
  for (let index = 0; index < sizes.length; index++) {
    await fs.writeFile(path.join(brand, `noterion-${sizes[index]}.png`), images[index]);
  }
  console.log('Exported transparent 1024px PNG, 9-frame ICO, window PNG and frontend assets from one SVG.');
}
main().catch(error => { console.error(error); process.exitCode = 1; });

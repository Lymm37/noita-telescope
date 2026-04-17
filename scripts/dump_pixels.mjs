// Dump biome_map.png pixel colors for a row range. Use to inspect what
// colors live in the static biome map for specific chunk positions.
//
//   node scripts/dump_pixels.mjs <cy_start> <cy_end>

import { createCanvas, loadImage } from 'canvas';

async function main() {
  const cyStart = +process.argv[2] || 0;
  const cyEnd = +process.argv[3] || cyStart + 1;
  const img = await loadImage('data/biome_maps/biome_map.png');
  const c = createCanvas(img.width, img.height);
  const ctx = c.getContext('2d');
  ctx.drawImage(img, 0, 0);
  const data = ctx.getImageData(0, 0, img.width, img.height).data;
  console.log(`biome_map ${img.width}x${img.height}, rows ${cyStart}..${cyEnd-1}`);
  for (let cy = cyStart; cy < cyEnd; cy++) {
    const row = [];
    for (let cx = 0; cx < img.width; cx++) {
      const idx = (cy * img.width + cx) * 4;
      const c = (data[idx] << 16) | (data[idx + 1] << 8) | data[idx + 2];
      row.push(c.toString(16).padStart(6, '0'));
    }
    console.log(`cy=${cy.toString().padStart(2)}: ${row.join(' ')}`);
  }
}
main();

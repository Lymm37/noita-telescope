// Print telescope's full wobble computation for a single coord, then call
// noitrainer biome-at to print Noita's resolved chunk. Use to find where
// the two formulas diverge.
//
//   node scripts/trace_wobble.mjs <wx> <wy>

import { GetTrueChunkPosIdAt, GetBiomeOffset } from './_edge_noise_shim.js';
import { execSync } from 'node:child_process';

function main() {
  const wx = +process.argv[2];
  const wy = +process.argv[3];
  if (Number.isNaN(wx) || Number.isNaN(wy)) {
    console.error('Usage: node scripts/trace_wobble.mjs <wx> <wy>');
    process.exit(1);
  }

  const X_SHIFT = 17920;  // 35*512
  const Y_SHIFT = 7168;   // 14*512
  const sx = wx + X_SHIFT;
  const sy = wy + Y_SHIFT;
  const subX = sx & 0x1ff;
  const subY = sy & 0x1ff;
  const cx = (sx >> 9) % 70;
  const cy = sy >> 9;

  console.log(`world (${wx}, ${wy})  shifted (${sx}, ${sy})`);
  console.log(`chunk (${cx}, ${cy})  sub (${subX}, ${subY})`);

  // Inline telescope's wobble math for transparency.
  // (Cribbed from edge_noise.js ComputeMagicValueFromDoubles + GetWobbledBiome.)
  const sqrt312 = (Math.sqrt(3) - 1) / 2;
  const sqrt336 = (3 - Math.sqrt(3)) / 6;
  const EDGE_NOISE = [0x97, 0xa0, 0x89, 0x5b, 0x5a, 0x0f, 0x83, 0x0d, 0xc9, 0x5f, 0x60, 0x35, 0xc2, 0xe9, 0x07, 0xe1, 0x8c, 0x24, 0x67, 0x1e, 0x45, 0x8e, 0x08, 0x63, 0x25, 0xf0, 0x15, 0x0a, 0x17, 0xbe, 0x06, 0x94, 0xf7, 0x78, 0xea, 0x4b, 0x00, 0x1a, 0xc5, 0x3e, 0x5e, 0xfc, 0xdb, 0xcb, 0x75, 0x23, 0x0b, 0x20, 0x39, 0xb1, 0x21, 0x58, 0xed, 0x95, 0x38, 0x57, 0xae, 0x14, 0x7d, 0x88, 0xab, 0xa8, 0x44, 0xaf, 0x4a, 0xa5, 0x47, 0x86, 0x8b, 0x30, 0x1b, 0xa6, 0x4d, 0x92, 0x9e, 0xe7, 0x53, 0x6f, 0xe5, 0x7a, 0x3c, 0xd3, 0x85, 0xe6, 0xdc, 0x69, 0x5c, 0x29, 0x37, 0x2e, 0xf5, 0x28, 0xf4, 0x66, 0x8f, 0x36, 0x41, 0x19, 0x3f, 0xa1, 0x01, 0xd8, 0x50, 0x49, 0xd1, 0x4c, 0x84, 0xbb, 0xd0, 0x59, 0x12, 0xa9, 0xc8, 0xc4, 0x87, 0x82, 0x74, 0xbc, 0x9f, 0x56, 0xa4, 0x64, 0x6d, 0xc6, 0xad, 0xba, 0x03, 0x40, 0x34, 0xd9, 0xe2, 0xfa, 0x7c, 0x7b, 0x05, 0xca, 0x26, 0x93, 0x76, 0x7e, 0xff, 0x52, 0x55, 0xd4, 0xcf, 0xce, 0x3b, 0xe3, 0x2f, 0x10, 0x3a, 0x11, 0xb6, 0xbd, 0x1c, 0x2a, 0xdf, 0xb7, 0xaa, 0xd5, 0x77, 0xf8, 0x98, 0x02, 0x2c, 0x9a, 0xa3, 0x46, 0xdd, 0x99, 0x65, 0x9b, 0xa7, 0x2b, 0xac, 0x09, 0x81, 0x16, 0x27, 0xfd, 0x13, 0x62, 0x6c, 0x6e, 0x4f, 0x71, 0xe0, 0xe8, 0xb2, 0xb9, 0x70, 0x68, 0xda, 0xf6, 0x61, 0xe4, 0xfb, 0x22, 0xf2, 0xc1, 0xee, 0xd2, 0x90, 0x0c, 0xbf, 0xb3, 0xa2, 0xf1, 0x51, 0x33, 0x91, 0xeb, 0xf9, 0x0e, 0xef, 0x6b, 0x31, 0xc0, 0xd6, 0x1f, 0xb5, 0xc7, 0x6a, 0x9d, 0xb8, 0x54, 0xcc, 0xb0, 0x73, 0x79, 0x32, 0x2d, 0x7f, 0x04, 0x96, 0xfe, 0x8a, 0xec, 0xcd, 0x5d, 0xde, 0x72, 0x43, 0x1d, 0x18, 0x48, 0xf3, 0x8d, 0x80, 0xc3, 0x4e, 0x42, 0xd7, 0x3d, 0x9c, 0xb4];
  const EDGE_SIGNS = [1, 1, 0, 0, -1, 1, 0, 0, 1, -1, 0, 0, -1, -1, 0, 0, 1, 0, 1, 0, -1, 0, 1, 0, 1, 0, -1, 0, -1, 0, -1, 0, 0, 1, 1, 0, 0, -1, 1, 0, 0, 1, -1, 0, 0, -1, -1, 0];
  const EDGE_NOISE_2 = [], EDGE_NOISE_M12 = [];
  for (let i = 0; i < 512; i++) {
    const t = EDGE_NOISE[i & 0xff];
    EDGE_NOISE_2.push(t); EDGE_NOISE_M12.push(t % 0xc);
  }

  function simplex(x, y) {
    let dVar7 = (x + y) * sqrt312;
    let dVar6 = dVar7 + x;
    let uVar2 = dVar6 >>> 0;
    if (dVar6 < uVar2) uVar2 -= 1;
    dVar7 = dVar7 + y;
    let uVar1 = dVar7 >>> 0;
    if (dVar7 < uVar1) uVar1 -= 1;
    dVar6 = (uVar1 + uVar2) * sqrt336;
    let dVar10 = x - (uVar2 - dVar6);
    let dVar9 = y - (uVar1 - dVar6);
    uVar1 &= 0xff; uVar2 &= 0xff;
    let dVar8 = 0;
    let dVar11_a = (dVar10 - (dVar9 < dVar10 ? 1 : 0)) + sqrt336;
    let dVar3 = (dVar9 - (dVar10 <= dVar9 ? 1 : 0)) + sqrt336;
    let dVar11 = (dVar10 - 1) + sqrt336 * 2;
    let dVar4 = (dVar9 - 1) + sqrt336 * 2;
    let dVar5 = 0.5 - dVar10 * dVar10 - dVar9 * dVar9;
    let dVar6r = 0;
    if (dVar5 >= 0) {
      const idx = EDGE_NOISE_M12[EDGE_NOISE_2[uVar1] + uVar2] * 4;
      dVar6r = (EDGE_SIGNS[idx + 1] * dVar9 + EDGE_SIGNS[idx] * dVar10) * dVar5 ** 4;
    }
    dVar5 = 0.5 - dVar11_a * dVar11_a - dVar3 * dVar3;
    let dVar7r = 0;
    if (dVar5 >= 0) {
      const idx = EDGE_NOISE_M12[EDGE_NOISE_2[(dVar10 <= dVar9 ? 1 : 0) + uVar1] + uVar2 + (dVar9 < dVar10 ? 1 : 0)] * 4;
      dVar7r = (EDGE_SIGNS[idx + 1] * dVar3 + EDGE_SIGNS[idx] * dVar11_a) * dVar5 ** 4;
    }
    let dVar3r = 0.5 - dVar11 * dVar11 - dVar4 * dVar4;
    let dVar8r = 0;
    if (dVar3r >= 0) {
      const idx = EDGE_NOISE_M12[EDGE_NOISE_2[uVar1 + 1] + uVar2 + 1] * 4;
      dVar8r = (EDGE_SIGNS[idx + 1] * dVar4 + EDGE_SIGNS[idx] * dVar11) * dVar3r ** 4;
    }
    return (dVar7r + dVar6r + dVar8r) * 70.0;
  }

  const simplex_val = simplex(sx * 0.05, sy * 0.05);
  const sin_y = Math.sin(sy * 0.005);
  const cos_x = Math.cos(sx * 0.005);
  const x2 = cos_x * 30 + simplex_val * 11;  // X-axis wobble
  const y2 = sin_y * 30 + simplex_val * 11;  // Y-axis wobble

  console.log(`\nSimplex value:                ${simplex_val.toFixed(4)}`);
  console.log(`cos(shifted_x * 0.005) * 30:  ${(cos_x*30).toFixed(4)}`);
  console.log(`sin(shifted_y * 0.005) * 30:  ${(sin_y*30).toFixed(4)}`);
  console.log(`x2 (X wobble): ${x2.toFixed(4)}`);
  console.log(`y2 (Y wobble): ${y2.toFixed(4)}`);

  // edge_noise.js return statement (note the X/Y swap in the actual binary).
  const tCX_swapped = (Math.floor(y2 + sx) >> 9) % 70;  // current
  const tCY_swapped = Math.floor(x2 + sy) >> 9;
  // Hypothetical "unswapped" version:
  const tCX_unswapped = (Math.floor(x2 + sx) >> 9) % 70;
  const tCY_unswapped = Math.floor(y2 + sy) >> 9;
  console.log(`\nTelescope (current, swapped):   chunk (${tCX_swapped}, ${tCY_swapped})`);
  console.log(`Telescope (unswapped guess):    chunk (${tCX_unswapped}, ${tCY_unswapped})`);

  const offset = GetBiomeOffset(wx, wy, false, true);
  const tBiomeId = GetTrueChunkPosIdAt(wx, wy, false, true);
  console.log(`\nedge_noise.GetBiomeOffset:    dx=${offset.x}  dy=${offset.y}`);
  console.log(`edge_noise.GetTrueChunkPosId: ${tBiomeId}`);

  console.log(`\n--- Noita ground truth ---`);
  const noita = JSON.parse(execSync(`cd /home/vitaminmoo/repos/noitrainer && go run ./cmd/cli/ biome-at --json ${wx} ${wy} 2>/dev/null`).toString());
  console.log(`origCX=${noita.origCX} origCY=${noita.origCY} subX=${noita.subX} subY=${noita.subY}`);
  console.log(`wobbleType: ${noita.wobbleType}`);
  console.log(`neighbor: ${noita.neighborDir} (cx=${noita.neighborCX}, cy=${noita.neighborCY})`);
  console.log(`original:  ${noita.original.name}  (cx=${noita.original.cx}, cy=${noita.original.cy})`);
  console.log(`resolved:  ${noita.resolved.name}  (cx=${noita.resolved.cx}, cy=${noita.resolved.cy})`);
}

main();

// Node-side copy of the biome / edge-noise code paths needed by the
// verification scripts. The browser imports `js/edge_noise.js` +
// `js/utils.js` directly, but those files (transitively) pull in
// `js/pixel_scene_generation.js` and assorted CDN-only modules that
// Node's ESM loader refuses. Rather than restructure the browser code,
// this file re-implements the exact same logic in a self-contained
// Node-compatible module.
//
// Must track `js/edge_noise.js::GetBiomeOffset` and
// `js/utils.js::getBiomeAtWorldCoordinates` line-for-line when either
// changes. Re-run `node scripts/verify.mjs` after any change to those
// files to confirm 100% agreement is preserved.

import { readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { createCanvas, loadImage } from 'canvas';
import { BIOME_COLOR_TO_NAME, BIOME_COLORS_WITH_TILES } from '../js/generator_config.js';
import { colorWobbleVerdict } from '../js/wobble_flags.js';

// ----- world-size constants (from js/utils.js getWorldSize/getWorldCenter) -----

function getWorldCenter(isNGP, gameMode) {
    if (gameMode === 'nightmare') return 32;
    return isNGP ? 32 : 35;
}

export function getWorldSize(isNGP, gameMode) {
    if (gameMode === 'nightmare') return 64;
    return isNGP ? 64 : 70;
}

// ----- edge-noise tables (verbatim from js/edge_noise.js) -----

const EDGE_NOISE = [0x97, 0xa0, 0x89, 0x5b, 0x5a, 0x0f, 0x83, 0x0d, 0xc9, 0x5f, 0x60, 0x35, 0xc2, 0xe9, 0x07, 0xe1, 0x8c, 0x24, 0x67, 0x1e, 0x45, 0x8e, 0x08, 0x63, 0x25, 0xf0, 0x15, 0x0a, 0x17, 0xbe, 0x06, 0x94, 0xf7, 0x78, 0xea, 0x4b, 0x00, 0x1a, 0xc5, 0x3e, 0x5e, 0xfc, 0xdb, 0xcb, 0x75, 0x23, 0x0b, 0x20, 0x39, 0xb1, 0x21, 0x58, 0xed, 0x95, 0x38, 0x57, 0xae, 0x14, 0x7d, 0x88, 0xab, 0xa8, 0x44, 0xaf, 0x4a, 0xa5, 0x47, 0x86, 0x8b, 0x30, 0x1b, 0xa6, 0x4d, 0x92, 0x9e, 0xe7, 0x53, 0x6f, 0xe5, 0x7a, 0x3c, 0xd3, 0x85, 0xe6, 0xdc, 0x69, 0x5c, 0x29, 0x37, 0x2e, 0xf5, 0x28, 0xf4, 0x66, 0x8f, 0x36, 0x41, 0x19, 0x3f, 0xa1, 0x01, 0xd8, 0x50, 0x49, 0xd1, 0x4c, 0x84, 0xbb, 0xd0, 0x59, 0x12, 0xa9, 0xc8, 0xc4, 0x87, 0x82, 0x74, 0xbc, 0x9f, 0x56, 0xa4, 0x64, 0x6d, 0xc6, 0xad, 0xba, 0x03, 0x40, 0x34, 0xd9, 0xe2, 0xfa, 0x7c, 0x7b, 0x05, 0xca, 0x26, 0x93, 0x76, 0x7e, 0xff, 0x52, 0x55, 0xd4, 0xcf, 0xce, 0x3b, 0xe3, 0x2f, 0x10, 0x3a, 0x11, 0xb6, 0xbd, 0x1c, 0x2a, 0xdf, 0xb7, 0xaa, 0xd5, 0x77, 0xf8, 0x98, 0x02, 0x2c, 0x9a, 0xa3, 0x46, 0xdd, 0x99, 0x65, 0x9b, 0xa7, 0x2b, 0xac, 0x09, 0x81, 0x16, 0x27, 0xfd, 0x13, 0x62, 0x6c, 0x6e, 0x4f, 0x71, 0xe0, 0xe8, 0xb2, 0xb9, 0x70, 0x68, 0xda, 0xf6, 0x61, 0xe4, 0xfb, 0x22, 0xf2, 0xc1, 0xee, 0xd2, 0x90, 0x0c, 0xbf, 0xb3, 0xa2, 0xf1, 0x51, 0x33, 0x91, 0xeb, 0xf9, 0x0e, 0xef, 0x6b, 0x31, 0xc0, 0xd6, 0x1f, 0xb5, 0xc7, 0x6a, 0x9d, 0xb8, 0x54, 0xcc, 0xb0, 0x73, 0x79, 0x32, 0x2d, 0x7f, 0x04, 0x96, 0xfe, 0x8a, 0xec, 0xcd, 0x5d, 0xde, 0x72, 0x43, 0x1d, 0x18, 0x48, 0xf3, 0x8d, 0x80, 0xc3, 0x4e, 0x42, 0xd7, 0x3d, 0x9c, 0xb4];
const EDGE_SIGNS = [1, 1, 0, 0, -1, 1, 0, 0, 1, -1, 0, 0, -1, -1, 0, 0, 1, 0, 1, 0, -1, 0, 1, 0, 1, 0, -1, 0, -1, 0, -1, 0, 0, 1, 1, 0, 0, -1, 1, 0, 0, 1, -1, 0, 0, -1, -1, 0];

const sqrt312 = (Math.sqrt(3) - 1) / 2;
const sqrt336 = (3 - Math.sqrt(3)) / 6;
const BASE_Y = 512 * 14;
const BIOME_H = 48;
const SINCOS_WOBBLE = true;

const EDGE_NOISE_2 = [];
const EDGE_NOISE_M12 = [];
for (let i = 0; i < 512; i++) {
    const t = EDGE_NOISE[i & 0xff];
    EDGE_NOISE_2.push(t);
    EDGE_NOISE_M12.push(t % 0xc);
}

function Mod(a, b) { return ((a % b) + b) % b; }
function SampleBiome(x, y) { return Mod(x, 2) * 2 + Mod(y, 2); }

function ComputeMagicValueFromDoubles(x, y) {
    let dVar3, dVar4, dVar5, dVar6, dVar7, dVar8, dVar9, dVar10, dVar11;
    let uVar1, uVar2;

    dVar7 = (x + y) * sqrt312;
    dVar6 = dVar7 + x;
    uVar2 = dVar6 >>> 0;
    if (dVar6 < uVar2) uVar2 -= 1;

    dVar7 = dVar7 + y;
    uVar1 = dVar7 >>> 0;
    if (dVar7 < uVar1) uVar1 -= 1;

    dVar6 = (uVar1 + uVar2) * sqrt336;
    dVar10 = x - (uVar2 - dVar6);
    dVar9 = y - (uVar1 - dVar6);
    uVar1 &= 0xff;
    uVar2 &= 0xff;
    dVar8 = 0.0;
    dVar7 = (dVar10 - (dVar9 < dVar10 ? 1 : 0)) + sqrt336;
    dVar3 = (dVar9 - (dVar10 <= dVar9 ? 1 : 0)) + sqrt336;
    dVar11 = (dVar10 - 1.0) + sqrt336 * 2.0;
    dVar4 = (dVar9 - 1.0) + sqrt336 * 2.0;
    dVar5 = (0.5 - dVar10 * dVar10) - dVar9 * dVar9;
    dVar6 = dVar8;
    if (0.0 <= dVar5) {
        dVar6 = (EDGE_SIGNS[EDGE_NOISE_M12[EDGE_NOISE_2[uVar1] + uVar2] * 4 + 1] * dVar9 +
            EDGE_SIGNS[EDGE_NOISE_M12[EDGE_NOISE_2[uVar1] + uVar2] * 4] * dVar10) * dVar5 * dVar5 * dVar5 * dVar5;
    }
    dVar5 = (0.5 - dVar7 * dVar7) - dVar3 * dVar3;
    if (0.0 <= dVar5) {
        dVar7 = (EDGE_SIGNS[EDGE_NOISE_M12[EDGE_NOISE_2[(dVar10 <= dVar9 ? 1 : 0) + uVar1] + uVar2 + (dVar9 < dVar10 ? 1 : 0)] * 4 + 1] * dVar3 +
            EDGE_SIGNS[EDGE_NOISE_M12[EDGE_NOISE_2[(dVar10 <= dVar9 ? 1 : 0) + uVar1] + uVar2 + (dVar9 < dVar10 ? 1 : 0)] * 4] * dVar7) * dVar5 * dVar5 * dVar5 * dVar5;
    } else {
        dVar7 = 0.0;
    }
    dVar3 = (0.5 - dVar11 * dVar11) - dVar4 * dVar4;
    if (0.0 <= dVar3) {
        dVar8 = (EDGE_SIGNS[EDGE_NOISE_M12[EDGE_NOISE_2[uVar1 + 1] + uVar2 + 1] * 4 + 1] * dVar4 +
            EDGE_SIGNS[EDGE_NOISE_M12[EDGE_NOISE_2[uVar1 + 1] + uVar2 + 1] * 4] * dVar11) * dVar3 * dVar3 * dVar3 * dVar3;
    }
    return (dVar7 + dVar6 + dVar8) * 70.0;
}

function GetOriginalChunkPosIdAt(x, y, isNGP = false, gameMode = 'normal') {
    const biomeW = getWorldSize(isNGP, gameMode);
    const shifted_x = x + 512 * (biomeW / 2);
    const shifted_y = y + 512 * 14;
    const chunkX = Mod(Math.floor(shifted_x / 512), biomeW);
    const chunkY = Math.floor(shifted_y / 512);
    return SampleBiome(chunkX, chunkY);
}

export function GetTrueChunkPosIdAt(x, y, isNGP = false, highDetail = true, gameMode = 'normal') {
    const shifted_x = x + 512 * getWorldCenter(isNGP, gameMode);
    const shifted_y = y + BASE_Y;
    const subchunk_x = Math.floor(shifted_x) & 0x1ff;
    const subchunk_y = Math.floor(shifted_y) & 0x1ff;
    const new_x = 70;
    let chunk_x = (Math.floor(shifted_x) >> 9) % new_x;
    let chunk_y = Math.floor(shifted_y) >> 9;
    if (chunk_x < 0) chunk_x += new_x;
    let new_y = BIOME_H - 1;
    if (chunk_y < new_y) new_y = chunk_y;
    chunk_y = new_y > 0 ? new_y : 0;
    const biome = SampleBiome(chunk_x, chunk_y);
    if (subchunk_x < 42 || subchunk_y < 42 || subchunk_x > 470 || subchunk_y > 470) {
        return GetWobbledBiome(shifted_x, shifted_y, highDetail);
    }
    return biome;
}

function GetWobbledBiome(shifted_x, shifted_y, highDetail = true) {
    let x2 = 0;
    let y2 = 0;
    if (!SINCOS_WOBBLE) {
        if (highDetail) x2 = ComputeMagicValueFromDoubles(shifted_x * 0.05, shifted_y * 0.05);
        x2 = x2 * 2.5;
        y2 = x2;
    } else {
        if (highDetail) y2 = ComputeMagicValueFromDoubles(shifted_x * 0.05, shifted_y * 0.05);
        const dVar1 = Math.sin(shifted_y * 0.005);
        x2 = Math.cos(shifted_x * 0.005);
        x2 = x2 * 30.0 + y2 * 11.0;
        y2 = dVar1 * 30.0 + y2 * 11.0;
    }
    return SampleBiome(Math.floor(y2 + shifted_x) >> 9, Math.floor(x2 + shifted_y) >> 9);
}

export function GetBiomeOffset(x, y, isNGP = false, highDetail = true) {
    const originalBiomeId = GetOriginalChunkPosIdAt(x, y, isNGP);
    const trueBiomeId = GetTrueChunkPosIdAt(x, y, isNGP, highDetail);
    const isDiffY = Mod(trueBiomeId - originalBiomeId, 2);
    const isDiffX = Mod(Math.floor(trueBiomeId / 2) - Math.floor(originalBiomeId / 2), 2);
    const signX = Mod(x, 512) < 42 ? -1 : (Mod(x, 512) > 470 ? 1 : 0);
    const signY = Mod(y, 512) < 42 ? -1 : (Mod(y, 512) > 470 ? 1 : 0);
    return { x: isDiffX * signX, y: isDiffY * signY };
}

// ----- getBiomeAtWorldCoordinates (verbatim from js/utils.js) -----

// Mutable settings object — verify.mjs tweaks these from command-line flags.
export const appSettings = {
    enableEdgeNoise: true,
    fixHolyMountainEdgeNoise: true,
};

export function getBiomeAtWorldCoordinates(biomeData, worldX, worldY, isNGP = false, gameMode = 'normal') {
    let biomeMap = biomeData.pixels;
    if (worldY < -14 * 512) biomeMap = biomeData.heavenPixels;
    else if (worldY > 34 * 512) biomeMap = biomeData.hellPixels;
    const mapWidth = getWorldSize(isNGP, gameMode);
    const worldSize = mapWidth * 512;
    const worldCenter = worldSize / 2;
    const modX = ((worldX + worldCenter) % worldSize + worldSize) % worldSize;
    const modY = ((worldY + 14 * 512) % 24576 + 24576) % 24576;

    const edgeOffset = GetBiomeOffset(worldX, worldY, isNGP, true);
    if (!appSettings.enableEdgeNoise) { edgeOffset.x = 0; edgeOffset.y = 0; }

    const originalX = Math.floor(modX / 512);
    const originalY = Math.floor(modY / 512);
    let biomePixelX = originalX + edgeOffset.x;
    let biomePixelY = originalY + edgeOffset.y;
    biomePixelX = ((biomePixelX % mapWidth) + mapWidth) % mapWidth;
    biomePixelY = Math.max(0, Math.min(47, biomePixelY));

    const idx = biomePixelY * mapWidth + biomePixelX;
    const colorInt = biomeMap[idx] & 0xffffff;
    let biomeName = BIOME_COLOR_TO_NAME[colorInt];
    if (!BIOME_COLORS_WITH_TILES.has(colorInt)) biomeName = null;

    if (appSettings.fixHolyMountainEdgeNoise) {
        const origIdx = originalY * mapWidth + originalX;
        const origColorInt = biomeMap[origIdx] & 0xffffff;
        const origBiomeName = BIOME_COLOR_TO_NAME[origColorInt];
        const colorIneligible = (color) => colorWobbleVerdict(color) === 'ineligible';
        let skipWobble = colorIneligible(origColorInt) || colorIneligible(colorInt);
        if (!skipWobble) {
            const subWX = ((worldX % 512) + 512) % 512;
            const subWY = ((worldY % 512) + 512) % 512;
            const probes = [];
            if (subWX < 42) probes.push([originalX - 1, originalY]);
            if (subWY < 42) probes.push([originalX, originalY - 1]);
            if (subWX > 470) probes.push([originalX + 1, originalY]);
            if (subWY > 470) probes.push([originalX, originalY + 1]);
            if (subWX < 42) {
                if (subWY < 42) probes.push([originalX - 1, originalY - 1]);
                if (subWY > 470) probes.push([originalX - 1, originalY + 1]);
            }
            if (subWX > 470) {
                if (subWY < 42) probes.push([originalX + 1, originalY - 1]);
                if (subWY > 470) probes.push([originalX + 1, originalY + 1]);
            }
            let foundDifferingNeighbor = false;
            for (const [pcx, pcy] of probes) {
                const ncx = ((pcx % mapWidth) + mapWidth) % mapWidth;
                const ncy = Math.max(0, Math.min(47, pcy));
                const nIdx = ncy * mapWidth + ncx;
                if (nIdx < 0 || nIdx >= biomeMap.length) continue;
                const ncolor = biomeMap[nIdx] & 0xffffff;
                if (ncolor === origColorInt) continue;
                foundDifferingNeighbor = true;
                if (colorIneligible(ncolor)) skipWobble = true;
                break;
            }
            if (probes.length > 0 && !foundDifferingNeighbor) skipWobble = true;
        }
        if (skipWobble) {
            biomePixelX = originalX;
            biomePixelY = originalY;
            biomeName = origBiomeName;
        }
    }

    const finalColorInt = biomeMap[biomePixelY * mapWidth + biomePixelX] & 0xffffff;
    return {
        biome: biomeName || null,
        colorInt: finalColorInt,
        pos: { x: biomePixelX, y: biomePixelY },
        originalPos: { x: originalX, y: originalY },
        mightBeEdgeCase: edgeOffset.x !== 0 || edgeOffset.y !== 0,
    };
}

// ----- IO helpers shared by the verification script -----

export async function loadBiomeData(pngPath = 'data/biome_maps/biome_map.png') {
    const img = await loadImage(pngPath);
    const c = createCanvas(img.width, img.height);
    const ctx = c.getContext('2d');
    ctx.drawImage(img, 0, 0);
    const data = ctx.getImageData(0, 0, img.width, img.height).data;
    const pixels = new Uint32Array(img.width * img.height);
    for (let i = 0; i < pixels.length; i++) {
        pixels[i] = 0xff000000 | (data[i * 4] << 16) | (data[i * 4 + 1] << 8) | data[i * 4 + 2];
    }
    const heavenPixels = new Uint32Array(pixels.length);
    const hellPixels = new Uint32Array(pixels.length);
    for (let y = 0; y < img.height; y++) {
        for (let x = 0; x < img.width; x++) {
            heavenPixels[y * img.width + x] = pixels[x % img.width];
            hellPixels[y * img.width + x] = pixels[(img.height - 1) * img.width + (x % img.width)];
        }
    }
    return { pixels, heavenPixels, hellPixels, width: img.width, height: img.height };
}

export function readDump(path) {
    const buf = readFileSync(path);
    return path.endsWith('.gz') ? gunzipSync(buf).toString('utf8') : buf.toString('utf8');
}

// ----- telescope key ↔ noita XML-name canonicalization -----

// Most telescope biome keys match noita's XML filename 1:1 (coalmine,
// snowcave, the_end, the_sky, lake_deep, temple_altar, …). This helper
// collapses the remaining mismatches so the two sides compare cleanly.
//
// Source of mismatches: noita has multiple XMLs where telescope's biome-map
// encodes a single key — tower solid_wall_tower_N, orbroom_NN, temple_altar
// left/right variants. We canonicalize all of those to telescope's coarser
// key. The function is idempotent: feed it either a telescope key or a noita
// xmlName and it returns the same token for equivalent biomes.
export function canonicalBiome(name) {
    if (name == null) return null;
    // Towers: telescope has per-origin keys (tower_coalmine, tower_vault, …);
    // noita numbers them (solid_wall_tower_1…9). Fold both to 'tower'.
    if (/^solid_wall_tower_\d+$/.test(name)) return 'tower';
    if (name.startsWith('tower_')) return 'tower';
    // Orbrooms: noita has orbroom_NN XMLs; telescope has a single orbroom_marker key.
    if (/^orbroom_\d+$/.test(name)) return 'orbroom_marker';
    // Holy-mountain XMLs noita splits into: the wang-tiled interior
    // (temple_altar + L/R/snowcastle variants) and the stone frame
    // (temple_wall, temple_wall_ending, solid_wall_temple) — which telescope
    // does not render as biomes. Collapse all to 'temple_altar'.
    if (name.startsWith('temple_altar')) return 'temple_altar';
    if (name === 'temple_wall' || name === 'temple_wall_ending' || name === 'solid_wall_temple') return 'temple_altar';
    // Pyramid side-rooms (noita has pyramid + pyramid_hallway + pyramid_right).
    if (name === 'pyramid_right' || name === 'pyramid_hallway') return 'pyramid';
    // Sub-biomes telescope doesn't distinguish but noita does.
    if (name === 'lava_90percent') return 'lava';
    if (name === 'scale') return 'desert';
    if (name === 'meatroom') return 'meat';
    if (name === 'roboroom') return 'robobase';
    if (name === 'boss_arena_top') return 'boss_arena';
    // Hell victory-room: noita's boss_victoryroom.xml aligns with telescope's the_end key.
    if (name === 'boss_victoryroom') return 'the_end';
    // Telescope's 'snowchasm' biome-map color is actually served by noita's winter_caves.xml.
    if (name === 'snowchasm') return 'winter_caves';
    return name;
}

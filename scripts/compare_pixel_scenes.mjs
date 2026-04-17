// Diff telescope's 4-corner pixel-scene bounds check against the set of
// scenes Noita actually placed. Reports how many Noita placements
// telescope would reject — i.e., the false-negative cost of the
// 4-corner check.
//
//   node scripts/compare_pixel_scenes.mjs                          # default fixture
//   node scripts/compare_pixel_scenes.mjs --input=PATH             # different dump
//   node scripts/compare_pixel_scenes.mjs --data-wak=PATH          # alt unpack root
//   node scripts/compare_pixel_scenes.mjs --dump=20                # show N rejects
//   node scripts/compare_pixel_scenes.mjs --top-left-only          # simulate the
//                                                                  # proposed fix
//
// We can't easily drive telescope's full per-chunk generation here —
// pixel_scene_generation.js transitively imports CDN-only modules that
// Node refuses. Instead we ask the inverse question: for every scene
// Noita placed, would telescope's loadPixelScene gate accept it? That
// captures the bug we care about.

import { readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { join } from 'node:path';
import { createCanvas, loadImage } from 'canvas';
import { BIOME_COLOR_TO_NAME, BIOME_COLORS_WITH_TILES, BIOMES_WITHOUT_WAVY_EDGE } from '../js/generator_config.js';
import { GetBiomeOffset } from './_edge_noise_shim.js';
import { colorWobbleVerdict } from '../js/wobble_flags.js';

const DEFAULT_INPUT = 'data/dumps/pixel_scenes.ndjson.gz';
const DEFAULT_WAK = `${process.env.HOME}/reverse/noita/noita_Jan_25_2025_15:55:41/data/data.wak.unpacked`;

const appSettings = { enableEdgeNoise: true, fixHolyMountainEdgeNoise: true };

function getWorldSize(isNGP, gameMode) {
    if (gameMode === 'nightmare') return 64;
    return isNGP ? 64 : 70;
}

// Same getBiomeAtWorldCoordinates as compare_wobble.mjs (kept in sync
// manually — both files inline a copy because pulling utils.js into Node
// drags in CDN-only deps). If you change one, change the other.
function getBiomeAtWorldCoordinates(biomeData, worldX, worldY, isNGP = false, gameMode='normal') {
    let biomeMap = biomeData.pixels;
    if (worldY < -14*512) biomeMap = biomeData.heavenPixels;
    else if (worldY > 34*512) biomeMap = biomeData.hellPixels;
    const mapWidth = getWorldSize(isNGP, gameMode);
    const worldSize = mapWidth * 512;
    const worldCenter = worldSize / 2;
    const modX = ((worldX + worldCenter) % worldSize + worldSize) % worldSize;
    const modY = ((worldY + 14*512) % 24576 + 24576) % 24576;

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
        const colorIneligible = (color) => {
            const v = colorWobbleVerdict(color);
            return v === 'ineligible' || (v === 'unknown' && BIOMES_WITHOUT_WAVY_EDGE.has(color));
        };
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
            if (probes.length > 0 && !foundDifferingNeighbor) {
                skipWobble = true;
            }
        }
        if (skipWobble) {
            biomePixelX = originalX;
            biomePixelY = originalY;
            biomeName = origBiomeName;
        }
    }
    const finalIdx = biomePixelY * mapWidth + biomePixelX;
    const finalColorInt = (finalIdx >= 0 && finalIdx < biomeMap.length)
        ? biomeMap[finalIdx] & 0xffffff
        : 0;
    return { biome: biomeName || null, colorInt: finalColorInt, pos: {x: biomePixelX, y: biomePixelY} };
}

function parseArgs() {
    const opts = { input: DEFAULT_INPUT, dataWak: DEFAULT_WAK, dump: 0, topLeftOnly: false };
    for (const a of process.argv.slice(2)) {
        if (a.startsWith('--input=')) opts.input = a.slice('--input='.length);
        else if (a.startsWith('--data-wak=')) opts.dataWak = a.slice('--data-wak='.length);
        else if (a.startsWith('--dump=')) opts.dump = +a.slice('--dump='.length);
        else if (a === '--top-left-only') opts.topLeftOnly = true;
        else if (!a.startsWith('--')) opts.input = a;
    }
    return opts;
}

function readDump(path) {
    const buf = readFileSync(path);
    return path.endsWith('.gz') ? gunzipSync(buf).toString('utf8') : buf.toString('utf8');
}

async function loadBiomeData(pngPath = 'data/biome_maps/biome_map.png') {
    const img = await loadImage(pngPath);
    const c = createCanvas(img.width, img.height);
    const ctx = c.getContext('2d');
    ctx.drawImage(img, 0, 0);
    const data = ctx.getImageData(0, 0, img.width, img.height).data;
    const pixels = new Uint32Array(img.width * img.height);
    for (let i = 0; i < pixels.length; i++) {
        pixels[i] = 0xff000000 | (data[i*4] << 16) | (data[i*4+1] << 8) | data[i*4+2];
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

// PNG header parser — width is at byte 16, height at byte 20 (32-bit BE).
// Avoids loading the whole image when we only need dimensions.
const sceneSizeCache = new Map();
function getSceneSize(materialsFile, dataWak) {
    if (sceneSizeCache.has(materialsFile)) return sceneSizeCache.get(materialsFile);
    const rel = materialsFile.replace(/^data\//, '');
    const path = join(dataWak, rel);
    let result = null;
    try {
        const buf = readFileSync(path);
        if (buf.length > 24 && buf.toString('ascii', 1, 4) === 'PNG') {
            const w = buf.readUInt32BE(16);
            const h = buf.readUInt32BE(20);
            result = { width: w, height: h };
        }
    } catch {
        // file missing or unreadable — leave as null
    }
    sceneSizeCache.set(materialsFile, result);
    return result;
}

// Telescope's 4-corner check (verbatim from loadPixelScene). Returns
// { ok, biomeName, cornersChecked, cornersAgreed } so we can both
// classify AND inspect failures.
function checkBoundsFourCorners(biomeData, x, y, width, height) {
    const tl = getBiomeAtWorldCoordinates(biomeData, x, y, false, 'normal');
    const biomeName = tl.biome;
    if (!biomeName) return { ok: false, biomeName: null, reason: 'top-left null' };
    const corners = [
        ['top-right',     x + width, y],
        ['bottom-left',   x,         y + height],
        ['bottom-right',  x + width, y + height],
    ];
    for (const [label, cx, cy] of corners) {
        const r = getBiomeAtWorldCoordinates(biomeData, cx, cy, false, 'normal');
        if (!r.biome || r.biome !== biomeName) {
            return { ok: false, biomeName, reason: `${label} resolved to ${r.biome || '(null)'}` };
        }
    }
    return { ok: true, biomeName };
}

// Proposed-fix check: only validate the top-left. Accept when telescope
// resolved a tile-having biome name OR when the wobbled position's color
// is in the biome XML catalogue (data/biome_flags.json), which covers
// biomes telescope can't render (mountain/overworld/temple-altar-top)
// but Noita places into.
function checkBoundsTopLeftOnly(biomeData, x, y) {
    const tl = getBiomeAtWorldCoordinates(biomeData, x, y, false, 'normal');
    if (!tl) return { ok: false, biomeName: null, reason: 'top-left unresolved' };
    if (tl.biome) return { ok: true, biomeName: tl.biome };
    const verdict = colorWobbleVerdict(tl.colorInt);
    if (verdict !== 'unknown') {
        return { ok: true, biomeName: '(no-tile biome)' };
    }
    return { ok: false, biomeName: null, reason: `top-left null, color 0x${tl.colorInt.toString(16).padStart(6, '0')} not in catalogue` };
}

async function main() {
    const opts = parseArgs();
    const biomeData = await loadBiomeData();
    const text = readDump(opts.input);

    let total = 0,
        accepted = 0,
        rejected = 0,
        sizeMissing = 0;
    const rejectsByReason = new Map();
    const rejectsByBiome = new Map();
    const sample = [];

    for (const line of text.split('\n')) {
        if (!line || line.startsWith('#') || !line.startsWith('{')) continue;
        let scene;
        try { scene = JSON.parse(line); } catch { continue; }
        if (!scene.materialsFile) continue;
        total++;

        const size = getSceneSize(scene.materialsFile, opts.dataWak);
        if (!size) {
            sizeMissing++;
            continue;
        }

        const verdict = opts.topLeftOnly
            ? checkBoundsTopLeftOnly(biomeData, scene.x, scene.y)
            : checkBoundsFourCorners(biomeData, scene.x, scene.y, size.width, size.height);

        if (verdict.ok) {
            accepted++;
        } else {
            rejected++;
            rejectsByReason.set(verdict.reason, (rejectsByReason.get(verdict.reason) || 0) + 1);
            const biome = verdict.biomeName || '(unresolved)';
            rejectsByBiome.set(biome, (rejectsByBiome.get(biome) || 0) + 1);
            if (sample.length < opts.dump) {
                sample.push({
                    x: scene.x, y: scene.y,
                    file: scene.materialsFile,
                    size: `${size.width}x${size.height}`,
                    biome: verdict.biomeName,
                    reason: verdict.reason,
                });
            }
        }
    }

    const decided = total - sizeMissing;
    console.log(`pixel scenes in fixture:    ${total}`);
    console.log(`size missing (skip):        ${sizeMissing}`);
    console.log(`decided:                    ${decided}`);
    console.log(`  telescope ACCEPT:         ${accepted}  (${(100*accepted/decided).toFixed(2)}%)`);
    console.log(`  telescope REJECT:         ${rejected}  (${(100*rejected/decided).toFixed(2)}%)`);
    console.log(`mode: ${opts.topLeftOnly ? 'top-left only (proposed fix)' : '4-corner same-biome (current loadPixelScene)'}`);

    if (rejectsByBiome.size) {
        console.log('\nRejects by top-left biome:');
        for (const [biome, count] of [...rejectsByBiome.entries()].sort((a,b) => b[1] - a[1])) {
            console.log(`  ${count.toString().padStart(4)}  ${biome}`);
        }
    }
    if (rejectsByReason.size) {
        console.log('\nRejects by failure reason (top 15):');
        const sorted = [...rejectsByReason.entries()].sort((a,b) => b[1] - a[1]).slice(0, 15);
        for (const [reason, count] of sorted) {
            console.log(`  ${count.toString().padStart(4)}  ${reason}`);
        }
    }
    if (sample.length) {
        console.log(`\nFirst ${sample.length} rejects:`);
        for (const s of sample) {
            console.log(`  (${s.x}, ${s.y}) ${s.size}  biome=${s.biome}  ${s.file}`);
            console.log(`     reason: ${s.reason}`);
        }
    }
}

main().catch((e) => { console.error(e); process.exit(1); });

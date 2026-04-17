// Verify telescope's map generator against Noita-captured fixtures.
//
// Runs three agreement checks against live-game data captured via
// `noitrainer` (see `data/dumps/README.md`):
//
//   biomes        — telescope's biome-map color → name table matches
//                   Noita's per-chunk biome name for every loaded chunk.
//   wobble        — telescope's getBiomeAtWorldCoordinates resolves the
//                   same chunk + biome name as Noita's
//                   ChunkGrid_ResolveChunkAtPosition, for every probed coord.
//   pixel-scenes  — telescope's pixel-scene placement gate (4-corner
//                   same-biome check) accepts scenes Noita actually placed.
//
// Usage:
//   node scripts/verify.mjs                              # all three sections
//   node scripts/verify.mjs --only=biomes|wobble|pixel-scenes
//   node scripts/verify.mjs --flags=PATH                 # biomes/wobble fixture (biome_flags dump)
//   node scripts/verify.mjs --resolutions=PATH           # wobble fixture (biome_at dump)
//   node scripts/verify.mjs --scenes=PATH                # pixel-scene fixture
//   node scripts/verify.mjs --data-wak=PATH              # noita unpack root (for scene PNG sizes)
//   node scripts/verify.mjs --dump=N                     # show first N disagreements / rejects
//   node scripts/verify.mjs --dump-chunk=N               # wobble: show N chunk-idx disagreements
//   node scripts/verify.mjs --filter-wt=sin-cos+simplex  # wobble: filter --dump by wobbleType
//   node scripts/verify.mjs --no-edge-noise              # wobble: disable telescope's wobble entirely
//   node scripts/verify.mjs --no-fix-hm-edge-noise       # wobble: disable holy-mountain wobble gate
//   node scripts/verify.mjs --top-left-only              # pixel-scenes: alternate (relaxed) check
//   node scripts/verify.mjs --images[=DIR]               # also emit per-section PNGs (default data/verify_out/)

import { mkdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
    appSettings,
    canonicalBiome,
    getBiomeAtWorldCoordinates,
    loadBiomeData,
    readDump,
} from './_engine_shim.js';
import { BIOME_COLOR_TO_NAME, BIOME_COLORS_WITH_TILES } from '../js/generator_config.js';
import { colorWobbleVerdict } from '../js/wobble_flags.js';
import { renderBiomesDiff, renderPixelScenes, renderWobbleHeatmap } from './_visual.mjs';

const DEFAULTS = {
    flags: 'data/dumps/biome_flags.ndjson.gz',
    resolutions: 'data/dumps/biome_at_resolutions.ndjson.gz',
    scenes: 'data/dumps/pixel_scenes.ndjson.gz',
    dataWak: `${process.env.HOME}/reverse/noita/noita_Jan_25_2025_15:55:41/data/data.wak.unpacked`,
    biomeMap: 'data/biome_maps/biome_map.png',
};

function parseArgs(argv) {
    const opts = {
        only: null,
        flags: DEFAULTS.flags,
        resolutions: DEFAULTS.resolutions,
        scenes: DEFAULTS.scenes,
        dataWak: DEFAULTS.dataWak,
        biomeMap: DEFAULTS.biomeMap,
        dump: 0,
        dumpChunk: 0,
        filterWt: null,
        enableEdgeNoise: true,
        fixHM: true,
        topLeftOnly: false,
        images: null,
    };
    for (const a of argv) {
        if (a.startsWith('--only=')) opts.only = a.slice('--only='.length);
        else if (a.startsWith('--flags=')) opts.flags = a.slice('--flags='.length);
        else if (a.startsWith('--resolutions=')) opts.resolutions = a.slice('--resolutions='.length);
        else if (a.startsWith('--scenes=')) opts.scenes = a.slice('--scenes='.length);
        else if (a.startsWith('--data-wak=')) opts.dataWak = a.slice('--data-wak='.length);
        else if (a.startsWith('--biome-map=')) opts.biomeMap = a.slice('--biome-map='.length);
        else if (a.startsWith('--dump=')) opts.dump = +a.slice('--dump='.length);
        else if (a.startsWith('--dump-chunk=')) opts.dumpChunk = +a.slice('--dump-chunk='.length);
        else if (a.startsWith('--filter-wt=')) opts.filterWt = a.slice('--filter-wt='.length);
        else if (a === '--no-edge-noise') opts.enableEdgeNoise = false;
        else if (a === '--no-fix-hm-edge-noise') opts.fixHM = false;
        else if (a === '--top-left-only') opts.topLeftOnly = true;
        else if (a === '--images') opts.images = 'data/verify_out';
        else if (a.startsWith('--images=')) opts.images = a.slice('--images='.length);
        else {
            console.error(`unknown arg: ${a}`);
            process.exit(1);
        }
    }
    return opts;
}

// ========== biomes section ==========

function parseBiomeFlagsDump(path) {
    const text = readDump(path);
    const out = new Map();
    for (const line of text.split('\n')) {
        if (!line || line.startsWith('#') || line.startsWith('Looking') || line.startsWith('Found')) continue;
        if (!line.startsWith('{')) continue;
        try {
            const o = JSON.parse(line);
            if (o.cx == null || o.cy == null || !o.xmlName) continue;
            out.set(`${o.cx},${o.cy}`, { cx: o.cx, cy: o.cy, name: o.name, xmlName: o.xmlName });
        } catch {}
    }
    return out;
}

function telescopeChunkGrid(biomeData) {
    const out = new Map();
    for (let y = 0; y < biomeData.height; y++) {
        for (let x = 0; x < biomeData.width; x++) {
            const color = biomeData.pixels[y * biomeData.width + x] & 0xffffff;
            const biomeName = BIOME_COLOR_TO_NAME[color] || null;
            const hasTile = BIOME_COLORS_WITH_TILES.has(color);
            out.set(`${x},${y}`, { cx: x, cy: y, color, biomeName, hasTile });
        }
    }
    return out;
}

function runBiomesSection(biomeData, opts) {
    const noitaMap = parseBiomeFlagsDump(opts.flags);
    const telescopeGrid = telescopeChunkGrid(biomeData);

    let agree = 0, disagreeName = 0, telescopeUnknown = 0, skippedEmpty = 0,
        notInTelescope = 0, onlyInTelescope = 0;
    const rows = [];
    for (const [key, noita] of noitaMap) {
        // _EMPTY_ and ??? are chunks noita allocated but never filled with a
        // named biome — nothing for telescope's color-table to validate
        // against.
        if (noita.name === '_EMPTY_' || noita.name === '???') { skippedEmpty++; continue; }
        const tel = telescopeGrid.get(key);
        if (!tel) { notInTelescope++; continue; }
        const telCanon = canonicalBiome(tel.biomeName);
        const noitaCanon = canonicalBiome(noita.xmlName);
        if (!telCanon) {
            telescopeUnknown++;
            rows.push({
                cx: noita.cx, cy: noita.cy, noita: noita.xmlName,
                telescope: '(no key for color 0x' + tel.color.toString(16).padStart(6, '0') + ')',
                color: '0x' + tel.color.toString(16).padStart(6, '0'),
            });
            continue;
        }
        if (telCanon === noitaCanon) agree++;
        else {
            disagreeName++;
            rows.push({
                cx: noita.cx, cy: noita.cy, noita: noita.xmlName, telescope: tel.biomeName,
                color: '0x' + tel.color.toString(16).padStart(6, '0'),
            });
        }
    }
    for (const [key] of telescopeGrid) if (!noitaMap.has(key)) onlyInTelescope++;
    const decided = agree + disagreeName + telescopeUnknown;

    console.log('=== biomes ===');
    console.log(`telescope map: ${biomeData.width}x${biomeData.height}`);
    console.log(`noita chunks dumped: ${noitaMap.size}, _EMPTY_ skipped: ${skippedEmpty}, decided: ${decided}`);
    console.log(`  agree:                 ${agree}  (${(100 * agree / Math.max(1, decided)).toFixed(1)}%)`);
    console.log(`  name disagreement:     ${disagreeName}`);
    console.log(`  telescope color unknown: ${telescopeUnknown}`);
    console.log(`  in noita, not in telescope grid: ${notInTelescope}`);
    console.log(`  in telescope grid, not loaded by noita: ${onlyInTelescope}`);

    if (rows.length) {
        const buckets = new Map();
        for (const r of rows) {
            const k = `${r.noita} ↔ ${r.telescope}`;
            const b = buckets.get(k) || { count: 0, sample: r };
            b.count++;
            buckets.set(k, b);
        }
        console.log('\n-- Disagreement buckets --');
        const bucketList = [...buckets.entries()].sort((a, b) => b[1].count - a[1].count);
        for (const [k, b] of bucketList) {
            console.log(`  [${String(b.count).padStart(4)}]  ${k}    (e.g. cx=${b.sample.cx} cy=${b.sample.cy} color=${b.sample.color})`);
        }
    }

    if (opts.images) {
        const outPath = join(opts.images, 'biomes.png');
        renderBiomesDiff(biomeData, noitaMap, telescopeGrid, outPath);
        console.log(`wrote ${outPath}`);
    }
}

// ========== wobble section ==========

function runWobbleSection(biomeData, opts) {
    const text = readDump(opts.resolutions);
    let total = 0, agree = 0, chunkAgree = 0, chunkDecided = 0, telescopeNull = 0,
        skippedNoOriginal = 0, skippedEmpty = 0;
    const disagreements = [];
    const chunkSample = [];
    const buckets = new Map();
    const wobbleTypeStats = new Map();
    const W = biomeData.width, H = biomeData.height;
    const nameStats  = { agree: new Uint32Array(W * H), disagree: new Uint32Array(W * H) };
    const chunkStats = { agree: new Uint32Array(W * H), disagree: new Uint32Array(W * H) };

    for (const line of text.split('\n')) {
        if (!line) continue;
        let n;
        try { n = JSON.parse(line); } catch { continue; }
        if (!n || !n.original) { skippedNoOriginal++; continue; }
        const noitaXml = (n.resolved && n.resolved.xmlName) || n.original.xmlName;
        const noitaNameRaw = (n.resolved && n.resolved.name) || n.original.name;
        if (noitaNameRaw === '_EMPTY_' || noitaNameRaw === '???' || !noitaXml) { skippedEmpty++; continue; }
        const noitaCanon = canonicalBiome(noitaXml);
        total++;

        const tRes = getBiomeAtWorldCoordinates(biomeData, n.wx, n.wy, false, 'normal');
        const telCanon = tRes && tRes.biome ? canonicalBiome(tRes.biome) : null;
        if (!telCanon) telescopeNull++;

        const inGrid = n.origCX >= 0 && n.origCX < W && n.origCY >= 0 && n.origCY < H;
        const cellIdx = inGrid ? n.origCY * W + n.origCX : -1;

        if (tRes && tRes.pos && n.resolved) {
            chunkDecided++;
            const chunkOk = tRes.pos.x === n.resolved.cx && tRes.pos.y === n.resolved.cy;
            if (inGrid) {
                if (chunkOk) chunkStats.agree[cellIdx]++;
                else chunkStats.disagree[cellIdx]++;
            }
            if (chunkOk) {
                chunkAgree++;
            } else if (telCanon === noitaCanon && chunkSample.length < (opts.dumpChunk || 0)) {
                chunkSample.push({
                    wx: n.wx, wy: n.wy, subX: n.subX, subY: n.subY, wt: n.wobbleType,
                    orig: [n.origCX, n.origCY],
                    noita: [n.resolved.cx, n.resolved.cy],
                    tele: [tRes.pos.x, tRes.pos.y],
                    neighborDir: n.neighborDir,
                });
            }
        }

        const wt = n.wobbleType || 'unknown';
        const wstat = wobbleTypeStats.get(wt) || { agree: 0, disagree: 0, telescopeNull: 0, chunkAgree: 0, chunkDecided: 0 };
        if (tRes && tRes.pos && n.resolved) {
            wstat.chunkDecided++;
            if (tRes.pos.x === n.resolved.cx && tRes.pos.y === n.resolved.cy) wstat.chunkAgree++;
        }

        if (telCanon === noitaCanon) {
            agree++;
            wstat.agree++;
            if (inGrid) nameStats.agree[cellIdx]++;
        } else if (telCanon == null) {
            wstat.telescopeNull++;
        } else {
            if (inGrid) nameStats.disagree[cellIdx]++;
            const k = `${noitaXml} ↔ ${tRes.biome}`;
            const b = buckets.get(k) || { count: 0, sample: null, byWobbleType: new Map() };
            b.count++;
            if (!b.sample) b.sample = { wx: n.wx, wy: n.wy, wobbleType: wt };
            b.byWobbleType.set(wt, (b.byWobbleType.get(wt) || 0) + 1);
            buckets.set(k, b);
            wstat.disagree++;
            if (disagreements.length < opts.dump && (!opts.filterWt || opts.filterWt === wt)) {
                disagreements.push({
                    wx: n.wx, wy: n.wy, wt,
                    noita: noitaXml, telescope: tRes.biome,
                    origCX: n.origCX, origCY: n.origCY, subX: n.subX, subY: n.subY,
                    neighborDir: n.neighborDir,
                    neighborCX: n.neighborCX, neighborCY: n.neighborCY,
                    origEligible: n.original && n.original.wobbleEligible,
                    origWavy: n.original && n.original.wavyEdge,
                    resolvedName: n.resolved && n.resolved.xmlName,
                });
            }
        }
        wobbleTypeStats.set(wt, wstat);
    }

    const decided = total - telescopeNull;
    console.log('=== wobble ===');
    console.log(`coords processed:           ${total}`);
    console.log(`skipped (no original):      ${skippedNoOriginal}`);
    console.log(`skipped (_EMPTY_/???):      ${skippedEmpty}`);
    console.log(`telescope returned null:    ${telescopeNull}  (biome has no wang tiles in telescope)`);
    console.log(`decided (both have name):   ${decided}`);
    console.log(`  agree:                    ${agree}  (${(100 * agree / Math.max(1, decided)).toFixed(2)}% of decided)`);
    console.log(`  wrong biome:              ${decided - agree}`);
    console.log(`chunk-index agreement:      ${chunkAgree}/${chunkDecided}  (${(100 * chunkAgree / Math.max(1, chunkDecided)).toFixed(2)}%)`);
    console.log(`  (telescope's wobbled (cx,cy) matches noita's resolved (cx,cy) — finer-grained than biome name)`);
    console.log(`appSettings.enableEdgeNoise = ${opts.enableEdgeNoise}, fixHM = ${opts.fixHM}`);

    console.log(`\nBy wobble decision (Noita's classification):`);
    const sorted = [...wobbleTypeStats.entries()]
        .sort((a, b) => (b[1].agree + b[1].disagree + b[1].telescopeNull) - (a[1].agree + a[1].disagree + a[1].telescopeNull));
    for (const [wt, s] of sorted) {
        const tot = s.agree + s.disagree + s.telescopeNull;
        const dec = s.agree + s.disagree;
        const pct = dec > 0 ? (100 * s.agree / dec).toFixed(1) : 'N/A';
        const cpct = s.chunkDecided > 0 ? (100 * s.chunkAgree / s.chunkDecided).toFixed(1) : 'N/A';
        console.log(`  ${wt.padEnd(24)} ${tot.toString().padStart(6)} total, ${s.telescopeNull.toString().padStart(6)} null, ${s.agree.toString().padStart(6)}/${dec} name agree (${pct}%), ${s.chunkAgree.toString().padStart(6)}/${s.chunkDecided} chunk agree (${cpct}%)`);
    }

    if (buckets.size) {
        console.log(`\nDisagreement buckets (top 25):`);
        const top = [...buckets.entries()].sort((a, b) => b[1].count - a[1].count).slice(0, 25);
        for (const [k, b] of top) {
            const wts = [...b.byWobbleType.entries()].map(([w, c]) => `${w}=${c}`).join(' ');
            console.log(`  [${b.count.toString().padStart(5)}]  ${k}    {${wts}}`);
            console.log(`           e.g. wx=${b.sample.wx}, wy=${b.sample.wy}, wobbleType=${b.sample.wobbleType}`);
        }
    }
    if (disagreements.length) {
        console.log(`\nFirst ${disagreements.length} raw disagreements${opts.filterWt ? ' (wt=' + opts.filterWt + ')' : ''}:`);
        for (const d of disagreements) {
            console.log(`  (${d.wx}, ${d.wy}) chunk=(${d.origCX}, ${d.origCY}) sub=(${d.subX}, ${d.subY}) wt=${d.wt}`);
            console.log(`     orig: eligible=${d.origEligible} wavy=${d.origWavy}  neighbor=${d.neighborDir} (cx=${d.neighborCX} cy=${d.neighborCY})`);
            console.log(`     noita=${d.noita} (resolved=${d.resolvedName})  telescope=${d.telescope}`);
        }
    }
    if (chunkSample.length) {
        console.log(`\nFirst ${chunkSample.length} chunk-index disagreements (biome name agrees):`);
        for (const c of chunkSample) {
            console.log(`  (${c.wx}, ${c.wy}) sub=(${c.subX}, ${c.subY}) wt=${c.wt} neighborDir=${c.neighborDir}`);
            console.log(`     orig=(${c.orig[0]}, ${c.orig[1]})  noita=(${c.noita[0]}, ${c.noita[1]})  telescope=(${c.tele[0]}, ${c.tele[1]})`);
        }
    }

    if (opts.images) {
        const outPath = join(opts.images, 'wobble.png');
        renderWobbleHeatmap(biomeData, nameStats, chunkStats, outPath);
        console.log(`wrote ${outPath}`);
    }
}

// ========== pixel-scenes section ==========

// Only need image dimensions — parse the PNG header directly so we don't pay
// to decode every referenced PNG.
const sceneSizeCache = new Map();
function getSceneSize(materialsFile, dataWak) {
    if (sceneSizeCache.has(materialsFile)) return sceneSizeCache.get(materialsFile);
    const rel = materialsFile.replace(/^data\//, '');
    const path = join(dataWak, rel);
    let result = null;
    try {
        const buf = readFileSync(path);
        if (buf.length > 24 && buf.toString('ascii', 1, 4) === 'PNG') {
            result = { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) };
        }
    } catch {}
    sceneSizeCache.set(materialsFile, result);
    return result;
}

// Telescope's 4-corner check from loadPixelScene.
function checkBoundsFourCorners(biomeData, x, y, width, height) {
    const tl = getBiomeAtWorldCoordinates(biomeData, x, y, false, 'normal');
    if (!tl.biome) return { ok: false, biomeName: null, reason: 'top-left null' };
    const corners = [
        ['top-right', x + width, y],
        ['bottom-left', x, y + height],
        ['bottom-right', x + width, y + height],
    ];
    for (const [label, cx, cy] of corners) {
        const r = getBiomeAtWorldCoordinates(biomeData, cx, cy, false, 'normal');
        if (!r.biome || r.biome !== tl.biome) {
            return { ok: false, biomeName: tl.biome, reason: `${label} resolved to ${r.biome || '(null)'}` };
        }
    }
    return { ok: true, biomeName: tl.biome };
}

// Relaxed top-left-only check; accepts biomes whose color is in the biome XML
// catalogue even if telescope can't render them (mountain, overworld, etc.).
function checkBoundsTopLeftOnly(biomeData, x, y) {
    const tl = getBiomeAtWorldCoordinates(biomeData, x, y, false, 'normal');
    if (!tl) return { ok: false, biomeName: null, reason: 'top-left unresolved' };
    if (tl.biome) return { ok: true, biomeName: tl.biome };
    const verdict = colorWobbleVerdict(tl.colorInt);
    if (verdict !== 'unknown') return { ok: true, biomeName: '(no-tile biome)' };
    return { ok: false, biomeName: null, reason: `top-left null, color 0x${tl.colorInt.toString(16).padStart(6, '0')} not in catalogue` };
}

function runPixelScenesSection(biomeData, opts) {
    const text = readDump(opts.scenes);
    let total = 0, accepted = 0, rejected = 0, sizeMissing = 0;
    const rejectsByReason = new Map();
    const rejectsByBiome = new Map();
    const sample = [];
    const sceneResults = [];

    for (const line of text.split('\n')) {
        if (!line || line.startsWith('#') || !line.startsWith('{')) continue;
        let scene;
        try { scene = JSON.parse(line); } catch { continue; }
        if (!scene.materialsFile) continue;
        total++;

        const size = getSceneSize(scene.materialsFile, opts.dataWak);
        if (!size) { sizeMissing++; continue; }

        const verdict = opts.topLeftOnly
            ? checkBoundsTopLeftOnly(biomeData, scene.x, scene.y)
            : checkBoundsFourCorners(biomeData, scene.x, scene.y, size.width, size.height);

        sceneResults.push({ x: scene.x, y: scene.y, w: size.width, h: size.height, ok: verdict.ok });

        if (verdict.ok) accepted++;
        else {
            rejected++;
            rejectsByReason.set(verdict.reason, (rejectsByReason.get(verdict.reason) || 0) + 1);
            const biome = verdict.biomeName || '(unresolved)';
            rejectsByBiome.set(biome, (rejectsByBiome.get(biome) || 0) + 1);
            if (sample.length < opts.dump) {
                sample.push({
                    x: scene.x, y: scene.y, file: scene.materialsFile,
                    size: `${size.width}x${size.height}`,
                    biome: verdict.biomeName, reason: verdict.reason,
                });
            }
        }
    }

    const decided = total - sizeMissing;
    console.log('=== pixel-scenes ===');
    console.log(`pixel scenes in fixture:    ${total}`);
    console.log(`size missing (skip):        ${sizeMissing}`);
    console.log(`decided:                    ${decided}`);
    console.log(`  telescope ACCEPT:         ${accepted}  (${(100 * accepted / Math.max(1, decided)).toFixed(2)}%)`);
    console.log(`  telescope REJECT:         ${rejected}  (${(100 * rejected / Math.max(1, decided)).toFixed(2)}%)`);
    console.log(`mode: ${opts.topLeftOnly ? 'top-left only (proposed fix)' : '4-corner same-biome (current loadPixelScene)'}`);

    if (rejectsByBiome.size) {
        console.log('\nRejects by top-left biome:');
        for (const [biome, count] of [...rejectsByBiome.entries()].sort((a, b) => b[1] - a[1])) {
            console.log(`  ${count.toString().padStart(4)}  ${biome}`);
        }
    }
    if (rejectsByReason.size) {
        console.log('\nRejects by failure reason (top 15):');
        const sorted = [...rejectsByReason.entries()].sort((a, b) => b[1] - a[1]).slice(0, 15);
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

    if (opts.images) {
        const outPath = join(opts.images, 'pixel-scenes.png');
        renderPixelScenes(biomeData, sceneResults, outPath);
        console.log(`wrote ${outPath}`);
    }
}

// ========== main ==========

async function main() {
    const opts = parseArgs(process.argv.slice(2));
    appSettings.enableEdgeNoise = opts.enableEdgeNoise;
    appSettings.fixHolyMountainEdgeNoise = opts.fixHM;

    const biomeData = await loadBiomeData(opts.biomeMap);
    if (opts.images) mkdirSync(opts.images, { recursive: true });
    const run = (section) => !opts.only || opts.only === section;

    let printedAny = false;
    if (run('biomes')) {
        runBiomesSection(biomeData, opts);
        printedAny = true;
    }
    if (run('wobble')) {
        if (printedAny) console.log('');
        runWobbleSection(biomeData, opts);
        printedAny = true;
    }
    if (run('pixel-scenes')) {
        if (printedAny) console.log('');
        runPixelScenesSection(biomeData, opts);
        printedAny = true;
    }
    if (!printedAny) {
        console.error(`--only=${opts.only} matched no section (expected: biomes, wobble, pixel-scenes)`);
        process.exit(1);
    }
}

main().catch((e) => { console.error(e); process.exit(1); });

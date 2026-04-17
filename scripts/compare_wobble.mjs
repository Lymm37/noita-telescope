// Run telescope's getBiomeAtWorldCoordinates over a fixture of world
// coordinates and diff each result against Noita's actual chunk
// resolution (recorded in `data/dumps/biome_at_resolutions.ndjson.gz`).
//
//   node scripts/compare_wobble.mjs                   # default fixture
//   node scripts/compare_wobble.mjs --input=PATH      # different dump
//   node scripts/compare_wobble.mjs --no-edge-noise   # disable telescope's wobble
//   node scripts/compare_wobble.mjs --filter-wt=sin-cos+simplex --dump=20
//
// `.gz` inputs are decompressed transparently. Telescope's biome-name
// keys are translated to Noita's `$biome_<name>` using KEY_OVERRIDES.

import { readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { createCanvas, loadImage } from 'canvas';

const DEFAULT_INPUT = 'data/dumps/biome_at_resolutions.ndjson.gz';

function readDump(path) {
  const buf = readFileSync(path);
  return path.endsWith('.gz') ? gunzipSync(buf).toString('utf8') : buf.toString('utf8');
}
import { BIOME_COLOR_TO_NAME, BIOME_COLORS_WITH_TILES } from '../js/generator_config.js';
import { GetBiomeOffset } from './_edge_noise_shim.js';
import { colorWobbleVerdict } from '../js/wobble_flags.js';

// utils.js drags in CDN-imported modules (png/zip libs) that node's ESM
// loader rejects. Inline the only function we need (getBiomeAtWorldCoordinates)
// rather than importing utils.js.
const appSettings = {
  enableEdgeNoise: true,
  fixHolyMountainEdgeNoise: true,
};

function getWorldSize(isNGP, gameMode) {
  if (gameMode === 'nightmare') return 64;
  return isNGP ? 64 : 70;
}

// Verbatim copy of utils.js getBiomeAtWorldCoordinates (commit at time of
// writing). Update both if it changes.
function getBiomeAtWorldCoordinates(biomeData, worldX, worldY, isNGP = false, gameMode='normal') {
    let biomeMap = biomeData.pixels;
    if (worldY < -14*512) {
        biomeMap = biomeData.heavenPixels;
    }
    else if (worldY > 34*512) {
        biomeMap = biomeData.hellPixels;
    }
    const mapWidth = getWorldSize(isNGP, gameMode);
    const worldSize = mapWidth * 512;
    const worldCenter = worldSize / 2;
    const modX = ((worldX + worldCenter) % worldSize + worldSize) % worldSize;
    const modY = ((worldY + 14*512) % 24576 + 24576) % 24576;

    let highDetail = true;
    const edgeOffset = GetBiomeOffset(worldX, worldY, isNGP, highDetail);

    if (!appSettings.enableEdgeNoise) {
        edgeOffset.x = 0;
        edgeOffset.y = 0;
    }

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

    return {
        biome: biomeName || null,
        pos: {x: biomePixelX, y: biomePixelY},
        originalPos: {x: originalX, y: originalY},
        mightBeEdgeCase: edgeOffset.x !== 0 || edgeOffset.y !== 0,
    };
}

const NOITA_BIOME_PREFIX = '$biome_';
const KEY_OVERRIDES = {
  'temple_altar': 'holymountain',
  'lake_deep': 'lake',
  'rainforest_open': 'rainforest',
  'fungiforest': 'fun',
  'the_end': 'boss_victoryroom',
  'the_sky': 'boss_victoryroom',
  'tower_coalmine': 'tower',
  'tower_excavationsite': 'tower',
  'tower_snowcave': 'tower',
  'tower_snowcastle': 'tower',
  'tower_fungicave': 'tower',
  'tower_rainforest': 'tower',
  'tower_vault': 'tower',
  'tower_crypt': 'tower',
  'tower_end': 'tower',
  'snowchasm': 'winter_caves',
  'orbroom_marker': 'orbroom',
  'snowcastle_cavern': 'snowcastle',
};

function telescopeKeyToNoitaName(key) {
  if (key == null) return null;
  let mapped = KEY_OVERRIDES[key] || key;
  // Telescope sometimes already prefixes its key with "biome_" (e.g.
  // biome_potion_mimics, biome_barren). Strip so we don't double-prefix.
  if (mapped.startsWith('biome_')) mapped = mapped.slice('biome_'.length);
  return NOITA_BIOME_PREFIX + mapped;
}

async function loadBiomeData(path = 'data/biome_maps/biome_map.png') {
  const img = await loadImage(path);
  const c = createCanvas(img.width, img.height);
  const ctx = c.getContext('2d');
  ctx.drawImage(img, 0, 0);
  const data = ctx.getImageData(0, 0, img.width, img.height).data;
  // utils.js' getBiomeAtWorldCoordinates expects pixels[i] = ARGB packed u32,
  // since BIOME_COLOR_TO_NAME indexes by `colorInt & 0xffffff`.
  const pixels = new Uint32Array(img.width * img.height);
  for (let i = 0; i < pixels.length; i++) {
    pixels[i] = 0xff000000 | (data[i*4] << 16) | (data[i*4+1] << 8) | data[i*4+2];
  }
  // utils.js also references heavenPixels/hellPixels for out-of-range Y.
  // Build them by repeating the first/last row, matching telescope's
  // generateBiomeData (NG=0 branch).
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

function parseFlags(argv) {
  const opts = { input: DEFAULT_INPUT, enableEdgeNoise: true, fixHM: true, dumpDisagreements: 0, dumpChunk: 0, filterWt: null };
  for (const a of argv) {
    if (a === '--no-edge-noise') opts.enableEdgeNoise = false;
    else if (a === '--no-fix-hm-edge-noise') opts.fixHM = false;
    else if (a.startsWith('--input=')) opts.input = a.slice('--input='.length);
    else if (a.startsWith('--dump=')) opts.dumpDisagreements = +a.slice(7);
    else if (a.startsWith('--dump-chunk=')) opts.dumpChunk = +a.slice('--dump-chunk='.length);
    else if (a.startsWith('--filter-wt=')) opts.filterWt = a.slice('--filter-wt='.length);
    else if (!a.startsWith('--')) opts.input = a; // positional path for back-compat
  }
  return opts;
}

async function main() {
  const opts = parseFlags(process.argv.slice(2));
  appSettings.enableEdgeNoise = opts.enableEdgeNoise;
  appSettings.fixHolyMountainEdgeNoise = opts.fixHM;

  const biomeData = await loadBiomeData();
  const text = readDump(opts.input);

  let total = 0,
    agree = 0,
    chunkAgree = 0,    // telescope's wobbled (cx, cy) == noita.resolved (cx, cy)
    chunkDecided = 0,  // both sides have a known wobbled chunk position
    telescopeNull = 0,
    skippedNoOriginal = 0,
    skippedEmpty = 0,
    disagreements = [],
    chunkSample = [];
  const buckets = new Map();
  // Two stats per wobble type: agreement when both sides have a name, and
  // a separate count of "telescope returned null" since that's a design
  // choice (no wang tiles) rather than a wobble bug.
  const wobbleTypeStats = new Map();

  for (const line of text.split('\n')) {
    if (!line) continue;
    let n;
    try { n = JSON.parse(line); } catch { continue; }
    if (!n || !n.original) { skippedNoOriginal++; continue; }
    const noitaName = (n.resolved && n.resolved.name) || n.original.name;
    if (noitaName === '_EMPTY_' || noitaName === '???') { skippedEmpty++; continue; }
    total++;

    const tRes = getBiomeAtWorldCoordinates(biomeData, n.wx, n.wy, false, 'normal');
    const tName = tRes && tRes.biome ? telescopeKeyToNoitaName(tRes.biome) : null;
    if (!tName) telescopeNull++;

    // Track chunk-index agreement separately from biome-name agreement.
    // Telescope's `pos` is the wobbled chunk index; noita's `resolved.cx,cy`
    // is the same. They can disagree even when the resolved biome NAMES match
    // (e.g. wobble lands one chunk over but both chunks are coalmine).
    if (tRes && tRes.pos && n.resolved) {
      chunkDecided++;
      if (tRes.pos.x === n.resolved.cx && tRes.pos.y === n.resolved.cy) {
        chunkAgree++;
      } else if (tName === noitaName && chunkSample.length < (opts.dumpChunk || 0)) {
        chunkSample.push({
          wx: n.wx, wy: n.wy,
          subX: n.subX, subY: n.subY, wt: n.wobbleType,
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
      if (tRes.pos.x === n.resolved.cx && tRes.pos.y === n.resolved.cy) {
        wstat.chunkAgree++;
      }
    }

    if (tName === noitaName) {
      agree++;
      wstat.agree++;
    } else if (tName == null) {
      wstat.telescopeNull++;
      // Don't bucket null disagreements — they're "telescope filters this
      // biome out", not a wobble correctness signal.
    } else {
      const k = `${noitaName} ↔ ${tName}`;
      const b = buckets.get(k) || { count: 0, sample: null, byWobbleType: new Map() };
      b.count++;
      if (!b.sample) b.sample = { wx: n.wx, wy: n.wy, wobbleType: wt };
      b.byWobbleType.set(wt, (b.byWobbleType.get(wt) || 0) + 1);
      buckets.set(k, b);
      wstat.disagree++;
      if (disagreements.length < opts.dumpDisagreements && (!opts.filterWt || opts.filterWt === wt)) {
        disagreements.push({
          wx: n.wx, wy: n.wy, wt,
          noita: noitaName, telescope: tName,
          origCX: n.origCX, origCY: n.origCY, subX: n.subX, subY: n.subY,
          neighborDir: n.neighborDir,
          neighborCX: n.neighborCX, neighborCY: n.neighborCY,
          origEligible: n.original && n.original.wobbleEligible,
          origWavy: n.original && n.original.wavyEdge,
          resolvedName: n.resolved && n.resolved.name,
        });
      }
    }
    wobbleTypeStats.set(wt, wstat);
  }

  const decided = total - telescopeNull;
  console.log(`coords processed:           ${total}`);
  console.log(`skipped (no original):      ${skippedNoOriginal}`);
  console.log(`skipped (_EMPTY_/???):      ${skippedEmpty}`);
  console.log(`telescope returned null:    ${telescopeNull}  (biome has no wang tiles in telescope)`);
  console.log(`decided (both have name):   ${decided}`);
  console.log(`  agree:                    ${agree}  (${(100 * agree / decided).toFixed(2)}% of decided)`);
  console.log(`  wrong biome:              ${decided - agree}`);
  console.log(`chunk-index agreement:      ${chunkAgree}/${chunkDecided}  (${(100 * chunkAgree / Math.max(1, chunkDecided)).toFixed(2)}%)`);
  console.log(`  (telescope's wobbled (cx,cy) matches noita's resolved (cx,cy) — finer-grained than biome name)`);
  console.log(`appSettings.enableEdgeNoise = ${opts.enableEdgeNoise}, fixHM = ${opts.fixHM}`);

  console.log(`\nBy wobble decision (Noita's classification):`);
  for (const [wt, s] of [...wobbleTypeStats.entries()].sort((a, b) => (b[1].agree + b[1].disagree + b[1].telescopeNull) - (a[1].agree + a[1].disagree + a[1].telescopeNull))) {
    const tot = s.agree + s.disagree + s.telescopeNull;
    const dec = s.agree + s.disagree;
    const pct = dec > 0 ? (100*s.agree/dec).toFixed(1) : 'N/A';
    const cpct = s.chunkDecided > 0 ? (100*s.chunkAgree/s.chunkDecided).toFixed(1) : 'N/A';
    console.log(`  ${wt.padEnd(24)} ${tot.toString().padStart(6)} total, ${s.telescopeNull.toString().padStart(6)} null, ${s.agree.toString().padStart(6)}/${dec} name agree (${pct}%), ${s.chunkAgree.toString().padStart(6)}/${s.chunkDecided} chunk agree (${cpct}%)`);
  }

  if (buckets.size) {
    console.log(`\nDisagreement buckets (top 25):`);
    const sorted = [...buckets.entries()].sort((a, b) => b[1].count - a[1].count).slice(0, 25);
    for (const [k, b] of sorted) {
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
}

main().catch((e) => { console.error(e); process.exit(1); });

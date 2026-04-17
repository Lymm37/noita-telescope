// Compare telescope's biome-map → biome-name lookup against the live game's
// per-chunk biome name (captured by noitrainer). No wobble is applied —
// this purely tests whether telescope can name each chunk's biome from
// its biome-map color.
//
//   node scripts/compare_biomes.mjs                        # default fixture
//   node scripts/compare_biomes.mjs <PATH>                 # different dump
//
// Default input is data/dumps/biome_flags.ndjson. The script also
// accepts the legacy human-readable `noitrainer biome-dump` output
// (matched line-by-line by regex) for back-compat.

import { readFileSync } from 'node:fs';
import { createCanvas, loadImage } from 'canvas';
import { GENERATOR_CONFIG, BIOME_COLOR_TO_NAME, BIOME_COLORS_WITH_TILES } from '../js/generator_config.js';

const NOITA_BIOME_PREFIX = '$biome_';

// Telescope keys → Noita's $biome_<name>. Most line up; explicit table for the
// few that don't match by stripping the prefix. Anything not in this table
// falls back to: noita_name === '$biome_' + telescope_key.
const KEY_OVERRIDES = {
  'coalmine_alt': 'coalmine_alt',
  'snowcave_secret_chamber': 'snowcave_secret_chamber',
  'snowcastle_cavern': 'snowcastle_cavern',
  'snowcastle_hourglass_chamber': 'snowcastle_hourglass_chamber',
  'excavationsite_cube_chamber': 'excavationsite_cube_chamber',
  'wizardcave_entrance': 'wizardcave_entrance',
  'temple_altar': 'holymountain',  // verified from live dump
  'wandcave': 'wandcave',
  'liquidcave': 'liquidcave',
  'lake_deep': 'lake', // verified from live dump
  'rainforest_open': 'rainforest', // noita lumps both rainforests under one name
  'rainforest_dark': 'rainforest_dark',
  'fungiforest': 'fun', // noita biome xml is named "fun" not fungiforest
  'pyramid_top': 'pyramid_top',
  'secret_lab': 'secret_lab',
  'robot_egg': 'robot_egg',
  'dragoncave': 'dragoncave',
  'boss_arena': 'boss_arena',
  'biome_watchtower': 'watchtower',
  'biome_potion_mimics': 'potion_mimics',
  'biome_darkness': 'darkness',
  'biome_boss_sky': 'boss_sky',
  'biome_barren': 'barren',

  // Telescope splits boss_victoryroom into the_end / the_sky based on world
  // half. Noita uses the same `$biome_boss_victoryroom` for both.
  'the_end': 'boss_victoryroom',
  'the_sky': 'boss_victoryroom',

  // Telescope has separate keys per-biome for "tower of X". Noita uses
  // `$biome_tower` for all of them.
  'tower_coalmine': 'tower',
  'tower_excavationsite': 'tower',
  'tower_snowcave': 'tower',
  'tower_snowcastle': 'tower',
  'tower_fungicave': 'tower',
  'tower_rainforest': 'tower',
  'tower_vault': 'tower',
  'tower_crypt': 'tower',
  'tower_end': 'tower',

  // Telescope's "snowchasm" key is "winter_caves" in noita.
  'snowchasm': 'winter_caves',

  // Telescope's orbroom_marker (added for the FFD1xx color family) is just
  // "$biome_orbroom" in noita.
  'orbroom_marker': 'orbroom',

  // Telescope distinguishes the snowcastle's cavern sub-biome by color, but
  // noita calls one of those tiles plain "$biome_snowcastle".
  'snowcastle_cavern': 'snowcastle',
};

function telescopeKeyToNoitaName(key) {
  const override = KEY_OVERRIDES[key];
  if (override) return NOITA_BIOME_PREFIX + override;
  // Default: just prefix.
  return NOITA_BIOME_PREFIX + key;
}

function parseNoitaDump(path) {
  const text = readFileSync(path, 'utf8');
  const out = new Map(); // key "cx,cy" -> {cx, cy, name, eligible, wavy, forced}
  for (const line of text.split('\n')) {
    if (!line || line.startsWith('#') || line.startsWith('Looking') || line.startsWith('Found')) continue;
    // First try the noitrainer biome-flags NDJSON format (what we ship in
    // data/dumps/biome_flags.ndjson).
    if (line.startsWith('{')) {
      try {
        const o = JSON.parse(line);
        if (o.cx == null || o.cy == null || !o.name) continue;
        out.set(`${o.cx},${o.cy}`, {
          cx: o.cx, cy: o.cy,
          name: o.name,
          eligible: !!o.wobbleEligible,
          wavy: !!o.wavyEdge,
          forced: !!o.forceOriginal,
        });
      } catch {}
      continue;
    }
    // Fallback: legacy human-readable biome-dump output.
    const m = line.match(/^\s*(\d+)\s+(\d+)\s+0x[0-9A-Fa-f]+\s+0x[0-9A-Fa-f]+\s+(\$?\S+)\s+e=(\d)\s+w=(\d)\s+f=(\d)/);
    if (!m) continue;
    const [, cx, cy, name, e, w, f] = m;
    out.set(`${cx},${cy}`, {
      cx: +cx, cy: +cy,
      name,
      eligible: +e === 1,
      wavy: +w === 1,
      forced: +f === 1,
    });
  }
  return out;
}

async function loadTelescopeBiomeMap(pngPath) {
  const img = await loadImage(pngPath);
  const c = createCanvas(img.width, img.height);
  const ctx = c.getContext('2d');
  ctx.drawImage(img, 0, 0);
  const data = ctx.getImageData(0, 0, img.width, img.height).data;

  // Build a (cx, cy) -> {color, biomeName, hasTile}
  const out = new Map();
  for (let y = 0; y < img.height; y++) {
    for (let x = 0; x < img.width; x++) {
      const idx = (y * img.width + x) * 4;
      const color =
        (data[idx] << 16) | (data[idx + 1] << 8) | data[idx + 2];
      const biomeName = BIOME_COLOR_TO_NAME[color] || null;
      const hasTile = BIOME_COLORS_WITH_TILES.has(color);
      out.set(`${x},${y}`, { cx: x, cy: y, color, biomeName, hasTile });
    }
  }
  return { width: img.width, height: img.height, chunks: out };
}

function summarize(noitaMap, telescopeMap, opts = {}) {
  const rows = [];
  let agree = 0,
    disagreeName = 0,
    telescopeUnknown = 0,
    skippedEmpty = 0,
    notInTelescope = 0,
    onlyInTelescope = 0;
  for (const [key, noita] of noitaMap) {
    // Skip the giant block of unloaded biome cells. They are 'placeholder'
    // chunks the game allocated but hasn't filled in for this seed/run, and
    // contain a sentinel name `_EMPTY_`. They tell us nothing about the
    // wobble/biome-resolution model.
    if (noita.name === '_EMPTY_' || noita.name === '???') {
      // _EMPTY_ = chunk allocated but unloaded. ???  = chunk has no biome
      // XML name (background-only filler). Neither is a meaningful comparison
      // target since telescope's biome lookup can only ever miss them.
      skippedEmpty++;
      continue;
    }
    const tel = telescopeMap.chunks.get(key);
    if (!tel) {
      notInTelescope++;
      continue;
    }
    const expected = tel.biomeName ? telescopeKeyToNoitaName(tel.biomeName) : null;
    if (!expected) {
      telescopeUnknown++;
      rows.push({
        cx: noita.cx, cy: noita.cy,
        noita: noita.name,
        telescope: '(no key for color 0x' + tel.color.toString(16).padStart(6, '0') + ')',
        color: '0x' + tel.color.toString(16).padStart(6, '0'),
        match: false,
      });
      continue;
    }
    if (expected === noita.name) {
      agree++;
    } else {
      disagreeName++;
      rows.push({
        cx: noita.cx, cy: noita.cy,
        noita: noita.name, telescope: expected,
        color: '0x' + tel.color.toString(16).padStart(6, '0'),
        match: false,
      });
    }
  }
  for (const [key] of telescopeMap.chunks) {
    if (!noitaMap.has(key)) onlyInTelescope++;
  }
  return {
    agree, disagreeName, telescopeUnknown, skippedEmpty,
    notInTelescope, onlyInTelescope,
    total: noitaMap.size,
    rows,
  };
}

async function main() {
  const dumpPath = process.argv[2] || 'data/dumps/biome_flags.ndjson';
  const noitaMap = parseNoitaDump(dumpPath);
  const telescopeMap = await loadTelescopeBiomeMap('data/biome_maps/biome_map.png');
  const s = summarize(noitaMap, telescopeMap);
  const decided = s.agree + s.disagreeName + s.telescopeUnknown;
  console.log(`telescope map: ${telescopeMap.width}x${telescopeMap.height}`);
  console.log(`noita chunks dumped: ${s.total}, _EMPTY_ skipped: ${s.skippedEmpty}, decided: ${decided}`);
  console.log(`  agree:                 ${s.agree}  (${(100 * s.agree / decided).toFixed(1)}%)`);
  console.log(`  name disagreement:     ${s.disagreeName}`);
  console.log(`  telescope color unknown: ${s.telescopeUnknown}`);
  console.log(`  in noita, not in telescope grid: ${s.notInTelescope}`);
  console.log(`  in telescope grid, not loaded by noita: ${s.onlyInTelescope}`);

  // Bucket disagreements by (noita_name -> telescope_name) so it's easy to see
  // systematic mismatches.
  const buckets = new Map();
  for (const r of s.rows) {
    const k = `${r.noita} ↔ ${r.telescope}`;
    const b = buckets.get(k) || { count: 0, sample: r };
    b.count++;
    buckets.set(k, b);
  }
  if (buckets.size) {
    console.log('\n-- Disagreement buckets --');
    const bucketList = [...buckets.entries()].sort((a, b) => b[1].count - a[1].count);
    for (const [k, b] of bucketList) {
      console.log(`  [${String(b.count).padStart(4)}]  ${k}    (e.g. cx=${b.sample.cx} cy=${b.sample.cy} color=${b.sample.color})`);
    }
  }
}

main().catch((e) => { console.error(e); process.exit(1); });

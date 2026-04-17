// Generate `data/biome_flags.json` from a Noita data.wak unpack.
//
// The output table maps every biome map color (`<Biome color>` in
// `_biomes_all.xml`) to its biome XML's properties — primarily
// `noise_biome_edges`, which is the source-of-truth for the per-chunk
// `wobble_eligible` byte (offset +0xC4) that the engine reads when
// deciding whether to apply the simplex/sin-cos edge wobble.
//
// Usage:
//   node scripts/build_biome_flags.mjs                # default unpack path
//   node scripts/build_biome_flags.mjs --src=PATH     # different unpack
//   node scripts/build_biome_flags.mjs --out=PATH     # different output
//
// The default source path is the dump used during this analysis. Re-run
// this script after a Noita update with `--src` pointing at the new
// unpacked data directory; check in the regenerated JSON.
//
// The XMLs are simple enough that we don't need a full DOM parser; a
// careful regex walk is fine and keeps the script dependency-free.

import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join, basename } from 'node:path';

const DEFAULT_SRC = `${process.env.HOME}/reverse/noita/noita_Jan_25_2025_15:55:41/data/data.wak.unpacked`;
const DEFAULT_OUT = 'data/biome_flags.json';

function parseArgs() {
  const opts = { src: DEFAULT_SRC, out: DEFAULT_OUT, verbose: false };
  for (const a of process.argv.slice(2)) {
    if (a.startsWith('--src=')) opts.src = a.slice('--src='.length);
    else if (a.startsWith('--out=')) opts.out = a.slice('--out='.length);
    else if (a === '-v' || a === '--verbose') opts.verbose = true;
    else if (a === '-h' || a === '--help') {
      console.log('Usage: node scripts/build_biome_flags.mjs [--src=PATH] [--out=PATH] [-v]');
      process.exit(0);
    } else {
      console.error(`unknown arg: ${a}`);
      process.exit(1);
    }
  }
  return opts;
}

// Pull `attr="value"` style attributes out of an XML tag. Supports both
// double and single quotes. Returns null if missing.
function attr(text, name) {
  const m = text.match(new RegExp(`${name}\\s*=\\s*"([^"]*)"`)) ||
            text.match(new RegExp(`${name}\\s*=\\s*'([^']*)'`));
  return m ? m[1] : null;
}

// Iterate `<Biome ... />` (or `<Biome ...>...</Biome>`) entries from
// _biomes_all.xml. Yields just the opening-tag attribute portion.
function* biomeEntries(text) {
  const re = /<Biome\b([^>]*)>/g;
  let m;
  while ((m = re.exec(text)) !== null) {
    yield m[1];
  }
}

function readBiomeXml(srcRoot, biomeFilename) {
  // _biomes_all.xml uses paths like "data/biome/coalmine.xml" — these are
  // game-root relative. Our unpack starts inside data/, so strip "data/".
  const rel = biomeFilename.replace(/^data\//, '');
  const path = join(srcRoot, rel);
  if (!existsSync(path)) return null;
  return readFileSync(path, 'utf8');
}

// Per-biome XML: extract noise_biome_edges (bool), name (string), and the
// wang_template_file (helps disambiguate filler vs entrance biomes).
function parseBiomeXml(xml) {
  const noise = attr(xml, 'noise_biome_edges');
  return {
    name: attr(xml, 'name') || null,
    wangTemplateFile: attr(xml, 'wang_template_file') || null,
    // Default is "1" (eligible) when the attribute is absent — verified
    // against several biomes that don't set it explicitly.
    noiseBiomeEdges: noise === null ? true : noise !== '0',
  };
}

function normalizeColor(raw) {
  // Noita writes "ff36d517" (ARGB hex). Telescope keys lookup by RGB only
  // (& 0xffffff). Normalize to lowercase 6-hex (no alpha).
  if (!raw) return null;
  const m = raw.match(/^([0-9a-fA-F]{2})?([0-9a-fA-F]{6})$/);
  if (!m) return null;
  return m[2].toLowerCase();
}

function main() {
  const opts = parseArgs();
  const indexPath = join(opts.src, 'biome/_biomes_all.xml');
  if (!existsSync(indexPath)) {
    console.error(`missing index: ${indexPath}`);
    process.exit(1);
  }
  const indexText = readFileSync(indexPath, 'utf8');

  const biomes = []; // { color, biomeFilename, xml: {…}|null }
  const colorIndex = new Map(); // color → index of canonical entry (first wins; we warn on dups)
  let warnings = 0;

  for (const entryAttrs of biomeEntries(indexText)) {
    const color = normalizeColor(attr(entryAttrs, 'color'));
    const biomeFilename = attr(entryAttrs, 'biome_filename');
    if (!color || !biomeFilename) continue;
    const xmlText = readBiomeXml(opts.src, biomeFilename);
    if (!xmlText) {
      warnings++;
      if (opts.verbose) console.warn(`[warn] no XML at ${biomeFilename}`);
      continue;
    }
    const xml = parseBiomeXml(xmlText);
    const entry = {
      color: '0x' + color,
      biomeFilename,
      name: xml.name,
      noiseBiomeEdges: xml.noiseBiomeEdges,
      wangTemplateFile: xml.wangTemplateFile || undefined,
    };
    if (colorIndex.has(color)) {
      // Duplicate color in _biomes_all.xml usually means two biome variants
      // share a pixel value. Warn loudly if their flags disagree.
      const existing = biomes[colorIndex.get(color)];
      if (existing.noiseBiomeEdges !== xml.noiseBiomeEdges) {
        warnings++;
        console.warn(`[warn] color 0x${color}: ${existing.biomeFilename} (e=${existing.noiseBiomeEdges}) vs ${biomeFilename} (e=${xml.noiseBiomeEdges})`);
      }
      continue;
    }
    colorIndex.set(color, biomes.length);
    biomes.push(entry);
  }

  biomes.sort((a, b) => a.color.localeCompare(b.color));

  const out = {
    // Bookkeeping that makes future regenerations / diffs easy.
    generated: 'scripts/build_biome_flags.mjs',
    source: basename(opts.src),
    biomeCount: biomes.length,
    ineligibleCount: biomes.filter((b) => !b.noiseBiomeEdges).length,
    biomes,
  };

  writeFileSync(opts.out, JSON.stringify(out, null, 2) + '\n');
  console.log(`wrote ${biomes.length} biomes (${out.ineligibleCount} ineligible) to ${opts.out}`);
  if (warnings) console.log(`(${warnings} warnings; run with -v for detail)`);
}

main();

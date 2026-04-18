// Generate data used by the verification pipeline.
//
//   node scripts/generate.mjs biome-flags [--src=PATH] [--out=PATH] [-v]
//     Walk a Noita data.wak unpack and emit `data/biome_flags.json` — one
//     `{color, xmlName, noise_biome_edges?, fat_biome_edges?}` entry per
//     biome-map color, consumed by `js/wobble_flags.js` and
//     `js/generator_config.js`. The listed edge-noise attributes are
//     passed through verbatim from the biome XML (registered in
//     Biome_ConstructorAndRegisterFields @ noita.exe; +0xC4 / +0xC6 on
//     BiomeChunk). Each is only emitted when the biome's XML declares it.
//     `big_noise_biome_edges` (+0xC5) isn't declared on any biome in the
//     known unpack, so it's omitted here too.
//     Re-run after each Noita update; check the regenerated JSON in.
//
//   node scripts/generate.mjs sample-coords [--input=PATH] [--mode=MODE] [--step=16]
//     Read a `noitrainer biome-flags` NDJSON dump (default
//     `data/dumps/biome_flags.ndjson`, supports `.gz` or `-` for stdin) and
//     emit world (wx, wy) coords covering the loaded chunks' wobble-active
//     regions. Pipe into `noitrainer-cli biome-at-many` to produce the
//     `biome_at_resolutions.ndjson.gz` fixture consumed by verify.mjs's
//     wobble section.
//
//     Modes:
//       centers   — 1 point per loaded chunk.
//       borders   — 32 points along each chunk's 4 edges.
//       edges     — corners + edge midpoints + per-chunk edge sub-grid (default).
//       dense     — full edge-zone sweep at every --step px offset.

import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { createInterface } from 'node:readline';
import { join, basename } from 'node:path';

// ========== biome-flags ==========

const BIOME_FLAGS_DEFAULT_SRC = `${process.env.HOME}/reverse/noita/noita_Jan_25_2025_15:55:41/data/data.wak.unpacked`;
const BIOME_FLAGS_DEFAULT_OUT = 'data/biome_flags.json';

function parseBiomeFlagsArgs(argv) {
    const opts = { src: BIOME_FLAGS_DEFAULT_SRC, out: BIOME_FLAGS_DEFAULT_OUT, verbose: false };
    for (const a of argv) {
        if (a.startsWith('--src=')) opts.src = a.slice('--src='.length);
        else if (a.startsWith('--out=')) opts.out = a.slice('--out='.length);
        else if (a === '-v' || a === '--verbose') opts.verbose = true;
        else if (a === '-h' || a === '--help') {
            console.log('Usage: node scripts/generate.mjs biome-flags [--src=PATH] [--out=PATH] [-v]');
            process.exit(0);
        } else {
            console.error(`unknown arg: ${a}`);
            process.exit(1);
        }
    }
    return opts;
}

function xmlAttr(text, name) {
    const m = text.match(new RegExp(`${name}\\s*=\\s*"([^"]*)"`)) ||
              text.match(new RegExp(`${name}\\s*=\\s*'([^']*)'`));
    return m ? m[1] : null;
}

function* biomeEntries(text) {
    const re = /<Biome\b([^>]*)>/g;
    let m;
    while ((m = re.exec(text)) !== null) yield m[1];
}

function readBiomeXml(srcRoot, biomeFilename) {
    // _biomes_all.xml uses paths like "data/biome/coalmine.xml" (game-root
    // relative). Our unpack already starts inside data/, so strip the prefix.
    const rel = biomeFilename.replace(/^data\//, '');
    const path = join(srcRoot, rel);
    if (!existsSync(path)) return null;
    return readFileSync(path, 'utf8');
}

// Edge-noise-related biome XML attributes, listed in their per-chunk
// struct offset order (+0xC4, +0xC6) as registered by
// Biome_ConstructorAndRegisterFields in noita.exe. Each is passed through
// verbatim when the XML sets it; consumers (js/wobble_flags.js) supply the
// per-attribute default when the XML is silent. `big_noise_biome_edges`
// (+0xC5) is registered by the engine but no biome declares it, so it's
// omitted here.
const EDGE_NOISE_ATTRS = ['noise_biome_edges', 'fat_biome_edges'];

function parseBiomeXml(xml) {
    const out = {};
    for (const attr of EDGE_NOISE_ATTRS) {
        const raw = xmlAttr(xml, attr);
        if (raw === null) continue;
        out[attr] = raw === '0' ? 0 : 1;
    }
    return out;
}

function normalizeColor(raw) {
    // Noita stores ARGB hex; telescope indexes by RGB only.
    if (!raw) return null;
    const m = raw.match(/^([0-9a-fA-F]{2})?([0-9a-fA-F]{6})$/);
    if (!m) return null;
    return m[2].toLowerCase();
}

function runBiomeFlags(argv) {
    const opts = parseBiomeFlagsArgs(argv);
    const indexPath = join(opts.src, 'biome/_biomes_all.xml');
    if (!existsSync(indexPath)) {
        console.error(`missing index: ${indexPath}`);
        process.exit(1);
    }
    const indexText = readFileSync(indexPath, 'utf8');

    const biomes = [];
    const colorIndex = new Map();
    let warnings = 0;

    for (const entryAttrs of biomeEntries(indexText)) {
        const color = normalizeColor(xmlAttr(entryAttrs, 'color'));
        const biomeFilename = xmlAttr(entryAttrs, 'biome_filename');
        if (!color || !biomeFilename) continue;
        const xmlText = readBiomeXml(opts.src, biomeFilename);
        if (!xmlText) {
            warnings++;
            if (opts.verbose) console.warn(`[warn] no XML at ${biomeFilename}`);
            continue;
        }
        const xml = parseBiomeXml(xmlText);
        const xmlName = basename(biomeFilename).replace(/\.xml$/, '');
        const entry = { color: '0x' + color, xmlName, ...xml };
        if (colorIndex.has(color)) {
            const existing = biomes[colorIndex.get(color)];
            for (const attr of EDGE_NOISE_ATTRS) {
                if (existing[attr] !== xml[attr]) {
                    warnings++;
                    console.warn(`[warn] color 0x${color}: ${existing.xmlName} ${attr}=${existing[attr] ?? '(absent)'} vs ${xmlName} ${attr}=${xml[attr] ?? '(absent)'}`);
                }
            }
            continue;
        }
        colorIndex.set(color, biomes.length);
        biomes.push(entry);
    }

    biomes.sort((a, b) => a.color.localeCompare(b.color));

    const setCounts = Object.fromEntries(
        EDGE_NOISE_ATTRS.map((a) => [a, biomes.filter((b) => a in b).length])
    );

    const out = {
        generated: 'scripts/generate.mjs biome-flags',
        source: basename(opts.src),
        biomeCount: biomes.length,
        xmlSetCounts: setCounts,
        biomes,
    };

    writeFileSync(opts.out, JSON.stringify(out, null, 2) + '\n');
    const summary = EDGE_NOISE_ATTRS.map((a) => `${a}: ${setCounts[a]}`).join(', ');
    console.log(`wrote ${biomes.length} biomes (XML-set counts — ${summary}) to ${opts.out}`);
    if (warnings) console.log(`(${warnings} warnings; run with -v for detail)`);
}

// ========== sample-coords ==========

const X_SHIFT_CHUNKS = 35;
const Y_SHIFT_CHUNKS = 14;
const CHUNK = 512;

function parseSampleCoordsArgs(argv) {
    const args = { mode: 'edges', step: 16, input: 'data/dumps/biome_flags.ndjson' };
    for (const a of argv) {
        if (a.startsWith('--mode=')) args.mode = a.slice('--mode='.length);
        else if (a.startsWith('--step=')) args.step = +a.slice('--step='.length);
        else if (a.startsWith('--input=')) args.input = a.slice('--input='.length);
        else if (a === '-') args.input = null; // explicit stdin
        else if (a === '-h' || a === '--help') {
            console.log('Usage: node scripts/generate.mjs sample-coords [--input=PATH|-] [--mode=edges|borders|centers|dense] [--step=16]');
            process.exit(0);
        } else {
            console.error(`unknown arg: ${a}`);
            process.exit(1);
        }
    }
    return args;
}

function readFlagsLines(input) {
    if (input === null) return null; // stdin marker
    const buf = readFileSync(input);
    const text = input.endsWith('.gz') ? gunzipSync(buf).toString('utf8') : buf.toString('utf8');
    return text.split('\n');
}

function chunkToWorld(cx, cy, subX, subY) {
    return [(cx - X_SHIFT_CHUNKS) * CHUNK + subX, (cy - Y_SHIFT_CHUNKS) * CHUNK + subY];
}

function parseFlagsLine(line, out) {
    if (!line || line.startsWith('#')) return;
    try {
        const o = JSON.parse(line);
        if (o.cx == null || o.cy == null) return;
        out.push({ cx: o.cx, cy: o.cy, name: o.name });
    } catch {}
}

async function runSampleCoords(argv) {
    const args = parseSampleCoordsArgs(argv);
    const loaded = [];
    const lines = readFlagsLines(args.input);
    if (lines !== null) {
        for (const line of lines) parseFlagsLine(line, loaded);
    } else {
        const rl = createInterface({ input: process.stdin });
        for await (const line of rl) parseFlagsLine(line, loaded);
    }

    const out = process.stdout;
    out.write(`# mode=${args.mode} loaded_chunks=${loaded.length}\n`);
    let count = 0;
    const emit = (wx, wy) => { out.write(`${wx} ${wy}\n`); count++; };

    for (const { cx, cy } of loaded) {
        if (args.mode === 'centers') {
            emit(...chunkToWorld(cx, cy, 256, 256));
            continue;
        }
        // Corners + edge midpoints + center (always emitted).
        for (const [sx, sy] of [
            [1, 1], [510, 1], [1, 510], [510, 510],
            [256, 1], [256, 510], [1, 256], [510, 256],
            [256, 256],
        ]) emit(...chunkToWorld(cx, cy, sx, sy));

        if (args.mode === 'borders') {
            for (let i = 1; i <= 8; i++) {
                const t = Math.floor((i / 9) * 510) + 1;
                emit(...chunkToWorld(cx, cy, t, 1));
                emit(...chunkToWorld(cx, cy, t, 510));
                emit(...chunkToWorld(cx, cy, 1, t));
                emit(...chunkToWorld(cx, cy, 510, t));
            }
        } else if (args.mode === 'edges' || args.mode === 'dense') {
            const step = args.mode === 'dense' ? args.step : Math.max(args.step, 8);
            const zoneA = []; // wobble-active strip at the chunk's low edge
            const zoneB = []; // wobble-active strip at the chunk's high edge
            for (let v = 0; v <= 41; v += step) zoneA.push(v);
            for (let v = 471; v <= 510; v += step) zoneB.push(v);
            const xs = [...zoneA, ...zoneB];
            const ys = [...zoneA, ...zoneB];
            for (const sx of xs) for (const sy of ys) emit(...chunkToWorld(cx, cy, sx, sy));
        }
    }
    process.stderr.write(`emitted ${count} coords\n`);
}

// ========== dispatcher ==========

function usage() {
    console.log('Usage:');
    console.log('  node scripts/generate.mjs biome-flags    [--src=PATH] [--out=PATH] [-v]');
    console.log('  node scripts/generate.mjs sample-coords  [--input=PATH|-] [--mode=edges|borders|centers|dense] [--step=16]');
}

async function main() {
    const [cmd, ...rest] = process.argv.slice(2);
    if (!cmd || cmd === '-h' || cmd === '--help') { usage(); process.exit(cmd ? 0 : 1); }
    if (cmd === 'biome-flags') return runBiomeFlags(rest);
    if (cmd === 'sample-coords') return runSampleCoords(rest);
    console.error(`unknown subcommand: ${cmd}`);
    usage();
    process.exit(1);
}

main().catch((e) => { console.error(e); process.exit(1); });

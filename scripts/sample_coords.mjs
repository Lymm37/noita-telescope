// Emit world (wx, wy) coords focused on the loaded biome region for the
// wobble comparison. Reads a `noitrainer biome-flags` NDJSON dump (default
// `data/dumps/biome_flags.ndjson`, supports `.gz`) and for each loaded
// chunk emits a sampling of points.
//
//   node scripts/sample_coords.mjs                                  # default fixture, edges mode
//   node scripts/sample_coords.mjs --input=PATH --mode=borders
//   node scripts/sample_coords.mjs --mode=dense --step=8 > coords.txt
//
// Modes:
//   centers   — one point per loaded chunk (chunk center). Tiny set.
//   borders   — N=8 points along each chunk edge (32 per chunk).
//   edges     — corners + 4-edge midpoints + per-chunk edge sub-grid (default).
//   dense     — full edge zone sweep at every --step-pixel offset (heavy).
//
// World coord math matches noitrainer / telescope: shifted_x = wx + 17920,
// chunk_cx = floor(shifted_x / 512), so wx for (cx, sub_x) is
// (cx - 35)*512 + sub_x. Same on Y with shift 7168.

import { readFileSync, createReadStream } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { createInterface } from 'node:readline';

const X_SHIFT_CHUNKS = 35; // grid_width / 2 for normal mode
const Y_SHIFT_CHUNKS = 14;
const CHUNK = 512;

function parseArgs() {
  const args = { mode: 'edges', step: 16, input: 'data/dumps/biome_flags.ndjson' };
  for (const a of process.argv.slice(2)) {
    if (a.startsWith('--mode=')) args.mode = a.slice(7);
    else if (a.startsWith('--step=')) args.step = +a.slice(7);
    else if (a.startsWith('--input=')) args.input = a.slice('--input='.length);
    else if (a === '-') args.input = null; // explicit stdin
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

function parseLine(line, out) {
  if (!line || line.startsWith('#')) return;
  try {
    const o = JSON.parse(line);
    if (o.cx == null || o.cy == null) return;
    out.push({ cx: o.cx, cy: o.cy, name: o.name });
  } catch {
    // ignore non-json lines
  }
}

async function main() {
  const args = parseArgs();
  const loaded = []; // [{cx, cy, name}]
  const lines = readFlagsLines(args.input);
  if (lines !== null) {
    for (const line of lines) parseLine(line, loaded);
  } else {
    const rl = createInterface({ input: process.stdin });
    for await (const line of rl) parseLine(line, loaded);
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

    // Always include corners + edge midpoints.
    for (const [sx, sy] of [
      [1, 1], [510, 1], [1, 510], [510, 510],            // corners (offset 1 to avoid landing in neighbor)
      [256, 1], [256, 510], [1, 256], [510, 256],        // edge midpoints
      [256, 256],                                          // center
    ]) {
      emit(...chunkToWorld(cx, cy, sx, sy));
    }

    if (args.mode === 'borders') {
      // 8 points along each of the 4 borders.
      for (let i = 1; i <= 8; i++) {
        const t = Math.floor((i / 9) * 510) + 1;
        emit(...chunkToWorld(cx, cy, t, 1));      // top
        emit(...chunkToWorld(cx, cy, t, 510));    // bottom
        emit(...chunkToWorld(cx, cy, 1, t));      // left
        emit(...chunkToWorld(cx, cy, 510, t));    // right
      }
    } else if (args.mode === 'edges' || args.mode === 'dense') {
      const step = args.mode === 'dense' ? args.step : Math.max(args.step, 8);
      // Sweep the four edge zones (the wobble-active strips of width 42 +
      // tail of 42). Sub-grid of `step` px per axis.
      const zoneA = []; // 0..41
      const zoneB = []; // 471..510
      for (let v = 0; v <= 41; v += step) zoneA.push(v);
      for (let v = 471; v <= 510; v += step) zoneB.push(v);
      const xs = [...zoneA, ...zoneB];
      const ys = [...zoneA, ...zoneB];
      for (const sx of xs) {
        for (const sy of ys) {
          emit(...chunkToWorld(cx, cy, sx, sy));
        }
      }
    }
  }
  process.stderr.write(`emitted ${count} coords\n`);
}

main().catch((e) => { console.error(e); process.exit(1); });

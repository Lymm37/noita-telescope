// data/pixel_scene_meta.json is what the app starts from instead of decoding
// every scene PNG; a stale copy gives wrong spawn points, recolor classes or art
// coverage for the scenes it disagrees on. Regenerate with
// `node tools/gen_pixel_scene_meta.mjs`.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { buildPixelSceneMeta } from '../js/pixel_scene_generation.js';
import { serializePixelSceneMeta } from '../tools/gen_pixel_scene_meta.mjs';

test('pixel_scene_meta.json matches the scene PNGs', async () => {
	const shipped = readFileSync(new URL('../data/pixel_scene_meta.json', import.meta.url), 'utf8');
	assert.equal(shipped, serializePixelSceneMeta(await buildPixelSceneMeta()),
		'data/pixel_scene_meta.json is stale: run node tools/gen_pixel_scene_meta.mjs');
});

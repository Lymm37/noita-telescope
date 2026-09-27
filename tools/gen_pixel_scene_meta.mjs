/* global process */
// Writes data/pixel_scene_meta.json: every pixel scene's size, color classes,
// spawn points and art coverage, so the app starts without decoding the PNGs
// (js/pixel_scene_generation.js loadPixelSceneData). Rerun after changing any
// scene PNG, its colors file, the scene lists or the spawn-function colors;
// test/pixel_scene_meta.test.mjs fails until you do.
//
// Run: node tools/gen_pixel_scene_meta.mjs
import { writeFile } from 'node:fs/promises';
import { buildPixelSceneMeta } from '../js/pixel_scene_generation.js';

export function serializePixelSceneMeta(meta) {
	// One scene per line, so a regenerated file diffs by scene.
	const lines = Object.entries(meta.scenes).map(([key, m]) => `\t\t${JSON.stringify(key)}: ${JSON.stringify(m)}`);
	return `{\n\t"version": ${meta.version},\n\t"scenes": {\n${lines.join(',\n')}\n\t}\n}\n`;
}

if (import.meta.url === `file://${process.argv[1]}`) {
	const meta = await buildPixelSceneMeta();
	const out = new URL('../data/pixel_scene_meta.json', import.meta.url);
	const text = serializePixelSceneMeta(meta);
	await writeFile(out, text);
	console.log(`Wrote ${Object.keys(meta.scenes).length} scenes, ${text.length} bytes to data/pixel_scene_meta.json`);
}

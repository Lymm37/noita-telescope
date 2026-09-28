/* global process */
// Maps every pixel scene telescope ships to the BACKGROUND image the game draws
// behind it, and generates js/pixel_scene_backgrounds.js, the manifest the scene
// loader reads.
//
// LoadPixelScene(materials, colors, x, y, background_filename, ...) -- and the
// equivalent <PixelScene background_filename="..."> -- blits that image 1:1 at
// the scene position as a background sprite (z = background_z_index, default
// 50, PixelScene_ProcessQueue @00882dd0). It sits behind every cell and in
// front of the biome backdrop, so it shows through the scene's air (#000042
// force-air included), through gaps its art never paints, and under its
// translucent liquids. It is worldgen, not decoration: no "custom art" toggle
// governs it.
//
// Sources of the scene -> background mapping, all three of which the game
// actually uses (an implicit "<name>_background.png next to the material PNG"
// rule does NOT hold -- plenty of those files ship unreferenced):
//   * lua scene tables:   material_file = "x.png", background_file = "y.png"
//   * lua calls:          LoadPixelScene( "x.png", "x_visual.png", px, py, "y.png" )
//   * biome/*.xml:        <PixelScene material_filename=".." background_filename=".." >
//
// A telescope scene is matched to a game material path by basename within the
// biome_impl subdirs its scene dir maps to (GAME_DIRS, same table as
// tools/gen_visual_overlays.mjs), confirmed by PNG dimensions -- basenames
// collide across biomes ("altar" is both data/biome_impl/altar.png and
// data/biome_impl/temple/altar.png, and only the latter has a background).
//
// ONE MATERIAL, SEVERAL BACKGROUNDS: the map above is keyed by the scene, but
// the game keys the CALL SITE, and several biomes stamp the same scene PNG with
// different background art. data/biome_impl/essenceroom.png is loaded by nine
// biome scripts: six pass essenceroom_background_with_diamond.png (a 98% opaque
// slab) and three -- rock_room, moon_room, essenceroom_air -- pass
// essenceroom_background_diamond.png, which is 88% transparent, so in those
// three the biome's own backdrop tiles show through the room and only the
// diamond silhouette is painted. A flat first-wins map silently gave all nine
// the opaque one, walling off every rock_room/moon_room chunk (seed 786433191
// ng0: biome-map cells 28,20 and 66,20).
//
// So a second map is emitted: SCENE_BACKGROUNDS_BY_BIOME, biome -> scene name ->
// background, carrying only the (biome, scene) pairs whose background DIFFERS
// from the flat map. The biome's own art is authoritative: each biome XML names
// its lua_script, and that lua's LoadPixelScene call is the one the engine runs
// for that biome. Gamepad variants stay excluded exactly as in the flat map
// (see isGamepadVariant), and a background the game references but does not ship
// (temple/altar_background_secret.png) is dropped like any other dead path.
//
// Art is shipped under data/backgrounds/<game path minus data/>, the layout
// tools/gen_backgrounds.py already uses for the backdrops and the global
// <BackgroundImages> sprites, so the two share one set of files and one
// preloader (js/biome_backgrounds.js). Files already present are left alone.
//
//   node tools/gen_scene_backgrounds.mjs [path-to-data.wak.unpacked]
import { readFileSync, writeFileSync, readdirSync, existsSync, copyFileSync, mkdirSync, statSync } from 'node:fs';
import { join, dirname, basename } from 'node:path';
import { fileURLToPath } from 'node:url';

const repo = dirname(dirname(fileURLToPath(import.meta.url)));
const GAME = process.argv[2]
	?? '/home/vitaminmoo/reverse/noita/noita_Jan_25_2025_15:55:41/data/data.wak.unpacked';
const IMPL = join(GAME, 'biome_impl');
const SCENES = join(repo, 'data', 'pixel_scenes');

// telescope scene dir -> game biome_impl subdirs to try, in order. '' is the
// biome_impl root, where the shared scenes live. Kept in sync with
// tools/gen_visual_overlays.mjs.
const GAME_DIRS = {
	general: [''],
	rainforest_open: ['rainforest'],
	rainforest_dark: ['rainforest_dark', 'rainforest'],
	// spliced scenes were assembled from numbered tiles by the original
	// exporter, so no single game material PNG corresponds to one.
	spliced: [],
	sky_islands: ['sky_islands'],
};

function pngSize(path) {
	const b = readFileSync(path);
	// IHDR width/height at fixed offsets in any valid PNG
	return { w: b.readUInt32BE(16), h: b.readUInt32BE(20) };
}

function walk(dir, out = []) {
	for (const name of readdirSync(dir)) {
		const p = join(dir, name);
		if (statSync(p).isDirectory()) walk(p, out);
		else out.push(p);
	}
	return out;
}

/**
 * Every `LoadPixelScene( materials, colors, x, y, background, ... )` in one lua
 * file, as [materials, background] pairs of string LITERALS. Commented-out calls
 * are skipped, as are calls whose two interesting arguments are not literals.
 * The position arguments are arbitrary expressions, so the argument list is
 * split on top-level commas rather than matched with a regex.
 */
function loadPixelSceneCalls(text) {
	const pairs = [];
	for (const m of text.matchAll(/LoadPixelScene\s*\(/g)) {
		// skip commented-out calls (`--LoadPixelScene(...)`)
		const lineStart = text.lastIndexOf('\n', m.index) + 1;
		if (/--[^\n]*$/.test(text.slice(lineStart, m.index))) continue;
		const args = [];
		let depth = 1, arg = '', quote = false;
		for (let i = m.index + m[0].length; i < text.length && depth > 0; i++) {
			const c = text[i];
			if (quote) { if (c === '"') quote = false; arg += c; continue; }
			if (c === '"') { quote = true; arg += c; continue; }
			if (c === '(' || c === '{') depth++;
			else if (c === ')' || c === '}') { depth--; if (depth === 0) break; }
			if (depth === 1 && c === ',') { args.push(arg); arg = ''; continue; }
			arg += c;
		}
		args.push(arg);
		const lit = (s) => { const q = /^\s*"([^"]*)"\s*$/.exec(s ?? ''); return q ? q[1] : null; };
		const mat = lit(args[0]), bg = lit(args[4]);
		if (mat && bg) pairs.push([mat, bg]);
	}
	return pairs;
}

// ---------------------------------------------------------------------------
// 1. game material path -> background path

const bgForMaterial = new Map();
const conflicts = [];

/** Backgrounds the game only reaches with a controller plugged in:
 *
 *   if GameGetIsGamepadConnected() then
 *     LoadPixelScene( "..hall.png", .., "..hall_background_gamepad_updated.png", .. )
 *   else
 *     LoadPixelScene( "..hall.png", .., "..hall_background.png", .. )
 *
 * (data/scripts/biomes/mountain/mountain_hall.lua:108, and the same shape in
 * mountain_left_entrance.lua:209). They differ only in which button glyphs the
 * painted-on control hints show, and the keyboard variant is the one telescope
 * wants, so a gamepad path never wins a conflict against a non-gamepad one. */
const isGamepadVariant = (path) => /gamepad/i.test(path);

/** Dead references (endgame2_background.png, temple/altar_background_secret.png)
 *  and lua concat fragments the scan can pick up are dropped here rather than at
 *  copy time. */
const backgroundShips = (background) =>
	!!background && background.startsWith('data/') && existsSync(join(GAME, background.slice(5)));

function record(material, background, where) {
	if (!material || !background) return;
	if (!material.startsWith('data/')) return;
	if (!backgroundShips(background)) return;
	const prev = bgForMaterial.get(material);
	if (prev && prev !== background) {
		// Deterministic regardless of scan order: the non-gamepad variant wins,
		// and anything else keeps the first reference seen.
		if (isGamepadVariant(prev) && !isGamepadVariant(background)) {
			conflicts.push(`${material}: ${prev} vs ${background} (${where}, taking the non-gamepad one)`);
			bgForMaterial.set(material, background);
			return;
		}
		conflicts.push(`${material}: ${prev} vs ${background} (${where}, keeping ` +
			`${isGamepadVariant(background) ? 'the non-gamepad one' : 'first'})`);
		return;
	}
	bgForMaterial.set(material, background);
}

// lua scene tables. Splitting on braces keeps a pairing inside one table entry
// (the fields appear in either order and the entries are flat).
const luaFiles = walk(GAME).filter(p => p.endsWith('.lua'));
for (const file of luaFiles) {
	const text = readFileSync(file, 'utf8');
	for (const segment of text.split(/[{}]/)) {
		const mat = /material_file\s*=\s*"([^"]+)"/.exec(segment);
		const bg = /background_file\s*=\s*"([^"]+)"/.exec(segment);
		if (mat && bg) record(mat[1], bg[1], file);
	}
	for (const [mat, bg] of loadPixelSceneCalls(text)) record(mat, bg, file);
}

// biome XML: attribute order varies between files, so the tag is matched first
// and its attributes read out individually.
const biomeDir = join(GAME, 'biome');
for (const file of walk(biomeDir).filter(p => p.endsWith('.xml'))) {
	const text = readFileSync(file, 'utf8').replace(/<!--[\s\S]*?-->/g, '');
	for (const tag of text.match(/<PixelScene\b[^>]*>/g) ?? []) {
		const attr = (name) => new RegExp(`${name}="([^"]*)"`).exec(tag)?.[1] ?? '';
		record(attr('material_filename'), attr('background_filename'), file);
	}
}

// ---------------------------------------------------------------------------
// 1b. biome -> scene name -> background, wherever that biome disagrees with the
// map above (see the ONE MATERIAL, SEVERAL BACKGROUNDS note).
//
// A biome XML names the lua that generates it (`lua_script`), and the biome's
// name is that XML's own basename -- the same name GENERATOR_CONFIG and
// js/static_spawns.js use, which is what a placement carries. So the
// (biome, scene) -> background the engine actually runs is read straight off
// the biome's own lua.

const byBiome = {};
for (const file of walk(biomeDir).filter(p => p.endsWith('.xml'))) {
	const biome = basename(file, '.xml');
	const xml = readFileSync(file, 'utf8').replace(/<!--[\s\S]*?-->/g, '');
	const luaScript = /lua_script="([^"]*)"/.exec(xml)?.[1];
	if (!luaScript || !luaScript.startsWith('data/')) continue;
	const luaPath = join(GAME, luaScript.slice(5));
	if (!existsSync(luaPath)) continue;
	for (const [material, background] of loadPixelSceneCalls(readFileSync(luaPath, 'utf8'))) {
		if (!backgroundShips(background)) continue;
		// The flat map is already right for this biome's scene, or this is the
		// gamepad twin of a call the flat map deliberately resolved the other way.
		if (bgForMaterial.get(material) === background) continue;
		if (isGamepadVariant(background)) continue;
		(byBiome[biome] ??= {})[basename(material, '.png')] = background;
	}
}

// ---------------------------------------------------------------------------
// 2. telescope scene -> that background, shipped

let copied = 0;

/** Copies one game background into the repo, returning its repo-relative path. */
function shipBackground(background) {
	const dest = 'data/backgrounds/' + background.slice(5);
	const destPath = join(repo, dest);
	if (!existsSync(destPath)) {
		mkdirSync(dirname(destPath), { recursive: true });
		copyFileSync(join(GAME, background.slice(5)), destPath);
		copied++;
	}
	return dest;
}

const manifest = {};
const sizeNotes = [];
// Scene names telescope actually ships, so the by-biome map never carries an
// override for a scene the renderer has no record of.
const shippedSceneNames = new Set();
for (const dir of readdirSync(SCENES).sort()) {
	if (!statSync(join(SCENES, dir)).isDirectory()) continue;
	const gameDirs = GAME_DIRS[dir] ?? [dir, ''];
	for (const file of readdirSync(join(SCENES, dir)).sort()) {
		if (!file.endsWith('.png') || file.includes('_visual') || file.includes('_background')) continue;
		const name = file.slice(0, -4);
		shippedSceneNames.add(name);
		const ours = pngSize(join(SCENES, dir, file));
		// A spliced scene is several <PixelScene> pieces (biome_impl/spliced/
		// <name>.xml), each blitting its own background at its own position. The
		// splice origin is the combined scene's top-left, and the combined
		// <name>_background.png already shipped beside the scene is those pieces
		// pasted together (byte-identical to the game's own combined file; for
		// watercave, the only piece with one is piece 0 at the origin).
		if (dir === 'spliced') {
			const combined = `data/pixel_scenes/spliced/${name}_background.png`;
			if (existsSync(join(repo, combined))) manifest[`${dir}/${name}`] = combined;
			continue;
		}
		for (const gd of gameDirs) {
			const rel = `data/biome_impl/${gd ? gd + '/' : ''}${name}.png`;
			const mat = join(IMPL, gd, `${name}.png`);
			if (!existsSync(mat)) continue;
			const theirs = pngSize(mat);
			if (theirs.w !== ours.w || theirs.h !== ours.h) continue; // different scene sharing the name
			const bg = bgForMaterial.get(rel);
			if (!bg) break; // this IS the scene, it simply has no background
			const dest = shipBackground(bg);
			const bgSize = pngSize(join(repo, dest));
			if (bgSize.w !== ours.w || bgSize.h !== ours.h) {
				sizeNotes.push(`${dir}/${name}: scene ${ours.w}x${ours.h}, background ${bgSize.w}x${bgSize.h}`);
			}
			manifest[`${dir}/${name}`] = dest;
			break;
		}
	}
}

// Ship the by-biome overrides too, dropping any whose scene telescope has no
// record for -- a placement can only ever ask for a scene that was loaded.
const overrides = {};
for (const biome of Object.keys(byBiome).sort()) {
	for (const scene of Object.keys(byBiome[biome]).sort()) {
		if (!shippedSceneNames.has(scene)) continue;
		(overrides[biome] ??= {})[scene] = shipBackground(byBiome[biome][scene]);
	}
}

const sorted = Object.fromEntries(Object.keys(manifest).sort().map(k => [k, manifest[k]]));
const out = `// GENERATED by tools/gen_scene_backgrounds.mjs -- do not edit.
// Scene key (\`\${getBiomeAlias(biome)}/\${sceneName}\`, the data/pixel_scenes
// path) -> the repo-relative background image the engine draws behind that
// scene (LoadPixelScene's background_filename, z = 50). The image is blitted
// 1:1 at the scene's top-left, so a background larger or smaller than the scene
// hangs off / falls short exactly as it does in game.
export const SCENE_BACKGROUNDS = ${JSON.stringify(sorted, null, '\t')};

// biome -> scene name -> background, for the (biome, scene) pairs where the
// biome's OWN lua passes different art than the map above. One scene PNG can be
// stamped by many biomes with different backgrounds: essenceroom.png is loaded
// by nine biome scripts, three of which (rock_room, moon_room, essenceroom_air)
// pass the 88%-transparent essenceroom_background_diamond.png instead of the
// opaque essenceroom_background_with_diamond.png, so in those three the biome
// backdrop shows through the room. A placement carries the biome it spawned for,
// so the scene loader checks here first (js/pixel_scene_generation.js).
export const SCENE_BACKGROUNDS_BY_BIOME = ${JSON.stringify(overrides, null, '\t')};
`;
writeFileSync(join(repo, 'js', 'pixel_scene_backgrounds.js'), out);

console.log(`${bgForMaterial.size} scene->background pairs in the game data`);
for (const c of conflicts) console.log(`  conflict ${c}`);
console.log(`${Object.keys(sorted).length} telescope scenes have one (${copied} PNGs newly copied)`);
const overrideCount = Object.values(overrides).reduce((n, m) => n + Object.keys(m).length, 0);
console.log(`${overrideCount} biome-specific overrides across ${Object.keys(overrides).length} biomes:`);
for (const biome of Object.keys(overrides)) {
	for (const [scene, path] of Object.entries(overrides[biome])) console.log(`  ${biome}/${scene} -> ${path}`);
}
if (sizeNotes.length) {
	console.log(`${sizeNotes.length} backgrounds are not scene-sized (anchored top-left):`);
	for (const n of sizeNotes) console.log(`  ${n}`);
}
console.log('js/pixel_scene_backgrounds.js written');

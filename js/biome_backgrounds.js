import { fetchSafeJson } from "./utils.js";
import { SCENE_BACKGROUNDS, SCENE_BACKGROUNDS_BY_BIOME } from "./pixel_scene_backgrounds.js";

// Biome backgrounds, keyed the way the engine keys them.
//
// The engine builds exactly one background sprite per 512px world chunk
// (ChunkGrid_CreateAndGenerateChunk -> BiomeRenderer_DrawWeatherLayers). The
// biome it uses is sampled at the chunk *center*, which is deep inside the
// interior region where the edge-noise resolver short-circuits, so the
// background never wobbles: its boundaries are dead-straight chunk lines.
//
// What that sprite shows is the biome's `background_image`, repeat-tiled and
// world-aligned. Many biomes share one image -- 67 of the 175 biome-map colors
// resolve to background_cave_02.png alone -- and where two neighbouring chunks
// share an image the game shows one continuous background with no boundary at
// all. Telescope used to paint a flat color per *biome*, which invented visible
// color steps in all of those places.
//
// So the background layer keys on `background_image`, and the flat color for an
// image is the alpha-weighted mean of that image's own pixels (precomputed in
// data/biome_backgrounds.json). Biomes with an empty `background_image` draw no
// background at all in game -- DrawWeatherLayers returns immediately -- so they
// render as void rather than as some flat color.
//
// The tables here are deliberately separate from BIOME_BACKGROUND_COLORS /
// BIOME_COLOR_LOOKUP in image_processing.js: those also drive tile overlays and
// pixel-scene fills, which still want per-biome identity.

const data = await fetchSafeJson('../data/biome_backgrounds.json');

// Sentinel for "the engine draws nothing here".
export const BACKGROUND_VOID = -1;

// Biomes with no background_image that nevertheless sit in telescope's fake sky
// band. In game the sky is painted by the parallax system, not by this chunk
// grid, and telescope models that separately (the sky gradient in
// renderRecolorMap plus the surface overlay art). Voiding them would punch black
// holes in the sky, so they keep whatever color telescope already gives them.
// Every other empty-background biome is genuine void.
const SKY_BIOME_COLORS = new Set([
	0xd3e6f0, // the_sky
	0xfe0000, // sky_light_injector
]);

// background_image path -> index, so per-chunk grids can be Int16Array.
export const BACKGROUND_IMAGE_PATHS = Object.keys(data.images);
const IMAGE_INDEX = new Map(BACKGROUND_IMAGE_PATHS.map((p, i) => [p, i]));
const IMAGE_COLORS = BACKGROUND_IMAGE_PATHS.map((p) => parseInt(data.images[p].color, 16));

// biome-map RGB -> everything the background layer needs about that biome.
function edgeRec(path) {
	if (!path) return null;
	return { art: path, mask: data.edgeMasks[path] ?? null };
}
const BY_COLOR = new Map();
for (const b of data.biomes) {
	const rgb = parseInt(b.color, 16) & 0xffffff;
	BY_COLOR.set(rgb, {
		imageIndex: b.background_image ? IMAGE_INDEX.get(b.background_image) : -1,
		priority: b.background_edge_priority ?? 0,
		// Each direction carries both the biome's real strip art (art, shipped by
		// tools/gen_backgrounds.py) and the alpha-dedup mask the flat fallback
		// tints (mask): the 88 referenced strips share just 18 distinct masks.
		edges: {
			left: edgeRec(b.background_edge_left),
			right: edgeRec(b.background_edge_right),
			top: edgeRec(b.background_edge_top),
			bottom: edgeRec(b.background_edge_bottom),
		},
	});
}

// The color the background layer should paint for one biome-map cell:
//   * an RGB int for a biome with a background_image,
//   * BACKGROUND_VOID where the engine draws no background,
//   * null for "keep whatever telescope already decided" -- unknown biome colors
//     and the sky biomes above.
export function backgroundLayerColor(biomeColorInt) {
	const rgb = biomeColorInt & 0xffffff;
	const rec = BY_COLOR.get(rgb);
	if (!rec) return null;
	if (rec.imageIndex < 0) return SKY_BIOME_COLORS.has(rgb) ? null : BACKGROUND_VOID;
	return IMAGE_COLORS[rec.imageIndex];
}

// ---------------------------------------------------------------------------
// Ragged boundary strips
//
// The straight chunk line between two different backgrounds is decorated, not
// displaced. For each of its two "lower" boundaries (left and top) a chunk
// resolves the neighbour at center +/- 512 -- again interior coords, so again no
// wobble -- and if that neighbour's background_image string differs it emits a
// single hand-drawn 64px strip (BiomeRenderer_CreateTransitionSprite @ 006f4910)
// for the *winning* side only, so the winner's background bleeds 64px into the
// loser's chunk. The winner is the higher background_edge_priority, ties broken
// by string compare on the background_image path, which the game documents as
// "if both biomes have edges defined, will use the one with higher priority (if
// priority is same, will compare (>) background_images)".
//
// The art is 64x640 (left/right) or 640x64 (top/bottom): 512 for the boundary
// itself plus 64 of overhang at each end, and the engine trims an overhang with
// SetSourceRect when the adjacent boundary segment is not part of the same
// transition. We reproduce the geometry exactly and approximate "same
// transition" as "both chunks on the adjacent segment carry the same background
// images as this one", which is what the engine's diagonal priority probes come
// down to for a continuous boundary.
//
// This is the cheap variant of the effect: we do not ship the background art
// itself, only the strips' alpha, and fill it with the winner's flat color.

const CHUNK = 512;
const STRIP = 64;
// Strip length along the boundary: the chunk plus one overhang at each end.
const STRIP_LEN = CHUNK + 2 * STRIP;

const EDGE_MASK_BITMAPS = new Map();
let edgeMaskPromise = null;

// Kick this off once; the draw path silently skips strips whose mask has not
// arrived yet, so it never blocks generation or the first frames.
export function loadBackgroundEdgeMasks() {
	return edgeMaskPromise ??= (async () => {
		const { loadPNGBitmap } = await import('./png_sanitizer.js');
		const paths = [...new Set(Object.values(data.edgeMasks))];
		await Promise.all(paths.map(async (p) => {
			try { EDGE_MASK_BITMAPS.set(p, await loadPNGBitmap('../' + p)); }
			catch (e) { console.warn('Background edge mask failed to load:', p, e); }
		}));
	})();
}

// Flat-colored copy of one strip, cached per (mask, color) so the per-frame draw
// path never allocates. There are at most ~4 directions x 23 background colors of
// these, and only the ones actually on screen are ever built.
const tintedStrips = new Map();
export function tintedEdgeStrip(maskPath, color) {
	const key = maskPath + '|' + color;
	const hit = tintedStrips.get(key);
	if (hit !== undefined) return hit;
	const mask = EDGE_MASK_BITMAPS.get(maskPath);
	if (!mask) return null; // not loaded yet -- don't cache the miss
	const canvas = document.createElement('canvas');
	canvas.width = mask.width;
	canvas.height = mask.height;
	const ctx = canvas.getContext('2d');
	ctx.drawImage(mask, 0, 0);
	ctx.globalCompositeOperation = 'source-in';
	ctx.fillStyle = '#' + (color >>> 0).toString(16).padStart(6, '0');
	ctx.fillRect(0, 0, canvas.width, canvas.height);
	tintedStrips.set(key, canvas);
	return canvas;
}

function imagePathOf(rec) {
	return rec && rec.imageIndex >= 0 ? BACKGROUND_IMAGE_PATHS[rec.imageIndex] : '';
}

function edgeWinner(a, b) {
	if (a.priority !== b.priority) return a.priority > b.priority ? a : b;
	return imagePathOf(a) >= imagePathOf(b) ? a : b;
}

// Precompute every boundary strip for one biome-map layer, bucketed by chunk row
// so the per-frame draw only walks the visible rows. Coordinates are map-local
// pixels; `skipCells` (optional, one byte per cell) marks cells telescope paints
// no background into -- its fake sky in the main world, the columns that generate
// nothing in the vertical bands -- which therefore have no strips either.
export function buildBackgroundEdges(pixels, w, h, skipCells) {
	const rows = Array.from({ length: h }, () => []);
	const wrapX = (cx) => ((cx % w) + w) % w; // parallel worlds tile horizontally
	const at = (cx, cy) => (cy < 0 || cy >= h) ? null : BY_COLOR.get(pixels[cy * w + wrapX(cx)] & 0xffffff) ?? null;
	const isSkipped = (cx, cy) => !!skipCells && cy >= 0 && cy < h && skipCells[cy * w + wrapX(cx)] === 1;
	const same = (a, b) => imagePathOf(a) === imagePathOf(b);

	for (let cy = 0; cy < h; cy++) {
		for (let cx = 0; cx < w; cx++) {
			const me = at(cx, cy);
			// DrawWeatherLayers returns before it looks at either boundary when the
			// chunk has no background image, so an empty chunk never decorates its
			// own left or top edge.
			if (!me || me.imageIndex < 0 || isSkipped(cx, cy)) continue;

			// Left boundary: this chunk's *_left art sits outside it, the left
			// neighbour's *_right art sits inside it.
			const west = at(cx - 1, cy);
			if (west && !same(me, west) && !isSkipped(cx - 1, cy)) {
				const mine = edgeWinner(me, west) === me;
				const edge = mine ? me.edges.left : west.edges.right;
				if (edge) {
					const keepTop = same(at(cx, cy - 1), me) && same(at(cx - 1, cy - 1), west);
					const keepBottom = same(at(cx, cy + 1), me) && same(at(cx - 1, cy + 1), west);
					const sy = keepTop ? 0 : STRIP;
					const sh = (keepBottom ? STRIP_LEN : STRIP_LEN - STRIP) - sy;
					rows[cy].push({
						art: edge.art, mask: edge.mask,
						color: IMAGE_COLORS[(mine ? me : west).imageIndex],
						sx: 0, sy, sw: STRIP, sh,
						dx: cx * CHUNK - (mine ? STRIP : 0), dy: cy * CHUNK - STRIP + sy,
						dw: STRIP, dh: sh,
					});
				}
			}

			// Top boundary: this chunk's *_top art sits above it, the north
			// neighbour's *_bottom art sits below the line, inside this chunk.
			const north = at(cx, cy - 1);
			if (north && !same(me, north) && !isSkipped(cx, cy - 1)) {
				const mine = edgeWinner(me, north) === me;
				const edge = mine ? me.edges.top : north.edges.bottom;
				if (edge) {
					const keepLeft = same(at(cx - 1, cy), me) && same(at(cx - 1, cy - 1), north);
					const keepRight = same(at(cx + 1, cy), me) && same(at(cx + 1, cy - 1), north);
					const sx = keepLeft ? 0 : STRIP;
					const sw = (keepRight ? STRIP_LEN : STRIP_LEN - STRIP) - sx;
					rows[cy].push({
						art: edge.art, mask: edge.mask,
						color: IMAGE_COLORS[(mine ? me : north).imageIndex],
						sx, sy: 0, sw, sh: STRIP,
						dx: cx * CHUNK - STRIP + sx, dy: cy * CHUNK - (mine ? STRIP : 0),
						dw: sw, dh: STRIP,
					});
				}
			}
		}
	}
	return rows;
}

// ---------------------------------------------------------------------------
// Full-art background layer (game-accurate)
//
// tools/gen_backgrounds.py ships the game's actual background art (~2.4 MB of
// PNG) plus data/background_data.json. With it loaded, the layer draws what the
// engine draws (docs/worldgen/background_rendering.md in the RE repo):
//
//   1. per 512px chunk, the biome's background_image repeat-tiled in ABSOLUTE
//      world coordinates (the engine sets GL_REPEAT on a world-rect sprite, so
//      texel = image[(x mod w, y mod h)] -- same rule as material textures);
//   2. the hand-drawn 64px transition strips where neighbouring chunks' images
//      differ, now with their real pixels instead of a flat-tinted mask;
//   3. pixel-scene backgrounds (background_filename), blitted 1:1 at the scene
//      position, z = 50 (PixelScene_ProcessQueue @ 00882dd0);
//   4. the <BackgroundImages> sprites of biome/_pixel_scenes.xml, z = 30.
//
// The background SceneGraph draws HIGH z first, so within this layer the order
// is: backdrop tiles (z ~99) -> strips -> scene backgrounds (50) -> globals
// (30); the cell grid then composites over all of it with straight src-over
// alpha (shaders/sprite_cellgrid.frag), which is what the GL terrain layer's
// premultiplied translucent output reproduces.
//
// Everything here degrades gracefully: until the art arrives the flat-color
// canvas + tinted masks above keep drawing, and any missing bitmap just keeps
// its fallback.

let artData = null;                    // data/background_data.json
const ART_BITMAPS = new Map();         // repo-relative path -> ImageBitmap
let artPromise = null;

export function loadBackgroundArt() {
	return artPromise ??= (async () => {
		const { loadPNGBitmap } = await import('./png_sanitizer.js');
		artData = await fetchSafeJson('../data/background_data.json');
		const wanted = new Set();
		// backdrops + real edge strips (per-biome paths, shipped verbatim)
		for (const p of BACKGROUND_IMAGE_PATHS) wanted.add(p);
		for (const rec of BY_COLOR.values()) {
			for (const dir of Object.values(rec.edges)) if (dir?.art) wanted.add(dir.art);
		}
		// Scene backgrounds come from the generated manifest, keyed the way
		// telescope keys scenes (dir/name). background_data.json carries a
		// sceneBackgrounds map of its own, keyed by bare material basename,
		// which is ambiguous across biomes ("altar" is two different scenes in
		// two biomes with two different backgrounds) and misses every scene
		// whose background comes from a lua scene table; the manifest supersedes
		// it, and only the art it references is worth decoding.
		for (const p of Object.values(SCENE_BACKGROUNDS)) wanted.add(p);
		// ... plus the art the biome-specific overrides point at, which is the
		// only art some biomes ever ask for: rock_room's essence room never draws
		// the opaque with_diamond slab the flat map carries.
		for (const scenes of Object.values(SCENE_BACKGROUNDS_BY_BIOME)) {
			for (const p of Object.values(scenes)) wanted.add(p);
		}
		for (const g of artData.globalImages) wanted.add(g.file);
		await Promise.all([...wanted].map(async (p) => {
			try { ART_BITMAPS.set(p, await loadPNGBitmap('../' + p)); }
			catch (e) { console.warn('Background art failed to load:', p, e); }
		}));
		artLoaded = true;
		return artData;
	})();
}

export function backgroundArtReady() {
	return !!artData;
}

/** True once every backdrop/strip/scene bitmap has been decoded (or failed),
 *  i.e. a draw made now will not change when more art lands. */
let artLoaded = false;
export function backgroundArtLoaded() {
	return artLoaded;
}

/** The decoded backdrop image for a run's imageIndex, or null. */
export function backdropBitmap(imageIndex) {
	return ART_BITMAPS.get(BACKGROUND_IMAGE_PATHS[imageIndex]) ?? null;
}

/** The real strip art for one buildBackgroundEdges record, or null. */
export function edgeStripArt(e) {
	return e.art ? ART_BITMAPS.get(e.art) ?? null : null;
}

// ---------------------------------------------------------------------------
// Backdrop tile runs
//
// One entry per horizontal run of consecutive chunks sharing a background
// image, bucketed by chunk row like the strips, so the per-frame draw walks
// only visible rows and issues one clipped tiling loop per run.

export function buildBackdropRuns(pixels, w, h, skipCells) {
	const rows = Array.from({ length: h }, () => []);
	for (let cy = 0; cy < h; cy++) {
		let run = null;
		for (let cx = 0; cx <= w; cx++) {
			const i = cy * w + cx;
			let idx = -1;
			if (cx < w && (!skipCells || skipCells[i] !== 1)) {
				const rec = BY_COLOR.get(pixels[i] & 0xffffff);
				if (rec) idx = rec.imageIndex;
			}
			if (run && run.imageIndex === idx) { run.len++; continue; }
			if (run && run.imageIndex >= 0) rows[cy].push(run);
			run = idx >= 0 ? { imageIndex: idx, cx, cy, len: 1 } : null;
		}
		if (run && run.imageIndex >= 0) rows[cy].push(run);
	}
	return rows;
}

/**
 * Draws the backdrop tile runs for one world copy. Map-local chunk coords; the
 * caller passes the world-copy pixel shift. Tiles are aligned to the ABSOLUTE
 * canvas frame (shift included): shifts are multiples of 512 and so is the
 * map-to-world offset, which makes canvas-frame alignment identical to the
 * engine's absolute-world alignment for every image size that divides 512 --
 * and the general pmod phase below handles the ones that don't (96x96).
 */
export function drawBackdropRuns(ctx, rows, shiftX, shiftY, viewRect) {
	if (!artData) return false;
	const pmod = (v, m) => ((v % m) + m) % m;
	const firstRow = Math.max(0, Math.floor((viewRect.top - shiftY) / CHUNK));
	const lastRow = Math.min(rows.length - 1, Math.floor((viewRect.bottom - shiftY) / CHUNK));
	for (let r = firstRow; r <= lastRow; r++) {
		for (const run of rows[r]) {
			const x0 = shiftX + run.cx * CHUNK, y0 = shiftY + run.cy * CHUNK;
			const x1 = x0 + run.len * CHUNK, y1 = y0 + CHUNK;
			if (x1 < viewRect.left || x0 > viewRect.right) continue;
			const img = ART_BITMAPS.get(BACKGROUND_IMAGE_PATHS[run.imageIndex]);
			if (!img) continue;
			const iw = img.width, ih = img.height;
			// Clip the tiling loop to the visible part of the run.
			const cx0 = Math.max(x0, x0 + Math.floor((viewRect.left - x0) / iw) * iw);
			const cx1 = Math.min(x1, viewRect.right + iw);
			const ty0 = y0 - pmod(y0, ih);
			for (let ty = ty0; ty < y1; ty += ih) {
				const sy = Math.max(y0, ty), sh = Math.min(y1, ty + ih) - sy;
				if (sh <= 0) continue;
				for (let tx = cx0 - pmod(cx0, iw); tx < cx1; tx += iw) {
					const sx = Math.max(x0, tx), sw = Math.min(x1, tx + iw) - sx;
					if (sw <= 0) continue;
					ctx.drawImage(img, sx - tx, sy - ty, sw, sh, sx, sy, sw, sh);
				}
			}
		}
	}
	return true;
}

// ---------------------------------------------------------------------------
// Scene backgrounds + global <BackgroundImages> sprites

/**
 * Draws the background sprites of every placed pixel scene, then the global
 * <BackgroundImages> art (nearer of the two: lower z draws later). `scenes` is
 * one pixelScenesByPW list; drawX/drawY match the scene layer's own transform.
 *
 * `artPathFor` resolves one placed scene to its manifest background path -- the
 * placement records carry only a scene key, and the key -> data-dir mapping
 * lives with the scene loader (js/pixel_scene_generation.js).
 *
 * The sprite is blitted 1:1 at the scene's top-left with no clip: a background
 * that is not scene-sized (the mountain hall stubs) overhangs exactly as it
 * does in game, and one with alpha lets the biome backdrop through.
 */
export function drawSceneBackgrounds(ctx, scenes, toDrawX, toDrawY, viewRect, artPathFor) {
	if (!artData) return;
	// Only ~1 placed scene in 10 has a background, and the manifest lookup per
	// scene per frame was 3 ms at the overview zoom (every list, every world in
	// view). Resolve each placement list once, after the art has finished
	// loading so a missing bitmap is really missing.
	let entries = sceneBackgroundEntries.get(scenes);
	if (!entries) {
		entries = [];
		for (const scene of scenes) {
			const path = artPathFor(scene);
			const img = path ? ART_BITMAPS.get(path) : null;
			if (img) entries.push({ img, x: scene.x, y: scene.y, w: img.width, h: img.height });
		}
		if (artLoaded) sceneBackgroundEntries.set(scenes, entries);
	}
	// toDrawX/Y are translations, so one origin resolves every entry.
	const ox = toDrawX(0), oy = toDrawY(0);
	for (const e of entries) {
		const dx = ox + e.x, dy = oy + e.y;
		if (dx + e.w < viewRect.left || dx > viewRect.right ||
			dy + e.h < viewRect.top || dy > viewRect.bottom) continue;
		ctx.drawImage(e.img, dx, dy);
	}
}
const sceneBackgroundEntries = new WeakMap();   // placement list -> resolved backgrounds

// ---------------------------------------------------------------------------
// Static-tile backdrops
//
// The five `static_tile="1"` biomes -- the sky temples and the watchtower --
// do NOT get the per-chunk backdrop sprite above. Their `background_image` is
// drawn through shaders/sprite_static_tile_bg.frag, which multiplies it by a
// second texture, `static_tile_bg_mask`:
//
//     gl_FragColor = color * gl_Color * mask_read_supersample8x( mask_uv );
//
// `mask_read` is `step(mask_threshold, mask.r)` on a pixel-art grid, so the mask
// is a hard black/white silhouette of the structure at the wang template's own
// resolution (1 mask pixel = 10 world pixels, the same TILE_SIZE the fg template
// uses). Inside the silhouette the biome's background image tiles; outside it,
// nothing is drawn and what shows is the parallax sky.
//
// That is why telescope had to paint the whole above-surface band as sky
// (app.js renderRecolorMap) to avoid a black sky around the spawn mountain, and
// why the tower and temple interiors came out sky-coloured with it: they are
// the chunks where a masked backdrop is the right answer, not "no backdrop".
//
// The mask lives at the same world rect as the biome's static tile layer,
// BOTTOM-aligned: watchtower_bg.png is one row taller than watchtower_fg.png
// and its silhouette sits one row lower (rows 9..154 against the tile's 8..153),
// so aligning the bottoms puts the two in register exactly. The other four are
// the same height either way.
//
// Not modelled: `background_image_height="-39"`, a vertical phase on the tiled
// image. It moves a repeating dark texture by 39px inside a mask that never
// moves, which is invisible at any zoom telescope draws.

/** biome name (GENERATOR_CONFIG key) -> its masked backdrop. */
export const STATIC_TILE_BACKGROUNDS = {
	biome_watchtower: { image: 'data/weather_gfx/background_wandcave.png', mask: 'data/backgrounds/biome_impl/static_tile/temples-assets/watchtower_bg.png' },
	biome_darkness: { image: 'data/weather_gfx/background_crypt.png', mask: 'data/backgrounds/biome_impl/static_tile/temples-assets/darkness_bg.png' },
	biome_barren: { image: 'data/weather_gfx/background_wandcave.png', mask: 'data/backgrounds/biome_impl/static_tile/temples-assets/barren_bg.png' },
	biome_boss_sky: { image: 'data/weather_gfx/background_crypt.png', mask: 'data/backgrounds/biome_impl/static_tile/temples-assets/boss_bg.png' },
	biome_potion_mimics: { image: 'data/weather_gfx/background_wandcave.png', mask: 'data/backgrounds/biome_impl/static_tile/temples-assets/potion_mimics_bg.png' },
};

/**
 * Above-surface biomes whose backdrop really does fill their chunk.
 *
 * `limit_background_image` (BiomeChunk+0xa4) is the surface-horizon treatment:
 * with it set, a chunk that extends below `background_image_height` swaps its
 * plain tile for the data/weather_gfx/limit_y/<name> strip, so what shows above
 * the horizon is the parallax sky (docs/worldgen/background_rendering.md).
 * Every surface biome relies on it -- hills, desert, winter, the mountain, the
 * pyramid's own outer chunks -- which is why renderRecolorMap paints the whole
 * above-surface band as sky and keeps it out of the backdrop-run builder.
 *
 * `data/biome/pyramid.xml` is the one biome up there that opts OUT, with an
 * explicit `limit_background_image="0"`: its chunks are the pyramid's enclosed
 * interior, and the game fills them with background_pyramid.png edge to edge.
 * Telescope's sky rule was blanket, so the pyramid's insides came out sky-blue.
 *
 * A biome earns a place here only by setting the attribute to "0" in its own
 * XML. The other five pyramid_* biomes do not, and are left on the sky rule --
 * they are the sloped outer shell, where the horizon strip belongs; whether the
 * strip should then draw is a separate, unmodelled thing.
 */
export const UNLIMITED_BACKDROP_BIOMES = new Set(['pyramid']);

/** The world pixels one mask pixel covers -- constants.js TILE_SIZE. */
const MASK_TILE = 10;
/** shaders/sprite_static_tile_bg.frag `step(mask_threshold, mask.r)`. */
const MASK_THRESHOLD = 128;

// biome name -> a 1x canvas whose ALPHA is the thresholded silhouette, so the
// composite below is one `destination-in` drawImage with no pixel readback.
const STATIC_TILE_MASK_CANVASES = new Map();
let staticMaskPromise = null;

export function loadStaticTileBackgroundMasks() {
	return staticMaskPromise ??= (async () => {
		const { loadPNG } = await import('./png_sanitizer.js');
		await Promise.all(Object.entries(STATIC_TILE_BACKGROUNDS).map(async ([name, rec]) => {
			try {
				const png = await loadPNG('../' + rec.mask);
				const canvas = document.createElement('canvas');
				canvas.width = png.width;
				canvas.height = png.height;
				const ctx = canvas.getContext('2d');
				const id = ctx.createImageData(png.width, png.height);
				for (let p = 0; p < png.width * png.height; p++) {
					const on = png.data[p * 4 + 3] !== 0 && png.data[p * 4] >= MASK_THRESHOLD;
					id.data[p * 4 + 3] = on ? 255 : 0;
				}
				ctx.putImageData(id, 0, 0);
				STATIC_TILE_MASK_CANVASES.set(name, canvas);
			}
			catch (e) { console.warn('Static tile background mask failed to load:', rec.mask, e); }
		}));
	})();
}

// One baked canvas per (layer, tiling phase). The phase only takes a handful of
// values -- one per world copy on screen -- and a bake is a few hundred tiled
// blits, so this never runs per frame.
const staticTileBakes = new Map();

/**
 * Draws the masked backdrop of every static-tile layer in view.
 *
 * `layers` is app.tileLayers; (offsetX, offsetY) is the same world->canvas shift
 * the tile-overlay pass applies to `layer.correctedX/Y`, so the backdrop lands
 * exactly on the structure it belongs to.
 */
export function drawStaticTileBackdrops(ctx, layers, offsetX, offsetY, viewRect) {
	if (!artData || !layers) return;
	const pmod = (v, m) => ((v % m) + m) % m;
	for (const layer of layers) {
		const rec = STATIC_TILE_BACKGROUNDS[layer.biomeName];
		if (!rec) continue;
		const mask = STATIC_TILE_MASK_CANVASES.get(layer.biomeName);
		const img = ART_BITMAPS.get(rec.image);
		if (!mask || !img) continue;
		const w = layer.w, h = mask.height * MASK_TILE;
		// Bottom-aligned against the layer's own rect (see the note above).
		const dx = layer.correctedX + offsetX;
		const dy = layer.correctedY + layer.h - h + offsetY;
		if (dx + w < viewRect.left || dx > viewRect.right ||
			dy + h < viewRect.top || dy > viewRect.bottom) continue;

		const phaseX = pmod(dx, img.width), phaseY = pmod(dy, img.height);
		const key = `${layer.biomeName}|${layer.correctedX},${layer.correctedY}|${phaseX},${phaseY}`;
		let baked = staticTileBakes.get(key);
		if (!baked) {
			baked = document.createElement('canvas');
			baked.width = w;
			baked.height = h;
			const bctx = baked.getContext('2d');
			bctx.imageSmoothingEnabled = false;
			for (let ty = -phaseY; ty < h; ty += img.height)
				for (let tx = -phaseX; tx < w; tx += img.width)
					bctx.drawImage(img, tx, ty);
			bctx.globalCompositeOperation = 'destination-in';
			bctx.drawImage(mask, 0, 0, w, h);
			staticTileBakes.set(key, baked);
		}
		ctx.drawImage(baked, dx, dy);
	}
}

export function drawGlobalBackgroundImages(ctx, toDrawX, toDrawY, viewRect) {
	if (!artData) return;
	for (const g of artData.globalImages) {
		const img = ART_BITMAPS.get(g.file);
		if (!img) continue;
		const dx = toDrawX(g.x), dy = toDrawY(g.y);
		if (dx + img.width < viewRect.left || dx > viewRect.right ||
			dy + img.height < viewRect.top || dy > viewRect.bottom) continue;
		ctx.drawImage(img, dx, dy);
	}
}

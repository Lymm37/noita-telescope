import { fetchSafeJson } from "./utils.js";
import { snapDrawImage } from "./snap.js";
import { BG_SPRITE_FILES } from "./spawn_functions.js";
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
		limit: b.limit_background_image ?? true,
		height: b.background_image_height ?? 225,
		limitArt: (b.background_image && data.limitArt?.[b.background_image]) ?? null,
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

// Adjacent tiles are separate drawImage calls, and at a fractional zoom their
// shared edge lands mid-pixel: both calls antialias it, and the seam shows as a
// hairline of whatever is behind. Rounding each destination edge through the
// current (axis-aligned) transform puts both tiles' shared edge on the same
// device pixel. Callers draw under an identity transform between beginSnapped()
// and endSnapped().
function beginSnapped(ctx) {
	const m = ctx.getTransform();
	ctx.save();
	ctx.setTransform(1, 0, 0, 1, 0, 0);
	return m;
}
function endSnapped(ctx) {
	ctx.restore();
}
function blitSnapped(ctx, m, img, sx, sy, sw, sh, dx, dy, dw, dh) {
	const x0 = Math.round(m.a * dx + m.e), x1 = Math.round(m.a * (dx + dw) + m.e);
	const y0 = Math.round(m.d * dy + m.f), y1 = Math.round(m.d * (dy + dh) + m.f);
	if (x1 <= x0 || y1 <= y0) return;
	ctx.drawImage(img, sx, sy, sw, sh, x0, y0, x1 - x0, y1 - y0);
}
function fillSnapped(ctx, m, dx, dy, dw, dh) {
	const x0 = Math.round(m.a * dx + m.e), x1 = Math.round(m.a * (dx + dw) + m.e);
	const y0 = Math.round(m.d * dy + m.f), y1 = Math.round(m.d * (dy + dh) + m.f);
	if (x1 > x0 && y1 > y0) ctx.fillRect(x0, y0, x1 - x0, y1 - y0);
}

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

// Which side supplies the strip on one boundary. The engine
// (BIOMEBACKGROUND_EnsureChunkBackgroundSprites @006f31e0, left/top branches)
// only compares priorities when BOTH sides define art for it; when just one
// does, that one is drawn whatever the priorities say. So a biome with no edge
// art (the watchtower, priority 11) still gets its lower-priority neighbour's
// strip, instead of winning and drawing nothing.
function edgeSide(me, myArt, other, otherArt) {
	if (!myArt && !otherArt) return null;
	if (!otherArt) return 'mine';
	if (!myArt) return 'theirs';
	return edgeWinner(me, other) === me ? 'mine' : 'theirs';
}

// Precompute every boundary strip for one biome-map layer, bucketed by chunk row
// so the per-frame draw only walks the visible rows. Coordinates are map-local
// pixels; `skipCells` (optional, one byte per cell) marks cells telescope paints
// no background into -- its fake sky in the main world, the columns that generate
// nothing in the vertical bands -- which therefore have no strips either.
export function buildBackgroundEdges(pixels, w, h, skipCells, noOwnEdges) {
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
			// Above the background_image_height line the engine returns before
			// either boundary (see backdropExtent), but the chunk still counts as a
			// neighbour for the chunks around it.
			if (noOwnEdges && noOwnEdges[cy * w + cx] === 1) continue;

			// Left boundary: this chunk's *_left art sits outside it, the left
			// neighbour's *_right art sits inside it.
			const west = at(cx - 1, cy);
			const westSide = west && !same(me, west) && !isSkipped(cx - 1, cy)
				? edgeSide(me, me.edges.left, west, west.edges.right) : null;
			if (westSide) {
				const mine = westSide === 'mine';
				const edge = mine ? me.edges.left : west.edges.right;
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

			// Top boundary: this chunk's *_top art sits above it, the north
			// neighbour's *_bottom art sits below the line, inside this chunk.
			const north = at(cx, cy - 1);
			const northSide = north && !same(me, north) && !isSkipped(cx, cy - 1)
				? edgeSide(me, me.edges.top, north, north.edges.bottom) : null;
			if (northSide) {
				const mine = northSide === 'mine';
				const edge = mine ? me.edges.top : north.edges.bottom;
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
		for (const list of Object.values(artData.chunkSprites ?? {})) {
			for (const sp of list) wanted.add(sp.file);
		}
		for (const f of BG_SPRITE_FILES) wanted.add(markerArtPath(f));
		for (const rec of Object.values(data.limitArt ?? {})) {
			for (const p of Object.values(rec)) wanted.add(p);
		}
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
	const m = beginSnapped(ctx);
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
					blitSnapped(ctx, m, img, sx - tx, sy - ty, sw, sh, sx, sy, sw, sh);
				}
			}
		}
	}
	endSnapped(ctx);
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
		snapDrawImage(ctx, e.img, dx, dy);
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
// Where the mask sits (in register with the terrain, clipped to the biome's
// chunks) is worked out in drawStaticTileBackdrops.
//
// Their `background_image_height="-39"` is the horizon line of backdropExtent,
// not an image phase; with `limit_background_image="0"` it only decides which
// of their chunks decorate their own boundaries (chunkOwnsEdges).

/** biome name (GENERATOR_CONFIG key) -> its masked backdrop. */
export const STATIC_TILE_BACKGROUNDS = {
	biome_watchtower: { image: 'data/weather_gfx/background_wandcave.png', mask: 'data/backgrounds/biome_impl/static_tile/temples-assets/watchtower_bg.png' },
	biome_darkness: { image: 'data/weather_gfx/background_crypt.png', mask: 'data/backgrounds/biome_impl/static_tile/temples-assets/darkness_bg.png' },
	biome_barren: { image: 'data/weather_gfx/background_wandcave.png', mask: 'data/backgrounds/biome_impl/static_tile/temples-assets/barren_bg.png' },
	biome_boss_sky: { image: 'data/weather_gfx/background_crypt.png', mask: 'data/backgrounds/biome_impl/static_tile/temples-assets/boss_bg.png' },
	biome_potion_mimics: { image: 'data/weather_gfx/background_wandcave.png', mask: 'data/backgrounds/biome_impl/static_tile/temples-assets/potion_mimics_bg.png' },
};

// ---------------------------------------------------------------------------
// Surface horizon: limit_background_image / background_image_height
//
// BIOMEBACKGROUND_EnsureChunkBackgroundSprites @006f31e0, for a chunk spanning
// world y [top, top+512) whose biome has height H (BiomeChunk+0xa0) and the
// limit flag (+0xa4):
//
//   * limit && bottom < H  -> returns before creating anything: no backdrop, no
//     edges. What shows is the parallax sky.
//   * limit && top < H     -> the repeat tile covers only [H, bottom), and
//     data/weather_gfx/limit_y/<image> (when it exists) is centred on the chunk
//     with its bottom on the H line, z 101. Against a left/right neighbour whose
//     background_image differs and whose priority is <= ours, the 32x286
//     <stem>_left / <stem>_right caps sit just OUTSIDE the chunk (x - w, x + 512),
//     vertically centred on [H, bottom). No regular edge strips.
//   * otherwise            -> the full-chunk tile; edge strips only if top >= H.
//
// The Biome constructor defaults are H = 225.0 and limit = 1 (@0048b4cf,
// @0048b4d9), and almost no surface biome overrides them -- which is why the
// whole y in [0, 225) band of the chunk row at the surface is sky in game even
// under hills, desert, lake and winter, and why everything above it is sky
// except the few limit="0" biomes (pyramid, coalmine, liquidcave).

export const BACKDROP_NONE = 0;
export const BACKDROP_FULL = 1;
export const BACKDROP_HORIZON = 2;

const DEFAULT_REC = { imageIndex: -1, limit: true, height: 225 };

/** How the engine fills one chunk of this biome at world chunk top `top`. */
export function backdropExtent(biomeColorInt, top) {
	const rec = BY_COLOR.get(biomeColorInt & 0xffffff) ?? DEFAULT_REC;
	if (rec.limit && top + CHUNK < rec.height) return BACKDROP_NONE;
	if (rec.limit && top < rec.height) return BACKDROP_HORIZON;
	return BACKDROP_FULL;
}

/** Whether the chunk decorates its own left/top boundary with edge strips. */
export function chunkOwnsEdges(biomeColorInt, top) {
	const rec = BY_COLOR.get(biomeColorInt & 0xffffff) ?? DEFAULT_REC;
	return backdropExtent(biomeColorInt, top) === BACKDROP_FULL && top >= rec.height;
}

/**
 * The horizon chunks of one biome-map layer, bucketed by chunk row. `topOf(cy)`
 * is the world y of chunk row cy's top edge; coordinates in the records are
 * map-local pixels, like buildBackdropRuns.
 */
export function buildHorizonChunks(pixels, w, h, topOf, skipCells) {
	const rows = Array.from({ length: h }, () => []);
	const wrapX = (cx) => ((cx % w) + w) % w;
	for (let cy = 0; cy < h; cy++) {
		const top = topOf(cy);
		for (let cx = 0; cx < w; cx++) {
			const i = cy * w + cx;
			if (skipCells && skipCells[i] === 1) continue;
			const px = pixels[i] & 0xffffff;
			if (backdropExtent(px, top) !== BACKDROP_HORIZON) continue;
			const me = BY_COLOR.get(px);
			if (!me || me.imageIndex < 0) continue;
			const clip = Math.round(me.height - top);   // map-local offset of H in the chunk
			const x0 = cx * CHUNK, y0 = cy * CHUNK;
			const caps = [];
			const art = me.limitArt;
			if (art?.center) caps.push({ art: art.center, place: 'center' });
			for (const [side, dcx] of [['right', 1], ['left', -1]]) {
				if (!art?.[side]) continue;
				const npx = pixels[cy * w + wrapX(cx + dcx)] & 0xffffff;
				const n = BY_COLOR.get(npx);
				if (!n || npx === px || imagePathOf(n) === imagePathOf(me) || n.priority > me.priority) continue;
				caps.push({ art: art[side], place: side });
			}
			rows[cy].push({
				imageIndex: me.imageIndex, color: IMAGE_COLORS[me.imageIndex],
				x: x0, y: y0 + clip, w: CHUNK, h: CHUNK - clip,
				hLine: y0 + clip, bottom: y0 + CHUNK, caps,
			});
		}
	}
	return rows;
}

/**
 * Draws the horizon chunks for one world copy: the tile over [H, bottom) --
 * flat colour until the art has loaded -- then the limit_y caps.
 */
export function drawHorizonChunks(ctx, rows, shiftX, shiftY, viewRect) {
	const pmod = (v, m) => ((v % m) + m) % m;
	const firstRow = Math.max(0, Math.floor((viewRect.top - shiftY) / CHUNK) - 1);
	const lastRow = Math.min(rows.length - 1, Math.floor((viewRect.bottom - shiftY) / CHUNK) + 1);
	const m = beginSnapped(ctx);
	for (let r = firstRow; r <= lastRow; r++) {
		for (const c of rows[r]) {
			const x0 = shiftX + c.x, y0 = shiftY + c.y;
			if (x0 + c.w + 64 < viewRect.left || x0 - 64 > viewRect.right) continue;
			const img = artData ? ART_BITMAPS.get(BACKGROUND_IMAGE_PATHS[c.imageIndex]) : null;
			if (!img) {
				ctx.fillStyle = '#' + (c.color >>> 0).toString(16).padStart(6, '0');
				fillSnapped(ctx, m, x0, y0, c.w, c.h);
			} else {
				const iw = img.width, ih = img.height, x1 = x0 + c.w, y1 = y0 + c.h;
				for (let ty = y0 - pmod(y0, ih); ty < y1; ty += ih) {
					const sy = Math.max(y0, ty), sh = Math.min(y1, ty + ih) - sy;
					if (sh <= 0) continue;
					for (let tx = x0 - pmod(x0, iw); tx < x1; tx += iw) {
						const sx = Math.max(x0, tx), sw = Math.min(x1, tx + iw) - sx;
						if (sw <= 0) continue;
						blitSnapped(ctx, m, img, sx - tx, sy - ty, sw, sh, sx, sy, sw, sh);
					}
				}
			}
			if (!artData) continue;
			const hLine = shiftY + c.hLine, mid = (shiftY + c.bottom - hLine) / 2 + hLine;
			for (const cap of c.caps) {
				const a = ART_BITMAPS.get(cap.art);
				if (!a) continue;
				const cx = cap.place === 'center' ? shiftX + c.x + CHUNK / 2 - a.width / 2
					: cap.place === 'right' ? shiftX + c.x + CHUNK : shiftX + c.x - a.width;
				const cy = cap.place === 'center' ? hLine - a.height : Math.trunc(mid) - a.height / 2;
				blitSnapped(ctx, m, a, 0, 0, a.width, a.height, cx, cy, a.width, a.height);
			}
		}
	}
	endSnapped(ctx);
}

/** The world pixels one mask pixel covers -- constants.js TILE_SIZE. */
const MASK_TILE = 10;
/** shaders/sprite_static_tile_bg.frag `step(mask_threshold, mask.r)`. */
const MASK_THRESHOLD = 128;

// biome name -> a 1x canvas whose ALPHA is the thresholded silhouette, so the
// composite below is one `destination-in` drawImage with no pixel readback.
const STATIC_TILE_MASK_CANVASES = new Map();
let staticMaskPromise = null;

/** World px of clamp-to-edge margin kept around each mask: the terrain-anchored
 *  mask stops a few px short of its biome's chunk edges (1 px on the
 *  watchtower's right, 5 px at its bottom), and the sampler's CLAMP_TO_EDGE
 *  (0x812F, read off the live texture) stretches the edge texels over them. */
const MASK_MARGIN = 32;

/**
 * The static-tile mask at world resolution, as 0/255 coverage over
 * (w*scale + 2*margin) x (h*scale + 2*margin) with the mask's own origin at
 * (margin, margin).
 *
 * sprite_static_tile_bg.frag does not threshold per mask texel: it calls
 * pixel_art_filter_uv with tex_mask_size_world_pixels, i.e. snaps to the
 * WORLD-pixel grid, and the hardware bilinear filter then interpolates between
 * mask texels (centres at k + 0.5, clamped at the edges) before step(0.5, r).
 * So the silhouette follows the art's anti-aliased grey ramps as a smooth
 * edge -- the watchtower's slope is a clean diagonal in game, not 10 px steps.
 * `rgba` is the decoded PNG; transparent texels count as 0.
 */
export function buildStaticTileMask(rgba, w, h, scale, margin, threshold = MASK_THRESHOLD) {
	const r = new Float32Array(w * h);
	for (let p = 0; p < w * h; p++) r[p] = rgba[p * 4 + 3] !== 0 ? rgba[p * 4] : 0;
	const ow = w * scale + 2 * margin, oh = h * scale + 2 * margin;
	const out = new Uint8Array(ow * oh);
	const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);
	for (let oy = 0; oy < oh; oy++) {
		const y = clamp((oy - margin + 0.5) / scale - 0.5, 0, h - 1);
		const y0 = Math.floor(y), y1 = Math.min(y0 + 1, h - 1), fy = y - y0;
		for (let ox = 0; ox < ow; ox++) {
			const x = clamp((ox - margin + 0.5) / scale - 0.5, 0, w - 1);
			const x0 = Math.floor(x), x1 = Math.min(x0 + 1, w - 1), fx = x - x0;
			const top = r[y0 * w + x0] * (1 - fx) + r[y0 * w + x1] * fx;
			const bot = r[y1 * w + x0] * (1 - fx) + r[y1 * w + x1] * fx;
			if (top * (1 - fy) + bot * fy >= threshold) out[oy * ow + ox] = 255;
		}
	}
	return { data: out, width: ow, height: oh };
}

export function loadStaticTileBackgroundMasks() {
	return staticMaskPromise ??= (async () => {
		const { loadPNG } = await import('./png_sanitizer.js');
		await Promise.all(Object.entries(STATIC_TILE_BACKGROUNDS).map(async ([name, rec]) => {
			try {
				const png = await loadPNG('../' + rec.mask);
				const m = buildStaticTileMask(png.data, png.width, png.height, MASK_TILE, MASK_MARGIN);
				const canvas = document.createElement('canvas');
				canvas.width = m.width;
				canvas.height = m.height;
				const ctx = canvas.getContext('2d');
				const id = ctx.createImageData(m.width, m.height);
				for (let p = 0; p < m.data.length; p++) id.data[p * 4 + 3] = m.data[p];
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
/**
 * Draws the masked backdrop of every static-tile layer in view.
 *
 * Placement is anchored to the static tile's TERRAIN: the mask is
 * bottom-aligned against the layer rect (it is one template row taller than
 * the fg template) and drawn with the same (terrainDX, terrainDY) shift as the
 * terrain itself. That shift is the wang grid's drift plus telescope's visual
 * tile offset, and it is what the game does: fitting watchtower_fg.png against
 * the live material grid (groundtruth/batch3/watchtower_mat.pgm, seed
 * 786433191) puts the template at chunk corner + (-9, -9), 96.7% of cells
 * agreeing, exactly where telescope draws it -- and the mask in register with it
 * is what the art was painted for.
 *
 * What IS taken from the engine: every chunk of the biome is its own backdrop
 * sprite (BIOMEBACKGROUND_EnsureChunkBackgroundSprites @006f31e0), so the
 * masked art is clipped to the biome's own chunks and never spills into a
 * neighbour; outside the mask texture the sampler is GL_CLAMP_TO_BORDER
 * (0x812d), i.e. masked out.
 *
 * Not reproduced: the mask UV math in the sprite draw (@006f0300) --
 * uv0 = per-chunk table value x 512 / (mask size x 10), sampled at uv + 0.007.
 * Read live (seed 786433191) the watchtower chunk sprites carry table values
 * (0,1)/(0,2), i.e. chunk indices, and the mask texture is 52x155 with
 * CLAMP_TO_EDGE; taken literally that anchors the mask at chunk corners, 12-17
 * px off the smooth diagonal edge the lit game shows at (13825,-47)-(13860,-82).
 * The terrain-registered anchor lands on it within ~2 px, so some offset in
 * that path is still unaccounted for and the terrain anchor is what is used.
 * Edges are smooth, not per-texel: see buildStaticTileMask.
 *
 * `isBiomeChunk(biomeName, cx, cy)` answers for map-local chunk coords.
 */
export function drawStaticTileBackdrops(ctx, layers, shiftX, shiftY, terrainDX, terrainDY, viewRect, isBiomeChunk) {
	if (!artData || !layers) return;
	const pmod = (v, m) => ((v % m) + m) % m;
	for (const layer of layers) {
		const rec = STATIC_TILE_BACKGROUNDS[layer.biomeName];
		if (!rec) continue;
		const mask = STATIC_TILE_MASK_CANVASES.get(layer.biomeName);
		const img = ART_BITMAPS.get(rec.image);
		if (!mask || !img) continue;
		// The canvas is already world-scale, with MASK_MARGIN of clamped edge
		// around the mask proper (buildStaticTileMask).
		const mw = mask.width, mh = mask.height;
		// Map-local rect of the canvas: the mask proper is bottom-aligned
		// against the layer rect.
		const mx = layer.correctedX + terrainDX - MASK_MARGIN;
		const my = layer.correctedY + layer.h - (mh - 2 * MASK_MARGIN) + terrainDY - MASK_MARGIN;
		if (shiftX + mx + mw < viewRect.left || shiftX + mx > viewRect.right ||
			shiftY + my + mh < viewRect.top || shiftY + my > viewRect.bottom) continue;

		// Baked on an integer grid covering the mask rect; the tile is aligned to
		// absolute world coordinates and the mask is placed at its fractional
		// offset inside it.
		const bx = Math.floor(mx), by = Math.floor(my);
		const bw = Math.ceil(mx + mw) - bx, bh = Math.ceil(my + mh) - by;
		const key = `${layer.biomeName}|${mx},${my}`;
		let baked = staticTileBakes.get(key);
		if (!baked) {
			baked = document.createElement('canvas');
			baked.width = bw;
			baked.height = bh;
			const bctx = baked.getContext('2d');
			bctx.imageSmoothingEnabled = false;
			const phaseX = pmod(bx, img.width), phaseY = pmod(by, img.height);
			for (let ty = -phaseY; ty < bh; ty += img.height)
				for (let tx = -phaseX; tx < bw; tx += img.width)
					bctx.drawImage(img, tx, ty);
			bctx.globalCompositeOperation = 'destination-in';
			bctx.drawImage(mask, mx - bx, my - by);
			staticTileBakes.set(key, baked);
		}
		// One blit per biome chunk the mask overlaps, clipped to that chunk.
		for (let cy = Math.floor(by / CHUNK); cy * CHUNK < by + bh; cy++) {
			for (let cx = Math.floor(bx / CHUNK); cx * CHUNK < bx + bw; cx++) {
				if (!isBiomeChunk(layer.biomeName, cx, cy)) continue;
				const x0 = Math.max(bx, cx * CHUNK), x1 = Math.min(bx + bw, (cx + 1) * CHUNK);
				const y0 = Math.max(by, cy * CHUNK), y1 = Math.min(by + bh, (cy + 1) * CHUNK);
				if (x1 <= x0 || y1 <= y0) continue;
				snapDrawImage(ctx, baked, x0 - bx, y0 - by, x1 - x0, y1 - y0,
					shiftX + x0, shiftY + y0, x1 - x0, y1 - y0);
			}
		}
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
		snapDrawImage(ctx, img, dx, dy);
	}
}

// ---------------------------------------------------------------------------
// Per-chunk LoadBackgroundSprite calls from biome init()
//
// A biome's lua init(x, y, w, h) runs once per chunk, and a
// LoadBackgroundSprite( file, x + dx, y + dy, z ) there puts a plain sprite
// (top-left anchored, no tiling) into the background SceneGraph
// (LUAIMPL_LoadBackgroundSprite @007b2020, default z 40). The pyramid's outer
// pieces use this for their backdrop: pyramid_left/right stamp a half-pyramid
// silhouette at z 99.9 and pyramid_hallway fills its chunk with two copies of
// background_pyramid.png -- all above the surface horizon, where the chunk's
// own tile is suppressed (backdropExtent). tools/gen_backgrounds.py extracts
// the calls into background_data.json chunkSprites.

const XML_NAME_BY_COLOR = new Map(data.biomes.map((b) => [parseInt(b.color, 16) & 0xffffff, b.xmlName]));

/** Rows of { file, x, y, z } in map-local pixels, for the chunks whose biome's
 *  init() loads background sprites. Empty until the art data has loaded. */
export function buildChunkSprites(pixels, w, h) {
	const rows = Array.from({ length: h }, () => []);
	const table = artData?.chunkSprites;
	if (!table) return rows;
	for (let cy = 0; cy < h; cy++) {
		for (let cx = 0; cx < w; cx++) {
			const list = table[XML_NAME_BY_COLOR.get(pixels[cy * w + cx] & 0xffffff)];
			if (!list) continue;
			for (const sp of list) rows[cy].push({ file: sp.file, x: cx * CHUNK + sp.dx, y: cy * CHUNK + sp.dy, z: sp.z });
		}
	}
	return rows;
}

/** Draws the chunk sprites whose z satisfies `zTest` (the SceneGraph draws high
 *  z first, so the caller splits them around the layers they interleave with). */
export function drawChunkSprites(ctx, rows, shiftX, shiftY, viewRect, zTest) {
	const firstRow = Math.max(0, Math.floor((viewRect.top - shiftY) / CHUNK) - 1);
	const lastRow = Math.min(rows.length - 1, Math.floor((viewRect.bottom - shiftY) / CHUNK) + 1);
	const m = beginSnapped(ctx);
	for (let r = firstRow; r <= lastRow; r++) {
		for (const sp of rows[r]) {
			if (!zTest(sp.z)) continue;
			const img = ART_BITMAPS.get(sp.file);
			if (!img) continue;
			const dx = shiftX + sp.x, dy = shiftY + sp.y;
			if (dx + img.width < viewRect.left || dx > viewRect.right) continue;
			blitSnapped(ctx, m, img, 0, 0, img.width, img.height, dx, dy, img.width, img.height);
		}
	}
	endSnapped(ctx);
}

// ---------------------------------------------------------------------------
// Marker-driven LoadBackgroundSprite placements
//
// The sprites spawn functions load (js/spawn_functions.js backgroundSpriteSpawn:
// vault/robobase warning strips and pillars, crypt alcoves and slabs,
// wizardcave drapes, excavation-site mechanisms/towers/beams, sky-temple
// hints), in world coordinates per PW. Art is shipped under data/backgrounds/
// like the scene backgrounds (tools/gen_backgrounds.py).

const markerArtPath = (gamePath) => 'data/backgrounds/' + gamePath.replace(/^data\//, '');

// sprite list -> the entries that survive check_biome_corners, resolved once
// the art (and so every sprite's size) is known.
const markerEntries = new WeakMap();

/**
 * Draws the marker sprites whose z satisfies `zTest`. `resolveBiome(x, y)` is
 * the engine's chunk lookup (BiomeGrid::ResolveChunkAtPosition, telescope's
 * getResolvedBiome): a `corners` sprite is dropped unless its four corners all
 * resolve to the same biome (LoadBackgroundSprite's check_biome_corners,
 * @006f4720).
 */
export function drawMarkerSprites(ctx, sprites, toDrawX, toDrawY, viewRect, zTest, resolveBiome) {
	if (!artData || !sprites || sprites.length === 0) return;
	let entries = markerEntries.get(sprites);
	if (!entries) {
		entries = [];
		for (const sp of sprites) {
			const img = ART_BITMAPS.get(markerArtPath(sp.file));
			if (!img) continue;
			if (sp.corners) {
				const b = resolveBiome(sp.x, sp.y);
				if (b !== resolveBiome(sp.x + img.width, sp.y) || b !== resolveBiome(sp.x, sp.y + img.height)
					|| b !== resolveBiome(sp.x + img.width, sp.y + img.height)) continue;
			}
			entries.push({ img, x: sp.x, y: sp.y, z: sp.z });
		}
		// Higher z is further back and draws first; stable for equal z.
		entries.sort((a, b) => b.z - a.z);
		if (artLoaded) markerEntries.set(sprites, entries);
	}
	const ox = toDrawX(0), oy = toDrawY(0);
	const m = beginSnapped(ctx);
	for (const e of entries) {
		if (!zTest(e.z)) continue;
		const dx = ox + e.x, dy = oy + e.y;
		if (dx + e.img.width < viewRect.left || dx > viewRect.right ||
			dy + e.img.height < viewRect.top || dy > viewRect.bottom) continue;
		blitSnapped(ctx, m, e.img, 0, 0, e.img.width, e.img.height, dx, dy, e.img.width, e.img.height);
	}
	endSnapped(ctx);
}

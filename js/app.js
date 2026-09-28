import { generateBiomeData, BIOME_CONFIG } from './biome_generator.js';
import { loadPNG, loadPNGBitmap} from './png_sanitizer.js';
import { getDisplayName, loadTranslations } from './translations.js';
import { UNLOCKABLES, UNLOCK_DISPLAY_NAMES, setUnlocks } from './unlocks.js';
import { toggleTooltipPinned, updateTooltip } from './tooltip_generator.js';
import { BIOME_COLORS_WITH_TERRAIN, FILL_LAYER_MATERIALS, GENERATOR_CONFIG, SCENE_ONLY_COLORS } from './generator_config.js';
import { generateBiomeTiles } from './tile_generator.js';
import { scanSpawnFunctions, getSpecialPoIs, prescanSpawnFunctions } from './poi_scanner.js';
import { performSearch, navigateSearch, cancelSearch, isSearchActive, clearHighlights, performLocalSearch, syncSearchWorkerData, activeLocalSearchArea, syncSettingsToSearchWorker, continueSearchSequence } from './search_manager.js';
import { TIME_UNTIL_LOADING, POI_RADIUS, CHUNK_SIZE, BIOME_EDGE_NOISE_PADDING_PIXELS, VISUAL_TILE_OFFSET_X, VISUAL_TILE_OFFSET_Y, MIN_CAM_Z, SKY_EXTRA_HEIGHT } from './constants.js';
import { getBiomeAtWorldCoordinates, getMaterialProvenanceAtWorldCoordinates, getWorldCenter, getWorldSize, getWorldStride, getPWLimit, MATERIAL_CONTAINER_TYPES } from './utils.js';
import { camZFromLogZoom, cameraFromWorld, formatViewParams, logZoomFromCamZ, parseViewParams, worldFromCamera } from './view_url.js';
import { renderWallMessages } from './wall_messages.js';
import { findEyeMessages, renderEyeMessages } from './eye_messages.js';
import { BIOME_COLOR_LOOKUP, createBiomeMapAlphaMask, createTileOverlays, createTileOverlaysCheap, createTileOverlaysExpanded, terrainFillColor } from './image_processing.js';
import { COALMINE_ALT_SCENES } from './pixel_scene_config.js';
import { debugBiomeEdgeNoise } from './edge_noise.js';
import { drawBiomeBoundaryContour } from './biome_boundary.js';
import { GLTerrainRenderer } from './gl/terrain_renderer.js';
import { GLBackdropRenderer } from './gl/backdrop_renderer.js';
import { GLSceneRenderer } from './gl/scene_renderer.js';
import { getPixelSceneAirMask, getPixelSceneCacheStats, getPixelSceneCanvas, pendingPixelSceneBitmaps, PIXEL_SCENE_MAX_MIP, pixelSceneBitmapVersion, pixelSceneMipLevel, loadPixelSceneData, reloadPixelSceneCache, PIXEL_SCENE_DATA, setScenePixelsListener, warmPixelScene } from './pixel_scene_generation.js';
import { addStaticPixelScenes } from './static_spawns.js';
import { NollaPrng } from './nolla_prng.js';
import { appSettings, updateSettings, updateSettingsFromUI, updateSpellFlags, updateSpecialFlags, RENDER_LAYERS, readRenderLayersFromUI } from './settings.js';
import { syncWorldWorkerData, getOrGenerateWorld, syncSettingsToWorldWorker } from './world_manager.js';
import { syncOverlayWorkerData, getOrGenerateOverlay, syncSettingsToOverlayWorker, recolorPixelScenes, invalidatePendingOverlays, requestEdgeDecalTiles, overlayQueueStats } from './overlay_manager.js';
import { drawEdgeDecals, edgeDecalAt, invalidateEdgeDecals, pendingEdgeDecalTiles } from './edge_decal_layer.js';
import { runRenderBenchmark } from './render_benchmark.js';
import { renderHud, renderTrace } from './render_hud.js';
import { getMaterialAtlas, initMaterialAtlas, materialAlpha, materialAtlasEntry, materialTexelInfo } from './gl/material_atlas.js';
import { ENGINE_MODE_FALLBACK, ENGINE_MODE_TOPO2 } from './gl/engine_resources.js';
import { MATERIAL_BY_NAME } from './potion_config.js';
import { getBiomeModifiers, getStartingWeather } from './misc_generation.js';
import { getCauldronState, getCauldronVariation } from './cauldron.js';
import { SCENE_ART_MAX_ZOOM, SCENE_ART_TILES, sceneArtTile } from './pixel_scene_art.js';
import { WAND_TIERS } from './wand_config.js';
import { renderFungalShifts, renderAlchemyRecipes, getPerkSimulationState, importPerkPickups, updatePerksState } from './misc_ui.js';
import { setupProgressUI, updateUsedSpellProgress } from './progress.js';
import { renderStars } from './star_decorations.js';
import { getFungalShifts } from './fungal_shifts.js';
import { pickAlchemyMaterials } from './alchemy.js';
import {
	BACKGROUND_VOID, backgroundLayerColor, buildBackdropRuns, buildBackgroundEdges,
	backdropBitmap, drawBackdropRuns, drawGlobalBackgroundImages, drawSceneBackgrounds, drawStaticTileBackdrops,
	backgroundArtLoaded, edgeStripArt, loadBackgroundArt, loadBackgroundEdgeMasks, loadStaticTileBackgroundMasks,
	STATIC_TILE_BACKGROUNDS, tintedEdgeStrip, UNLIMITED_BACKDROP_BIOMES,
} from './biome_backgrounds.js';

// How often a pan or zoom may rewrite the URL, in ms.
const VIEW_URL_SYNC_MS = 200;

const biomeColorsOf = (names) => new Set([...names]
	.map(name => GENERATOR_CONFIG[name] && (GENERATOR_CONFIG[name].color & 0xffffff))
	.filter(c => c !== undefined && c !== null));

// The biome-map colors whose backdrop is masked to a structure silhouette rather
// than filling their chunk (js/biome_backgrounds.js STATIC_TILE_BACKGROUNDS), so
// the background layer must leave their chunks to the sky and draw the mask.
const STATIC_TILE_COLORS = biomeColorsOf(Object.keys(STATIC_TILE_BACKGROUNDS));
// ...and the ones that keep a plain full-chunk backdrop above the surface line.
const UNLIMITED_BACKDROP_COLORS = biomeColorsOf(UNLIMITED_BACKDROP_BIOMES);

// Width of a background boundary strip in world pixels, matching the engine art.
const STRIP_WORLD_PX = 64;

// Below this zoom the per-cell material texels are smaller than half a screen
// pixel: point-sampling them just shimmers, and the flat material colors are
// what the eye averages the texture to anyway. The material-texture detail pass
// auto-disables below it (edge decals have their own gate, EDGE_DECAL_MIN_ZOOM).
const MATERIAL_DETAIL_MIN_ZOOM = 0.5;
// Zoomed out, the backdrop tile runs are drawn from one whole-map bake at this
// reduction instead of thousands of per-run drawImage calls (8-13 ms a frame at
// the overview zoom, plus the GPU backpressure that dumped onto the steps after
// it). The bake is used while a chunk is at most BACKDROP_BAKE_MAX_CHUNK_PX on
// screen, which is exactly where the bake's texels are at or above screen
// resolution; zoomed in further the clipped run loop is cheap.
const BACKDROP_BAKE_SCALE = 8;
const BACKDROP_BAKE_MAX_CHUNK_PX = 512 / BACKDROP_BAKE_SCALE;

// Paint one cell of a recolor-map canvas. `color` is either an RGB int or
// BACKGROUND_VOID, which the engine leaves empty (biomes with no
// background_image) and which we write as fully transparent so the canvas
// backdrop shows through.
// Whether a vertical parallel world generates anything in this biome-map column.
//
// There is no heaven/hell biome map: BiomeGrid_GetChunkAt wraps X and *clamps* Y
// to [0, 47], so every chunk above the map resolves to map row 0 and every chunk
// below it to row 47 (telescope materialises that as heavenPixels / hellPixels).
// What decides whether the clamped-in biome puts anything there is its own
// topology, not the lookup:
//   * the constant-material fill biomes (solid_wall, solid_wall_tower, lava, the
//     temple walls...) have `_EMPTY_` topology with `limit_y="0"`, i.e. no surface
//     line and no y limit, so they are solid at *any* Y -- this is why the world
//     edge columns run infinitely up and down;
//   * the_sky and the_end are wang-tile biomes and keep producing terrain;
//   * the surface biomes (lake, winter, hills, desert, empty) are gradient +
//     BitmapCaves topologies whose surface line is tens of thousands of pixels
//     away, so they evaluate to air.
// Which is exactly "telescope generates terrain for this biome", so the band
// background paints those columns and leaves the rest transparent instead of
// flooding the whole band with a biome color.
function bandColumnPaints(biomeColor) {
	return BIOME_COLORS_WITH_TERRAIN.has(biomeColor & 0xffffff);
}

// The background sprite one placed scene draws behind itself, or null. A
// placement record carries only the scene key; the loaded scene knows which
// data/pixel_scenes entry it came from, which is what the manifest is keyed by
// (js/pixel_scene_backgrounds.js).
// A placement carries its own art only when the biome it spawned for overrides
// the scene's default (SCENE_BACKGROUNDS_BY_BIOME) -- one scene key serves
// several biomes, so the per-key record cannot answer for all of them.
function sceneBackgroundArt(scene) {
	return scene.backgroundArt ?? PIXEL_SCENE_DATA[scene.key]?.backgroundArt ?? null;
}

function writeBackgroundPixel(imageData, i, color) {
	const isVoid = color === BACKGROUND_VOID;
	imageData.data[i*4+0] = isVoid ? 0 : (color >> 16) & 0xFF;
	imageData.data[i*4+1] = isVoid ? 0 : (color >> 8) & 0xFF;
	imageData.data[i*4+2] = isVoid ? 0 : color & 0xFF;
	imageData.data[i*4+3] = isVoid ? 0 : 255;
}

// Traces one PoI's marker outline, centred on (px, py) with world-unit radius
// tempRadius, on a context that is already under the camera transform (or a
// sprite context scaled like it). Shared by the direct draw and the sprite
// cache below.
function tracePoiShape(ctx, p, px, py, tempRadius, accessibility, simpleSymbols) {
	if (accessibility) {
		// Shapes for accessibility mode
		switch (p.type) {
			case 'wand':
				// Tall rectangle
				ctx.rect(px - tempRadius / 2, py - tempRadius, tempRadius, tempRadius * 2);
				break;
			case 'item':
				if (p.item) {
					if (p.item.includes('heart') || p.item === 'full_heal') {
						if (simpleSymbols) {
							ctx.moveTo(px - tempRadius, py - tempRadius);
							ctx.lineTo(px + tempRadius, py - tempRadius);
							ctx.lineTo(px, py + tempRadius);
							ctx.closePath();
						} else {
							ctx.moveTo(px, py - tempRadius / 3);
							ctx.bezierCurveTo(px - tempRadius, py - tempRadius, px - tempRadius, py + tempRadius / 3, px, py + tempRadius);
							ctx.bezierCurveTo(px + tempRadius, py + tempRadius / 3, px + tempRadius, py - tempRadius, px, py - tempRadius / 3);
							ctx.closePath();
						}
					}
					else if (MATERIAL_CONTAINER_TYPES.includes(p.item)) {
						if (simpleSymbols) {
							ctx.moveTo(px, py - tempRadius);
							ctx.lineTo(px + tempRadius, py + tempRadius);
							ctx.lineTo(px - tempRadius, py + tempRadius);
							ctx.closePath();
						} else {
							ctx.moveTo(px - tempRadius * 0.28, py - tempRadius);
							ctx.lineTo(px + tempRadius * 0.28, py - tempRadius);
							ctx.lineTo(px + tempRadius * 0.28, py - tempRadius * 0.42);
							ctx.bezierCurveTo(px + tempRadius * 0.28, py - tempRadius * 0.16, px + tempRadius * 0.86, py - tempRadius * 0.08, px + tempRadius * 0.88, py + tempRadius * 0.48);
							ctx.bezierCurveTo(px + tempRadius * 0.9, py + tempRadius * 0.83, px + tempRadius * 0.48, py + tempRadius, px, py + tempRadius);
							ctx.bezierCurveTo(px - tempRadius * 0.48, py + tempRadius, px - tempRadius * 0.9, py + tempRadius * 0.83, px - tempRadius * 0.88, py + tempRadius * 0.48);
							ctx.bezierCurveTo(px - tempRadius * 0.86, py - tempRadius * 0.08, px - tempRadius * 0.28, py - tempRadius * 0.16, px - tempRadius * 0.28, py - tempRadius * 0.42);
							ctx.closePath();
						}
					}
					else if (p.item === 'portal' || p.item === 'meditation_cube' || p.item === 'buried_eye_teleporter' || p.item === 'trailer_altar') {
						// Pentagon
						ctx.moveTo(px, py - tempRadius);
						for (let i = 1; i < 5; i++) {
							const angle = (Math.PI / 2) + (i * (2 * Math.PI / 5));
							ctx.lineTo(px - tempRadius * Math.cos(angle), py - tempRadius * Math.sin(angle));
						}
						ctx.closePath();
						break;
					}
					else if (p.item === 'refresh_mimic' || p.item === 'heart_mimic' || p.item === 'mimic' || p.item === 'chest_leggy' || p.item === 'mimic_potion') {
						// X shape
						const thickness = tempRadius / 2;
						ctx.moveTo(px - tempRadius, py - thickness);
						ctx.lineTo(px - thickness, py - tempRadius);
						ctx.lineTo(px, py - thickness);
						ctx.lineTo(px + thickness, py - tempRadius);
						ctx.lineTo(px + tempRadius, py - thickness);
						ctx.lineTo(px + thickness, py);
						ctx.lineTo(px + tempRadius, py + thickness);
						ctx.lineTo(px + thickness, py + tempRadius);
						ctx.lineTo(px, py + thickness);
						ctx.lineTo(px - thickness, py + tempRadius);
						ctx.lineTo(px - tempRadius, py + thickness);
						ctx.lineTo(px - thickness, py);
						ctx.closePath();
					}
					else {
						// Square (slightly scaled down because the other stuff looks smaller by area)
						ctx.rect(px - 3*tempRadius/4, py - 3*tempRadius/4, tempRadius * 1.5, tempRadius * 1.5);
					}
				}
				break;
			case 'utility_box':
			case 'puzzle':
			case 'vault_puzzle':
				// Diamond
				ctx.moveTo(px, py - tempRadius);
				ctx.lineTo(px - tempRadius, py);
				ctx.lineTo(px, py + tempRadius);
				ctx.lineTo(px + tempRadius, py);
				ctx.closePath();
				break;
			case 'chest':
			case 'pacifist_chest':
			case 'great_chest':
				// Wide rectangle
				ctx.rect(px - tempRadius, py - tempRadius/2, tempRadius * 2, tempRadius);
				break;
			case 'shop':
			case 'holy_mountain_shop':
				// Hexagon
				ctx.moveTo(px, py + tempRadius);
				for (let i = 1; i < 6; i++) {
					const angle = (Math.PI / 2) + (i * (2 * Math.PI / 6));
					ctx.lineTo(px + tempRadius * Math.cos(angle), py + tempRadius * Math.sin(angle));
				}
				ctx.closePath();
				break;
			case 'eye_room':
				// Eye shape (horizontal)
				ctx.moveTo(px - tempRadius, py);
				ctx.quadraticCurveTo(px, py - tempRadius, px + tempRadius, py);
				ctx.quadraticCurveTo(px, py + tempRadius, px - tempRadius, py);
				ctx.closePath();
				break;
			case 'enemies':
				// Circle
				ctx.arc(px, py, tempRadius*0.7, 0, Math.PI * 2);
				break;
			default:
				ctx.arc(px, py, tempRadius, 0, Math.PI * 2); // Default to circle
		}
	}
	else {
		// Colored circles
		ctx.arc(px, py, tempRadius, 0, Math.PI * 2);
	}
}

// PoI marker sprites. At the overview zoom every PoI in the world is on screen
// -- thousands of anti-aliased path fills and strokes a frame, which the GPU
// canvas rasterizes one by one (it was the difference between 0 and ~30 long
// frames per 120 while dragging). A marker a few screen pixels across is
// rendered once per (shape, colour, screen radius) into a screen-resolution
// sprite and blitted from then on; drawImage of the same bitmap batches.
// Large markers (zoomed in, few in view) keep the direct path draw.
const POI_SPRITE_MAX_SCREEN_RADIUS = 24;
const POI_SPRITE_CACHE_MAX = 512;
const poiSpriteCache = new Map();

function poiSprite(p, poiColor, tempRadius, zoom, accessibility, simpleSymbols) {
	const highlight = p.highlight === true;
	// Half-pixel steps keep the set bounded while zooming continuously.
	const screenR = Math.round(tempRadius * zoom * 2) / 2;
	const shape = accessibility ? `${p.type}|${p.item || ''}|${simpleSymbols ? 1 : 0}` : 'o';
	const key = `${shape}|${poiColor}|${highlight ? 1 : 0}|${screenR}`;
	let sprite = poiSpriteCache.get(key);
	if (sprite) return sprite;
	const lineScale = highlight ? 0.4 : 0.08;
	const size = Math.ceil(2 * screenR * (1 + lineScale / 2)) + 4;
	const scale = screenR / tempRadius;
	const canvas = new OffscreenCanvas(size, size);
	const ctx = canvas.getContext('2d');
	ctx.translate(size / 2, size / 2);
	ctx.scale(scale, scale);
	ctx.strokeStyle = '#000000AA';
	ctx.beginPath();
	tracePoiShape(ctx, p, 0, 0, tempRadius, accessibility, simpleSymbols);
	ctx.fillStyle = poiColor;
	ctx.fill();
	ctx.lineWidth = tempRadius * lineScale;
	ctx.stroke();
	if (poiSpriteCache.size >= POI_SPRITE_CACHE_MAX) {
		for (const old of poiSpriteCache.values()) old.bitmap.close?.();
		poiSpriteCache.clear();
	}
	sprite = { bitmap: canvas.transferToImageBitmap(), size, scale };
	poiSpriteCache.set(key, sprite);
	return sprite;
}

// The marker colour of one PoI, by what it is.
function poiColorFor(p) {
	let poiColor = '#FFFFFFAA'; // Default color for unknown PoIs
	// If the wand has specific world data, use it for exact precision
	switch (p.type) {
		case 'wand':
			poiColor = '#00FFFFAA';
			break;
		case 'item':
			if (p.item) {
				if (p.item.includes('heart') || p.item === 'full_heal') {
					poiColor = '#FF0000AA';
				}
				else if (MATERIAL_CONTAINER_TYPES.includes(p.item)) {
					poiColor = '#0000FFAA';
				}
				else if (p.item === 'portal' || p.item === 'meditation_cube' || p.item === 'buried_eye_teleporter' || p.item === 'trailer_altar') {
					poiColor = '#800080AA';
				}
				else if (p.item === 'refresh_mimic' || p.item === 'heart_mimic' || p.item === 'mimic' || p.item === 'chest_leggy' || p.item === 'mimic_potion') {
					poiColor = '#AAAAAAAA';
				}
				else {
					poiColor = '#FFFF00AA';
				}
			}
			break;
		case 'utility_box':
		case 'puzzle':
		case 'vault_puzzle':
			poiColor = '#FF00FFAA';
			break;
		case 'chest':
		case 'pacifist_chest':
			poiColor = '#FFA500AA';
			break;
		case 'great_chest':
			poiColor = '#FF5500AA';
			break;
		case 'shop':
		case 'eye_room':
		case 'holy_mountain_shop':
			poiColor = '#00FF00AA';
			break;
		case 'enemies':
			poiColor = '#AAAAAAAA';
			for (let item of p.items) {
				if (item.type === 'wand') {
					poiColor = '#00FFFFAA';
					break;
				}
			}
			break;
		// Add more cases as needed for different PoI types
	}
	return poiColor;
}

// Whole-world bakes for the zoomed-out view.
//
// Zoomed out past a chunk of 32 screen px (z <= 1/16) every scene of a world
// copy is on screen -- ~1,150 drawImage calls per copy per frame for the
// 1/16 mips alone, and as many marker sprites -- and the wide "1.5 worlds"
// view of the render benchmark spent 11 ms a frame on the scenes and 6 ms on
// the markers, GPU backpressure included. Each becomes ONE bitmap per world
// copy instead:
//   sceneBake: the mip-4 (1/16) scene bitmaps composited at exactly 1/16 (so
//     at z = 1/16 it is the same pixels), rebuilt when a scene bitmap lands or
//     goes (pixelSceneBitmapVersion), at most every SCENE_BAKE_MIN_INTERVAL_MS
//     so a burst of worker replies does not rebuild it per reply;
//   poiBake: the marker sprites at screen resolution for the current zoom,
//     keyed by zoom bucket, flags and a checksum of the highlight flags, so a
//     search result or a zoom step rebuilds it and a drag never does.
const SCENE_BAKE_SCALE = 16;
const SCENE_BAKE_MAX_CHUNK_PX = 512 / SCENE_BAKE_SCALE;
const SCENE_BAKE_MIN_INTERVAL_MS = 300;
const POI_BAKE_MAX_CHUNK_PX = 64;
const POI_BAKE_SETTLE_MS = 150;
// Render HUD line for the scene bitmap cache: fill against budget, builds in
// flight, and event rates over the HUD's 2 s window. Refetches (a delivered
// bitmap asked for again) tracking evictions means the budget is too small
// for the view and the cache is thrashing.
function sceneCacheStatLine() {
	const snaps = [];
	const MB = 1024 * 1024;
	return () => {
		const s = getPixelSceneCacheStats();
		const t = performance.now();
		snaps.push({ t, s });
		while (snaps.length > 1 && snaps[0].t < t - 2000) snaps.shift();
		const first = snaps[0], dt = (t - first.t) / 1000;
		const rate = (k) => (dt > 0 ? (s[k] - first.s[k]) / dt : 0).toFixed(0);
		return `${(s.bytes / MB).toFixed(0)} / ${(s.budgetBytes / MB).toFixed(0)} MB (${(100 * s.bytes / s.budgetBytes).toFixed(0)}%)`
			+ ` · ${s.entries} bitmaps · ${s.pending} building (${s.pendingTextured} tex)\n`
			+ `         /s: ${rate('requests')} req · ${rate('refetches')} refetch · ${rate('evictions')} evict · ${rate('failures')} fail`;
	};
}

const sceneBakes = new Map();   // placement list -> { version, builtAt, bitmap, x, y, w, h, drawn }, LRU order
const SCENE_BAKE_MAX = 16;     // ~14 MB each at most (a whole world at 1/16)
const OVERLAY_OFFSCREEN_KEEP = 2;   // off-screen worlds' tile overlays kept (~30 MB each)
export function sceneBakeStats() {
	let bytes = 0, maxBytes = 0;
	for (const b of sceneBakes.values()) {
		const n = (b.w / SCENE_BAKE_SCALE) * (b.h / SCENE_BAKE_SCALE) * 4;
		bytes += n;
		if (n > maxBytes) maxBytes = n;
	}
	return { count: sceneBakes.size, bytes, maxBytes };
}
const poiBakes = new WeakMap();     // poi list -> { key, bitmap, x, y, w, h }

function poiHighlightChecksum(list) {
	let h = 0;
	for (let i = 0; i < list.length; i++) if (list[i].highlight === true) h = (h * 31 + i + 1) | 0;
	return h;
}

function getPoiRadius(poi, zoom) {
	let radius = POI_RADIUS;
	if (poi.type === 'enemies' || poi.type === 'props') {
		radius /= 2.0;
		for (const item of poi.items) {
			if (item.type === 'wand') {
				radius = POI_RADIUS;
				break;
			}
		}
	}

	const isHighlighted = poi.highlight === true;
	const scaleInput = document.getElementById(isHighlighted ? 'debug-highlight-poi-scale' : 'debug-poi-scale');
	const zoomInput = document.getElementById(isHighlighted ? 'debug-highlight-pois-zoom' : 'debug-pois-zoom');
	const scaleFactor = Number.parseFloat(scaleInput?.value) || 1;
	if (zoomInput?.checked) {
		radius = POI_RADIUS / zoom;
		// It's way too big when zoomed
		radius *= 0.25;
	}
	if (isHighlighted) {
		radius *= 3.0; // Highlighted POIs are bigger
	}
	return radius * scaleFactor;
}

// ---------------------------------------------------------------------------
// Per-layer render profiling (debug-layer-timings)
//
// drawNow() draws its layers in sequence, so a single "mark" call at the end of a
// section is enough to attribute everything since the previous mark to that layer.
// Draw calls are counted by shadowing the context methods with counting wrappers only
// while profiling is on, so nothing is instrumented (and nothing costs anything) when
// the debug flag is off.
// ---------------------------------------------------------------------------
const COUNTED_DRAW_OPS = ['fill', 'stroke', 'fillRect', 'strokeRect', 'fillText'];
const drawCounter = { images: 0, ops: 0 };
let countedCtx = null;

function installDrawCounter(ctx) {
	if (countedCtx === ctx) return;
	removeDrawCounter();
	const proto = Object.getPrototypeOf(ctx);
	ctx.drawImage = function (...args) {
		drawCounter.images++;
		return proto.drawImage.apply(this, args);
	};
	for (const op of COUNTED_DRAW_OPS) {
		ctx[op] = function (...args) {
			drawCounter.ops++;
			return proto[op].apply(this, args);
		};
	}
	countedCtx = ctx;
}

function removeDrawCounter() {
	if (!countedCtx) return;
	delete countedCtx.drawImage;
	for (const op of COUNTED_DRAW_OPS) delete countedCtx[op];
	countedCtx = null;
}

// Closes the bucket opened by the previous mark (or by startLayerProfile) and adds its
// time and draw counts to `key`. Calling the same key more than once per frame is fine,
// the layer just accumulates (the misc layer is split across the frame).
function markLayer(prof, key) {
	if (!prof) return;
	const now = performance.now();
	let bucket = prof.buckets.get(key);
	if (!bucket) {
		bucket = { ms: 0, images: 0, ops: 0 };
		prof.buckets.set(key, bucket);
	}
	bucket.ms += now - prof.t;
	prof.frameLayers[key] = (prof.frameLayers[key] || 0) + (now - prof.t);
	bucket.images += drawCounter.images - prof.images;
	bucket.ops += drawCounter.ops - prof.ops;
	prof.t = now;
	prof.images = drawCounter.images;
	prof.ops = drawCounter.ops;
}


export const app = {
	// TODO: A lot of these are old and unused and could probably be cleaned up
	canvas: null,
	ctx: null,

	// Set while a coalesced redraw is already queued for the next animation frame
	drawScheduled: false,

	baseBiomeMapNG0: null,
	baseBiomeMapNGP: null,

	// Biome map renders for background (can use biomeData.pixels for the color data)
	offscreen: null, 
	offscreenHeaven: null,
	offscreenHell: null,

	overlay: null, 
	surfaceOverlay: null,
	surfaceOverlayPW: null,
	surfaceOverlayPWAddition: null,
	skyOverlay: null,
	skyOverlayPW: null,
	surfaceOverlayNGP: null,
	surfaceOverlayNGPPW: null,
	surfaceOverlayNGPPWAddition: null,
	skyOverlayNGP: null,
	skyOverlayNGPPW: null,
	surfaceOverlayNGP7: null,
	surfaceOverlayNGP7PW: null,
	skyOverlayNGP7: null,
	skyOverlayNGP7PW: null,
	surfaceOverlayNGP14: null,
	surfaceOverlayNGP14PW: null,
	skyOverlayNGP14: null,
	skyOverlayNGP14PW: null,
	surfaceOverlayNGP21: null,
	surfaceOverlayNGP21PW: null,
	skyOverlayNGP21: null,
	skyOverlayNGP21PW: null,
	surfaceOverlayNightmare: null,
	skyOverlayNightmare: null,
	surfaceOverlayNightmarePW: null,
	skyOverlayNightmarePW: null,

	weatherOverlays: null,

	ctxo: null, 
	// Background maps, recolored by biome
	recolorOffscreen: null,
	recolorOffscreenHeaven: null, 
	recolorOffscreenHell: null,

	// Buffer versions since we can't use getImageData
	recolorOffscreenBuffer: null,
	recolorOffscreenHeavenBuffer: null,
	recolorOffscreenHellBuffer: null,

	// Chunk-resolution mask of the world where no tile layer paints anything, plus the
	// scratch canvas and pattern used to stamp a transparency checkerboard through it
	unpaintedMask: null,
	unpaintedChunkCount: 0,
	checkerScratch: null,
	checkerPattern: null,
	// Per-layer render profiling state (see markLayer above)
	layerProfile: null,
	// WebGL2 terrain renderer (settings.terrainRenderer === 'gl'), built lazily on
	// the first GL frame and rebuilt whenever tileLayers/biomeData are replaced
	glTerrain: null,

	w: 0, h: 0, 
	biomeData: null,
	tileLayers: [],
	cam: { x: CHUNK_SIZE*35, y: CHUNK_SIZE*24, z: 0.0625 },
	drag: { on: false, lx: 0, ly: 0, startX: -10, startY: -10 },
	pinnedTooltip: null,
	// Last canvas pixel read back for the hover tooltip's color swatch; x is reset
	// to -1 by drawNow() so a repaint always re-reads (displayedColorAt, which
	// defers the read and keeps its own 1x1 scratch context here).
	colorProbe: { x: -1, y: -1, rgb: 0, wantX: -1, wantY: -1, timer: 0, ctx: null },
	// Same for the decal texel (decalTexelAt); keyed on the frame it was read in.
	decalProbe: { x: NaN, y: NaN, frame: -1, value: null, wantX: 0, wantY: 0, timer: 0 },
	frameSerial: 0,
	lastHoverEvent: null,
	copyFlashTimer: 0,
	pw: 0,
	pwVertical: 0,
	seed: 0,
	ngPlusCount: 0,
	isNGP: false,
	eyes: {},
	biomeMapOverlay: null, // Used to mask out areas like EDR which tiles shouldn't extend into, even in NG+
	tileSpawns: null, // Pre-scanned spawn functions for generated tiles
	pixelScenesByPW: {}, // Cached pixel scenes by PW after scanning
	poisByPW: {}, // Cached PoIs by PW after scanning
	tileOverlaysByPW: {}, // Cached biome tile overlays by PW after generation, to avoid expensive recoloring on every render

	extraPois: [], // Used for local results
	zoomPixel: null, // Used to store the single pixel that should be zoomed in on from local search results
	
	translations: {},
	loadingTimer: null,
	perks: {}, // extraShopItems, greedCurse, noMoreShuffle
	perkSimulationRetention: 'selection',

	debugCanvas: null,
	debugX: 0, debugY: 0,
	hiisiHourglassPosition: null, // "left" or "right"
	weather: null,
	biomeModifiers: null,
	isDaily: false,
	cauldronState: null,

	fungalShifts: null,
	alchemyRecipes: null,

	worldsInView: new Set(),
	gameMode: 'normal', // or nightmare

	// View framing from the URL (js/view_url.js): parsed at startup, applied
	// once a world exists, then kept up to date as the camera moves.
	pendingView: null,
	viewURLTimer: null,
	lastViewURL: null,

	init() {
		// Read x/y/z before anything async can run: the first background asset to
		// land calls draw(), which would otherwise write the default view over the
		// parameters we are about to read.
		this.pendingView = parseViewParams(new URLSearchParams(window.location.search));
		this.canvas = document.getElementById('canvas');
		this.ctx = this.canvas.getContext('2d');
		//this.overlay = document.getElementById('overlay');
		//this.ctxo = this.overlay.getContext('2d');
		this.offscreen = document.createElement('canvas');
		this.offscreenHeaven = document.createElement('canvas');
		this.offscreenHell = document.createElement('canvas');
		this.recolorOffscreen = document.createElement('canvas');
		this.recolorOffscreenHeaven = document.createElement('canvas');
		this.recolorOffscreenHell = document.createElement('canvas');
		// Background boundary art. Fire and forget: the draw path skips strips whose
		// mask has not arrived yet, and redraws pick them up once it has.
		loadBackgroundEdgeMasks().then(() => this.draw());
		loadBackgroundArt().then(() => this.draw());
		loadStaticTileBackgroundMasks().then(() => this.draw());
		const vp = document.getElementById('view');

		const resize = () => {
			this.canvas.width = vp.clientWidth;
			this.canvas.height = vp.clientHeight;
			//this.overlay.width = vp.clientWidth;
			//this.overlay.height = vp.clientHeight;
			this.draw();
		};
		window.addEventListener('resize', resize);
		resize();

		this.initUnlocks();
		this.initRegions();
		// Wow do I hate async/await
		this.preload().then(async () => await this.loadFromURLParams());

		// Menu Toggles
		document.querySelector('.adv-toggle').onclick = () => this.toggleAdvancedSearch();
		const optionsOverlay = document.getElementById('options-overlay');
		this.setOptionsVisible = (visible) => {
			optionsOverlay.style.display = visible ? 'flex' : 'none';
			document.getElementById('options-button').textContent = visible ? 'Close Options ◀' : 'Open Options ▶';
			if (visible) {
				this.updateOptionDependencies();
				document.dispatchEvent(new CustomEvent('telescope-overlay-open', {
					detail: { overlayId: 'options-overlay' }
				}));
			}
		};
		document.getElementById('options-button').onclick = () => {
			this.setOptionsVisible(optionsOverlay.style.display !== 'flex');
		};
		document.getElementById('options-close').onclick = () => this.setOptionsVisible(false);
		document.addEventListener('telescope-overlay-open', (event) => {
			if (event.detail.overlayId !== 'options-overlay') this.setOptionsVisible(false);
		});
		// Bubbles after each control's own onchange handler has run.
		optionsOverlay.addEventListener('change', () => this.updateOptionDependencies());
		document.querySelector('#alchemy-label').onclick = () => this.toggleAlchemyRecipes();
		const fungalShiftsOverlay = document.getElementById('fungal-shifts-overlay');
		const setFungalShiftsVisible = (visible) => {
			fungalShiftsOverlay.style.display = visible ? 'flex' : 'none';
			document.getElementById('fungal-shifts-button').textContent = fungalShiftsOverlay.style.display === 'flex' ? 'Close Fungal Shifts ◀' : 'Open Fungal Shifts ▶';

			if (visible) document.dispatchEvent(new CustomEvent('telescope-overlay-open', {
				detail: { overlayId: 'fungal-shifts-overlay' }
			}));
		};
		document.getElementById('fungal-shifts-button').onclick = () => {
			setFungalShiftsVisible(fungalShiftsOverlay.style.display !== 'flex');
		};
		document.getElementById('fungal-shifts-close').onclick = () => setFungalShiftsVisible(false);
		document.addEventListener('telescope-overlay-open', (event) => {
			if (event.detail.overlayId !== 'fungal-shifts-overlay') setFungalShiftsVisible(false);
		});
		const perkDeckOverlay = document.getElementById('perk-deck-overlay');
		const setPerkDeckVisible = (visible) => {
			perkDeckOverlay.style.display = visible ? 'flex' : 'none';
			document.getElementById('perk-deck-button').textContent = perkDeckOverlay.style.display === 'flex' ? 'Close Perk Deck ◀' : 'Open Perk Deck ▶';
			if (visible) document.dispatchEvent(new CustomEvent('telescope-overlay-open', {
				detail: { overlayId: 'perk-deck-overlay' }
			}));
		};
		document.getElementById('perk-deck-button').onclick = () => {
			setPerkDeckVisible(perkDeckOverlay.style.display !== 'flex');
		};
		document.getElementById('perk-deck-close').onclick = () => setPerkDeckVisible(false);
		document.addEventListener('telescope-overlay-open', (event) => {
			if (event.detail.overlayId !== 'perk-deck-overlay') setPerkDeckVisible(false);
		});
		
		document.getElementById('daily-run-button').onclick = () => {
			this.getDailyRunSeed().then(seed => {
				if (seed !== null) {
					this.seed = seed;
					document.getElementById('seed').value = this.seed;
					this.ngPlusCount = 0;
					document.getElementById('ng').value = 0;
					const url = new URL(window.location.href);
					url.searchParams.set('seed', 'daily');
					url.searchParams.set('ng', '0');
					window.history.replaceState({}, '', url.toString());
					// Set all unlocks
					//const list = document.getElementById('unlocks-list');
					//list.querySelectorAll('input').forEach(c => c.checked = true);
					// Moved this to settings with the daily flag so that persistent unlocks are not changed
					this.isDaily = true;
					this.perkSimulationRetention = 'none';
					this.saveSettings();
					this.unlocksChanged = true;
					this.generate(true, true);
					// TODO: Add some kind of warning about the daily run unlocking everything temporarily
					alert("Note that the daily run temporarily unlocks all spells");
				}
			});
		};

		// PW Controls
		// Horizontal
		const pwInput = document.getElementById('pw');
		pwInput.onchange = () => {
			const refreshCurrentPWSearch = isSearchActive() && !document.getElementById('search-all-pw').checked;
			if (refreshCurrentPWSearch) cancelSearch();
			this.pw = parseInt(pwInput.value) || 0;
			this.checkBounds();
			this.generate(false, false).then(() => {
				if (refreshCurrentPWSearch) performSearch(false, false);
			});
		};
		document.getElementById('pw-inc').onclick = () => {
			pwInput.value = Math.min(512, parseInt(pwInput.value) + 1);
			pwInput.onchange();
		};
		document.getElementById('pw-dec').onclick = () => {
			pwInput.value = Math.max(-512, parseInt(pwInput.value) - 1);
			pwInput.onchange();
		};
		// Vertical
		const pwInputVertical = document.getElementById('pw-vertical');
		pwInputVertical.onchange = () => {
			const refreshCurrentPWSearch = isSearchActive() && !document.getElementById('search-all-pw').checked;
			if (refreshCurrentPWSearch) cancelSearch();
			this.pwVertical = parseInt(pwInputVertical.value) || 0;
			this.checkBounds();
			this.generate(false, false).then(() => {
				if (refreshCurrentPWSearch) performSearch(false, false);
			});
		};
		document.getElementById('pw-inc-vertical').onclick = () => {
			pwInputVertical.value = Math.min(512, parseInt(pwInputVertical.value) + 1);
			pwInputVertical.onchange();
		};
		document.getElementById('pw-dec-vertical').onclick = () => {
			pwInputVertical.value = Math.max(-512, parseInt(pwInputVertical.value) - 1);
			pwInputVertical.onchange();
		};

		// Generate
		document.getElementById('seed').onchange = () => {
			let value = parseInt(document.getElementById('seed').value);
			if (!value || isNaN(value) || value < 0) value = 0;
			else if (value > 2147483647) value = 2147483647;
			document.getElementById('seed').value = value;
			//this.saveSettings();
			const url = new URL(window.location.href);
			url.searchParams.set('seed', value);
			window.history.replaceState({}, '', url.toString());
			if (this.isDaily) {
				this.isDaily = false; // Clear daily run mode if seed is manually changed
				this.unlocksChanged = true; // Flag to update unlocks based on checkboxes instead of daily run
				//this.saveSettings(); // Make sure settings are saved just so that the daily run unlocks don't persist in the workers after leaving daily mode
			}
			// Reset perks
			document.getElementById('no-more-shuffle').checked = false;
			document.getElementById('greed-curse').checked = false;
			document.getElementById('extra-shop-items').value = 0;
			this.perks = {};
			this.perkSimulationRetention = 'none';
			// Still need to save settings I think...
			this.saveSettings();
			this.generate(true, true);
		};
		document.getElementById('ng').onchange = () => {
			let value = parseInt(document.getElementById('ng').value);
			if (!value || isNaN(value) || value < 0) value = 0;
			else if (value > 28) value = 28;
			document.getElementById('ng').value = value;
			//this.saveSettings();
			const url = new URL(window.location.href);
			url.searchParams.set('ng', value);
			window.history.replaceState({}, '', url.toString());
			// Do not clear daily run flag
			this.perkSimulationRetention = 'taken-perks';
			this.saveSettings();
			this.generate(true, true);
		};
		// No longer using this button, just change the seed/NG+ count and it will auto-generate now
		document.getElementById('gen-btn').onclick = () => this.generate(true, true);

		document.getElementById('game-mode').onchange = () => {
			const url = new URL(window.location.href);
			if (document.getElementById('game-mode').value === 'nightmare') {
				url.searchParams.set('gamemode', 'nightmare');
			} else {
				url.searchParams.delete('gamemode');
			}
			window.history.replaceState({}, '', url.toString());
			this.generate(true, true);
		};

		// Perk Controls
		// TODO: For now I'm just going to do a full regen because syncing the worker threads is a pain
		document.getElementById('no-more-shuffle').onchange = () => {
			this.perks['noMoreShuffle'] = document.getElementById('no-more-shuffle').checked; 
			this.perkSimulationRetention = 'selection';
			this.saveSettings(); 
			this.generate(true, true)
		};
		document.getElementById('greed-curse').onchange = () => {
			this.perks['greedCurse'] = document.getElementById('greed-curse').checked;
			this.saveSettings();
			this.generate(true, true);
		};
		document.getElementById('extra-shop-items').onchange = () => {
			this.perks['extraShopItems'] = parseInt(document.getElementById('extra-shop-items').value);
			this.perkSimulationRetention = 'selection';
			this.saveSettings();
			this.generate(true, true);
		};
		
		// Debug Controls
		
		document.getElementById('skip-cosmetic-scenes').onchange = () => {
			this.saveSettings();
			this.generate(false, true);
		};
		document.getElementById('exclude-taikasauva').onchange = () => {
			this.excludeTaikasauva = document.getElementById('exclude-taikasauva').checked;
			this.saveSettings();
			this.generate(false, true);
		};
		document.getElementById('enable-edge-noise').onchange = () => {
			this.tileOverlaysByPW = {}; // Clear cached overlays so they will be regenerated with the new mode
			this.saveSettings();
			// Do full regen to sync worker threads
			this.generate(true, true);
		};
		document.getElementById('custom-art').onchange = async () => {
			if (!document.getElementById('custom-art').checked) {
				this.surfaceOverlay = null;
				this.surfaceOverlayPW = null;
				this.surfaceOverlayPWAddition = null;
				this.surfaceOverlayNGP = null;
				this.surfaceOverlayNGPPW = null;
				this.surfaceOverlayNGPPWAddition = null;
				this.surfaceOverlayNightmare = null;
				this.surfaceOverlayNightmarePW = null;
			}
			else {
				await this.getSurfaceOverlays();
			}
			this.saveSettings();
			this.draw();
		}
		document.getElementById('show-wand-sprite-rarity').onchange = () => {this.saveSettings(); this.draw();};
		document.getElementById('debug-show-tile-bounds').onchange = () => {this.saveSettings(); this.draw();};
		document.getElementById('debug-show-path').onchange = () => {this.saveSettings(); this.draw();};
		document.getElementById('debug-hide-pois').onchange = () => {this.saveSettings(); this.draw();};
		document.getElementById('debug-extra-rerolls').onchange = () => {this.saveSettings(); this.generate(true, true);};
		document.getElementById('debug-rng-info').onchange = () => {this.saveSettings(); this.draw();};
		document.getElementById('debug-original-biome-map').onchange = () => {this.saveSettings(); this.draw();};
		document.getElementById('debug-small-pois').onchange = () => {this.saveSettings(); this.draw();};
		document.getElementById('debug-unpainted-checkerboard').onchange = () => {this.saveSettings(); this.draw();};
		document.getElementById('debug-biome-boundary-contour').onchange = () => {this.saveSettings(); this.draw();};
		document.getElementById('debug-layer-timings').onchange = () => {this.saveSettings(); this.draw();};
		document.getElementById('debug-render-hud').onchange = () => {this.saveSettings(); this.draw();};
		document.getElementById('debug-render-everything').onchange = () => {this.saveSettings(); this.draw();};
		document.getElementById('debug-run-benchmark').onclick = async () => {
			const status = document.getElementById('debug-benchmark-status');
			const result = document.getElementById('debug-benchmark-result');
			status.textContent = 'running…';
			try {
				const res = await runRenderBenchmark(this, { log: (text) => { result.textContent = text; result.style.display = 'block'; } });
				status.textContent = res ? 'done (tables also in the console; app.lastBenchmark)' : 'not ready';
			} catch (err) {
				status.textContent = `failed: ${err.message}`;
				console.error(err);
			}
		};
		// The GL renderer paints the fill biomes and the CPU bake does not, so the
		// unpainted-chunk mask depends on which one is selected.
		// Switching renderer can change the effective static/cosmetic scene settings
		// and whether custom art is drawn (see applyRendererOverrides in settings.js).
		document.getElementById('debug-terrain-renderer').onchange = async () => {
			const sceneSettings = () => `${appSettings.enableStaticPixelScenes}|${appSettings.skipCosmeticScenes}`;
			const scenesBefore = sceneSettings();
			this.saveSettings();
			if (appSettings.customArt && !this.surfaceOverlay) {
				try {
					await this.getSurfaceOverlays();
				} catch (e) { console.error("Custom art failed to load:", e); }
			}
			if (sceneSettings() !== scenesBefore) {
				reloadPixelSceneCache().then(() => this.generate(true, true));
			} else {
				this.draw();
			}
		};
		document.getElementById('debug-pixel-scene-budget').onchange = () => {this.saveSettings(); this.draw();};
		for (const layer of RENDER_LAYERS) {
			document.getElementById(layer.id).onchange = () => {this.saveSettings(); this.draw();};
		}
		for (const [inputId, outputId] of [
			['debug-poi-scale', 'debug-poi-scale-value'],
			['debug-highlight-poi-scale', 'debug-highlight-poi-scale-value'],
		]) {
			const input = document.getElementById(inputId);
			input.oninput = () => {
				document.getElementById(outputId).textContent = `${Number.parseFloat(input.value).toFixed(1)}x`;
				this.saveSettings();
				this.draw();
			};
		}
		document.getElementById('debug-pois-zoom').onchange = () => {this.saveSettings(); this.draw();};
		document.getElementById('debug-highlight-pois-zoom').onchange = () => {this.saveSettings(); this.draw();};
		document.getElementById('debug-fix-holy-mountain-edge-noise').onchange = () => {this.saveSettings(); this.generate(true, true);};
		document.getElementById('debug-block-edge-spawns').onchange = () => {this.saveSettings(); this.generate(true, true);};
		document.getElementById('show-enemy-spawns').onchange = () => {this.saveSettings(); this.generate(true, true);};
		document.getElementById('enable-hamis-hints').onchange = () => {this.saveSettings();};
		document.getElementById('clear-spawn-pixels').onchange = () => {
			// TODO: Should probably rework this so it doesn't need to completely regenerate, but this is fine for now
			this.saveSettings();
			reloadPixelSceneCache().then(() => this.generate(true, true));
		};
		document.getElementById('recolor-materials').onchange = () => {
			// TODO: Should probably rework this so it doesn't need to completely regenerate, but this is fine for now
			this.saveSettings();
			reloadPixelSceneCache().then(() => this.generate(true, true));
		};
		document.getElementById('material-textures').onchange = () => {
			// Shader uniform only: no regeneration, not even a resource rebuild.
			this.saveSettings();
			this.draw();
		};
		document.getElementById('engine-terrain').onchange = () => {
			// The GL resource key includes the flag, so the next draw builds (or
			// drops) the engine lattices; no worker regeneration involved.
			this.saveSettings();
			this.draw();
		};
		document.getElementById('edge-decals').onchange = () => {
			// Cached tiles stay valid, so turning it back on costs nothing.
			this.saveSettings();
			this.draw();
		};
		document.getElementById('debug-biome-overlay-mode').onchange = () => {
			this.saveSettings();
			this.tileOverlaysByPW = {}; // Clear cached overlays so they will be regenerated with the new mode
			invalidatePendingOverlays();
			// The CPU draw loop re-requests overlays for the worlds it draws.
			this.draw();
			//this.generate(true, true); // TODO: Probably don't need to completely regenerate tiles
		};
		document.getElementById('exclude-edge-cases').onchange = () => {
			this.excludeEdgeCases = document.getElementById('exclude-edge-cases').checked;
			this.saveSettings();
			// Do full regen to sync worker threads and remove edge cases from spawns/POIs
			this.generate(true, true);
		};
		document.getElementById('debug-edge-noise').onchange = () => {
			this.saveSettings();
			this.draw();
		};
		document.getElementById('visited-coalmine-alt-shrine').onchange = () => {
			// TODO: Need to sync this in search settings
			const value = document.getElementById('visited-coalmine-alt-shrine').checked;
			if (value) {
				COALMINE_ALT_SCENES["g_pixel_scene_02"][0].prob = 0.0;
			}
			else {
				COALMINE_ALT_SCENES["g_pixel_scene_02"][0].prob = 0.5;
			}
			this.saveSettings();
			// Do full regen just in case?
			this.generate(true, true);
		};
		document.getElementById('enable-static-pixel-scenes').onchange = () => {
			this.saveSettings();
			reloadPixelSceneCache().then(() => this.generate(true, true));
		};
		document.getElementById('accessibility-mode').onchange = () => {
			this.saveSettings();
			this.draw();
		}
		document.getElementById('debug-simple-poi-symbols').onchange = () => {
			this.saveSettings();
			this.draw();
		}

		// Search

		// Setup range value displays
		document.getElementById('search-btn').onclick = () => {
			cancelSearch();
			this.draw(); // Clear highlights immediately on new search
			performSearch(true, true);
		};
		document.getElementById('search-input').onkeydown = (e) => { 
			if(e.key === "Enter") {
				cancelSearch();
				this.draw(); // Clear highlights immediately on new search
				performSearch(true, true); 
			}
		};
		document.getElementById('search-prev').onclick = () => navigateSearch(-1, true);
		document.getElementById('search-next').onclick = () => navigateSearch(1, true);
		const cancelBtn = document.getElementById('cancel-search');
		cancelBtn.onclick = () => { 
			cancelSearch();
			this.setLoading(false); // Clear overlay immediately on cancel
			this.draw();
		};
		document.getElementById('search-all-pw-label').onclick = () => {
			const checkbox = document.getElementById('search-all-pw');
			checkbox.checked = !checkbox.checked;
		};
		const setPWMaxButton = document.getElementById('pw-set-max');
		setPWMaxButton.onclick = () => {
			document.getElementById('search-all-pw').checked = true;
			document.getElementById('search-pw-limit').value = getPWLimit(this.isNGP, this.gameMode);

		};
		const setPWMaxVerticalButton = document.getElementById('pw-set-max-vertical');
		setPWMaxVerticalButton.onclick = () => {
			document.getElementById('search-vertical-pw').checked = true;
			document.getElementById('search-pw-vertical-limit').value = 683;
		};

		document.getElementById('search-name').onkeydown = (e) => { 
			if(e.key === "Enter") {
				cancelSearch();
				this.draw(); // Clear highlights immediately on new search
				performSearch(true, true); 
			}
		};
		document.getElementById('search-sprite').onkeydown = (e) => { 
			if(e.key === "Enter") {
				cancelSearch();
				this.draw(); // Clear highlights immediately on new search
				performSearch(true, true); 
			}
		};
		document.getElementById('search-ac').onkeydown = (e) => { 
			if(e.key === "Enter") {
				cancelSearch();
				this.draw(); // Clear highlights immediately on new search
				performSearch(true, true); 
			}
		};

		document.getElementById('search-vertical-pw').onchange = () => {
			if (document.getElementById('search-vertical-pw').checked) {
				document.getElementById('search-all-pw').checked = true;
			}
		}

		const runQuickSearch = (query) => {
			cancelSearch();
			this.draw(); // Clear highlights immediately on new search
			document.getElementById('search-input').value = query;
			document.getElementById('search-all-pw').checked = false;
			document.getElementById('search-vertical-pw').checked = false;
			performSearch(true, false);
		};
		document.getElementById('search-rare-btn').onclick = () => runQuickSearch('rare');
		document.getElementById('search-missing-progress-btn').onclick = () => runQuickSearch('missing');

		setupProgressUI((searchTerm, category) => {
			document.getElementById('progress-overlay').style.display = 'none';
			if (category === 'enemies' && !document.getElementById('show-enemy-spawns').checked) {
				alert('Hämis says: Enemy spawns are disabled. Enable "Show Enemy Spawns" in Options before searching for enemies.');
				const enemySpawnsCheckbox = document.getElementById('show-enemy-spawns');
				this.setOptionsVisible(true);
				enemySpawnsCheckbox.scrollIntoView({ behavior: 'smooth', block: 'center' });
				enemySpawnsCheckbox.focus();
				return;
			}
			let finalSearchTerm = searchTerm;
			if (category === 'enemies') {
				// Exceptions, probably many that are needed but I'm lazy
				// Actually this one doesn't work anyway because it's a wand name modifier and not an item name, and the associated enemy isn't included as a separate spawn
				//if (searchTerm === 'wand_ghost') finalSearchTerm = 'taikasauva';
				if (searchTerm === 'player') finalSearchTerm = 'starting loadout';
				if (searchTerm === 'sheep') finalSearchTerm = 'normal sheep';
				if (searchTerm === 'fish') finalSearchTerm = 'normal fish';
				if (searchTerm === 'duck') finalSearchTerm = 'normal duck';
				if (searchTerm === 'deer') finalSearchTerm = 'normal deer';
				if (searchTerm === 'zombie') finalSearchTerm = 'normal zombie';
				if (searchTerm === 'miner') finalSearchTerm = 'normal miner';
				if (searchTerm === 'shotgunner') finalSearchTerm = 'normal shotgunner';
				if (searchTerm === 'alchemist') finalSearchTerm = 'normal alchemist';
				if (searchTerm === 'slimeshooter') finalSearchTerm = 'normal slimeshooter';
				if (searchTerm === 'acidshooter') finalSearchTerm = 'normal acidshooter';
				if (searchTerm === 'bigzombie') finalSearchTerm = 'normal bigzombie';
				if (searchTerm === 'giantshooter') finalSearchTerm = 'normal giantshooter';
				if (searchTerm === 'blob') finalSearchTerm = 'normal blob';
				if (searchTerm === 'rat') finalSearchTerm = 'normal rat';
				if (searchTerm === 'bat') finalSearchTerm = 'normal bat';
				if (searchTerm === 'firebug') finalSearchTerm = 'normal firebug';
				if (searchTerm === 'fly') finalSearchTerm = 'normal fly';
				if (searchTerm === 'frog') finalSearchTerm = 'normal frog';
				if (searchTerm === 'fungus') finalSearchTerm = 'normal fungus';
				if (searchTerm === 'tentacler') finalSearchTerm = 'normal tentacler';
				if (searchTerm === 'lukki') finalSearchTerm = 'normal lukki';
				if (searchTerm === 'worm') finalSearchTerm = 'normal worm';
				if (searchTerm === 'roboguard') finalSearchTerm = 'normal roboguard';
				if (searchTerm === 'tank') finalSearchTerm = 'normal tank';
				if (searchTerm === 'necrobot') finalSearchTerm = 'normal necrobot';
				if (searchTerm === 'firemage') finalSearchTerm = 'normal firemage';
				if (searchTerm === 'thundermage') finalSearchTerm = 'normal thundermage';
				if (searchTerm === 'wraith') finalSearchTerm = 'normal wraith';
				if (searchTerm === 'statue') finalSearchTerm = 'normal statue';
				if (searchTerm === 'ghost') finalSearchTerm = 'normal ghost';
				if (searchTerm === 'gazer') finalSearchTerm = 'normal gazer';
				if (searchTerm === 'crystal_physics') finalSearchTerm = 'normal crystal_physics';
				if (searchTerm === 'sniper') finalSearchTerm = 'normal sniper';
				if (searchTerm === 'boss_dragon') finalSearchTerm = 'dragon';
				if (searchTerm === 'boss_limbs') finalSearchTerm = 'pyramid boss';
				if (searchTerm === 'boss_alchemist') finalSearchTerm = 'alchemist boss';
				if (searchTerm === 'gate_monster_a') finalSearchTerm = 'triangle boss';
				if (searchTerm === 'gate_monster_b') finalSearchTerm = 'triangle boss';
				if (searchTerm === 'gate_monster_c') finalSearchTerm = 'triangle boss';
				if (searchTerm === 'gate_monster_d') finalSearchTerm = 'triangle boss';
				if (searchTerm === 'chest_leggy') finalSearchTerm = 'leggy mimic';
				if (searchTerm === 'dark_alchemist') finalSearchTerm = 'heart mimic';
				if (searchTerm === 'shaman_wind') finalSearchTerm = 'refresh mimic';
				// Probably others I'm not thinking of
				// Also bosses and stuff, but they're pretty much entirely missing here anyway
			}
			document.getElementById('search-input').value = finalSearchTerm;
			// Scroll to search button on side menu so that the user can see the results
			const searchBtn = document.getElementById('search-btn');
			searchBtn.scrollIntoView({ behavior: 'smooth', block: 'center' });
			// Perform actual click instead so that it does the proper search navigation
			searchBtn.click();
			//performSearch(false, false);
		});

		document.addEventListener('perk-simulation-changed', (event) => {
			const { noMoreShuffle, extraShopItems } = event.detail;
			const noMoreShuffleInput = document.getElementById('no-more-shuffle');
			const extraShopItemsInput = document.getElementById('extra-shop-items');
			if (noMoreShuffleInput.checked === noMoreShuffle && parseInt(extraShopItemsInput.value) === extraShopItems) return;

			noMoreShuffleInput.checked = noMoreShuffle;
			extraShopItemsInput.value = extraShopItems;
			this.perks.noMoreShuffle = noMoreShuffle;
			this.perks.extraShopItems = extraShopItems;
			this.perkSimulationRetention = 'selection';
			this.saveSettings();
			this.generate(true, true);
		});

		document.getElementById('player-copy-path-btn').onclick = async () => {
			try {
				await navigator.clipboard.writeText('%USERPROFILE%\\AppData\\LocalLow\\Nolla_Games_Noita\\save00');
				document.getElementById('player-copy-path-btn').textContent = 'Copied!';
				setTimeout(() => { document.getElementById('player-copy-path-btn').textContent = 'Copy Path'; }, 2000);
			} catch (error) {
				console.error('Failed to copy player path:', error);
			}
		};
		document.getElementById('player-file-picker').onchange = async (event) => {
			const [playerFile] = event.target.files;
			if (!playerFile) return;
			if (playerFile.name.toLowerCase() !== 'player.xml') {
				alert('Please select player.xml.');
				event.target.value = '';
				return;
			}

			const perkPickups = {};
			const perkPattern = /\$perk_([a-z_]+)/gi;
			for (const match of (await playerFile.text()).matchAll(perkPattern)) {
				const perkId = match[1].toUpperCase();
				perkPickups[perkId] = (perkPickups[perkId] || 0) + 1;
			}
			importPerkPickups(perkPickups);
			this.perkSimulationRetention = 'selection';
			event.target.value = '';
		};


		// Event Handlers

		// Upload flags folder for unlocks
		document.getElementById('unlock-folder-picker').addEventListener('change', async (event) => {
			const fileList = event.target.files;

			const foundFlags = new Set();
			const actionFlags = new Set();
			const specialFlags = {};

			for (const file of fileList) {
				let name = file.name.toLowerCase();
				if (name.startsWith('action_')) actionFlags.add(name);
				// Standard Noita flag prefix
				if (name.startsWith("card_unlocked_")) {
					name = name.replace("card_unlocked_", "");
				}
				foundFlags.add(name);

				// Extra bonus flags just for fun
				if (name === 'progress_sun') specialFlags['sunGem'] = true;
				if (name === 'progress_darksun') specialFlags['darksunGem'] = true;
				if (name === 'moon_is_sun') specialFlags['sunState'] = true;
				if (name === 'darkmoon_is_darksun') specialFlags['darksunState'] = true;
			}

			Object.keys(UNLOCKABLES).forEach(flagKey => {
				const checkbox = document.getElementById(`unlock-${flagKey}`);
				checkbox.checked = foundFlags.has(flagKey);
			});
			updateUsedSpellProgress(actionFlags);

			// Save spells to settings too
			updateSpellFlags(Array.from(actionFlags));

			updateSpecialFlags(specialFlags);
			
			this.unlocksChanged = true;
			this.saveSettings();

			this.generate(false, true);
		});

		this.canvas.onmousedown = e => {
			// Hit moved to mouseup to avoid drag issues
			this.drag.on = true; 
			this.drag.startX = e.clientX;
			this.drag.startY = e.clientY;
			this.drag.lx = e.clientX; 
			this.drag.ly = e.clientY; 
		};

		window.onmouseup = (e) => {
			this.drag.on = false; 
			e.stopPropagation();
			// Check if dragged
			if (Math.abs(e.clientX - this.drag.startX) > 5 || Math.abs(e.clientY - this.drag.startY) > 5) {
				// Finished dragging
				//console.log('Finished dragging');
			}
			else {
				// Treat as click if not dragged
				const hit = this.getHitObject(e);
				let pinchange = false;
				// Plain click on the map (nothing pinnable under the cursor): copy the
				// hover tooltip. Guarded on the canvas because this handler is on
				// `window`, so every click in the side panels lands here too.
				if (!hit && e.target === this.canvas) {
					this.copyCoordsTooltip();
				}
				if (hit) {
					this.pinnedTooltip = hit;
					const tip = document.getElementById('tooltip');
					updateTooltip(e, hit, tip);
					toggleTooltipPinned(tip, true);
					pinchange = true;
					this.zoomPixel = null; // Clear zoom pixel when clicking off a PoI

				} else if (this.pinnedTooltip) {
					this.pinnedTooltip = null;
					document.getElementById('tooltip').style.display = 'none';
					document.getElementById('tooltip').classList.remove('pinned');
					pinchange = true;
					this.zoomPixel = null; // Clear zoom pixel when clicking off a PoI
				}

				if (document.getElementById('debug-edge-noise').checked) {
					const rect = document.getElementById('view').getBoundingClientRect();
					this.debugX = Math.floor((e.clientX - rect.left - this.canvas.width / 2) / this.cam.z + this.cam.x - getWorldCenter(this.isNGP, this.gameMode) * 512);
					this.debugY = Math.floor((e.clientY - rect.top - this.canvas.height / 2) / this.cam.z + this.cam.y - 14 * 512);
					console.log(`Clicked at world coordinates: (${this.debugX}, ${this.debugY})`);
					this.debugCanvas = document.getElementById('debug-noise-canvas');
					this.debugCanvas.width = 512; 
					this.debugCanvas.height = 512;
					let dx = this.debugX - this.debugCanvas.width/2;
					let dy = this.debugY - this.debugCanvas.height/2;
					debugBiomeEdgeNoise(this.debugCanvas, dx, dy, false, this.gameMode);
					this.draw();
				}

				if (!pinchange && document.getElementById('local-search-mode').value !== 'off') {
					// TODO: Check if local search is already active and if so, maybe ask?
					if (isSearchActive()) {
						console.log('Search already active, ignoring local search click');
						// Not sure this is the best option, need to stop + clear results for existing search, but it's probably fine
					}
					else {
						const localSearchMode = document.getElementById('local-search-mode').value;
						//const localSearchRadius = parseInt(document.getElementById('search-radius-num').value) || 20;
						const rect = document.getElementById('view').getBoundingClientRect();
						const x = Math.floor((e.clientX - rect.left - this.canvas.width / 2) / this.cam.z + this.cam.x) + this.pw * 512 * getWorldSize(this.isNGP, this.gameMode) - getWorldCenter(this.isNGP, this.gameMode) * 512;
						const y = Math.floor((e.clientY - rect.top - this.canvas.height / 2) / this.cam.z + this.cam.y) + this.pwVertical * 512 * 48 - 14 * 512;
						console.log(`Performing local search at world coordinates: (${x}, ${y}) with mode ${localSearchMode}`);
						performLocalSearch(localSearchMode, x, y);
					}
				}
			}
		};
		
		this.canvas.onwheel = e => {
			e.preventDefault();
			const rect = vp.getBoundingClientRect();
			let mouseX = e.clientX - rect.left;
			let mouseY = e.clientY - rect.top;
			let wx = (mouseX - this.canvas.width/2)/this.cam.z + this.cam.x;
			let wy = (mouseY - this.canvas.height/2)/this.cam.z + this.cam.y;
			this.cam.z *= (e.deltaY > 0 ? 0.9 : 1.1);
			if (this.cam.z < MIN_CAM_Z) this.cam.z = MIN_CAM_Z;
			this.cam.x = wx - (mouseX - this.canvas.width/2)/this.cam.z;
			this.cam.y = wy - (mouseY - this.canvas.height/2)/this.cam.z;
			this.checkBounds();
			this.draw();
		};

		this.canvas.onmousemove = e => {
			if (this.drag.on) {
				this.cam.x -= (e.clientX - this.drag.lx)/this.cam.z;
				this.cam.y -= (e.clientY - this.drag.ly)/this.cam.z;
				this.drag.lx = e.clientX; 
				this.drag.ly = e.clientY;
				// Check for PW change
				let pwChange = {x: 0, y: 0};
				if (this.cam.x < 0 && this.pw > -getPWLimit(this.isNGP, this.gameMode)) {
					this.cam.x += getWorldSize(this.isNGP, this.gameMode) * 512;
					pwChange.x = -1;
				}
				if (this.cam.x > getWorldSize(this.isNGP, this.gameMode) * 512 && this.pw < getPWLimit(this.isNGP, this.gameMode)) {
					this.cam.x -= getWorldSize(this.isNGP, this.gameMode) * 512;
					pwChange.x = 1;
				}
				if (this.cam.y < 0 && this.pwVertical > -683) {
					this.cam.y += 512 * 48;
					pwChange.y = -1;
				}
				if (this.cam.y > 512 * 48 && this.pwVertical < 683) {
					this.cam.y -= 512 * 48;
					pwChange.y = 1;
				}
				if (pwChange.x !== 0 || pwChange.y !== 0) {
					// Clear highlighted PoIs *before* changing PW...
					// TODO: Don't want to cancel search but not sure what to do differently
					
					if (isSearchActive() && !document.getElementById('search-all-pw').checked) {
						clearHighlights(); // Clear without canceling
					}
					
					this.pw += pwChange.x;
					this.pwVertical += pwChange.y;
					// Can I do this without triggering the change events?
					document.getElementById('pw').value = this.pw;
					document.getElementById('pw-vertical').value = this.pwVertical;
					this.generate(false, false);
					// Attempt to re-search in new PW
					
					if (isSearchActive() && !document.getElementById('search-all-pw').checked) {
						performSearch(false, false);
					}
					
				}
				this.checkBounds();
				this.draw();
			}
			//if (!this.pinnedTooltip) 
			this.hover(e);
		};

		// Init search filters

		document.getElementById('search-ac').onchange = () => {
			const acInput = document.getElementById('search-ac');
			if (acInput.value.trim() !== "") {
				document.getElementById('search-ac-mode').value = 'must';
			}
			else {
				document.getElementById('search-ac-mode').value = 'any';
			}
		};
		document.getElementById('search-ac-mode').onchange = () => {
			const mode = document.getElementById('search-ac-mode').value;
			if (mode === 'none') {
				document.getElementById('search-ac').value = '';
			}
		};
		document.getElementById('local-search-mode').onchange = () => {
			const mode = document.getElementById('local-search-mode').value;
			const searchButton = document.getElementById('search-btn');
			if (mode === 'off') {
				document.getElementById('search-label').innerText = 'Search World (Global)';
				searchButton.innerText = 'Find';
				searchButton.disabled = false;
			}
			else {
				document.getElementById('search-label').innerText = 'Search Pixels (Local)';
				searchButton.innerText = 'Click Map';
				searchButton.disabled = true;
			}
			cancelSearch();
			document.getElementById('search-input').focus();
			this.draw(); // Clear highlights immediately on mode change
		};
		

		const copyBtn = document.getElementById('copy-path-btn');

		copyBtn.addEventListener('click', async () => {
			try {
				// Write to the system clipboard
				await navigator.clipboard.writeText("%USERPROFILE%\\AppData\\LocalLow\\Nolla_Games_Noita\\save00\\persistent\\flags");
				
				// UX Feedback: Change button text temporarily
				const originalText = copyBtn.innerText;
				copyBtn.innerText = 'Copied!';
				copyBtn.style.backgroundColor = '#4CAF50'; // Optional: make it green
				copyBtn.style.color = 'white';

				// Reset after 2 seconds
				setTimeout(() => {
					copyBtn.innerText = originalText;
					copyBtn.style.backgroundColor = '';
					copyBtn.style.color = '';
				}, 2000);

			} catch (err) {
				console.error('Failed to copy path: ', err);
				copyBtn.innerText = 'Error';
			}
		});

		// Spells/Cast (1 - 26)
		 this.initDualSlider('spells', 1, 34, 1);
		// Cast Delay (-0.33s - 1.0s)
		this.initDualSlider('delay', -20/60, 1.0, 1/60);
		// Recharge Time (0.0s - 4.0s)
		this.initDualSlider('rech', 0.0, 4.0, 1/60);
		// Mana Max (0 - 5250)
		this.initDualSlider('mana', 0, 5250, 10);
		// Mana Charge Speed (0 - 3025), adjusted for step=10
		this.initDualSlider('manarech', 0, 3030, 10);
		// Capacity (1 - 27+)
		this.initDualSlider('cap', 1, 66, 1);
		// Spread (-35 - 35 degrees)
		this.initDualSlider('spread', -35, 35, 1);
		// Speed multiplier (0.5x - 10x)
		this.initDualSlider('speed', 0.5, 10, 0.1);
		// Length (1 - 25 px)
		this.initDualSlider('len', 1, 25, 1);
		// Rarity (log 10, 1 - 9) (over 9 is always included)
		// This is another that a single slider makes more sense
		this.initDualSlider('rarity', 1.0, 9.0, 0.1);
		// Tier (P - 10NS)
		this.initDualListSlider('tier', WAND_TIERS);

		// Search radius
		//this.initSingleSlider('search-radius', 1, 1000, 1, 20);
	},

	setLoading(show, text = "Generating...") {
		const overlay = document.getElementById('loading-overlay');
		const loadingText = document.getElementById('loading-text');
		
		if (show) {
			loadingText.innerText = text;

			// If the overlay is already visible, don't touch the timers or visibility logic.
			if (overlay.style.display === 'flex') return;

			// Only start the timer if we aren't already showing and there isn't one pending.
			if (!this.loadingTimer) {
				this.loadingTimer = setTimeout(() => {
					overlay.style.display = 'flex';
					this.loadingTimer = null; // Clear reference once fired
				}, TIME_UNTIL_LOADING);
			}
		} else {
			// If we are hiding, kill any pending timer and hide the element immediately.
			if (this.loadingTimer) {
				clearTimeout(this.loadingTimer);
				this.loadingTimer = null;
			}
			overlay.style.display = 'none';
		}
	},

	initRegions() {
		const list = document.getElementById('regions-list');
		// TODO: Sort this better
		Object.keys(GENERATOR_CONFIG).forEach(key => {
			// Only include regions with tiles
			if (!GENERATOR_CONFIG[key].wangFile) return;
			const div = document.createElement('div');
			div.className = 'region-item';
			const cb = document.createElement('input');
			cb.type = 'checkbox'; cb.value = key; cb.id = `region-${key}`;
			cb.checked = GENERATOR_CONFIG[key].enabled;
			const label = document.createElement('label');
			label.htmlFor = `region-${key}`;
			label.innerText = GENERATOR_CONFIG[key].name;
			div.appendChild(cb); div.appendChild(label);
			list.appendChild(div);
			cb.onchange = () => {
				// Set enabled state in config based on checkbox
				GENERATOR_CONFIG[key].enabled = cb.checked;
				this.saveSettings();
				this.generate(true, true);
			};
		});
		document.getElementById('regions-all').onclick = () => {
			list.querySelectorAll('input').forEach(c => c.checked = true);
			for (const region of Object.keys(GENERATOR_CONFIG)) {
				GENERATOR_CONFIG[region].enabled = true;
			}
			this.saveSettings();
			this.generate(true, true);
		};
		document.getElementById('regions-useful').onclick = () => {
			// Get all "optional" regions
			for (const region of Object.keys(GENERATOR_CONFIG)) {
				const conf = GENERATOR_CONFIG[region];
				const cb = document.getElementById(`region-${region}`);
				if (!conf.optional) {
					cb.checked = true;
					GENERATOR_CONFIG[region].enabled = true;
				}
				else {
					cb.checked = false;
					GENERATOR_CONFIG[region].enabled = false;
				}
			}
			this.saveSettings();
			this.generate(true, true);
		};
		document.getElementById('regions-none').onclick = () => {
			list.querySelectorAll('input').forEach(c => c.checked = false);
			for (const region of Object.keys(GENERATOR_CONFIG)) {
				GENERATOR_CONFIG[region].enabled = false;
			}
			this.saveSettings();
			this.generate(true, true);
		};
	},

	initUnlocks() {
		const list = document.getElementById('unlocks-list');
		Object.keys(UNLOCKABLES).forEach(key => {
			const div = document.createElement('div');
			div.className = 'unlock-item';
			const cb = document.createElement('input');
			cb.type = 'checkbox'; cb.value = key; cb.id = `unlock-${key}`;
			const label = document.createElement('label');
			label.htmlFor = `unlock-${key}`;
			//label.innerText = key.split('_').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
			label.innerText = UNLOCK_DISPLAY_NAMES[key] || key;
			div.appendChild(cb); div.appendChild(label);
			list.appendChild(div);
			cb.onchange = () => {
				cancelSearch(); // Cancel any active search when changing unlocks since results may no longer be valid
				this.unlocksChanged = true;
				this.saveSettings();
				this.generate(false, true);
			};
		});
		document.getElementById('unlock-all').onclick = () => {
			cancelSearch(); // Cancel any active search when changing unlocks since results may no longer be valid
			this.unlocksChanged = true;
			list.querySelectorAll('input').forEach(c => c.checked = true);
			this.saveSettings();
			this.generate(false, true);
		};
		document.getElementById('unlock-none').onclick = () => {
			cancelSearch(); // Cancel any active search when changing unlocks since results may no longer be valid
			this.unlocksChanged = true;
			list.querySelectorAll('input').forEach(c => c.checked = false);
			this.saveSettings();
			this.generate(false, true);
		};
		// Generate function sets the unlocks based on the current state of the checkboxes, so no need to do it here
		setUnlocks([]); // Initialize with no unlocks (gets overwritten by loading settings)
	},

	initSingleSlider(idPrefix, minLimit, maxLimit, step = 1, initVal = null) {
		const range = document.getElementById(`${idPrefix}-range`);
		const num = document.getElementById(`${idPrefix}-num`);
		const container = range.parentElement;

		// Set default bounds and steps
		[range, num].forEach(el => {
			el.min = minLimit;
			el.max = maxLimit;
			el.step = step;
		});

		// Load initial value
		range.value = initVal !== null ? initVal : minLimit;

		const formatValue = (val) => {
			if (step >= 1) return Math.round(val);
			return parseFloat(parseFloat(val).toFixed(2));
		};

		function update() {
			const val = parseFloat(range.value);
			
			// Update text field
			num.value = formatValue(val);

			// Update visual track gradient (for CSS styling)
			const percent = ((val - minLimit) / (maxLimit - minLimit)) * 100;
			container.style.setProperty('--range-percent', `${percent}%`);
		}

		const validate = () => {
			let val = parseFloat(num.value);
			
			// Handle empty or invalid input
			if (isNaN(val)) val = minLimit;
			
			// Snap to step and clamp within limits
			val = Math.round(val / step) * step;
			if (val < minLimit) val = minLimit;
			if (val > maxLimit) val = maxLimit;

			range.value = val;
			update();
		};

		// Events for immediate slider updates
		range.addEventListener('input', update);

		// Events for number input (validation on blur or Enter)
		num.addEventListener('blur', validate);
		num.addEventListener('keydown', (e) => { 
			if (e.key === 'Enter') num.blur(); 
		});
		
		// UI Polish: auto-select text on click
		num.addEventListener('click', () => num.select());

		update(); // Initial Draw
	},

	// Dual Range Sliders
	/**
	 * Dual Range Slider Component
	 * @param {string} idPrefix - The ID prefix used in HTML
	 * @param {number} minLimit - Absolute minimum
	 * @param {number} maxLimit - Absolute maximum
	 * @param {number} step - Step size (e.g., 1 for capacity, 0.01666 for frames)
	 * @param {number} initMin - Initial start value
	 * @param {number} initMax - Initial end value
	 */
	initDualSlider(idPrefix, minLimit, maxLimit, step = 1, initMin = null, initMax = null) {
		const minRange = document.getElementById(`${idPrefix}-min-range`);
		const maxRange = document.getElementById(`${idPrefix}-max-range`);
		const minNum = document.getElementById(`${idPrefix}-min-num`);
		const maxNum = document.getElementById(`${idPrefix}-max-num`);
		const container = minRange.parentElement;

		// Set default bounds and steps
		[minRange, maxRange, minNum, maxNum].forEach(el => {
			el.min = minLimit;
			el.max = maxLimit;
			el.step = step;
		});

		// Load initial values without triggering bounds clobbering
		minRange.value = initMin !== null ? initMin : minLimit;
		maxRange.value = initMax !== null ? initMax : maxLimit;

		const formatValue = (val) => {
			if (step >= 1) return Math.round(val);
			return parseFloat(parseFloat(val).toFixed(2));
		};

		function update(caller) {
			let valMin = parseFloat(minRange.value);
			let valMax = parseFloat(maxRange.value);

			// Independent Bounds Checking (Stops handles from crossing)
			if (caller === 'min' && valMin > valMax) {
			minRange.value = valMax;
			valMin = valMax;
			} else if (caller === 'max' && valMax < valMin) {
			maxRange.value = valMin;
			valMax = valMin;
			}

			// Update text fields
			minNum.value = formatValue(valMin);
			maxNum.value = formatValue(valMax);

			// Update visual track gradient
			const percentStart = ((valMin - minLimit) / (maxLimit - minLimit)) * 100;
			const percentEnd = ((valMax - minLimit) / (maxLimit - minLimit)) * 100;
			container.style.setProperty('--range-start', `${percentStart}%`);
			container.style.setProperty('--range-end', `${percentEnd}%`);
		}

		// --- Proximity Radar: Fixes interaction when handles are stacked ---
		container.addEventListener('mousemove', (e) => {
			const rect = container.getBoundingClientRect();
			const pos = (e.clientX - rect.left) / rect.width;
			const val = minLimit + (maxLimit - minLimit) * pos;
			
			const distMin = Math.abs(val - parseFloat(minRange.value) + 0.01);
			const distMax = Math.abs(val - parseFloat(maxRange.value) - 0.01);

			// Bring the closer thumb to the front so it can be grabbed
			minRange.style.zIndex = distMin < distMax ? "11" : "10";
			maxRange.style.zIndex = distMax <= distMin ? "11" : "10";
		});

		// --- Validation & Interaction ---
		const validate = (el, isMin) => {
			let val = parseFloat(el.value);
			if (isNaN(val)) val = isMin ? minLimit : maxLimit;
			
			// Snap to step and clamp
			val = Math.round(val / step) * step;
			if (val < minLimit) val = minLimit;
			if (val > maxLimit) val = maxLimit;

			if (isMin) {
			if (val > parseFloat(maxRange.value)) val = parseFloat(maxRange.value);
			minRange.value = val;
			update('min');
			} else {
			if (val < parseFloat(minRange.value)) val = parseFloat(minRange.value);
			maxRange.value = val;
			update('max');
			}
		};

		minRange.addEventListener('input', () => update('min'));
		maxRange.addEventListener('input', () => update('max'));
		minNum.addEventListener('blur', () => validate(minNum, true));
		maxNum.addEventListener('blur', () => validate(maxNum, false));
		minNum.addEventListener('click', () => minNum.select());
		maxNum.addEventListener('click', () => maxNum.select());
		
		[minNum, maxNum].forEach(el => {
			el.addEventListener('keydown', (e) => { if (e.key === 'Enter') el.blur(); });
		});

		update(); // Initial Draw
	},

	/**
	 * Dual Range List Slider Component
	 * @param {string} idPrefix - The ID prefix used in HTML
	 * @param {string[]} values - Ordered array of labels
	 */
	initDualListSlider(idPrefix, values) {
		const maxIdx = values.length - 1;
		const minRange = document.getElementById(`${idPrefix}-min-range`);
		const maxRange = document.getElementById(`${idPrefix}-max-range`);
		const minLabel = document.getElementById(`${idPrefix}-min-label`);
		const maxLabel = document.getElementById(`${idPrefix}-max-label`);
		const container = minRange.parentElement;

		[minRange, maxRange].forEach(el => {
			el.min = 0;
			el.max = maxIdx;
			el.step = 1;
		});

		minRange.value = 0;
		maxRange.value = maxIdx;

		function update(caller) {
			let valMin = parseInt(minRange.value);
			let valMax = parseInt(maxRange.value);

			if (caller === 'min' && valMin > valMax) {
			minRange.value = valMax;
			valMin = valMax;
			} else if (caller === 'max' && valMax < valMin) {
			maxRange.value = valMin;
			valMax = valMin;
			}

			minLabel.value = values[valMin];
			maxLabel.value = values[valMax];

			const percentStart = (valMin / maxIdx) * 100;
			const percentEnd = (valMax / maxIdx) * 100;
			container.style.setProperty('--range-start', `${percentStart}%`);
			container.style.setProperty('--range-end', `${percentEnd}%`);
		}

		container.addEventListener('mousemove', (e) => {
			const rect = container.getBoundingClientRect();
			const pos = (e.clientX - rect.left) / rect.width;
			const val = pos * maxIdx;

			const distMin = Math.abs(val - parseInt(minRange.value) + 0.01);
			const distMax = Math.abs(val - parseInt(maxRange.value) - 0.01);

			minRange.style.zIndex = distMin < distMax ? "11" : "10";
			maxRange.style.zIndex = distMax <= distMin ? "11" : "10";
		});

		const validate = (el, isMin) => {
			const typed = el.value.trim().toUpperCase();
			const idx = values.findIndex(t => t.toUpperCase() === typed);

			if (idx === -1) {
			el.value = values[parseInt(isMin ? minRange.value : maxRange.value)];
			return;
			}

			if (isMin) {
			if (idx > parseInt(maxRange.value)) maxRange.value = idx;
			minRange.value = idx;
			update('min');
			} else {
			if (idx < parseInt(minRange.value)) minRange.value = idx;
			maxRange.value = idx;
			update('max');
			}
		};

		minRange.addEventListener('input', () => update('min'));
		maxRange.addEventListener('input', () => update('max'));
		minLabel.addEventListener('blur', () => validate(minLabel, true));
		maxLabel.addEventListener('blur', () => validate(maxLabel, false));
		minLabel.addEventListener('click', () => minLabel.select());
		maxLabel.addEventListener('click', () => maxLabel.select());

		[minLabel, maxLabel].forEach(el => {
			el.addEventListener('keydown', (e) => { if (e.key === 'Enter') el.blur(); });
		});

		update();
	},

	getHitObject(e) {
		if (!this.biomeData) return null;
		if (document.getElementById('debug-hide-pois').checked) return null;
		const rect = document.getElementById('view').getBoundingClientRect();
		const wx = (e.clientX - rect.left - this.canvas.width / 2) / this.cam.z + this.cam.x;
		const wy = (e.clientY - rect.top - this.canvas.height / 2) / this.cam.z + this.cam.y;

		// Incidentally, don't need to compute this anymore...
		//const [mousePWX, mousePWY] = getPWIndices(wx, wy, this.pw, this.pwVertical, this.isNGP, this.gameMode);
		// Check cached PoIs for the current Parallel World
		for (const worldKey of this.worldsInView) {
			// Add a quick bounds check before doing the more expensive distance calculation
			const [pwX, pwY] = worldKey.split(',').map(Number);
			// Fix for the very edge case bug in NG+/nightmare where the shift can cause biomes to move into the adjacent PW
			// Not a great fix, since it makes it a bit less efficient...
			//if (mousePWX !== pwX || mousePWY !== pwY) continue;

			const shiftX = pwX * 512 * this.w - this.pw * 512 * this.w;
			const shiftY = pwY * 24576 - this.pwVertical * 24576;

			// Check Orbs only in the main vertical world.
			let hit = null;
			if (pwY === 0) {
				hit = this.biomeData.orbs.find(o => {
					const ox = (o.x + 0.5) * BIOME_CONFIG.CHUNK_SIZE + shiftX;
					const oy = (o.y + 0.5) * BIOME_CONFIG.CHUNK_SIZE + shiftY;
					return Math.sqrt((ox - wx) ** 2 + (oy - wy) ** 2) < BIOME_CONFIG.CHUNK_SIZE / 2;
				});
			}

			if (hit) {
				return {...hit, x: hit.x + this.w*pwX};
			}

			const currentPois = this.poisByPW[`${pwX},${pwY}`];
			if (!currentPois) continue;
			const poiHit = currentPois.find(p => {
				const px = p.x + getWorldCenter(this.isNGP, this.gameMode) * 512 - this.pw * 512 * this.w;
				const py = p.y + 14 * 512 - this.pwVertical * 24576;
				let tempRadius = getPoiRadius(p, this.cam.z);
				if (document.getElementById('debug-small-pois').checked) {
					tempRadius = 5.0;
				}
				return Math.sqrt((px - wx) ** 2 + (py - wy) ** 2) < tempRadius;
			});
			if (poiHit) return poiHit;
		}
		return null;
	},

	hover(e) {
		if (this.biomeData) {
			this.lastHoverEvent = e;
			const rect = document.getElementById('view').getBoundingClientRect();
			const wx = (e.clientX - rect.left - this.canvas.width/2) / this.cam.z + this.cam.x;
			const wy = (e.clientY - rect.top - this.canvas.height/2) / this.cam.z + this.cam.y;

			const coordsDiv = document.getElementById('coords');
			coordsDiv.style.display = 'block';
			coordsDiv.style.left = (e.clientX - rect.left + 15) + 'px';
			coordsDiv.style.top = (e.clientY - rect.top - 25) + 'px';

			// Absolute coordinate math
			const absX = Math.floor(wx - 512*getWorldCenter(this.isNGP, this.gameMode)) + (this.pw * 512 * getWorldSize(this.isNGP, this.gameMode));
			const absY = Math.floor(wy - 512*14 + (this.pwVertical * 512 * 48));
			coordsDiv.innerHTML = this.pixelInfoLines(absX, absY,
				Math.floor(e.clientX - rect.left), Math.floor(e.clientY - rect.top)).join('<br>');
			coordsDiv.classList.remove('copied');

			if (this.pinnedTooltip) return; // Don't update tooltip on hover if one is pinned

			const hit = this.getHitObject(e);
			const tip = document.getElementById('tooltip');
			if (!hit) {
				if (!this.pinnedTooltip) tip.style.display = 'none';
				return;
			}
			updateTooltip(e, hit, tip);
			toggleTooltipPinned(tip, false);
		}
	},

	// The composited color under the cursor: the GL terrain pass renders to its own
	// offscreen canvas that drawNow() blits into the main one, so the main context
	// holds the final pixel of every layer.
	//
	// It is NEVER read with getImageData on the main canvas. Chrome counts those
	// readbacks and, after a handful, permanently drops the canvas to software
	// rasterization -- measured here as every later frame going from ~1 ms to
	// 30 ms (350 ms zoomed out), for the rest of the session, drag or no drag.
	// Instead the pixel is copied into a 1x1 CPU-backed scratch canvas (the same
	// trick edge_decal_layer.js uses) and read from there, and even that is
	// deferred: nothing is read while dragging, and a still cursor gets its swatch
	// ~80 ms after the frame settles. Until the deferred read lands the tooltip
	// simply has no color line.
	displayedColorAt(canvasX, canvasY) {
		if (canvasX < 0 || canvasY < 0 || canvasX >= this.canvas.width || canvasY >= this.canvas.height) return null;
		const probe = this.colorProbe;
		if (probe.x === canvasX && probe.y === canvasY) return probe.rgb;
		if (this.drag.on) return null;
		probe.wantX = canvasX;
		probe.wantY = canvasY;
		if (!probe.timer) {
			probe.timer = setTimeout(() => {
				probe.timer = 0;
				if (this.drag.on || !this.lastHoverEvent) return;
				if (!probe.ctx) {
					const c = document.createElement('canvas');
					c.width = 1;
					c.height = 1;
					probe.ctx = c.getContext('2d', { willReadFrequently: true });
				}
				probe.ctx.clearRect(0, 0, 1, 1);
				probe.ctx.drawImage(this.canvas, probe.wantX, probe.wantY, 1, 1, 0, 0, 1, 1);
				const d = probe.ctx.getImageData(0, 0, 1, 1).data;
				probe.x = probe.wantX;
				probe.y = probe.wantY;
				probe.rgb = (d[0] << 16) | (d[1] << 8) | d[2];
				// Re-run the tooltip for the cursor's last position; it now hits the cache.
				this.hover(this.lastHoverEvent);
			}, 80);
		}
		return null;
	},

	// The decal texel under the cursor, deferred exactly like displayedColorAt:
	// edge_decal_layer.js edgeDecalAt draws a GPU-resident tile bitmap into a
	// CPU canvas, which waits for every queued GPU command first -- 13-17 ms per
	// mousemove while a drag keeps the GPU busy (measured: it was the whole
	// input cost at 1:1). So nothing is read while dragging, and a still cursor
	// gets its decal line ~80 ms after the frame settles.
	decalTexelAt(absX, absY) {
		const probe = this.decalProbe;
		if (probe.x === absX && probe.y === absY && probe.frame === this.frameSerial) return probe.value;
		if (this.drag.on) return null;
		probe.wantX = absX;
		probe.wantY = absY;
		if (!probe.timer) {
			probe.timer = setTimeout(() => {
				probe.timer = 0;
				if (this.drag.on || !this.lastHoverEvent) return;
				probe.value = edgeDecalAt(probe.wantX, probe.wantY);
				probe.x = probe.wantX;
				probe.y = probe.wantY;
				probe.frame = this.frameSerial;
				this.hover(this.lastHoverEvent);
			}, 80);
		}
		return null;
	},

	// One tooltip line per fact about the hovered world pixel: what it is, which
	// pipeline stage painted it, and what that paint was sampled from. Runs per
	// mousemove, so every lookup here is O(1) against data the draw path already
	// built -- no scene, atlas or overlay rebuilds.
	pixelInfoLines(absX, absY, canvasX, canvasY) {
		const lines = [`${absX}, ${absY}`];
		// The world identity, so a copied block is unambiguous on its own.
		lines.push(`Seed: ${this.seed}${this.ngPlusCount > 0 ? ` NG+${this.ngPlusCount}` : ''}`
			+ (this.gameMode === 'nightmare' ? ' (nightmare)' : ''));

		// Get biome
		const biomeResult = getBiomeAtWorldCoordinates(this.biomeData, absX, absY, this.isNGP, this.gameMode, appSettings.enableEdgeNoise);
		if (biomeResult && biomeResult.biome) {
			// For the display name, let's just use the generator config
			lines.push(`Biome: ${GENERATOR_CONFIG[biomeResult.biome]?.name || biomeResult.biome}`);
			if (this.biomeModifiers && this.biomeModifiers[biomeResult.biome]) {
				const biomeModifier = this.biomeModifiers[biomeResult.biome];
				lines.push(`Modifier: ${getDisplayName(biomeModifier.id)}`);
				if (biomeModifier.requires_flag) lines.push(`(requires flag: ${biomeModifier.requires_flag})`);
			}
		}

		const rgb = this.displayedColorAt(canvasX, canvasY);
		if (rgb !== null) {
			const hex = rgb.toString(16).padStart(6, '0');
			lines.push(`Color: <span class="coords-swatch" style="background:#${hex}"></span> #${hex}`);
		}

		let prov = null;
		if (this.tileLayers && this.tileLayers.length > 0 && this.pixelScenesByPW && this.pixelScenesByPW[`${this.pw},${this.pwVertical}`]) {
			// Get material, and which stage painted it
			prov = getMaterialProvenanceAtWorldCoordinates(this.tileLayers, this.pixelScenesByPW[`${this.pw},${this.pwVertical}`], absX, absY, this.pw, this.pwVertical, this.isNGP, this.gameMode);
		}
		let material = prov ? prov.material : null;
		let source = prov ? prov.source : null;
		// Fill biomes (solid_wall etc.) have no layer.buffer to sample, so
		// answer from the wobble-resolved chunk color. Last so real layer or
		// pixel-scene content always wins. FILL_LAYER_MATERIALS, not
		// FILL_BIOME_MATERIALS: a `sceneOnly` room's chunk is air wherever its
		// scene does not cover it, so naming its material there would be a lie.
		if (!material && biomeResult) {
			material = FILL_LAYER_MATERIALS[biomeResult.colorInt] ?? null;
			if (material) source = 'fill';
		}
		if (material) {
			const displayName = getDisplayName(material);
			const alpha = materialAlpha(material);
			lines.push(`Material: ${displayName === material ? material : `${displayName} (${material})`}`
				+ (alpha < 255 ? ` alpha ${alpha}/255` : ''));
		}

		this.pushOriginLines(lines, prov, source);
		this.pushTextureLines(lines, material, absX, absY);
		if (biomeResult) lines.push(`Chunk: ${biomeResult.pos.x},${biomeResult.pos.y} ${this.chunkPaintState(biomeResult)}`);

		// Edge decals bake into the engine's cell colors, so a decal texel sits on
		// top of whatever the origin above painted.
		const decal = (appSettings.edgeDecals && appSettings.engineTerrain
			&& appSettings.terrainRenderer === 'gl') ? this.decalTexelAt(absX, absY) : null;
		if (decal && decal.a > 0) {
			const dhex = ((decal.r << 16) | (decal.g << 8) | decal.b).toString(16).padStart(6, '0');
			lines.push(`Decal: <span class="coords-swatch" style="background:#${dhex}"></span> #${dhex}`
				+ (decal.a < 255 ? ` a${decal.a}` : '') + ` (tile ${decal.tx},${decal.ty})`);
		}
		return lines;
	},

	// "What painted this pixel": the pipeline stage that answered, and where in
	// that stage's source image the pixel sits.
	pushOriginLines(lines, prov, source) {
		if (source === 'scene') {
			const scene = prov.scene;
			const data = PIXEL_SCENE_DATA[scene.key];
			lines.push(`Origin: scene ${scene.key} @ ${scene.localX},${scene.localY}`);
			if (data) lines.push(`Image: data/pixel_scenes/${data.dir}/${data.name}.png`);
			if (scene.variantKey) lines.push(`Variant: ${scene.variantKey}`);
			// The scene's white/gray class is not a material colour: it is "fill
			// with this biome's own material", resolved through the biome's
			// <MaterialComponent> bands at density 1.0. Say so, and say which
			// biome answered -- for a pseudo-biome folder that is the chunk's.
			if (prov.densityClass) {
				lines.push(prov.densityClass.via === 'bands'
					? `Class: density 1.0 through ${prov.densityClass.biomeName} bands`
					: `Class: density 1.0 -> ${prov.densityClass.biomeName} fill material`);
			}
			// The colors-file cell-color override only applies where its alpha is
			// >= 128; artMask is that test, bit-packed MSB-first at load time. The
			// file is usually <name>_visual.png, but a good number of scenes are
			// painted with a sibling's art, so the loader records which it read.
			if (data && data.artMask) {
				const p = scene.localY * data.width + scene.localX;
				const covered = (data.artMask[p >> 3] & (0x80 >> (p & 7))) !== 0;
				const artFile = `${data.artName ?? `${data.name}_visual`}.png`;
				lines.push(covered
					? `Art: visual override (${artFile})`
					: `Art: material color (${artFile} does not cover)`);
			}
		}
		else if (source === 'layer') {
			lines.push(`Origin: ${prov.layer.kind} layer ${prov.layer.biomeName} @ ${prov.layer.localX},${prov.layer.localY}`);
		}
		else if (source === 'fill') {
			// Fill biomes have no per-pixel source image: the whole chunk is one material.
			lines.push(`Origin: chunk fill${prov && prov.fillLayer ? ` (${prov.fillLayer.biomeName})` : ''}`);
		}
		else {
			// Nothing painted the cell; the Chunk line below says whether that is the
			// engine pass answering "air here" or a chunk telescope never generates.
			lines.push('Origin: air');
		}
		// A scene footprint the pixel falls inside but which painted nothing here.
		// A density-class pixel whose band table accepted nothing is a different
		// thing from a transparent one: the scene DID answer, and the answer was
		// air -- which is what lets a room's background art show through its floor.
		if (source !== 'scene' && prov && prov.coveringScene) {
			const scene = prov.coveringScene;
			lines.push(`In scene: ${scene.key} @ ${scene.localX},${scene.localY} `
				+ (prov.densityClass
					? `(density class -> air, ${prov.densityClass.biomeName} bands)`
					: '(transparent here)'));
		}
	},

	// How the chunk this pixel sits in gets painted: which engine-resolve mode the
	// GL pass runs for it, or whether nothing paints it at all (the checkerboard
	// buildUnpaintedMask() marks).
	chunkPaintState(biomeResult) {
		if (!biomeResult) return 'unknown chunk';
		const idx = biomeResult.pos.y * this.w + biomeResult.pos.x;
		const modes = (appSettings.engineTerrain && this.glTerrain
			&& this.glTerrain.engineChunkWidth === this.w) ? this.glTerrain.engineChunkModes : null;
		if (modes && idx < modes.length) {
			// Bit 11 (gl/engine_resources.js): a BIOME_WANG_TILE biome with an empty
			// wang_template_file. It gets no covergrid and generates no terrain at
			// all, so the topology-0 mode it also carries is meaningless -- saying
			// "engine topo0" here claimed a resolve that answers air by construction
			// (topo0_resolve.js `if (biome.paintsNothing) return -1`).
			if (modes[idx] & (1 << 11)) return 'engine: no terrain (scene-only)';
			const mode = (modes[idx] >> 8) & 3;
			if (mode !== ENGINE_MODE_FALLBACK) return `engine ${mode === ENGINE_MODE_TOPO2 ? 'topo2' : 'topo0'}`;
		}
		// The measured members of the same class the engine table does not carry:
		// generator_config.js flags a biome `sceneOnly` from a live dump that the
		// table calls BIOME_PROCEDURAL (boss_arena today). buildUnpaintedMask()
		// already counts those chunks as covered, so without this they read as a
		// 'layer fallback' they have no layer for.
		if (SCENE_ONLY_COLORS.has(biomeResult.colorInt)) return 'engine: no terrain (scene-only)';
		if (this.unpaintedCovered && idx < this.unpaintedCovered.length && !this.unpaintedCovered[idx]) {
			return 'unpainted (checkerboard)';
		}
		return modes ? 'layer fallback' : 'layer pipeline';
	},

	// The engine bakes a cell's color from its material texture at the cell's own
	// absolute world coordinates (material_atlas.js), so a textured material's
	// pixel identity is the texture file plus that texel.
	pushTextureLines(lines, material, absX, absY) {
		if (!material) return;
		const data = MATERIAL_BY_NAME.get(material);
		if (!data) return;
		const flatHex = (parseInt(data.texture_color, 16) & 0xffffff).toString(16).padStart(6, '0');
		if (!data.texture) {
			lines.push(`Texture: flat <span class="coords-swatch" style="background:#${flatHex}"></span> #${flatHex} (texture_color)`);
			return;
		}
		// The detail pass is off below MATERIAL_DETAIL_MIN_ZOOM (sub-pixel texels
		// only alias), so what is actually on screen is the flat color instead.
		const detailOff = !(appSettings.materialTextures && appSettings.recolorMaterials
			&& this.detailZoom() >= MATERIAL_DETAIL_MIN_ZOOM);
		const flatNote = detailOff ? `, drawn flat #${flatHex}` : '';
		// The atlas is fetched by the GL renderer; kick it off if the CPU bake is
		// the active path so the texel coords appear on a later hover.
		const atlas = getMaterialAtlas();
		const entry = atlas ? materialAtlasEntry(atlas, material) : 0;
		if (!entry) {
			if (!atlas) initMaterialAtlas().catch(() => {});
			lines.push(`Texture: ${data.texture}${flatNote}`);
			return;
		}
		const texel = materialTexelInfo(atlas, entry, absX, absY);
		const texelHex = (texel.rgba & 0xffffff).toString(16).padStart(6, '0');
		const swatch = texel.rgba < 0 ? '(transparent texel)'
			: `<span class="coords-swatch" style="background:#${texelHex}"></span> #${texelHex}`;
		lines.push(`Texture: ${data.texture} ${texel.w}x${texel.h} @ ${texel.texelX},${texel.texelY} ${swatch}${flatNote}`);
	},

	// Copies the hover tooltip's plain text, with a brief flash on the tooltip.
	// Called from the mouseup click path, so it only runs for a real click on the
	// map that did not hit a PoI.
	async copyCoordsTooltip() {
		const coordsDiv = document.getElementById('coords');
		if (!coordsDiv || coordsDiv.style.display === 'none') return;
		const text = coordsDiv.innerText;
		if (!text) return;
		try {
			await navigator.clipboard.writeText(text);
		} catch {
			// No clipboard permission (or a non-secure context): the old selection trick
			const area = document.createElement('textarea');
			area.value = text;
			area.style.position = 'fixed';
			area.style.opacity = '0';
			document.body.appendChild(area);
			area.select();
			try { document.execCommand('copy'); } catch { /* nothing else to try */ }
			area.remove();
		}
		coordsDiv.classList.add('copied');
		clearTimeout(this.copyFlashTimer);
		this.copyFlashTimer = setTimeout(() => coordsDiv.classList.remove('copied'), 900);
	},

	async preload() {
		this.setLoading(true, "Loading Assets...");
		try {
			this.loadSettings();
			await loadTranslations();
			try {
				this.baseBiomeMapNG0 = await loadPNG('../data/biome_maps/biome_map.png');
				this.baseBiomeMapNGP = await loadPNG('../data/biome_maps/biome_map_newgame_plus.png');
				this.baseBiomeMapNightmare = await loadPNG('../data/biome_maps/biome_map_nightmare.png');
			} catch(e) { console.error("Base assets failed to load."); console.error(e); }
			console.log("Loading pixel scene data...");
			await loadPixelSceneData();
			// The hover readout found a scene whose pixels were not decoded yet.
			setScenePixelsListener(() => {
				if (this.lastHoverEvent && document.getElementById('coords').style.display === 'block') {
					this.hover(this.lastHoverEvent);
				}
			});

			if (appSettings.customArt) {
				try {
					await this.getSurfaceOverlays();
				} catch (e) { console.error("Custom art failed to load:", e); }
			}
			// Queue up the main few worlds for loading
			this.worldsInView = new Set(['0,0']);
		} finally {
			this.setLoading(false);
		}
	},

	// Could probably default rescan to true if tiles is true
	async generate(tiles, rescan) {
		// Temporarily disable the button to prevent multiple clicks during generation, will be re-enabled at the end
		document.getElementById('gen-btn').disabled = true;
		document.getElementById('gen-btn').innerText = "Generating...";
		document.getElementById('seed').disabled = true;
		document.getElementById('ng').disabled = true;
		document.getElementById('pw').disabled = true;
		document.getElementById('pw-vertical').disabled = true;
		if (this.unlocksChanged) tiles = true; // Just regenerate everything ugh
		this.setLoading(true, tiles ?  "Generating Tiles..." : "Scanning Parallel World..." );

		const seedVal = parseInt(document.getElementById('seed').value);
		this.seed = seedVal;
		const ngVal = parseInt(document.getElementById('ng').value);
		this.ngPlusCount = ngVal;
		this.pw = parseInt(document.getElementById('pw').value) || 0;
		this.pwVertical = parseInt(document.getElementById('pw-vertical').value) || 0;
		this.isNGP = ngVal > 0;
		this.gameMode = document.getElementById('game-mode').value;

		if (tiles) {
			// Reset existing tile and spawn data since we're doing a full generation, and we don't want old data hanging around
			this.tileLayers = null;
			this.unpaintedMask = null;
			this.unpaintedChunkCount = 0;
			this.pixelScenesByPW = {};
			this.poisByPW = {};
			this.tileOverlaysByPW = {};
			invalidateEdgeDecals();
			this.worldsInView = new Set(['0,0']);
			// If generating tiles for the first time, reset the position so that the overlays are actually generated properly!
			this.pw = 0;
			this.pwVertical = 0;
			document.getElementById('pw').value = 0;
			document.getElementById('pw-vertical').value = 0;
			this.cam.x = CHUNK_SIZE*getWorldCenter(this.isNGP, this.gameMode);
			this.cam.y = CHUNK_SIZE*24;
			this.cam.z = 0.0625;

			
			// Adding a small extra delay causes it to actually appear
			await new Promise(resolve => setTimeout(resolve, TIME_UNTIL_LOADING + 25));
		}
		
		const btn = document.getElementById('gen-btn');
		btn.disabled = true;
		btn.innerText = tiles ? "Generating Tiles..." : "Scanning Parallel World...";

		const t0 = performance.now();

		// Set limits on PWs
		document.getElementById('search-pw-limit').max = getPWLimit(this.isNGP, this.gameMode);
		if (document.getElementById('search-pw-limit').value > getPWLimit(this.isNGP, this.gameMode)) {
			document.getElementById('search-pw-limit').value = getPWLimit(this.isNGP, this.gameMode);
		}
		if (this.pw > getPWLimit(this.isNGP, this.gameMode)) {
			this.pw = getPWLimit(this.isNGP, this.gameMode);
			document.getElementById('pw').value = getPWLimit(this.isNGP, this.gameMode);
		}
		else if (this.pw < -getPWLimit(this.isNGP, this.gameMode)) {
			this.pw = -getPWLimit(this.isNGP, this.gameMode);
			document.getElementById('pw').value = -getPWLimit(this.isNGP, this.gameMode);
		}

		if (this.pwVertical > 683) {
			this.pwVertical = 683;
			document.getElementById('pw-vertical').value = 683;
		}
		else if (this.pwVertical < -683) {
			this.pwVertical = -683;
			document.getElementById('pw-vertical').value = -683;
		}

		// Update unlocks (should probably add something to check if they changed to save a bit)
		if (this.unlocksChanged) {
			const checkedUnlocks = [];
			//document.querySelectorAll('#unlocks-list input:checked').forEach(c => checkedUnlocks.push(c.value));
			for (const unlock of Object.keys(UNLOCKABLES)) {
				if (appSettings[`unlock_${unlock}`]) {
					checkedUnlocks.push(unlock);
				}
			}
			setUnlocks(checkedUnlocks);
			rescan = true; // If unlocks changed, we need to rescan spawn functions even if tiles didn't change, since some spawns are gated behind unlocks
			this.unlocksChanged = false; // Reset flag
		}

		// 1. FULL GENERATION (Only if seed/NG changed)
		if (tiles) {
			//const noMoreShuffle = this.perks['noMoreShuffle'] || false;
			const base = (this.isNGP ? this.baseBiomeMapNGP.data : (this.gameMode === 'nightmare' ? this.baseBiomeMapNightmare.data : this.baseBiomeMapNG0.data));
			if (!base) {
				this.setLoading(false);
				return;
			}

			this.w = (this.isNGP || this.gameMode === 'nightmare' ? BIOME_CONFIG.W_NGP : BIOME_CONFIG.W_NG0); // This is redundant
			this.h = (this.isNGP || this.gameMode === 'nightmare' ? BIOME_CONFIG.H_NGP : BIOME_CONFIG.H_NG0); // This is redundant

			this.biomeData = generateBiomeData(seedVal, ngVal, this.gameMode, base, this.w, this.h);
			this.renderOffscreen();
			this.renderRecolorMap();

			for (let k in GENERATOR_CONFIG) {
				if (GENERATOR_CONFIG[k].enabled && !GENERATOR_CONFIG[k].wangData && GENERATOR_CONFIG[k].wangFile) {
					GENERATOR_CONFIG[k].wangData = await loadPNG(GENERATOR_CONFIG[k].wangFile);
				}
			}

			// generateBiomeTiles now returns layers with empty poisByPW caches
			let global_extra_rerolls = 0;
			if (document.getElementById('debug-extra-rerolls').value > 0) global_extra_rerolls = parseInt(document.getElementById('debug-extra-rerolls').value);
			this.tileLayers = await generateBiomeTiles(
				this.biomeData.pixels, this.w, this.h, 
				GENERATOR_CONFIG, seedVal, ngVal,
				global_extra_rerolls,
				this.gameMode,
			);

			// No longer used
			for (let layer of this.tileLayers) {
				// Initialize
				layer.pixelScenesByPW = {};
			}

			// Initialize fixed random spawns...
			// Like hiisi hourglass position, to avoid needing to mess with them elsewhere
			const prng = new NollaPrng(seedVal); // Not in NG+ so don't worry about it
			const is_right = prng.ProceduralRandom(seedVal, 0, 0) > 0.5;
			this.hiisiHourglassPosition = is_right ? 'right' : 'left';

			// Create recolored background (TODO: does this need to be done here?)
			this.renderRecolorMap();
			this.biomeMapAlphaMask = createBiomeMapAlphaMask(this.biomeData, getWorldSize(this.isNGP, this.gameMode), 48);
			// Chunk coverage of the generated tile layers, for the unpainted-region checkerboard
			this.buildUnpaintedMask();

			// Prescan spawn functions for generated tiles, only needs to be done once per seed/NG+ combination, not every time PW or perks change
			this.tileSpawns = prescanSpawnFunctions(this.tileLayers, this.isNGP, this.gameMode);
			// Reset spawns
			this.pixelScenesByPW = {};
			this.poisByPW = {};
			this.tileOverlaysByPW = {};
			invalidateEdgeDecals();

			//console.log("Synching data to workers...");
			syncSearchWorkerData();
			syncWorldWorkerData();
			syncOverlayWorkerData();
			//console.log("Synced data to workers.");

			// Do initial overlay generation just for the main world since we need it for the initial render.
			// Other worlds can be handled by workers asynchronously. The GL pass draws
			// terrain without overlays, so skip this ~1 s main-thread build under it;
			// if GL falls back later, the CPU draw loop requests them.
			const biomeOverlayMode = document.getElementById('debug-biome-overlay-mode').value;
			const glTerrainUsable = appSettings.terrainRenderer === 'gl'
				&& !this.glTerrain?.failed && !this.glTerrain?.contextLost;
			if (!glTerrainUsable && !this.tileOverlaysByPW[`0,0`]) {
				let recolorMapUsed = this.recolorOffscreenBuffer;
				if (biomeOverlayMode === 'expanded') {
					this.tileOverlaysByPW[`0,0`] = createTileOverlaysExpanded(this.biomeData, recolorMapUsed, this.tileLayers, 0, 0, this.isNGP, this.gameMode);
				}
				else if (biomeOverlayMode === 'normal') {
					this.tileOverlaysByPW[`0,0`] = createTileOverlays(this.biomeData, recolorMapUsed, this.tileLayers, 0, 0, this.isNGP, this.gameMode);
				}
				else {
					this.tileOverlaysByPW[`0,0`] = createTileOverlaysCheap(this.biomeData, this.tileLayers, 0, 0, this.isNGP, this.gameMode);
				}
			}
		}

		if (rescan) cancelSearch(); // Cancel any active search when changing perks (might need to adjust this later)

		// 2. SPAWN FUNCTION SCANNING

		if (rescan || !this.pixelScenesByPW[`${this.pw},${this.pwVertical}`] || !this.poisByPW[`${this.pw},${this.pwVertical}`]) {
			const scanResults = scanSpawnFunctions(this.biomeData, this.tileSpawns, this.seed, this.ngPlusCount, this.pw, this.pwVertical, appSettings.skipCosmeticScenes, this.perks, this.gameMode);
			this.pixelScenesByPW[`${this.pw},${this.pwVertical}`] = scanResults.finalPixelScenes;
			const specialPoIs = getSpecialPoIs(this.biomeData, this.seed, this.ngPlusCount, this.pw, this.pwVertical, this.perks, this.gameMode);
			this.poisByPW[`${this.pw},${this.pwVertical}`] = scanResults.generatedSpawns.concat(specialPoIs);
		
			// Static pixel scenes
			if (appSettings.enableStaticPixelScenes !== 'off') {
				const staticPixelScenesResults = addStaticPixelScenes(this.seed, this.ngPlusCount, this.pw, this.pwVertical, this.biomeData, appSettings.skipCosmeticScenes, this.perks, this.isDaily, this.gameMode);
				this.pixelScenesByPW[`${this.pw},${this.pwVertical}`] = this.pixelScenesByPW[`${this.pw},${this.pwVertical}`].concat(staticPixelScenesResults.pixelScenes);
				this.poisByPW[`${this.pw},${this.pwVertical}`] = this.poisByPW[`${this.pw},${this.pwVertical}`].concat(staticPixelScenesResults.pois);
			}

			// Make sure the search worker is synced with this update
			continueSearchSequence(this.pw, this.pwVertical)
			// Synchronously recolor pixel scenes in this world
			recolorPixelScenes(this.pixelScenesByPW[`${this.pw},${this.pwVertical}`]);
		}

		// Debug: Show example JSON output
		//console.log(this.poisByPW[`${this.pw},${this.pwVertical}`]);

		// Generate eye messages
		if (tiles) {
			this.eyes = findEyeMessages(this.biomeData.pixels, seedVal, ngVal);

			// Generate static info
			const weather = getStartingWeather(seedVal, ngVal);
			//console.log("Starting Weather:", weather);
			this.weather = weather;

			const biomeModifiers = getBiomeModifiers(seedVal, ngVal, weather.snowing);
			//console.log("Biome Modifiers:", biomeModifiers);
			this.biomeModifiers = biomeModifiers;

			this.fungalShifts = getFungalShifts(seedVal, ngVal);
			//console.log("Fungal Shifts:", this.fungalShifts);
			// Should probably just keep this in the current module
			renderFungalShifts(this.fungalShifts);

			this.alchemyRecipes = pickAlchemyMaterials(seedVal);
			//console.log("Alchemy Recipes:", this.alchemyRecipes);
			renderAlchemyRecipes(this.alchemyRecipes);

			const retainTakenPerks = this.perkSimulationRetention === 'taken-perks';
			const simulationState = this.perkSimulationRetention === 'none' ? null : getPerkSimulationState();
			updatePerksState(seedVal, ngVal, 0, {}, this.gameMode, 0, simulationState, retainTakenPerks);
			this.perkSimulationRetention = 'none';

			this.cauldronState = await getCauldronState();
			console.log("Cauldron State:", this.cauldronState);
		}

		const t1 = performance.now();
		console.log(`Generation completed in ${(t1 - t0) / 1000} seconds.`);
		
		this.checkBounds();
		this.draw();
		btn.disabled = false;
		btn.innerText = "Generate World";
		this.setLoading(false);
		document.getElementById('status').innerText = `Done (PW ${this.pw}, ${this.pwVertical}).`;

		// Re-enable controls
		document.getElementById('gen-btn').disabled = false;
		document.getElementById('gen-btn').innerText = "Generate World";
		document.getElementById('seed').disabled = false;
		document.getElementById('ng').disabled = false;
		document.getElementById('pw').disabled = false;
		document.getElementById('pw-vertical').disabled = false;

		// The world is up: frame whatever view the URL asked for. Cleared first so
		// the rescan applyView may trigger doesn't come back here and loop.
		if (this.pendingView) {
			const view = this.pendingView;
			this.pendingView = null;
			Promise.resolve().then(() => this.applyView(view));
		}
	},

	loadWorld(pwX, pwY) {
		// Scan a single world, assuming tiles are already generated. Pixel scenes and PoIs should be cleared if a world needs to be regenerated (if perks or unlocks changed, for example)
		// Run this in a separate thread
		// First check if things are ready
		if (!this.tileLayers || this.tileLayers.length === 0) {
			console.warn("Tried to load world before tiles were generated.");
			return;
		}
		getOrGenerateWorld(pwX, pwY);
	},

	async incrementSeed() {
		this.isDaily = false;
		this.unlocksChanged = true;
		let seedVal = parseInt(document.getElementById('seed').value);
		if (seedVal == 2147483647) return false;
		seedVal++;
		document.getElementById('seed').value = seedVal;
		this.saveSettings();
		await this.generate(true, true);
		return true;
	},

	renderOffscreen() {
		this.offscreen.width = this.w; this.offscreen.height = this.h;
		const ctx = this.offscreen.getContext('2d');
		const id = ctx.createImageData(this.w, this.h);
		for(let i = 0; i < this.biomeData.pixels.length; i++) {
			id.data[i*4+0] = (this.biomeData.pixels[i]>>16)&0xFF; 
			id.data[i*4+1] = (this.biomeData.pixels[i]>>8)&0xFF;
			id.data[i*4+2] = this.biomeData.pixels[i]&0xFF; 
			id.data[i*4+3] = 255;
		}
		ctx.putImageData(id, 0, 0);

		this.offscreenHeaven.width = this.w; this.offscreenHeaven.height = this.h;
		const ctxHeaven = this.offscreenHeaven.getContext('2d');
		const heavenData = ctxHeaven.createImageData(this.w, this.h);
		for (let i = 0; i < this.biomeData.heavenPixels.length; i++) {
			heavenData.data[i*4+0] = (this.biomeData.heavenPixels[i]>>16)&0xFF;
			heavenData.data[i*4+1] = (this.biomeData.heavenPixels[i]>>8)&0xFF;
			heavenData.data[i*4+2] = this.biomeData.heavenPixels[i]&0xFF;
			heavenData.data[i*4+3] = 255;
		}
		ctxHeaven.putImageData(heavenData, 0, 0);

		this.offscreenHell.width = this.w; this.offscreenHell.height = this.h;
		const ctxHell = this.offscreenHell.getContext('2d');
		const hellData = ctxHell.createImageData(this.w, this.h);
		for (let i = 0; i < this.biomeData.hellPixels.length; i++) {
			hellData.data[i*4+0] = (this.biomeData.hellPixels[i]>>16)&0xFF;
			hellData.data[i*4+1] = (this.biomeData.hellPixels[i]>>8)&0xFF;
			hellData.data[i*4+2] = this.biomeData.hellPixels[i]&0xFF;
			hellData.data[i*4+3] = 255;
		}
		ctxHell.putImageData(hellData, 0, 0);
	},

	renderRecolorMap() {
		// The recolorOffscreen* canvases and the recolorOffscreen*Buffer arrays
		// deliberately hold *different* colors:
		//   * the buffers keep the per-biome BIOME_COLOR_LOOKUP color, because they
		//     are the reference data for tile overlays (image_processing.js) and
		//     pixel-scene gray fills (pixel_scene_generation.js), which want biome
		//     identity;
		//   * the canvases are only read by the biomeBackground draw, so they get the
		//     engine's keying: one color per background_image, void where the biome
		//     has none. See js/biome_backgrounds.js.
		// Since we can't use getImageData, we can recreate a buffer as well...
		this.recolorOffscreenBuffer = new Uint8Array(this.w * this.h * 3); // RGB only, no alpha needed since it's always 255
		this.recolorOffscreenHeavenBuffer = new Uint8Array(this.w * this.h * 3);
		this.recolorOffscreenHellBuffer = new Uint8Array(this.w * this.h * 3);

		this.recolorOffscreen.width = this.w;
		this.recolorOffscreen.height = this.h;
		const ctx = this.recolorOffscreen.getContext('2d');
		const id = ctx.createImageData(this.w, this.h);

		const surfaceBiomes = [
			0x1133F1, // Lake
			0xf7cf8d, // Pond
			0x36d517, // Hills
			//0x33e311, // Hills2 (excluded for the memes)
			0xD6D8E3, // Snow
			0xcc9944, // Desert
			0x48E311, // Empty
		];
		const surfaceLevel = 14;
		// Cells painted as telescope's fake sky, so the edge-strip builder can leave
		// them alone -- the engine's sky is the parallax system, not this grid.
		const skyCells = new Uint8Array(this.w * this.h);

		for (let i = 0; i < this.biomeData.pixels.length; i++) {
			const biomeColor = this.biomeData.pixels[i] & 0xFFFFFF;
			let color = biomeColor;
			let isSurfaceBiome = false;
			// Set when the cell resolved to telescope's fake sky, which has no engine
			// counterpart in the chunk-background grid and so keeps its own color.
			let isSky = false;
			if (surfaceBiomes.includes(color)) isSurfaceBiome = true;
			if (BIOME_COLOR_LOOKUP[color]) {
				if (isSurfaceBiome) {
					if (isSurfaceBiome && i > this.w * surfaceLevel) {
						color = BIOME_COLOR_LOOKUP[color];
					}
					else {
						// Sky
						// Apply gradient from sky blue to white based on depth, capped at surface level
						let depthFactor = Math.min(Math.floor(i / this.w) / surfaceLevel, 1);
						// Linear interpolation between sky blue (0x87ceeb) and something more desaturated (0xbbddeb)
						let r = 0x87 + ((0xbb - 0x87) * depthFactor);
						let g = 0xce + ((0xdd - 0xce) * depthFactor);
						let b = 0xeb;

						color = (r << 16) | (g << 8) | b;
						isSky = true;
					}
				}
				else {
					color = BIOME_COLOR_LOOKUP[color];
				}


			}


			// Above the surface the engine's chunk backdrops are wang-masked to the
			// structure interiors (mountain, tower: sprite_static_tile_bg.frag masks
			// the tile to the template) or horizon-limited (limit_background_image on
			// the surface biomes and solid_wall), so what actually shows around the
			// art up there is the parallax sky. Painting the plain tile (or void)
			// there gave a black sky around the spawn mountain. Until the masks and
			// limit_y strips are modeled, every above-surface cell paints the sky
			// gradient and stays out of the backdrop-run/edge-strip builders. Only
			// the background canvas is affected; the identity buffer keeps the biome
			// color for tile overlays / scene fills.
			let bgColor = isSky ? color : backgroundLayerColor(biomeColor) ?? color;
			// A `static_tile` biome's backdrop is not a chunk sprite at all -- it is
			// its background_image masked to the structure's silhouette
			// (js/biome_backgrounds.js STATIC_TILE_BACKGROUNDS). Everything around
			// the silhouette is the parallax sky, so the chunk joins the sky band
			// here -- no backdrop run, no boundary strip, no flat fill -- and
			// drawBackgroundStack draws the masked backdrop on top of it. That holds
			// at any depth, which matters for the watchtower's row 14: the one
			// static-tile cell not already above the surface line, and until now the
			// one that filled its whole chunk with the wandcave backdrop.
			//
			// The inverse case is a biome that opts out of the horizon treatment with
			// limit_background_image="0" (UNLIMITED_BACKDROP_BIOMES): its chunk really
			// is filled edge to edge up there, so it keeps its backdrop.
			if (!isSky && !UNLIMITED_BACKDROP_COLORS.has(biomeColor)
				&& (STATIC_TILE_COLORS.has(biomeColor) || i < this.w * surfaceLevel)) {
				const depthFactor = Math.min(Math.floor(i / this.w) / surfaceLevel, 1);
				const r = 0x87 + ((0xbb - 0x87) * depthFactor);
				const g = 0xce + ((0xdd - 0xce) * depthFactor);
				bgColor = (r << 16) | (g << 8) | 0xeb;
				isSky = true;
			}
			if (isSky) skyCells[i] = 1;
			writeBackgroundPixel(id, i, bgColor);
			this.recolorOffscreenBuffer[i*3+0] = (color >> 16) & 0xFF;
			this.recolorOffscreenBuffer[i*3+1] = (color >> 8) & 0xFF;
			this.recolorOffscreenBuffer[i*3+2] = color & 0xFF;
		}
		ctx.putImageData(id, 0, 0);

		// Create heaven/hell versions
		// Create image data of same size
		this.recolorOffscreenHeaven.width = this.w;
		this.recolorOffscreenHeaven.height = this.h;
		const ctxHeaven = this.recolorOffscreenHeaven.getContext('2d');
		const heavenData = ctxHeaven.createImageData(this.w, this.h);
		// Just use the top row pixels of the main recolor map for heaven
		for (let i = 0; i < this.biomeData.heavenPixels.length; i++) {
			if (bandColumnPaints(this.biomeData.heavenPixels[i])) {
				const src = (i % this.w) * 4;
				heavenData.data[i*4+0] = id.data[src+0];
				heavenData.data[i*4+1] = id.data[src+1];
				heavenData.data[i*4+2] = id.data[src+2];
				heavenData.data[i*4+3] = id.data[src+3];
			}
			else {
				// Nothing is generated in this column, so the band is empty sky.
				// Paint the sky gradient's top value rather than leaving the pixel
				// transparent: nothing else draws behind the heaven band, so a
				// transparent column showed the black page (the snow columns west
				// of the_sky at the map top, cols <= 26 on the ng0 map). The game
				// clears to this same sky blue up there. The edge strips and
				// backdrop runs still skip the column via heavenSkip below.
				writeBackgroundPixel(heavenData, i, 0x87ceeb);
			}
			this.recolorOffscreenHeavenBuffer[i*3+0] = this.recolorOffscreenBuffer[(i*3+0)%(this.w*3)];
			this.recolorOffscreenHeavenBuffer[i*3+1] = this.recolorOffscreenBuffer[(i*3+1)%(this.w*3)];
			this.recolorOffscreenHeavenBuffer[i*3+2] = this.recolorOffscreenBuffer[(i*3+2)%(this.w*3)];
		}
		ctxHeaven.putImageData(heavenData, 0, 0);

		this.recolorOffscreenHell.width = this.w;
		this.recolorOffscreenHell.height = this.h;
		const ctxHell = this.recolorOffscreenHell.getContext('2d');
		const hellData = ctxHell.createImageData(this.w, this.h);
		for (let i = 0; i < this.biomeData.hellPixels.length; i++) {
			const color = this.biomeData.hellPixels[i] & 0xFFFFFF;
			const recolor = BIOME_COLOR_LOOKUP[color] || color;
			if (bandColumnPaints(color)) {
				writeBackgroundPixel(hellData, i, backgroundLayerColor(color) ?? recolor);
			}
			this.recolorOffscreenHellBuffer[i*3+0] = (recolor >> 16) & 0xFF;
			this.recolorOffscreenHellBuffer[i*3+1] = (recolor >> 8) & 0xFF;
			this.recolorOffscreenHellBuffer[i*3+2] = recolor & 0xFF;
		}
		ctxHell.putImageData(hellData, 0, 0);

		// Ragged 64px strips along the chunk lines where two backgrounds actually
		// differ. Built once per generation (~1400 entries for the whole world) and
		// bucketed by chunk row, so drawNow only walks the visible rows.
		// In the bands the skipped cells are the ones the loops above left
		// transparent: an empty column has no background to decorate, and its
		// neighbour has nothing to bleed into.
		const heavenSkip = new Uint8Array(this.w * this.h);
		const hellSkip = new Uint8Array(this.w * this.h);
		for (let i = 0; i < heavenSkip.length; i++) {
			heavenSkip[i] = bandColumnPaints(this.biomeData.heavenPixels[i]) ? 0 : 1;
			hellSkip[i] = bandColumnPaints(this.biomeData.hellPixels[i]) ? 0 : 1;
		}
		this.bandFillHeaven = this.renderBandFillCanvas(this.biomeData.heavenPixels);
		this.bandFillHell = this.renderBandFillCanvas(this.biomeData.hellPixels);

		this.backgroundEdges = buildBackgroundEdges(this.biomeData.pixels, this.w, this.h, skyCells);
		this.backgroundEdgesHeaven = buildBackgroundEdges(this.biomeData.heavenPixels, this.w, this.h, heavenSkip);
		this.backgroundEdgesHell = buildBackgroundEdges(this.biomeData.hellPixels, this.w, this.h, hellSkip);

		// Runs of chunks sharing a background_image, for the full-art backdrop
		// tiling (drawBackgroundStack). Same skip semantics as the strips.
		this.backdropRuns = buildBackdropRuns(this.biomeData.pixels, this.w, this.h, skyCells);
		this.backdropRunsHeaven = buildBackdropRuns(this.biomeData.heavenPixels, this.w, this.h, heavenSkip);
		this.backdropRunsHell = buildBackdropRuns(this.biomeData.hellPixels, this.w, this.h, hellSkip);
	},

	// The terrain a vertical band actually contains, at one pixel per chunk.
	//
	// A band is the clamped edge row of the biome map repeated forever, so its
	// constant-material fill biomes -- the infinite EDR / cursed rock columns, the
	// lava columns of row 47 -- cover their whole column, top to bottom. The main
	// world's fill layers only exist where the *main* map has a fill biome, so
	// blitting those into a band gave the columns holes wherever the main map
	// happened to hold something else. This grid is derived from the band's own
	// map instead, and paints exactly the columns bandColumnPaints() keeps.
	//
	// It sits on the 512px chunk grid rather than telescope's tile raster (51
	// tiles of 10px per chunk, resynced every 5), so it can drift up to 10px from
	// a main-world fill at the band boundary. That is well under one chunk and
	// the chunk grid is the engine's own, so the seam is not worth a per-chunk
	// draw loop.
	renderBandFillCanvas(pixels) {
		const canvas = document.createElement('canvas');
		canvas.width = this.w;
		canvas.height = this.h;
		const ctx = canvas.getContext('2d');
		const id = ctx.createImageData(this.w, this.h);
		for (let i = 0; i < pixels.length; i++) {
			const color = terrainFillColor(pixels[i] & 0xFFFFFF);
			if (color === undefined) continue;
			id.data[i*4+0] = (color >> 16) & 0xFF;
			id.data[i*4+1] = (color >> 8) & 0xFF;
			id.data[i*4+2] = color & 0xFF;
			id.data[i*4+3] = 255;
		}
		ctx.putImageData(id, 0, 0);
		return canvas;
	},

	async getSurfaceOverlays() {
		// TODO: Instead of loading these all at once, we could load them only if that type of world was used
		// These are low res so hopefully won't cause too much slowdown, if not we can look into streaming them in or something
		// TODO: Add variants for PWs/NG+
		// Going to use this mode when I don't need to modify the image data
		this.surfaceOverlay = await loadPNGBitmap('../data/biome_maps/custom/surface_overlay.png');
		this.surfaceOverlayPW = await loadPNGBitmap('../data/biome_maps/custom/surface_overlay_pw.png');
		this.surfaceOverlayPWAdditional = await loadPNGBitmap('../data/biome_maps/custom/surface_overlay_pw_addition.png');
		this.skyOverlay = await loadPNGBitmap('../data/biome_maps/custom/sky_overlay.png');
		this.skyOverlayPW = await loadPNGBitmap('../data/biome_maps/custom/sky_overlay_pw.png');
		this.surfaceOverlayNGP = await loadPNGBitmap('../data/biome_maps/custom/surface_overlay_ngp.png');
		this.surfaceOverlayNGPPW = await loadPNGBitmap('../data/biome_maps/custom/surface_overlay_ngp_pw.png');
		this.skyOverlayNGP = await loadPNGBitmap('../data/biome_maps/custom/sky_overlay_ngp.png');
		this.skyOverlayNGPPW = await loadPNGBitmap('../data/biome_maps/custom/sky_overlay_ngp_pw.png');
		this.surfaceOverlayNGP7 = await loadPNGBitmap('../data/biome_maps/custom/surface_overlay_ngp7.png');
		this.surfaceOverlayNGP7PW = await loadPNGBitmap('../data/biome_maps/custom/surface_overlay_ngp7_pw.png');
		this.skyOverlayNGP7 = await loadPNGBitmap('../data/biome_maps/custom/sky_overlay_ngp7.png');
		this.skyOverlayNGP7PW = await loadPNGBitmap('../data/biome_maps/custom/sky_overlay_ngp7_pw.png');
		this.surfaceOverlayNGP14 = await loadPNGBitmap('../data/biome_maps/custom/surface_overlay_ngp14.png');
		this.surfaceOverlayNGP14PW = await loadPNGBitmap('../data/biome_maps/custom/surface_overlay_ngp14_pw.png');
		this.skyOverlayNGP14 = await loadPNGBitmap('../data/biome_maps/custom/sky_overlay_ngp14.png');
		this.skyOverlayNGP14PW = await loadPNGBitmap('../data/biome_maps/custom/sky_overlay_ngp14_pw.png');
		this.surfaceOverlayNGP21 = await loadPNGBitmap('../data/biome_maps/custom/surface_overlay_ngp21.png');
		this.surfaceOverlayNGP21PW = await loadPNGBitmap('../data/biome_maps/custom/surface_overlay_ngp21_pw.png');
		this.skyOverlayNGP21 = await loadPNGBitmap('../data/biome_maps/custom/sky_overlay_ngp21.png');
		this.skyOverlayNGP21PW = await loadPNGBitmap('../data/biome_maps/custom/sky_overlay_ngp21_pw.png');
		this.surfaceOverlayNightmare = await loadPNGBitmap('../data/biome_maps/custom/surface_overlay_nightmare.png');
		this.surfaceOverlayNightmarePW = await loadPNGBitmap('../data/biome_maps/custom/surface_overlay_nightmare_pw.png');
		this.skyOverlayNightmare = await loadPNGBitmap('../data/biome_maps/custom/sky_overlay_nightmare.png');
		this.skyOverlayNightmarePW = await loadPNGBitmap('../data/biome_maps/custom/sky_overlay_nightmare_pw.png');
		
		// The world-rect tiles: those anchored to something other than a pixel
		// scene (the sky bodies, the echoing spire, the hourglass chamber's
		// oversized tile, the scale) still need their own draw sites below.
		const sceneArtStems = [
			"hiisi_hourglass_left", "hiisi_hourglass_right",
			"echoing_spire", "echoing_spire_grass", "echoing_spire_sand",
			"moon", "darkmoon", "sun", "darksun",
			"scale_empty", "scale_light", "scale_dark", "scale_balanced",
			// Everything a pixel scene can ask for by key, so giving a scene a
			// tile is one line in js/pixel_scene_art.js and nothing here.
			...SCENE_ART_TILES,
		];
		this.surfaceOverlayScenes = {};
		for (const stem of sceneArtStems) {
			this.surfaceOverlayScenes[stem] = await loadPNGBitmap(`../data/biome_maps/custom/${stem}.png`);
		}
		
		this.weatherOverlays = {
			"rain": await loadPNGBitmap('../data/biome_maps/custom/weather_rain.png'),
			"rain_heavy": await loadPNGBitmap('../data/biome_maps/custom/weather_rain_heavy.png'),
			"snow": await loadPNGBitmap('../data/biome_maps/custom/weather_snow.png'),
			"slush": await loadPNGBitmap('../data/biome_maps/custom/weather_slush.png'),
			"blood": await loadPNGBitmap('../data/biome_maps/custom/weather_blood.png'),
			"acid": await loadPNGBitmap('../data/biome_maps/custom/weather_acid.png'),
			"slime": await loadPNGBitmap('../data/biome_maps/custom/weather_slime.png'),
		};
	},

	getViewArea() {
		const zoomMultiplier = 0.75; // Makes the view area considered slightly larger than the screen so that loading can happen before reaching the edge
		const worldShiftX = this.pw * 512 * getWorldSize(this.isNGP, this.gameMode);
		const worldShiftY = this.pwVertical * 24576; // 512 * 48
		const left = worldShiftX + this.cam.x - (this.canvas.width / 2) / (this.cam.z * zoomMultiplier);
		const right = worldShiftX + this.cam.x + (this.canvas.width / 2) / (this.cam.z * zoomMultiplier);
		const top = worldShiftY + this.cam.y - (this.canvas.height / 2) / (this.cam.z * zoomMultiplier);
		const bottom = worldShiftY + this.cam.y + (this.canvas.height / 2) / (this.cam.z * zoomMultiplier);
		return { left, right, top, bottom };
	},

	checkBounds() {
		const worldWidth = getWorldSize(this.isNGP, this.gameMode) * 512;
		const worldHeight = 24576; // 512 * 48
		const viewArea = this.getViewArea();
		const prevWorldsInView = this.worldsInView ? this.worldsInView : new Set();
		this.worldsInView = new Set();
		for (let x = Math.floor(viewArea.left/worldWidth); x <= Math.floor(viewArea.right/worldWidth); x++) {
			for (let y = Math.floor(viewArea.top/worldHeight); y <= Math.floor(viewArea.bottom/worldHeight); y++) {
				// We have to set limits here...
				if (x < -getPWLimit(this.isNGP, this.gameMode) || x > getPWLimit(this.isNGP, this.gameMode) || y < -683 || y > 683) continue;
				this.worldsInView.add(`${x},${y}`);
			}
		}
		// Check if sets are different
		const worldDiff = this.worldsInView.difference(prevWorldsInView);
		if (worldDiff.size > 0) {
			//console.log("Worlds in view changed, new worlds: ", worldDiff);
			for (let worldKey of worldDiff) {
				const [x, y] = worldKey.split(',').map(Number);
				this.loadWorld(x, y);
			}
		}
		this.evictOffscreenOverlays();
	},

	// Tile overlays are ~30 MB a world, and outside NG each world has its own
	// (NG+ strides are 8 px short of whole tiles, so the edge noise lands
	// differently in every world). Kept for every world ever viewed, a scroll
	// across dozens of worlds held gigabytes. Keep the worlds in view plus the
	// most recently seen few; one that scrolls back in is re-requested by
	// loadWorld like any world entering the view.
	evictOffscreenOverlays() {
		const seen = (this.overlaySeen ??= new Map());
		const tick = (this.overlaySeenTick = (this.overlaySeenTick || 0) + 1);
		// In NG a row's worlds alias its PW-0 overlay, and getOrGenerateOverlay
		// looks it up under `0,y`: evicting that key while the row is still in
		// view makes the next world scrolling in rebuild it (~1 s in the worker).
		const shared = !this.isNGP && this.gameMode !== 'nightmare';
		const keep = new Set(this.worldsInView);
		if (shared) for (const k of this.worldsInView) keep.add(`0,${k.split(',')[1]}`);
		for (const k of keep) seen.set(k, tick);
		const byPW = this.tileOverlaysByPW;
		const offscreen = Object.keys(byPW).filter((k) => byPW[k] && !keep.has(k));
		if (offscreen.length <= OVERLAY_OFFSCREEN_KEEP) return;
		offscreen.sort((a, b) => (seen.get(a) || 0) - (seen.get(b) || 0));
		const dropped = new Set();
		for (const k of offscreen.slice(0, offscreen.length - OVERLAY_OFFSCREEN_KEEP)) {
			dropped.add(byPW[k]);
			delete byPW[k];
			seen.delete(k);
		}
		// NG worlds alias one overlay per row: close it only once nothing uses it.
		const live = new Set(Object.values(byPW));
		for (const overlay of dropped) {
			if (!live.has(overlay)) for (const bitmap of overlay) bitmap?.close?.();
		}
	},

	// Coalesce redraws: mousemove can fire several times per displayed frame, and
	// the drag handler used to run a full redraw on every one of them. Schedule at
	// most one drawNow() per animation frame instead. Every caller (drag, overlay
	// and search paths that call app.draw() as results stream in) benefits, and
	// nothing reads back canvas pixels synchronously after a draw().
	draw() {
		this.scheduleViewURLSync();
		if (this.drawScheduled) return;
		this.drawScheduled = true;
		requestAnimationFrame(() => {
			this.drawScheduled = false;
			this.drawNow();
		});
	},

	// --- View <-> URL (x/y/z, noitamap's scheme; see js/view_url.js) ---------

	// The width `z` is measured against: the WINDOW, not telescope's canvas.
	// noitamap's #osContainer spans the whole window, while our canvas is the
	// window minus the sidebar, so measuring against the canvas would make a
	// shared z mean the same world span at a different magnification — the same
	// link would draw everything smaller here. See js/view_url.js's header.
	viewReferenceWidth() {
		const win = (typeof document !== 'undefined' && document.documentElement
			&& document.documentElement.clientWidth) || window.innerWidth || 0;
		return win > 0 ? win : (this.canvas ? this.canvas.width : 0);
	},

	// The camera as the three URL parameters, or null before there is a canvas
	// to measure the zoom against.
	currentViewParams() {
		if (!this.canvas || !this.canvas.width) return null;
		const world = worldFromCamera(this.cam, this.pw, this.pwVertical,
			getWorldSize(this.isNGP, this.gameMode), getWorldCenter(this.isNGP, this.gameMode));
		return formatViewParams(world.x, world.y, logZoomFromCamZ(this.cam.z, this.viewReferenceWidth()));
	},

	// replaceState, never pushState: panning must not grow the back history.
	syncViewToURL() {
		const view = this.currentViewParams();
		if (!view) return;
		const key = `${view.x},${view.y},${view.z}`;
		if (key === this.lastViewURL) return;
		this.lastViewURL = key;
		const url = new URL(window.location.href);
		url.searchParams.set('x', view.x);
		url.searchParams.set('y', view.y);
		url.searchParams.set('z', view.z);
		window.history.replaceState(null, '', url.toString());
	},

	// Trailing-edge throttle: a drag writes the URL at most every VIEW_URL_SYNC_MS
	// and always once more after it stops. Suppressed while a URL-supplied view is
	// still waiting for a world, so we never overwrite what we are about to apply.
	scheduleViewURLSync() {
		if (this.pendingView || this.viewURLTimer) return;
		this.viewURLTimer = setTimeout(() => {
			this.viewURLTimer = null;
			this.syncViewToURL();
		}, VIEW_URL_SYNC_MS);
	},

	// Frame the view given by URL parameters. A position outside the current
	// parallel world switches to the one that holds it and rescans, exactly as
	// dragging across the seam does.
	applyView(view) {
		if (!view) return;
		const worldSize = getWorldSize(this.isNGP, this.gameMode);
		const worldCenter = getWorldCenter(this.isNGP, this.gameMode);
		if (view.z !== null) this.cam.z = camZFromLogZoom(view.z, this.viewReferenceWidth());
		if (view.x !== null || view.y !== null) {
			const here = worldFromCamera(this.cam, this.pw, this.pwVertical, worldSize, worldCenter);
			const target = cameraFromWorld(view.x ?? here.x, view.y ?? here.y,
				worldSize, worldCenter, getPWLimit(this.isNGP, this.gameMode));
			const pwChanged = target.pw !== this.pw || target.pwVertical !== this.pwVertical;
			this.cam.x = target.camX;
			this.cam.y = target.camY;
			if (pwChanged) {
				this.pw = target.pw;
				this.pwVertical = target.pwVertical;
				document.getElementById('pw').value = this.pw;
				document.getElementById('pw-vertical').value = this.pwVertical;
				this.checkBounds();
				this.generate(false, false);
				return;
			}
		}
		this.checkBounds();
		this.draw();
	},

	// Returns a profiling handle for this frame, or null when neither
	// debug-layer-timings nor the render HUD wants it.
	startLayerProfile() {
		if (!appSettings.debugLayerTimings && !renderHud.on) {
			removeDrawCounter();
			this.layerProfile = null;
			return null;
		}
		installDrawCounter(this.ctx);
		if (!this.layerProfile) {
			this.layerProfile = { buckets: new Map(), frames: 0, lastReport: performance.now(), t: 0, images: 0, ops: 0 };
		}
		const prof = this.layerProfile;
		prof.t = performance.now();
		prof.frameT0 = prof.t;
		prof.frameLayers = {};
		prof.images = drawCounter.images;
		prof.ops = drawCounter.ops;
		return prof;
	},

	// Reports averages roughly once per second rather than every frame.
	finishLayerProfile(prof) {
		if (!prof) return;
		prof.frames++;
		const now = performance.now();
		renderHud.frame(prof.frameLayers, now - prof.frameT0);
		if (now - prof.lastReport < 1000) return;
		if (!appSettings.debugLayerTimings) {
			prof.buckets.clear();
			prof.frames = 0;
			prof.lastReport = now;
			return;
		}
		const rows = {};
		let totalMs = 0;
		for (const [key, bucket] of prof.buckets) {
			totalMs += bucket.ms;
			rows[key] = {
				'ms/frame': +(bucket.ms / prof.frames).toFixed(3),
				'drawImage/frame': +(bucket.images / prof.frames).toFixed(1),
				'other draws/frame': +(bucket.ops / prof.frames).toFixed(1),
			};
		}
		rows['TOTAL'] = {
			'ms/frame': +(totalMs / prof.frames).toFixed(3),
			'drawImage/frame': +(drawCounter.images / prof.frames).toFixed(1),
			'other draws/frame': +(drawCounter.ops / prof.frames).toFixed(1),
		};
		console.log(`[Render] ${prof.frames} frames in ${((now - prof.lastReport) / 1000).toFixed(2)}s at zoom ${this.cam.z.toFixed(4)} (PW ${this.pw}, ${this.pwVertical})`);
		console.table(rows);
		prof.buckets.clear();
		prof.frames = 0;
		prof.lastReport = now;
		drawCounter.images = 0;
		drawCounter.ops = 0;
	},

	// Builds the chunk-resolution "nothing paints here" mask from the generated tile
	// layers. A chunk counts as covered when some layer actually paints into it: the
	// region chunks in validChunks for generated layers, or the chunks the image spans
	// for static ones (which are never masked). Everything else - fill-only biomes,
	// biomes with no generator, empty map areas - is left uncovered so it can be
	// checkerboarded instead of showing the raw biome map color.
	//
	// Constant-material fill biomes have chunk-sized layers of their own, so both
	// renderers paint them and the generic validChunks pass below covers them.
	//
	// The `sceneOnly` rooms have no layer by design -- the engine paints no terrain
	// in their chunk (generator_config.js SCENE_ONLY_COLORS) -- but they are not a
	// gap in telescope: air is the answer, and the room's pixel scene supplies
	// everything else. Checkerboarding them would flag 38 correct chunks as missing.
	buildUnpaintedMask() {
		this.unpaintedMask = null;
		this.unpaintedCovered = null;
		this.unpaintedChunkCount = 0;
		if (!this.tileLayers || !this.tileLayers.length || !this.w || !this.h) return;
		const w = this.w, h = this.h;
		const covered = new Uint8Array(w * h);
		for (const layer of this.tileLayers) {
			if (layer.validChunks) {
				for (const chunkKey of layer.validChunks) {
					const comma = chunkKey.indexOf(',');
					const cx = parseInt(chunkKey.substring(0, comma));
					const cy = parseInt(chunkKey.substring(comma + 1));
					if (cx < 0 || cy < 0 || cx >= w || cy >= h) continue;
					covered[cy * w + cx] = 1;
				}
			}
			else {
				const cx0 = layer.chunkBasePos ? layer.chunkBasePos.x : layer.minX;
				const cy0 = layer.chunkBasePos ? layer.chunkBasePos.y : layer.minY;
				const chunksW = Math.max(1, Math.ceil(layer.w / CHUNK_SIZE));
				const chunksH = Math.max(1, Math.ceil(layer.h / CHUNK_SIZE));
				for (let cy = Math.max(0, cy0); cy < Math.min(h, cy0 + chunksH); cy++) {
					for (let cx = Math.max(0, cx0); cx < Math.min(w, cx0 + chunksW); cx++) {
						covered[cy * w + cx] = 1;
					}
				}
			}
		}
		if (this.biomeData && this.biomeData.pixels) {
			for (let i = 0; i < w * h && i < this.biomeData.pixels.length; i++) {
				if (SCENE_ONLY_COLORS.has(this.biomeData.pixels[i] & 0xffffff)) covered[i] = 1;
			}
		}
		// Chunks the engine GL pass resolves itself are painted, even when the
		// whole answer is air over a painted background (sky above the surface,
		// holy-mountain interiors) — checkerboarding those flags correct chunks.
		// Mode 2 (bits 8-9) is the fallback to the legacy layer pipeline, which
		// the validChunks pass above already judged.
		const engModes = (appSettings.engineTerrain && this.glTerrain
			&& this.glTerrain.engineChunkWidth === w) ? this.glTerrain.engineChunkModes : null;
		if (engModes) {
			for (let i = 0; i < w * h; i++) {
				if (((engModes[i] >> 8) & 3) !== 2) covered[i] = 1;
			}
		}
		this.unpaintedMaskUsedEngine = !!engModes;
		this.unpaintedCovered = covered; // kept for the hover tooltip's per-chunk lookup
		const canvas = document.createElement('canvas');
		canvas.width = w;
		canvas.height = h;
		const ctx = canvas.getContext('2d');
		const imageData = ctx.createImageData(w, h);
		for (let i = 0; i < w * h; i++) {
			if (covered[i]) continue;
			// Only the alpha matters, the pattern is composited in with source-in
			imageData.data[i * 4 + 3] = 255;
			this.unpaintedChunkCount++;
		}
		ctx.putImageData(imageData, 0, 0);
		this.unpaintedMask = canvas;
	},

	getCheckerPattern(ctx) {
		if (!this.checkerPattern) {
			const square = 8;
			const tile = document.createElement('canvas');
			tile.width = square * 2;
			tile.height = square * 2;
			const tileCtx = tile.getContext('2d');
			tileCtx.fillStyle = 'rgba(255, 255, 255, 0.5)';
			tileCtx.fillRect(0, 0, square, square);
			tileCtx.fillRect(square, square, square, square);
			tileCtx.fillStyle = 'rgba(204, 204, 204, 0.5)';
			tileCtx.fillRect(square, 0, square, square);
			tileCtx.fillRect(0, square, square, square);
			this.checkerPattern = ctx.createPattern(tile, 'repeat');
		}
		return this.checkerPattern;
	},

	// Renders the terrain layer with the WebGL2 pass and blits it over the whole
	// viewport at the layer-4 position, replacing the per-region overlay drawImage
	// loop. The GL canvas is screen sized and already in screen space, so it is drawn
	// with the camera transform reset (the shader applies the camera itself).
	//
	// Returns a predicate telling drawNow which parallel worlds the pass covered, or
	// null when GL is unavailable (no WebGL2, context loss, resource build failure) —
	// the CPU bake then draws everything, unchanged.
	// With `scenes` (layer 5 enabled), the pixel scenes are drawn into the terrain
	// canvas before the blit (js/gl/scene_renderer.js); this.scenesOnGL says so.
	drawTerrainGL(worldOffsets, viewRect, scenes, prof) {
		if (!this.glTerrain) this.glTerrain = new GLTerrainRenderer();
		const terrain = this.glTerrain;
		// Nothing to do if every world in view is one the GL pass does not cover.
		let anyCovered = false;
		for (const worldKey of this.worldsInView) {
			if (terrain.rendersWorld(Number(worldKey.split(',')[1]))) { anyCovered = true; break; }
		}
		if (!anyCovered) return null;

		const ok = terrain.ensureResources(this.tileLayers, this.biomeData, {
			isNGP: this.isNGP,
			gameMode: this.gameMode,
			// Color-only settings: a 1 KiB LUT re-upload, never an atlas rebuild.
			lut: {
				recolorMaterials: appSettings.recolorMaterials,
				clearSpawnPixels: appSettings.clearSpawnPixels,
			},
			// Engine resolve mode builds the 1/10 lattices + parameter tables.
			engineTerrain: appSettings.engineTerrain,
			seed: this.seed,
			generatorConfig: GENERATOR_CONFIG,
		});
		if (!ok) return null;

		// The engine chunk table lands here (lazily, on the first GL draw); the
		// unpainted mask built before it existed must fold it in once.
		if (!this.unpaintedMaskUsedEngine && terrain.engineChunkModes && this.unpaintedMask) {
			this.buildUnpaintedMask();
		}

		const glCanvas = terrain.render({
			width: this.canvas.width,
			height: this.canvas.height,
			camX: this.cam.x,
			camY: this.cam.y,
			camZ: this.cam.z,
			pw: this.pw,
			pwVertical: this.pwVertical,
			edgeNoise: appSettings.enableEdgeNoise,
			// Per-cell material textures only mean anything once wang colors
			// resolve to their material, which is what recolorMaterials does.
			// Auto-off when zoomed out: sub-pixel texels only alias.
			materialTextures: appSettings.materialTextures && appSettings.recolorMaterials
				&& this.detailZoom() >= MATERIAL_DETAIL_MIN_ZOOM,
			engineTerrain: appSettings.engineTerrain,
		});
		if (!glCanvas) return null;
		if (prof) markLayer(prof, 'terrainGL');
		if (scenes) {
			this.scenesOnGL = this.drawScenesGL(terrain, worldOffsets, viewRect);
			if (prof) markLayer(prof, 'scenesGL');
		}

		this.ctx.save();
		this.ctx.setTransform(1, 0, 0, 1, 0, 0);
		this.ctx.drawImage(glCanvas, 0, 0);
		this.ctx.restore();
		return (pwY) => terrain.rendersWorld(pwY);
	},

	drawScenesGL(terrain, worldOffsets, viewRect) {
		if (!this.pixelScenesByPW) return false;
		if (!this.glScenes) this.glScenes = new GLSceneRenderer();
		const worldCenter = getWorldCenter(this.isNGP, this.gameMode) * 512;
		const worldSize = getWorldSize(this.isNGP, this.gameMode) * 512;
		const worlds = [];
		for (const worldKey of this.worldsInView) {
			const { pwX, pwY, shiftX, shiftY } = worldOffsets[worldKey];
			const list = this.pixelScenesByPW[`${pwX},${pwY}`];
			if (!list) continue;
			worlds.push({ list, relOffX: worldCenter - pwX * worldSize, relOffY: 14 * 512 - pwY * 24576, shiftX, shiftY });
		}
		const budgetMB = appSettings.renderEverything
			? Math.max(appSettings.pixelSceneBitmapBudgetMB || 256, 2048) : (appSettings.pixelSceneBitmapBudgetMB || 256);
		const drawn = this.glScenes.draw(terrain, {
			width: this.canvas.width,
			height: this.canvas.height,
			originX: this.cam.x - (this.canvas.width / 2) / this.cam.z,
			originY: this.cam.y - (this.canvas.height / 2) / this.cam.z,
			zoom: this.cam.z,
			level: pixelSceneMipLevel(this.detailZoom()),
			frame: this.frameSerial,
			budgetBytes: budgetMB * 1024 * 1024,
			viewRect,
			worlds,
		});
		const wait = this.glScenes.redrawInMs;
		if (drawn && wait != null && !this.sceneRedrawTimer) {
			this.sceneRedrawTimer = setTimeout(() => { this.sceneRedrawTimer = null; this.draw(); }, Math.max(0, wait));
		}
		return drawn;
	},

	// Stamps the checkerboard over every uncovered chunk of every horizontal parallel
	// world in view (the vertical bands do not use the main map's coverage, see below).
	// The mask is drawn through the camera transform so it lines up with the biome
	// background, but the checker squares themselves are filled in screen space so they
	// stay 8px at any zoom.
	// The engine's ragged background boundary art: one hand-drawn 64px strip
	// straddling each chunk line where the two chunks' background_image differ,
	// drawn by the winning side so its background bleeds into the neighbour. We
	// draw the strip's alpha filled with the winner's flat color (see
	// js/biome_backgrounds.js), which is why this sits on top of the per-chunk
	// background fill rather than replacing it.
	// The full background stack for every world copy in view, in the engine's
	// z order (docs/worldgen/background_rendering.md: the background SceneGraph
	// draws HIGH z first): flat fallback -> backdrop tiles (z~99) -> boundary
	// strips -> pixel-scene backgrounds (z=50) -> <BackgroundImages> (z=30).
	// The cell layers then composite over this with straight src-over alpha,
	// exactly like the game's cell grid over its background sprites.
	//
	// `reverse` flips the order for the destination-over air-hole refill in the
	// pixel-scene layer: with destination-over, later draws land *behind*
	// earlier ones, so front-to-back paints the same stack into the holes.
	// The zoom every level-of-detail gate reads: the camera's, or "infinitely
	// zoomed in" under the Render Everything debug toggle so no gate ever cuts.
	detailZoom() {
		return appSettings.renderEverything ? Infinity : this.cam.z;
	},

	// One whole-map reduction of a world row's backdrop runs, built on first use
	// once every art bitmap is decoded (an earlier bake would freeze the gaps).
	// ~55 MB per row variant at 1/8; only the variants actually viewed exist.
	backdropBake(runs) {
		if (!this.backdropBakes) this.backdropBakes = new Map();
		let bake = this.backdropBakes.get(runs);
		if (bake) return bake;
		if (!backgroundArtLoaded()) return null;
		const t0 = performance.now();
		// An ImageBitmap, not a canvas: a canvas this large is software-backed
		// in Chrome and re-uploaded on every draw (measured 4-8 ms a frame).
		const scratch = new OffscreenCanvas(
			Math.ceil(this.w * 512 / BACKDROP_BAKE_SCALE), Math.ceil(this.h * 512 / BACKDROP_BAKE_SCALE));
		const bctx = scratch.getContext('2d');
		bctx.imageSmoothingEnabled = true;
		bctx.scale(1 / BACKDROP_BAKE_SCALE, 1 / BACKDROP_BAKE_SCALE);
		drawBackdropRuns(bctx, runs, 0, 0, { left: 0, top: 0, right: this.w * 512, bottom: this.h * 512 });
		bake = scratch.transferToImageBitmap();
		this.backdropBakes.set(runs, bake);
		renderTrace.done('bake', 'backdrop', 'biomeBackground', performance.now() - t0);
		return bake;
	},

	// One 1/16-scale bitmap of every scene in a placement list, in draw space
	// relative to the world copy's shift (see the header note above getPoiRadius).
	// Scenes whose bitmap has not arrived are left out and asked for; the bake is
	// rebuilt once they land.
	// Whether a scene starts inside world (pwX, pwY)'s own rect, in placement-list
	// coordinates (scene positions carry the PW stride). A world's bake covers
	// only these; see sceneBake.
	sceneInWorld(pwX, pwY) {
		const left = pwX * getWorldStride(this.isNGP, this.gameMode) - getWorldCenter(this.isNGP, this.gameMode) * 512;
		const right = left + getWorldSize(this.isNGP, this.gameMode) * 512;
		const top = pwY * 24576 - 14 * 512;
		return (s) => s.x >= left && s.x < right && s.y >= top && s.y < top + 24576;
	},

	sceneBake(list, relOffX, relOffY, inWorld) {
		const version = pixelSceneBitmapVersion();
		let bake = sceneBakes.get(list);
		const now = performance.now();
		if (bake) {
			sceneBakes.delete(list);   // re-insert: Map order is the LRU order
			sceneBakes.set(list, bake);
			bake.frame = this.frameSerial;
			if (bake.version === version || now - bake.builtAt < SCENE_BAKE_MIN_INTERVAL_MS) return bake;
		}
		if (!bake) {
			// Bounds from the world's own scenes, so they never move as scenes land.
			// A list can also carry scenes placed in another world (the spliced
			// statics sit at main-world coordinates in every list): those are left
			// to the per-scene path, or the bake would stretch across every world in
			// between -- hundreds of MB per world copy.
			let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
			for (const scene of list) {
				const data = PIXEL_SCENE_DATA[scene.key];
				if (!data || !inWorld(scene)) continue;
				const x = scene.x + relOffX, y = scene.y + relOffY;
				if (x < minX) minX = x;
				if (y < minY) minY = y;
				if (x + data.width > maxX) maxX = x + data.width;
				if (y + data.height > maxY) maxY = y + data.height;
			}
			if (!(maxX > minX)) return null;
			minX = Math.floor(minX / SCENE_BAKE_SCALE) * SCENE_BAKE_SCALE;
			minY = Math.floor(minY / SCENE_BAKE_SCALE) * SCENE_BAKE_SCALE;
			const w = Math.ceil((maxX - minX) / SCENE_BAKE_SCALE) * SCENE_BAKE_SCALE;
			const h = Math.ceil((maxY - minY) / SCENE_BAKE_SCALE) * SCENE_BAKE_SCALE;
			const canvas = new OffscreenCanvas(w / SCENE_BAKE_SCALE, h / SCENE_BAKE_SCALE);
			const bctx = canvas.getContext('2d');
			bctx.imageSmoothingEnabled = false;
			bctx.scale(1 / SCENE_BAKE_SCALE, 1 / SCENE_BAKE_SCALE);
			bctx.translate(-minX, -minY);
			bake = { version, builtAt: now, canvas, bctx, bitmap: null, x: minX, y: minY, w, h, drawn: new Set() };
			bake.frame = this.frameSerial;
			sceneBakes.set(list, bake);
			// One bake per world copy ever viewed adds up while panning across
			// parallel worlds; keep only the most recently drawn ones. Never one
			// drawn this frame: a far zoom can show more copies than the cap.
			for (const [oldList, old] of sceneBakes) {
				if (sceneBakes.size <= SCENE_BAKE_MAX) break;
				if (old.frame === this.frameSerial) continue;
				old.bitmap?.close?.();
				sceneBakes.delete(oldList);
			}
		}
		// Incremental: transferToImageBitmap empties the canvas, so the previous
		// bitmap is put back first and only the scenes that have landed since
		// are drawn on top -- a burst of worker replies costs their scenes, not
		// the whole world's again.
		const { bctx, drawn } = bake;
		const drawnBefore = drawn.size;
		if (bake.bitmap) bctx.drawImage(bake.bitmap, bake.x, bake.y, bake.w, bake.h);
		for (const scene of list) {
			if (drawn.has(scene)) continue;
			const data = PIXEL_SCENE_DATA[scene.key];
			if (!data || !inWorld(scene)) continue;
			const bitmap = getPixelSceneCanvas(scene, PIXEL_SCENE_MAX_MIP);
			if (!bitmap) continue;
			bctx.drawImage(bitmap, scene.x + relOffX, scene.y + relOffY, data.width, data.height);
			drawn.add(scene);
		}
		if (bake.bitmap) bake.bitmap.close?.();
		bake.bitmap = bake.canvas.transferToImageBitmap();
		bake.version = version;
		bake.builtAt = now;
		if (drawn.size > drawnBefore) {
			renderTrace.done('bake', `scenes +${drawn.size - drawnBefore}/${list.length}`, 'pixelScenes', performance.now() - now);
		}
		return bake;
	},

	// One screen-resolution bitmap of a world copy's PoI markers at the current
	// zoom, in draw space relative to the copy's shift.
	poiBake(list, relOffX, relOffY, zoomBucket, flags, accessibility, simpleSymbols, smallPois) {
		const z = this.cam.z;
		const key = `${flags}|${poiHighlightChecksum(list)}`;
		let bake = poiBakes.get(list);
		if (bake && bake.key === key && bake.zoomBucket === zoomBucket) return bake;
		// While the zoom is moving, a bake made within 25% of the current zoom
		// is drawn scaled rather than rebuilt every wheel step (each rebuild is
		// the whole world's markers); it is rebuilt once the zoom has settled.
		const now = performance.now();
		if (this.poiBakeZoom !== z) { this.poiBakeZoom = z; this.poiBakeZoomAt = now; }
		if (bake && bake.key === key && Math.abs(Math.log(z / bake.z)) < Math.log(1.25)
			&& now - this.poiBakeZoomAt < POI_BAKE_SETTLE_MS) {
			if (!this.poiBakeTimer) {
				this.poiBakeTimer = setTimeout(() => { this.poiBakeTimer = 0; this.draw(); }, POI_BAKE_SETTLE_MS + 10);
			}
			return bake;
		}
		let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
		const items = [];
		for (const p of list) {
			let r = getPoiRadius(p, z);
			if (smallPois) r = 5;
			const x = p.x + relOffX, y = p.y + relOffY;
			items.push([p, x, y, r]);
			const reach = r * 2;
			if (x - reach < minX) minX = x - reach;
			if (y - reach < minY) minY = y - reach;
			if (x + reach > maxX) maxX = x + reach;
			if (y + reach > maxY) maxY = y + reach;
		}
		if (!items.length) return null;
		const w = Math.ceil((maxX - minX) * z) + 2, h = Math.ceil((maxY - minY) * z) + 2;
		if (w > 8192 || h > 8192) return null;
		const canvas = new OffscreenCanvas(w, h);
		const bctx = canvas.getContext('2d');
		bctx.imageSmoothingEnabled = false;
		bctx.scale(z, z);
		bctx.translate(-minX, -minY);
		bctx.strokeStyle = '#000000AA';
		for (const [p, x, y, r] of items) {
			const color = poiColorFor(p);
			if (r * z <= POI_SPRITE_MAX_SCREEN_RADIUS) {
				const sprite = poiSprite(p, color, r, z, accessibility, simpleSymbols);
				const half = sprite.size / (2 * sprite.scale), full = sprite.size / sprite.scale;
				bctx.drawImage(sprite.bitmap, x - half, y - half, full, full);
			} else {
				bctx.beginPath();
				tracePoiShape(bctx, p, x, y, r, accessibility, simpleSymbols);
				bctx.fillStyle = color;
				bctx.fill();
				bctx.lineWidth = r * (p.highlight === true ? 0.4 : 0.08);
				bctx.stroke();
			}
		}
		if (bake && bake.bitmap) bake.bitmap.close?.();
		bake = { key, zoomBucket, z, bitmap: canvas.transferToImageBitmap(), x: minX, y: minY, w: w / z, h: h / z };
		poiBakes.set(list, bake);
		renderTrace.done('bake', `pois (${items.length})`, 'pois', performance.now() - now);
		return bake;
	},

	drawBackgroundStack(worldOffsets, viewRect, offscreen, reverse = false, prof = null) {
		const rawMap = document.getElementById('debug-original-biome-map').checked;
		const worldCenter = getWorldCenter(this.isNGP, this.gameMode) * 512;
		const worldSize = getWorldSize(this.isNGP, this.gameMode) * 512;
		const steps = [];
		// Each step is profiled under its own bucket (debug-layer-timings); the
		// prefix keeps the refill pass distinguishable from the base pass.
		const bucket = reverse ? 'bg-refill:' : 'bg:';
		steps.push(['flat', () => {
			for (let worldKey of this.worldsInView) {
				const { pwY, shiftX, shiftY } = worldOffsets[worldKey];
				this.ctx.drawImage(this.biomeBackgroundImage(pwY), shiftX, shiftY, this.w * 512, this.h * 512);
			}
		}]);
		if (!rawMap) {
			// Below ~8 screen px per chunk the tiling detail is invisible and the
			// flat per-image colors are already what the eye averages the art to.
			if (512 * this.detailZoom() >= 8) {
				const useBake = 512 * this.detailZoom() <= BACKDROP_BAKE_MAX_CHUNK_PX;
				steps.push(['backdrops', () => {
					if (!useBake && this.drawBackdropsGL()) return;
					for (let worldKey of this.worldsInView) {
						const { pwY, shiftX, shiftY } = worldOffsets[worldKey];
						const runs = pwY === 0 ? this.backdropRuns
							: pwY > 0 ? this.backdropRunsHell : this.backdropRunsHeaven;
						if (!runs) continue;
						const bake = useBake ? this.backdropBake(runs) : null;
						if (bake) {
							// The bake is minified further at the lowest zooms;
							// nearest sampling would just sparkle.
							this.ctx.imageSmoothingEnabled = true;
							this.ctx.drawImage(bake, shiftX, shiftY, this.w * 512, this.h * 512);
							this.ctx.imageSmoothingEnabled = false;
						} else {
							drawBackdropRuns(this.ctx, runs, shiftX, shiftY, viewRect);
						}
					}
				}]);
			}
			steps.push(['edges', () => this.drawBackgroundEdges(worldOffsets, viewRect, offscreen)]);
			// The static-tile structures' masked backdrops, at the same world rect
			// (and with the same PW offsets) as their tile layers. They sit with the
			// backdrops rather than with the scenes: they are the SAME sprite the
			// backdrop runs draw, only masked to a silhouette instead of filling a
			// chunk. Vertical bands are the clamped edge row repeated, so a main-world
			// structure says nothing about what is up or down there.
			steps.push(['staticTiles', () => {
				for (let worldKey of this.worldsInView) {
					const { pwX, pwY, shiftX, shiftY } = worldOffsets[worldKey];
					if (pwY !== 0) continue;
					const pwOffset = (this.isNGP || this.gameMode === 'nightmare') ? -pwX * 8 : 0;
					drawStaticTileBackdrops(this.ctx, this.tileLayers,
						shiftX + pwOffset + VISUAL_TILE_OFFSET_X,
						shiftY + VISUAL_TILE_OFFSET_Y, viewRect);
				}
			}]);
			steps.push(['sceneBgs', () => {
				for (let worldKey of this.worldsInView) {
					const { pwX, pwY, shiftX, shiftY } = worldOffsets[worldKey];
					const scenes = this.pixelScenesByPW && this.pixelScenesByPW[`${pwX},${pwY}`];
					if (!scenes) continue;
					const toDrawX = (x) => x + worldCenter - pwX * worldSize + shiftX;
					const toDrawY = (y) => y + 14 * 512 - pwY * 24576 + shiftY;
					drawSceneBackgrounds(this.ctx, scenes, toDrawX, toDrawY, viewRect, sceneBackgroundArt);
				}
			}]);
			steps.push(['globalImages', () => {
				for (let worldKey of this.worldsInView) {
					const { pwX, pwY, shiftX, shiftY } = worldOffsets[worldKey];
					const toDrawX = (x) => x + worldCenter - pwX * worldSize + shiftX;
					const toDrawY = (y) => y + 14 * 512 - pwY * 24576 + shiftY;
					drawGlobalBackgroundImages(this.ctx, toDrawX, toDrawY, viewRect);
				}
			}]);
		}
		if (reverse) steps.reverse();
		for (const [name, step] of steps) {
			step();
			if (prof) markLayer(prof, bucket + name);
		}
	},

	// The clipped backdrop run loop as one WebGL pass covering every world copy
	// in view (js/gl/backdrop_renderer.js); the zoomed-in path of the backdrops
	// step issued one drawImage per visible tile. Drawn in screen space like
	// drawTerrainGL. False when GL is off or unavailable, or before the art has
	// loaded -- the 2D run loop then draws as before.
	drawBackdropsGL() {
		if (appSettings.terrainRenderer !== 'gl' || !backgroundArtLoaded()) return false;
		if (!this.glBackdrops) this.glBackdrops = new GLBackdropRenderer();
		const ok = this.glBackdrops.ensure(
			[this.backdropRuns, this.backdropRunsHeaven, this.backdropRunsHell],
			this.w, this.h, backdropBitmap);
		if (!ok) return false;
		let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
		for (const worldKey of this.worldsInView) {
			const [pwX, pwY] = worldKey.split(',').map(Number);
			minX = Math.min(minX, pwX - this.pw); maxX = Math.max(maxX, pwX - this.pw);
			minY = Math.min(minY, pwY - this.pwVertical); maxY = Math.max(maxY, pwY - this.pwVertical);
		}
		if (minX > maxX) return true;
		const glCanvas = this.glBackdrops.render({
			frame: this.frameSerial,
			width: this.canvas.width,
			height: this.canvas.height,
			camX: this.cam.x,
			camY: this.cam.y,
			camZ: this.cam.z,
			pwVertical: this.pwVertical,
			copyRange: [minX, maxX, minY, maxY],
		});
		if (!glCanvas) return false;
		this.ctx.save();
		this.ctx.setTransform(1, 0, 0, 1, 0, 0);
		this.ctx.drawImage(glCanvas, 0, 0);
		this.ctx.restore();
		return true;
	},

	drawBackgroundEdges(worldOffsets, viewRect, offscreen) {
		if (!this.backgroundEdges) return;
		// The strips are 64 world px wide; below a few screen pixels they are not
		// worth the per-boundary work, and at that zoom the whole 70x48 map is in
		// view at once.
		if (STRIP_WORLD_PX * this.detailZoom() < 3) return;
		if (document.getElementById('debug-original-biome-map').checked) return;
		for (let worldKey of this.worldsInView) {
			const { pwY, shiftX, shiftY } = worldOffsets[worldKey];
			const edges = pwY === 0 ? this.backgroundEdges
				: pwY > 0 ? this.backgroundEdgesHell : this.backgroundEdgesHeaven;
			if (!edges) continue;
			// A strip bucketed in row r can reach one overhang into r-1 and r+1.
			const firstRow = Math.max(0, Math.floor((viewRect.top - shiftY) / 512) - 1);
			const lastRow = Math.min(this.h - 1, Math.ceil((viewRect.bottom - shiftY) / 512) + 1);
			for (let r = firstRow; r <= lastRow; r++) {
				for (const e of edges[r]) {
					const dx = shiftX + e.dx, dy = shiftY + e.dy;
					if (offscreen(dx, dy, e.dw, e.dh)) continue;
					// The real strip art when it's loaded, the flat-tinted alpha
					// mask until then.
					const strip = edgeStripArt(e) ?? tintedEdgeStrip(e.mask, e.color);
					if (!strip) continue;
					this.ctx.drawImage(strip, e.sx, e.sy, e.sw, e.sh, dx, dy, e.dw, e.dh);
				}
			}
		}
	},

	drawUnpaintedCheckerboard(worldOffsets, viewRect) {
		if (!appSettings.checkerboardUnpainted) return;
		if (!this.unpaintedMask || this.unpaintedChunkCount === 0) return;
		// Three full-screen passes (mask, pattern, blit) for what is usually --
		// with the engine terrain painting nearly every chunk -- no uncovered
		// chunk in view at all. Walk the visible chunks of each world first.
		if (viewRect && this.unpaintedCovered) {
			let any = false;
			for (let worldKey of this.worldsInView) {
				const { pwY, shiftX, shiftY } = worldOffsets[worldKey];
				if (pwY !== 0) continue;
				const cx0 = Math.max(0, Math.floor((viewRect.left - shiftX) / 512));
				const cx1 = Math.min(this.w - 1, Math.floor((viewRect.right - shiftX) / 512));
				const cy0 = Math.max(0, Math.floor((viewRect.top - shiftY) / 512));
				const cy1 = Math.min(this.h - 1, Math.floor((viewRect.bottom - shiftY) / 512));
				for (let cy = cy0; cy <= cy1 && !any; cy++) {
					for (let cx = cx0; cx <= cx1; cx++) {
						if (!this.unpaintedCovered[cy * this.w + cx]) { any = true; break; }
					}
				}
				if (any) break;
			}
			if (!any) return;
		}
		const width = this.canvas.width, height = this.canvas.height;
		if (!this.checkerScratch) this.checkerScratch = document.createElement('canvas');
		const scratch = this.checkerScratch;
		if (scratch.width !== width || scratch.height !== height) {
			scratch.width = width;
			scratch.height = height;
			this.checkerPattern = null;
		}
		const sctx = scratch.getContext('2d');
		sctx.setTransform(1, 0, 0, 1, 0, 0);
		sctx.clearRect(0, 0, width, height);
		sctx.imageSmoothingEnabled = false;
		sctx.save();
		this.setupCamera(sctx);
		for (let worldKey of this.worldsInView) {
			const { pwY, shiftX, shiftY } = worldOffsets[worldKey];
			// The mask is the main map's chunk coverage. A vertical band is the clamped
			// edge row repeated, so main-world coverage says nothing about what a band
			// chunk holds -- stamping it there checkerboarded the sky in the shape of
			// main-world biome regions.
			if (pwY !== 0) continue;
			sctx.drawImage(this.unpaintedMask, shiftX, shiftY, this.w * 512, this.h * 512);
		}
		sctx.restore();
		sctx.globalCompositeOperation = 'source-in';
		sctx.fillStyle = this.getCheckerPattern(sctx);
		sctx.fillRect(0, 0, width, height);
		sctx.globalCompositeOperation = 'source-over';

		this.ctx.save();
		this.ctx.setTransform(1, 0, 0, 1, 0, 0);
		this.ctx.drawImage(scratch, 0, 0);
		this.ctx.restore();
	},

	/** The layer-1 biome background image for a world row, honoring the raw-map debug toggle. */
	biomeBackgroundImage(pwY) {
		if (document.getElementById('debug-original-biome-map').checked) {
			return pwY === 0 ? this.offscreen : pwY > 0 ? this.offscreenHell : this.offscreenHeaven;
		}
		return pwY === 0 ? this.recolorOffscreen : pwY > 0 ? this.recolorOffscreenHell : this.recolorOffscreenHeaven;
	},

	drawNow() {
		// Panning update: Render layers for each world in view, shifted by the appropriate amount based on the PW and camera position

		// Don't draw unless things are actually loaded
		if (!this.biomeData || !this.tileLayers) return;
		// Per-layer visibility toggles and profiling, both driven by RENDER_LAYERS
		// (js/settings.js). `prof` is null unless debug-layer-timings is on, so every
		// markLayer() call below is a single null check when profiling is off.
		const L = appSettings.renderLayers;
		if (renderHud.on !== !!appSettings.debugRenderHud) {
			renderHud.setPendingSource(() => this.asyncRenderPending());
			renderHud.setStat('scenes', sceneCacheStatLine());
			renderHud.setStat('overlays', () => {
				const all = new Set(Object.values(this.tileOverlaysByPW || {}).filter(Boolean));
				let bytes = 0;
				for (const o of all) for (const b of o) bytes += (b?.width || 0) * (b?.height || 0) * 4;
				const q = overlayQueueStats();
				return `${all.size} tile overlays · ${(bytes / 1048576).toFixed(0)} MB · ${Object.keys(this.tileOverlaysByPW || {}).length} worlds mapped · ${q.inFlight} building, ${q.queued} queued`;
			});
			renderHud.setStat('bakes', () => {
				const b = sceneBakeStats();
				const g = this.glScenes?.stats();
				return `${b.count} world scene bakes · ${(b.bytes / 1048576).toFixed(0)} MB (largest ${(b.maxBytes / 1048576).toFixed(0)} MB)`
					+ (g ? `\n         GL scene atlas: ${g.pages} pages · ${(g.bytes / 1048576).toFixed(0)} MB · ${g.slots} images` : '');
			});
			renderHud.setEnabled(appSettings.debugRenderHud, document.getElementById('view'));
		}
		const prof = this.startLayerProfile();
		this.colorProbe.x = -1; // the tooltip's cached readback belongs to the old frame
		this.frameSerial++;     // ... and so does the decal probe's (decalTexelAt)
		this.scenesOnGL = false;
		this.ctx.fillStyle = '#050505';
		this.ctx.fillRect(0,0,this.canvas.width,this.canvas.height);
		if (!this.biomeData) return;

		this.ctx.save();
		this.setupCamera(this.ctx);
		
		this.ctx.imageSmoothingEnabled = false;

		// The visible rectangle in the coordinate space setupCamera() draws into,
		// used to cull draws (tile overlays, pixel scenes) that would land entirely
		// offscreen.
		const halfViewW = (this.canvas.width / 2) / this.cam.z;
		const halfViewH = (this.canvas.height / 2) / this.cam.z;
		const viewLeft = this.cam.x - halfViewW;
		const viewRight = this.cam.x + halfViewW;
		const viewTop = this.cam.y - halfViewH;
		const viewBottom = this.cam.y + halfViewH;
		const offscreen = (dx, dy, w, h) =>
			dx + w < viewLeft || dx > viewRight || dy + h < viewTop || dy > viewBottom;
		// Same rectangle in object form, for culls that live in other modules
		const viewRect = { left: viewLeft, right: viewRight, top: viewTop, bottom: viewBottom };

		// Precompute offsets by key
		const worldOffsets = {};
		for (let worldKey of this.worldsInView) {
			const [pwX, pwY] = worldKey.split(',').map(Number);
			const shiftX = pwX * 512 * this.w - this.pw * 512 * this.w;
			const shiftY = pwY * 24576 - this.pwVertical * 24576;
			worldOffsets[worldKey] = { pwX, pwY, shiftX, shiftY };
		}

		// Layer 1
		// Background biome colors
		if (L.biomeBackground) {
			this.drawBackgroundStack(worldOffsets, viewRect, offscreen, false, prof);
		}
		if (prof) markLayer(prof, 'biomeBackground');

		// Layer 2
		// Custom art background (and foreground in places without tiles)
		if (L.customArt) {
			for (let worldKey of this.worldsInView) {
				const { pwX, pwY, shiftX, shiftY } = worldOffsets[worldKey];
				if (pwY === 0) {
					if (this.ngPlusCount === 0 && this.gameMode === 'normal') {
						// TODO: Need the PW/NG+ versions of the overlay, for now disable
						if (pwX === 0) {
							if (this.surfaceOverlay) {
								this.ctx.drawImage(this.surfaceOverlay, shiftX, shiftY, this.w * 512, this.h * 512);
							}
							// Hiisi shop
							if (this.surfaceOverlayScenes && this.surfaceOverlayScenes['hiisi_hourglass_left'] && this.surfaceOverlayScenes['hiisi_hourglass_right']) {
								if (this.hiisiHourglassPosition === 'left') {
									this.ctx.drawImage(this.surfaceOverlayScenes['hiisi_hourglass_left'], shiftX + 30*512, shiftY + 24*512, 512, 576);
								}
								else if (this.hiisiHourglassPosition === 'right') {
									this.ctx.drawImage(this.surfaceOverlayScenes['hiisi_hourglass_right'], shiftX + 38*512, shiftY + 24*512, 512, 576);
								}
							}
						}
						else {
							if (this.surfaceOverlayPW) {
								this.ctx.drawImage(this.surfaceOverlayPW, shiftX, shiftY, this.w * 512, this.h * 512);
							}
						}
						// Extra overlay for just PW +/- 1
						if (pwX === -1 || pwX === 1) {
							if (this.surfaceOverlayPWAdditional) {
								this.ctx.drawImage(this.surfaceOverlayPWAdditional, shiftX, shiftY, this.w * 512, this.h * 512);
							}
						}
					}
					else if (this.ngPlusCount === 0 && this.gameMode === 'nightmare') {
						if (pwX === 0) {
							if (this.surfaceOverlayNightmare) {
								this.ctx.drawImage(this.surfaceOverlayNightmare, shiftX, shiftY, this.w * 512, this.h * 512);
							}
						}
						else {
							if (this.surfaceOverlayNightmarePW) {
								this.ctx.drawImage(this.surfaceOverlayNightmarePW, shiftX, shiftY, this.w * 512, this.h * 512);
							}
						}
					}
					else {
						if (this.ngPlusCount === 7 || this.ngPlusCount === 28) {
							if (pwX === 0) {
								if (this.surfaceOverlayNGP7) {
									this.ctx.drawImage(this.surfaceOverlayNGP7, shiftX, shiftY, this.w * 512, this.h * 512);
								}
							}
							else {
								if (this.surfaceOverlayNGP7PW) {
									this.ctx.drawImage(this.surfaceOverlayNGP7PW, shiftX, shiftY, this.w * 512, this.h * 512);
								}
							}
						}
						else if (this.ngPlusCount === 14) {
							if (pwX === 0) {
								if (this.surfaceOverlayNGP14) {
									this.ctx.drawImage(this.surfaceOverlayNGP14, shiftX, shiftY, this.w * 512, this.h * 512);
								}
							}
							else {
								if (this.surfaceOverlayNGP14PW) {
									this.ctx.drawImage(this.surfaceOverlayNGP14PW, shiftX, shiftY, this.w * 512, this.h * 512);
								}
							}
						}
						else if (this.ngPlusCount === 21) {
							if (pwX === 0) {
								if (this.surfaceOverlayNGP21) {
									this.ctx.drawImage(this.surfaceOverlayNGP21, shiftX, shiftY, this.w * 512, this.h * 512);
								}
							}
							else {
								if (this.surfaceOverlayNGP21PW) {
									this.ctx.drawImage(this.surfaceOverlayNGP21PW, shiftX, shiftY, this.w * 512, this.h * 512);
								}
							}
						}
						else {
							if (pwX === 0) {
								if (this.surfaceOverlayNGP) {
									this.ctx.drawImage(this.surfaceOverlayNGP, shiftX, shiftY, this.w * 512, this.h * 512);
								}
							}
							else {
								if (this.surfaceOverlayNGPPW) {
									this.ctx.drawImage(this.surfaceOverlayNGPPW, shiftX, shiftY, this.w * 512, this.h * 512);
								}
							}
						}
					}
				}
				else if (pwY < 0) {
					if (this.ngPlusCount === 0 && this.gameMode === 'normal') {
						if (pwX === 0) {
							if (this.skyOverlay) {
								this.ctx.drawImage(this.skyOverlay, shiftX, shiftY, this.w * 512, this.h * 512 + SKY_EXTRA_HEIGHT);
							}
						}
						else {
							if (this.skyOverlayPW) {
								this.ctx.drawImage(this.skyOverlayPW, shiftX, shiftY, this.w * 512, this.h * 512 + SKY_EXTRA_HEIGHT);
							}
						}
					}
					else if (this.ngPlusCount === 0 && this.gameMode === 'nightmare') {
						if (pwX === 0) {
							if (this.skyOverlayNightmare) {
								this.ctx.drawImage(this.skyOverlayNightmare, shiftX, shiftY, this.w * 512, this.h * 512 + SKY_EXTRA_HEIGHT);
							}
						}
						else {
							if (this.skyOverlayNightmarePW) {
								this.ctx.drawImage(this.skyOverlayNightmarePW, shiftX, shiftY, this.w * 512, this.h * 512 + SKY_EXTRA_HEIGHT);
							}
						}
					}
					else {
						if (this.ngPlusCount === 7 || this.ngPlusCount === 28) {
							if (pwX === 0) {
								if (this.skyOverlayNGP7) {
									this.ctx.drawImage(this.skyOverlayNGP7, shiftX, shiftY, this.w * 512, this.h * 512 + SKY_EXTRA_HEIGHT);
								}
							}
							else {
								if (this.skyOverlayNGP7PW) {
									this.ctx.drawImage(this.skyOverlayNGP7PW, shiftX, shiftY, this.w * 512, this.h * 512 + SKY_EXTRA_HEIGHT);
								}
							}
						}
						else if (this.ngPlusCount === 14) {
							if (pwX === 0) {
								if (this.skyOverlayNGP14) {
									this.ctx.drawImage(this.skyOverlayNGP14, shiftX, shiftY, this.w * 512, this.h * 512 + SKY_EXTRA_HEIGHT);
								}
							}
							else {
								if (this.skyOverlayNGP14PW) {
									this.ctx.drawImage(this.skyOverlayNGP14PW, shiftX, shiftY, this.w * 512, this.h * 512 + SKY_EXTRA_HEIGHT);
								}
							}
						}
						else if (this.ngPlusCount === 21) {
							if (pwX === 0) {
								if (this.skyOverlayNGP21) {
									this.ctx.drawImage(this.skyOverlayNGP21, shiftX, shiftY, this.w * 512, this.h * 512 + SKY_EXTRA_HEIGHT);
								}
							}
							else {
								if (this.skyOverlayNGP21PW) {
									this.ctx.drawImage(this.skyOverlayNGP21PW, shiftX, shiftY, this.w * 512, this.h * 512 + SKY_EXTRA_HEIGHT);
								}
							}
						}
						else {
							if (pwX === 0) {
								if (this.skyOverlayNGP) {
									this.ctx.drawImage(this.skyOverlayNGP, shiftX, shiftY, this.w * 512, this.h * 512 + SKY_EXTRA_HEIGHT);
								}
							}
							else {
								if (this.skyOverlayNGPPW) {
									this.ctx.drawImage(this.skyOverlayNGPPW, shiftX, shiftY, this.w * 512, this.h * 512 + SKY_EXTRA_HEIGHT);
								}
							}
						}
					}
				}
			}
		}
		if (prof) markLayer(prof, 'customArt');

		// Weather overlays
		if (L.atmosphere) {
			if (appSettings.customArt && this.weatherOverlays) {
				// Only applies to main world, check whether the main world is in view
				if (this.worldsInView.has('0,0')) {
					const { shiftX, shiftY } = worldOffsets['0,0'];
					let weatherOverlay;
					if (this.weather.type === 'rain' && this.weatherOverlays['rain']) {
						weatherOverlay = this.weatherOverlays['rain'];
					}
					else if (this.weather.type === 'rain_heavy' && this.weatherOverlays['rain_heavy']) {
						weatherOverlay = this.weatherOverlays['rain_heavy'];
					}
					else if (this.weather.type === 'snow' && this.weatherOverlays['snow']) {
						weatherOverlay = this.weatherOverlays['snow'];
					}
					else if (this.weather.type === 'slush' && this.weatherOverlays['slush']) {
						weatherOverlay = this.weatherOverlays['slush'];
					}
					else if (this.weather.type === 'blood' && this.weatherOverlays['blood']) {
						weatherOverlay = this.weatherOverlays['blood'];
					}
					else if (this.weather.type === 'acid' && this.weatherOverlays['acid']) {
						weatherOverlay = this.weatherOverlays['acid'];
					}
					else if (this.weather.type === 'slime' && this.weatherOverlays['slime']) {
						weatherOverlay = this.weatherOverlays['slime'];
					}
					if (weatherOverlay) {
						this.ctx.drawImage(weatherOverlay, shiftX + getWorldCenter(this.isNGP, this.gameMode) * 512 - 5*512, shiftY + 5*512 + 416, 283*32, 142*32);
					}
				}
			}

			// Darken sky with height
			if (this.pwVertical < 0) {
				const viewArea = this.getViewArea();
			
				// Calculate how dark the top and bottom of the CURRENT SCREEN should be
				// Assuming higher up = more negative Y = darker
				const maxWorldHeight = -24576 * 6; 
				const bottomFactor = Math.min(Math.max(viewArea.bottom / maxWorldHeight, 0), 1);
				const topFactor = Math.min(Math.max(viewArea.top / maxWorldHeight, 0), 1);

				this.ctx.save(); // Save the camera transform

				// Reset the context to target the physical screen pixels
				this.ctx.resetTransform(); 
				// Note: If you have an older setup that doesn't support resetTransform, 
				// use this.ctx.setTransform(1, 0, 0, 1, 0, 0);

				// Create a gradient from the physical top of the canvas (0) to the bottom (height)
				const gradient = this.ctx.createLinearGradient(0, 0, 0, this.canvas.height);

				// Top of the screen gets the topFactor, bottom gets the bottomFactor
				// Scaled by 0.8 so it doesn't become 100% pitch black at the absolute top
				gradient.addColorStop(0, `rgba(0, 0, 0, ${topFactor*0.75})`);
				gradient.addColorStop(1, `rgba(0, 0, 0, ${bottomFactor*0.75})`);

				this.ctx.fillStyle = gradient;
				this.ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);

				this.ctx.restore(); // Restore the camera transform for the rest of your rendering
			}

			// Scales
			if (this.gameMode !== 'nightmare' && this.ngPlusCount === 0) {
				const scaleOffsetX = 25*512;
				const scaleOffsetY = -256;
				for (let worldKey of this.worldsInView) {
					const { pwX, pwY, shiftX, shiftY } = worldOffsets[worldKey];
					if (pwY === 0) {
						if (pwX === 0) {
							// Scale variants based on sun/darksun gem unlocks
							if (appSettings.sunGem && appSettings.darksunGem) {
								if (this.surfaceOverlayScenes && this.surfaceOverlayScenes['scale_balanced']) {
									this.ctx.drawImage(this.surfaceOverlayScenes['scale_balanced'], shiftX + getWorldCenter(this.isNGP, this.gameMode) * 512 + scaleOffsetX, shiftY + 14*512 + scaleOffsetY, 512, 512);
								}
							}
							else if (appSettings.sunGem) {
								if (this.surfaceOverlayScenes && this.surfaceOverlayScenes['scale_light']) {
									this.ctx.drawImage(this.surfaceOverlayScenes['scale_light'], shiftX + getWorldCenter(this.isNGP, this.gameMode) * 512 + scaleOffsetX, shiftY + 14*512 + scaleOffsetY, 512, 512);
								}
							}
							else if (appSettings.darksunGem) {
								if (this.surfaceOverlayScenes && this.surfaceOverlayScenes['scale_dark']) {
									this.ctx.drawImage(this.surfaceOverlayScenes['scale_dark'], shiftX + getWorldCenter(this.isNGP, this.gameMode) * 512 + scaleOffsetX, shiftY + 14*512 + scaleOffsetY, 512, 512);
								}
							}
							else {
								if (this.surfaceOverlayScenes && this.surfaceOverlayScenes['scale_empty']) {
									this.ctx.drawImage(this.surfaceOverlayScenes['scale_empty'], shiftX + getWorldCenter(this.isNGP, this.gameMode) * 512 + scaleOffsetX, shiftY + 14*512 + scaleOffsetY, 512, 512);
								}
							}
						}
						else {
							// Broken scale otherwise
							if (this.surfaceOverlayScenes && this.surfaceOverlayScenes['scale_empty']) {
								this.ctx.drawImage(this.surfaceOverlayScenes['scale_empty'], shiftX + getWorldCenter(this.isNGP, this.gameMode) * 512 + scaleOffsetX, shiftY + 14*512 + scaleOffsetY, 512, 512);
							}
						}
					}
				}
			}

			// Moons and Suns
			if (appSettings.sunState) {
				if (this.surfaceOverlayScenes && this.surfaceOverlayScenes['sun']) {
					this.ctx.drawImage(this.surfaceOverlayScenes['sun'], getWorldCenter(this.isNGP, this.gameMode) * 512 - this.pw * getWorldSize(this.isNGP, this.gameMode) * 512 - 7.5*512, -37*512 - this.pwVertical * 24576 - 32 - 7.5*512, 16*512, 16*512);
				}
			}
			else {
				if (this.surfaceOverlayScenes && this.surfaceOverlayScenes['moon']) {
					this.ctx.drawImage(this.surfaceOverlayScenes['moon'], getWorldCenter(this.isNGP, this.gameMode) * 512 - this.pw * getWorldSize(this.isNGP, this.gameMode) * 512, -37*512 - this.pwVertical * 24576 - 32, 512, 540);
				}
			}
			if (this.gameMode !== 'nightmare') {
				// Why is it not in Nightmare? So weird.
				if (appSettings.darksunState) {
					if (this.surfaceOverlayScenes && this.surfaceOverlayScenes['darksun']) {
						this.ctx.drawImage(this.surfaceOverlayScenes['darksun'], getWorldCenter(this.isNGP, this.gameMode) * 512 - this.pw * getWorldSize(this.isNGP, this.gameMode) * 512 - 7.5*512, 87*512 - this.pwVertical * 24576 + 128 - 7.5*512, 16*512, 16*512);
					}
				}
				else {
				
					if (this.surfaceOverlayScenes && this.surfaceOverlayScenes['darkmoon']) {
						this.ctx.drawImage(this.surfaceOverlayScenes['darkmoon'], getWorldCenter(this.isNGP, this.gameMode) * 512 - this.pw * getWorldSize(this.isNGP, this.gameMode) * 512, 87*512 - this.pwVertical * 24576 + 128, 512, 512);
					}
				}
			}

			// Stars
			renderStars(this.ctx, this.seed, this.ngPlusCount, this.pw, this.pwVertical, viewRect);

			// Echoing spire (so silly, why does this even exist? no one knows)
			if (this.surfaceOverlayScenes) {
				let echoingSpireScene;
				if ((this.ngPlusCount === 0 && this.gameMode !== 'nightmare') || this.ngPlusCount === 7 || this.ngPlusCount === 28) {
					echoingSpireScene = this.surfaceOverlayScenes['echoing_spire'];
				}
				else if (this.ngPlusCount === 21) {
					echoingSpireScene = this.surfaceOverlayScenes['echoing_spire_sand'];
				}
				else {
					// Hills2 and hills will just render the same, so we don't need one specific to NG+14
					echoingSpireScene = this.surfaceOverlayScenes['echoing_spire_grass'];
				}
				if (echoingSpireScene) {
					const viewArea = this.getViewArea();
					const minPW = Math.floor(viewArea.left / (512 * this.w));
					const maxPW = Math.floor(viewArea.right / (512 * this.w));
					const minVerticalSegment = Math.floor((viewArea.top + 11*512) / (512 * 25));
					const maxVerticalSegment = Math.floor((viewArea.bottom + 11*512) / (512 * 25));
					for (let pwX = minPW; pwX <= maxPW; pwX++) {
						for (let verticalSegment = minVerticalSegment; verticalSegment <= maxVerticalSegment; verticalSegment++) {
							if (verticalSegment > 0 || verticalSegment < -pwX+1) continue;
							const posX = (getWorldCenter(this.isNGP, this.gameMode) - 25) * 512 + pwX * 512 * this.w - this.pw * 512 * this.w;
							const posY = verticalSegment * 512 * 25 - 11*512 - this.pwVertical * 24576;
							this.ctx.drawImage(echoingSpireScene, posX, posY, 512, 512*25);
						}
					}
				}
			}
		}
		if (prof) markLayer(prof, 'atmosphere');

		const showBoxes = document.getElementById('debug-show-tile-bounds').checked;
		const showPaths = document.getElementById('debug-show-path').checked;

		const biomeOverlayMode = document.getElementById('debug-biome-overlay-mode').value;

		// TODO: Layer 3
		// Tile background, needs to overwrite custom art in some places in NG+ based on a mask
		
		// TODO: Might need special mask for vertical PWs but for now I'll just not draw it there
		// The mask covers custom art where the software tiles will paint air as
		// opaque nothing, so it only draws alongside custom art. GL never draws
		// custom art (applyRendererOverrides), and its engine terrain deliberately
		// leaves air transparent so the real background stack shows through.
		if (appSettings.customArt && L.customArt && L.tileOverlays) {
			for (let worldKey of this.worldsInView) {
				const { pwY, shiftX, shiftY } = worldOffsets[worldKey];
				if (pwY === 0) {
					if (this.biomeMapAlphaMask) {
						this.ctx.drawImage(this.biomeMapAlphaMask, shiftX, shiftY, this.w * 512, this.h * 512);
					}
				}
			}
		}
		if (prof) markLayer(prof, 'alphaMask');

		// Checkerboard over chunks nothing paints, drawn after the alpha mask so the
		// mask cannot repaint an uncovered chunk with a solid biome color again.
		this.drawUnpaintedCheckerboard(worldOffsets, viewRect);
		if (prof) markLayer(prof, 'unpainted');

		// Layer 4
		// Tile data

		if (L.tileOverlays) {
			// GL terrain renderer: one full-screen WebGL2 pass replaces the per-region
			// overlay blits for every world it covers (all but heaven/hell, see
			// GLTerrainRenderer.rendersWorld). Returns null when GL is off or
			// unavailable, in which case the CPU bake below draws everything.
			const glCovers = (biomeOverlayMode !== 'none' && appSettings.terrainRenderer === 'gl')
				? this.drawTerrainGL(worldOffsets, viewRect, L.pixelScenes, prof)
				: null;
			if (prof) markLayer(prof, 'terrainGL');

			for (let worldKey of this.worldsInView) {
				const { pwX, pwY, shiftX, shiftY } = worldOffsets[worldKey];
				if (glCovers && glCovers(pwY)) continue;

				// The vertical bands are not the main world with a different tint:
				// heaven is biome-map row 0 repeated and hell is row 47, so the main
				// world's layers describe nothing that is up there. Blitting them
				// tiled the main world's central column -- mines, snowy depths,
				// jungle -- down the whole band, gated only by which pixels happened
				// to land in a the_sky / the_end column. Paint the band's own fill
				// columns instead; its wang terrain (the_sky, the_end, robobase)
				// still needs generated layers of its own, see the report in
				// scripts/reports/vertical_pw_report.md.
				if (pwY !== 0) {
					const bandFill = pwY > 0 ? this.bandFillHell : this.bandFillHeaven;
					if (bandFill) {
						this.ctx.drawImage(bandFill,
							shiftX + VISUAL_TILE_OFFSET_X, shiftY + VISUAL_TILE_OFFSET_Y,
							this.w * 512, this.h * 512);
					}
					continue;
				}

				// Hack PW offsets
				let pwOffset = 0;
				if (this.isNGP || this.gameMode === 'nightmare') {
					pwOffset = -pwX * 8;
				}
				let pwOffsetVertical = -pwY * 6;

				// Draw original tile data
				// Note: Need to remove canvas from the layers data because web workers cannot access it
				/*
				if (biomeOverlayMode === 'none') {
					for (const layer of this.tileLayers) {
						if (layer.canvas) {
							this.ctx.drawImage(layer.canvas, layer.correctedX + shiftX + pwOffset + VISUAL_TILE_OFFSET_X, layer.correctedY + shiftY + pwOffsetVertical + VISUAL_TILE_OFFSET_Y, layer.w, layer.h);
						}
					}
				}
				*/
			
				// TODO: Might need to overwrite outside the region of the map for NG+ shifts of way too much
				// This might also just fix itself when cross-world panning is implemented

				// OVERLAYS
				// Tile overlay (recolor white to biome foreground average color)

				if (biomeOverlayMode !== 'none') {
					// Generation of overlays was moved to the worker thread (hopefully working...)
					/*
					if (!this.tileOverlaysByPW[`${pwX},${pwY}`]) {
						// Major timesave in NG, we can reuse the same overlay...
						if (!this.isNGP) {
							if (this.tileOverlaysByPW[`0,${pwY}`]) {
								this.tileOverlaysByPW[`${pwX},${pwY}`] = this.tileOverlaysByPW[`0,${pwY}`];
							}
						}
						if (!this.tileOverlaysByPW[`${pwX},${pwY}`]) {
							// Generate it now (this seems like a bad idea since it will hang)
							// Use different recolor map for vertical PWs
							let recolorMapUsed = this.recolorOffscreenBuffer;
							if (pwY < 0) {
								recolorMapUsed = this.recolorOffscreenHeavenBuffer;
							}
							else if (pwY > 0) {
								recolorMapUsed = this.recolorOffscreenHellBuffer;
							}
							if (biomeOverlayMode === 'expanded') {
								this.tileOverlaysByPW[`${pwX},${pwY}`] = createTileOverlaysExpanded(this.biomeData, recolorMapUsed, this.tileLayers, pwX, pwY, this.isNGP);
							}
							else if (biomeOverlayMode === 'normal') {
								this.tileOverlaysByPW[`${pwX},${pwY}`] = createTileOverlays(this.biomeData, recolorMapUsed, this.tileLayers, pwX, pwY, this.isNGP);
							}
							else {
								this.tileOverlaysByPW[`${pwX},${pwY}`] = createTileOverlaysCheap(this.biomeData, this.tileLayers, pwX, pwY, this.isNGP);
							}
						}
					}
					*/
					if (this.tileOverlaysByPW[`${pwX},${pwY}`]) {
						for (let i = 0; i < this.tileLayers.length; i++) {
							const layer = this.tileLayers[i];
							const overlay = this.tileOverlaysByPW[`${pwX},${pwY}`][i];
						
							if (overlay) {
								// One overlay per biome region, scattered across a 70x48-chunk
								// world. Only a few can be on screen at once, so at normal zoom
								// most of these drawImage calls are entirely offscreen. The
								// Expanded mode pads its draw by the full edge-noise extent, so the cull accounts for it.
								const expanded = appSettings.enableEdgeNoise && biomeOverlayMode === 'expanded';
								const pad = expanded ? BIOME_EDGE_NOISE_PADDING_PIXELS : 0;
								if (offscreen(
									layer.correctedX + shiftX + pwOffset + VISUAL_TILE_OFFSET_X - pad,
									layer.correctedY + shiftY + pwOffsetVertical + VISUAL_TILE_OFFSET_Y - pad,
									layer.w + pad * 2, layer.h + pad * 2)) continue;

								if (expanded) {
									this.ctx.drawImage(
										overlay,
										layer.correctedX + shiftX + pwOffset + VISUAL_TILE_OFFSET_X - pad,
										layer.correctedY + shiftY + pwOffsetVertical + VISUAL_TILE_OFFSET_Y - pad,
										layer.w + pad * 2,
										layer.h + pad * 2
									);
								}
								else {
									this.ctx.drawImage(
										overlay, 
										layer.correctedX + shiftX + pwOffset + VISUAL_TILE_OFFSET_X, 
										layer.correctedY + shiftY + pwOffsetVertical + VISUAL_TILE_OFFSET_Y,
										layer.w,
										layer.h
									);
								}
							}
						}
					}
					else {
						// The only overlay request: they are drawn nowhere else, so a world
						// the GL pass covers never asks for one (~1 s of worker, ~30 MB each).
						getOrGenerateOverlay(pwX, pwY);
					}
				}
			}
		}
		if (prof) markLayer(prof, 'tileOverlays');

		// Layer 5
		// Pixel scenes
		if (L.pixelScenes) {
			// Scenes are sampled from a mip chain rather than always blitting the native
			// image, so zooming out costs a 1/16 bitmap per scene instead of a full one.
			// That replaces the old "stop drawing scenes below z 0.0625" cutoff.
			const sceneMipLevel = pixelSceneMipLevel(this.detailZoom());
			// Warm margin: half a screen on every side (see the cull below).
			const warmLeft = viewLeft - halfViewW, warmRight = viewRight + halfViewW;
			const warmTop = viewTop - halfViewH, warmBottom = viewBottom + halfViewH;
			let airErased = false;
			for (let worldKey of this.worldsInView) {
				const { pwX, pwY, shiftX, shiftY } = worldOffsets[worldKey];

				// Render pixel scenes (after overlays)
				// Hand-drawn tiles that stand in for a scene's appearance
				// (js/pixel_scene_art.js). Collected here rather than blitted in
				// place so they land on top of every scene AND on top of the
				// background refill below, which is what a stand-in has to do.
				const sceneArt = [];
				const artOn = appSettings.customArt && this.surfaceOverlayScenes;
				// A stand-in tile is 16x16 blown up over the room; once the room's own
				// pixels resolve it is the coarser picture, so it stops above this zoom
				// and the scene draws itself (js/pixel_scene_art.js). Only the stamped
				// copies -- the orb rooms' vertical-PW repeats have no scene at all, and
				// keep their tile below.
				const sceneArtOn = artOn && this.detailZoom() < SCENE_ART_MAX_ZOOM;
				if (this.pixelScenesByPW && this.pixelScenesByPW[`${pwX},${pwY}`]) {
					// Note positions of these *do not* use the tile offset
					const sceneOffX = getWorldCenter(this.isNGP, this.gameMode)*512 - pwX*getWorldSize(this.isNGP, this.gameMode)*512 + shiftX;
					const sceneOffY = 14*512 - pwY*24576 + shiftY;
					// Zoomed far out, the whole copy's scenes come from one bake (see
					// sceneBake); the loop below then only collects the art stand-ins.
					const inWorld = this.sceneInWorld(pwX, pwY);
					// With the GL scene pass the images are already in the terrain canvas
					// (drawTerrainGL); only the art stand-ins are left to collect.
					const onGL = this.scenesOnGL;
					const bake = (!onGL && !appSettings.renderEverything && 512 * this.cam.z <= SCENE_BAKE_MAX_CHUNK_PX)
						? this.sceneBake(this.pixelScenesByPW[`${pwX},${pwY}`], sceneOffX - shiftX, sceneOffY - shiftY, inWorld) : null;
					if (bake) this.ctx.drawImage(bake.bitmap, bake.x + shiftX, bake.y + shiftY, bake.w, bake.h);
					if (!onGL || sceneArtOn) for (let scene of this.pixelScenesByPW[`${pwX},${pwY}`]) {
						const drawX = scene.x + sceneOffX;
						const drawY = scene.y + sceneOffY;

						// Cull offscreen scenes before getPixelSceneCanvas(). With cosmetic
						// pixel scenes enabled this loop is roughly an order of magnitude
						// longer, and nearly all of it is offscreen. Scenes just outside
						// the view are warmed instead: their bitmaps are built in the
						// worker, so asking a margin ahead is what keeps a pan from
						// showing a scene a few frames after it scrolled in.
						const sceneData = PIXEL_SCENE_DATA[scene.key];
						if (!sceneData) continue;
						if (drawX + sceneData.width < viewLeft || drawX > viewRight ||
							drawY + sceneData.height < viewTop || drawY > viewBottom) {
							if (!onGL && !(bake && inWorld(scene)) && !(drawX + sceneData.width < warmLeft || drawX > warmRight ||
								drawY + sceneData.height < warmTop || drawY > warmBottom)) {
								warmPixelScene(scene, sceneMipLevel);
							}
							continue;
						}
						if (onGL || (bake && inWorld(scene))) {
							if (sceneArtOn) {
								const tile = sceneArtTile(scene.key, { app: this, pwX, pwY, cauldronVariation: getCauldronVariation });
								const bitmap = tile && this.surfaceOverlayScenes[tile];
								if (bitmap) sceneArt.push([bitmap, drawX, drawY, sceneData.width, sceneData.height]);
							}
							continue;
						}

						const pixelSceneCanvas = getPixelSceneCanvas(scene, sceneMipLevel);
						if (!pixelSceneCanvas) continue;
						// A scene's #000042 pixels are the engine's FORCE AIR: they erase the
						// terrain the chunk generated instead of painting over it. Punch them
						// out, so the hole is real over the engine-resolved GL terrain (which
						// paints every chunk) as well as over a fill layer. Null unless the
						// scene has air and material textures are on -- with them off the flat
						// recolor's opaque-background approximation is kept untouched.
						//
						// The mask and the scene image never touch the same pixel (a scene that
						// paints its air opaque contributes no mask), so their order is free.
						const airMask = getPixelSceneAirMask(scene, sceneMipLevel);
						if (airMask) {
							this.ctx.globalCompositeOperation = 'destination-out';
							this.ctx.drawImage(airMask, drawX, drawY, sceneData.width, sceneData.height);
							this.ctx.globalCompositeOperation = 'source-over';
							airErased = true;
						}
						// Always the full-resolution rectangle: only the source changes with the level
						this.ctx.drawImage(pixelSceneCanvas, drawX, drawY, sceneData.width, sceneData.height);

						if (sceneArtOn) {
							const tile = sceneArtTile(scene.key, { app: this, pwX, pwY, cauldronVariation: getCauldronVariation });
							const bitmap = tile && this.surfaceOverlayScenes[tile];
							if (bitmap) sceneArt.push([bitmap, drawX, drawY, sceneData.width, sceneData.height]);
						}
					}
				}

				// The scene art stand-ins, on top of every scene (the refill below
				// only reaches pixels still transparent, so it lands under them).
				for (const [bitmap, x, y, w, h] of sceneArt) this.ctx.drawImage(bitmap, x, y, w, h);

				// Orb rooms. Their tile comes from the general scene-art pass above,
				// off the general/orbroom scene each orb chunk stamps -- what is left
				// here is the two things that are not a property of that scene: the
				// vertical-PW repeat (addStaticPixelScenes only stamps chunk-based
				// scenes in vertical PW 0, so the copies below the first have no
				// scene to hang off), and the marker drawn when art is off.
				//
				// Those copies keep the tile at every zoom, unlike the pass above:
				// nothing else draws them, so a zoom gate would leave the vertical
				// worlds' orb towers empty rather than coarse.
				this.biomeData.orbs.forEach(o => {
					if (o.y < 14) return; // Skip the sky altar and pyramid top orbs

					// Main world always renders orb rooms. For vertical worlds, only bottom-map
					// orbs are repeated, and they tile every chunk (512px) downward.
					const isBottomMapChunkOrb = o.y === this.h - 1;
					const renderHere = pwY === 0 || (pwY > 0 && isBottomMapChunkOrb);
					if (!renderHere) return;
					const repeatCount = (pwY > 0 && isBottomMapChunkOrb) ? 48 : 1;

					if (artOn && this.surfaceOverlayScenes['cursed_orb_room']) {
						// k = 0 is the orb's own chunk, already covered by the scene
						// art pass wherever the scene exists; in a vertical PW it does
						// not, so the first copy is drawn here too.
						const firstK = pwY === 0 ? 1 : 0;
						for (let k = firstK; k < repeatCount; k++) {
							this.ctx.drawImage(this.surfaceOverlayScenes['cursed_orb_room'],
								o.x * 512 + shiftX, o.y * 512 + shiftY - k * 512, 512, 512);
						}
					}
					else {
						for (let k = 0; k < repeatCount; k++) {
							const ox = (o.x + 0.5) * 512 + shiftX;
							const oy = (o.y + 0.5) * 512 + shiftY - k * 512;
							// Fill in chunk entirely to overwrite any tiles underneath, since orbs break the tile rules and can appear under other PoIs
							this.ctx.fillStyle = '#ffd100';
							this.ctx.fillRect(ox - 256, oy - 256, 512, 512);
							this.ctx.fillStyle = 'rgba(255, 215, 0, 0.3)'; this.ctx.strokeStyle = '#f00';
							this.ctx.beginPath(); this.ctx.arc(ox, oy, 200, 0, Math.PI*2);
							this.ctx.lineWidth = 10; this.ctx.fill(); this.ctx.stroke();
						}
					}
				});
			}

			// Put the biome background back behind the holes the masks punched.
			// `destination-out` erases everything under the air, layer 1 included, which
			// would leave a carved room reading as two colors: page black where a scene
			// forced air, the biome background where the scene simply painted nothing.
			// `destination-over` only reaches pixels that are still transparent -- the
			// canvas is opaque everywhere else from drawNow's base fill -- so one pass
			// of the stack (it covers every world in view) refills exactly those holes.
			// Once for all worlds: per world it redrew the whole stack N times.
			//
			// Skipped when the background layer is off: then nothing is meant to be
			// behind the terrain, and forced air correctly reads as empty.
			if (airErased && L.biomeBackground) {
				// Close the scene bucket first, or the refill's first step is billed for it.
				if (prof) markLayer(prof, 'pixelScenes');
				this.ctx.globalCompositeOperation = 'destination-over';
				this.drawBackgroundStack(worldOffsets, viewRect, offscreen, true, prof);
				this.ctx.globalCompositeOperation = 'source-over';
			}

			// (The cauldron room's tile used to be blitted here from a hardcoded
			// 7*512, 10*512 that duplicated static_spawns.js's placement. It now
			// comes from js/pixel_scene_art.js, off the general/cauldron scene,
			// like any other scene-attached art.)
		}
		if (prof) markLayer(prof, 'pixelScenes');

		// Layer 5b
		// Edge decals: the sprite band the engine bakes into cell colors along
		// material borders. Drawn ABOVE the pixel scenes because the tiles carry
		// the engine's full stamp history: the terrain pass, then each scene's
		// own paint-time pass — a scene erases the terrain stamps under the
		// cells it replaces and dresses its own, so every texel left in a tile
		// belongs on top. Only the engine-resolved GL terrain has per-pixel
		// material identity to hang the pass off, hence the gate.
		if (L.tileOverlays && appSettings.edgeDecals && appSettings.engineTerrain
			&& appSettings.terrainRenderer === 'gl' && biomeOverlayMode !== 'none') {
			drawEdgeDecals(this.ctx, this, viewRect, requestEdgeDecalTiles);
			if (prof) markLayer(prof, 'edgeDecals');
		}

		// Layer 6
		// Debug overlays (tile bounds, pathfinding)

		// Draw debug boxes and paths above overlays/pixel scenes so they aren't obscured
		if (showBoxes || showPaths) {
			for (let worldKey of this.worldsInView) {
				const { pwX, pwY, shiftX, shiftY } = worldOffsets[worldKey];
				// Hack PW offsets
				let pwOffset = 0;
				if (this.isNGP || this.gameMode === 'nightmare') {
					pwOffset = -pwX * 8;
				}
				let pwOffsetVertical = -pwY * 6;

				for (const layer of this.tileLayers) {
					if (showBoxes) {
						this.ctx.lineWidth = 2; // Thinner for individual tiles
						
						for (let ty = 0; ty < layer.ymax; ty++) {
							for (let tx = 0; tx < layer.xmax; tx++) {
								const idx = ty * layer.xmax + tx;
								const tileVal = layer.tileIndices[idx];
								if (tileVal === 0) continue;

								// Root Check: We only draw the box starting from the 'first' half of a tile
								// Horizontal Root: No 0xC000 or 0x4000 flags, just the raw index (or 0x8000 for the pair)
								// Vertical Root: Top half has 0x4000 flag, but NOT 0x8000
								let isHorizontalRoot = (tileVal >= 0 && (tileVal & 0xC000) === 0);
								let isVerticalRoot = (tileVal & 0x4000) && !(tileVal & 0x8000);

								if (isHorizontalRoot || isVerticalRoot) {
									let baseIndex = tileVal;
									let colorVal = 0.0;
									if (isHorizontalRoot) {
										baseIndex = tileVal % layer.numHTiles;
										colorVal = baseIndex / layer.numHTiles;
									}
									else if (isVerticalRoot) {
										baseIndex = tileVal % layer.numVTiles;
										colorVal = baseIndex / layer.numVTiles;
									}
									
									// Visual Styling
									this.ctx.strokeStyle = `hsla(${(colorVal * 360) % 360}, 80%, 60%, 0.8)`;
									this.ctx.fillStyle = this.ctx.strokeStyle.replace('0.8', '0.15');

									const worldX = layer.correctedX + (tx * layer.tileSize * 10) + shiftX + pwOffset + VISUAL_TILE_OFFSET_X;
									const worldY = layer.correctedY + (ty * layer.tileSize * 10) - 40  + shiftY + pwOffsetVertical + VISUAL_TILE_OFFSET_Y;

									// Dimensions: Horizontal is 2x1, Vertical is 1x2
									const rectW = isHorizontalRoot ? layer.tileSize * 20 : layer.tileSize * 10;
									const rectH = isHorizontalRoot ? layer.tileSize * 10 : layer.tileSize * 20;

									this.ctx.fillRect(worldX, worldY, rectW, rectH);
									this.ctx.strokeRect(worldX, worldY, rectW, rectH);
									
									// Tile Index Label
									if (this.cam.z > 0.25) {
										this.ctx.fillStyle = 'red';
										this.ctx.font = `${layer.tileSize * 5}px monospace`;
										this.ctx.fillText(baseIndex, worldX + (layer.tileSize * 2), worldY + (layer.tileSize * 7));
									}
								}
							}
						}
					}

					if (showPaths && layer.path && layer.path.length > 0) {
						this.ctx.beginPath(); this.ctx.strokeStyle = '#FF00FF'; this.ctx.lineWidth = 5;
						const start = layer.path[0];
						this.ctx.moveTo(layer.correctedX + start.x * 10 + 5 + shiftX + pwOffset + VISUAL_TILE_OFFSET_X, layer.correctedY + start.y * 10 + 5 + shiftY + pwOffsetVertical + VISUAL_TILE_OFFSET_Y);
						for (let p of layer.path) this.ctx.lineTo(layer.correctedX + p.x * 10 + 5 + shiftX + pwOffset + VISUAL_TILE_OFFSET_X, layer.correctedY + p.y * 10 + 5 + shiftY + pwOffsetVertical + VISUAL_TILE_OFFSET_Y);
						this.ctx.stroke();
					}
				}
			}
		}
		if (prof) markLayer(prof, 'debugBoxes');

		// Layer 7
		// Secrets
		// TODO: These are only near the center and should just render with a sort of absolute position, no reason to iterate over worlds in view for this

		// Draw secret messages
		if (L.secrets) {
			renderWallMessages(this.ctx, this.isNGP, this.gameMode, this.pw, this.pwVertical);
			if (this.pwVertical === 0 && this.gameMode === 'normal') {
				/*
				if (this.pw === 0) {
					// TODO: Two of these are really in the first vertical PW in main
					renderWallMessages(this.ctx, this.isNGP);
				}
				*/
				// For now I'll leave these as is because it is kind of accurate to the game that the eyes just pop in when you enter the PW
				// Technically it's drawing two copies but it doesn't matter too much
				renderEyeMessages(this.ctx, this.eyes.east, this.pw, this.isNGP);
				renderEyeMessages(this.ctx, this.eyes.west, this.pw, this.isNGP);
			}
		}
		if (prof) markLayer(prof, 'secrets');

		// Layer 8
		// Other debug stuff maybe

		// Debug: Render background mask (looks good)
		/*
		let mask = getBackgroundMask(this.biomeData.pixels);

		if (mask) {
			this.ctx.fillStyle = 'rgba(0, 0, 0, 0.5)';
			for (let x = 0; x < this.w; x++) {
				for (let y = 0; y < this.h; y++) {
					const idx = y * this.w + x;
					const color = mask[idx];
					if (color === 1) {
						this.ctx.fillRect(x * 512, y * 512, 512, 512);
					}
				}
			}
		}
		*/

		// Local search progress display
		if (L.misc) {
			if (activeLocalSearchArea) {
				const { x, y, r } = activeLocalSearchArea;
				//console.log(`Rendering local search area at (${x}, ${y}) with radius ${r}`);
			
				// The total width and height of the searched square
				const size = r * 2;
				const topLeftX = getWorldCenter(this.isNGP, this.gameMode) * 512 - this.pw * getWorldSize(this.isNGP, this.gameMode) * 512 + x - r;
				const topLeftY = 14 * 512 - this.pwVertical * 48 * 512 + y - r;

				// Draw a semi-transparent fill
				this.ctx.fillStyle = 'rgba(0, 255, 255, 0.15)'; // Light cyan
				this.ctx.fillRect(topLeftX, topLeftY, size, size);

				// Draw a solid border 
				this.ctx.strokeStyle = 'rgba(0, 255, 255, 0.8)';
				this.ctx.lineWidth = 2; // Adjust based on your zoom level if necessary
				this.ctx.strokeRect(topLeftX, topLeftY, size, size);
			}

			// TODO: Check this with panning
			if (document.getElementById('debug-edge-noise').checked && this.debugCanvas) {
				this.ctx.drawImage(this.debugCanvas, this.debugX - this.debugCanvas.width/2 + getWorldCenter(this.isNGP, this.gameMode)*512, this.debugY - this.debugCanvas.height/2 + 14*512);
			}
		}
		if (prof) markLayer(prof, 'misc');

		// Layer 8b
		// Exact curve where the edge-noise'd biome resolver flips between two chunks'
		// biomes, sampled per screen pixel instead of per 10px tile overlay cell. Drawn
		// after the terrain layers so it reads as an overlay, but under the PoIs.
		if (appSettings.biomeBoundaryContour) {
			drawBiomeBoundaryContour(this.ctx, {
				biomeData: this.biomeData,
				isNGP: this.isNGP,
				gameMode: this.gameMode,
				useEdgeNoise: appSettings.enableEdgeNoise,
				camZ: this.cam.z,
				viewRect,
				worldsInView: this.worldsInView,
				worldOffsets,
			});
		}
		if (prof) markLayer(prof, 'boundaryContour');

		// Layer 9
		// PoIs

		// Render PoIs. Two gates for one thing: the user-facing "Hide PoIs" option,
		// and the layer switch every other pass here already has (settings.js
		// RENDER_LAYERS), which is what a scripted capture turns off.
		if (L.pois && !document.getElementById('debug-hide-pois').checked) {
			const poiAccessibility = document.getElementById('accessibility-mode').checked;
			const poiSimpleSymbols = document.getElementById('debug-simple-poi-symbols').checked;
			const poiFlags = (poiAccessibility ? 1 : 0) | (poiSimpleSymbols ? 2 : 0) | (document.getElementById('debug-small-pois').checked ? 4 : 0);
			const poiZoomBucket = Math.round(this.cam.z * 1e5);
			for (let worldKey of this.worldsInView) {
				// Skip rendering PoIs when too zoomed out (helps with lag)
				// Not really necessary with the speedups
				//if (this.cam.z < 0.03) continue;
				const { pwX, pwY, shiftX, shiftY } = worldOffsets[worldKey];
				const currentPois = this.poisByPW[`${pwX},${pwY}`];
				if (currentPois && 512 * this.cam.z <= POI_BAKE_MAX_CHUNK_PX) {
					const relOffX = -(pwX * 512 * getWorldSize(this.isNGP, this.gameMode)) + getWorldCenter(this.isNGP, this.gameMode) * 512;
					const relOffY = 14 * 512 - (pwY * 24576);
					const bake = this.poiBake(currentPois, relOffX, relOffY, poiZoomBucket, poiFlags,
						poiAccessibility, poiSimpleSymbols, document.getElementById('debug-small-pois').checked);
					if (bake) {
						this.ctx.drawImage(bake.bitmap, bake.x + shiftX, bake.y + shiftY, bake.w, bake.h);
						continue;
					}
				}
				if (currentPois) {
					for (let p of currentPois) {
						// Calculate visual position on the current map
						
						const poiColor = poiColorFor(p);

						const px = p.x - (pwX * 512 * getWorldSize(this.isNGP, this.gameMode)) + getWorldCenter(this.isNGP, this.gameMode) * 512 + shiftX;
						const py = p.y + 14 * 512 - (pwY * 24576) + shiftY; // Shift already baked into the tile spawns
						let tempRadius = getPoiRadius(p, this.cam.z);
						if (p.highlight === true) {
							this.ctx.strokeStyle = '#000000AA';
						}
						else {
							this.ctx.strokeStyle = '#000000AA';
						}

						if (document.getElementById('debug-small-pois').checked) {
							tempRadius = 5;
						}
						if (tempRadius * this.cam.z <= POI_SPRITE_MAX_SCREEN_RADIUS) {
							// The sprite is remembered on the PoI itself: rebuilding the
							// cache key per marker per frame cost more than the old path
							// draw at the overview zoom.
							let sprite = p._sprite;
							if (!sprite || p._spriteZoom !== poiZoomBucket || p._spriteFlags !== poiFlags
								|| p._spriteHl !== (p.highlight === true) || p._spriteColor !== poiColor) {
								sprite = poiSprite(p, poiColor, tempRadius, this.cam.z, poiAccessibility, poiSimpleSymbols);
								p._sprite = sprite;
								p._spriteZoom = poiZoomBucket;
								p._spriteFlags = poiFlags;
								p._spriteHl = p.highlight === true;
								p._spriteColor = poiColor;
							}
							const half = sprite.size / (2 * sprite.scale), full = sprite.size / sprite.scale;
							this.ctx.drawImage(sprite.bitmap, px - half, py - half, full, full);
							continue;
						}
						this.ctx.beginPath();
						tracePoiShape(this.ctx, p, px, py, tempRadius, poiAccessibility, poiSimpleSymbols);
						this.ctx.fillStyle = poiColor;
						this.ctx.fill();
						this.ctx.lineWidth = tempRadius * (p.highlight === true ? 0.4 : 0.08);
						this.ctx.stroke();
					}
				}
			}
		}
		if (prof) markLayer(prof, 'pois');

		if (L.misc) {
			if (this.zoomPixel) {
				const zoomPixelX = this.zoomPixel.x - (this.pw * 512 * getWorldSize(this.isNGP, this.gameMode)) + getWorldCenter(this.isNGP, this.gameMode) * 512;
				const zoomPixelY = this.zoomPixel.y + 14 * 512 - (this.pwVertical * 24576);
				this.ctx.fillStyle = '#FF0000';
				this.ctx.fillRect(zoomPixelX-1, zoomPixelY-1, 3, 3);
				this.ctx.fillStyle = '#FFFF00';
				this.ctx.fillRect(zoomPixelX, zoomPixelY, 1, 1);
			}
		}
		if (prof) markLayer(prof, 'misc');

		this.ctx.restore();

		this.finishLayerProfile(prof);

		// The whole-world bakes the zoomed-out view draws from (backdropBake,
		// sceneBake) cost 40-70 ms to build; build the main world's during idle
		// time after the first frame rather than on the first zoom-out.
		if (!this.bakesPrebuilt && !this.bakePrebuildScheduled && this.backdropRuns
			&& this.pixelScenesByPW && this.pixelScenesByPW['0,0']) {
			this.bakePrebuildScheduled = true;
			const idle = window.requestIdleCallback || ((fn) => setTimeout(fn, 200));
			idle(() => {
				this.bakePrebuildScheduled = false;
				if (!this.backdropRuns) return;
				const t0 = performance.now();
				// Either bake can decline (background art still decoding, no
				// scene bitmaps yet); then the next frame schedules another try.
				// The heaven/hell rows come into view a little past the overview
				// zoom (the view grows taller than the world), so theirs too.
				let ok = true;
				for (const runs of [this.backdropRuns, this.backdropRunsHeaven, this.backdropRunsHell]) {
					if (runs && !this.backdropBake(runs)) ok = false;
				}
				const relOffX = getWorldCenter(this.isNGP, this.gameMode) * 512;
				// The GL scene pass never draws from a scene bake.
				for (const pwY of this.scenesOnGL ? [] : [0, -1, 1]) {
					const list = this.pixelScenesByPW && this.pixelScenesByPW[`0,${pwY}`];
					if (list && !this.sceneBake(list, relOffX, 14 * 512 - pwY * 24576, this.sceneInWorld(0, pwY))) ok = false;
				}
				this.bakesPrebuilt = ok;
				renderHud.sample('idle bakes', 'main', performance.now() - t0);
			});
		}
	},

	setupCamera(ctx) {
		ctx.translate(this.canvas.width / 2, this.canvas.height / 2);
		ctx.scale(this.cam.z, this.cam.z);
		ctx.translate(-this.cam.x, -this.cam.y);
	},

	toggleAdvancedSearch() {
		const ui = document.getElementById('advanced-ui');
		ui.style.display = ui.style.display === 'block' ? 'none' : 'block';
	},

	openAdvancedSearch() {
		document.getElementById('advanced-ui').style.display = 'block';
	},

	// Elements with data-requires="a b=v" are enabled only while checkbox #a is
	// checked and select #b has value v. A fieldset disables everything inside it.
	updateOptionDependencies() {
		for (const el of document.querySelectorAll('#options-overlay [data-requires]')) {
			const met = el.dataset.requires.split(/\s+/).every(cond => {
				const [id, value] = cond.split('=');
				const input = document.getElementById(id);
				if (!input) return true;
				return value === undefined ? input.checked : input.value === value;
			});
			el.classList.toggle('requires-unmet', !met);
			if (el.tagName === 'FIELDSET') {
				el.disabled = !met;
			} else {
				for (const control of el.querySelectorAll('input, select, button')) control.disabled = !met;
			}
		}
	},

	toggleAlchemyRecipes() {
		const ui = document.getElementById('alchemy-list');
		ui.style.display = ui.style.display === 'block' ? 'none' : 'block';
		if (ui.style.display === 'block') {
			document.getElementById('alchemy-label').innerText = 'Alchemy Recipes ▲';
		}
		else {
			document.getElementById('alchemy-label').innerText = 'Alchemy Recipes ▼';
		}
	},

	gotoPOI(poi) {
		// Math adjusted for the visual map shift
		const viewX = poi.x + (getWorldCenter(this.isNGP, this.gameMode) * 512) - (this.pw * 512 * getWorldSize(this.isNGP, this.gameMode));
		const viewY = poi.y + (14 * 512) - (this.pwVertical * 24570);

		// Place to the side so it doesn't get immediately covered by the tooltip, which is centered on the screen
		if (poi.zoom) {
			this.cam.z = 5.0; // Zoom in more for important PoIs
			this.zoomPixel = { x: poi.x, y: poi.y };
		}
		else {
			this.cam.z = 0.25; // Zoom in, but not too much
		}
		this.cam.x = viewX + 100 / this.cam.z;
		this.cam.y = viewY;
		this.checkBounds();
		
		this.pinnedTooltip = poi;
		this.draw();
		
		// Position tooltip relative to map center
		const tip = document.getElementById('tooltip');
		tip.style.display = 'block';
		tip.classList.add('pinned');
		tip.style.left = '60%';
		tip.style.top = '40%';
		tip.style.transform = 'translate(-10%, -40%)';
		
		updateTooltip(null, poi, tip); 
		toggleTooltipPinned(tip, true);
	},

	async getDailyRunSeed() {
		if (!USE_DAILY_RUN_SEED) return;
		try {
			const response = await fetch('https://zptr.cc/api/noita-daily-seed');
			if (!response.ok) {
				console.log("Failed to fetch daily seed:", response.status);
				return;
			}
			const content = await response.text();
			const seedResult = parseInt(content);
			if (!isNaN(seedResult)) {
				//document.getElementById('seed').value = seedResult;
				//document.getElementById('ng').value = 0;
				//this.saveSettings();
					//this.generate(true, true);
					return seedResult;
				}
				else {
					console.error('Failed to fetch daily seed:', content);
					return null;
				}
		} catch (error) {
			console.error('Error fetching daily seed:', error);
		}
		return null;
	},

	// Exposed for the render harness: how many decal tiles are still in flight.
	// Asynchronous render work still in flight at the overlay worker: edge-decal
	// tiles and scene bitmaps. The render harnesses keep drawing until this is 0.
	asyncRenderPending() {
		return pendingEdgeDecalTiles() + pendingPixelSceneBitmaps();
	},
	edgeDecalsPending() {
		return this.asyncRenderPending();
	},

	saveSettings() {
		// Every settings control calls saveSettings() from its onchange, but the
		// draw gates read appSettings, which was only refreshed inside generate()
		// (world_manager.js). Sync here so a toggle that just redraws — engine
		// terrain, material textures, edge decals — takes effect immediately
		// instead of on the next full world regeneration.
		updateSettingsFromUI();
		const settings = {
			//seed: document.getElementById('seed').value,
			//ngPlusCount: document.getElementById('ng').value,
			//pw: document.getElementById('pw').value,
			//pwVertical: document.getElementById('pw-vertical').value,
			noMoreShuffle: document.getElementById('no-more-shuffle').checked,
			greedCurse: document.getElementById('greed-curse').checked,
			extraItemsInHolyMountain: parseInt(document.getElementById('extra-shop-items').value),
			skipCosmeticScenes: document.getElementById('skip-cosmetic-scenes').checked,
			showWandSpriteRarity: document.getElementById('show-wand-sprite-rarity').checked,
			visitedCoalmineAltShrine: document.getElementById('visited-coalmine-alt-shrine').checked,
			excludeTaikasauva: document.getElementById('exclude-taikasauva').checked,
			recolorMaterials: document.getElementById('recolor-materials').checked,
			materialTextures: document.getElementById('material-textures').checked,
			engineTerrain: document.getElementById('engine-terrain').checked,
			edgeDecals: document.getElementById('edge-decals').checked,
			clearSpawnPixels: document.getElementById('clear-spawn-pixels').checked,
			customArt: document.getElementById('custom-art').checked,
			enableStaticPixelScenes: document.getElementById('enable-static-pixel-scenes').value,
			hidePois: document.getElementById('debug-hide-pois').checked,
			poiScale: Number.parseFloat(document.getElementById('debug-poi-scale').value),
			scalePoisWithZoom: document.getElementById('debug-pois-zoom').checked,
			highlightPoiScale: Number.parseFloat(document.getElementById('debug-highlight-poi-scale').value),
			scaleHighlightedPoisWithZoom: document.getElementById('debug-highlight-pois-zoom').checked,
			originalBiomeMap: document.getElementById('debug-original-biome-map').checked,
			renderLayers: readRenderLayersFromUI(),
			terrainRenderer: document.getElementById('debug-terrain-renderer').value,
			debugLayerTimings: document.getElementById('debug-layer-timings').checked,
			debugRenderHud: document.getElementById('debug-render-hud').checked,
			renderEverything: document.getElementById('debug-render-everything').checked,
			checkerboardUnpainted: document.getElementById('debug-unpainted-checkerboard').checked,
			biomeBoundaryContour: document.getElementById('debug-biome-boundary-contour').checked,
			pixelSceneBitmapBudgetMB: Number.parseInt(document.getElementById('debug-pixel-scene-budget').value),
			enableEdgeNoise: document.getElementById('enable-edge-noise').checked,
			blockEdgeSpawns: document.getElementById('debug-block-edge-spawns').checked,
			edgeNoiseDebug: document.getElementById('debug-edge-noise').checked,
			overlayMode: document.getElementById('debug-biome-overlay-mode').value,
			showTileBounds: document.getElementById('debug-show-tile-bounds').checked,
			showPath: document.getElementById('debug-show-path').checked,
			showEnemies: document.getElementById('show-enemy-spawns').checked,
			enableHamisHints: document.getElementById('enable-hamis-hints').checked,
			gameMode: document.getElementById('game-mode').value,
			spellFlags: appSettings.spellFlags,
			//smallPois: document.getElementById('debug-small-pois').checked,
			//fixHolyMountainEdgeNoise: document.getElementById('debug-fix-holy-mountain-edge-noise').checked,
			excludeEdgeCases: document.getElementById('exclude-edge-cases').checked,
			//extraRerolls: parseInt(document.getElementById('debug-extra-rerolls').value),
			//rngInfo: document.getElementById('debug-rng-info').checked,
			accessibilityMode: document.getElementById('accessibility-mode').checked,
			simplePoiSymbols: document.getElementById('debug-simple-poi-symbols').checked,
			sunGem: appSettings.sunGem,
			darksunGem: appSettings.darksunGem,
			sunState: appSettings.sunState,
			darksunState: appSettings.darksunState,
			moonCorruptState: appSettings.moonCorruptState,
			darkmoonCorruptState: appSettings.darkmoonCorruptState,
		};
		// Unlock settings
		const unlockSettings = {};
		for (const unlock of Object.keys(UNLOCKABLES)) {
			settings[`unlock_${unlock}`] = document.getElementById(`unlock-${unlock}`).checked;
			unlockSettings[unlock] = document.getElementById(`unlock-${unlock}`).checked;
		}
		// Region settings
		for (const region of Object.keys(GENERATOR_CONFIG)) {
			// Only include regions with tiles
			if (!GENERATOR_CONFIG[region].wangFile) continue;
			settings[`region_${region}`] = document.getElementById(`region-${region}`).checked;
		}
		// Daily run nonsense
		if (this.isDaily) {
			for (const unlock of Object.keys(UNLOCKABLES)) {
				settings[`unlock_${unlock}`] = true;
			}
			this.unlocksChanged = true;
		}
		updateSettings(settings);
		syncSettingsToSearchWorker();
		syncSettingsToWorldWorker();
		syncSettingsToOverlayWorker();
		// Restore real settings to save in case they were overwritten for daily run
		if (this.isDaily) {
			for (const unlock of Object.keys(UNLOCKABLES)) {
				settings[`unlock_${unlock}`] = unlockSettings[unlock];
			}
		}
		localStorage.setItem('noitaTelescopeSettings', JSON.stringify(settings));
		console.log("Settings saved.");
		//console.log(settings);
	},

	loadSettings() {
		const settingsStr = localStorage.getItem('noitaTelescopeSettings');
		if (settingsStr) {
			try {
				const settings = JSON.parse(settingsStr);
				//document.getElementById('seed').value = settings.seed || '';
				//document.getElementById('ng').value = settings.ngPlusCount || 0;
				//document.getElementById('pw').value = settings.pw || 0;
				//document.getElementById('pw-vertical').value = settings.pwVertical || 0;
				document.getElementById('no-more-shuffle').checked = settings.noMoreShuffle || false;
				document.getElementById('greed-curse').checked = settings.greedCurse || false;
				document.getElementById('extra-shop-items').value = parseInt(settings.extraItemsInHolyMountain) || 0;
				document.getElementById('skip-cosmetic-scenes').checked = settings.skipCosmeticScenes || false;
				document.getElementById('show-wand-sprite-rarity').checked = settings.showWandSpriteRarity || false; 
				document.getElementById('visited-coalmine-alt-shrine').checked = settings.visitedCoalmineAltShrine || false;
				document.getElementById('exclude-taikasauva').checked = settings.excludeTaikasauva || false;
				document.getElementById('recolor-materials').checked = settings.recolorMaterials || false;
				// `?? true` so a settings blob saved before this option existed
				// keeps the checkbox's default-on state.
				document.getElementById('material-textures').checked = settings.materialTextures ?? true;
				document.getElementById('engine-terrain').checked = settings.engineTerrain ?? true;
				document.getElementById('edge-decals').checked = settings.edgeDecals ?? true;
				document.getElementById('clear-spawn-pixels').checked = settings.clearSpawnPixels || false;
				document.getElementById('custom-art').checked = settings.customArt || false;
				document.getElementById('enable-static-pixel-scenes').value = settings.enableStaticPixelScenes || 'all';
				document.getElementById('debug-hide-pois').checked = settings.hidePois || false;
				document.getElementById('debug-poi-scale').value = settings.poiScale || 1;
				document.getElementById('debug-poi-scale-value').textContent = `${Number.parseFloat(document.getElementById('debug-poi-scale').value).toFixed(1)}x`;
				document.getElementById('debug-pois-zoom').checked = settings.scalePoisWithZoom || false;
				document.getElementById('debug-highlight-poi-scale').value = settings.highlightPoiScale || 1;
				document.getElementById('debug-highlight-poi-scale-value').textContent = `${Number.parseFloat(document.getElementById('debug-highlight-poi-scale').value).toFixed(1)}x`;
				document.getElementById('debug-highlight-pois-zoom').checked = settings.scaleHighlightedPoisWithZoom ?? true;
				document.getElementById('debug-original-biome-map').checked = settings.originalBiomeMap || false;
				// Render layer toggles. A layer missing from an older saved blob keeps its
				// code default (see RENDER_LAYERS), and the UI is the source of truth after.
				for (const layer of RENDER_LAYERS) {
					document.getElementById(layer.id).checked = settings.renderLayers?.[layer.key] ?? layer.defaultOn;
				}
				settings.renderLayers = readRenderLayersFromUI();
				document.getElementById('debug-terrain-renderer').value = settings.terrainRenderer || 'gl';
				settings.terrainRenderer = document.getElementById('debug-terrain-renderer').value;
				document.getElementById('debug-layer-timings').checked = settings.debugLayerTimings || false;
				document.getElementById('debug-render-hud').checked = settings.debugRenderHud || false;
				document.getElementById('debug-render-everything').checked = settings.renderEverything || false;
				settings.renderEverything = document.getElementById('debug-render-everything').checked;
				document.getElementById('debug-unpainted-checkerboard').checked = settings.checkerboardUnpainted ?? true;
				settings.checkerboardUnpainted = document.getElementById('debug-unpainted-checkerboard').checked;
				document.getElementById('debug-biome-boundary-contour').checked = settings.biomeBoundaryContour ?? false;
				settings.biomeBoundaryContour = document.getElementById('debug-biome-boundary-contour').checked;
				document.getElementById('debug-pixel-scene-budget').value = settings.pixelSceneBitmapBudgetMB || 256;
				document.getElementById('enable-edge-noise').checked = settings.enableEdgeNoise || false;
				document.getElementById('debug-block-edge-spawns').checked = settings.blockEdgeSpawns || false;
				document.getElementById('debug-edge-noise').checked = settings.edgeNoiseDebug || false;
				document.getElementById('debug-biome-overlay-mode').value = settings.overlayMode || 'normal';
				document.getElementById('debug-show-tile-bounds').checked = settings.showTileBounds || false;
				document.getElementById('debug-show-path').checked = settings.showPath || false;
				document.getElementById('show-enemy-spawns').checked = settings.showEnemies || false;
				document.getElementById('enable-hamis-hints').checked = settings.enableHamisHints || false;
				document.getElementById('game-mode').value = settings.gameMode || 'normal';
				//document.getElementById('debug-small-pois').checked = settings.smallPois || false;
				//document.getElementById('debug-fix-holy-mountain-edge-noise').checked = settings.fixHolyMountainEdgeNoise || false;
				document.getElementById('exclude-edge-cases').checked = settings.excludeEdgeCases || false;
				//document.getElementById('debug-extra-rerolls').value = settings.extraRerolls || 0;
				//document.getElementById('debug-rng-info').checked = settings.rngInfo || false;
				document.getElementById('accessibility-mode').checked = settings.accessibilityMode || false;
				document.getElementById('debug-simple-poi-symbols').checked = settings.simplePoiSymbols || false;
				// Unlock settings
				for (const unlock of Object.keys(UNLOCKABLES)) {
					document.getElementById(`unlock-${unlock}`).checked = settings[`unlock_${unlock}`];
				}
				// Region settings. Migrate pre-rename keys into their current XML-filename
				// equivalents so users who had enabled/disabled biomes under the old names
				// don't silently lose those biomes from rendering after the rename.
				const REGION_KEY_MIGRATIONS = {
					tower_coalmine: 'solid_wall_tower_1',
					tower_excavationsite: 'solid_wall_tower_2',
					tower_snowcave: 'solid_wall_tower_3',
					tower_snowcastle: 'solid_wall_tower_4',
					tower_fungicave: 'solid_wall_tower_5',
					tower_rainforest: 'solid_wall_tower_6',
					tower_vault: 'solid_wall_tower_7',
					tower_crypt: 'solid_wall_tower_8',
					tower_end: 'solid_wall_tower_9',
					snowchasm: 'winter_caves',
				};
				for (const [oldKey, newKey] of Object.entries(REGION_KEY_MIGRATIONS)) {
					if (settings[`region_${newKey}`] === undefined && settings[`region_${oldKey}`] !== undefined) {
						settings[`region_${newKey}`] = settings[`region_${oldKey}`];
					}
				}
				for (const region of Object.keys(GENERATOR_CONFIG)) {
					// Only include regions with tiles
					if (!GENERATOR_CONFIG[region].wangFile) continue;
					// Missing saved value (e.g. a biome added since the settings were last
					// saved) keeps the code-default enabled state from generator_config.js.
					const saved = settings[`region_${region}`];
					if (saved === undefined) continue;
					document.getElementById(`region-${region}`).checked = saved;
					GENERATOR_CONFIG[region].enabled = saved;
				}
				this.perks = {
					noMoreShuffle: settings.noMoreShuffle || false,
					greedCurse: settings.greedCurse || false,
					extraShopItems: parseInt(settings.extraItemsInHolyMountain) || 0,
				}
				// Load spell flags
				//console.log("Loading spell flags:", settings.spellFlags || []);
				updateUsedSpellProgress(settings.spellFlags || []);
				updateSettings(settings);
				syncSettingsToSearchWorker();
				syncSettingsToWorldWorker();
				syncSettingsToOverlayWorker();
				this.unlocksChanged = true;
				console.log("Settings loaded successfully.");
			}
			catch (e) {
				console.warn('Failed to load settings:', e);
			}
		}
	},

	async loadFromURLParams() {
		const params = new URLSearchParams(window.location.search);
		if (!params.has('seed')) return;

		async function parseParam(paramName, min, max) {
			if (!params.has(paramName)) return;
			if (paramName === 'seed' && params.get(paramName) === 'daily') {
				// Special case for daily seed
				app.isDaily = true;
				return await app.getDailyRunSeed();
			};
			const paramValue = params.get(paramName);
			const parsed = Number.parseInt(paramValue, 10);
			if (Number.isNaN(parsed)) {
				console.warn(`Invalid ${paramName} in URL parameters:`, paramValue);
				params.delete(paramName);
				return;
			}
			return Math.max(min, Math.min(max, parsed));
		};

		const seedInt = await parseParam('seed', 0, 2147483647);
		const ngInt = await parseParam('ng', 0, 28);

		let gameMode = 'normal';
		if (params.has('gamemode')) {
			gameMode = params.get('gamemode');
		}

		const newURL = new URL(window.location);
		newURL.search = params.toString();
		window.history.replaceState(null, '', newURL);

		if (seedInt === undefined) return;
		document.getElementById('seed').value = seedInt;
		document.getElementById('ng').value = ngInt ?? 0;
		if (gameMode === 'normal' || gameMode === 'nightmare') {
			document.getElementById('game-mode').value = gameMode;
		}
		this.saveSettings();
		this.generate(true, true);
	}
};

const USE_DAILY_RUN_SEED = true; // Avoid spamming while debugging lol

app.init();

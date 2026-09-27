import { getDateAndTime } from "./utils.js";

// Render layers of app.drawNow(), in draw order. Each entry drives three things which
// have to stay in sync: the debug checkbox in index.html, the visibility gate around the
// matching drawNow() section, and the per-layer timing bucket it reports under.
export const RENDER_LAYERS = [
	{ key: 'biomeBackground', id: 'debug-layer-biome-background', label: 'Biome Background', defaultOn: true },
	{ key: 'customArt', id: 'debug-layer-custom-art', label: 'Custom Art', defaultOn: false },
	{ key: 'atmosphere', id: 'debug-layer-atmosphere', label: 'Weather / Sky / Stars', defaultOn: false },
	{ key: 'alphaMask', id: 'debug-layer-alpha-mask', label: 'Alpha Mask', defaultOn: false },
	{ key: 'tileOverlays', id: 'debug-layer-tile-overlays', label: 'Tile Overlays', defaultOn: true },
	{ key: 'pixelScenes', id: 'debug-layer-pixel-scenes', label: 'Pixel Scenes', defaultOn: true },
	{ key: 'debugBoxes', id: 'debug-layer-debug-boxes', label: 'Debug Boxes / Paths', defaultOn: true },
	{ key: 'secrets', id: 'debug-layer-secrets', label: 'Secrets', defaultOn: true },
	{ key: 'misc', id: 'debug-layer-misc', label: 'Misc', defaultOn: true },
	// The PoI circles already had their own timing bucket and their own 'Hide PoIs'
	// checkbox; what they lacked was a place in this list, which is the one thing a
	// scripted capture switches. A 100px opaque marker over the world is not world
	// content, and test/gl_regression.mjs was comparing one against the game's cells.
	{ key: 'pois', id: 'debug-layer-pois', label: 'Points of Interest', defaultOn: true },
];

export function defaultRenderLayers() {
	const layers = {};
	for (const layer of RENDER_LAYERS) layers[layer.key] = layer.defaultOn;
	return layers;
}

// Reads the layer checkboxes, falling back to the code defaults if the UI isn't present
// (workers import this module too, and they have no DOM).
export function readRenderLayersFromUI() {
	const layers = defaultRenderLayers();
	if (typeof document === 'undefined') return layers;
	for (const layer of RENDER_LAYERS) {
		const el = document.getElementById(layer.id);
		if (el) layers[layer.key] = el.checked;
	}
	return layers;
}

export const appSettings = {
	enableStaticPixelScenes: 'all',
	skipCosmeticScenes: true,
	enableEdgeNoise: true,
	blockEdgeSpawns: false,
	fixHolyMountainEdgeNoise: true,
	rngInfo: false,
	recolorMaterials: true,
	materialTextures: true,
	engineTerrain: true,
	edgeDecals: true,
	clearSpawnPixels: false,
	visitedCoalmineAltShrine: false,
	excludeTaikasauva: false,
	excludeEdgeCases: false, // Not yet implemented
	biomeOverlayMode: 'normal',
	showEnemies: false,
	enableHamisHints: false,
	gameMode: 'normal',
	noMoreShuffle: false,
	greedCurse: false,
	extraItemsInHolyMountain: 0,
	accessibilityMode: false,
	simplePoiSymbols: false,
	poiScale: 1,
	scalePoisWithZoom: false,
	highlightPoiScale: 1,
	scaleHighlightedPoisWithZoom: true,
	date: null,
	spellFlags: [],
	// Special flags
	sunGem: false,
	darksunGem: false,
	sunState: false,
	darksunState: false,
	// Render debug options (main thread only, but kept here so drawNow() has one source)
	renderLayers: defaultRenderLayers(),
	// Which renderer draws the tile-overlay layer: 'cpu' is the baked overlay
	// canvases (the parity reference), 'gl' is the WebGL2 terrain pass.
	terrainRenderer: 'gl',
	debugLayerTimings: false,
	// Debug: ignore every zoom-based detail cut (mip levels, backdrop/strip
	// gates, material textures, stand-in art) so a frame costs the same at any
	// zoom. Edge decals keep their 1:1 gate: below it the tile count explodes.
	renderEverything: false,
	checkerboardUnpainted: true,
	biomeBoundaryContour: false,
	// Byte budget for the pixel scene ImageBitmap + mip cache, least-recently-drawn first
	pixelSceneBitmapBudgetMB: 512,
	// UI related options are not included here, this is mainly for settings which the web workers will need
}

export function updateSettings(newSettings) {
	const spellFlags = newSettings.spellFlags ?? appSettings.spellFlags ?? [];
	// Merge instead of replace so a saved settings blob from before a layer existed
	// doesn't silently turn that layer off.
	const renderLayers = { ...appSettings.renderLayers, ...(newSettings.renderLayers ?? {}) };
    Object.assign(appSettings, newSettings);
	appSettings.date = getDateAndTime();
	appSettings.spellFlags = spellFlags;
	appSettings.renderLayers = renderLayers;
}

export function updateSettingsFromUI() {
	const newSettings = {
		enableStaticPixelScenes: document.getElementById('enable-static-pixel-scenes')?.value || 'all',
		skipCosmeticScenes: document.getElementById('skip-cosmetic-scenes')?.checked || false,
		enableEdgeNoise: document.getElementById('enable-edge-noise')?.checked || false,
		blockEdgeSpawns: document.getElementById('debug-block-edge-spawns')?.checked || false,
		fixHolyMountainEdgeNoise: document.getElementById('fix-holy-mountain-edge-noise')?.checked || true,
		rngInfo: document.getElementById('rng-info')?.checked || false,
		// `|| true` here read "false means missing" and pinned the setting on: every
		// generate() calls this (world_manager.js:93), so unchecking the box only
		// reached the pixel-scene cache and the terrain stayed recolored. `?? true`
		// keeps the "no such checkbox" default without overriding an unchecked one.
		recolorMaterials: document.getElementById('recolor-materials')?.checked ?? true,
		materialTextures: document.getElementById('material-textures')?.checked ?? true,
		engineTerrain: document.getElementById('engine-terrain')?.checked ?? true,
		edgeDecals: document.getElementById('edge-decals')?.checked ?? true,
		clearSpawnPixels: document.getElementById('clear-spawn-pixels')?.checked || false,
		visitedCoalmineAltShrine: document.getElementById('visited-coalmine-alt-shrine')?.checked || false,
		excludeTaikasauva: document.getElementById('exclude-taikasauva')?.checked || true,
		excludeEdgeCases: document.getElementById('exclude-edge-cases')?.checked || false,
		biomeOverlayMode: document.getElementById('debug-biome-overlay-mode')?.value || 'normal',
		showEnemies: document.getElementById('show-enemy-spawns')?.checked || false,
		enableHamisHints: document.getElementById('enable-hamis-hints')?.checked || false,
		gameMode: document.getElementById('game-mode')?.value || 'normal',
		noMoreShuffle: document.getElementById('no-more-shuffle')?.checked || false,
		greedCurse: document.getElementById('greed-curse')?.checked || false,
		extraItemsInHolyMountain: parseInt(document.getElementById('extra-shop-items')?.value) || 0,
		accessibilityMode: document.getElementById('accessibility-mode')?.checked || false,
		simplePoiSymbols: document.getElementById('debug-simple-poi-symbols')?.checked || false,
		poiScale: parseFloat(document.getElementById('debug-poi-scale')?.value) || 1,
		scalePoisWithZoom: document.getElementById('debug-pois-zoom')?.checked || false,
		highlightPoiScale: parseFloat(document.getElementById('debug-highlight-poi-scale')?.value) || 1,
		scaleHighlightedPoisWithZoom: document.getElementById('debug-highlight-pois-zoom')?.checked ?? true,
		renderLayers: readRenderLayersFromUI(),
		terrainRenderer: document.getElementById('debug-terrain-renderer')?.value || 'gl',
		debugLayerTimings: document.getElementById('debug-layer-timings')?.checked || false,
		debugRenderHud: document.getElementById('debug-render-hud')?.checked || false,
		renderEverything: document.getElementById('debug-render-everything')?.checked || false,
		checkerboardUnpainted: document.getElementById('debug-unpainted-checkerboard')?.checked ?? true,
		biomeBoundaryContour: document.getElementById('debug-biome-boundary-contour')?.checked ?? false,
		pixelSceneBitmapBudgetMB: parseInt(document.getElementById('debug-pixel-scene-budget')?.value) || 512,
	};
	updateSettings(newSettings);
}

export function updateSpellFlags(spells) {
	appSettings.spellFlags = spells;
	console.log(appSettings.spellFlags);
}

export function updateSpecialFlags(specialFlags) {
	appSettings.sunGem = specialFlags.sunGem ?? appSettings.sunGem;
	appSettings.darksunGem = specialFlags.darksunGem ?? appSettings.darksunGem;
	appSettings.sunState = specialFlags.sunState ?? appSettings.sunState;
	appSettings.darksunState = specialFlags.darksunState ?? appSettings.darksunState;
	console.log('Updated special flags:', {
		sunGem: appSettings.sunGem,
		darksunGem: appSettings.darksunGem,
		sunState: appSettings.sunState,
		darksunState: appSettings.darksunState,
	});
}
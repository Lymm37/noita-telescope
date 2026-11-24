import { getDateAndTime } from "./utils.js";

export const appSettings = {
	enableStaticPixelScenes: 'some',
	skipCosmeticScenes: true,
	enableEdgeNoise: true,
	blockEdgeSpawns: false,
	fixHolyMountainEdgeNoise: true,
	rngInfo: false,
	recolorMaterials: true,
	clearSpawnPixels: false,
	visitedCoalmineAltShrine: false,
	excludeTaikasauva: false,
	excludeEdgeCases: false, // Not yet implemented
	biomeOverlayMode: 'cheap',
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
	// UI related options are not included here, this is mainly for settings which the web workers will need
}

export function updateSettings(newSettings) {
	const spellFlags = newSettings.spellFlags ?? appSettings.spellFlags ?? [];
    Object.assign(appSettings, newSettings);
	appSettings.date = getDateAndTime();
	appSettings.spellFlags = spellFlags;
}

export function updateSettingsFromUI() {
	const newSettings = {
		enableStaticPixelScenes: document.getElementById('enable-static-pixel-scenes')?.value || 'some',
		skipCosmeticScenes: document.getElementById('skip-cosmetic-scenes')?.checked || false,
		enableEdgeNoise: document.getElementById('enable-edge-noise')?.checked || false,
		blockEdgeSpawns: document.getElementById('debug-block-edge-spawns')?.checked || false,
		fixHolyMountainEdgeNoise: document.getElementById('fix-holy-mountain-edge-noise')?.checked || true,
		rngInfo: document.getElementById('rng-info')?.checked || false,
		recolorMaterials: document.getElementById('recolor-materials')?.checked || true,
		clearSpawnPixels: document.getElementById('clear-spawn-pixels')?.checked || false,
		visitedCoalmineAltShrine: document.getElementById('visited-coalmine-alt-shrine')?.checked || false,
		excludeTaikasauva: document.getElementById('exclude-taikasauva')?.checked ?? false,
		excludeEdgeCases: document.getElementById('exclude-edge-cases')?.checked || false,
		biomeOverlayMode: document.getElementById('debug-biome-overlay-mode')?.value || 'cheap',
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
export const appSettings = {
	enableStaticPixelScenes: 'some',
	skipCosmeticScenes: true,
	enableEdgeNoise: false,
	fixHolyMountainEdgeNoise: true,
	rngInfo: false,
	recolorMaterials: true,
	clearSpawnPixels: false,
	visitedCoalmineAltShrine: false,
	excludeTaikasauva: true,
	excludeEdgeCases: false, // Not yet implemented
	biomeOverlayMode: 'cheap',
	// UI related options are not included here, this is mainly for settings which the web workers will need
}

export function updateSettings(newSettings) {
    Object.assign(appSettings, newSettings);
}

export function updateSettingsFromUI() {
	const newSettings = {
		enableStaticPixelScenes: document.getElementById('enable-static-pixel-scenes')?.value || 'some',
		skipCosmeticScenes: document.getElementById('skip-cosmetic-scenes')?.checked || false,
		enableEdgeNoise: document.getElementById('enable-edge-noise')?.checked || false,
		fixHolyMountainEdgeNoise: document.getElementById('fix-holy-mountain-edge-noise')?.checked || true,
		rngInfo: document.getElementById('rng-info')?.checked || false,
		recolorMaterials: document.getElementById('recolor-materials')?.checked || true,
		clearSpawnPixels: document.getElementById('clear-spawn-pixels')?.checked || false,
		visitedCoalmineAltShrine: document.getElementById('visited-coalmine-alt-shrine')?.checked || false,
		excludeTaikasauva: document.getElementById('exclude-taikasauva')?.checked || true,
		excludeEdgeCases: document.getElementById('exclude-edge-cases')?.checked || false,
		biomeOverlayMode: document.getElementById('debug-biome-overlay-mode')?.value || 'cheap',
	};
	updateSettings(newSettings);
}
import { generateBiomeData, BIOME_CONFIG } from './biome_generator.js';
import { loadPNG, loadPNGBitmap} from './png_sanitizer.js';
import { getDisplayName, loadTranslations } from './translations.js';
import { UNLOCKABLES, setUnlocks } from './unlocks.js';
import { toggleTooltipPinned, updateTooltip } from './tooltip_generator.js';
import { GENERATOR_CONFIG } from './generator_config.js';
import { generateBiomeTiles } from './tile_generator.js';
import { scanSpawnFunctions, getSpecialPoIs, prescanSpawnFunctions } from './poi_scanner.js';
import { performSearch, navigateSearch, cancelSearch, isSearchActive, clearHighlights, performLocalSearch, syncSearchWorkerData, activeLocalSearchArea, syncSettingsToSearchWorker, continueSearchSequence } from './search_manager.js';
import { TIME_UNTIL_LOADING, POI_RADIUS, CHUNK_SIZE, VISUAL_TILE_OFFSET_X, VISUAL_TILE_OFFSET_Y, MIN_CAM_Z, SKY_EXTRA_HEIGHT } from './constants.js';
import { getBiomeAtWorldCoordinates, getMaterialAtWorldCoordinates, getPWIndices, getWorldCenter, getWorldSize, getPWLimit, MATERIAL_CONTAINER_TYPES } from './utils.js';
import { renderWallMessages } from './wall_messages.js';
import { findEyeMessages, renderEyeMessages } from './eye_messages.js';
import { BIOME_COLOR_LOOKUP, createBiomeMapAlphaMask, createTileOverlays, createTileOverlaysCheap, createTileOverlaysExpanded } from './image_processing.js';
import { COALMINE_ALT_SCENES } from './pixel_scene_config.js';
import { debugBiomeEdgeNoise } from './edge_noise.js';
import { getPixelSceneCanvas, loadPixelSceneData, reloadPixelSceneCache } from './pixel_scene_generation.js';
import { addStaticPixelScenes } from './static_spawns.js';
import { NollaPrng } from './nolla_prng.js';
import { appSettings, updateSettings } from './settings.js';
import { syncWorldWorkerData, getOrGenerateWorld, syncSettingsToWorldWorker } from './world_manager.js';
import { syncOverlayWorkerData, getOrGenerateOverlay, syncSettingsToOverlayWorker, recolorPixelScenes, isOverlayPending } from './overlay_manager.js';

// Not quite ready yet
//import {getTemplePerks} from './perks.js';

export const app = {
	// TODO: A lot of these are old and unused and could probably be cleaned up
	canvas: null, 
	ctx: null, 

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

	ctxo: null, 
	// Background maps, recolored by biome
	recolorOffscreen: null,
	recolorOffscreenHeaven: null, 
	recolorOffscreenHell: null,

	// Buffer versions since we can't use getImageData
	recolorOffscreenBuffer: null,
	recolorOffscreenHeavenBuffer: null,
	recolorOffscreenHellBuffer: null,

	w: 0, h: 0, 
	biomeData: null,
	tileLayers: [],
	cam: { x: CHUNK_SIZE*35, y: CHUNK_SIZE*24, z: 0.0625 },
	drag: { on: false, lx: 0, ly: 0, startX: -10, startY: -10 },
	pinnedTooltip: null,
	pw: 0,
	pwVertical: 0,
	seed: 0,
	ngPlusCount: 0,
	isNGP: false,
	eyes: {},
	skipCosmeticScenes: false, // At some point I should make a settings file or something
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

	debugCanvas: null,
	debugX: 0, debugY: 0,
	hiisiHourglassPosition: null, // "left" or "right", set in static_spawns.js based on the generated position of the hourglass

	worldsInView: new Set(),

	init() {
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
		document.querySelector('.debug-toggle').onclick = () => this.toggleDebugOptions();
		
		document.getElementById('daily-run-button').onclick = () => {
			this.getDailyRunSeed().then(seed => {
				if (seed !== null) {
					this.seed = seed;
					document.getElementById('seed').value = this.seed;
					this.ngPlusCount = 0;
					document.getElementById('ng').value = 0;
					const url = new URL(window.location.href);
					url.searchParams.set('seed', this.seed);
					url.searchParams.set('ng', 0);
					window.history.replaceState({}, '', url.toString());
					// Set all unlocks
					const list = document.getElementById('unlocks-list');
					list.querySelectorAll('input').forEach(c => c.checked = true);
					this.saveSettings();
					this.unlocksChanged = true;
					this.generate(true, true);
					// TODO: Add some kind of warning about the daily run unlocking everything temporarily
					alert("Note that the daily run temporarily unlocks all spells, remember to sync your unlocks afterwards.");
				}
			});
		};

		// PW Controls
		// Horizontal
		const pwInput = document.getElementById('pw');
		pwInput.onchange = () => {
			this.pw = parseInt(pwInput.value) || 0;
			// Regenerate/Scan for wands/items in the new PW
			// TODO: Don't want to cancel search but not sure what to do differently
			//cancelSearch(); // Cancel any active search when changing PW
			//cancelBtn.style.display = 'none';
			this.checkBounds();
			this.generate(false, false).then(() => {
				// Rerun the search after scanning is complete to find new matches
				//cancelSearch(); // No need to cancel it here, new PW means new results anyway
				/*
				if (isSearchActive()) {
					performSearch(false, false);
					this.draw();
				}
				*/
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
			this.pwVertical = parseInt(pwInputVertical.value) || 0;
			// Regenerate/Scan for wands/items in the new PW
			// TODO: Don't want to cancel search but not sure what to do differently
			//cancelSearch(); // Cancel any active search when changing PW
			//cancelBtn.style.display = 'none';
			this.checkBounds();
			this.generate(false, false).then(() => {
				// Rerun the search after scanning is complete to find new matches
				//cancelSearch(); // No need to cancel it here, new PW means new results anyway
				/*
				if (isSearchActive()) {
					performSearch(false, false);
					this.draw();
				}
				*/
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
			this.generate(true, true);
		};
		// No longer using this button, just change the seed/NG+ count and it will auto-generate now
		document.getElementById('gen-btn').onclick = () => this.generate(true, true);

		// Perk Controls
		// TODO: For now I'm just going to do a full regen because syncing the worker threads is a pain
		document.getElementById('no-more-shuffle').onchange = () => {
			this.perks['noMoreShuffle'] = document.getElementById('no-more-shuffle').checked; 
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
			this.saveSettings();
			this.generate(true, true);
		};
		
		// Debug Controls
		
		document.getElementById('skip-cosmetic-scenes').onchange = () => {
			this.skipCosmeticScenes = document.getElementById('skip-cosmetic-scenes').checked;
			this.saveSettings();
			this.generate(false, true);
		};
		document.getElementById('exclude-taikasauva').onchange = () => {
			this.excludeTaikasauva = document.getElementById('exclude-taikasauva').checked;
			this.saveSettings();
			this.generate(false, true);
		};
		document.getElementById('debug-enable-edge-noise').onchange = () => {
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
		document.getElementById('debug-fix-holy-mountain-edge-noise').onchange = () => {this.saveSettings(); this.generate(true, true);};
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
		document.getElementById('debug-biome-overlay-mode').onchange = () => {
			this.saveSettings();
			this.tileOverlaysByPW = {}; // Clear cached overlays so they will be regenerated with the new mode
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
		document.getElementById('search-prev').onclick = () => navigateSearch(-1);
		document.getElementById('search-next').onclick = () => navigateSearch(1);
		const cancelBtn = document.getElementById('cancel-search');
		cancelBtn.onclick = () => { 
			cancelSearch();
			this.setLoading(false); // Clear overlay immediately on cancel
			this.draw();
		};
		//document.getElementById('search-all-pw').onchange = () => {};
		const setPWMaxButton = document.getElementById('pw-set-max');
		setPWMaxButton.onclick = () => {
			document.getElementById('search-all-pw').checked = true;
			document.getElementById('search-pw-limit').value = getPWLimit(this.isNGP);

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


		// Event Handlers

		// Upload flags folder for unlocks
		document.getElementById('unlock-folder-picker').addEventListener('change', async (event) => {
			const fileList = event.target.files;

			const foundFlags = new Set();

			for (const file of fileList) {
				let name = file.name.toLowerCase();
				// Standard Noita flag prefix
				if (name.startsWith("card_unlocked_")) {
					name = name.replace("card_unlocked_", "");
				}
				foundFlags.add(name);
			}

			Object.keys(UNLOCKABLES).forEach(flagKey => {
				const checkbox = document.getElementById(`unlock-${flagKey}`);
				checkbox.checked = foundFlags.has(flagKey);
			});

			// Almost forgot about this
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
					this.debugX = Math.floor((e.clientX - rect.left - this.canvas.width / 2) / this.cam.z + this.cam.x - getWorldCenter(this.isNGP) * 512);
					this.debugY = Math.floor((e.clientY - rect.top - this.canvas.height / 2) / this.cam.z + this.cam.y - 14 * 512);
					console.log(`Clicked at world coordinates: (${this.debugX}, ${this.debugY})`);
					this.debugCanvas = document.getElementById('debug-noise-canvas');
					this.debugCanvas.width = 512; 
					this.debugCanvas.height = 512;
					let dx = this.debugX - this.debugCanvas.width/2;
					let dy = this.debugY - this.debugCanvas.height/2;
					debugBiomeEdgeNoise(this.debugCanvas, dx, dy, false);
					this.draw();
				}

				if (!pinchange && document.getElementById('local-search-mode').value !== 'off') {
					const localSearchMode = document.getElementById('local-search-mode').value;
					//const localSearchRadius = parseInt(document.getElementById('search-radius-num').value) || 20;
					const rect = document.getElementById('view').getBoundingClientRect();
					const x = Math.floor((e.clientX - rect.left - this.canvas.width / 2) / this.cam.z + this.cam.x) + this.pw * 512 * getWorldSize(this.isNGP) - getWorldCenter(this.isNGP) * 512;
					const y = Math.floor((e.clientY - rect.top - this.canvas.height / 2) / this.cam.z + this.cam.y) + this.pwVertical * 512 * 48 - 14 * 512;
					console.log(`Performing local search at world coordinates: (${x}, ${y}) with mode ${localSearchMode}`);
					performLocalSearch(localSearchMode, x, y);
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
				if (this.cam.x < 0 && this.pw > -getPWLimit(this.isNGP)) {
					this.cam.x += getWorldSize(this.isNGP) * 512;
					pwChange.x = -1;
				}
				if (this.cam.x > getWorldSize(this.isNGP) * 512 && this.pw < getPWLimit(this.isNGP)) {
					this.cam.x -= getWorldSize(this.isNGP) * 512;
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
					/*
					if (isSearchActive()) {
						clearHighlights(); // Clear without canceling
					}
					*/
					this.pw += pwChange.x;
					this.pwVertical += pwChange.y;
					// Can I do this without triggering the change events?
					document.getElementById('pw').value = this.pw;
					document.getElementById('pw-vertical').value = this.pwVertical;
					this.generate(false, false);
					// Attempt to re-search in new PW
					/*
					if (isSearchActive()) {
						performSearch(false, false);
					}
					*/
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
				searchButton.innerText = 'Find';
				searchButton.disabled = false;
			}
			else {
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
		// Mana Max (0 - 3000)
		this.initDualSlider('mana', 0, 5000, 10);
		// Mana Charge Speed (0 - 3000)
		this.initDualSlider('manarech', 0, 5000, 10);
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
		Object.keys(UNLOCKABLES).sort().forEach(key => {
			const div = document.createElement('div');
			div.className = 'unlock-item';
			const cb = document.createElement('input');
			cb.type = 'checkbox'; cb.value = key; cb.id = `unlock-${key}`;
			const label = document.createElement('label');
			label.htmlFor = `unlock-${key}`;
			label.innerText = key.split('_').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
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
		setUnlocks([]); // Initialize with no unlocks
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

	getHitObject(e) {
		if (!this.biomeData) return null;
		if (document.getElementById('debug-hide-pois').checked) return null;
		const rect = document.getElementById('view').getBoundingClientRect();
		const wx = (e.clientX - rect.left - this.canvas.width / 2) / this.cam.z + this.cam.x;
		const wy = (e.clientY - rect.top - this.canvas.height / 2) / this.cam.z + this.cam.y;

		const [mousePWX, mousePWY] = getPWIndices(wx, wy, this.pw, this.pwVertical, this.isNGP);
		// Check cached PoIs for the current Parallel World
		for (const worldKey of this.worldsInView) {
			// Add a quick bounds check before doing the more expensive distance calculation
			const [pwX, pwY] = worldKey.split(',').map(Number);
			if (mousePWX !== pwX || mousePWY !== pwY) continue;

			const shiftX = pwX * 512 * this.w - this.pw * 512 * this.w;
			const shiftY = pwY * 24576 - this.pwVertical * 24576;

			// Check Orbs
			let hit = this.biomeData.orbs.find(o => {
				const ox = (o.x + 0.5) * BIOME_CONFIG.CHUNK_SIZE + shiftX;
				const oy = (o.y + 0.5) * BIOME_CONFIG.CHUNK_SIZE + shiftY;
				return Math.sqrt((ox - wx) ** 2 + (oy - wy) ** 2) < BIOME_CONFIG.CHUNK_SIZE / 2;
			});

			if (hit) {
				return {...hit, x: hit.x + this.w*pwX};
			}

			const currentPois = this.poisByPW[`${pwX},${pwY}`];
			if (!currentPois) continue;
			const poiHit = currentPois.find(p => {
				const px = p.x + getWorldCenter(this.isNGP) * 512 - this.pw * 512 * this.w;
				const py = p.y + 14 * 512 - this.pwVertical * 24576;
				let tempRadius = POI_RADIUS;
				if (p.highlight) {
					tempRadius = POI_RADIUS / this.cam.z;
					if (tempRadius < POI_RADIUS) tempRadius = POI_RADIUS;
				}
				return Math.sqrt((px - wx) ** 2 + (py - wy) ** 2) < tempRadius;
			});
			if (poiHit) return poiHit;
		}
		return null;
	},

	hover(e) {
		if (this.biomeData) {
			const rect = document.getElementById('view').getBoundingClientRect();
			const wx = (e.clientX - rect.left - this.canvas.width/2) / this.cam.z + this.cam.x;
			const wy = (e.clientY - rect.top - this.canvas.height/2) / this.cam.z + this.cam.y;
			
			const coordsDiv = document.getElementById('coords');
			coordsDiv.style.display = 'block';
			coordsDiv.style.left = (e.clientX - rect.left + 15) + 'px';
			coordsDiv.style.top = (e.clientY - rect.top - 25) + 'px';
			
			// Absolute coordinate math
			const absX = Math.floor(wx - 512*getWorldCenter(this.isNGP)) + (this.pw * 512 * getWorldSize(this.isNGP));
			const absY = Math.floor(wy - 512*14 + (this.pwVertical * 512 * 48));
			let biomeName = '';
			// Get biome
			const biomeResult = getBiomeAtWorldCoordinates(this.biomeData, absX, absY, this.isNGP);
			if (biomeResult && biomeResult.biome) {
				biomeName = `<br>Biome: ${getDisplayName(biomeResult.biome)}`;
			}
			let materialName = '';
			if (this.tileLayers && this.tileLayers.length > 0 && this.pixelScenesByPW && this.pixelScenesByPW[`${this.pw},${this.pwVertical}`]) {
				// Get material
				const material = getMaterialAtWorldCoordinates(this.tileLayers, this.pixelScenesByPW[`${this.pw},${this.pwVertical}`], absX, absY, this.pw, this.pwVertical, this.isNGP);
				if (material) {
					materialName = `<br>Material: ${getDisplayName(material)}`;
				}
			}
			coordsDiv.innerHTML = `${absX}, ${absY}${biomeName}${materialName}`;

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

	async preload() {
		this.setLoading(true, "Loading Assets...");
		this.loadSettings();
		await loadTranslations();
		try {
			this.baseBiomeMapNG0 = await loadPNG('../data/biome_maps/biome_map.png');
			this.baseBiomeMapNGP = await loadPNG('../data/biome_maps/biome_map_newgame_plus.png');
		} catch(e) { console.error("Base assets failed to load."); console.error(e); }
		console.log("Loading pixel scene data...");
		// Preload pixel scenes
		await loadPixelSceneData();
		//console.log("Finished loading pixel scene data.");

		if (document.getElementById('custom-art').checked) {
			await this.getSurfaceOverlays();
		}
		// Queue up the main few worlds for loading
		this.worldsInView = new Set(['0,0']);
		//this.worldsInView = new Set(['0,0', '-1,0', '1,0', '0,-1', '0,1', '-1,-1', '-1,1', '1,-1', '1,1']);
		this.setLoading(false);
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

		if (tiles) {
			// Reset existing tile and spawn data since we're doing a full generation, and we don't want old data hanging around
			this.tileLayers = null;
			this.pixelScenesByPW = {};
			this.poisByPW = {};
			this.tileOverlaysByPW = {};
			this.worldsInView = new Set(['0,0']);
			// If generating tiles for the first time, reset the position so that the overlays are actually generated properly!
			this.pw = 0;
			this.pwVertical = 0;
			document.getElementById('pw').value = 0;
			document.getElementById('pw-vertical').value = 0;
			this.cam.x = CHUNK_SIZE*getWorldCenter(this.isNGP);
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
		document.getElementById('search-pw-limit').max = getPWLimit(this.isNGP);
		if (document.getElementById('search-pw-limit').value > getPWLimit(this.isNGP)) {
			document.getElementById('search-pw-limit').value = getPWLimit(this.isNGP);
		}
		if (this.pw > getPWLimit(this.isNGP)) {
			this.pw = getPWLimit(this.isNGP);
			document.getElementById('pw').value = getPWLimit(this.isNGP);
		}
		else if (this.pw < -getPWLimit(this.isNGP)) {
			this.pw = -getPWLimit(this.isNGP);
			document.getElementById('pw').value = -getPWLimit(this.isNGP);
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
			document.querySelectorAll('#unlocks-list input:checked').forEach(c => checkedUnlocks.push(c.value));
			setUnlocks(checkedUnlocks);
			rescan = true; // If unlocks changed, we need to rescan spawn functions even if tiles didn't change, since some spawns are gated behind unlocks
			this.unlocksChanged = false; // Reset flag
		}

		// 1. FULL GENERATION (Only if seed/NG changed)
		if (tiles) {
			//const noMoreShuffle = this.perks['noMoreShuffle'] || false;
			const base = (this.isNGP ? this.baseBiomeMapNGP.data : this.baseBiomeMapNG0.data);
			if (!base) {
				this.setLoading(false);
				return;
			}

			this.w = (this.isNGP ? BIOME_CONFIG.W_NGP : BIOME_CONFIG.W_NG0); // This is redundant
			this.h = (this.isNGP ? BIOME_CONFIG.H_NGP : BIOME_CONFIG.H_NG0); // This is redundant

			this.biomeData = generateBiomeData(seedVal, ngVal, base, this.w, this.h);
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
				global_extra_rerolls
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
			this.biomeMapAlphaMask = createBiomeMapAlphaMask(this.biomeData, getWorldSize(this.isNGP), 48);

			// Prescan spawn functions for generated tiles, only needs to be done once per seed/NG+ combination, not every time PW or perks change
			this.tileSpawns = prescanSpawnFunctions(this.tileLayers, this.isNGP);
			// Reset spawns
			this.pixelScenesByPW = {};
			this.poisByPW = {};
			this.tileOverlaysByPW = {};

			//console.log("Synching data to workers...");
			syncSearchWorkerData();
			syncWorldWorkerData();
			syncOverlayWorkerData();
			//console.log("Synced data to workers.");

			// Do initial overlay generation just for the main world since we need it for the initial render.
			// Other worlds can be handled by workers asynchronously
			const biomeOverlayMode = document.getElementById('debug-biome-overlay-mode').value;
			if (!this.tileOverlaysByPW[`0,0`]) {
				let recolorMapUsed = this.recolorOffscreenBuffer;
				if (biomeOverlayMode === 'expanded') {
					this.tileOverlaysByPW[`0,0`] = createTileOverlaysExpanded(this.biomeData, recolorMapUsed, this.tileLayers, 0, 0, this.isNGP);
				}
				else if (biomeOverlayMode === 'normal') {
					this.tileOverlaysByPW[`0,0`] = createTileOverlays(this.biomeData, recolorMapUsed, this.tileLayers, 0, 0, this.isNGP);
				}
				else {
					this.tileOverlaysByPW[`0,0`] = createTileOverlaysCheap(this.biomeData, this.tileLayers, 0, 0, this.isNGP);
				}
			}
		}

		if (rescan) cancelSearch(); // Cancel any active search when changing perks (might need to adjust this later)

		// 2. SPAWN FUNCTION SCANNING

		if (rescan || !this.pixelScenesByPW[`${this.pw},${this.pwVertical}`] || !this.poisByPW[`${this.pw},${this.pwVertical}`]) {
			const scanResults = scanSpawnFunctions(this.biomeData, this.tileSpawns, this.seed, this.ngPlusCount, this.pw, this.pwVertical, this.skipCosmeticScenes, this.perks);
			this.pixelScenesByPW[`${this.pw},${this.pwVertical}`] = scanResults.finalPixelScenes;
			const specialPoIs = getSpecialPoIs(this.biomeData, this.seed, this.ngPlusCount, this.pw, this.pwVertical, this.perks);
			this.poisByPW[`${this.pw},${this.pwVertical}`] = scanResults.generatedSpawns.concat(specialPoIs);
		
			// Static pixel scenes (stupid)
			if (document.getElementById('enable-static-pixel-scenes').value !== 'off') {
				const staticPixelScenesResults = addStaticPixelScenes(this.seed, this.ngPlusCount, this.pw, this.pwVertical, this.biomeData, this.skipCosmeticScenes, this.perks);
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
		getOrGenerateOverlay(pwX, pwY);
		
		// Blocking version
		/*
		if (!this.pixelScenesByPW[`${pwX},${pwY}`] || !this.poisByPW[`${pwX},${pwY}`]) {
			const scanResults = scanSpawnFunctions(this.biomeData, this.tileSpawns, this.seed, this.ngPlusCount, pwX, pwY, this.skipCosmeticScenes, this.perks);
			this.pixelScenesByPW[`${pwX},${pwY}`] = scanResults.finalPixelScenes;
			const specialPoIs = getSpecialPoIs(this.biomeData, this.seed, this.ngPlusCount, pwX, pwY, this.perks);
			this.poisByPW[`${pwX},${pwY}`] = scanResults.generatedSpawns.concat(specialPoIs);
		
			// Static pixel scenes (stupid)
			if (document.getElementById('enable-static-pixel-scenes').value !== 'off') {
				const staticPixelScenesResults = addStaticPixelScenes(this.seed, this.ngPlusCount, pwX, pwY, this.biomeData, this.skipCosmeticScenes, this.perks);
				this.pixelScenesByPW[`${pwX},${pwY}`] = this.pixelScenesByPW[`${pwX},${pwY}`].concat(staticPixelScenesResults.pixelScenes);
				this.poisByPW[`${pwX},${pwY}`] = this.poisByPW[`${pwX},${pwY}`].concat(staticPixelScenesResults.pois);
			}
		}
		*/
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
		
		for (let i = 0; i < this.biomeData.pixels.length; i++) {
			let color = this.biomeData.pixels[i] & 0xFFFFFF;
			let isSurfaceBiome = false;
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
					}
				}
				else {
					color = BIOME_COLOR_LOOKUP[color];
				}
				
				
			}
			
			
			id.data[i*4+0] = (color >> 16) & 0xFF;
			id.data[i*4+1] = (color >> 8) & 0xFF;
			id.data[i*4+2] = color & 0xFF;
			id.data[i*4+3] = 255;
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
			heavenData.data[i*4+0] = id.data[(i*4+0)%(this.w*4)];
			heavenData.data[i*4+1] = id.data[(i*4+1)%(this.w*4)];
			heavenData.data[i*4+2] = id.data[(i*4+2)%(this.w*4)];
			heavenData.data[i*4+3] = 255;
			this.recolorOffscreenHeavenBuffer[i*3+0] = id.data[(i*4+0)%(this.w*4)];
			this.recolorOffscreenHeavenBuffer[i*3+1] = id.data[(i*4+1)%(this.w*4)];
			this.recolorOffscreenHeavenBuffer[i*3+2] = id.data[(i*4+2)%(this.w*4)];
		}
		ctxHeaven.putImageData(heavenData, 0, 0);
		
		this.recolorOffscreenHell.width = this.w;
		this.recolorOffscreenHell.height = this.h;
		const ctxHell = this.recolorOffscreenHell.getContext('2d');
		const hellData = ctxHell.createImageData(this.w, this.h);
		for (let i = 0; i < this.biomeData.hellPixels.length; i++) {
			const color = this.biomeData.hellPixels[i] & 0xFFFFFF;
			const recolor = BIOME_COLOR_LOOKUP[color] || color;
			hellData.data[i*4+0] = (recolor >> 16) & 0xFF;
			hellData.data[i*4+1] = (recolor >> 8) & 0xFF;
			hellData.data[i*4+2] = recolor & 0xFF;
			hellData.data[i*4+3] = 255;
			this.recolorOffscreenHellBuffer[i*3+0] = (recolor >> 16) & 0xFF;
			this.recolorOffscreenHellBuffer[i*3+1] = (recolor >> 8) & 0xFF;
			this.recolorOffscreenHellBuffer[i*3+2] = recolor & 0xFF;
		}
		ctxHell.putImageData(hellData, 0, 0);
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

		
		this.surfaceOverlayScenes = {
			"hiisi_hourglass_left": await loadPNGBitmap('../data/biome_maps/custom/hiisi_hourglass_left.png'),
			"hiisi_hourglass_right": await loadPNGBitmap('../data/biome_maps/custom/hiisi_hourglass_right.png'),
			"orb_room": await loadPNGBitmap('../data/biome_maps/custom/orb_room.png'),
			"cursed_orb_room": await loadPNGBitmap('../data/biome_maps/custom/cursed_orb_room.png'),
			"echoing_spire": await loadPNGBitmap('../data/biome_maps/custom/echoing_spire.png'),
		};
		
		
	},

	getViewArea() {
		const zoomMultiplier = 0.75; // Makes the view area considered slightly larger than the screen so that loading can happen before reaching the edge
		const worldShiftX = this.pw * 512 * getWorldSize(this.isNGP);
		const worldShiftY = this.pwVertical * 24576; // 512 * 48
		const left = worldShiftX + this.cam.x - (this.canvas.width / 2) / (this.cam.z * zoomMultiplier);
		const right = worldShiftX + this.cam.x + (this.canvas.width / 2) / (this.cam.z * zoomMultiplier);
		const top = worldShiftY + this.cam.y - (this.canvas.height / 2) / (this.cam.z * zoomMultiplier);
		const bottom = worldShiftY + this.cam.y + (this.canvas.height / 2) / (this.cam.z * zoomMultiplier);
		return { left, right, top, bottom };
	},

	checkBounds() {
		const worldWidth = getWorldSize(this.isNGP) * 512;
		const worldHeight = 24576; // 512 * 48
		const viewArea = this.getViewArea();
		const prevWorldsInView = this.worldsInView ? this.worldsInView : new Set();
		this.worldsInView = new Set();
		for (let x = Math.floor(viewArea.left/worldWidth); x <= Math.floor(viewArea.right/worldWidth); x++) {
			for (let y = Math.floor(viewArea.top/worldHeight); y <= Math.floor(viewArea.bottom/worldHeight); y++) {
				// We have to set limits here...
				if (x < -getPWLimit(this.isNGP) || x > getPWLimit(this.isNGP) || y < -683 || y > 683) continue;
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
	},

	draw() {
		// Panning update: Render layers for each world in view, shifted by the appropriate amount based on the PW and camera position

		// Don't draw unless things are actually loaded
		if (!this.biomeData || !this.tileLayers) return;
		//const t0 = performance.now();
		this.ctx.fillStyle = '#050505';
		this.ctx.fillRect(0,0,this.canvas.width,this.canvas.height);
		if (!this.biomeData) return;

		this.ctx.save();
		this.setupCamera(this.ctx);
		
		this.ctx.imageSmoothingEnabled = false;

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
		for (let worldKey of this.worldsInView) {
			const { pwX, pwY, shiftX, shiftY } = worldOffsets[worldKey];
			if (document.getElementById('debug-original-biome-map').checked) {
				if (pwY === 0) {
					this.ctx.drawImage(this.offscreen, shiftX, shiftY, this.w * 512, this.h * 512);
				}
				else if (pwY > 0) {
					this.ctx.drawImage(this.offscreenHell, shiftX, shiftY, this.w * 512, this.h * 512);
				}
				else {
					this.ctx.drawImage(this.offscreenHeaven, shiftX, shiftY, this.w * 512, this.h * 512);
				}
			} else {
				if (pwY === 0) {
					this.ctx.drawImage(this.recolorOffscreen, shiftX, shiftY, this.w * 512, this.h * 512);
				}
				else if (pwY > 0) {
					this.ctx.drawImage(this.recolorOffscreenHell, shiftX, shiftY, this.w * 512, this.h * 512);
				}
				else {
					this.ctx.drawImage(this.recolorOffscreenHeaven, shiftX, shiftY, this.w * 512, this.h * 512);
				}
			}
		}

		// Layer 2
		// Custom art background (and foreground in places without tiles)
		for (let worldKey of this.worldsInView) {
			const { pwX, pwY, shiftX, shiftY } = worldOffsets[worldKey];
			if (pwY === 0) {
				if (this.ngPlusCount === 0) {
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
				if (this.ngPlusCount === 0) {
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

		// Echoing spire (so silly, why does this even exist? no one knows)
		if (this.surfaceOverlayScenes && this.surfaceOverlayScenes['echoing_spire']) {
			const viewArea = this.getViewArea();
			const minPW = Math.floor(viewArea.left / (512 * this.w));
			const maxPW = Math.floor(viewArea.right / (512 * this.w));
			const minVerticalSegment = Math.floor((viewArea.top + 11*512) / (512 * 25));
			const maxVerticalSegment = Math.floor((viewArea.bottom + 11*512) / (512 * 25));
			for (let pwX = minPW; pwX <= maxPW; pwX++) {
				for (let verticalSegment = minVerticalSegment; verticalSegment <= maxVerticalSegment; verticalSegment++) {
					if (verticalSegment > 0 || verticalSegment < -pwX+1) continue;
					const posX = (getWorldCenter(this.isNGP) - 25) * 512 + pwX * 512 * this.w - this.pw * 512 * this.w;
					const posY = verticalSegment * 512 * 25 - 11*512 - this.pwVertical * 24576;
					this.ctx.drawImage(this.surfaceOverlayScenes['echoing_spire'], posX, posY, 512, 512*25);
				}
			}
		}

		const showBoxes = document.getElementById('debug-show-tile-bounds').checked;
		const showPaths = document.getElementById('debug-show-path').checked;

		const biomeOverlayMode = document.getElementById('debug-biome-overlay-mode').value;

		// TODO: Layer 3
		// Tile background, needs to overwrite custom art in some places in NG+ based on a mask
		
		// TODO: Might need special mask for vertical PWs but for now I'll just not draw it there
		for (let worldKey of this.worldsInView) {
			const { pwX, pwY, shiftX, shiftY } = worldOffsets[worldKey];
			if (pwY === 0) {
				if (this.biomeMapAlphaMask) {
					this.ctx.drawImage(this.biomeMapAlphaMask, shiftX, shiftY, this.w * 512, this.h * 512);
				}
			}
		}

		// Layer 4
		// Tile data

		for (let worldKey of this.worldsInView) {
			const { pwX, pwY, shiftX, shiftY } = worldOffsets[worldKey];

			// Hack PW offsets
			let pwOffset = 0;
			if (this.isNGP) {
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
							if (document.getElementById('debug-enable-edge-noise').checked && biomeOverlayMode === 'expanded') {
								this.ctx.drawImage(
									overlay, 
									layer.correctedX + shiftX + pwOffset + VISUAL_TILE_OFFSET_X - 40, 
									layer.correctedY + shiftY + pwOffsetVertical + VISUAL_TILE_OFFSET_Y - 40,
									layer.w+80,
									layer.h+80
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
					// Check if there is an existing overlay request pending. If not, request it.
					// Normally this does not need to be done, but race conditions can sometimes break it
					/*
					if (!isOverlayPending(pwX, pwY)) {
						console.log(`Requesting overlay for PW ${pwX}, ${pwY} to fix race condition`);
						getOrGenerateOverlay(pwX, pwY);
					}
					*/
					// This doesn't seem to help actually
				}
			}
		}

		// Layer 5
		// Pixel scenes
		for (let worldKey of this.worldsInView) {
			const { pwX, pwY, shiftX, shiftY } = worldOffsets[worldKey];

			// Skip rendering pixel scenes when really zoomed out since they just make the interface laggy

			if (this.cam.z >= 0.0625) {
				// Render pixel scenes (after overlays)
				if (this.pixelScenesByPW && this.pixelScenesByPW[`${pwX},${pwY}`]) {
					for (let scene of this.pixelScenesByPW[`${pwX},${pwY}`]) {
						//if (!scene || !scene.imgElement) continue;
						// Note positions of these *do not* use the tile offset
						const pixelSceneCanvas = getPixelSceneCanvas(scene);
						if (!pixelSceneCanvas) continue;
						this.ctx.drawImage(pixelSceneCanvas, 
							scene.x + getWorldCenter(this.isNGP)*512 - pwX*getWorldSize(this.isNGP)*512 + shiftX, 
							scene.y + 14*512 - pwY*24576 + shiftY
						);
					}
				}
			}

			// Orb rooms (effectively another pixel scene overlay)
			// Skip rendering these for vertical PWs
			if (pwY === 0) {
				this.biomeData.orbs.forEach(o => {
					if (document.getElementById('custom-art').checked && this.surfaceOverlayScenes && this.surfaceOverlayScenes['orb_room']) {
						if (o.y < 14) return; // Skip the sky altar and pyramid top orbs
						// Technically always NGP the way I have this set up but whatever
						const sceneName = pwX === 0 ? 'orb_room' : 'cursed_orb_room';
						this.ctx.drawImage(this.surfaceOverlayScenes[sceneName], o.x * 512 + shiftX, o.y * 512 + shiftY, 512, 512);
						// Circle (not really needed with exaggerated orb size in art)
						/*
						const ox = (o.x + 0.5) * 512; const oy = (o.y + 0.5) * 512;
						this.ctx.fillStyle = 'rgba(255, 215, 0, 0.3)'; this.ctx.strokeStyle = '#f00';
						this.ctx.beginPath(); this.ctx.arc(ox, oy, 200, 0, Math.PI*2);
						this.ctx.lineWidth = 10; this.ctx.fill(); this.ctx.stroke();
						*/
					}
					else {
						const ox = (o.x + 0.5) * 512 + shiftX; const oy = (o.y + 0.5) * 512 + shiftY;
						// Fill in chunk entirely to overwrite any tiles underneath, since orbs break the tile rules and can appear under other PoIs
						this.ctx.fillStyle = '#ffd100';
						this.ctx.fillRect(ox - 256, oy - 256, 512, 512);
						this.ctx.fillStyle = 'rgba(255, 215, 0, 0.3)'; this.ctx.strokeStyle = '#f00';
						this.ctx.beginPath(); this.ctx.arc(ox, oy, 200, 0, Math.PI*2);
						this.ctx.lineWidth = 10; this.ctx.fill(); this.ctx.stroke();
					}
				});
			}
		}

		// Layer 6
		// Debug overlays (tile bounds, pathfinding)

		// Draw debug boxes and paths above overlays/pixel scenes so they aren't obscured
		if (showBoxes || showPaths) {
			for (let worldKey of this.worldsInView) {
				const { pwX, pwY, shiftX, shiftY } = worldOffsets[worldKey];
				// Hack PW offsets
				let pwOffset = 0;
				if (this.isNGP) {
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

		// Layer 7
		// Secrets
		// TODO: These are only near the center and should just render with a sort of absolute position, no reason to iterate over worlds in view for this

		// Draw secret messages
		renderWallMessages(this.ctx, this.isNGP, this.pw, this.pwVertical);
		if (this.pwVertical === 0) {
			/*
			if (this.pw === 0) {
				// TODO: Two of these are really in the first vertical PW in main
				renderWallMessages(this.ctx, this.isNGP);
			}
			*/
			// For now I'll leave these as is because it is kind of accurate to the game that the eyes just pop in when you enter the PW
			// Technically it's drawing two copies but it doesn't matter too much
			renderEyeMessages(this.ctx, this.eyes.east, this.pw, this.isNGP);
		}

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
		if (activeLocalSearchArea) {
			const { x, y, r } = activeLocalSearchArea;
			//console.log(`Rendering local search area at (${x}, ${y}) with radius ${r}`);
			
			// The total width and height of the searched square
			const size = r * 2;
			const topLeftX = getWorldCenter(this.isNGP) * 512 - this.pw * getWorldSize(this.isNGP) * 512 + x - r;
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
			this.ctx.drawImage(this.debugCanvas, this.debugX - this.debugCanvas.width/2 + getWorldCenter(this.isNGP)*512, this.debugY - this.debugCanvas.height/2 + 14*512);
		}

		// Layer 9
		// PoIs

		// Render PoIs
		if (!document.getElementById('debug-hide-pois').checked) {
			for (let worldKey of this.worldsInView) {
				// Skip rendering PoIs when too zoomed out (helps with lag)
				if (this.cam.z < 0.03) continue;
				const { pwX, pwY, shiftX, shiftY } = worldOffsets[worldKey];
				const currentPois = this.poisByPW[`${pwX},${pwY}`];
				if (currentPois) {
					for (let p of currentPois) {
						// Calculate visual position on the current map
						
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
									else if (p.item === 'portal') {
										poiColor = '#800080AA';
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
							// Add more cases as needed for different PoI types
						}

						const px = p.x - (pwX * 512 * getWorldSize(this.isNGP)) + getWorldCenter(this.isNGP) * 512 + shiftX;
						const py = p.y + 14 * 512 - (pwY * 24576) + shiftY; // Shift already baked into the tile spawns
						let tempRadius = POI_RADIUS;
						if (p.highlight === true) {
							this.ctx.strokeStyle = '#000000AA';
							this.ctx.lineWidth = 20 / this.cam.z;
							if (this.ctx.lineWidth < 4) this.ctx.lineWidth = 4;
							tempRadius = POI_RADIUS / this.cam.z; // Scale highlight with zoom for better visibility
							if (tempRadius < POI_RADIUS) tempRadius = POI_RADIUS;
						}
						else {
							this.ctx.strokeStyle = '#000000AA';
							this.ctx.lineWidth = 4;
						}

						this.ctx.beginPath();
						
						if (document.getElementById('debug-small-pois').checked) {
							tempRadius = 5;
						}
						this.ctx.arc(px, py, tempRadius, 0, Math.PI * 2);
						this.ctx.fillStyle = poiColor;
						this.ctx.fill();
						this.ctx.stroke();
					}
				}
			}
		}

		if (this.zoomPixel) {
			const zoomPixelX = this.zoomPixel.x - (this.pw * 512 * getWorldSize(this.isNGP)) + getWorldCenter(this.isNGP) * 512;
			const zoomPixelY = this.zoomPixel.y + 14 * 512 - (this.pwVertical * 24576);
			this.ctx.fillStyle = '#FF0000';
			this.ctx.fillRect(zoomPixelX-1, zoomPixelY-1, 3, 3);
			this.ctx.fillStyle = '#FFFF00';
			this.ctx.fillRect(zoomPixelX, zoomPixelY, 1, 1);
		}

		this.ctx.restore();

		//const t1 = performance.now();
		//console.log(`Draw completed in ${(t1 - t0)} ms.`);
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

	toggleDebugOptions() {
		const ui = document.getElementById('debug-options');
		ui.style.display = ui.style.display === 'block' ? 'none' : 'block';
	},

	gotoPOI(poi) {
		// Math adjusted for the visual map shift
		const viewX = poi.x + (getWorldCenter(this.isNGP) * 512) - (this.pw * 512 * getWorldSize(this.isNGP));
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

	saveSettings() {
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
			clearSpawnPixels: document.getElementById('clear-spawn-pixels').checked,
			customArt: document.getElementById('custom-art').checked,
			enableStaticPixelScenes: document.getElementById('enable-static-pixel-scenes').value,
			hidePois: document.getElementById('debug-hide-pois').checked,
			originalBiomeMap: document.getElementById('debug-original-biome-map').checked,
			enableEdgeNoise: document.getElementById('debug-enable-edge-noise').checked,
			edgeNoiseDebug: document.getElementById('debug-edge-noise').checked,
			overlayMode: document.getElementById('debug-biome-overlay-mode').value,
			showTileBounds: document.getElementById('debug-show-tile-bounds').checked,
			showPath: document.getElementById('debug-show-path').checked,
			//smallPois: document.getElementById('debug-small-pois').checked,
			//fixHolyMountainEdgeNoise: document.getElementById('debug-fix-holy-mountain-edge-noise').checked,
			//excludeEdgeCases: document.getElementById('exclude-edge-cases').checked,
			//extraRerolls: parseInt(document.getElementById('debug-extra-rerolls').value),
			//rngInfo: document.getElementById('debug-rng-info').checked,
		};
		// Unlock settings
		for (const unlock of Object.keys(UNLOCKABLES)) {
			settings[`unlock_${unlock}`] = document.getElementById(`unlock-${unlock}`).checked;
		}
		// Region settings
		for (const region of Object.keys(GENERATOR_CONFIG)) {
			settings[`region_${region}`] = document.getElementById(`region-${region}`).checked;
		}
		updateSettings(settings);
		syncSettingsToSearchWorker();
		syncSettingsToWorldWorker();
		syncSettingsToOverlayWorker();
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
				document.getElementById('clear-spawn-pixels').checked = settings.clearSpawnPixels || false;
				document.getElementById('custom-art').checked = settings.customArt || false;
				document.getElementById('enable-static-pixel-scenes').value = settings.enableStaticPixelScenes || 'none';
				document.getElementById('debug-hide-pois').checked = settings.hidePois || false;
				document.getElementById('debug-original-biome-map').checked = settings.originalBiomeMap || false;
				document.getElementById('debug-enable-edge-noise').checked = settings.enableEdgeNoise || false;
				document.getElementById('debug-edge-noise').checked = settings.edgeNoiseDebug || false;
				document.getElementById('debug-biome-overlay-mode').value = settings.overlayMode || 'none';
				document.getElementById('debug-show-tile-bounds').checked = settings.showTileBounds || false;
				document.getElementById('debug-show-path').checked = settings.showPath || false;
				//document.getElementById('debug-small-pois').checked = settings.smallPois || false;
				//document.getElementById('debug-fix-holy-mountain-edge-noise').checked = settings.fixHolyMountainEdgeNoise || false;
				//document.getElementById('exclude-edge-cases').checked = settings.excludeEdgeCases || false;
				//document.getElementById('debug-extra-rerolls').value = settings.extraRerolls || 0;
				//document.getElementById('debug-rng-info').checked = settings.rngInfo || false;
				// Unlock settings
				for (const unlock of Object.keys(UNLOCKABLES)) {
					document.getElementById(`unlock-${unlock}`).checked = settings[`unlock_${unlock}`];
				}
				// Region settings
				for (const region of Object.keys(GENERATOR_CONFIG)) {
					document.getElementById(`region-${region}`).checked = settings[`region_${region}`];
					GENERATOR_CONFIG[region].enabled = settings[`region_${region}`];
				}
				this.perks = {
					noMoreShuffle: settings.noMoreShuffle || false,
					greedCurse: settings.greedCurse || false,
					extraShopItems: parseInt(settings.extraItemsInHolyMountain) || 0,
				}
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

		const newURL = new URL(window.location);
		newURL.search = params.toString();
		window.history.replaceState(null, '', newURL);

		if (seedInt === undefined) return;
		document.getElementById('seed').value = seedInt;
		document.getElementById('ng').value = ngInt ?? 0;
		this.saveSettings();
		this.generate(true, true);
	}
};

const USE_DAILY_RUN_SEED = true; // Avoid spamming while debugging lol

app.init();

import { generateBiomeData, BIOME_CONFIG } from './biome_generator.js';
import { sanitizePng } from './png_sanitizer.js';
import { getDisplayName, loadTranslations } from './translations.js';
import { UNLOCKABLES, setUnlocks } from './unlocks.js';
import { toggleTooltipPinned, updateTooltip } from './tooltip_generator.js';
import { GENERATOR_CONFIG } from './generator_config.js';
import { generateBiomeTiles } from './tile_generator.js';
import { scanSpawnFunctions, getSpecialPoIs, prescanSpawnFunctions } from './poi_scanner.js';
import { performSearch, navigateSearch, cancelSearch, isSearchActive } from './search.js';
import { TIME_UNTIL_LOADING, POI_RADIUS, CHUNK_SIZE, VISUAL_TILE_OFFSET_X, VISUAL_TILE_OFFSET_Y } from './constants.js';
import { getBiomeAtWorldCoordinates, getMaterialAtWorldCoordinates, getWorldCenter, getWorldSize } from './utils.js';
import { renderWallMessages } from './wall_messages.js';
import { findEyeMessages, renderEyeMessages } from './eye_messages.js';
import { BIOME_COLOR_LOOKUP, createTileOverlays, createTileOverlaysCheap, createTileOverlaysExpanded } from './image_processing.js';
import { COALMINE_ALT_SCENES } from './pixel_scene_config.js';
import { createBiomeMapOverlay } from './image_processing.js';
//import { BIOME_SPAWN_FUNCTION_MAP } from './spawn_function_config.js';
import { debugBiomeEdgeNoise } from './edge_noise.js';
import { reloadPixelSceneCache } from './pixel_scene_generation.js';

export const app = {
	canvas: null, ctx: null, offscreen: null, 
	overlay: null, ctxo: null, 
	recolorOffscreen: null,
	w: 0, h: 0, 
	biomeData: null,
	tileLayers: [],
	cam: { x: CHUNK_SIZE*35, y: CHUNK_SIZE*24, z: 0.053 },
	drag: { on: false, lx: 0, ly: 0 },
	assets: { ng0: null, ngp: null },
	pinnedTooltip: null,
	pw: 0,
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
	
	translations: {},
	loadingTimer: null,
	perks: {}, // extraShopItems, greedCurse, noMoreShuffle

	debugCanvas: null,
	debugX: 0, debugY: 0,

	init() {
		this.canvas = document.getElementById('canvas');
		this.ctx = this.canvas.getContext('2d');
		//this.overlay = document.getElementById('overlay');
		//this.ctxo = this.overlay.getContext('2d');
		this.offscreen = document.createElement('canvas');
		this.recolorOffscreen = document.createElement('canvas');
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
		this.preload();
		//.then(() => this.generate(true, true));

		// Menu Toggles
		document.querySelector('.adv-toggle').onclick = () => this.toggleAdvancedSearch();
		
		// PW Controls
		const pwInput = document.getElementById('pw');
		pwInput.onchange = () => {
			this.pw = parseInt(pwInput.value) || 0;
			// Regenerate/Scan for wands/items in the new PW
			cancelSearch(); // Cancel any active search when changing PW
			cancelBtn.style.display = 'none';
			this.generate(false, false).then(() => {
				// Rerun the search after scanning is complete to find new matches
				//cancelSearch(); // No need to cancel it here, new PW means new results anyway
				if (isSearchActive()) {
					performSearch(false, false);
					this.draw();
				}
				
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

		// Generate
		document.getElementById('seed').onchange = () => {
			let value = parseInt(document.getElementById('seed').value);
			if (!value || isNaN(value) || value < 0) value = 0;
			else if (value > 2147483647) value = 2147483647;
			document.getElementById('seed').value = value;
			this.generate(true, true);
		};
		document.getElementById('ng').onchange = () => {
			let value = parseInt(document.getElementById('ng').value);
			if (!value || isNaN(value) || value < 0) value = 0;
			else if (value > 28) value = 28;
			document.getElementById('ng').value = value;
			this.generate(true, true);
		};
		// No longer using this button, just change the seed/NG+ count and it will auto-generate now
		document.getElementById('gen-btn').onclick = () => this.generate(true, true);

		// Perk Controls
		
		document.getElementById('no-more-shuffle').onchange = () => {this.perks['noMoreShuffle'] = document.getElementById('no-more-shuffle').checked; this.generate(false, true)};
		document.getElementById('greed-curse').onchange = () => {this.perks['greedCurse'] = document.getElementById('greed-curse').checked; this.generate(false, true)};
		document.getElementById('extra-shop-items').onchange = () => {this.perks['extraShopItems'] = parseInt(document.getElementById('extra-shop-items').value); this.generate(false, true)};
		
		// Debug Controls
		
		document.getElementById('skip-cosmetic-scenes').onchange = () => {
			this.skipCosmeticScenes = document.getElementById('skip-cosmetic-scenes').checked;
			this.generate(false, true);
		};
		document.getElementById('exclude-taikasauva').onchange = () => {
			this.excludeTaikasauva = document.getElementById('exclude-taikasauva').checked;
			this.generate(false, true);
		};
		document.getElementById('debug-enable-edge-noise').onchange = () => {
			this.tileOverlaysByPW = {}; // Clear cached overlays so they will be regenerated with the new mode
			this.generate(false, true);
		};
		document.getElementById('debug-draw').onchange = () => this.draw();
		document.getElementById('debug-path').onchange = () => this.draw();
		document.getElementById('debug-hide-pois').onchange = () => this.draw();
		document.getElementById('debug-extra-rerolls').onchange = () => this.generate(true, true);
		document.getElementById('debug-rng-info').onchange = () => this.draw();
		document.getElementById('debug-original-biome-map').onchange = () => this.draw();
		document.getElementById('debug-small-pois').onchange = () => this.draw();
		document.getElementById('debug-fix-holy-mountain-edge-noise').onchange = () => this.generate(true, true);
		document.getElementById('clear-spawn-pixels').onchange = () => {
			// TODO: Should probably rework this so it doesn't need to completely regenerate, but this is fine for now
			reloadPixelSceneCache().then(() => this.generate(true, true));
		};
		document.getElementById('recolor-materials').onchange = () => {
			// TODO: Should probably rework this so it doesn't need to completely regenerate, but this is fine for now
			reloadPixelSceneCache().then(() => this.generate(true, true));
		};
		document.getElementById('debug-biome-overlay-mode').onchange = () => {
			this.tileOverlaysByPW = {}; // Clear cached overlays so they will be regenerated with the new mode
			this.draw();
			//this.generate(true, true); // TODO: Probably don't need to completely regenerate tiles
		};
		document.getElementById('exclude-edge-cases').onchange = () => {
			this.excludeEdgeCases = document.getElementById('exclude-edge-cases').checked;
			this.generate(false, true);
		};
		document.getElementById('debug-edge-noise').onchange = () => {
			this.draw();
		};
		document.getElementById('visited-coalmine-alt-shrine').onchange = () => {
			const value = document.getElementById('visited-coalmine-alt-shrine').checked;
			if (value) {
				COALMINE_ALT_SCENES["g_pixel_scene_02"][0].prob = 0.0;
			}
			else {
				COALMINE_ALT_SCENES["g_pixel_scene_02"][0].prob = 0.5;
			}
			this.generate(false, true);
		};

		// Search

		// Setup range value displays
		document.getElementById('search-btn').onclick = () => {
			cancelSearch();
			performSearch(true, true);
		};
		document.getElementById('search-input').onkeydown = (e) => { 
			if(e.key === "Enter") {
				cancelSearch();
				performSearch(true, true); 
			}
		};
		document.getElementById('search-prev').onclick = () => navigateSearch(-1);
		document.getElementById('search-next').onclick = () => navigateSearch(1);
		['min-spells', 'max-delay', 'max-rech', 'min-mana', 'min-manarech', 'min-cap', 'max-spread', 'min-speed', 'min-len'].forEach(id => {
			const el = document.getElementById(id);
			const suffix = id.split('-').pop();
			const display = document.getElementById('val-' + suffix);
			el.oninput = () => { display.innerText = parseFloat(el.value).toFixed(el.step.includes('.') ? 2 : 0); };
		});
		const cancelBtn = document.getElementById('cancel-search');
		cancelBtn.onclick = () => { 
			cancelSearch();
			cancelBtn.style.display = 'none';
			this.setLoading(false); // Clear overlay immediately on cancel
			this.draw();
		};
		document.getElementById('limit-pw-search').onchange = () => {
			if (document.getElementById('limit-pw-search').checked) {
				document.getElementById('search-pw-limit').disabled = false;
			} else {
				if (this.ngPlusCount > 0) {
					document.getElementById('search-pw-limit').value = 512;
				}
				else {
					document.getElementById('search-pw-limit').value = 468;
				}
				document.getElementById('search-pw-limit').disabled = true;
			}
		};
		// Actually just read this value in performSearch, no need for an event handler
		//document.getElementById('search-pw-limit').onchange = () => {};

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

			this.generate(false, true);
		});

		this.canvas.onmousedown = e => {
			const hit = this.getHitObject(e);
			if (hit) {
				this.pinnedTooltip = hit;
				const tip = document.getElementById('tooltip');
				updateTooltip(e, hit, tip);
				toggleTooltipPinned(tip, true);

			} else {
				this.pinnedTooltip = null;
				document.getElementById('tooltip').style.display = 'none';
				document.getElementById('tooltip').classList.remove('pinned');
			}
			this.drag.on = true; 
			this.drag.lx = e.clientX; 
			this.drag.ly = e.clientY; 

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
		};

		window.onmouseup = (e) => {this.drag.on = false; e.stopPropagation();};
		
		this.canvas.onwheel = e => {
			e.preventDefault();
			const rect = vp.getBoundingClientRect();
			let mouseX = e.clientX - rect.left;
			let mouseY = e.clientY - rect.top;
			let wx = (mouseX - this.canvas.width/2)/this.cam.z + this.cam.x;
			let wy = (mouseY - this.canvas.height/2)/this.cam.z + this.cam.y;
			this.cam.z *= (e.deltaY > 0 ? 0.9 : 1.1);
			this.cam.x = wx - (mouseX - this.canvas.width/2)/this.cam.z;
			this.cam.y = wy - (mouseY - this.canvas.height/2)/this.cam.z;
			this.draw();
		};

		this.canvas.onmousemove = e => {
			if (this.drag.on) {
				this.cam.x -= (e.clientX - this.drag.lx)/this.cam.z;
				this.cam.y -= (e.clientY - this.drag.ly)/this.cam.z;
				this.drag.lx = e.clientX; 
				this.drag.ly = e.clientY;
				this.draw();
			}
			if (!this.pinnedTooltip) this.hover(e);
		};
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
				this.generate(true, true);
			};
		});
		document.getElementById('regions-all').onclick = () => {
			list.querySelectorAll('input').forEach(c => c.checked = true);
			for (const region of Object.keys(GENERATOR_CONFIG)) {
				GENERATOR_CONFIG[region].enabled = true;
			}
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
			this.generate(true, true);
		};
		document.getElementById('regions-none').onclick = () => {
			list.querySelectorAll('input').forEach(c => c.checked = false);
			for (const region of Object.keys(GENERATOR_CONFIG)) {
				GENERATOR_CONFIG[region].enabled = false;
			}
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
				this.unlocksChanged = true;
				this.generate(false, true);
			};
		});
		document.getElementById('unlock-all').onclick = () => {
			this.unlocksChanged = true;
			list.querySelectorAll('input').forEach(c => c.checked = true);
			this.generate(false, true);
		};
		document.getElementById('unlock-none').onclick = () => {
			this.unlocksChanged = true;
			list.querySelectorAll('input').forEach(c => c.checked = false);
			this.generate(false, true);
		};
		// Generate function sets the unlocks based on the current state of the checkboxes, so no need to do it here
		setUnlocks([]); // Initialize with no unlocks
	},

	getHitObject(e) {
		if (!this.biomeData) return null;
		const rect = document.getElementById('view').getBoundingClientRect();
		const wx = (e.clientX - rect.left - this.canvas.width / 2) / this.cam.z + this.cam.x;
		const wy = (e.clientY - rect.top - this.canvas.height / 2) / this.cam.z + this.cam.y;

		// Check Orbs
		let hit = this.biomeData.orbs.find(o => {
			const ox = (o.x + 0.5) * BIOME_CONFIG.CHUNK_SIZE;
			const oy = (o.y + 0.5) * BIOME_CONFIG.CHUNK_SIZE;
			return Math.sqrt((ox - wx) ** 2 + (oy - wy) ** 2) < BIOME_CONFIG.CHUNK_SIZE / 2;
		});

		// Check cached PoIs for the current Parallel World
		if (!hit) {
			const currentPois = this.poisByPW[this.pw];
			const poiHit = currentPois.find(p => {
				const px = p.x - (this.pw * 512 * getWorldSize(this.isNGP)) + getWorldCenter(this.isNGP) * 512;
				const py = p.y + 14 * 512;
				let tempRadius = POI_RADIUS;
				if (p.highlight) {
					tempRadius = POI_RADIUS / this.cam.z;
					if (tempRadius < POI_RADIUS) tempRadius = POI_RADIUS;
				}
				return Math.sqrt((px - wx) ** 2 + (py - wy) ** 2) < tempRadius;
				/*
				if (p.data) {
					// Coordinates already account for PW shift
					const px = p.data.x + getWorldCenter(this.isNGP) * 512 - (this.pw * 512 * getWorldSize(this.isNGP));
					const py = p.data.y + 14 * 512;
					return Math.sqrt((px - wx) ** 2 + (py - wy) ** 2) < POI_RADIUS;
				}
				return false;
				*/
			});
			if (poiHit) return poiHit;
		}
		return hit;
	},

	hover(e) {
		const rect = document.getElementById('view').getBoundingClientRect();
		const wx = (e.clientX - rect.left - this.canvas.width/2) / this.cam.z + this.cam.x;
		const wy = (e.clientY - rect.top - this.canvas.height/2) / this.cam.z + this.cam.y;
		
		const coordsDiv = document.getElementById('coords');
		coordsDiv.style.display = 'block';
		coordsDiv.style.left = (e.clientX - rect.left + 15) + 'px';
		coordsDiv.style.top = (e.clientY - rect.top - 25) + 'px';
		
		// Absolute coordinate math
		const absX = Math.floor(wx - 512*getWorldCenter(this.isNGP)) + (this.pw * 512 * getWorldSize(this.isNGP));
		const absY = Math.floor(wy - 512*14);
		let biomeName = '';
		if (this.biomeData && this.biomeData.pixels) {
			// Get biome
			const biomeResult = getBiomeAtWorldCoordinates(this.biomeData.pixels, absX, absY, this.isNGP);
			if (biomeResult && biomeResult.biome) {
				biomeName = `<br>Biome: ${getDisplayName(biomeResult.biome)}`;
			}
		}
		let materialName = '';
		if (this.tileLayers && this.tileLayers.length > 0 && this.pixelScenesByPW && this.pixelScenesByPW[this.pw]) {
			// Get material
			const material = getMaterialAtWorldCoordinates(this.tileLayers, this.pixelScenesByPW[this.pw], absX, absY, this.isNGP);
			if (material) {
				materialName = `<br>Material: ${getDisplayName(material)}`;
			}
		}
		coordsDiv.innerHTML = `${absX}, ${absY}${biomeName}${materialName}`;

		const hit = this.getHitObject(e);
		const tip = document.getElementById('tooltip');
		if (!hit) {
			if (!this.pinnedTooltip) tip.style.display = 'none';
			return;
		}
		updateTooltip(e, hit, tip);
		toggleTooltipPinned(tip, false);
	},

	async preload() {
		this.setLoading(true, "Loading Assets...");
		await loadTranslations();
		const load = async (src) => {
			const img = new Image(); img.src = src;
			await new Promise((res, rej) => { img.onload = res; img.onerror = rej; });
			const c = document.createElement('canvas'); c.width = img.width; c.height = img.height;
			const ctx = c.getContext('2d'); ctx.drawImage(img,0,0);
			const d = ctx.getImageData(0,0,img.width,img.height).data;
			const u32 = new Uint32Array(img.width * img.height);
			for(let i=0; i<u32.length; i++) u32[i] = 0xFF000000 | (d[i*4]<<16) | (d[i*4+1]<<8) | d[i*4+2];
			return u32;
		};
		try {
			this.assets.ng0 = await load('./data/biome_maps/biome_map.png');
			this.assets.ngp = await load('./data/biome_maps/biome_map_newgame_plus.png');
		} catch(e) { console.error("Base assets failed to load."); console.error(e); }
		this.setLoading(false);
	},

	async loadWangAsset(url) {
		const cleanUrl = await sanitizePng(url);
		return new Promise(resolve => {
			const img = new Image(); img.src = cleanUrl;
			img.onload = () => {
				const c = document.createElement('canvas'); c.width = img.width; c.height = img.height;
				const ctx = c.getContext('2d'); ctx.drawImage(img, 0, 0);
				resolve({ data: ctx.getImageData(0,0,img.width,img.height).data, width: img.width, height: img.height });
				URL.revokeObjectURL(cleanUrl);
			};
			img.onerror = () => resolve(null);
		});
	},

	// Could probably default rescan to true if tiles is true
	async generate(tiles, rescan) {
		this.setLoading(true, tiles ?  "Generating Tiles..." : "Scanning Parallel World..." );
		if (tiles) {
			// Adding a small extra delay causes it to actually appear
			await new Promise(resolve => setTimeout(resolve, TIME_UNTIL_LOADING + 25));
		}
		
		const btn = document.getElementById('gen-btn');
		btn.disabled = true;
		btn.innerText = tiles ? "Generating Tiles..." : "Scanning Parallel World...";

		const t0 = performance.now();

		const seedVal = parseInt(document.getElementById('seed').value);
		this.seed = seedVal;
		const ngVal = parseInt(document.getElementById('ng').value);
		this.ngPlusCount = ngVal;
		this.pw = parseInt(document.getElementById('pw').value) || 0;
		this.isNGP = ngVal > 0;

		// Set limits on PWs
		if (this.isNGP) {
			document.getElementById('search-pw-limit').max = 512;
			if (document.getElementById('search-pw-limit').value > 512) {
				document.getElementById('search-pw-limit').value = 512;
			}
			if (this.pw > 512) {
				this.pw = 512;
				document.getElementById('pw').value = 512;
			}
			else if (this.pw < -512) {
				this.pw = -512;
				document.getElementById('pw').value = -512;
			}
		}
		else {
			document.getElementById('search-pw-limit').max = 468;
			if (document.getElementById('search-pw-limit').value > 468) {
				document.getElementById('search-pw-limit').value = 468;
			}
			if (this.pw > 468) {
				this.pw = 468;
				document.getElementById('pw').value = 468;
			}
			else if (this.pw < -468) {
				this.pw = -468;
				document.getElementById('pw').value = -468;
			}
		}

		// Update unlocks (should probably add something to check if they changed to save a bit)
		if (this.unlocksChanged) {
			const checkedUnlocks = [];
			document.querySelectorAll('#unlocks-list input:checked').forEach(c => checkedUnlocks.push(c.value));
			setUnlocks(checkedUnlocks);
			this.unlocksChanged = false;
			rescan = true; // If unlocks changed, we need to rescan spawn functions even if tiles didn't change, since some spawns are gated behind unlocks
		}

		// 1. FULL GENERATION (Only if seed/NG changed)
		if (tiles) {
			//const noMoreShuffle = this.perks['noMoreShuffle'] || false;
			const base = (this.isNGP ? this.assets.ngp : this.assets.ng0);
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
					GENERATOR_CONFIG[k].wangData = await this.loadWangAsset(GENERATOR_CONFIG[k].wangFile);
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

			for (let layer of this.tileLayers) {
				// Initialize
				layer.pixelScenesByPW = {};
			}

			// Create overlay
			this.renderRecolorMap();
			this.biomeMapOverlay = createBiomeMapOverlay(this.biomeData, getWorldSize(this.isNGP), 48, this.recolorOffscreen);

			// Prescan spawn functions for generated tiles, only needs to be done once per seed/NG+ combination, not every time PW or perks change
			this.tileSpawns = prescanSpawnFunctions(this.tileLayers, this.isNGP);
			// Reset spawns
			this.pixelScenesByPW = {};
			this.poisByPW = {};
			this.tileOverlaysByPW = {};
		}

		if (rescan) cancelSearch(); // Cancel any active search when changing perks (might need to adjust this later)

		// 2. SPAWN FUNCTION SCANNING

		if (rescan || !this.pixelScenesByPW[this.pw] || !this.poisByPW[this.pw]) {
			const scanResults = scanSpawnFunctions(this.biomeData.pixels, this.tileSpawns, this.seed, this.ngPlusCount, this.pw, this.skipCosmeticScenes, this.perks);
			this.pixelScenesByPW[this.pw] = scanResults.finalPixelScenes;
			this.poisByPW[this.pw] = scanResults.generatedSpawns.concat(getSpecialPoIs(this.biomeData.pixels, this.seed, this.ngPlusCount, this.pw, this.perks));
			
			// Instead of doing this here, do it before render, because otherwise it causes search to slow down for no reason
			/*
			const biomeOverlayMode = document.getElementById('debug-biome-overlay-mode').value;
			if (biomeOverlayMode !== 'none') {
				if (biomeOverlayMode === 'expanded') {
					this.tileOverlaysByPW[this.pw] = createTileOverlaysExpanded(this.biomeData.pixels, this.recolorOffscreen, this.tileLayers, this.pw, this.isNGP);
				}
				else if (biomeOverlayMode === 'normal') {
					this.tileOverlaysByPW[this.pw] = createTileOverlays(this.biomeData.pixels, this.recolorOffscreen, this.tileLayers, this.pw, this.isNGP);
				}
				else {
					this.tileOverlaysByPW[this.pw] = createTileOverlaysCheap(this.biomeData.pixels, this.tileLayers, this.pw, this.isNGP);
				}
			}
			*/
		}

		// Debug: Show example JSON output
		//console.log(this.poisByPW[this.pw]);

		// Generate eye messages
		if (tiles) {
			this.eyes = findEyeMessages(this.biomeData.pixels, seedVal, ngVal);
		}

		const t1 = performance.now();
		console.log(`Generation completed in ${(t1 - t0) / 1000} seconds.`);

		this.draw();
		btn.disabled = false;
		btn.innerText = "Generate World";
		this.setLoading(false);
		document.getElementById('status').innerText = `Done (PW ${this.pw}).`;
	},

	renderOffscreen() {
		this.offscreen.width = this.w; this.offscreen.height = this.h;
		const ctx = this.offscreen.getContext('2d');
		const id = ctx.createImageData(this.w, this.h);
		const p = this.biomeData.pixels;
		for(let i=0; i<p.length; i++) {
			id.data[i*4+0] = (p[i]>>16)&0xFF; id.data[i*4+1] = (p[i]>>8)&0xFF;
			id.data[i*4+2] = p[i]&0xFF; id.data[i*4+3] = 255;
		}
		ctx.putImageData(id, 0, 0);
	},

	renderRecolorMap() {
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
						// TODO: Make this less confusing, though it does work
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
		}
		ctx.putImageData(id, 0, 0);
	},

	draw() {
		// Don't draw unless things are actually loaded
		if (!this.biomeData || !this.tileLayers) return;
		//const t0 = performance.now();
		this.ctx.fillStyle = '#050505';
		this.ctx.fillRect(0,0,this.canvas.width,this.canvas.height);
		if (!this.biomeData) return;

		this.ctx.save();
		this.setupCamera(this.ctx);
		
		this.ctx.imageSmoothingEnabled = false;
		// Background biome colors
		if (document.getElementById('debug-original-biome-map').checked) {
			this.ctx.drawImage(this.offscreen, 0, 0, this.w, this.h, 0, 0, this.w * 512, this.h * 512);
		} else {
			this.ctx.drawImage(this.recolorOffscreen, 0, 0, this.w, this.h, 0, 0, this.w * 512, this.h * 512);
		}

		const showBoxes = document.getElementById('debug-draw').checked;
		const showPaths = document.getElementById('debug-path').checked;

		const biomeOverlayMode = document.getElementById('debug-biome-overlay-mode').value;

		// TODO: No longer need to do it in this weird order.
		for (const layer of this.tileLayers) {
			// Hack PW offsets
			let pwOffset = 0;
			if (this.isNGP) {
				pwOffset = -this.pw * 8;
			}
			if (layer.canvas) {
				if (biomeOverlayMode === 'none') {
					// Draw original tiles
					this.ctx.drawImage(layer.canvas, layer.correctedX + pwOffset + VISUAL_TILE_OFFSET_X, layer.correctedY + VISUAL_TILE_OFFSET_Y, layer.w, layer.h);
				}
			}

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

							const worldX = layer.correctedX + (tx * layer.tileSize * 10) + pwOffset + VISUAL_TILE_OFFSET_X;
							const worldY = layer.correctedY + (ty * layer.tileSize * 10) - 40  + VISUAL_TILE_OFFSET_Y;

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
				this.ctx.moveTo(layer.correctedX + start.x * 10 + 5 + pwOffset + VISUAL_TILE_OFFSET_X, layer.correctedY + start.y * 10 + 5 + VISUAL_TILE_OFFSET_Y);
				for (let p of layer.path) this.ctx.lineTo(layer.correctedX + p.x * 10 + 5 + pwOffset + VISUAL_TILE_OFFSET_X, layer.correctedY + p.y * 10 + 5 + VISUAL_TILE_OFFSET_Y);
				this.ctx.stroke();
			}
		}
		
		// TODO: Might need to overwrite outside the region of the map for NG+ shifts of way too much

		// OVERLAYS
		// Tile overlay (recolor white to biome foreground average color)

		// Biome map overlay (static chunks)
		// This is drawn before the main overlay, and covers up shifted parts of the tiles...
		// This was a hacky workaround to deal with the way the NG+ map shifted into regions without tiles and got partially deleted, but the overlay replaces it
		/*
		if (this.biomeMapOverlay) {
			this.ctx.drawImage(this.biomeMapOverlay, 0, 0, this.w, this.h, 0, 0, this.w * 512, this.h * 512);
		}
		*/

		if (biomeOverlayMode !== 'none') {
			if (!this.tileOverlaysByPW[this.pw]) {
				// Generate it now (this seems like a bad idea since it will hang)
				if (biomeOverlayMode === 'expanded') {
					this.tileOverlaysByPW[this.pw] = createTileOverlaysExpanded(this.biomeData.pixels, this.recolorOffscreen, this.tileLayers, this.pw, this.isNGP);
				}
				else if (biomeOverlayMode === 'normal') {
					this.tileOverlaysByPW[this.pw] = createTileOverlays(this.biomeData.pixels, this.recolorOffscreen, this.tileLayers, this.pw, this.isNGP);
				}
				else {
					this.tileOverlaysByPW[this.pw] = createTileOverlaysCheap(this.biomeData.pixels, this.tileLayers, this.pw, this.isNGP);
				}
			}
			if (this.tileOverlaysByPW[this.pw]) {
				let pwOffset = 0;
				if (this.isNGP) {
					pwOffset = -this.pw * 8;
				}
				for (let i = 0; i < this.tileLayers.length; i++) {
					const layer = this.tileLayers[i];
					const overlay = this.tileOverlaysByPW[this.pw][i];
					
					if (overlay) {
						if (document.getElementById('debug-enable-edge-noise').checked && biomeOverlayMode === 'expanded') {
							this.ctx.drawImage(
								overlay, 
								layer.correctedX + pwOffset + VISUAL_TILE_OFFSET_X - 40, 
								layer.correctedY + VISUAL_TILE_OFFSET_Y - 40,
								layer.w+80,
								layer.h+80
							);
						}
						else {
							this.ctx.drawImage(
								overlay, 
								layer.correctedX + pwOffset + VISUAL_TILE_OFFSET_X, 
								layer.correctedY + VISUAL_TILE_OFFSET_Y,
								layer.w,
								layer.h
							);
						}
					}
				}
			}
		}

		// Render pixel scenes (after overlays)
		if (this.pixelScenesByPW && this.pixelScenesByPW[this.pw]) {
			for (let scene of this.pixelScenesByPW[this.pw]) {
				if (!scene || !scene.imgElement) return;
				this.ctx.drawImage(scene.imgElement, scene.x + getWorldCenter(this.isNGP)*512 - this.pw*getWorldSize(this.isNGP)*512, scene.y + 14*512);
			}
		}

		// Orb rooms (effectively another pixel scene overlay)
		this.biomeData.orbs.forEach(o => {
			const ox = (o.x + 0.5) * 512; const oy = (o.y + 0.5) * 512;
			// Fill in chunk entirely to overwrite any tiles underneath, since orbs break the tile rules and can appear under other PoIs
			this.ctx.fillStyle = '#ffd100';
			this.ctx.fillRect(ox - 256, oy - 256, 512, 512);
			this.ctx.fillStyle = 'rgba(255, 215, 0, 0.3)'; this.ctx.strokeStyle = '#f00';
			this.ctx.beginPath(); this.ctx.arc(ox, oy, 200, 0, Math.PI*2);
			this.ctx.lineWidth = 10; this.ctx.fill(); this.ctx.stroke();
		});

		// Draw secret messages
		if (this.pw === 0) {
			renderWallMessages(this.ctx, this.isNGP);
		}
		else if (this.pw === 1) {
			renderEyeMessages(this.ctx, this.eyes.east);
		} 
		else if (this.pw === -1) {
			renderEyeMessages(this.ctx, this.eyes.west);
		}

		// Render PoIs
		if (!document.getElementById('debug-hide-pois').checked) {
			const currentPois = this.poisByPW[this.pw];
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
								if (p.item.includes('heart')) {
									poiColor = '#FF0000AA';
								}
								else if (p.item.includes('potion') || p.item.includes('pouch')) {
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
							poiColor = '#FF00FFAA';
							break;
						case 'chest':
						case 'pacifist_chest':
							poiColor = '#FFA500AA';
							break;
						case 'great_chest':
							poiColor = '#FF5500AA';
							break;
						case 'holy_mountain_shop':
							poiColor = '#00FF00AA';
							break;
						// Add more cases as needed for different PoI types
					}

					const px = p.x - (this.pw * 512 * getWorldSize(this.isNGP)) + getWorldCenter(this.isNGP) * 512;
					const py = p.y + 14 * 512;
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

		if (document.getElementById('debug-edge-noise').checked && this.debugCanvas) {
			this.ctx.drawImage(this.debugCanvas, this.debugX - this.debugCanvas.width/2 + getWorldCenter(this.isNGP)*512, this.debugY - this.debugCanvas.height/2 + 14*512);
		}

		this.ctx.restore();

		// Overlay global mask using biome color lookup
		// Iterate over biome map positions to find specific colors
		
		/*
		this.ctxo.fillStyle = '#000000';
		this.ctxo.clearRect(0, 0, this.canvas.width, this.canvas.height);
		this.ctxo.save();
		this.setupCamera(this.ctxo);
		
		this.ctxo.imageSmoothingEnabled = false;
		// Draw the pre-rendered recolor map scaled to world units
		this.ctxo.drawImage(this.recolorOffscreen, 0, 0, this.w, this.h, 0, 0, this.w * 512, this.h * 512);
		
		this.ctxo.restore();
		*/
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

	gotoPOI(poi) {
		// Math adjusted for the visual map shift
		const viewX = poi.x + (getWorldCenter(this.isNGP) * 512) - (this.pw * 512 * getWorldSize(this.isNGP));
		const viewY = poi.y + (14 * 512);

		// Place to the side so it doesn't get immediately covered by the tooltip, which is centered on the screen
		this.cam.z = 0.25; // Zoom in, but not too much
		this.cam.x = viewX + 100 / this.cam.z;
		this.cam.y = viewY;
		
		
		this.pinnedTooltip = poi;
		this.draw();
		
		// Position tooltip relative to map center
		const tip = document.getElementById('tooltip');
		tip.style.display = 'block';
		tip.classList.add('pinned');
		tip.style.left = '60%';
		tip.style.top = '40%';
		tip.style.transform = 'translate(-10%, -50%)';
		
		updateTooltip(null, poi, tip); 
		toggleTooltipPinned(tip, true);
	},

	
};

app.init();
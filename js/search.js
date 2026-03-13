import { isMatch, getDisplayName } from './translations.js';
import { scanSpawnFunctions, getSpecialPoIs } from './poi_scanner.js';
import { addStaticPixelScenes } from './static_spawns.js';
import { TIME_UNTIL_LOADING } from './constants.js';
import { app } from './app.js';
import { CONTAINER_TYPES } from './utils.js';
import { generateGreatChest } from './chest_generation.js';
import { generateWand } from './wand_generation.js';
import { SPRITE_RARITY } from './wand_config.js';
import { NollaPrng } from './nolla_prng.js';

const SEARCH_ENABLED = true; // Debug

// Load quick search things
const ORB_SEEDS = await fetch('./data/rng/orb_seeds.json').then(async res => new Set(await res.json()));
const SAMPO_SEEDS = await fetch('./data/rng/sampo_seeds.json').then(async res => new Set(await res.json()));
const HIGH_SC_SEEDS = [36402008, 37475567, 74727319, 262049561, 345207455, 377895106, 568379281, 644708457, 653552772, 698862238, 884960988, 1280537179, 1315281277, 1368348114, 1392682761, 1434236773, 1471283855, 1636302025, 1705128673, 1731966418, 1772474495, 2018351783, 2073660843, 2111754688];

let searchActive = false;
let search = {
	results: [],
	index: -1,
	lastPwIdx: -1, // Tracks position in pwSequence
	pwSequence: [],
	lastLocalIdx: -1,
	localSequence: [],
};

export function isSearchActive() {
	return searchActive;
}

// Soft cancel, without really canceling, but clearing highlights and resetting
export function clearHighlights() {
	search.results = [];
	search.index = -1;
	app.poisByPW[`${app.pw},${app.pwVertical}`]?.forEach(poi => {
		poi.highlight = false;
	});
}

export function cancelSearch() {
	searchActive = false;
	// Disable highlights on PoIs and reset search
	clearHighlights();
	// Update UI elements
    const cancelBtn = document.getElementById('cancel-search');
    const searchNav = document.getElementById('search-nav');
    if (cancelBtn) cancelBtn.style.display = 'none';
    if (searchNav) searchNav.style.display = 'none';
    
    // Trigger a redraw to remove highlights from the canvas
    //app.draw();
}

function getSearchFilters() {
	return {
		queryList: document.getElementById('search-input').value.split(',').map(s => s.trim().toLowerCase().replace('_', ' ')).filter(s => s),
		name: document.getElementById('search-name').value.toLowerCase(),
		sprite: document.getElementById('search-sprite').value,
		ac: document.getElementById('search-ac').value.toLowerCase(),
		acMode: document.getElementById('search-ac-mode').value,
		shuffleMode: document.getElementById('search-shuffle-mode').value,
		minSpells: parseInt(document.getElementById('spells-min-num').value),
		maxSpells: parseInt(document.getElementById('spells-max-num').value),
		minDelay: parseFloat(document.getElementById('delay-min-num').value),
		maxDelay: parseFloat(document.getElementById('delay-max-num').value),
		minRech: parseFloat(document.getElementById('rech-min-num').value),
		maxRech: parseFloat(document.getElementById('rech-max-num').value),
		minMana: parseInt(document.getElementById('mana-min-num').value),
		maxMana: parseInt(document.getElementById('mana-max-num').value),
		minManaRech: parseInt(document.getElementById('manarech-min-num').value),
		maxManaRech: parseInt(document.getElementById('manarech-max-num').value),
		minCap: parseInt(document.getElementById('cap-min-num').value),
		maxCap: parseInt(document.getElementById('cap-max-num').value),
		minSpread: parseInt(document.getElementById('spread-min-num').value),
		maxSpread: parseInt(document.getElementById('spread-max-num').value),
		minSpeed: parseFloat(document.getElementById('speed-min-num').value),
		maxSpeed: parseFloat(document.getElementById('speed-max-num').value),
		minLen: parseInt(document.getElementById('len-min-num').value),
		maxLen: parseInt(document.getElementById('len-max-num').value),
		minSpriteRarity: parseFloat(document.getElementById('rarity-min-num').value),
		maxSpriteRarity: parseFloat(document.getElementById('rarity-max-num').value)
	};
}

export async function performSearch(allowIterative = true, autoNavigate = true) {
	const t0 = performance.now();
	if (!SEARCH_ENABLED) return;
	if (searchActive && allowIterative) return;
	const searchAllPW = allowIterative && document.getElementById('search-all-pw').checked;
	const pwLimit = parseInt(document.getElementById('search-pw-limit').value) || 6;
	const searchVerticalPW = document.getElementById('search-vertical-pw').checked;
	const pwVerticalLimit = parseInt(document.getElementById('search-pw-vertical-limit').value) || 6;
	const cancelBtn = document.getElementById('cancel-search');

	searchActive = true;
	search.results = [];
	search.index = -1;
	
	// TODO: See if it's a wand search to eliminate worlds that wouldn't be useful (e.g. no wands will ever be in heaven)
	// Also for wand searches that include vertical PWs, should probably warn if any other biomes than power plant are enabled in NG...
	
	search.pwSequence = ['0,0'];
	if (!searchVerticalPW) {
		for (let i = 1; i <= pwLimit; i++) { 
			search.pwSequence.push(`${i},0`); 
			search.pwSequence.push(`-${i},0`); 
		}
	}
	else {
		const coords = [];
		// Generate all valid coordinates within the rectangle
		for (let x = -pwLimit; x <= pwLimit; x++) {
			for (let y = -pwVerticalLimit; y <= pwVerticalLimit; y++) {
				coords.push({ x, y, dist: Math.abs(x) + Math.abs(y) });
			}
		}
		// Sort by Manhattan distance
		// If distances are equal, sort by X then Y to keep it deterministic
		coords.sort((a, b) => a.dist - b.dist || a.x - b.x || a.y - b.y);
		search.pwSequence = coords.map(c => `${c.x},${c.y}`);
	}

	// Logic for Manual Search: If current PW is outside the limit, add it
    if (!searchAllPW && !search.pwSequence.includes(`${app.pw},${app.pwVertical}`)) {
        search.pwSequence.push(`${app.pw},${app.pwVertical}`);
    }

	if (!searchAllPW) {
		search.lastPwIdx = search.pwSequence.indexOf(`${app.pw},${app.pwVertical}`) - 1;
	} else {
		search.lastPwIdx = -1;
		cancelBtn.style.display = 'block';
		cancelBtn.innerText = "CANCEL SEARCH";
	}

	// Give a small yield for the setLoading timer to start
	if (searchAllPW) {
		app.setLoading(true, "Initializing Search...");
		await new Promise(r => setTimeout(r, TIME_UNTIL_LOADING));
	}

	await findNextPWMatches(searchAllPW);

	if (search.results.length > 0) {
		document.getElementById('search-nav').style.display = 'block';
		// Keep the cancel button visible so highlights can be cleared later
        cancelBtn.style.display = 'block'; 
        cancelBtn.innerText = "Clear Results"; // Update text for clarity
		document.getElementById('search-results').innerHTML = '';
		if (autoNavigate) {
			await navigateSearch(1); 
		} else {
			search.index = -1;
			document.getElementById('search-count').innerText = `${search.index + 1} / ${search.results.length}`;
			//searchActive = false; // Keep active so that highlights remain and navigation can work without re-searching
			app.setLoading(false);
		}
	} else {
		document.getElementById('search-nav').style.display = 'none';
		if (searchAllPW) {
			document.getElementById('search-results').innerHTML = '<div style="padding:5px; color:#888;">No results found in this range of PWs.</div>';
		}
		else {
			document.getElementById('search-results').innerHTML = '<div style="padding:5px; color:#888;">No results found in this PW.</div>';
		}
		//cancelBtn.style.display = 'none';
		app.setLoading(false);
		searchActive = false;
		app.draw();

		// Just testing to see what the sprite distributions are like, thinking of using it in some kind of summary maybe
		// This ended up being kind of useless because it was much faster to run in C++ directly, figures
		/*
		if (searchAllPW && search.lastPwIdx === search.pwSequence.length - 1) {
			// Get statistics on all scanned PoIs
			let totalWands = 0;
			let spriteCounts = {};
			for (let i = 0; i <= 1000; i++) {
				spriteCounts[`wand_${i.toString().padStart(4, '0')}`] = 0;
			}
			for (let pwKey in app.poisByPW) {
				const pois = app.poisByPW[pwKey];
				for (let poi of pois) {
					if (poi.type === 'wand') {
						totalWands += 1;
						const sprite = poi.sprite;
						if (sprite && spriteCounts[sprite] !== undefined) {
							spriteCounts[sprite] += 1;
						}
					}
					else if (CONTAINER_TYPES.includes(poi.type) && poi.items) {
						for (let item of poi.items) {
							if (item.type === 'wand') {
								totalWands += 1;
								const sprite = item.sprite;
								if (sprite && spriteCounts[sprite] !== undefined) {
									spriteCounts[sprite] += 1;
								}
							}
						}
					}
				}
			}
			console.log(`Scanned ${search.lastPwIdx + 1} PW coordinates with a total of ${totalWands} wands found.`);
			console.log("Sprite distribution among found wands:");
			console.log(spriteCounts);
		}
		*/

		// Another testing idea, what is the tier distribution like?
		/*
		if (searchAllPW && search.lastPwIdx === search.pwSequence.length - 1) {
			// Get statistics on all scanned PoIs
			let totalWands = 0;
			let tierCounts = {
				'T1': 0, 'T1NS': 0, 'T1B': 0,
				'T2': 0, 'T2NS': 0, 'T2B': 0,
				'T3': 0, 'T3NS': 0, 'T3B': 0,
				'T4': 0, 'T4NS': 0, 'T4B': 0,
				'T5': 0, 'T5NS': 0, 'T5B': 0,
				'T6': 0, 'T6NS': 0, 'T6B': 0,
				'T10': 0, 'T10NS': 0, 'P': 0
			};
			for (let pwKey in app.poisByPW) {
				const pois = app.poisByPW[pwKey];
				for (let poi of pois) {
					if (poi.type === 'wand') {
						if (typeof poi.mana_max !== 'number') continue; // Skip prebuilt wands with unknown stats
						totalWands += 1;
						if (poi['level']) {
							const level = poi['level'] > 10 ? 10 : poi['level'];
							const unshuffle = poi['original_force_unshuffle'] === 1;
							const wandType = poi['wand_type']; // normal or better
							//const tier = "wand_" + (unshuffle ? "unshuffle" : "level") + "_" + level.toString().padStart(2, '0') + (wandType === 'better' ? '_better' : '');
							const tier = 'T' + level.toString() + (unshuffle ? 'NS' : '') + (wandType === 'better' ? 'B' : '');
							tierCounts[tier] += 1;
						}
						else {
							tierCounts['P'] += 1;
						}
					}
					else if (CONTAINER_TYPES.includes(poi.type) && poi.items) {
						for (let item of poi.items) {
							if (item.type === 'wand') {
								totalWands += 1;
								if (item['level']) {
									const level = item['level'] > 10 ? 10 : item['level'];
									const unshuffle = item['original_force_unshuffle'] === 1;
									const wandType = item['wand_type']; // normal or better
									//const tier = "wand_" + (unshuffle ? "unshuffle" : "level") + "_" + level.toString().padStart(2, '0') + (wandType === 'better' ? '_better' : '');
									const tier = 'T' + level.toString() + (unshuffle ? 'NS' : '') + (wandType === 'better' ? 'B' : '');
									tierCounts[tier] += 1;
								}
								else {
									tierCounts['P'] += 1;
								}
							}
						}
					}
				}
			}
			console.log(`Scanned ${search.lastPwIdx + 1} PW coordinates with a total of ${totalWands} wands found.`);
			console.log("Tier distribution among found wands:");
			console.log(tierCounts);
		}
		*/
	}

	const t1 = performance.now();
	console.log(`Search completed in ${((t1 - t0)/1000).toFixed(3)} s with ${search.results.length} results.`);
}

export async function performLocalSearch(mode, radius, startX, startY) {
	const t0 = performance.now();
	if (!SEARCH_ENABLED) return;
	if (searchActive) cancelSearch(); // Clear previous search if active
	const cancelBtn = document.getElementById('cancel-search');

	searchActive = true;
	search.results = [];
	search.index = -1;
	
	const coords = [];
	// Generate all valid coordinates within the rectangle
	for (let x = startX-radius; x <= startX+radius; x++) {
		for (let y = startY-radius; y <= startY+radius; y++) {
			coords.push({ x, y, dist: Math.abs(x - startX) + Math.abs(y - startY) });
		}
	}
	// Sort by Manhattan distance
	// If distances are equal, sort by X then Y to keep it deterministic
	coords.sort((a, b) => a.dist - b.dist || a.x - b.x || a.y - b.y);
	search.localSequence = coords; //coords.map(c => `${c.x},${c.y}`);

	search.lastLocalIdx = -1;
	cancelBtn.style.display = 'block';
	cancelBtn.innerText = "CANCEL SEARCH";

	// Give a small yield for the setLoading timer to start
	app.setLoading(true, "Initializing Search...");
	await new Promise(r => setTimeout(r, TIME_UNTIL_LOADING));

	await findNextLocalMatch(mode);

	if (search.results.length > 0) {
		document.getElementById('search-nav').style.display = 'block';
		// Keep the cancel button visible so highlights can be cleared later
        cancelBtn.style.display = 'block'; 
        cancelBtn.innerText = "Clear Results"; // Update text for clarity
		document.getElementById('search-results').innerHTML = '';
		await navigateSearch(1); 
	} else {
		document.getElementById('search-nav').style.display = 'none';
		document.getElementById('search-results').innerHTML = '<div style="padding:5px; color:#888;">No results found here.</div>';
		//cancelBtn.style.display = 'none';
		app.setLoading(false);
		searchActive = false;
		app.draw();
	}

	const t1 = performance.now();
	console.log(`Local search completed in ${((t1 - t0)/1000).toFixed(3)} s with ${search.results.length} results.`);
}

function checkWandMatch(w, f) {
	const length = w.tip.x - w.grip.x;
	
	// Stat filters
	// Note for some prebuilt wands we can't predict stats due to RNG based on frame count, so we'll just skip checks on those
	// Ignore nondeterministic wands. Luckily they all have mana max as a varying stat so this is a simple check
	if (typeof w.mana_max !== 'number') return false;
	if (w.mana_max < f.minMana || w.mana_max > f.maxMana) return false;
	// Oops, setting the dual limits broke 27+ search
	if (f.minCap === 27) f.maxCap = 100;
	if (w.deck_capacity < f.minCap || w.deck_capacity > f.maxCap) return false;
	if ((w.reload_time / 60) < f.minRech || (w.reload_time / 60) > f.maxRech) return false;
	// Same thing for this
	if (f.minActionsPerRound === 27) f.maxActionsPerRound = 100;
	if (w.actions_per_round < f.minSpells || w.actions_per_round > f.maxSpells) return false;
	if ((w.fire_rate_wait / 60) < f.minDelay || (w.fire_rate_wait / 60) > f.maxDelay) return false;
	if (w.mana_charge_speed < f.minManaRech || w.mana_charge_speed > f.maxManaRech) return false;
	if (w.spread_degrees < f.minSpread || w.spread_degrees > f.maxSpread) return false;
	if (w.speed_multiplier < f.minSpeed || w.speed_multiplier > f.maxSpeed) return false;
	if (length < f.minLen || length > f.maxLen) return false; // Length 0 was previously used for ones where I just hadn't filled it out, but now it should always be available
	if (f.name && !isMatch(w.name, f.name)) return false;
	if (f.sprite && w.sprite !== `wand_${f.sprite.toString().padStart(4, '0')}`) return false;
	// Not really sure a max threshold would even be useful here
	if (f.minSpriteRarity || f.maxSpriteRarity) {
		if (document.getElementById('show-wand-sprite-rarity').checked && SPRITE_RARITY !== undefined) {
			if (SPRITE_RARITY[w.sprite] !== undefined) {
				if (SPRITE_RARITY[w.sprite] > 0) {
					const wand_rarity = 1.0/SPRITE_RARITY[w.sprite];
					if (wand_rarity < 1e9) { // Always show extremely rare sprites... Threshold tbd
						if (wand_rarity < Math.pow(10, f.minSpriteRarity)) return false;
						if (f.maxSpriteRarity && wand_rarity > Math.pow(10, f.maxSpriteRarity)) return false;
					}
				}
				else {
					console.warn(`Apparently impossible wand ${w.sprite}`);
				}
			}
			else return false;
		}
	}

	// Shuffle
	if (f.shuffleMode === 'shuffle' && !w.shuffle_deck_when_empty) return false;
	if (f.shuffleMode === 'non-shuffle' && w.shuffle_deck_when_empty) return false;

	// Always Casts
	if (f.ac) {
		if (!w.always_casts || w.always_casts.length === 0) return false;
		if (!isMatch(w.always_casts.join(','), f.ac)) return false;
	} else if (f.acMode === 'must') {
		if (!w.always_casts || w.always_casts.length === 0) return false;
	}
	else if (f.acMode === 'none') {
		if (w.always_casts && w.always_casts.length > 0) return false;
	}

	// Spell set (Comma separated AND, order agnostic)
	if (f.queryList.length > 0) {
		// Include always casts in search by combining them with the wand cards
		const combinedCards = w.cards ? w.cards.concat(w.always_casts || []) : (w.always_casts || []);
		if (!f.queryList.every(q => combinedCards.some(s => isMatch(s, q)))) return false;
	}
	return true;
}

function checkItemMatch(item, f) {
    if (!item) return false;
    
    // 1. Wand recursion
    if (item.type === 'wand') return checkWandMatch(item, f);
	if (f.queryList.length === 0) return false; // Don't match items if no query is provided
    
    // 2. Spell Item search
    if (item.item === 'spell' && f.queryList.every(q => isMatch(item.spell, q))) return true;

	// Enemies
	if (item.type === 'enemy' && f.queryList.some(q => isMatch(item.enemy, q))) return true;

    // 3. Potion/Pouch Label Synthesis
    // Concatenate material and item (e.g., "water" + " " + "potion") 
    // to allow queries like "water potion" to find matches.
    const material = item.material ? (getDisplayName(item.material)+" " || item.material+" ") : '';
    const itemName = getDisplayName(item.item) || item.item;
    const combinedLabel = `${material}${itemName}`;

    // 4. Generic Item search (Matches against the combined label, material alone, or item alone)
    if (f.queryList.every(q => isMatch(combinedLabel, q) || isMatch(item.material, q) || isMatch(item.item, q))) return true;

    return false;
};

function checkMatch(poi, f) {
	//const data = poi.data;
	const data = poi;
	if (!data) return false;

	if (data.type === 'wand') {
		return checkWandMatch(data, f);
	}
	else if (data.type === 'enemy') {
		// Currently only used for mimics (broken)
		if (f.queryList.length === 0) return false;
		const tempItem = {type:'item', item: data.enemy};
		return checkItemMatch(tempItem, f);
	}
	else if (data.type === 'item') {
		if (f.queryList.length === 0) return false;
		return checkItemMatch(data, f);
	}
	
	else if (CONTAINER_TYPES.includes(data.type)) {
		// Why was this necessary? Empty string search with other filters seems fine
		//if (f.queryList.length === 0) return false;
		// Check container name?
		if (isMatch(data.type, f.queryList.join(','))) return true; // Eh?
		// Check if any item inside the chest matches the query
		return data.items.some(item => checkItemMatch(item, f));
	}
	
	return false;
}

export async function navigateSearch(dir) {
	if (search.results.length === 0) return;
	const searchAllPW = document.getElementById('search-all-pw').checked;
	const cancelBtn = document.getElementById('cancel-search');

	// If at the end and moving forward in "All PW" mode, find more
	if (dir === 1 && search.index === search.results.length - 1 && searchAllPW) {
		//searchActive = true;
		cancelBtn.style.display = 'block';
		const foundNew = await findNextPWMatches(true);
		if (!foundNew) {
			//searchActive = false;
			//cancelBtn.style.display = 'none';
			return; // No more found or cancelled
		}
	}

	// Standard circular navigation for Prev, or simple increment for Next
	search.index += dir;
	
	// Wrap around logic
	if (search.index >= search.results.length) search.index = 0;
	if (search.index < 0) search.index = search.results.length - 1;

	const current = search.results[search.index];
	
	// Sync app PW state to the result's world
	if (current.pw !== undefined && current.pwVertical !== undefined && `${app.pw},${app.pwVertical}` !== `${current.pw},${current.pwVertical}`) {
		app.pw = current.pw;
		app.pwVertical = current.pwVertical;
		document.getElementById('pw').value = app.pw;
		document.getElementById('pw-vertical').value = app.pwVertical;
		// No need to regenerate wands here, findNextPWMatches already scanned them
	}

	const totalStr = searchAllPW ? '?' : search.results.length;
	document.getElementById('search-count').innerText = `${search.index + 1} / ${totalStr}`;
	
	app.gotoPOI(current.poi);
	//searchActive = false;
	//cancelBtn.style.display = 'none';
}

async function findNextPWMatches(isIterative = true) {
	const filters = getSearchFilters(); 
	//const seed = parseInt(document.getElementById('seed').value);
	const seed = app.seed;
	const ngPlusCount = app.ngPlusCount;
	const cancelBtn = document.getElementById('cancel-search');
	let foundInThisWorld = false;

	for (let i = search.lastPwIdx + 1; i < search.pwSequence.length; i++) {
		if (!searchActive) {
			//cancelBtn.style.display = 'none';
			app.setLoading(false);
			return false;
		}
		
		const [targetPW, targetPWVertical] = search.pwSequence[i].split(',').map(Number);
		search.lastPwIdx = i;

		// If iterative, update the existing display text without resetting the show-timer
		if (isIterative) {
			const whitespace = targetPW >= 0 ? '+' : ''; // Align negative PW text (didn't work)
			app.setLoading(true, `Searching PW ${whitespace}${targetPW}, ${targetPWVertical}...`);
		}

		if (!app.poisByPW[`${targetPW},${targetPWVertical}`] || !app.pixelScenesByPW[`${targetPW},${targetPWVertical}`]) {
			const scanResults = scanSpawnFunctions(app.biomeData, app.tileSpawns, seed, ngPlusCount, targetPW, targetPWVertical, app.skipCosmeticScenes, app.perks);
			const specialPoIs = getSpecialPoIs(app.biomeData, seed, ngPlusCount, targetPW, targetPWVertical, app.perks);
			const staticSpawnResults = addStaticPixelScenes(seed, ngPlusCount, targetPW, targetPWVertical, app.biomeData, app.skipCosmeticScenes);
			specialPoIs.push(...staticSpawnResults.pois);
			app.pixelScenesByPW[`${targetPW},${targetPWVertical}`] = scanResults.finalPixelScenes.concat(staticSpawnResults.pixelScenes);
			app.poisByPW[`${targetPW},${targetPWVertical}`] = scanResults.generatedSpawns.concat(specialPoIs);
		}
		for (let poi of app.poisByPW[`${targetPW},${targetPWVertical}`]) {
			if (checkMatch(poi, filters)) {
				poi.highlight = true; // Highlight the PoI on the map
				//console.log(`Found match at PW ${targetPW}, ${targetPWVertical}:`, poi);
				search.results.push({
					poi,
					pw: targetPW,
					pwVertical: targetPWVertical,
					//label: (poi.data.item || (poi.data.name || 'SPAWN')).toUpperCase()
				});
				foundInThisWorld = true;
			}
		}

		if (foundInThisWorld || !isIterative) {
			// Only hide the loader if we are stopping the search here
			if (foundInThisWorld) {
				app.setLoading(false);
			}
			return foundInThisWorld;
		}
		
		// Yield to browser so the UI/Text updates can render
		await new Promise(r => setTimeout(r, 0));
	}

	app.setLoading(false);
	cancelBtn.style.display = 'none';
	return false;
}

async function findNextLocalMatch(mode) {
	const filters = getSearchFilters(); 
	//const seed = parseInt(document.getElementById('seed').value);
	const seed = app.seed;
	const ngPlusCount = app.ngPlusCount;
	const cancelBtn = document.getElementById('cancel-search');
	let found = false;

	// Quick search modes to just find the seed and not do the full computation for no reason
	let quickSearch = null;
	if (mode === 'eoe' && filters.queryList.length === 1 && isMatch('true_orb', filters.queryList[0])) quickSearch = 'true_orb';
	if (mode === 'eoe' && filters.queryList.length === 1 && isMatch('sampo', filters.queryList[0])) quickSearch = 'sampo';
	if (mode === 'tiny' && filters.minSpells === 27) quickSearch = 'highsc';
	const prng = new NollaPrng(0); // To avoid reinstantiating it over and over

	app.setLoading(true, "Searching local area...");
	// Yield to browser so the UI/Text updates can render
	await new Promise(r => setTimeout(r, 0));

	for (let i = search.lastLocalIdx + 1; i < search.localSequence.length; i++) {
		if (!searchActive) {
			//cancelBtn.style.display = 'none';
			app.setLoading(false);
			return false;
		}
		
		//const [currX, currY] = search.localSequence[i].split(',').map(Number);
		const { x: currX, y: currY } = search.localSequence[i];
		search.lastLocalIdx = i;

		//const percentage = ((i + 1) / search.localSequence.length * 100).toFixed(1);
		//app.setLoading(true, `Searching... (${percentage}%)`);

		let item;

		if (mode === "taikasauva") {
			item = generateWand(seed, ngPlusCount, currX, currY, 'wand_level_03', app.perks);
		}
		else if (mode === "tiny") {
			if (quickSearch === 'highsc') {
				prng.SetRandomSeed(app.seed + app.ngPlusCount, currX, currY);
				if (HIGH_SC_SEEDS.includes(prng.Seed)) {
					item = {type: 'tiny',
						items: [
							// Not going to both with the hearts
							generateWand(seed, ngPlusCount, currX-16, currY, 'wand_unshuffle_06', app.perks),
							generateWand(seed, ngPlusCount, currX+16, currY, 'wand_unshuffle_10', app.perks)
						],
						x: currX,
						y: currY
					};
					console.log(item);
				}
			}
			else {
				item = {type: 'tiny',
					items: [
						// Not going to both with the hearts
						generateWand(seed, ngPlusCount, currX-16, currY, 'wand_unshuffle_06', app.perks),
						generateWand(seed, ngPlusCount, currX+16, currY, 'wand_unshuffle_10', app.perks)
					],
					x: currX,
					y: currY
				};
			}
		}
		else if (mode === "eoe") {
			if (quickSearch === 'true_orb') {
				prng.SetRandomSeed(app.seed + app.ngPlusCount, currX, currY);
				if (ORB_SEEDS.has(prng.Seed)) {
					found = true;
					item = {type: 'item', item: 'true_orb', x: currX, y: currY};
				}
			}
			else if (quickSearch === 'sampo') {
				prng.SetRandomSeed(app.seed + app.ngPlusCount, currX, currY);
				if (SAMPO_SEEDS.has(prng.Seed)) {
					found = true;
					item = {type: 'item', item: 'sampo', x: currX, y: currY};
				}
			}
			else {
				item = generateGreatChest(seed, ngPlusCount, currX, currY, app.perks);
			}
		}

		if (item && checkMatch(item, filters)) {
			item.highlight = true; // Highlight the PoI on the map
			item.zoom = true; // Zoom more for single pixel...
			// Add to results
			app.extraPois = (app.extraPois || []).concat(item);
			console.log(`Found local match at ${currX}, ${currY}:`);
			console.log(item);
			search.results.push({
				poi: item,
				x: currX,
				y: currY,
				//label: (poi.data.item || (poi.data.name || 'SPAWN')).toUpperCase()
			});
			found = true;
		}

		if (found) {
			// Only hide the loader if we are stopping the search here
			app.setLoading(false);
			return true;
		}
		
		// Turns out this is why local search was slow, woops.
		// Yield to browser so the UI/Text updates can render
		// Still need to yield *sometimes* or it'll freeze (need to switch to web worker soon)
		// Hacky workaround until I get something better here
		const yieldFrequency = quickSearch !== null ? 10000 : 1000;
		if (i % yieldFrequency === 0) {
			const percentage = (i / search.localSequence.length * 100).toFixed(1);
			app.setLoading(true, `Searching... (${percentage}%)`);
			await new Promise(r => setTimeout(r, 0));
		}
	}

	app.setLoading(false);
	cancelBtn.style.display = 'none';
	return false;
}
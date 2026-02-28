import { isMatch, getDisplayName } from './translations.js';
import { scanSpawnFunctions, getSpecialPoIs } from './poi_scanner.js';
import { TIME_UNTIL_LOADING } from './constants.js';
import { app } from './app.js';
import { CONTAINER_TYPES } from './utils.js';

const SEARCH_ENABLED = true; // Debug

let searchActive = false;
let search = {
	results: [],
	index: -1,
	lastPwIdx: -1, // Tracks position in pwSequence
	pwSequence: []
};

export function isSearchActive() {
	return searchActive;
}

export function cancelSearch() {
	searchActive = false;
	// Clear the sequence and results to reset UI state
    search.results = [];
    search.index = -1;
	// Disable highlights on PoIs
	app.poisByPW[app.pw]?.forEach(poi => {
		poi.highlight = false;
	});
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
		queryList: document.getElementById('search-input').value.split(',').map(s => s.trim().toLowerCase()).filter(s => s),
		name: document.getElementById('search-name').value.toLowerCase(),
		ac: document.getElementById('search-ac').value.toLowerCase(),
		acAny: document.getElementById('search-ac-any').checked,
		nonShuffle: document.getElementById('search-non-shuffle').checked,
		minMana: parseInt(document.getElementById('min-mana').value),
		minCap: parseInt(document.getElementById('min-cap').value),
		maxRech: parseFloat(document.getElementById('max-rech').value),
		minSpells: parseInt(document.getElementById('min-spells').value),
		maxDelay: parseFloat(document.getElementById('max-delay').value),
		minManaRech: parseInt(document.getElementById('min-manarech').value),
		maxSpread: parseInt(document.getElementById('max-spread').value),
		minSpeed: parseFloat(document.getElementById('min-speed').value),
		minLen: parseInt(document.getElementById('min-len').value)
	};
}

export async function performSearch(allowIterative = true, autoNavigate = true) {
	const t0 = performance.now();
	if (!SEARCH_ENABLED) return;
	if (searchActive && allowIterative) return;
	const searchAllPW = allowIterative && document.getElementById('search-all-pw').checked;
	const pwLimit = parseInt(document.getElementById('search-pw-limit').value) || 6;
	const cancelBtn = document.getElementById('cancel-search');

	searchActive = true;
	search.results = [];
	search.index = -1;
	
	
	search.pwSequence = [0];
	for (let i = 1; i <= pwLimit; i++) { 
		search.pwSequence.push(i); 
		search.pwSequence.push(-i); 
	}

	// Logic for Manual Search: If current PW is outside the limit, add it
    if (!searchAllPW && !search.pwSequence.includes(app.pw)) {
        search.pwSequence.push(app.pw);
    }

	if (!searchAllPW) {
		search.lastPwIdx = search.pwSequence.indexOf(app.pw) - 1;
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
		document.getElementById('search-nav').style.display = 'flex';
		// Keep the cancel button visible so highlights can be cleared later
        cancelBtn.style.display = 'block'; 
        cancelBtn.innerText = "Clear Results"; // Update text for clarity
		if (autoNavigate) {
			await navigateSearch(1); 
		} else {
			search.index = 0;
			//searchActive = false; // Keep active so that highlights remain and navigation can work without re-searching
			app.setLoading(false);
		}
	} else {
		document.getElementById('search-nav').style.display = 'none';
		document.getElementById('search-results').innerHTML = '<div style="padding:5px; color:#888;">No results found in range.</div>';
		//cancelBtn.style.display = 'none';
		app.setLoading(false);
		searchActive = false;
	}

	const t1 = performance.now();
	console.log(`Search completed in ${((t1 - t0)/1000).toFixed(3)} s with ${search.results.length} results.`);
}

function checkWandMatch(w, f) {
	const length = w.tip.x - w.grip.x;
	
	// Stat filters
	if (w.mana_max < f.minMana) return false;
	if (w.deck_capacity < f.minCap) return false;
	if ((w.reload_time / 60) > f.maxRech) return false;
	if (w.actions_per_round < f.minSpells) return false;
	if ((w.fire_rate_wait / 60) > f.maxDelay) return false;
	if (w.mana_charge_speed < f.minManaRech) return false;
	if (w.spread_degrees > f.maxSpread) return false;
	if (w.speed_multiplier < f.minSpeed) return false;
	if (length < f.minLen) return false;
	if (f.nonShuffle && w.shuffle_deck_when_empty) return false;
	if (f.name && !isMatch(w.name, f.name)) return false;

	// AC Logic
	if (f.ac) {
		if (!w.always_casts || w.always_casts.length === 0) return false;
		if (!isMatch(w.always_casts.join(','), f.ac)) return false;
	} else if (f.acAny) {
		if (!w.always_casts || w.always_casts.length === 0) return false;
	}

	// Spell set (Comma separated AND, order agnostic)
	if (f.queryList.length > 0) {
		if (!f.queryList.every(q => w.cards.some(s => isMatch(s, q)))) return false;
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

    // 3. Potion/Pouch Label Synthesis
    // Concatenate material and item (e.g., "water" + " " + "potion") 
    // to allow queries like "water potion" to find matches.
    const material = getDisplayName(item.material)+" " || item.material+" " || '';
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

	/*
	// Helper for recursive searching inside containers
	const checkItemMatch = (item) => {
		if (!item) return false;
		if (item.type === 'wand') return checkWandMatch(item, f);
		// Search spell names if it's a spell item
		if (item.item === 'spell' && f.queryList.some(q => isMatch(item.spell, q))) return true;
		// Enemy (TODO: Taikasauva)
		if (item.type === 'enemy' && f.queryList.some(q => isMatch(item.enemy, q))) return true;
		// Search item name and material
		if (f.queryList.some(q => isMatch(item.item, q) || isMatch(item.material, q))) return true;
		return false;
	};
	*/

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
	if (app.pw !== current.pw) {
		app.pw = current.pw;
		document.getElementById('pw').value = app.pw;
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
		
		const targetPW = search.pwSequence[i];
		search.lastPwIdx = i;

		// If iterative, update the existing display text without resetting the show-timer
		if (isIterative) {
			const whitespace = targetPW >= 0 ? '+' : ''; // Align negative PW text (didn't work)
			app.setLoading(true, `Searching PW ${whitespace}${targetPW}...`);
		}

		if (!app.poisByPW[targetPW] || !app.pixelScenesByPW[targetPW]) {
			const scanResults = scanSpawnFunctions(app.biomeData.pixels, app.tileSpawns, seed, ngPlusCount, targetPW, app.skipCosmeticScenes, app.perks);
			const specialPoIs = getSpecialPoIs(app.biomeData.pixels, seed, ngPlusCount, targetPW, app.perks);
			app.pixelScenesByPW[targetPW] = scanResults.finalPixelScenes;
			app.poisByPW[targetPW] = scanResults.generatedSpawns.concat(specialPoIs);
		}
		for (let poi of app.poisByPW[targetPW]) {
			if (checkMatch(poi, filters)) {
				poi.highlight = true; // Highlight the PoI on the map
				//console.log(`Found match at PW ${targetPW}:`, poi);
				search.results.push({
					poi,
					pw: targetPW,
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
import { isMatch, getDisplayName, injectTranslations } from './translations.js';
import { scanSpawnFunctions, getSpecialPoIs } from './poi_scanner.js';
import { addStaticPixelScenes } from './static_spawns.js';
import { generateGreatChest } from './chest_generation.js';
import { generateWand } from './wand_generation.js';
import { SPRITE_RARITY } from './wand_config.js';
import { NollaPrng } from './nolla_prng.js';
import { getDragonDrops, getTinyDrops } from './misc_generation.js';
import { generateSpiral, CONTAINER_TYPES } from './utils.js'; 
import { updateSettings } from './settings.js';
import { injectPixelSceneData, injectPixelSceneSpawnData } from './pixel_scene_generation.js';

let activeSearch = false;
let searchState = null; 
let spiralIterator = null;
let pwIndex = 0;
const prng = new NollaPrng(0);
let workerBiomeData = null;
let workerTileSpawns = null;
let currentPoisByPW = null;
let currentPixelScenesByPW = null;

// Quick Search Seed Caches
let ORB_SEEDS = null;
let SAMPO_SEEDS = null;
const HIGH_SC_T10_SEEDS = [36402008, 37475567, 74727319, 345207455, 377895106, 568379281, 644708457, 653552772, 698862238, 884960988, 1280537179, 1315281277, 1368348114, 1392682761, 1434236773, 1471283855, 1636302025, 1705128673, 1731966418, 1772474495, 2018351783, 2073660843, 2111754688];
const HIGH_SC_T6_SEEDS = [262049561, 884960988];
let HIGH_CAP_T3_SEEDS = null;
let HIGH_CAP_T6NS_SEEDS = null;
let HIGH_CAP_T10NS_SEEDS = null; 
let HIGH_CAP_EOE_SEEDS = null; 

function checkWandMatch(w, f) {
	const length = w.tip.x - w.grip.x;
	
	// Stat filters
	// Note for some prebuilt wands we can't predict stats due to RNG based on frame count, so we'll just skip checks on those
	// Ignore nondeterministic wands. Luckily they all have mana max as a varying stat so this is a simple check
	if (typeof w.mana_max !== 'number') return false;
	if (w.mana_max < f.minMana || w.mana_max > f.maxMana) return false;
	if (w.deck_capacity < f.minCap || w.deck_capacity > f.maxCap) return false;
	if ((w.reload_time / 60) < f.minRech || (w.reload_time / 60) > f.maxRech) return false;
	if (w.actions_per_round < f.minSpells || w.actions_per_round > f.maxSpells) return false;
	if ((w.fire_rate_wait / 60) < f.minDelay || (w.fire_rate_wait / 60) > f.maxDelay) return false;
	if (w.mana_charge_speed < f.minManaRech || w.mana_charge_speed > f.maxManaRech) return false;
	if (w.spread_degrees < f.minSpread || w.spread_degrees > f.maxSpread) return false;
	if (w.speed_multiplier < f.minSpeed || w.speed_multiplier > f.maxSpeed) return false;
	if (length < f.minLen || length > f.maxLen) return false;
	if (f.name && !isMatch(w.name, f.name)) return false;
	if (f.sprite && w.sprite !== `wand_${f.sprite.toString().padStart(4, '0')}`) return false;
	// Not really sure a max threshold would even be useful here
	if (f.minSpriteRarity || f.maxSpriteRarity) {
		if (SPRITE_RARITY !== undefined) {
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

async function fetchSafeJson(url) {
	const dataUrl = new URL(url, import.meta.url);
    const res = await fetch(dataUrl);
    
    // Check if the server returned a 404 or other error
    if (!res.ok) {
        throw new Error(`Failed to fetch ${url}: ${res.status} ${res.statusText}`);
    }

    // Verify the content type is actually JSON before parsing
    const contentType = res.headers.get("content-type");
    if (!contentType || !contentType.includes("application/json")) {
        throw new Error(`Expected JSON from ${url}, but received ${contentType}. File path might be wrong.`);
    }

    return await res.json();
}

async function loadCaches(mode, quickSearch) {
    if (quickSearch === 'true_orb' && !ORB_SEEDS) ORB_SEEDS = new Set(await fetchSafeJson('../data/rng/orb_seeds.json'));
    if (quickSearch === 'sampo' && !SAMPO_SEEDS) SAMPO_SEEDS = new Set(await fetchSafeJson('../data/rng/sampo_seeds.json'));
    if (quickSearch === 'highcap' && mode === 'eoe' && !HIGH_CAP_EOE_SEEDS) HIGH_CAP_EOE_SEEDS = new Set(await fetchSafeJson('../data/rng/eoe_high_capacity_seeds.json'));
    if (quickSearch === 'highcap' && (mode === 'tiny' || mode === 'dragon') && !HIGH_CAP_T6NS_SEEDS) HIGH_CAP_T6NS_SEEDS = new Set(await fetchSafeJson('../data/rng/t6ns_high_capacity_seeds.json'));
    if (quickSearch === 'highcap' && mode === 'tiny' && !HIGH_CAP_T10NS_SEEDS) HIGH_CAP_T10NS_SEEDS = new Set(await fetchSafeJson('../data/rng/t10ns_high_capacity_seeds.json'));
    if (quickSearch === 'highcap' && mode === 'taikasauva' && !HIGH_CAP_T3_SEEDS) HIGH_CAP_T3_SEEDS = new Set(await fetchSafeJson('../data/rng/t3_high_capacity_seeds.json'));
}

self.onmessage = async function(e) {
    const data = e.data;

    if (data.cmd === 'SYNC_METADATA') {
        injectPixelSceneData(data.pixelSceneCache);
        injectPixelSceneSpawnData(data.pixelSceneSpawnDataCache);
        injectTranslations(data.translationsCache);
        workerBiomeData = data.biomeData;
        workerTileSpawns = data.tileSpawns;
        return;
    }
    else if (data.cmd === 'SYNC_SETTINGS') {
        updateSettings(data.settings);
        return; 
    }
    else if (data.cmd === 'START_LOCAL_SEARCH') {
        activeSearch = true;
        searchState = data;
        spiralIterator = generateSpiral(data.startX, data.startY);
        
        await loadCaches(data.mode, data.quickSearch);
        findNextLocalWorker();
    } 
    else if (data.cmd === 'START_PW_SEARCH') {
        activeSearch = true;
        searchState = data;
        pwIndex = 0;
        currentPoisByPW = data.poisByPW; // Avoid accessing this through searchState for performance
        currentPixelScenesByPW = {};
        findNextPWWorker();
    }
    else if (data.cmd === 'FIND_NEXT') {
        if (!activeSearch) return;
        if (searchState.type === 'local') findNextLocalWorker();
        else if (searchState.type === 'pw') findNextPWWorker();
    }
    else if (data.cmd === 'CANCEL') {
        activeSearch = false;
        spiralIterator = null;
        searchState = null;
    }
};

function findNextPWWorker() {
    if (!activeSearch || !searchState) {
        // Return any partial results if we were in the middle of generating a PW when cancelled
        self.postMessage({
            type: 'PWS_GENERATED',
            pois: currentPoisByPW,
            pixelScenes: currentPixelScenesByPW,
            matches: [],
            done: true
        });
        self.postMessage({type: 'DONE'});
        return;
    }
    if (pwIndex >= searchState.pwSequence.length) {
        self.postMessage({
            type: 'PWS_GENERATED',
            pois: currentPoisByPW,
            pixelScenes: currentPixelScenesByPW,
            matches: [],
            done: true
        });
        self.postMessage({ type: 'DONE' });
        activeSearch = false;
        return;
    }

    const { filters, seed, ngPlusCount, skipCosmeticScenes, perks, backgroundMode } = searchState;
    const [targetPW, targetPWVertical] = searchState.pwSequence[pwIndex].split(',').map(Number);
    
    self.postMessage({ type: 'STATUS', msg: `Searching PW ${targetPW >= 0 ? '+' : ''}${targetPW}, ${targetPWVertical}...` });

    if (!currentPoisByPW[`${targetPW},${targetPWVertical}`]) {
        const scanResults = scanSpawnFunctions(workerBiomeData, workerTileSpawns, seed, ngPlusCount, targetPW, targetPWVertical, skipCosmeticScenes, perks);
        const specialPoIs = getSpecialPoIs(workerBiomeData, seed, ngPlusCount, targetPW, targetPWVertical, perks);
        const staticSpawnResults = addStaticPixelScenes(seed, ngPlusCount, targetPW, targetPWVertical, workerBiomeData, skipCosmeticScenes, perks);
        
        specialPoIs.push(...staticSpawnResults.pois);
        const finalPixelScenes = scanResults.finalPixelScenes.concat(staticSpawnResults.pixelScenes);
        currentPoisByPW[`${targetPW},${targetPWVertical}`] = scanResults.generatedSpawns.concat(specialPoIs); // Cache for future searches
        currentPixelScenesByPW[`${targetPW},${targetPWVertical}`] = finalPixelScenes; // Cache for future searches
    }
    let matches = [];
    for (let i = 0; i < currentPoisByPW[`${targetPW},${targetPWVertical}`].length; i++) {
        const poi = currentPoisByPW[`${targetPW},${targetPWVertical}`][i];
        if (checkMatch(poi, filters)) {
            poi.highlight = true; 
            matches.push({ poi, pw: targetPW, pwVertical: targetPWVertical, index: i });
        }
    }

    pwIndex++;

    if (matches.length > 0) {
        if (!backgroundMode) {
            self.postMessage({
                type: 'PWS_GENERATED',
                pois: currentPoisByPW,
                pixelScenes: currentPixelScenesByPW,
                matches: matches
            });
            //self.postMessage({ type: 'MATCHES_FOUND', matches, pw: targetPW, pwVertical: targetPWVertical });
            return; // Pause execution, wait for FIND_NEXT from main thread
        }
        else {
            // Just send matches immediately without the full PW data to avoid memory issues
            self.postMessage({ type: 'MATCHES_FOUND', matches, pw: targetPW, pwVertical: targetPWVertical });
        }
    }

    // Yield to let the worker process messages (like CANCEL) before the next PW
    setTimeout(findNextPWWorker, 0); 
}

function findNextLocalWorker() {
    if (!activeSearch || !searchState) return;
    let iterations = 0;
    const { mode, quickSearch, filters, seed, ngPlusCount, perks, backgroundMode } = searchState;

    let matches = [];

    while (activeSearch) {
        const { value: { x: currX, y: currY } } = spiralIterator.next();
        let lastRadius = null;
        if (iterations === 0) {
            lastRadius = Math.max(Math.abs(currX - searchState.startX), Math.abs(currY - searchState.startY));
        }
        let item = null;

        // Your generation logic from the original findNextLocalMatch
        if (mode === "taikasauva") {
            if (quickSearch === 'highcap') {
                prng.SetRandomSeed(seed + ngPlusCount, currX, currY);
                if (HIGH_CAP_T3_SEEDS.has(prng.Seed)) item = generateWand(seed, ngPlusCount, currX, currY, 'wand_level_03', perks);
            } else {
                item = generateWand(seed, ngPlusCount, currX, currY, 'wand_level_03', perks);
            }
        }
        else if (mode === "tiny") {
            if (quickSearch === 'highsc') {
                prng.SetRandomSeed(seed + ngPlusCount, currX - 16, currY);
                const t6seed = prng.Seed;
                prng.SetRandomSeed(seed + ngPlusCount, currX + 16, currY);
                const t10seed = prng.Seed;
                if (HIGH_SC_T6_SEEDS.includes(t6seed) || HIGH_SC_T10_SEEDS.includes(t10seed)) item = getTinyDrops(seed, ngPlusCount, null, currX, currY, perks);
            }
            else if (quickSearch === 'highcap') {
                prng.SetRandomSeed(seed + ngPlusCount, currX - 16, currY);
                const t6seed = prng.Seed;
                prng.SetRandomSeed(seed + ngPlusCount, currX + 16, currY);
                const t10seed = prng.Seed;
                if (HIGH_CAP_T6NS_SEEDS.has(t6seed) || HIGH_CAP_T10NS_SEEDS.has(t10seed)) item = getTinyDrops(seed, ngPlusCount, null, currX, currY, perks);
            }
            else item = getTinyDrops(seed, ngPlusCount, null, currX, currY, perks);
        }
        else if (mode === "dragon") {
			if (quickSearch === 'highsc') {
				prng.SetRandomSeed(seed + ngPlusCount, currX + 16, currY);
				if (HIGH_SC_T6_SEEDS.includes(prng.Seed)) item = getDragonDrops(seed, ngPlusCount, null, currX, currY, perks);
			}
			else if (quickSearch === 'highcap') {
				prng.SetRandomSeed(seed + ngPlusCount, currX+16, currY);
				if (HIGH_CAP_T6NS_SEEDS.has(prng.Seed)) item = getDragonDrops(seed, ngPlusCount, null, currX, currY, perks);
			}
			else item = getDragonDrops(seed, ngPlusCount, null, currX, currY, perks);
		}
		else if (mode === "eoe") {
			if (quickSearch === 'true_orb') {
				prng.SetRandomSeed(seed + ngPlusCount, currX, currY);
				if (ORB_SEEDS.has(prng.Seed)) item = {type: 'item', item: 'true_orb', x: currX, y: currY};
			}
			else if (quickSearch === 'sampo') {
				prng.SetRandomSeed(seed + ngPlusCount, currX, currY);
				if (SAMPO_SEEDS.has(prng.Seed)) item = {type: 'item', item: 'sampo', x: currX, y: currY};
			}
			else if (quickSearch === 'highcap') {
				prng.SetRandomSeed(seed + ngPlusCount, currX, currY);
				if (HIGH_CAP_EOE_SEEDS.has(prng.Seed)) item = generateGreatChest(seed, ngPlusCount, currX, currY, perks);
			}
			else item = generateGreatChest(seed, ngPlusCount, currX, currY, perks);
		}

        if (item && checkMatch(item, filters)) {
            item.highlight = true;
            item.zoom = true;
            matches.push({ item, x: currX, y: currY });
            // If your search is too broad, this will lag because too many messages are being sent.
            //self.postMessage({ type: 'MATCH_FOUND', item, x: currX, y: currY });
            
            if (!backgroundMode) {
                self.postMessage({ type: 'MATCH_FOUND', item, x: currX, y: currY });
                return; // Pause and wait for next
            }
        }

        iterations++;

        // Throttle to keep the thread responsive (unsure what the update period should be, might need to vary it by search objective)
        let iterationScale = 1;
        if (quickSearch === 'true_orb' || quickSearch === 'sampo') iterationScale = 100;
        if (quickSearch === 'highsc') iterationScale = 100;
        if (quickSearch === 'highcap') iterationScale = 10;
        if (iterations % (1000 * iterationScale) === 0) {
            if (matches.length > 0) {
                self.postMessage({ type: 'LOCAL_MATCHES_FOUND', matches });
                //matches = []; // Cleared by recursion
            }
            const currentRadius = Math.max(Math.abs(currX - searchState.startX), Math.abs(currY - searchState.startY));
            if (currentRadius !== lastRadius) {
                self.postMessage({ 
                    type: 'PROGRESS', 
                    checked: iterations, 
                    radius: currentRadius,
                    startX: searchState.startX,
                    startY: searchState.startY
                });
            }
            if (activeSearch) {
                setTimeout(findNextLocalWorker, 0);
            }
            return;
        }
    }
}
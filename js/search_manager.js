import { app } from './app.js';
import { TIME_UNTIL_LOADING } from './constants.js';
import { isMatch } from './translations.js';
import { appSettings, updateSettings, updateSettingsFromUI } from './settings.js';
import { PIXEL_SCENE_DATA, PIXEL_SCENE_SPAWN_DATA } from './pixel_scene_generation.js';
import { TRANSLATIONS } from './translations.js';
import { unlockedSpells } from './unlocks.js';
import { getOrGenerateWorld } from './world_manager.js';

const SEARCH_ENABLED = true;
let searchActive = false; // Whether to display the search results
let searchContinuing = false; // Whether the search is still ongoing
let pendingAutoNavigate = false; // Whether to go to the next match when found
let search = { results: [], index: -1, mode: null };
export let activeLocalSearchArea = null;

let lastUpdateDrawTime = 0;
const UPDATE_DRAW_INTERVAL = 16; // ms

// Sync PoIs by PW with the worker so it can do filtering without needing to send all data back and forth
let syncedKeys = new Set();

export function syncSearchWorkerData() {
    searchWorker.postMessage({
        cmd: 'SYNC_METADATA',
        pixelSceneCache: PIXEL_SCENE_DATA,
        pixelSceneSpawnDataCache: PIXEL_SCENE_SPAWN_DATA,
        translationsCache: TRANSLATIONS,
        unlockedSpellsCache: unlockedSpells,
        biomeData: app.biomeData,
        tileSpawns: app.tileSpawns
    });
    // Reset cache to ensure no weirdness with desyncs
    syncedKeys = new Set();
}

// Ensure you have an element id='search-background' in your HTML for this toggle
const isBackgroundSearchEnabled = () => document.getElementById('search-background')?.checked || false;

// Soft cancel, without really canceling, but clearing highlights and resetting
export function clearHighlights() {
    for (let result of search.results) {
        // Clear the highlight from the REAL PoI
        // Doesn't apply to local search though
        if (result.pw !== undefined && result.pwVertical !== undefined && result.index !== undefined && app.poisByPW[`${result.pw},${result.pwVertical}`] && app.poisByPW[`${result.pw},${result.pwVertical}`][result.index]) {
            app.poisByPW[`${result.pw},${result.pwVertical}`][result.index].highlight = false;
        }
        //result.poi.highlight = false;
    }
	search.results = [];
	search.index = -1;
    search.mode = null;
    document.getElementById('search-nav').style.display = 'none';
    activeLocalSearchArea = null;
    // Might not be necessary?
    /*
	app.poisByPW[`${app.pw},${app.pwVertical}`]?.forEach(poi => {
		poi.highlight = false;
	});
    */
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

const searchWorker = new Worker(new URL('./search_worker.js', import.meta.url), { type: 'module' });

searchWorker.onmessage = async (e) => {
    const msg = e.data;
    const bgMode = isBackgroundSearchEnabled();

    if (msg.type === 'STATUS' && searchActive) {
        if (!bgMode) {
            app.setLoading(true, msg.msg);
        }
        document.getElementById('search-status-container').style.display = 'flex';
        document.getElementById('search-status').innerText = msg.msg;
    }
    else if (msg.type === 'REQUEST_PW_DATA') {
        getOrGenerateWorld(msg.pw, msg.pwVertical);
    }
    // Deprecated
    else if (msg.type === 'PWS_GENERATED') {
        // Cache the PW data sent back from the worker so the map can draw it
        //const pwKey = `${msg.pw},${msg.pwVertical}`;
        //app.poisByPW[pwKey] = msg.pois;
        //app.pixelScenesByPW[pwKey] = msg.pixelScenes;
        // This might take a while
        //const t0 = performance.now();
        for (let pwKey of Object.keys(msg.pois)) {
            if (!app.poisByPW[pwKey]) {
                app.poisByPW[pwKey] = msg.pois[pwKey];
            }
        }
        
        for (let pwKey of Object.keys(msg.pixelScenes)) {
            if (!app.pixelScenesByPW[pwKey]) {
                app.pixelScenesByPW[pwKey] = msg.pixelScenes[pwKey];
            }
            // Sync any newly generated pixel scene variants to the main thread cache so they can be used in the UI
            for (const scene of msg.pixelScenes[pwKey]) {
                // Ensure the variant dictionary exists
                if (!PIXEL_SCENE_DATA[scene.key].variants) {
                    PIXEL_SCENE_DATA[scene.key].variants = {};
                }
                
                // If the main thread doesn't have this recolored variant yet, save it
                if (!PIXEL_SCENE_DATA[scene.key].variants[scene.variantKey]) {
                    PIXEL_SCENE_DATA[scene.key].variants[scene.variantKey] = scene.imgElement;
                }
            }
        }

        //const t1 = performance.now();
        //console.log(`Processed PW data in ${((t1 - t0) / 1000).toFixed(2)} seconds`);

        if (msg.matches.length > 0) {
            processPWMatches(msg.matches);
        }
        const isDone = msg.done || false;
        if (isDone) {
            app.setLoading(false);
            searchContinuing = false;
            document.getElementById('search-status').innerText = '';
            document.getElementById('search-status-container').style.display = 'none';
        }
        //const lastIndex = search.index;
        updateUIForMatches();
        if (!isBackgroundSearchEnabled()) {
            app.setLoading(false); // Prevent blocking popup
            /*
            if (lastIndex != -1) {
                navigateSearch(1); // Navigate to the first result after the worker finds it
            }
            */
        }
        
    }
    else if (msg.type === 'MATCH_FOUND') {
        const { item, x, y } = msg;
        app.setLoading(false);
        app.extraPois = (app.extraPois || []).concat(item);
        search.results.push({ poi: item, x, y });
        updateUIForMatches();
    }
    else if (msg.type === 'LOCAL_MATCHES_FOUND') {
        const { matches } = msg;
        app.setLoading(false);
        app.extraPois = (app.extraPois || []).concat(matches.map(m => m.item));
        search.results.push(...matches.map(m => ({ poi: m.item, x: m.x, y: m.y })));
        updateUIForMatches();
    }
    else if (msg.type === 'MATCHES_FOUND') {
        const { matches, pw, pwVertical } = msg;
        app.setLoading(false);
        processPWMatches(matches);
    }
    else if (msg.type === 'DONE') {
        app.setLoading(false);
        if (search.results.length === 0) {
            // Already done in update ui for matches
            /*
            let noResultsDisplay = 'No results found.';
            if (search.mode === 'pw' && search.pwSequence.length > 1) {
                noResultsDisplay = `No results found in this range of PWs.`;
            }
            else if (search.mode === 'pw') {
                noResultsDisplay = `No results found in this PW.`;
            }
            document.getElementById('search-results').innerHTML = `<div style="padding:5px; color:#888;">${noResultsDisplay}</div>`;
            cancelSearch();
            */
        }
        document.getElementById('search-status').innerText = '';
        document.getElementById('search-status-container').style.display = 'none';
        searchContinuing = false;
        pendingAutoNavigate = false;
        updateUIForMatches();
    }
    else if (msg.type === 'PROGRESS') {
        // Update the area state
        activeLocalSearchArea = {
            x: msg.startX,
            y: msg.startY,
            r: msg.radius
        };
        
        // Redraw but not too frequently to avoid performance issues
        const now = performance.now();
        if (now - lastUpdateDrawTime > UPDATE_DRAW_INTERVAL) {
            app.draw();
            lastUpdateDrawTime = now;
        }
    }
};

async function updateUIForMatches() {
    document.getElementById('search-nav').style.display = 'block';
    document.getElementById('search-results').innerHTML = '';
    
    const cancelBtn = document.getElementById('cancel-search');
    cancelBtn.style.display = 'block';
    cancelBtn.innerText = searchContinuing ? "Stop Search" : "Clear Results";

    if (search.results.length === 0) {
        let noResultsDisplay = 'No results found.';
        if (search.mode === 'pw' && search.pwSequence.length > 1) {
            noResultsDisplay = `No results found in this range of PWs.`;
        }
        else if (search.mode === 'pw') {
            noResultsDisplay = `No results found in this PW.`;
        }
        document.getElementById('search-results').innerHTML = `<div style="padding:5px; color:#888;">${noResultsDisplay}</div>`;
        cancelBtn.style.display = 'none';
        document.getElementById('search-nav').style.display = 'none';
        // Cancel search?
    }
    else {
        // Highlight PoIs
        search.results.forEach(result => {
            result.highlight = true;
        });
        // If we just found the first item, navigate to it automatically
        if (search.index === -1 || pendingAutoNavigate) {
            //console.log("Navigating to first match...");
            pendingAutoNavigate = false;
            await navigateSearch(1);
        } else {
            // Just update the total count without navigating
            const suffix = searchContinuing ? "..." : "";
            document.getElementById('search-count').innerText = `${search.index + 1} / ${search.results.length}${suffix}`;
        }
    }

    if (!searchContinuing) app.setLoading(false);
}

export async function performSearch(allowIterative = true, autoNavigate = true) {
    if (!SEARCH_ENABLED) return;
    if (searchActive && allowIterative) return;
    
    const searchAllPW = allowIterative && document.getElementById('search-all-pw').checked;
    const pwLimit = parseInt(document.getElementById('search-pw-limit').value) || 6;
    const searchVerticalPW = document.getElementById('search-vertical-pw').checked;
    const pwVerticalLimit = parseInt(document.getElementById('search-pw-vertical-limit').value) || 6;
    const cancelBtn = document.getElementById('cancel-search');

    clearHighlights();
    document.getElementById('search-nav').style.display = 'none';
    document.getElementById('search-results').innerHTML = '';

    searchActive = true;
    search.results = [];
    search.index = -1;
    search.mode = 'pw';
    
    let currentSequence = [];

    // Generate the standard PW Sequence
    if (!searchVerticalPW) {
        currentSequence = ['0,0'];
        for (let i = 1; i <= pwLimit; i++) { 
            currentSequence.push(`${i},0`); 
            currentSequence.push(`-${i},0`); 
        }
    } else {
        const coords = [];
        // Generate all valid coordinates within the rectangle
        for (let x = -pwLimit; x <= pwLimit; x++) {
            for (let y = -pwVerticalLimit; y <= pwVerticalLimit; y++) {
                coords.push({ x, y, dist: Math.abs(x) + Math.abs(y) });
            }
        }
        // Sort by Manhattan distance, then by X and Y to keep it deterministic
        coords.sort((a, b) => a.dist - b.dist || a.x - b.x || a.y - b.y);
        currentSequence = coords.map(c => `${c.x},${c.y}`);
    }

    // Logic for Manual Search
    if (!searchAllPW) {
        // If we are only searching the current PW, we don't need the whole sequence
        currentSequence = [`${app.pw},${app.pwVertical}`];
    } else {
        // If searching all, ensure the starting PW is in the sequence if it falls outside the limit
        if (!currentSequence.includes(`${app.pw},${app.pwVertical}`)) {
            currentSequence.push(`${app.pw},${app.pwVertical}`);
        }
        
        cancelBtn.style.display = 'block';
        cancelBtn.innerText = "Cancel Search";
    }

    search.pwSequence = currentSequence;

    // Give a small yield for the setLoading timer to start
    if (searchAllPW && !isBackgroundSearchEnabled()) {
        app.setLoading(true, "Initializing Search...");
        await new Promise(r => setTimeout(r, TIME_UNTIL_LOADING));
    }

    const filters = getSearchFilters();

    searchContinuing = isBackgroundSearchEnabled() || searchAllPW; // If searching all PW, we consider it a long-running search even if not in background mode

    // Send the payload to the worker
    searchWorker.postMessage({
        cmd: 'START_PW_SEARCH',
        type: 'pw',
        backgroundMode: isBackgroundSearchEnabled(),
        filters: filters,
        pwSequence: search.pwSequence,
        //seed: app.seed,
        //ngPlusCount: app.ngPlusCount,
        //perks: app.perks,
        //skipCosmeticScenes: app.skipCosmeticScenes,
        //poisByPW: app.poisByPW // expensive
    });
}

export async function performLocalSearch(mode, startX, startY) {
    if (!SEARCH_ENABLED) return;
    if (searchActive) cancelSearch(); 

    clearHighlights();
    document.getElementById('search-nav').style.display = 'none';
    document.getElementById('search-results').innerHTML = '';

    searchActive = true;
    search.results = [];
    search.index = -1;
    search.mode = 'local';

    const cancelBtn = document.getElementById('cancel-search');
    cancelBtn.style.display = 'block';
    cancelBtn.innerText = "Cancel Search";
    // Actually looks better without this display
    /*
    if (!isBackgroundSearchEnabled()) {
        app.setLoading(true, "Searching...");
    }
    */
    
    const filters = getSearchFilters();

    let quickSearch = null;
    if (mode === 'eoe' && filters.queryList.length === 1 && isMatch('true_orb', filters.queryList[0])) quickSearch = 'true_orb';
    else if (mode === 'eoe' && filters.queryList.length === 1 && isMatch('sampo', filters.queryList[0])) quickSearch = 'sampo';
    // No real speedup for this compared to highcap since we're already using set lookups, but I did precompute the seeds for these so might as well use them
    else if (filters.minSpells >= 27 && (mode === 'dragon' || mode === 'tiny')) quickSearch = 'highsc';
    else if (filters.minCap >= 27 || filters.minSpells >= 27) quickSearch = 'highcap';
    else if (filters.minSpriteRarity >= 7) quickSearch = 'raresprite';

    searchContinuing = true; //isBackgroundSearchEnabled();
    
    searchWorker.postMessage({
        cmd: 'START_LOCAL_SEARCH',
        type: 'local',
        backgroundMode: isBackgroundSearchEnabled(),
        mode,
        quickSearch,
        startX,
        startY,
        filters,
        seed: app.seed,
        ngPlusCount: app.ngPlusCount,
        perks: app.perks
    });
}

export async function navigateSearch(dir) {
    if (search.results.length === 0) return;
    const bgMode = isBackgroundSearchEnabled();
    
    // If we are at the end of results, and NOT in background mode, ask the worker for the next one
    // If searchContinuing is false, but this was triggered, it means the search was re-enabled...
    if (dir === 1 && search.index === search.results.length - 1 && !bgMode && searchContinuing) {
        // Check if it's a local search, if so don't display the loading
        if (search.mode !== 'local') {
            app.setLoading(true, "Searching...");
        }
        pendingAutoNavigate = true;
        searchWorker.postMessage({ cmd: 'FIND_NEXT' });
        return;
    }

    search.index += dir;
    if (search.index >= search.results.length) search.index = 0;
    if (search.index < 0) search.index = search.results.length - 1;

    const current = search.results[search.index];
    
    // PW map sync logic
    if (current.pw !== undefined && `${app.pw},${app.pwVertical}` !== `${current.pw},${current.pwVertical}`) {
        app.pw = current.pw;
        app.pwVertical = current.pwVertical;
        document.getElementById('pw').value = app.pw;
        document.getElementById('pw-vertical').value = app.pwVertical;
    }

    const suffix = searchContinuing ? " ..." : "";
    document.getElementById('search-count').innerText = `${search.index + 1} / ${search.results.length}${suffix}`;
    
    app.gotoPOI(current.poi);
}

export function cancelSearch() {
    searchActive = false;
    activeLocalSearchArea = null;
    pendingAutoNavigate = false;
    document.getElementById('search-status').innerText = '';
    document.getElementById('search-status-container').style.display = 'none';
    searchWorker.postMessage({ cmd: 'CANCEL' }); 
    // Not clearing highlights here
    const cancelBtn = document.getElementById('cancel-search');
    // TODO: Doing this based on the text is not ideal
    if (searchContinuing) {
        //console.log("Stopping search but keeping results...");
        cancelBtn.innerText = 'Clear Results';
        cancelBtn.style.display = 'block';
        searchContinuing = false;
        document.getElementById('search-count').innerText = `${search.index + 1} / ${search.results.length}`;
    }
    else {
        cancelBtn.style.display = 'none';
        document.getElementById('search-nav').style.display = 'none';
        clearHighlights();
    }
    
    // Keep searchNav visible if we have results
    /*
    if (search.results.length === 0) {
        const searchNav = document.getElementById('search-nav');
        if (searchNav) searchNav.style.display = 'none';
    }
    */
}

export function isSearchActive() {
    return searchActive;
}

// TODO: Sync...
export function syncSettingsToSearchWorker() {
    updateSettingsFromUI();
    searchWorker.postMessage({
        cmd: 'SYNC_SETTINGS',
        settings: appSettings,
        unlockedSpellsCache: unlockedSpells
    });
    //console.log(appSettings);
    // Reset cache to ensure no weirdness with desyncs
    syncedKeys = new Set();
}

function processPWMatches(matches) {
    for (let match of matches) {
        const pwKey = `${match.pw},${match.pwVertical}`;
        
        // Ensure the array exists and the index is valid
        if (app.poisByPW[pwKey] && app.poisByPW[pwKey][match.index]) {
            // 1. Grab the actual, authoritative object the map is using to render
            const realPoi = app.poisByPW[pwKey][match.index];
            
            // 2. Turn on the highlight for the map renderer
            realPoi.highlight = true;
            
            // 3. Swap out the cloned worker object for the real one 
            // so app.gotoPOI() navigates to the correct reference later
            match.poi = realPoi;
        }
    }

    // Now safely add them to the search results
    search.results.push(...matches);
    updateUIForMatches();
}

// TODO: Refactor to not repeat the world generation here
export function continueSearchSequence(pw, pwVertical) {
    // Called by the world worker after generating a world
    const key = `${pw},${pwVertical}`;
    if (app.poisByPW[key] && !syncedKeys.has(key)) {
        syncedKeys.add(key);
        searchWorker.postMessage({
            cmd: 'SYNC_DATA',
            pw,
            pwVertical,
            pois: app.poisByPW[key]
        });
    }

    // Is this right?
    if (searchActive) {
        searchWorker.postMessage({
            cmd: 'FIND_NEXT'
        });
    }
}
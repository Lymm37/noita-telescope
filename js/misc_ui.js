import { getDisplayName } from "./translations.js";
import { POTION_COLORS } from './potion_config.js';
import { getTemplePerks, rerollTemplePerks, pickupPerk } from "./perks.js";

function capitalize(str) {
    if (typeof str !== 'string' || str.length === 0) {
        return str;
    }
    return str.split(' ').map(word => word.charAt(0).toUpperCase() + word.slice(1)).join(' ');
}

// Helper to grab the hex color, strip the Noita ARGB alpha, and add the '#'
function getColorStyle(material) {
    const rawHex = POTION_COLORS[material];
    if (rawHex) {
        // Remove the first 2 characters (Alpha) and prepend '#'
        return `color: #${rawHex.slice(2)};`;
    }
    return 'color: #e0e0e0;'; // Fallback neutral color
}

/**
 * Renders the fungal shifts data to the DOM.
 * @param {Array} shiftsData - The array of shift objects.
 */
export function renderFungalShifts(shiftsData) {
    const listElement = document.getElementById('shifts-list');
    listElement.innerHTML = ''; 

    shiftsData.forEach((shift, index) => {
        const li = document.createElement('li');
        li.className = 'shift-item';

        let filteredFrom = shift.fromMaterials.filter(mat => !mat.endsWith('_static'));
        if (filteredFrom.length === 0) {
            filteredFrom = shift.fromMaterials;
        }

        // 1. Format the 'From' materials with inline colors
        const fromMaterialsText = filteredFrom
            .map(mat => `<span class="material-hover" title="${mat}" style="${getColorStyle(mat)}">${capitalize(getDisplayName(mat))}</span>`)
            .join('<span class="comma">, </span><br>');

        const fromHtml = `
            <span class="material-from">${fromMaterialsText}</span>
            ${shift.flaskFrom ? '<span class="flask-tag">Held</span>' : ''}
        `;

        // 2. Format the 'To' material with inline color
        const toHtml = `
            <span class="material-to">
                <span class="material-hover" title="${shift.toMaterial}" style="${getColorStyle(shift.toMaterial)}">${capitalize(getDisplayName(shift.toMaterial))}</span>
            </span>
            ${shift.flaskTo ? '<span class="flask-tag">Held</span>' : ''}
        `;

        // 3. Handle the special gold/grass shifts with inline colors
        let specialHtml = '';
        if (shift.goldToX !== null || shift.grassToX !== null) {
            const goldText = shift.goldToX !== null 
                ? `<span class="material-hover" title="gold" style="${getColorStyle('gold')}">Gold</span> <span class="arrow">➔</span> <span class="material-hover" title="${shift.goldToX}" style="${getColorStyle(shift.goldToX)}">${capitalize(getDisplayName(shift.goldToX))}</span>` 
                : '';
            const grassText = shift.grassToX !== null 
                ? `<span class="material-hover" title="grass_holy" style="${getColorStyle('grass_holy')}">Divine Ground</span> <span class="arrow">➔</span> <span class="material-hover" title="${shift.grassToX}" style="${getColorStyle(shift.grassToX)}">${capitalize(getDisplayName(shift.grassToX))}</span>` 
                : '';
            
            const combinedSpecial = [goldText, grassText].filter(Boolean).join('<br>');
            specialHtml = `<div class="special-shifts">${combinedSpecial}</div>`;
        }

        // 4. Assemble the row
        li.innerHTML = `
            <div class="shift-row">
                <span class="shift-index">#${index + 1}</span>
                ${fromHtml}
            </div>
            <div class="shift-row indented-row">
                <span class="arrow">➔</span>
                ${toHtml}
            </div>
            ${specialHtml}
        `;

        listElement.appendChild(li);
    });
}

/**
 * Renders the secret alchemy recipes to the DOM.
 * @param {Object} alchemyMaterials - The object containing livelyConcoction and alchemicPrecursor arrays.
 */
export function renderAlchemyRecipes(alchemyMaterials) {
    const listElement = document.getElementById('alchemy-list');
    listElement.innerHTML = ''; 

    // Define the recipes with their target outputs
    const recipes = [
        {
            name: "Lively Concoction",
            inputs: alchemyMaterials.livelyConcoction,
            output: "magic_liquid_hp_regeneration_unstable"
        },
        {
            name: "Alchemic Precursor",
            inputs: alchemyMaterials.alchemicPrecursor,
            output: "midas_precursor"
        }
    ];

    recipes.forEach(recipe => {
        const li = document.createElement('li');
        li.className = 'shift-item'; // Reuse the shift item styling

        // 1. Format the input materials separated by '+'
        const inputHtml = recipe.inputs
            .map(mat => {
                return `<span class="material-hover" title="${mat}" style="${getColorStyle(mat)};">${capitalize(getDisplayName(mat))}</span>`;
            })
            .join('<br><span class="plus"> + </span>');

        // 2. Format the output material
        const outputHtml = `
            <span class="material-hover" title="${recipe.output}" style="${getColorStyle(recipe.output)};">
                ${capitalize(getDisplayName(recipe.output))}
            </span>
        `;

        // 3. Assemble the row (reusing shift layout classes)
        li.innerHTML = `
            <div class="shift-row">
                <span class="material-from">${inputHtml}</span>
            </div>
            <div class="shift-row indented-row">
                <span class="arrow">➔</span>
                <span class="material-to">${outputHtml}</span>
            </div>
        `;

        listElement.appendChild(li);
    });
}




// Internal state
let worldRerolls = { 0: [0, 0, 0, 0, 0, 0, 0] }; 
let uiSelectedPerks = {}; // Format: { "worldIndex-templeIndex": ["PERK_ID_1", "PERK_ID_2"] }

let currentSeed = 1;
let currentNg = 0;
let currentWorldIndex = 0; 
let perkPickups = {}; 
let gameMode = 'normal';
let perkLotteryCount = 0;

function formatPerkName(id) {
    if (!id) return '';
    
    // If it's a spell object (from GetRandomActionWithType), extract the string ID
    if (typeof id === 'object') {
        id = JSON.stringify(id).replace(/\n/g, ''); // Mostly for debug
    } else if (typeof id !== 'string') {
        id = String(id); // Safety fallback
    }

    return id.split('_')
             .map(word => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
             .join(' ');
}

function getTempleCount(ng, worldIndex) {
    if (ng > 0) return 5;
    return worldIndex === 0 ? 7 : 6;
}

/**
 * Recalculates all perks by simulating the exact draw order from World 0, Temple 0.
 * Dynamically injects selected perks into the state to affect subsequent temples.
 */
export function renderPerkUI() {
    const listElement = document.getElementById('temple-list');
    if (!listElement) return;
    listElement.innerHTML = '';

    // Bind static header controls
    const pwLabel = document.getElementById('pw-label');
    const prevBtn = document.getElementById('prev-pw');
    const nextBtn = document.getElementById('next-pw');
    const lotteryInput = document.getElementById('lottery-count');

    if (pwLabel) pwLabel.textContent = currentWorldIndex === 0 ? "Main World" : "PW " + currentWorldIndex;
    
    if (prevBtn) {
        prevBtn.disabled = currentWorldIndex === 0;
        prevBtn.onclick = () => {
            if (currentWorldIndex > 0) {
                currentWorldIndex--;
                renderPerkUI();
            }
        };
    }

    if (nextBtn) {
        nextBtn.onclick = () => {
            currentWorldIndex++;
            renderPerkUI();
        };
    }

    if (lotteryInput) {
        lotteryInput.onchange = (e) => {
            perkLotteryCount = Math.min(6, Math.max(0, parseInt(e.target.value) || 0));
            renderPerkUI();
        };
    }

    // 1. Prepare simulation state
    let pIdx = 0;
    let rIdx = null;
    
    let accumulatedPickups = JSON.parse(JSON.stringify(perkPickups));
    let accumulatedLottery = perkLotteryCount;

    // 2. The Unified Simulation Loop
    for (let w = 0; w <= currentWorldIndex; w++) {
        let tCount = getTempleCount(currentNg, w);
        if (!worldRerolls[w]) worldRerolls[w] = new Array(tCount).fill(0);
        let rerolls = worldRerolls[w];
        
        for (let t = 0; t < tCount; t++) {
            // A. Base Generation 
            let baseRoll = getTemplePerks(currentSeed, currentNg, w, t, pIdx, accumulatedPickups, gameMode);
            pIdx = baseRoll.perkIndex;
            let finalPerks = baseRoll.perks;

            // B. Rerolls 
            let rCount = rerolls[t] || 0;
            for (let r = 0; r < rCount; r++) {
                let reroll = rerollTemplePerks(currentSeed, currentNg, w, t, pIdx, rIdx, accumulatedPickups, gameMode);
                rIdx = reroll.rerollIndex;
                finalPerks = reroll.perks;
            }

            // C. Clean up selections
            const selectionKey = `${w}-${t}`;
            let selectedInTemple = uiSelectedPerks[selectionKey] || [];
            selectedInTemple = selectedInTemple.filter(perkId => finalPerks.some(p => p.perk === perkId));
            uiSelectedPerks[selectionKey] = selectedInTemple;

            // Count any lotteries picked RIGHT NOW in this temple
            let localLotteries = selectedInTemple.filter(id => id === 'PERKS_LOTTERY').length;
            let currentTempleLotteryCount = accumulatedLottery + localLotteries;

            // D. Render DOM
            if (w === currentWorldIndex) {
                const row = document.createElement('div');
                row.className = 'temple-row';

                const cardsHtml = finalPerks.map(p => {
                    // Use the newly calculated currentTempleLotteryCount so it affects this temple immediately
                    const luckyIndex = Math.min(currentTempleLotteryCount, p.luckyStates.length - 1);
                    const isLucky = p.luckyStates[luckyIndex];
                    const luckyClass = isLucky ? 'lucky-perk' : '';
                    
                    const isSelected = selectedInTemple.includes(p.perk);
                    const selectedClass = isSelected ? 'selected-perk' : '';
                    
                    let titleText = `${formatPerkName(p.perk)}${isLucky ? ' (Lucky)' : ''}`;
                    let altText = `${p.perk}${isLucky ? ' (Lucky)' : ''}`;

                    if (p.perk === 'ALWAYS_CAST' && p.alwaysCast) {
                        const spellName = formatPerkName(p.alwaysCast);
                        titleText += `\nSpell: ${spellName}`;
                        altText += ` (Spell: ${spellName})`;
                    }

                    // Render Gamble Preview UI if applicable
                    let gambleHtml = '';
                    if (p.perk === 'GAMBLE' && p.hypotheticalGamble) {
                        gambleHtml = `<div class="gamble-preview">
                            ${p.hypotheticalGamble.perks.map(gp => `
                                <img class="gamble-icon" 
                                     title="${formatPerkName(gp)}" 
                                     src="data/perk_sprites/${gp.toLowerCase()}.png" 
                                     onerror="this.src='data/perk_sprites/unknown.png'">
                            `).join('')}
                        </div>`;
                    }

                    return `
                        <div class="perk-card ${selectedClass}" data-temple="${t}" data-perk="${p.perk}">
                            <img class="perk-icon ${luckyClass}" 
                                 title="${titleText}" 
                                 src="data/perk_sprites/${p.perk.toLowerCase()}.png" 
                                 alt="${altText}" 
                                 onerror="this.src='data/perk_sprites/unknown.png'">
                            ${gambleHtml}
                        </div>
                    `;
                }).join('');

                row.innerHTML = `
                    <div class="perk-cards">
                        ${cardsHtml}
                    </div>
                    <div class="reroll-controls">
                        <button class="reroll-btn minus-btn" data-temple="${t}" ${rCount === 0 ? 'disabled' : ''}>-</button>
                        <span class="reroll-count">${rCount}</span>
                        <button class="reroll-btn plus-btn" data-temple="${t}">+</button>
                    </div>
                `;
                listElement.appendChild(row);
            }

            // E. Apply selected perks to the accumulated state for NEXT temple
            selectedInTemple.forEach(perkId => {
                accumulatedPickups = pickupPerk(perkId, accumulatedPickups);
                if (perkId === 'PERKS_LOTTERY') {
                    accumulatedLottery++;
                }

                // If Gamble is picked, advance the deck and ingest the two new perks
                if (perkId === 'GAMBLE') {
                    const gamblePerkObj = finalPerks.find(p => p.perk === 'GAMBLE');
                    if (gamblePerkObj && gamblePerkObj.hypotheticalGamble) {
                        pIdx = gamblePerkObj.hypotheticalGamble.perkIndex; // Advance deck
                        
                        gamblePerkObj.hypotheticalGamble.perks.forEach(gp => {
                            accumulatedPickups = pickupPerk(gp, accumulatedPickups);
                            if (gp === 'PERKS_LOTTERY') {
                                accumulatedLottery++; // In case Gamble gives us a lottery!
                            }
                        });
                    }
                }
            });
        }
    }

    // 3. Attach interactive events using Delegation
    listElement.onclick = (e) => {
        const card = e.target.closest('.perk-card');
        if (card) {
            const t = card.getAttribute('data-temple');
            const perkId = card.getAttribute('data-perk');
            const key = `${currentWorldIndex}-${t}`;
            
            if (!uiSelectedPerks[key]) uiSelectedPerks[key] = [];
            
            if (uiSelectedPerks[key].includes(perkId)) {
                uiSelectedPerks[key] = uiSelectedPerks[key].filter(id => id !== perkId); 
            } else {
                uiSelectedPerks[key].push(perkId); 
            }
            renderPerkUI();
            return;
        }

        const minusBtn = e.target.closest('.minus-btn');
        if (minusBtn) {
            const t = parseInt(minusBtn.getAttribute('data-temple'), 10);
            if (worldRerolls[currentWorldIndex][t] > 0) {
                worldRerolls[currentWorldIndex][t]--;
                renderPerkUI();
            }
            return;
        }

        const plusBtn = e.target.closest('.plus-btn');
        if (plusBtn) {
            const t = parseInt(plusBtn.getAttribute('data-temple'), 10);
            worldRerolls[currentWorldIndex][t]++;
            renderPerkUI();
            return;
        }
    };
}

/**
 * Updates global state. 
 */
export function updatePerksState(seed, ng, sequenceIndex = 0, newPerkPickups = {}, newGameMode = 'normal', lotteryCount = 0) {
    currentSeed = seed;
    currentNg = ng;
    currentWorldIndex = sequenceIndex; 
    perkPickups = newPerkPickups;
    gameMode = newGameMode;
    perkLotteryCount = lotteryCount;
    
    // Clear history when root settings change
    worldRerolls = {};
    uiSelectedPerks = {};
    
    const lotteryInput = document.getElementById('lottery-count');
    if (lotteryInput) lotteryInput.value = perkLotteryCount;
    
    renderPerkUI();
}
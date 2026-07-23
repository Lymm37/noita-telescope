import { getDisplayName } from "./translations.js";
import { POTION_COLORS } from './potion_config.js';
import { getTemplePerks, rerollTemplePerks, pickupPerk, getGamblePerks, getAlwaysCasts, PERKS } from "./perks.js";

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
let pwRerolls = { 0: [0, 0, 0, 0, 0, 0, 0] }; 
let uiSelectedPerks = {}; 

let currentSeed = 1;
let currentNg = 0;
let currentPwIndex = 0; // 0 = Main, negative = West, positive = East
let perkPickups = {}; 
let gameMode = 'normal';
let perkLotteryCount = 0;
let showAllAlwaysCasts = false;

function formatPerkName(id) {
    if (!id) return '';
    if (typeof id === 'object' && id.id) id = id.id; // Extract from spell object
    else if (typeof id !== 'string') id = String(id);
    
    return id.split('_')
             .map(word => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
             .join(' ');
}

function getPerkDisplayName(id) {
    const perkData = PERKS.find(p => p.id === id);
    // Return the official name if found, otherwise fallback to the old formatting
    return (perkData && perkData.name) ? perkData.name : formatPerkName(id);
}

function getTempleCount(ng, pwIndex) {
    if (ng > 0) return 5;
    return pwIndex === 0 ? 7 : 6;
}

/**
 * Recalculates all perks by simulating the path from Main World to the current PW.
 */
export function renderPerkUI() {
    const listElement = document.getElementById('temple-list');
    if (!listElement) return;
    listElement.innerHTML = '';

    // Bind static header controls directly
    const pwLabel = document.getElementById('pw-label');
    const prevBtn = document.getElementById('prev-pw');
    const nextBtn = document.getElementById('next-pw');
    const lotteryInput = document.getElementById('lottery-count');
    const acCheckbox = document.getElementById('show-always-casts');
    const resetBtn = document.getElementById('reset-btn');

    if (pwLabel) {
        if (currentPwIndex === 0) pwLabel.textContent = "Main World";
        else if (currentPwIndex > 0) pwLabel.textContent = "East " + currentPwIndex;
        else pwLabel.textContent = "West " + Math.abs(currentPwIndex);
    }
    
    if (prevBtn) prevBtn.onclick = () => { currentPwIndex--; renderPerkUI(); };
    if (nextBtn) nextBtn.onclick = () => { currentPwIndex++; renderPerkUI(); };
    if (resetBtn) resetBtn.onclick = () => { 
        pwRerolls = {}; 
        uiSelectedPerks = {}; 
        perkLotteryCount = 0;
        if (lotteryInput) lotteryInput.value = 0;
        currentPwIndex = 0;
        renderPerkUI(); 
    };

    if (lotteryInput) {
        lotteryInput.onchange = (e) => {
            perkLotteryCount = Math.min(6, Math.max(0, parseInt(e.target.value) || 0));
            renderPerkUI();
        };
    }

    if (acCheckbox) {
        acCheckbox.checked = showAllAlwaysCasts;
        acCheckbox.onchange = (e) => {
            showAllAlwaysCasts = e.target.checked;
            renderPerkUI();
        };
    }

    let pIdx = 0;
    let rIdx = null;
    let accumulatedPickups = JSON.parse(JSON.stringify(perkPickups));

    // 1. Build the path sequence (e.g. 0, -1, -2 for West 2)
    let path = [0];
    if (currentPwIndex > 0) {
        for (let i = 1; i <= currentPwIndex; i++) path.push(i);
    } else if (currentPwIndex < 0) {
        for (let i = -1; i >= currentPwIndex; i--) path.push(i);
    }

    // 2. The Unified Simulation Loop
    for (let w of path) {
        let tCount = getTempleCount(currentNg, w);
        if (!pwRerolls[w]) pwRerolls[w] = new Array(tCount).fill(0);
        let rerolls = pwRerolls[w];
        
        for (let t = 0; t < tCount; t++) {
            let baseRoll = getTemplePerks(currentSeed, currentNg, w, t, pIdx, accumulatedPickups, gameMode);
            pIdx = baseRoll.perkIndex;
            let finalPerks = baseRoll.perks;

            let rCount = rerolls[t] || 0;
            for (let r = 0; r < rCount; r++) {
                let reroll = rerollTemplePerks(currentSeed, currentNg, w, t, pIdx, rIdx, accumulatedPickups, gameMode);
                rIdx = reroll.rerollIndex;
                finalPerks = reroll.perks;
            }

            // Calculate Gamble AFTER pedestal is drawn
            finalPerks.forEach(p => {
                if (p.perk === 'GAMBLE') {
                    p.hypotheticalGamble = getGamblePerks(currentSeed, currentNg, pIdx, accumulatedPickups, gameMode);
                }
            });

            const selectionKey = `${w}-${t}`;
            let selectedInTemple = uiSelectedPerks[selectionKey] || [];
            selectedInTemple = selectedInTemple.filter(perkId => finalPerks.some(p => p.perk === perkId));
            uiSelectedPerks[selectionKey] = selectedInTemple;

            if (w === currentPwIndex) {
                const row = document.createElement('div');
                row.className = 'temple-row';

                // Reverse the array to display right-to-left as drawn in game
                const displayPerks = finalPerks.slice();

                const cardsHtml = displayPerks.map(p => {
                    // Lucky states now rely purely on the global perkLotteryCount
                    const luckyIndex = Math.min(perkLotteryCount, p.luckyStates.length - 1);
                    const isLucky = p.luckyStates[luckyIndex];
                    const luckyClass = isLucky ? 'lucky-perk' : '';
                    
                    const isSelected = selectedInTemple.includes(p.perk);
                    const selectedClass = isSelected ? 'selected-perk' : '';
                    
                    let titleText = `${getPerkDisplayName(p.perk)}${isLucky ? ' (Lucky)' : ''}`;
                    let altText = `${p.perk}${isLucky ? ' (Lucky)' : ''}`;

                    let subIconsHtml = '';

					// Gamble Preview (includes checking if Gamble gives Always Casts)
                    if (p.perk === 'GAMBLE' && p.hypotheticalGamble) {
                        subIconsHtml += `<div class="gamble-preview">
                            ${p.hypotheticalGamble.perks.map(gp => {
                                let gambleAcHtml = '';
                                if (gp === 'ALWAYS_CAST') {
                                    const gacSpell = getAlwaysCasts(currentSeed, currentNg, p.x, p.y);
                                    gambleAcHtml = `<img class="gamble-icon" title="Always Casts: ${getPerkDisplayName(gacSpell)}" src="data/spell_sprites/${gacSpell.id ? gacSpell.id.toLowerCase() : gacSpell.toLowerCase()}.png" onerror="this.src='data/spell_sprites/unknown.png'">`;
                                }
                                return `<img class="gamble-icon" title="${getPerkDisplayName(gp)}" src="data/perk_sprites/${gp.toLowerCase()}.png" onerror="this.src='data/perk_sprites/unknown.png'">${gambleAcHtml}`;
                            }).join('')}
                        </div>`;
                    }

                    // Main Always Casts
                    let acSpell = p.alwaysCast;
                    if (!acSpell && showAllAlwaysCasts) {
                        acSpell = getAlwaysCasts(currentSeed, currentNg, p.x, p.y);
                    }
                    
                    if (acSpell && (p.perk === 'ALWAYS_CAST' || showAllAlwaysCasts)) {
                        const spellName = getDisplayName(acSpell);
                        titleText += `\nAlways Casts: ${spellName}`;
                        altText += ` (Always Casts: ${spellName})`;
                        
                        // Use a gamble-preview container to slot the spell card underneath
                        subIconsHtml += `
                            <div class="gamble-preview">
                                <img class="gamble-icon" title="Always Casts: ${spellName}" src="data/spell_sprites/${acSpell.id ? acSpell.id.toLowerCase() : acSpell.toLowerCase()}.png" onerror="this.src='data/spell_sprites/unknown.png'">
                            </div>
                        `;
                    }

                    return `
                        <div class="perk-card ${selectedClass}" data-temple="${t}" data-perk="${p.perk}">
                            <img class="perk-icon ${luckyClass}" 
                                 title="${titleText}" 
                                 src="data/perk_sprites/${p.perk.toLowerCase()}.png" 
                                 alt="${altText}" 
                                 onerror="this.src='data/perk_sprites/unknown.png'">
                            ${subIconsHtml}
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

            // Apply selected perks to the accumulated state for NEXT temple
            selectedInTemple.forEach(perkId => {
                if (perkId === 'GAMBLE') {
                    const gambleResult = getGamblePerks(currentSeed, currentNg, pIdx, accumulatedPickups, gameMode);
                    pIdx = gambleResult.perkIndex; 
                    gambleResult.perks.forEach(gp => {
                        accumulatedPickups = pickupPerk(gp, accumulatedPickups);
                    });
                } else {
                    accumulatedPickups = pickupPerk(perkId, accumulatedPickups);
                }
            });
        }
    }

    listElement.onclick = (e) => {
        const card = e.target.closest('.perk-card');
        if (card) {
            const t = card.getAttribute('data-temple');
            const perkId = card.getAttribute('data-perk');
            const key = `${currentPwIndex}-${t}`;
            
            if (!uiSelectedPerks[key]) uiSelectedPerks[key] = [];
            
            const isSelected = uiSelectedPerks[key].includes(perkId);
            
            if (isSelected) {
                uiSelectedPerks[key] = uiSelectedPerks[key].filter(id => id !== perkId); 
                if (perkId === 'PERKS_LOTTERY') {
                    perkLotteryCount = Math.max(0, perkLotteryCount - 1);
                }
            } else {
                uiSelectedPerks[key].push(perkId); 
                if (perkId === 'PERKS_LOTTERY') {
                    perkLotteryCount = Math.min(6, perkLotteryCount + 1);
                }
            }
            
            if (lotteryInput) lotteryInput.value = perkLotteryCount;
            renderPerkUI();
            return;
        }

        const minusBtn = e.target.closest('.minus-btn');
        if (minusBtn) {
            const t = parseInt(minusBtn.getAttribute('data-temple'), 10);
            if (pwRerolls[currentPwIndex][t] > 0) {
                pwRerolls[currentPwIndex][t]--;
                renderPerkUI();
            }
            return;
        }

        const plusBtn = e.target.closest('.plus-btn');
        if (plusBtn) {
            const t = parseInt(plusBtn.getAttribute('data-temple'), 10);
            pwRerolls[currentPwIndex][t]++;
            renderPerkUI();
            return;
        }
    };
}

export function updatePerksState(seed, ng, pwIndex = 0, newPerkPickups = {}, newGameMode = 'normal', lotteryCount = 0) {
    currentSeed = seed;
    currentNg = ng;
    currentPwIndex = pwIndex; 
    perkPickups = newPerkPickups;
    gameMode = newGameMode;
    perkLotteryCount = lotteryCount;
    
    pwRerolls = {};
    uiSelectedPerks = {};
    
    const lotteryInput = document.getElementById('lottery-count');
    if (lotteryInput) lotteryInput.value = perkLotteryCount;
    
    renderPerkUI();
}
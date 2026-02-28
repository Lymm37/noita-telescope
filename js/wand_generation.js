import { NollaPrng } from "./nolla_prng.js";
import { WAND_TYPES, PREMADE_WANDS } from "./wand_config.js";
import { WAND_SPAWN_DATA, ALTAR_SPAWN_DATA } from "./spawn_config.js"
import { generateUtilityBox } from "./utility_box_generation.js";
import { generateGun } from "./gun_generation.js";

export function createWand(ws, ng, x, y, wandType, addOffset, noMoreShuffle = false) {
    let wandX = Math.floor(x);
    let wandY = Math.floor(y);
    if (addOffset) {
        wandX += 510;
        wandY += 683;
    }
    let wand = generateGun(ws, ng, wandType['type'], wandType['cost'], wandType['level'], wandType['force_unshuffle'], wandX, wandY, noMoreShuffle);
    wand['x'] = wandX;
    wand['y'] = wandY;
    wand['type'] = 'wand';
    wand['item'] = 'wand';
    return wand;
}

// This is just an implementation of random from table
function getWandType(ws, ng, x, y, biome) {
    if (!WAND_SPAWN_DATA[biome]) {
        //console.log(`Unknown biome for wand spawn: ${biome} at (${x}, ${y})`);
        return null;
    }
	const prng = new NollaPrng(0);
	let totalProb = 0.0;
	for (let w of WAND_SPAWN_DATA[biome].weights) {
		totalProb += w;
	}
	let r = prng.ProceduralRandom( ws + ng, x - 5, y ) * totalProb;
	for (let i = 0; i < WAND_SPAWN_DATA[biome].weights.length; i++) {
		if (r <= WAND_SPAWN_DATA[biome].weights[i]) {
			return WAND_SPAWN_DATA[biome].types[i];
		}
		r -= WAND_SPAWN_DATA[biome].weights[i];
	}
	console.log("Warning: could not find wand type for ", x, y, ws, biome);
	return null;
}

export function generateWand(ws, ng, x, y, wandTypeName, perks={}) {
    const noMoreShuffle = perks['noMoreShuffle'] || false;
    let wand;// = {};
    const wandType = WAND_TYPES[wandTypeName];
	if (wandTypeName.includes('premade')) {
		wand = generateLevel1Wand(ws, ng, x, y, wandTypeName, noMoreShuffle);
	}
	else {
		wand = generateGun(ws, ng, wandType['type'], wandType['cost'], wandType['level'], wandType['force_unshuffle'], x, y, noMoreShuffle);
	}
	wand['x'] = x;
	wand['y'] = y;
	wand['type'] = 'wand';
	wand['item'] = 'wand';
	return wand;
}

// Just checks whether it should spawn, without spawning the wand on it, to refactor for pixel scenes
// Idk what this should even return, maybe null for no spawn, 'utility_box' for utility box spawn, and true for wand spawn?
export function checkWandAltar(ws, ng, x, y, biome) {
    if (!ALTAR_SPAWN_DATA[biome]) {
        //console.log(`Unknown biome for altar spawn: ${biome} at (${x}, ${y})`);
        return null;
    }
	const prng = new NollaPrng(0);
    // Global offset which will likely be required
    if (ALTAR_SPAWN_DATA[biome].gx !== undefined && ALTAR_SPAWN_DATA[biome].gy !== undefined) {
		x += ALTAR_SPAWN_DATA[biome].gx;
		y += ALTAR_SPAWN_DATA[biome].gy;
	}
	if (ALTAR_SPAWN_DATA[biome].r0 !== undefined) {
		let r0 = prng.ProceduralRandom( ws + ng, x, y );
		if (r0 < ALTAR_SPAWN_DATA[biome].r0) {
			return null;
		}
	}
	let tx = x + ALTAR_SPAWN_DATA[biome].xoff;
	let ty = y + ALTAR_SPAWN_DATA[biome].yoff;
    // Temp offset?
	if (ALTAR_SPAWN_DATA[biome].tx !== undefined && ALTAR_SPAWN_DATA[biome].ty !== undefined) {
		tx = x + ALTAR_SPAWN_DATA[biome].tx;
		ty = y + ALTAR_SPAWN_DATA[biome].ty;
	}
	let r = prng.ProceduralRandom( ws + ng, tx, ty );
	if (ALTAR_SPAWN_DATA[biome].rl !== undefined && r < ALTAR_SPAWN_DATA[biome].rl) {
		return null;
	}
	if (ALTAR_SPAWN_DATA[biome].rg !== undefined && r >= ALTAR_SPAWN_DATA[biome].rg) {
		if (ALTAR_SPAWN_DATA[biome].ru !== undefined && r < ALTAR_SPAWN_DATA[biome].ru) {
			// Utility box (not a pixel scene!)
			return 'utility_box';
		}
		return null;
	}
	return true;
}

export function spawnWandAltar(ws, ng, x, y, biome, perks={}) {
	if (!ALTAR_SPAWN_DATA[biome]) {
		return null;
	}
	if (ALTAR_SPAWN_DATA[biome].gx !== undefined && ALTAR_SPAWN_DATA[biome].gy !== undefined) {
		x += ALTAR_SPAWN_DATA[biome].gx;
		y += ALTAR_SPAWN_DATA[biome].gy;
	}
	const prng = new NollaPrng(0);
	let r0 = 1;
	if (ALTAR_SPAWN_DATA[biome].r0 !== undefined) {
		r0 = prng.ProceduralRandom( ws + ng, x, y );
		if (r0 < ALTAR_SPAWN_DATA[biome].r0) {
			return null;
		}
	}
	let tx = x + ALTAR_SPAWN_DATA[biome].xoff;
	let ty = y + ALTAR_SPAWN_DATA[biome].yoff;
	if (ALTAR_SPAWN_DATA[biome].tx !== undefined && ALTAR_SPAWN_DATA[biome].ty !== undefined) {
		tx = x + ALTAR_SPAWN_DATA[biome].tx;
		ty = y + ALTAR_SPAWN_DATA[biome].ty;
	}
	let r = prng.ProceduralRandom( ws + ng, tx, ty );
	if (ALTAR_SPAWN_DATA[biome].rl !== undefined && r < ALTAR_SPAWN_DATA[biome].rl) {
		return null;
	}
	if (ALTAR_SPAWN_DATA[biome].rg !== undefined && r >= ALTAR_SPAWN_DATA[biome].rg) {
		if (ALTAR_SPAWN_DATA[biome].ru !== undefined && r < ALTAR_SPAWN_DATA[biome].ru) {
			// Utility box
			return generateUtilityBox(ws, ng, x, y);
		}
		return null;
	}
	let wandTypeName = getWandType(ws, ng, Math.floor(x + ALTAR_SPAWN_DATA[biome].x), Math.floor(y + ALTAR_SPAWN_DATA[biome].y), biome);
	if (!wandTypeName) {
		console.log(`Failed to get wand type for spawn at (${x}, ${y}) in biome ${biome}`);
		return null;
	}
	let wandX = Math.floor(x + ALTAR_SPAWN_DATA[biome].x);
	let wandY = Math.floor(y + ALTAR_SPAWN_DATA[biome].y) + 5;
	let wand = generateWand(ws, ng, wandX, wandY, wandTypeName, perks);
    if (document.getElementById('debug-rng-info').checked) {
        wand['r'] = r;
        wand['r0'] = r0;
    }
	return wand;
}

// Finds the wand type and spawns the wand without any extra checks
// Designed to be used for wand spawn pixels 
export function spawnWand(ws, ng, x, y, biome, perks={}) {
    let offsetX = 0;//ALTAR_SPAWN_DATA[biome] ? ALTAR_SPAWN_DATA[biome].x : 0;
    let offsetY = 0;//ALTAR_SPAWN_DATA[biome] ? ALTAR_SPAWN_DATA[biome].y : 0;
    let wandTypeName = getWandType(ws, ng, Math.floor(x + offsetX), Math.floor(y + offsetY), biome);
    if (!wandTypeName) {
        console.log(`Failed to get wand type for spawn at (${x}, ${y}) in biome ${biome}`);
        return null;
    }
	let wandX = Math.floor(x + offsetX);
	let wandY = Math.floor(y + offsetY) + 5;
	let wand = generateWand(ws, ng, wandX, wandY, wandTypeName, perks);
    return wand;
}

// Debug
// -1465, 522
const WAND_DEBUG = false;
if (WAND_DEBUG) {
    console.log('--- Initial Test ---');
    let temp_seed = 8;
    let base_x = -1465;
    let base_y = 509;
    let max_search = 10;
    for (let i = -max_search; i < max_search; i++) {
        for (let j = -max_search; j < max_search; j++) {
            let x = base_x + i;
            let y = base_y + j;
            let wand = spawnWandAltar(temp_seed, 0, x, y, 'coalmine_alt');
            let wandText = JSON.stringify(wand);
            if (wandText.includes('["AIR_BULLET"]')) {
                console.log(i, j, x, y, JSON.stringify(wand));
            }
        }
    }
}


// Type is premade_1, premade_2, etc.
function generateLevel1Wand(ws, ng, x, y, type) {
    const prng = new NollaPrng(0);
    prng.SetRandomSeed(ws + ng, x, y);
    // Gets reload_time, fire_rate_wait, spread_degress, deck_capacity, mana_max from somewhere???
    // premade_x
    let index = parseInt(type.split('_')[1]) - 1;
    let gun_reference = PREMADE_WANDS[index % PREMADE_WANDS.length];
    let gun = JSON.parse(JSON.stringify(gun_reference)); // This is so stupid
    gun['cards'] = [];
    // Don't care
    gun['grip'] = {x: 0, y: 0};
    gun['tip'] = {x: 0, y: 0};
    gun['is_rare'] = 0;
    gun['wand_type'] = type;
    gun['force_unshuffle'] = 0;
    let reload_time = gun['reload_time'];
    let fire_rate_wait = gun['fire_rate_wait'];
    let spread_degrees = gun['spread_degrees'];
    let deck_capacity = gun['deck_capacity'];
    let total = reload_time + fire_rate_wait + spread_degrees;
    total += prng.Random(-10, 20);
    
    let level_1_cards = [
        'LIGHT_BULLET',
        'RUBBER_BALL',
        'ARROW',
        'DISC_BULLET',
        'BOUNCY_ORB',
        'BULLET',
        'AIR_BULLET',
        'SLIMEBALL'
    ]

    let card_count = prng.Random(1, 5);

    if (prng.Random(1, 100) <= 85) {
        level_1_cards.push('BUBBLESHOT');
        if (prng.Random(1, 100) <= 70) {
            level_1_cards.push('SPITTER');
            if (prng.Random(1, 100) <= 40) {
                level_1_cards.push('LIGHT_BULLET_TRIGGER');
                card_count = 1;
                if (prng.Random(1, 100) <= 20) {
                    level_1_cards.push('DISC_BULLET_BIG');
                    if (prng.Random(1, 100) <= 10) {
                        level_1_cards.push('TENTACLE_PORTAL');
                        if (prng.Random(1, 100) <= 10) {
                            level_1_cards.push('BLACK_HOLE_BIG');
                            if (gun['mana_max'] < 240) gun['mana_max'] = 240;
                        }
                    }
                }
            }
        }
    }

    if (total > 50) {
        level_1_cards = ['GRENADE', 'BOMB', 'ROCKET'];

        if (prng.Random(1, 100) <= 75) {
            level_1_cards.push('DYNAMITE');
            if (prng.Random(1, 100) <= 50) {
                level_1_cards.push('FIREBALL');
                if (prng.Random(1, 100) <= 40) {
                    level_1_cards.push('ACIDSHOT');
                    if (prng.Random(1, 100) <= 30) {
                        level_1_cards.push('GLITTER_BOMB');
                        if (prng.Random(1, 100) <= 30) {
                            level_1_cards.push('MINE');
                        }
                    }
                }
            }
        }
        card_count = 1;
    }

    let do_util = prng.Random(0, 100);
    if (do_util < 30) {
        level_1_cards = [
            'CLOUD_WATER',
            'X_RAY',
            'FREEZE_FIELD',
            'BLACK_HOLE',
            'TORCH',
            'SHIELD_FIELD'
        ];

        if (prng.Random(1, 100) <= 75) {
            level_1_cards.push('ELECTROCUTION_FIELD');
            if (prng.Random(1, 100) <= 50) {
                level_1_cards.push('DIGGER');
                if (prng.Random(1, 100) <= 50) {
                    level_1_cards.push('TORCH_ELECTRIC');
                    if (prng.Random(1, 100) <= 50) {
                        level_1_cards.push('POWERDIGGER');
                        if (prng.Random(1, 100) <= 50) {
                            level_1_cards.push('SOILBALL');
                            if (prng.Random(1, 100) <= 50) {
                                level_1_cards.push('LUMINOUS_DRILL');
                                if (prng.Random(1, 100) <= 50) {
                                    level_1_cards.push('CHAINSAW');
                                }
                            }
                        }
                    }
                }
            }
        }
        card_count = 1;
    }

    if (card_count > deck_capacity) card_count = deck_capacity;

    let cardIndex = prng.Random(0, level_1_cards.length - 1);
    let card = level_1_cards[cardIndex];

    if (card === 'BLACK_HOLE' && gun['mana_max'] < 180) gun['mana_max'] = 180;

    for (let i = 0; i < card_count; i++) {
        gun['cards'].push(card);
    }

    //console.log(`Generated level 1 wand at (${x}, ${y}) with card ${card} x${card_count}, total = ${total.toFixed(2)}, mana_max = ${mana_max}`);

    return gun;
}

// TODO: Technically wand lengths are incorrect here, but this is very minor, I doubt most people care about wand length at all unless they are named Nutty Mitchell
export function spawnSpecialWand(ws, ng, x, y, type) {
    let wandX = Math.floor(x);
    let wandY = Math.floor(y);
    // Types:
    // ruusu, kiekurakeppi, valtikka, vasta, vihta, arpaluu, varpuluuta
    let wandType = 'wand_level_01';
    if (type === 'ruusu') {
        wandType = 'wand_level_02';
    }
    if (type === 'kiekurakeppi') {
        wandType = 'wand_unshuffle_02';
    }
    if (type === 'valtikka') {
        wandType = 'wand_level_03';
    }
    if (type === 'vasta') {
        wandType = 'wand_level_03_better';
    }
    if (type === 'vihta') {
        wandType = 'wand_level_03_better';
    }
    if (type === 'arpaluu') {
        wandType = 'wand_unshuffle_05';
    }
    if (type === 'varpuluuta') {
        wandType = 'wand_level_05_better';
    }
    let wand = generateWand(ws, ng, wandX, wandY, wandType);
    if (type === 'ruusu') {
        wand['name'] = 'Ruusu';
        wand['sprite'] = 'custom/plant_01';
    }
    // Note that these wands can end up with 2 always casts.
    if (type === 'kiekurakeppi') {
        wand['name'] = 'Kiekurakeppi';
        wand['sprite'] = 'custom/wood_01';
        wand['always_casts'].push('KNOCKBACK');
    }
    if (type === 'valtikka') {
        wand['name'] = 'Valtikka';
        wand['sprite'] = 'custom/scepter_01';
        wand['always_casts'].push('PIERCING_SHOT');
    }
    if (type === 'vasta') {
        wand['name'] = wand['name'] + ' Vasta';
        wand['sprite'] = 'custom/vasta';
        wand['always_casts'].push('HITFX_CRITICAL_WATER');
    }
    if (type === 'vihta') {
        wand['name'] = wand['name'] + ' Vihta';
        wand['sprite'] = 'custom/vihta';
        wand['always_casts'].push('HITFX_EXPLOSION_ALCOHOL');
    }
    if (type === 'arpaluu') {
        wand['name'] = 'Arpaluu';
        wand['sprite'] = 'custom/skull_01';
        wand['always_casts'].push('EXPLOSION_REMOVE');
    }
    if (type === 'varpuluuta') {
        wand['name'] = wand['name'] + ' Varpuluuta';
        wand['sprite'] = 'custom/plant_02';
    }
    wand['x'] = wandX;
    wand['y'] = wandY;
    wand['r'] = 0;
    wand['type'] = 'wand';
    wand['item'] = 'wand';
    //console.log(`Spawned special wand ${wand['name']} at (${wandX}, ${wandY}): `, wand);
    return wand;
}
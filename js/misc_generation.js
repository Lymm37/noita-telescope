import { NollaPrng } from "./nolla_prng.js";
import { spawnWithRandomOffset } from "./spawn_functions.js";
import { MakeRandomSpell, GetRandomAction } from "./spell_generator.js";
import { getWorldCenter, getWorldSize } from "./utils.js";
import { generateWand, getWandType, spawnWandAltar } from "./wand_generation.js";
import { roundHalfOfEven } from "./utils.js";

// Eye Room

const eyeRoomPos = {x: -3850, y: 5400}; // -8 * 512, 10 * 512
const eyeRoomSpellPositions = [
    {x: -3992, y: 5380},
    {x: -3971, y: 5397}, 
    {x: -3949, y: 5414}, 
    {x: -3926, y: 5428}, 
    {x: -3758, y: 5424}, 
    {x: -3735, y: 5410},
	{x: -3713, y: 5393}, 
    {x: -3692, y: 5376}
];

export function generateEyeRoom(ws, ng, pwIndex) {
    let prng = new NollaPrng(0);
    let spells = [];
    const worldSize = ng > 0 ? 64 : 70;
    for (let i = 0; i < eyeRoomSpellPositions.length; i++) {
        let pos = eyeRoomSpellPositions[i];
        let x = pos.x + pwIndex * 512 * worldSize;
        let y = pos.y;
        //console.log(`Generating spell for Eye Room at (${x}, ${y})`);
        prng.SetRandomSeed(ws + ng, x, y);
        spells.push({type: 'item', item: 'spell', spell: MakeRandomSpell(prng), x: x, y: y});
    }
    let roomX = eyeRoomPos.x + pwIndex * 512 * worldSize;
    let roomY = eyeRoomPos.y;
    //console.log(eyeRoomPos, roomX, roomY, pwIndex);
    return {type: 'eye_room', items: spells, x: roomX, y: roomY, biome: 'snowcastle_hourglass_chamber'};
}

// Hourglass Shop

const hourglassBasePosition = {
    'left': {x: -5*512 + 50, y: 10*512},
    'right': {x: 3*512 - 50, y: 10*512}
};
const hourglassSpellPositions = {
    'left': [
        {x: 134, y: 361},
        {x: 158, y: 361},
        {x: 182, y: 361},
        {x: 206, y: 361}
    ],
    'right': [
        {x: 305, y: 361},
        {x: 329, y: 361},
        {x: 353, y: 361},
        {x: 377, y: 361}
    ]
}

// Only in NG0
export function generateHourglassShop(ws) {
    const prng = new NollaPrng(0);
    const is_right = prng.ProceduralRandom(ws, 0, 0) > 0.5;

    const baseX = is_right ? hourglassBasePosition.right.x : hourglassBasePosition.left.x;
    const baseY = is_right ? hourglassBasePosition.right.y : hourglassBasePosition.left.y;
    const spellPositions = is_right ? hourglassSpellPositions.right : hourglassSpellPositions.left;
    let spells = [];
    for (let i = 0; i < spellPositions.length; i++) {
        let pos = spellPositions[i];
        let x = baseX + pos.x;
        let y = baseY + pos.y;
        prng.SetRandomSeed(ws, x, y);
        spells.push({type: 'item', item: 'spell', spell: GetRandomAction(ws, 0, x, y, 2, 0), x: x, y: y});
    }
    // side might be redundant 
    return {type: 'shop', items: spells, x: baseX+256, y: baseY+256, side: is_right ? 'right' : 'left', biome: 'snowcastle_cavern'};
}

// Meditation Cube

const meditationCubePosition = {x: -9 * 512 + 350, y: 4 * 512 + 303};

export function generateMeditationCube(ws, ng, pwIndex, perks={}) {
    const worldSize = ng > 0 ? 64 : 70;
    const x = meditationCubePosition.x + pwIndex * 512 * worldSize;
    const y = meditationCubePosition.y;
    const wand = spawnWandAltar(ws, ng, x, y, 'excavationsite_cube_chamber', perks);
    wand['biome'] = 'excavationsite_cube_chamber';
    return wand;
}

// Snowy room

const snowyRoomPositions = [
    {x: 7 * 512 + 333, y: 8 * 512 + 297},
    {x: 7 * 512 + 439, y: 8 * 512 + 324}
];

// Only in NG0
export function generateSnowyRoom(ws, pwIndex, perks={}) {
    let wands = [];
    for (let i = 0; i < snowyRoomPositions.length; i++) {
        const pos = snowyRoomPositions[i];
        const x = pos.x + pwIndex * 512 * 70;
        const y = pos.y;
        const wand = spawnWandAltar(ws, 0, x, y, 'snowcave_secret_chamber', perks);
        wand['biome'] = 'snowcave_secret_chamber';
        wands.push(wand);
    }
    return wands;
}

const robotEggPosition = {x: -10 * 512 + 390, y: 29 * 512 + 313};

export function generateRobotEgg(ws, ng, pwIndex, perks={}) {
    const worldSize = ng > 0 ? 64 : 70;
    const x = robotEggPosition.x + pwIndex * 512 * worldSize;
    const y = robotEggPosition.y;
    // Oh this actually uses a different spawn function, weird.
    const wandType = getWandType(ws, ng, x + 5, y, 'robot_egg');
    // Get adjusted position (same logic as taikasauvas)
    const position = spawnWithRandomOffset(ws, ng, x, y)[0];
    const wand = generateWand(ws, ng, roundHalfOfEven(position.x), roundHalfOfEven(position.y), wandType, perks);
    wand['biome'] = 'robot_egg';
    return wand;
}

// Jungle Portal

// Only in NG0 main
export function generatePortal(ws) {
    const biomeXMin = -2450;
    const biomeXMax = 1900;
    const biomeYMin = 6700;
    const biomeYMax = 8000;
    //const rim = 200;
    const prng = new NollaPrng(0);
    const px = biomeXMin + prng.ProceduralRandom(ws, 209, 13) * (biomeXMax - biomeXMin);
    const py = biomeYMin + prng.ProceduralRandom(ws, 211, 1.9) * (biomeYMax - biomeYMin);
    // TODO: Biome might not be rainforest, could also be rainforest_open or fungicave, but I don't care too much
    return {type: 'item', item: 'portal', x: px, y: py, biome: 'rainforest'};
}

// Triangle boss
// Only in NG0
const triangleBossBasePosition = {x: 5*512 + 271, y: 22*512 + 242 + 55};
const triangleBossOffsets = [
    {x: 0, y: 0},
    {x: -52, y: -8},
    {x: 52, y: -8},
    {x: -8, y: -60}
];

export function generateTriangleBossDrops(ws, pwIndex) {
    const prng = new NollaPrng(0);
    //const worldSize = isNGP ? 64 : 70;
    let spells = [];
    for (let i = 0; i < triangleBossOffsets.length; i++) {
        //const offset = triangleBossOffsets[i];
        //const x = triangleBossBasePosition.x + offset.x + pwIndex * 512 * 70;
        //const y = triangleBossBasePosition.y + offset.y;
        prng.SetRandomSeed(ws, i, 10+pwIndex);
        const spell = MakeRandomSpell(prng);
        spells.push({type: 'item', item: 'spell', spell: spell, x: triangleBossBasePosition.x + pwIndex * 512 * 70, y: triangleBossBasePosition.y});
    }
    return {type: 'triangle_boss', items: spells, x: triangleBossBasePosition.x + pwIndex * 512 * 70, y: triangleBossBasePosition.y, biome: 'wizardcave_entrance'};
}

const alchemistBossPosition = {x: -10*512 + 256, y: 1*512 + 256};

// Only in NG0
export function generateAlchemistBossDrops(ws, pwIndex) {
    let opts = ["ALPHA", "OMEGA", "GAMMA", "MU", "ZETA", "PHI", "TAU", "SIGMA"];
    const prng = new NollaPrng(0);
    prng.SetRandomSeed(ws, pwIndex, 60);
    let spells = [];
    prng.Next(); //let rnd = prng.Random(1, opts.length);
    for (let i = 1; i <= 4; i++) {
        let rnd = prng.Random(1, opts.length);
        let opt = opts[rnd-1];
        opts.splice(rnd-1, 1);
        spells.push({type: 'item', item: 'spell', spell: opt, x: alchemistBossPosition.x + pwIndex * 512 * 70, y: alchemistBossPosition.y});
    }
    return {type: 'alchemist_boss', items: spells, x: alchemistBossPosition.x + pwIndex * 512 * 70, y: alchemistBossPosition.y, biome: 'secret_lab'};
}

const pyramidBossPosition = {x: 19*512 + 256, y: -2*512 + 256};

// Only in NG0
export function generatePyramidBossDrops(ws, pwIndex) {
    let opts = ["NOLLA", "DAMAGE_RANDOM", "RANDOM_SPELL", "RANDOM_PROJECTILE", "RANDOM_MODIFIER", "RANDOM_STATIC_PROJECTILE", "DRAW_RANDOM", "DRAW_RANDOM_X3", "DRAW_3_RANDOM"];
    const prng = new NollaPrng(0);
    prng.SetRandomSeed(ws, pwIndex, 44);
    let spells = [];
    prng.Next(); //let rnd = prng.Random(1, opts.length);
    for (let i = 1; i <= 4; i++) {
        let rnd = prng.Random(1, opts.length);
        let opt = opts[rnd-1];
        opts.splice(rnd-1, 1);
        spells.push({type: 'item', item: 'spell', spell: opt, x: pyramidBossPosition.x + pwIndex * 512 * 70, y: pyramidBossPosition.y});
    }
    return {type: 'pyramid_boss', items: spells, x: pyramidBossPosition.x + pwIndex * 512 * 70, y: pyramidBossPosition.y, biome: 'pyramid_top'};
}

const dragonBossPosition = {x: 4*512 + 296, y: 14*512 + 305};
// Only in NG0 (though extra dragons can spawn in different positions in NG+)
export function generateDragonBossDrops(ws, pwIndex) {
    const x = dragonBossPosition.x + pwIndex * 512 * 70;
    return getDragonDrops(ws, 0, 'dragoncave', x, dragonBossPosition.y);
}

export function getDragonDrops(worldSeed, ngPlusCount, biomeName, x, y, perks={}) {
    let drops = [];

    drops.push({type: 'item', item: 'heart', x: x-16, y: y});
    // Wand (wand_unshuffle_06)
    let wand = generateWand(worldSeed, ngPlusCount, x+16, y, 'wand_unshuffle_06', perks);
    drops.push(wand);
    // I misread this, it actually sets the flag and THEN checks it, so this branch triggers every time!
    /*
    let opts = ["ORBIT_DISCS", "ORBIT_FIREBALLS", "ORBIT_NUKES", "ORBIT_LASERS", "ORBIT_LARPA"];
    let count = 3;
    if (unlockedSpells[331]) { // Nuke orbit index
        // If not first time kill, remove ORBIT_NUKES and only drop 1 card
        opts.splice(2, 1);
        count = 1;
    }
    */
    let opts = ["ORBIT_DISCS", "ORBIT_FIREBALLS", "ORBIT_LASERS", "ORBIT_LARPA"];
    const count = 1;
    const prng = new NollaPrng(0);
    const pwIndex = Math.floor((x + getWorldCenter(ngPlusCount > 0) * 512) / (getWorldSize(ngPlusCount > 0) * 512));
    prng.SetRandomSeed( worldSeed + ngPlusCount, pwIndex, 540 )
    for (let i = 0; i < count; i++) {
        let rnd = prng.Random(1, opts.length);
        let opt = opts[rnd-1];
        drops.push({type: 'item', item: 'spell', spell: opt, x: x - 8*count + (i-0.5)*16, y: y});
        opts.splice(rnd-1, 1);
    }
    return {type: 'dragon', items: drops, x: x, y: y, biome: biomeName};
}


const baseEndShopPositionHeaven = {x: 0, y: -13954};
const baseEndShopPositionHell = {x: 0, y: 24576};
const endShopSpellPositions = [
    {x: 41, y: 148},
    {x: 78, y: 148},
    {x: 114, y: 148},
    {x: 149, y: 148},
    {x: 184, y: 148},
    {x: 215, y: 148},
];

// Static heaven/hell shops
export function generateEndShop(ws, ng, direction) {
    // Note direction should be +/- 1
    if (direction != 1 && direction != -1) return null;
    const basePosition = direction == 1 ? baseEndShopPositionHell : baseEndShopPositionHeaven;
    const prng = new NollaPrng(0);
    let spells = [];
    for (let i = 0; i < endShopSpellPositions.length; i++) {
        let pos = endShopSpellPositions[i];
        let x = basePosition.x + pos.x;
        let y = basePosition.y + pos.y;
        prng.SetRandomSeed(ws, ng, x, y);
        // Note: NG is unused in the spell generation here, but it's not a bug
        spells.push({type: 'item', item: 'spell', spell: GetRandomAction(ws, ng, x, y, 10, 0), x: x, y: y});
    }
    
    console.log(`Generated ${direction == 1 ? 'Hell' : 'Heaven'} Shop at (${basePosition.x}, ${basePosition.y}) with spells:`, spells);
    return {type: 'shop', items: spells, x: basePosition.x + 128, y: basePosition.y + 128, biome: direction == 1 ? 'the_end' : 'the_sky'};
}

// I was going to implement the coral chest but turns out it's not deterministic, seeded by frame count. Same for the dark chest. Oh well.

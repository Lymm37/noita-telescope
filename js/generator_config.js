export const GENERATOR_CONFIG = {
    'coalmine': { color: 0xffd57917, wangFile: './data/wang_tiles/coalmine.png', name: "Mines" },
    'coalmine_alt': { color: 0xffD56517, wangFile: './data/wang_tiles/coalmine_alt.png', name: "Collapsed Mines" },
    'excavationsite': { color: 0xff124445, wangFile: './data/wang_tiles/excavationsite.png', name: "Coal Mines" },
    'snowcave': { color: 0xff1775d5, wangFile: './data/wang_tiles/snowcave.png', name: "Snowy Depths" },
    'snowcastle': { color: 0xff0046FF, wangFile: './data/wang_tiles/snowcastle.png', name: "Hiisi Base" },
    'rainforest': { color: 0xff808000, wangFile: './data/wang_tiles/rainforest.png', name: "Underground Jungle" },
    'rainforest_open': { color: 0xffA08400, wangFile: './data/wang_tiles/rainforest_open.png', name: "Underground Jungle (Open)" },
    'vault': { color: 0xff008000, wangFile: './data/wang_tiles/vault.png', name: "The Vault" },
    'crypt': { color: 0xff786C42, wangFile: './data/wang_tiles/crypt.png', name: "Temple of the Art" },
    'fungicave': { color: 0xffe861f0, wangFile: './data/wang_tiles/fungicave.png', name: "Fungal Caverns" },
    'fungiforest': { color: 0xffa861ff, wangFile: './data/wang_tiles/fungiforest.png', name: "Overgrown Cavern" },
    'rainforest_dark': { color: 0xff375c00, wangFile: './data/wang_tiles/rainforest_dark.png', name: "Lukki Lair" },
    'wizardcave': { color: 0xff726186, wangFile: './data/wang_tiles/wizardcave.png', name: "Wizard's Den" },
    'liquidcave': { color: 0xff89a04b, wangFile: './data/wang_tiles/liquidcave.png', name: "Ancient Laboratory", randomColors: {0x01CFEE: [0xF86868,0x7FCEEA,0xA3569F,0xC23055,0x0BFFE5]} }, /* 0x12BBEE: [0x000000,0xFFFFFF]} */
    'robobase': { color: 0xff4e5267, wangFile: './data/wang_tiles/robobase.png', name: "Power Plant" },
    'vault_frozen': { color: 0xff0080a8, wangFile: './data/wang_tiles/vault_frozen.png', name: "Frozen Vault" },
    'meat': { color: 0xff572828, wangFile: './data/wang_tiles/meat.png', name: "Meat Realm" },
    'wandcave': { color: 0xff006C42, hasStuff: false, wangFile: './data/wang_tiles/wand.png', name: "Magical Temple" },
    'pyramid': { color: 0xff967f11, hasStuff: false, wangFile: './data/wang_tiles/pyramid.png', optional: true, name: "Pyramid" },
    'sandcave': { color: 0xffE1CD32, hasStuff: false, wangFile: './data/wang_tiles/sandcave.png', optional: true, name: "Sandcave" },
    'clouds': { color: 0xff36d5c9, hasStuff: false, wangFile: './data/wang_tiles/clouds.png', optional: true, name: "Cloudscape" },
    'the_sky': { color: 0xffD3E6F0, hasStuff: false, wangFile: './data/wang_tiles/the_sky.png', optional: true, name: "The Work (Sky)" },
    'the_end': { color: 0xff3C0F0A, hasStuff: false, wangFile: './data/wang_tiles/the_end.png', name: "The Work (Hell)" },
    'snowchasm': { color: 0xff77A5BD, hasStuff: false, wangFile: './data/wang_tiles/snowchasm.png', optional: true, name: "Snowy Chasm" },
    'tower_coalmine': { color: 0xff3d3e37, wangFile: './data/wang_tiles/coalmine.png', name: "Tower (Mines)" },
    'tower_excavationsite': { color: 0xff3d3e38, wangFile: './data/wang_tiles/excavationsite.png', name: "Tower (Coal Mines)" },
    'tower_snowcave': { color: 0xff3d3e39, wangFile: './data/wang_tiles/snowcave.png', name: "Tower (Snowy Depths)" },
    'tower_snowcastle': { color: 0xff3d3e3a, wangFile: './data/wang_tiles/snowcastle.png', name: "Tower (Hiisi Base)" },
    'tower_fungicave': { color: 0xff3d3e3b, wangFile: './data/wang_tiles/fungicave.png', name: "Tower (Fungal Caverns)" },
    'tower_rainforest': { color: 0xff3d3e3c, wangFile: './data/wang_tiles/rainforest.png', name: "Tower (Underground Jungle)" },
    'tower_vault': { color: 0xff3d3e3d, wangFile: './data/wang_tiles/vault.png', name: "Tower (The Vault)" },
    'tower_crypt': { color: 0xff3d3e3e, wangFile: './data/wang_tiles/crypt.png', name: "Tower (Temple of the Art)" },
    'tower_end': { color: 0xff3d3e3f, wangFile: './data/wang_tiles/the_end.png', name: "Tower (Hell)" },
    'lake_deep': { color: 0xff1158f1, wangFile: './data/wang_tiles/water.png', optional: true, name: "Lake" }, // This is just silly
    // Extra generation biomes
    'excavationsite_cube_chamber': { color: 0xff24888a, name: "Meditation Cube" },
    'snowcave_secret_chamber': { color: 0xff18a0d6, name: "Snowcave Secret Chamber" },
    'snowcastle_cavern': { color: 0xff775ddb, name: "Hiisi Hourglass Shop" },
    'snowcastle_hourglass_chamber': { color: 0xff18d6d6, name: "Eye Room" },
    'pyramid_top': { color: 0xffc88f5f, name: "Pyramid Boss"},
    'secret_lab': { color: 0xffbaa345, name: "Alchemist Boss" },
    'wizardcave_entrance': { color: 0xff804169, name: "Triangle Boss"},
    'temple_altar': { color: 0xff93cb4c, name: "Holy Mountain" },
    'boss_arena': { color: 0xff14EED7, name: "Boss Arena" },
};

Object.values(GENERATOR_CONFIG).forEach(conf => {
    if (!conf.optional) {
        conf.enabled = true; // Default to all enabled, we can disable later if needed
    }
    conf.pois = conf.pois || [];
});

export const BIOME_COLOR_TO_NAME = {};
Object.entries(GENERATOR_CONFIG).forEach(([biomeName, conf]) => {
    BIOME_COLOR_TO_NAME[conf.color & 0xffffff] = biomeName;
});

// Only the ones with wang tiles
export const BIOME_COLORS_WITH_TILES = new Set(Object.values(GENERATOR_CONFIG).filter(conf => conf.wangFile != null).map(conf => conf.color & 0xffffff));

// Other random holy mountain colors (there are too many)
export const BIOMES_WITHOUT_WAVY_EDGE = new Set([
    0x93cb4c, // temple_altar
    0x14EED7, // boss_arena
    0xB8A928, // solid_wall_temple?
    0x6dcb28, // temple_wall
    0x93cb4d, // temple_altar_left
    0x93cb4e, // temple_altar_right
    0x93cb4f, // temple_altar_right_snowcave
    0x93cb5a, // temple_altar_right_snowcastle
    0x5a9628, // temple_wall_ending
]);

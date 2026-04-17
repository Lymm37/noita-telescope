export const GENERATOR_CONFIG = {
    'coalmine': { color: 0xffd57917, wangFile: '../data/wang_tiles/coalmine.png', name: "Mines" },
    'coalmine_alt': { color: 0xffD56517, wangFile: '../data/wang_tiles/coalmine_alt.png', name: "Collapsed Mines" },
    'excavationsite': { color: 0xff124445, wangFile: '../data/wang_tiles/excavationsite.png', name: "Coal Mines" },
    'snowcave': { color: 0xff1775d5, wangFile: '../data/wang_tiles/snowcave.png', name: "Snowy Depths" },
    'snowcastle': { color: 0xff0046FF, wangFile: '../data/wang_tiles/snowcastle.png', name: "Hiisi Base" },
    'rainforest': { color: 0xff808000, wangFile: '../data/wang_tiles/rainforest.png', name: "Underground Jungle" },
    'rainforest_open': { color: 0xffA08400, wangFile: '../data/wang_tiles/rainforest_open.png', name: "Underground Jungle (Open)" },
    'vault': { color: 0xff008000, wangFile: '../data/wang_tiles/vault.png', name: "The Vault" },
    'crypt': { color: 0xff786C42, wangFile: '../data/wang_tiles/crypt.png', name: "Temple of the Art" },
    'fungicave': { color: 0xffe861f0, wangFile: '../data/wang_tiles/fungicave.png', name: "Fungal Caverns" },
    'fungiforest': { color: 0xffa861ff, wangFile: '../data/wang_tiles/fungiforest.png', name: "Overgrown Cavern" },
    'rainforest_dark': { color: 0xff375c00, wangFile: '../data/wang_tiles/rainforest_dark.png', name: "Lukki Lair" },
    'wizardcave': { color: 0xff726186, wangFile: '../data/wang_tiles/wizardcave.png', name: "Wizard's Den" },
    'liquidcave': { color: 0xff89a04b, wangFile: '../data/wang_tiles/liquidcave.png', name: "Ancient Laboratory", randomColors: {0x01CFEE: [0xF86868,0x7FCEEA,0xA3569F,0xC23055,0x0BFFE5]} }, /* 0x12BBEE: [0x000000,0xFFFFFF]} */
    'robobase': { color: 0xff4e5267, wangFile: '../data/wang_tiles/robobase.png', name: "Power Plant",
        colorAliases: [0xff9D893D] },
    'vault_frozen': { color: 0xff0080a8, wangFile: '../data/wang_tiles/vault_frozen.png', name: "Frozen Vault" },
    'meat': { color: 0xff572828, wangFile: '../data/wang_tiles/meat.png', name: "Meat Realm",
        colorAliases: [0xff796620] },
    'wandcave': { color: 0xff006C42, hasStuff: false, wangFile: '../data/wang_tiles/wand.png', name: "Magical Temple" },
    'pyramid': { color: 0xff967f11, hasStuff: false, wangFile: '../data/wang_tiles/pyramid.png', optional: true, name: "Pyramid",
        colorAliases: [0xff968F96, 0xff167F5F, 0xff967F5F, 0xff968F5F] },
    'sandcave': { color: 0xffE1CD32, hasStuff: false, wangFile: '../data/wang_tiles/sandcave.png', optional: true, name: "Sandcave" },
    // Surface biomes (cy < 14). No spawns; declared so biome-map lookups
    // return a name instead of null.
    'desert': { color: 0xffCC9944, hasStuff: false, optional: true, name: "Desert",
        colorAliases: [0xffEBA500] },
    'winter': { color: 0xffD6D8E3, hasStuff: false, optional: true, name: "Winter Surface" },
    'lake':   { color: 0xff1133F1, hasStuff: false, optional: true, name: "Lake (Surface)",
        colorAliases: [0xff11A3FC] },
    'lava':   { color: 0xffFF6A02, hasStuff: false, optional: true, name: "Lava",
        colorAliases: [0xffFFA717] },
    'clouds': { color: 0xff36d5c9, hasStuff: false, wangFile: '../data/wang_tiles/clouds.png', optional: true, name: "Cloudscape" },
    'the_sky': { color: 0xffD3E6F0, hasStuff: false, wangFile: '../data/wang_tiles/the_sky.png', optional: true, name: "The Work (Sky)" },
    'the_end': { color: 0xff3C0F0A, hasStuff: false, wangFile: '../data/wang_tiles/the_end.png', name: "The Work (Hell)",
        // 0x50EED7 is a boss-victoryroom variant in The Work (Hell).
        colorAliases: [0xff50EED7] },
    'snowchasm': { color: 0xff77A5BD, hasStuff: false, wangFile: '../data/wang_tiles/snowchasm.png', optional: true, name: "Snowy Chasm" },
    'tower_coalmine': { color: 0xff3d3e37, wangFile: '../data/wang_tiles/coalmine.png', name: "Tower (Mines)" },
    'tower_excavationsite': { color: 0xff3d3e38, wangFile: '../data/wang_tiles/excavationsite.png', name: "Tower (Coal Mines)" },
    'tower_snowcave': { color: 0xff3d3e39, wangFile: '../data/wang_tiles/snowcave.png', name: "Tower (Snowy Depths)" },
    'tower_snowcastle': { color: 0xff3d3e3a, wangFile: '../data/wang_tiles/snowcastle.png', name: "Tower (Hiisi Base)" },
    'tower_fungicave': { color: 0xff3d3e3b, wangFile: '../data/wang_tiles/fungicave.png', name: "Tower (Fungal Caverns)" },
    'tower_rainforest': { color: 0xff3d3e3c, wangFile: '../data/wang_tiles/rainforest.png', name: "Tower (Underground Jungle)" },
    'tower_vault': { color: 0xff3d3e3d, wangFile: '../data/wang_tiles/vault.png', name: "Tower (The Vault)" },
    'tower_crypt': { color: 0xff3d3e3e, wangFile: '../data/wang_tiles/crypt.png', name: "Tower (Temple of the Art)" },
    'tower_end': { color: 0xff3d3e3f, wangFile: '../data/wang_tiles/the_end.png', name: "Tower (Hell)" },
    'lake_deep': { color: 0xff1158f1, wangFile: '../data/wang_tiles/water.png', optional: true, name: "Lake" }, // This is just silly
    // Extra generation biomes
    'excavationsite_cube_chamber': { color: 0xff24888a, name: "Meditation Cube" },
    'snowcave_secret_chamber': { color: 0xff18a0d6, name: "Snowcave Secret Chamber" },
    'snowcastle_cavern': { color: 0xff775ddb, name: "Hiisi Hourglass Shop" },
    'snowcastle_hourglass_chamber': { color: 0xff18d6d6, name: "Eye Room" },
    'robot_egg': { color: 0xff9e4302, name: "Robot Egg" },
    'pyramid_top': { color: 0xffc88f5f, name: "Pyramid Boss"},
    'secret_lab': { color: 0xffbaa345, name: "Alchemist Boss" },
    'wizardcave_entrance': { color: 0xff804169, name: "Triangle Boss"},
    'dragoncave': { color: 0xff364d24, name: "Dragoncave" },
    // All variant shades resolve to "$biome_holymountain". 0x93cb4c is the
    // entrance and is wobble-eligible; the others are filler/sides and are
    // not (per each variant's biome XML — see data/biome_flags.json).
    'temple_altar': { color: 0xff93cb4c, name: "Holy Mountain",
        colorAliases: [0xff93cb4d, 0xff93cb4e, 0xff93cb4f, 0xff93cb5a, 0xff6dcb28, 0xff5a9628, 0xffb8a928] },
    'boss_arena': { color: 0xff14EED7, name: "Boss Arena",
        colorAliases: [0xff0DA899, 0xff57DACE] },
    // Pure markers: no wang tiles or content, just biome-map paint.
    'gold': { color: 0xffFFFF00, hasStuff: false, optional: true, name: "Gold Vein" },
    'water': { color: 0xff0000FF, hasStuff: false, optional: true, name: "Water Pocket" },
    'ghost_secret': { color: 0xff1F3B64, hasStuff: false, optional: true, name: "Ghost Secret" },
    'mestari_secret': { color: 0xff1F3B62, hasStuff: false, optional: true, name: "Mestari Secret" },
    // 0xFFD100 with the low byte encoding the orb index (0xFFD101..0xFFD110).
    'orbroom_marker': { color: 0xffFFD100, hasStuff: false, optional: true, name: "Orb Room",
        colorAliases: [
            0xffFFD101, 0xffFFD102, 0xffFFD103, 0xffFFD104,
            0xffFFD105, 0xffFFD106, 0xffFFD107, 0xffFFD108,
            0xffFFD109, 0xffFFD10A, 0xffFFD10B, 0xffFFD10C,
            0xffFFD10D, 0xffFFD10E, 0xffFFD10F, 0xffFFD110,
        ] },

    // Static tile
    'biome_watchtower': { color: 0xffb70000, wangFile: '../data/wang_tiles/static/watchtower_fg.png', optional: true, name: "Watchtower" },
    'biome_potion_mimics': { color: 0xffff00fe, wangFile: '../data/wang_tiles/static/potion_mimics_fg.png', name: "Henkevä Temple" },
    'biome_darkness': { color: 0xffff00fd, wangFile: '../data/wang_tiles/static/darkness_fg.png', name: "Ominous Temple" },
    'biome_boss_sky': { color: 0xffff00fc, wangFile: '../data/wang_tiles/static/boss_fg.png', optional: true, name: "Kivi Temple" },
    'biome_barren': { color: 0xffff00fb, wangFile: '../data/wang_tiles/static/barren_fg.png', optional: true, name: "Barren Temple" },
};

Object.values(GENERATOR_CONFIG).forEach(conf => {
    conf.enabled = true; // Default to all enabled, we can disable later if needed
    if (conf.name === 'Lake') conf.enabled = false; // Lake is just silly, especially without enemy spawns implemented. Though it can affect NG+ overlaps
    conf.pois = conf.pois || []; // No longer used... Overlaps made PoIs not really work per-biome
});

export const BIOME_COLOR_TO_NAME = {};
Object.entries(GENERATOR_CONFIG).forEach(([biomeName, conf]) => {
    BIOME_COLOR_TO_NAME[conf.color & 0xffffff] = biomeName;
    // Allow biomes to declare alternate biome-map colors that should resolve
    // to the same biome (e.g. holy mountain entrance vs side/filler shades).
    if (Array.isArray(conf.colorAliases)) {
        for (const alias of conf.colorAliases) {
            BIOME_COLOR_TO_NAME[alias & 0xffffff] = biomeName;
        }
    }
});

// Only the ones with wang tiles
export const BIOME_COLORS_WITH_TILES = new Set(Object.values(GENERATOR_CONFIG).filter(conf => conf.wangFile != null).map(conf => conf.color & 0xffffff));

// Fallback set of wobble-ineligible biome-map colors, used by utils.js
// when data/biome_flags.json doesn't cover a color (e.g. NG+ palette
// swaps). Color-only is approximate — for biomes whose XML varies across
// shades of the "same" color, prefer the JSON. See EDGE_NOISE_NOTES.md.
export const BIOMES_WITHOUT_WAVY_EDGE = new Set([
    0x93cb4c, 0x93cb4d, 0x93cb4e, 0x93cb4f, 0x93cb5a, // temple_altar variants
    0x6dcb28, 0xB8A928, 0x5a9628,                       // temple_wall variants
    0x14EED7, 0x0DA899,                                 // boss_arena variants
    0x364D24,                                            // dragoncave
    0x50EED7,                                            // boss_victoryroom (Hell)
    0xFF6A02, 0xFFA717,                                 // lava
]);

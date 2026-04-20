export const GENERATOR_CONFIG = {
    'coalmine': { color: 0xffd57917, wangFile: '../data/wang_tiles/coalmine.png', name: "Mines" },
    'coalmine_alt': { color: 0xffD56517, wangFile: '../data/wang_tiles/coalmine_alt.png', name: "Collapsed Mines" },
    'excavationsite': { color: 0xff124445, wangFile: '../data/wang_tiles/excavationsite.png', name: "Coal Pits" },
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
    'robobase': { color: 0xff4e5267, wangFile: '../data/wang_tiles/robobase.png', name: "Power Plant" },
    'vault_frozen': { color: 0xff0080a8, wangFile: '../data/wang_tiles/vault_frozen.png', name: "Frozen Vault" },
    'meat': { color: 0xff572828, wangFile: '../data/wang_tiles/meat.png', name: "Meat Realm" },
    'wandcave': { color: 0xff006C42, hasStuff: false, wangFile: '../data/wang_tiles/wand.png', name: "Magical Temple" },
    'pyramid': { color: 0xff967f11, hasStuff: false, wangFile: '../data/wang_tiles/pyramid.png', optional: true, name: "Pyramid" },
    'sandcave': { color: 0xffE1CD32, hasStuff: false, wangFile: '../data/wang_tiles/sandcave.png', optional: true, name: "Sandcave" },
    'clouds': { color: 0xff36d5c9, hasStuff: false, wangFile: '../data/wang_tiles/clouds.png', optional: true, name: "Cloudscape" },
    'the_sky': { color: 0xffD3E6F0, hasStuff: false, wangFile: '../data/wang_tiles/the_sky.png', optional: true, name: "The Work (Sky)" },
    'the_end': { color: 0xff3C0F0A, hasStuff: false, wangFile: '../data/wang_tiles/the_end.png', name: "The Work (Hell)" },
    'boss_victoryroom': { color: 0xff50eed7, hasStuff: false, name: "The Work (Victory Room)" },
    'winter_caves': { color: 0xff77A5BD, hasStuff: false, wangFile: '../data/wang_tiles/snowchasm.png', optional: true, name: "Snowy Chasm" },
    'solid_wall_tower_1': { color: 0xff3d3e37, wangFile: '../data/wang_tiles/coalmine.png', name: "Tower (Mines)" },
    'solid_wall_tower_2': { color: 0xff3d3e38, wangFile: '../data/wang_tiles/excavationsite.png', name: "Tower (Coal Mines)" },
    'solid_wall_tower_3': { color: 0xff3d3e39, wangFile: '../data/wang_tiles/snowcave.png', name: "Tower (Snowy Depths)" },
    'solid_wall_tower_4': { color: 0xff3d3e3a, wangFile: '../data/wang_tiles/snowcastle.png', name: "Tower (Hiisi Base)" },
    'solid_wall_tower_5': { color: 0xff3d3e3b, wangFile: '../data/wang_tiles/fungicave.png', name: "Tower (Fungal Caverns)" },
    'solid_wall_tower_6': { color: 0xff3d3e3c, wangFile: '../data/wang_tiles/rainforest.png', name: "Tower (Underground Jungle)" },
    'solid_wall_tower_7': { color: 0xff3d3e3d, wangFile: '../data/wang_tiles/vault.png', name: "Tower (The Vault)" },
    'solid_wall_tower_8': { color: 0xff3d3e3e, wangFile: '../data/wang_tiles/crypt.png', name: "Tower (Temple of the Art)" },
    'solid_wall_tower_9': { color: 0xff3d3e3f, wangFile: '../data/wang_tiles/the_end.png', name: "Tower (Hell)" },
    'lake_deep': { color: 0xff1158f1, wangFile: '../data/wang_tiles/water.png', optional: true, name: "Lake" },
    // Extra biomes that don't have wang tiles
    'excavationsite_cube_chamber': { color: 0xff24888a, name: "Meditation Cube" },
    'snowcave_secret_chamber': { color: 0xff18a0d6, name: "Snowcave Secret Chamber" },
    'snowcastle_cavern': { color: 0xff775ddb, name: "Hiisi Hourglass Shop" },
    'snowcastle_hourglass_chamber': { color: 0xff18d6d6, name: "Eye Room" },
    'robot_egg': { color: 0xff9e4302, name: "Robot Egg" },
    'pyramid_hallway': { color: 0xff167f5f, hasStuff: false, name: "Pyramid (Hallway)" },
    'pyramid_right': { color: 0xff968f96, hasStuff: false, name: "Pyramid (Right)" },
    'pyramid_entrance': { color: 0xff967f5f, hasStuff: false, name: "Pyramid (Entrance)" },
    'pyramid_left': { color: 0xff968f5f, hasStuff: false, name: "Pyramid (Left)" },
    'pyramid_top': { color: 0xffc88f5f, name: "Pyramid (Top)"},
    'secret_lab': { color: 0xffbaa345, name: "Abandoned Alchemy Lab" },
    'wizardcave_entrance': { color: 0xff804169, name: "Triangle Boss"},
    'dragoncave': { color: 0xff364d24, name: "Dragoncave" },
    'roboroom': { color: 0xff9d893d, name: "Mecha Kolmi Boss Room" },
    'meatroom': { color: 0xff796620, name: "Meatball Boss Room" },
    'ghost_secret': { color: 0xff1F3B64, hasStuff: false, name: "Forgotten Boss Room" },
    'mestari_secret': { color: 0xff1F3B62, hasStuff: false, name: "Throne Room" },
    'temple_altar': { color: 0xff93cb4c, name: "Holy Mountain" }, // Apparently the only one with edge noise??
    'temple_altar_left': { color: 0xff93cb4d, hasStuff: false, name: "Holy Mountain (Left)" },
    'temple_altar_right': { color: 0xff93cb4e, hasStuff: false, name: "Holy Mountain (Right)" },
    'temple_altar_right_snowcave': { color: 0xff93cb4f, hasStuff: false, name: "Holy Mountain (Snowy Depths Exit)" }, // note: not used in NG, for some reason
    'temple_altar_right_snowcastle': { color: 0xff93cb5a, hasStuff: false, name: "Holy Mountain (Hiisi Base Exit)" }, // note: not used in NG+, for some reason
    'temple_wall_ending': { color: 0xff5a9628, hasStuff: false, name: "Holy Mountain Basin (End)" },
    'temple_wall': { color: 0xff6dcb28, hasStuff: false, name: "Holy Mountain Basin" },
    'solid_wall_temple': { color: 0xffB8A928, hasStuff: false, name: "Holy Mountain (Solid)" },
    // Empty HM variants excluded since they only apply to daily practice run mod
    'boss_arena': { color: 0xff14EED7, hasStuff: false, name: "The Laboratory" },
    'boss_arena_top': { color: 0xff0da899, hasStuff: false, name: "The Laboratory (Top)" },
    // Surface and other kind of useless ones
    'hills': { color: 0xff36d517, hasStuff: false, name: "Hills" },
    'hills2': { color: 0xff33e311, hasStuff: false, name: "Hills2" },
    'desert': { color: 0xffCC9944, hasStuff: false, name: "Desert" },
    'scale': { color: 0xffeba500, hasStuff: false, name: "Scale" },
    'winter': { color: 0xffD6D8E3, hasStuff: false, name: "Snowy Wasteland" },
    'lake': { color: 0xff1133F1, hasStuff: false, name: "Lake (Surface)" },
    'lake_statue': { color: 0xff11A3FC, hasStuff: false, name: "Lake (Island)" },
    'lava': { color: 0xffFF6A02, hasStuff: false, name: "Volcanic Lake" },
    'lava_90percent': { color: 0xffFFA717, hasStuff: false, name: "Volcanic Lake (90%)" },
    'gold': { color: 0xffFFFF00, hasStuff: false, name: "Gold" }, // Functionally useful but not for this
    'water': { color: 0xff0000FF, hasStuff: false, name: "Water" }, // Literally useless and yet very mysterious!
    'solid_wall': { color: 0xff3d3d3d, hasStuff: false, name: "EDR" },
    //'solid_wall_damage': { color: 0xff684C4C, hasStuff: false, name: "Cursed Rock" }, // Actually got this mixed up, I don't know if this one is used
    'solid_wall_tower': { color: 0xff3f3d3e, hasStuff: false, name: "Cursed Rock" },
    // Orb rooms
    'orbroom_00': { color: 0xffffd100, hasStuff: false, name: "Orb Room (0)" },
    'orbroom_01': { color: 0xffffd101, hasStuff: false, name: "Orb Room (1)" },
    'orbroom_02': { color: 0xffffd102, hasStuff: false, name: "Orb Room (2)" },
    'orbroom_03': { color: 0xffffd103, hasStuff: false, name: "Orb Room (3)" },
    'orbroom_04': { color: 0xffffd104, hasStuff: false, name: "Orb Room (4)" },
    'orbroom_05': { color: 0xffffd105, hasStuff: false, name: "Orb Room (5)" },
    'orbroom_06': { color: 0xffffd106, hasStuff: false, name: "Orb Room (6)" },
    'orbroom_07': { color: 0xffffd107, hasStuff: false, name: "Orb Room (7)" },
    'orbroom_08': { color: 0xffffd108, hasStuff: false, name: "Orb Room (8)" },
    'orbroom_09': { color: 0xffffd109, hasStuff: false, name: "Orb Room (9)" },
    'orbroom_10': { color: 0xffffd110, hasStuff: false, name: "Orb Room (10)" },
    'orbroom_11': { color: 0xffffd111, hasStuff: false, name: "Orb Room (11)" },
    // Static tile
    'biome_watchtower': { color: 0xffb70000, wangFile: '../data/wang_tiles/static/watchtower_fg.png', optional: true, name: "Watchtower" },
    'biome_potion_mimics': { color: 0xffff00fe, wangFile: '../data/wang_tiles/static/potion_mimics_fg.png', name: "Henkevä Temple" },
    'biome_darkness': { color: 0xffff00fd, wangFile: '../data/wang_tiles/static/darkness_fg.png', name: "Ominous Temple" },
    'biome_boss_sky': { color: 0xffff00fc, wangFile: '../data/wang_tiles/static/boss_fg.png', optional: true, name: "Kivi Temple" },
    'biome_barren': { color: 0xffff00fb, wangFile: '../data/wang_tiles/static/barren_fg.png', optional: true, name: "Barren Temple" },
    // Spliced pixel scene biomes and other useless stuff
    'mountain_lake': { color: 0xfff7cf8d, hasStuff: false, name: "Pond" },
    'lavalake': { color: 0xff3d5a3d, hasStuff: false, name: "Lava Lake" },
    'lavalake_pit': { color: 0xff3d5a4f, hasStuff: false, name: "Lava Lake Pit" },
    'lavalake_racing': { color: 0xff4118d6, hasStuff: false, name: "Racetrack" },
    'mountain_left_stub': { color: 0xff608080, hasStuff: false, name: "Mountain (Left Stub)" },
    'mountain_left_entrance': { color: 0xff208080, hasStuff: false, name: "Mountain (Left Entrance)" },
    'mountain_hall': { color: 0xff204060, hasStuff: false, name: "Mountain (Hall)" },
    'mountain_right': { color: 0xff408080, hasStuff: false, name: "Mountain (Right)" },
    'mountain_right_stub': { color: 0xffE08080, hasStuff: false, name: "Mountain (Right Stub)" },
    'mountain_top': { color: 0xffC08080, hasStuff: false, name: "Mountain (Top)" },
    'mountain_floating_island': { color: 0xffC08082, hasStuff: false, name: "Mountain (Floating Island)" },
    'mountain_tree': { color: 0xff14E1D7, hasStuff: false, name: "Tree" },
    'solid_wall_hidden_cavern': { color: 0xff42244d, hasStuff: false, name: "Hidden Cavern" },
    'solid_wall_tower_10': { color: 0xff3d3e41, name: "Tower (Reward)" },
    'bridge': { color: 0xffad8111, hasStuff: false, name: "Bridge" },
    'empty': { color: 0xff48E311, hasStuff: false, name: "Empty" },
    'snowcave_tunnel': { color: 0xff7be311, hasStuff: false, name: "Snowcave Tunnel" },
    'watercave': { color: 0xff3046c1, hasStuff: false, name: "Dark Cave" },
    'sky_light_injector': { color: 0xfffe0000, hasStuff: false, name: "Sky Light Injector" },
    'teleroom': { color: 0xff5f8fab, hasStuff: false, name: "Teleport Room" },
    'friend_1': { color: 0xff6db55a, hasStuff: false, name: "Friend Room (1)" },
    'friend_2': { color: 0xff6db55b, hasStuff: false, name: "Friend Room (2)" },
    'friend_3': { color: 0xff6db55c, hasStuff: false, name: "Friend Room (3)" },
    'friend_4': { color: 0xff6db55d, hasStuff: false, name: "Friend Room (4)" },
    'friend_5': { color: 0xff6db55e, hasStuff: false, name: "Friend Room (5)" },
    'friend_6': { color: 0xff6db55f, hasStuff: false, name: "Friend Room (6)" },
    'gun_room': { color: 0xff39a760, hasStuff: false, name: "Gun Room" },
    'null_room': { color: 0xffe17e32, hasStuff: false, name: "Nullification Altar" },
    'rock_room': { color: 0xff326655, hasStuff: false, name: "Rock Room" },
    'funroom': { color: 0xff0a95a4, hasStuff: false, name: "Fungal Map" },
    'song_room': { color: 0xff9d99d1, hasStuff: false, name: "Coral Chest" },
    'alchemist_secret': { color: 0xff57dace, hasStuff: false, name: "Dark Chest" },
    'moon_room': { color: 0xff567cb0, hasStuff: false, name: "Moon Room" },
    'gourd_room': { color: 0xff2e99d1, hasStuff: false, name: "Gourd Room" },
    'greed_room': { color: 0xff3f55d1, hasStuff: false, name: "Greed Room" }, // Not sure this is used
    'ocarina': { color: 0xff57cace, hasStuff: false, name: "Ocarina" },
    'essenceroom_air': { color: 0xff157cb8, hasStuff: false, name: "Essence of Air" },
    'essenceroom': { color: 0xff157cb0, hasStuff: false, name: "Essence of Earth" },
    'essenceroom_hell': { color: 0xff157cb5, hasStuff: false, name: "Essence of Water" },
    'essenceroom_alc': { color: 0xff157cb6, hasStuff: false, name: "Essence of Spirits" },
    'mystery_teleport': { color: 0xff157cb7, hasStuff: false, name: "Mystery Teleport" },
    'roadblock': { color: 0xfff0d517, hasStuff: false, name: "Roadblock" },
};

Object.values(GENERATOR_CONFIG).forEach(conf => {
    conf.enabled = true; // Default to all enabled, we can disable later if needed
    if (conf.name === 'Lake') conf.enabled = false; // Lake is just silly, especially without enemy spawns implemented. Though it can affect NG+ overlaps
    conf.pois = conf.pois || []; // No longer used... Overlaps made PoIs not really work per-biome
});

export const BIOME_COLOR_TO_NAME = {};
Object.entries(GENERATOR_CONFIG).forEach(([biomeName, conf]) => {
    BIOME_COLOR_TO_NAME[conf.color & 0xffffff] = biomeName;
});

// Only the ones with wang tiles
export const BIOME_COLORS_WITH_TILES = new Set(Object.values(GENERATOR_CONFIG).filter(conf => conf.wangFile != null).map(conf => conf.color & 0xffffff));

// Used to generate the holy mountain basin material variants
export const HOLY_MOUNTAIN_BASIN_COLORS = new Set([
    0x93cb4c, // temple_altar
    0x93cb4d, // temple_altar_left
    0x93cb4e, // temple_altar_right
    0x93cb4f, // temple_altar_right_snowcave (note: not used in NG, for some reason)
    0x93cb5a, // temple_altar_right_snowcastle (note: not used in NG+, for some reason)
    0x5a9628, // temple_wall_ending
    0x6dcb28, // temple_wall
]);

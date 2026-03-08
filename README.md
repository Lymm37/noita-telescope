# Lymm's Telescope 

(Yet Another Noita Seed Tool)

**[Search your seed](https://lymm37.github.io/noita-telescope/)**

A web-based seed analyzer for [Noita](https://noitagame.com/), including a detailed world map for your specific seed. This tool allows players to simulate world generation, view biome maps, and search for specific wands, spells, potions, and items across the main world and all Parallel Worlds (PWs).

## Features

- **World Generation Visualization:** Generates and renders the Wang tile layout of biomes, as well as generated pixel scenes.
- **Wand & Item Search:** Search for specific spells, wand stats (non-shuffle, always casts, 27+ slots, etc.), potions/pouches (ambrosia, silver, etc.), items (kiuaskivi, paha silma, etc.), and some enemies (like mimics).
- **Parallel World Support:** Scan and navigate through *all* Parallel Worlds to find rare loot.
- **Detailed Object Inspection:** Hover over generated objects to see exact details:
	- **Wands:** Stats (shuffle, spells/cast, cast delay, recharge time, max mana, mana charge speed, capacity, spread, speed, length), always casts, and spells.
	- **Items:** Flask/pouch contents, chest info with counts of duplicated items, active/inactive status of runestones.
	- **Enemies:** Natural taikasauva spawns are supported, but they have a tendency to unload, so they aren't always reliable. Some special enemy spawns (all kinds of mimics, and the dragon when it spawns in unusual places) are supported. Other enemy spawns are not yet implemented.
- **Configuration Options:**
	- **New Game+ Support:** Simulate NG+ cycles, generating new tile maps, for every possible NG+ count. Includes support for overlap biomes.
	- **Unlockables:** Toggle specific spell unlock flags that affect generation. There is an option to upload your flags folder to sync your unlocks.
	- **Perks (that affect generation):** Account for perks like *Curse of Greed*, *No More Shuffle*, and *Extra Item in Holy Mountain* which affect generation. Normal perk generation in Holy Mountains is not implemented at the moment, as that wasn't a priority.
	- **Region Toggles:** Selectively generate specific biomes or only biomes with useful objects to save performance. Can be used to disable regions you don't want to search.
	- **Exclude Cosmetic Pixel Scenes:** Can be toggled to not generate pixel scenes without items in them, to save a bit of time while searching.
	- **Local Storage for Settings:** Most settings are saved between reloads.
- **Special Biomes:** Includes spells, wands, and pacifist chests from Holy Mountains, wand spawns from the Meditation Cube, the secret snowy chamber, and the robot egg, and spell spawns from the Hiisi hourglass shop, the Eye Room, and the static heaven and hell shops, as well as the custom wands. Note that some drops are frame-dependent and not just seed dependent, so they cannot be predicted here. Examples include the coral chest, the dark chest, the tower wands, and the experimental wands.
- **Boss Drops:** Shows the seed-based spell drops from the Alchemist, Pyramid, Triangle, and Dragon bosses. Wands dropped from bosses depend on the pixel where they were defeated, but spell drops are based only on the seed, so the dragon drops show the wand which will drop if the dragon is defeated before it moves from where it spawns.
- **NG+ Orb Room Locations:** Orb rooms are shown on the map for each NG+ cycle except for NG0.
- **Secrets:** Includes the hidden messages around the world, including the Wall Messages, a few background symbols, and the Eye Messages. (This is a major upgrade to the previous tool, "Lymm's Binoculars," which just showed the location of the eye messages for a seed, hence the name.)

## Installation / Locally Hosting

If you prefer to run this tool locally instead of using the web version, assuming you have Node installed:

1.  Clone the repository:
	```bash
	git clone https://github.com/Lymm37/noita-telescope.git
	cd noita-telescope
	```
2.  Run a minimal local server:
	```bash
	npx serve
	```
3.  Open `http://localhost:3000` in your browser.

## Usage

1.  **Input seed:** Enter your current world seed and NG+ count (0 to 28). This will generate the biome map and tiles for the seed, and scan the current PW, generating pixel scenes and PoIs.
2.  **Switch to other PWs:** Changing the PW indices (horizontal or vertical) will automatically re-scan spawns for the selected PW. Supports PWs across the entire stable map range (468 worlds for NG and 512 worlds for NG+, and 683 worlds vertically).
3.  **Search:** Enter a search term and click search to find it in the current world. Open the "Advanced Filters" toggle to look for specific wands (e.g., to find wands with a specific always casts or stat range). Matching PoIs will be displayed at a larger scale that changes with zoom so that they are easily visible anywhere on the map. You can use the search menu to navigate between matches. When searching over multiple PWs, navigation will automatically continue to scan through PWs until a match is found.
4.  **Interact:** Use the mouse to drag the map and the scroll wheel to zoom. Mouse over a PoI to see the details, click on it to pin it (only one pin supported). Container-type PoIs (holy mountain shops, great treasure chests, potion labs, etc.) may have a lot of items; you can scroll within the pinned tooltip. New regions of the map will be loaded as you pan around the map.

### Search Filters
The search tool supports a variety of filtering options. In the main search field, enter a spell, item, or material you are looking for. This supports a limited number of aliases for common names, but does not currently include detailed search conditions, beyond things like a comma-separated list of spells to find wands with all of them in any order. By default, searching will only search within the current world, near the center of the map. Opening the advanced search will allow for more options:
*   **Wand Name:** Generally hidden in the game UI, aside from some special wands, but you can search generated wand names and they will display in this tool. This search field can be used to find custom wand names like "Varpuluuta" for the broom wand.
*   **Always Casts:** Ability to search for a specific always casts, or just wands with any always casts.
*   **Stats:** Non-Shuffle, Spells/Cast, Cast Delay, Recharge Time, Max Mana, Mana Charge Speed, Capacity, Spread, the hidden Speed stat, and Wand Length if you need it.
*   **Scope:** There is an option to search over all PWs, but this can take a while. There is a PW limit which can be toggled off. Note that it might take a minute to search all PWs for a seed, and may also end up using a lot of RAM to store the results. Once stored in memory, all objects in a seed can be searched much more quickly, until the seed or NG+ value is changed.

## Issues / TODO

*   **Slow initial loading**: Loading the pixel scene data can be slow on github pages, but this only needs to be done on the initial page load, and once it is done, generating the map for a given seed should be pretty fast.
*   **Not guaranteed to be accurate in all cases:** There are edge cases where it fails (false postive spawns, false negative spawns, and incorrect spell spawns).
*   **Edge Cases:** Biome boundaries (Edge Noise) are calculated, but do not consistently agree with the way pixel scenes and spawns are filtered at biome edges in game. As a result, there may be some false positives and false negatives. If you toggle the "Enable Edge Noise" debug option and the spawn you are interested in disappears (or appears), it may not be real. But sometimes it will be. This is a work in progress.
*   **Vertical Parallel Worlds:** Implemented, and seems to be working for the most part. There are some issues with some spells in hell spawning just above a chunk and falling into the void, and these end up looking like false positives.
*   **Cross-World Spawns:** Now being displayed, but not yet selectable. Work in progress, I guess. Very unlikely to affect many people considering it only happens in NG+ after 128+ PWs.
*   **Perks:** Not implemented, and not a high priority considering how many tools there already are which can find perks for a seed.
*   **Static Pixel Scenes:** Static pixel scenes which can vary by seed (e.g. the dark cave, friend room, hiisi shop) are now included. Other static pixel scenes are not loaded by default in order to save time.
*   **Missing Pixel Scenes:** Some pixel scenes may be missing in some biomes, some of which might have useful items, that I missed. Most pixel scenes are implemented, though.
*   **Unlocks:** Which spells appear on wands and in shops depends on your unlocks, and not just in the sense that you can't find ones you haven't unlocked, so if there is an incorrect spell prediction somewhere, it is most likely due to the unlock settings not matching your game. There are settings to toggle all the unlock flags, but this might be a bit tedious, so I added an option to upload your flags to sync it. The flags folder is in `save00/persistent`.
*   **Pathfinding:** The pathfinding methods might not be perfectly reimplemented, so there could be seeds where some biomes do not generate with tiles matching what is in the game. From testing so far, it seems to be working. Let me know if you find any seeds like this and I can try to fix them.
*   **Performance:** Tiles are only generated once, but PoI results are stored for each PW, so this can use a decent amount of memory (up to a couple of GB if you load all PWs). This program was not designed to be optimally fast, and also was not designed for searching over multiple seeds, and is mainly for looking for specific things in your current run.
*   **Taikasauva Spawns:** While natural taikasauva generation (in the Magical Temple) is working, these wand ghosts have a tendency to unload randomly, so it's possible for the spells/wands to become lost. Because of this inconsistency, there is an option to exclude Taikasauva spawns. They are also naturally excluded from the "Useful" regions because the Magical Temple is excluded by default. Overlap biomes can still spawn taikasauvas without Magical Temple being scanned, though.
*   **"Coalmine Alt Shrine":** There is exactly one pixel scene in the game which is *unique*, the "shrine" pixel scene in the Collapsed Mines. You will get different pixel scene generation depending on whether or not this pixel scene has ever been encountered/loaded. A debug option will toggle whether or not it has been visited to accurately predict pixel scenes in the Collapsed Mines in either case. If pixel scenes are incorrect for you in this biome, it is probably because of this.
*   **Overlap Biomes:** These mostly work but may still have some issues with predicting incorrect spawns, mostly due to pixel scene bounds checking logic not being fully understood. There is also the possibility of getting an infinite loop of pixel scene nesting, though I have not encountered this yet. Aside from edge cases, overlap biomes do mostly work as intended, though.
*   **Cosmetics:** Purely cosmetic pixel scenes can be skipped for a minor speedup in searching, but in some rare cases this may exclude actual spawns (e.g. overlap biomes that spawn something inside a cosmetic nested spawn pixel).
*   **Enemy Spawns:** Not included, but might be done in the future.
*   **Only English Supported:** The translations file used for item name lookups supports other languages, but currently only English is supported in this app.
*   **The Eye Messages have not yet been solved:** If you're interested in the current state of progress on them, you can check out [this wiki](https://github.com/Lymm37/eye-messages/wiki).

## Credits

* This tool was made with lots of help from members of the community.
	* TwoAbove https://www.noitool.com/info (https://github.com/TwoAbove/noita-tools)
	* Pudy248 https://github.com/pudy248/NoitaSeedSearcherCUDA & https://github.com/pudy248/NoitaMapViewer 
	* NathanSnail https://github.com/NathanSnail/noitadata & https://github.com/NathanSnail/red_funs
	* WUOTE https://noitamap.com/ & https://github.com/WUOTE/noita-builds-data
	* Chillie-ilya https://chillie-ilya.github.io/lymms-binoculars-web/ (https://github.com/chillie-ilya/lymms-binoculars-web)
	* Rosalinadev for help with optimization
	* KingCrabmaster for art
	* and many others for help with testing
*   All game assets (biome maps, Wang tiles, pixel scenes, sprites, images, icons, and translations) belong to Nolla Games.

*This project is not affiliated with Nolla Games.*

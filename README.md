# Lymm's Telescope 

(Yet Another Noita Seed Tool)

**[Search your seed](https://lymm37.github.io/noita-telescope/)**

A web-based seed analyzer for [Noita](https://noitagame.com/), including a detailed world map for your specific seed. This tool allows players to simulate world generation, view biome maps, and search for specific wands, spells, potions, and items across the main world and all Parallel Worlds (PWs).

## Features

- **World Generation Visualization:** Generates and renders the Wang tile layout of biomes, as well as generated pixel scenes.
- **Wand & Item Search:** Search for specific spells, wand stats (non-shuffle, always casts, 27+ slots, etc.), potions/pouches (ambrosia, silver, etc.), items (kiuaskivi, paha silma, etc.), and enemies (like mimics).
- **Local Search Mode:** Search for specific pixel spawns for things like Summon Taikasauva and End of Everything in a region around where you click on the map. This includes searches for things like the sampo and 34th orb.
- **Parallel World Support:** Scan and navigate through *all* Parallel Worlds to find rare loot.
- **Detailed Object Inspection:** Hover over generated objects to see exact details:
	- **Wands:** Stats (shuffle, spells/cast, cast delay, recharge time, max mana, mana charge speed, capacity, spread, speed, length), always casts, and spells.
	- **Items:** Flask/pouch contents, chest info with counts of duplicated items, active/inactive status of runestones.
	- **Enemies:** Natural taikasauva spawns are supported, but they have a tendency to unload, so they aren't always reliable. Some special enemy spawns (all kinds of mimics, and the dragon when it spawns in unusual places) are supported. Other enemy spawns are also available with a debug setting, but some may be missing.
- **Configuration Options:**
	- **New Game+ Support:** Simulate NG+ cycles, generating new tile maps, for every possible NG+ count. Includes support for overlap biomes.
	- **Unlockables:** Toggle specific spell unlock flags that affect generation. There is an option to upload your flags folder to sync your unlocks and progress.
	- **Perks (that affect generation):** Account for perks like *Curse of Greed*, *No More Shuffle*, and *Extra Item in Holy Mountain* which affect generation. Normal perk generation and selection in Holy Mountains can be simulated as well.
	- **Region Toggles:** Selectively generate specific biomes or only biomes with useful objects to save performance. Can be used to disable regions you don't want to search.
	- **Exclude Cosmetic Pixel Scenes:** Can be toggled to not generate pixel scenes without items in them, to save a bit of time while searching.
	- **Accessibility Mode:** Changes the PoIs to more intuitive shapes if the colors alone don't distinguish them well enough. Might change this to be the default if people prefer it.
	- **Local Storage for Settings:** Most settings are saved between reloads.
- **Special Biomes:** Includes spells, wands, and pacifist chests from Holy Mountains, wand spawns from the Meditation Cube, the secret snowy chamber, and the robot egg, and spell spawns from the Hiisi hourglass shop, the Eye Room, and the static heaven and hell shops, as well as the custom wands. Note that some drops are frame-dependent and not just seed dependent, so they cannot be predicted here. Examples include the coral chest, the dark chest, the tower wands, and the experimental wands.
- **Boss Drops:** Shows the seed-based spell drops from the Alchemist, Pyramid, Triangle, and Dragon bosses. Wands dropped from bosses depend on the pixel where they were defeated, but spell drops are based only on the seed, so the dragon drops show the wand which will drop if the dragon is defeated before it moves from where it spawns. Some boss wand drops are available with local search.
- **Fungal Shifts:** A side menu shows all fungal shifts for the current seed. Failed shifts and greed shifts are also predicted correctly, fixing some bugs from Noitool.
- **Alchemy:** The recipes for alchemic precursor and lively concoction are shown in a side menu for the seed.
- **Perk Deck Simulation:** In a side menu, perks for the seed are shown in a format similar to Noitool, allowing for simulated perk generation and selection, though there is not currently support for the advanced mode where the load order of the holy mountains matters, so it is mainly for selecting perks from PWs in one direction in standard holy mountain order. Perk selections here affect generation and are preserved when going to NG+. There is also an option to upload your player file to sync your perk selections after going to NG+, to avoid having to select all the perks you picked up during the last cycle.
- **Progress:** After syncing your unlock flags, spell progress can be shown, and you can click a spell or enemy in the list to search for it directly. Additionally, there is a button to quickly search for all missing progress in the current PW.
- **NG+ Orb Room Locations:** Orb rooms are shown on the map for each NG+ cycle except for NG0.
- **Secrets:** Includes the hidden messages around the world, including the Wall Messages, a few background symbols, and the Eye Messages. (This is a major upgrade to the previous tool, "Lymm's Binoculars," which just showed the location of the eye messages for a seed, hence the name.)

## Installation / Locally Hosting

If you prefer to run this tool locally instead of using the web version, assuming you have Node installed:

1.  Clone the repository:
	```bash
	git clone https://github.com/Lymm37/noita-telescope.git
	cd noita-telescope
	```
2.  Run a minimal local server, with Node:
	```bash
	npx serve
	```
	or with Python:
	```bash
	python -m http.server
	```
3.  Open `http://localhost:3000` (Node) or `http://localhost:8000` (Python) in your browser.

## Usage

1.  **Input seed:** Enter your current world seed and NG+ count (0 to 28). This will generate the biome map and tiles for the seed, and scan the current PW, generating pixel scenes and PoIs.
2.  **Switch to other PWs:** Changing the PW indices (horizontal or vertical) will automatically re-scan spawns for the selected PW. Supports PWs across the entire stable map range (468 worlds for NG and 512 worlds for NG+, and 683 worlds vertically).
3.  **Search:** Enter a search term and click search to find it in the current world. Open the "Advanced Filters" toggle to look for specific wands (e.g., to find wands with a specific always casts or stat range). Matching PoIs will be displayed at a larger scale that changes with zoom so that they are easily visible anywhere on the map. You can use the search menu to navigate between matches. When searching over multiple PWs, navigation will automatically continue to scan through PWs until a match is found. For local search, if the local search mode is selected, clicking somewhere on the map will start a search at that pixel and spiral outwards until finding a match.
4.  **Interact:** Use the mouse to drag the map and the scroll wheel to zoom. Mouse over a PoI to see the details, click on it to pin it (only one pin supported). Container-type PoIs (holy mountain shops, great treasure chests, potion labs, etc.) may have a lot of items; you can scroll within the pinned tooltip. New regions of the map will be loaded as you pan around the map.

### Search links

Pass `seed` and `q` to open a seed and run a search, for example:

`?seed=12333&q=chainsaw`

The query fills the search box and starts once the initial world is ready,
using the current search options (including parallel-world range and filters).
Results use the normal search navigation. Existing `ng`, `gamemode`, and
`seed=daily` parameters continue to work. A missing or blank `q` does not start
a search; `q` without a seed only fills the box. Queries are URL-encoded, so
spaces, Unicode and reserved characters are preserved. Starting another search
updates `q` without adding a browser history entry.

### Search Filters
The search tool supports a variety of filtering options. In the main search field, enter a spell, item, or material you are looking for. This supports a limited number of aliases for common names, but does not currently include detailed search conditions, beyond things like a comma-separated list of spells to find wands with all of them in any order. By default, searching will only search within the current world, near the center of the map. Opening the advanced search will allow for more options:
*   **Wand Name:** Generally hidden in the game UI, aside from some special wands, but you can search generated wand names and they will display in this tool. This search field can be used to find custom wand names like "Varpuluuta" for the broom wand.
*   **Always Casts:** Ability to search for a specific always casts, or just wands with any always casts.
*   **Stats:** Non-Shuffle, Spells/Cast, Cast Delay, Recharge Time, Max Mana, Mana Charge Speed, Capacity, Spread, the hidden Speed stat, and Wand Length if you need it.
*   **Scope:** There is an option to search over all PWs, but this can take a while. There is a PW limit which can be toggled off. Note that it might take a minute to search all PWs for a seed, and may also end up using a lot of RAM to store the results. Once stored in memory, all objects in a seed can be searched much more quickly, until the seed or NG+ value is changed.
*   **Local Search:** Changing the local search mode will allow you to search for drops which come from individual pixels from things like Summon Taikasauva, End of Everything, and certain boss wand drops. Once the local search mode is set, clicking on the map will search starting at that pixel. For example, if you enter "34th orb" in the main search field with the local search mode set to EoE (End of Everything), then click somewhere on the map, you can search for the nearest 34th orb drop from a great treasure chest spawned by EoE.
*   **Search Acceleration:** In local search mode, certain search filters will automatically switch to an accelerated search mode based on precomputed RNG states, which will allow for much faster local searches. These are the current filters which support accelerated local search:
	* Capacity > 26 for all local search modes
	* Spells/Cast > 26 for all local search modes (though there are not very many of these at all)
	* Sprite Rarity >= 10^7 for all local search modes
	* Sampo and 34th orb search for End of Everything

## Issues / TODO

*   **Slow initial loading**: Loading the pixel scene data can be slow on github pages, but this only needs to be done on the initial page load, and once it is done, generating the map for a given seed should be pretty fast.
*   **Unlocks:** Which spells appear on wands and in shops depends on your unlocks, and not just in the sense that you can't find ones you haven't unlocked, so if there is an incorrect spell prediction somewhere, it is most likely due to the unlock settings not matching your game. There are settings to toggle all the unlock flags, but this might be a bit tedious, so I added an option to upload your flags to sync it. The flags folder is in `save00/persistent`. Also note that if you get a new unlock during a run, the new unlock will not apply to generation until after you save your game by reloading (mod restart works).
*   **Not guaranteed to be accurate in all cases:** There are edge cases where it fails (false postive spawns, false negative spawns, and incorrect spell spawns, mostly from edge noise). Most of these have been fixed, but if you find any incorrect spawns that aren't just a difference in unlocks, please let me know.
*   **Perks:** Mostly implemented, but doesn't simulate it in full generality including the loading order of holy mountains.
*   **Some Static Spawns:** Static pixel scenes which can vary by seed (e.g. the dark cave, friend room, hiisi shop) are included. Static pixel scenes without spawns are not included, being replaced by the custom art layer. Some static spawns, like bosses, are missing, because I assume everyone knows where they are.
*   **Performance:** Tiles are only generated once, but PoI results are stored for each PW, so this can use a decent amount of memory (up to a couple of GB if you load all PWs). This program was not designed to be optimally fast, and also was not designed for searching over multiple seeds, and is mainly for looking for specific things in your current run.
*   **Taikasauva Spawns:** While natural taikasauva generation (in the Magical Temple) is working, these wand ghosts have a tendency to unload randomly, so it's possible for the spells/wands to become lost. Because of this inconsistency, there is an option to exclude Taikasauva spawns. They are also naturally excluded from the "Useful" regions because the Magical Temple is excluded by default. Overlap biomes can still spawn taikasauvas without Magical Temple being scanned, though.
*   **"Coalmine Alt Shrine":** There is exactly one pixel scene in the game which is *unique*, the "shrine" pixel scene in the Collapsed Mines. You will get different pixel scene generation depending on whether or not this pixel scene has ever been encountered/loaded. A debug option will toggle whether or not it has been visited to accurately predict pixel scenes in the Collapsed Mines in either case. If pixel scenes are incorrect for you in this biome, it is probably because of this.
*   **Overlap Biomes:** These mostly work but may still have some issues with predicting incorrect spawns. There is also the possibility of getting an infinite loop of pixel scene nesting, though I have not encountered this yet. Aside from edge cases, overlap biomes do mostly work as intended, though.
*   **Cosmetics:** Purely cosmetic pixel scenes can be skipped for a minor speedup in searching, but in some rare cases this may exclude actual spawns (e.g. overlap biomes that spawn something inside a cosmetic nested spawn pixel).
*   **Enemy Spawns:** Some enemy spawns are incorrect, particularly in the first few areas which use a different spawn method from the rest of the game. Surface spawns are not implemented.
*   **Only English Supported:** The translations file used for item name lookups supports other languages, but currently only English is supported in this app.
*   **The Eye Messages have not yet been solved:** If you're interested in the current state of progress on them, you can check out [this wiki](https://github.com/Lymm37/eye-messages/wiki).

## Credits

* This tool was made with lots of help from members of the community.
	* TwoAbove https://www.noitool.com/info (https://github.com/TwoAbove/noita-tools)
	* Pudy248 https://github.com/pudy248/NoitaSeedSearcherCUDA & https://github.com/pudy248/NoitaMapViewer 
	* NathanSnail https://github.com/NathanSnail/noitadata & https://github.com/NathanSnail/red_funs
	* WUOTE https://noitamap.com/ & https://github.com/WUOTE/noita-builds-data
	* Chillie-ilya https://chillie-ilya.github.io/lymms-binoculars-web/ (https://github.com/chillie-ilya/lymms-binoculars-web)
	* sdlwdr https://github.com/sdlwdr/cauldron_forecast/ (https://sdlwdr.github.io/cauldron_forecast/)
	* Rosalinadev for help with optimization
	* KingCrabmaster for art
	* and many others for help with testing
*   All game assets (biome maps, Wang tiles, pixel scenes, sprites, images, icons, and translations) belong to Nolla Games.

*This project is not affiliated with Nolla Games.*

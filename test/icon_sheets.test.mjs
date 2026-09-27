/* global Buffer */
// The perk and spell icons are drawn from packed sheets (js/icon_sheets.js); an
// icon missing from its sheet renders blank. Regenerate with
// `node tools/build_icon_sheets.mjs`.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import UPNG from 'upng-js';
import { buildIconSheet, iconSheetIndexSource, SHEET_FOLDERS } from '../tools/build_icon_sheets.mjs';
import { ICON_SHEETS } from '../js/icon_sheet_index.js';
import { PERKS } from '../js/perks.js';
import { ALL_SPELLS } from '../js/spells.js';

const STALE = 'run node tools/build_icon_sheets.mjs';

test('the icon sheets match the icon folders', () => {
	const sheets = SHEET_FOLDERS.map(folder => ({ folder, ...buildIconSheet(folder) }));
	assert.equal(readFileSync(new URL('../js/icon_sheet_index.js', import.meta.url), 'utf8'),
		iconSheetIndexSource(sheets), `js/icon_sheet_index.js is stale: ${STALE}`);
	for (const s of sheets) {
		const png = UPNG.decode(readFileSync(new URL(`../data/${s.folder}.sheet.png`, import.meta.url)));
		const shipped = new Uint8Array(UPNG.toRGBA8(png)[0]);
		assert.ok(png.width === s.width && png.height === s.height && Buffer.compare(shipped, s.pixels) === 0,
			`data/${s.folder}.sheet.png is stale: ${STALE}`);
	}
});

test('every perk and spell has an icon in its sheet', () => {
	const perks = new Set(ICON_SHEETS.perk_sprites.names);
	const spells = new Set(ICON_SHEETS.spell_sprites.names);
	assert.deepEqual(PERKS.map(p => p.id.toLowerCase()).filter(id => !perks.has(id)), []);
	assert.deepEqual(ALL_SPELLS.map(s => s.name.toLowerCase()).filter(id => !spells.has(id)), []);
});

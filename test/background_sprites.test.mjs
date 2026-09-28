// Marker-driven LoadBackgroundSprite art (js/spawn_functions.js
// backgroundSpriteSpawn): every file a spawn function can place must be shipped
// where the background layer loads it from (js/biome_backgrounds.js
// markerArtPath, tools/gen_backgrounds.py step 5).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { BG_SPRITE_FILES } from '../js/spawn_functions.js';

const repo = dirname(dirname(fileURLToPath(import.meta.url)));

test('every marker background sprite is shipped', () => {
	assert.ok(BG_SPRITE_FILES.length > 20);
	for (const f of BG_SPRITE_FILES) {
		const shipped = join(repo, 'data/backgrounds', f.replace(/^data\//, ''));
		assert.ok(existsSync(shipped), `${f} not shipped at ${shipped}`);
	}
});

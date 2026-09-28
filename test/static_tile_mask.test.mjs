// js/biome_backgrounds.js buildStaticTileMask: the static-tile backdrop mask is
// bilinearly interpolated at world resolution before the 0.5 threshold (as
// sprite_static_tile_bg.frag effectively does), so a diagonal edge in the art
// comes out smooth instead of as 10 px steps, and the edge texels clamp outward.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import UPNG from 'upng-js';

// biome_backgrounds.js loads its JSON with a top-level fetch; keep the test to
// the pure function by stubbing just enough of fetch for the module to load.
globalThis.fetch ??= async (url) => ({ ok: true, json: async () => JSON.parse(readFileSync(new URL(url), 'utf8')) });
const { buildStaticTileMask } = await import('../js/biome_backgrounds.js');

const png = UPNG.decode(readFileSync(new URL('../data/backgrounds/biome_impl/static_tile/temples-assets/watchtower_bg.png', import.meta.url)));
const rgba = new Uint8Array(UPNG.toRGBA8(png)[0]);
const M = 32;
const mask = buildStaticTileMask(rgba, png.width, png.height, 10, M);
const firstOn = (y) => {
	for (let x = 0; x < mask.width; x++) if (mask.data[y * mask.width + x]) return x;
	return -1;
};

test('mask is world-scale with a clamp margin', () => {
	assert.equal(mask.width, png.width * 10 + 2 * M);
	assert.equal(mask.height, png.height * 10 + 2 * M);
	// Template row 150 is solid edge to edge; clamping carries it into the
	// left and right margins.
	const y = M + 1505;
	assert.equal(mask.data[y * mask.width + 0], 255);
	assert.equal(mask.data[y * mask.width + mask.width - 1], 255);
});

test('the diagonal slope (template rows 96-100) is smooth, not 10 px steps', () => {
	let maxJump = 0;
	for (let y = M + 960; y < M + 1000; y++) {
		assert.ok(firstOn(y) > 0, `no edge found on row ${y}`);
		maxJump = Math.max(maxJump, Math.abs(firstOn(y + 1) - firstOn(y)));
	}
	// And it does move: the slope spans several template columns.
	assert.ok(firstOn(M + 960) - firstOn(M + 1000) >= 20);
	assert.ok(maxJump <= 4, `edge jumps ${maxJump} px between adjacent rows`);
});

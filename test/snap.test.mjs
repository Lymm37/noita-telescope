// js/snap.js: world-space draws snapped to whole device pixels, so images that
// share a world edge also share a device pixel edge (no hairline seams).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { snapDrawImage } from '../js/snap.js';

function mockCtx(a, e, d, f) {
	const calls = [];
	return {
		calls,
		getTransform: () => ({ a, b: 0, c: 0, d, e, f }),
		drawImage: (...args) => calls.push(args),
	};
}
const device = (ctx, [, , , , , dx, dy, dw, dh]) => {
	const m = ctx.getTransform();
	return [m.a * dx + m.e, m.d * dy + m.f, m.a * (dx + dw) + m.e, m.d * (dy + dh) + m.f];
};
const img = { width: 512, height: 256 };
const near = (v) => Math.abs(v - Math.round(v)) < 1e-6;

test('destination edges land on whole device pixels', () => {
	const ctx = mockCtx(0.0371, 13.37, 0.0371, -7.77);
	snapDrawImage(ctx, img, 1000.3, 505.1);
	snapDrawImage(ctx, img, 0, 0, 256, 128, 1000.3, 505.1, 256, 128);
	for (const call of ctx.calls) assert.ok(device(ctx, call).every(near));
});

test('adjacent tiles share their device edge', () => {
	const ctx = mockCtx(0.4137, 0.21, 0.4137, 0.63);
	snapDrawImage(ctx, img, 0, 0, 512, 256, 1536, 7168, 512, 256);
	snapDrawImage(ctx, img, 0, 0, 512, 256, 1536, 7424, 512, 256);
	const [a, b] = ctx.calls.map((c) => device(ctx, c));
	assert.equal(Math.round(a[3]), Math.round(b[1]));
});

test('a rect thinner than a device pixel is skipped', () => {
	const ctx = mockCtx(0.001, 0.2, 0.001, 0.2);
	snapDrawImage(ctx, img, 10, 10, 64, 64);
	assert.equal(ctx.calls.length, 0);
});

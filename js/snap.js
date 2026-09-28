// drawImage with its destination rect snapped to whole device pixels.
//
// Under the camera transform a world-space rect lands at fractional device
// coordinates, and the browser antialiases each partial edge pixel on its own.
// Two images meeting on a shared world edge then each cover that pixel only
// partly, and whatever was drawn behind shows through as a hairline seam (and
// a smoothed, scaled-up image fades its edge texels out over a whole screen
// pixel). Rounding both edges through the current transform -- which in this
// app is always axis-aligned scale + translate -- makes neighbours share an
// exact device pixel boundary.
//
// The rounded rect is mapped back into the caller's space rather than drawn
// under an identity transform, so there is no save/setTransform/restore per
// call. Accepts the 3-, 5- and 9-argument forms of drawImage.
export function snapDrawImage(ctx, img, ...args) {
	let sx = 0, sy = 0, sw, sh, dx, dy, dw, dh;
	if (args.length === 8) [sx, sy, sw, sh, dx, dy, dw, dh] = args;
	else if (args.length === 4) [dx, dy, dw, dh] = args;
	else [dx, dy] = args;
	if (dw === undefined) { dw = img.width; dh = img.height; }
	if (sw === undefined) { sw = img.width; sh = img.height; }
	const m = ctx.getTransform();
	if (m.b !== 0 || m.c !== 0 || m.a === 0 || m.d === 0) {
		ctx.drawImage(img, sx, sy, sw, sh, dx, dy, dw, dh);
		return;
	}
	const x0 = Math.round(m.a * dx + m.e), x1 = Math.round(m.a * (dx + dw) + m.e);
	const y0 = Math.round(m.d * dy + m.f), y1 = Math.round(m.d * (dy + dh) + m.f);
	if (x1 === x0 || y1 === y0) return;
	const wx = (x0 - m.e) / m.a, wy = (y0 - m.f) / m.d;
	ctx.drawImage(img, sx, sy, sw, sh, wx, wy, (x1 - m.e) / m.a - wx, (y1 - m.f) / m.d - wy);
}

import { getWorldCenter, getWorldSize } from "./utils.js";

const HAS_BACKGROUND = {0xff36d517: false, 0xff3d3e40: false, 0xff2dc010: true, 0xff33e311: true, 0xff48e311: false, 0xffad8111: false, 0xff7be311: false, 0xff008040: true, 0xffd57917: false, 0xffd56517: false, 0xff124445: false, 0xff24888a: false, 0xff1775d5: false, 0xff18a0d6: false, 0xffe861f0: false, 0xffa861ff: false, 0xff008000: false, 0xff0080a8: false, 0xffc00020: true, 0xff50eed7: true, 0xff14eed7: true, 0xff0da899: true, 0xff14e1d7: false, 0xff786c42: false, 0xff006c42: false, 0xff0046ff: false, 0xff775ddb: true, 0xff18d6d6: false, 0xffffa717: false, 0xff0000ff: false, 0xffffff00: false, 0xff808000: false, 0xffa08400: false, 0xff3d3d3d: true, 0xff684c4c: true, 0xffb8a928: true, 0xff3f3d3e: true, 0xff3d3e37: false, 0xff3d3e38: false, 0xff3d3e39: false, 0xff3d3e3a: false, 0xff3d3e3b: false, 0xff3d3e3c: false, 0xff3d3e3d: false, 0xff3d3e3e: false, 0xff3d3e3f: false, 0xff3d3e41: false, 0xff42244d: true, 0xff3c0f0a: false, 0xffd3e6f0: false, 0xff9c6c42: false, 0xffc02020: false, 0xffe1cd32: false, 0xff008080: true, 0xff018080: true, 0xff028080: true, 0xff208080: true, 0xff608080: false, 0xff204060: false, 0xff224060: true, 0xff214060: true, 0xff234060: true, 0xff408080: true, 0xff418080: true, 0xff428080: true, 0xff438080: true, 0xffe08080: false, 0xffc08080: true, 0xffc08082: true, 0xffff8080: true, 0xffff00ff: false, 0xff3d5a3d: false, 0xff3d5a4f: false, 0xff4118d6: false, 0xff3d5ab2: true, 0xff93cb5c: true, 0xff3d5a5b: true, 0xffff6a02: false, 0xff6dcba2: true, 0xff6dcb28: true, 0xff93cb4c: true, 0xff93cb4d: true, 0xff93cb4e: true, 0xff93cb4f: true, 0xff93cb5a: true, 0xff99cb4c: true, 0xff99cb4d: true, 0xff99cb4e: true, 0xff99cb4f: true, 0xff99cb5a: true, 0xff3d5a52: true, 0xff3d5a51: true, 0xff3d5a50: true, 0xfff0d517: true, 0xff5a9628: true, 0xff5a9629: false, 0xffcc9944: false, 0xfff7cf8d: true, 0xfff6cfad: false, 0xff968f5f: false, 0xff968f96: false, 0xffc88f5f: false, 0xff967f5f: false, 0xff167f5f: false, 0xff967f11: false, 0xffd6d8e3: false, 0xff77a5bd: false, 0xff1133f1: true, 0xff1158f1: true, 0xff1133f3: true, 0xff11a3fc: true, 0xff006b1e: true, 0xff3046c1: false, 0xff6ba04b: false, 0xff89a04b: false, 0xff726186: false, 0xff804169: false, 0xffffd100: false, 0xffffd101: false, 0xffffd102: false, 0xffffd103: false, 0xffffd104: false, 0xffffd105: false, 0xffffd106: false, 0xffffd107: false, 0xffffd108: false, 0xffffd109: false, 0xffffd110: false, 0xffffd111: false, 0xffbaa345: false, 0xff364d24: true, 0xff9e4302: false, 0xff085b77: true, 0xff39401a: true, 0xff39401b: true, 0xff39401c: true, 0xff39401d: true, 0xff157cb0: false, 0xff157cb5: false, 0xff157cb6: false, 0xff157cb7: false, 0xff157cb8: false, 0xff57cace: false, 0xff57dace: false, 0xff1f3b62: false, 0xff1f3b64: false, 0xff36d5c9: true, 0xff3f55d1: false, 0xff2e99d1: false, 0xff567cb0: false, 0xff9d99d1: false, 0xff375c00: false, 0xff4e5267: false, 0xff0a95a4: false, 0xff326655: false, 0xffe17e32: false, 0xff39a760: false, 0xff9d893d: false, 0xff796620: false, 0xffeba500: false, 0xff6db55a: true, 0xff6db55b: true, 0xff6db55c: true, 0xff6db55d: true, 0xff6db55e: true, 0xff6db55f: true, 0xff5f8fab: true, 0xff572828: false, 0xfffe0000: false, 0xffb70000: false, 0xffff00fe: false, 0xffff00fd: false, 0xffff00fc: false, 0xffff00fb: false};

export function getBackgroundMask(biomeMap) {
	let mask = [];
	for (let i = 0; i < biomeMap.length; i++) {
		let val = 0;
		if (HAS_BACKGROUND[biomeMap[i]]) val = 1;
		mask.push(val);
	}
	return mask;
}

const EyeMessageData = [
	{path: "./data/secret_messages/eye_message_E1.png"},
	{path: "./data/secret_messages/eye_message_W1.png"},
	{path: "./data/secret_messages/eye_message_E2.png"},
	{path: "./data/secret_messages/eye_message_W2.png"},
	{path: "./data/secret_messages/eye_message_E3.png"},
	{path: "./data/secret_messages/eye_message_W3.png"},
	{path: "./data/secret_messages/eye_message_E4.png"},
	{path: "./data/secret_messages/eye_message_W4.png"},
	{path: "./data/secret_messages/eye_message_E5.png"}
];
EyeMessageData.forEach(msg => {
	const img = new Image();
	img.src = msg.path;
	msg.imgElement = img; // Store the loaded image element for later use
});

// Reimplementing nolla PRNG because I'm just copying this from the binoculars
function prng_poro(r) {
	const hi = Math.floor(r / 127773);
	const lo = r - hi * 127773;
	let temp_r = 16807 * lo - 2836 * hi;
	if (temp_r <= 0) temp_r += 2147483647;
	return temp_r;
}

function getPWIndex(messageIndex) {
	return (messageIndex % 2 === 0) ? 1 : -1;
}

function convertChunkCoords(x, y, pwIndex, isNGP) {
	const worldSize = isNGP ? 64 : 70;
	const xOffset = 512*worldSize/2;
	const yOffset = 512 * 14;
	const finalX = pwIndex * 512 * worldSize + x * 512 - xOffset + 48;
	const finalY = y * 512 - yOffset + 64;
	return {x: finalX, y: finalY};
}

export function findEyeMessages(biomeMap, ws, ngp) {
	const backgroundMask = getBackgroundMask(biomeMap);
	const worldSize = (ngp > 0) ? 64 : 70; // or biomeMap.width
	let positionsEast = [];
	let positionsWest = [];
	let r = (ws) ^ 0xe4bc7e0;
	if (r >= 2147483647) {
		r *= 0.5;
		r = Math.floor(r);
	}
	r = prng_poro(r);
	let r08 = r;

	for (let messageIndex = 0; messageIndex < 9; messageIndex++) {
		const pwIndex = getPWIndex(messageIndex);
		if (pwIndex !== 1) continue; // Forgot about this
		
		for (let attempts = 0; attempts < 1000; attempts++) {
			let y = prng_poro(r08);
			let x = Math.floor(y * 4.656612875e-10 * worldSize);
			y = prng_poro(y);
			r08 = y;
			y = Math.floor(y * 4.656612875e-10 * 48); // Or biomeMap.height
			//console.log(`Message ${messageIndex}, attempt ${attempts}: Checking chunk (${x}, ${y})`);
			if (-1 < x && -1 < y && x < worldSize && y < 48) {
				r = r08;
				if (backgroundMask[y * worldSize + x] === 1) {
					const message = convertChunkCoords(x, y, pwIndex, ngp);
					message['imgElement'] = EyeMessageData[messageIndex].imgElement;
					positionsEast.push(message);
					r08 = r;
					break;
				}
			}
		}
	}
	for (let i = 0; i < 4; i++) {
		const newX = positionsEast[i].x - 2 * 512 * worldSize
		const message = {x: newX, y: positionsEast[i].y, imgElement: EyeMessageData[2*i + 1].imgElement};
		positionsWest.push(message);
	}

	//console.log("Eye messages found at:", {east: positionsEast, west: positionsWest});
	return {east: positionsEast, west: positionsWest};
}

export function renderEyeMessages(ctx, messages, pw, isNGP) {
	if (pw !== 1 && pw !== -1) return;
	for (const message of messages) {
		if (!message.imgElement || message.imgElement.naturalWidth === 0) continue; // Image not loaded yet
		// Draw white background to make it more readable
		ctx.fillStyle = 'rgba(255, 255, 255, 0.8)';
		let xPos = message.x + getWorldCenter(isNGP)*512 - pw * 512 * getWorldSize(isNGP);
		// Looks more natural without the background
		//ctx.fillRect(xPos - 10, message.y + 14*512 - 10, message.imgElement.width + 20, message.imgElement.height + 20);
		ctx.drawImage(message.imgElement, xPos, message.y + 14*512, message.imgElement.width, message.imgElement.height);
	}
}
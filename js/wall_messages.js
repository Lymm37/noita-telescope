import { getWorldCenter } from "./utils.js";

const SECRET_MESSAGES = [
	{ img: './data/secret_messages/boss_arena.png', x: 3425, y: 12650 },
	{ img: './data/secret_messages/boss_arena_under.png', x: 2976, y: 13692 },
	{ img: './data/secret_messages/boss_arena_under_right.png', x: 4238, y: 15055 },
	{ img: './data/secret_messages/completely_random.png', x: -5400, y: 21887 },
	{ img: './data/secret_messages/completely_random_2.png', x: 4256, y: 26954 },
	{ img: './data/secret_messages/fungal_caverns_1.png', x: 3419, y: 2652 },
	{ img: './data/secret_messages/holy_mountain_1.png', x: 1785, y: 1325 },
	{ img: './data/secret_messages/jungle_right.png', x: 2806, y: 6614 },
	{ img: './data/secret_messages/mountain_text.png', x: 700, y: -440 },
	{ img: './data/secret_messages/under_the_wand_cave.png', x: -4448, y: 4487 },
	{ img: './data/secret_messages/vault_inside.png', x: -2120, y: 8446 },
	{ img: './data/secret_messages/crypt_left.png', x: -4129, y: 10533 },
	{ img: './data/secret_messages/above_alchemist.png', x: -4913, y: 341 },
	{ img: './data/secret_messages/below_tree.png', x: -2048, y: 400 },
];
// Preload these images so they show up instantly when rendering the biome
SECRET_MESSAGES.forEach(msg => {
	const img = new Image();
	img.src = msg.img;
	msg.imgElement = img; // Store the loaded image element for later use
});

export function renderWallMessages(ctx, isNGP) {
	for (const secretMessage of SECRET_MESSAGES) {
		if (isNGP && (secretMessage.img === './data/secret_messages/above_alchemist.png' || secretMessage.img === './data/secret_messages/below_tree.png')) continue; // These two messages only appear in NG0
		// Draw white background to make it more readable
		ctx.fillStyle = 'rgba(255, 255, 255, 0.8)';
		if (secretMessage.y > 17000)
			ctx.fillRect(secretMessage.x + getWorldCenter(isNGP)*512 - 10, secretMessage.y + 14*512 - 10, secretMessage.imgElement.width + 20, secretMessage.imgElement.height + 20);
		ctx.drawImage(secretMessage.imgElement, secretMessage.x + getWorldCenter(isNGP)*512, secretMessage.y + 14*512, secretMessage.imgElement.width, secretMessage.imgElement.height);
	}
}
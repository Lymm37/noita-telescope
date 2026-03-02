import * as zip from "https://cdn.jsdelivr.net/npm/@zip.js/zip.js@2.8/index.min.js";

const availableZipBundles = [
	{ prefix: "data/pixel_scenes/", zipUrl: "data/pixel_scenes.zip" },
	{ prefix: "data/wang_tiles/", zipUrl: "data/wang_tiles.zip" }
];

const loadedZipBundles = {};

async function loadZipBundle(zipUrl) {
	if (loadedZipBundles[zipUrl]) {
		return loadedZipBundles[zipUrl];
	}
	const response = await fetch(zipUrl);
	const blob = await response.blob();
	const reader = new zip.ZipReader(new zip.BlobReader(blob));
	const zipBundle = (await reader.getEntries()).filter(entry => !entry.directory);
	loadedZipBundles[zipUrl] = zipBundle;
	return zipBundle;
}

export async function getFromZipFirst(url) {
	if (url.startsWith("./")) {
		url = url.substring(2);
	}
	for (const bundle of availableZipBundles) {
		if (url.startsWith(bundle.prefix)) {
			const zipBundle = await loadZipBundle(bundle.zipUrl);
			const relativePath = url.substring(bundle.prefix.length);
			// console.log(`Looking for ${relativePath} in ${bundle.zipUrl}`);
			const entry = zipBundle.find(e => {
				// console.log(`Checking entry: ${e.filename}`);
				return e.filename === relativePath;
			});
			if (entry) {
				return entry.getData(new zip.BlobWriter());
			}
		}
	}
	// console.log(`Not found in zip bundles, fetching from network: ${url}`);
	return fetch(url).then(response => response.blob());
}

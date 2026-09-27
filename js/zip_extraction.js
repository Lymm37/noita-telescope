// Lazy so Node can import this module without resolving the https URL.
let _zipPromise = null;
const loadZipLib = () => _zipPromise ??=
    import("https://cdn.jsdelivr.net/npm/@zip.js/zip.js@2.8/index.min.js");

const availableZipBundles = [
	{ prefix: "../data/pixel_scenes/", zipUrl: "../data/pixel_scenes.zip" },
	{ prefix: "../data/wang_tiles/", zipUrl: "../data/wang_tiles.zip" },
	{ prefix: "../data/biome_maps/", zipUrl: "../data/biome_maps.zip" },
	{ prefix: "../data/weather_gfx/", zipUrl: "../data/weather_gfx.zip" },
	{ prefix: "../data/backgrounds/", zipUrl: "../data/backgrounds.zip" },
];

const loadedZipBundles = {};

// Caches the promise, not the result, so concurrent loads share one fetch of the zip.
function loadZipBundle(zipUrl) {
	return loadedZipBundles[zipUrl] ??= (async () => {
		const zip = await loadZipLib();
		const dataUrl = new URL(zipUrl, import.meta.url);
		const response = await fetch(dataUrl);
		const blob = await response.blob();
		const reader = new zip.ZipReader(new zip.BlobReader(blob));
		return (await reader.getEntries()).filter(entry => !entry.directory);
	})().catch((err) => {
		delete loadedZipBundles[zipUrl];
		throw err;
	});
}

export async function getFromZipFirst(url) {
    const targetUrl = new URL(url, import.meta.url).href;
    for (const bundle of availableZipBundles) {
        const bundlePrefixUrl = new URL(bundle.prefix, import.meta.url).href;
        if (targetUrl.startsWith(bundlePrefixUrl)) {
            const zipBundle = await loadZipBundle(bundle.zipUrl);
            const relativePath = targetUrl.substring(bundlePrefixUrl.length);
            const entry = zipBundle.find(e => e.filename === relativePath);
            if (entry) {
				const zip = await loadZipLib();
                return entry.getData(new zip.BlobWriter());
            }
            // Worth a warning: the bundle is stale (tools/build_asset_zips.sh).
            console.warn(`${relativePath} missing from ${bundle.zipUrl}, fetching it on its own`);
            break;
        }
    }

	const dataUrl = new URL(url, import.meta.url);
	return fetch(dataUrl).then(response => response.blob());
}

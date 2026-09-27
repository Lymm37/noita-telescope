// Icons drawn from the packed sprite sheets (tools/build_icon_sheets.mjs) instead
// of one request per PNG. Each stays an <img>, so the classes that size, filter
// and position icons keep working: its src is a transparent pixel and the sheet
// is its background, scaled so one 16px cell fills the element. An icon the
// sheet lacks leaves the <img> blank, keeping its layout and its title.
import { ICON_SHEETS } from './icon_sheet_index.js';

const BLANK = 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7';

const indexByName = {};
// Resolved here, not by each page that shows an icon: CSS resolves a relative
// url() against the document.
const sheetUrl = {};
for (const [folder, sheet] of Object.entries(ICON_SHEETS)) {
	indexByName[folder] = new Map(sheet.names.map((name, i) => [name, i]));
	sheetUrl[folder] = new URL(`../${sheet.url}`, import.meta.url).href;
}

export function hasSheet(folder) {
	return folder in ICON_SHEETS;
}

// The CSS background showing `name` from `folder`'s sheet, or '' if it has none.
function sheetBackground(folder, name) {
	const i = indexByName[folder]?.get(name);
	if (i === undefined) return '';
	const { cell, icon, cols, width, height } = ICON_SHEETS[folder];
	// A background-position of p% lines up the image's p% point with the
	// element's, so the cell's offset is p * (sheet - element); with the sheet
	// scaled so `icon` px spans the element, that makes p = offset / (sheet - icon).
	const x = (i % cols) * cell + 1, y = Math.floor(i / cols) * cell + 1;
	const px = (x / (width - icon)) * 100, py = (y / (height - icon)) * 100;
	const sx = (width / icon) * 100, sy = (height / icon) * 100;
	return `url('${sheetUrl[folder]}') ${px}% ${py}% / ${sx}% ${sy}% no-repeat`;
}

// `attrs` is the rest of the tag, inserted verbatim (class, title, alt, ...).
export function iconImgHtml(folder, name, attrs = '') {
	return `<img ${attrs} src="${BLANK}" style="background: ${sheetBackground(folder, name)};">`;
}

// For an <img> element that already exists; also handles folders without a sheet.
export function setIconImg(img, folder, name) {
	if (!hasSheet(folder)) {
		img.src = `data/${folder}/${name}.png`;
		return;
	}
	img.src = BLANK;
	img.style.background = sheetBackground(folder, name);
}

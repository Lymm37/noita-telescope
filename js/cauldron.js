import { app } from "./app.js";
import { NollaPrng } from "./nolla_prng.js";
import { getDateAndTime } from "./utils.js";

const datetime = getDateAndTime();
const isLeapYear = (datetime.year % 4 === 0 && datetime.year % 100 !== 0) || (datetime.year % 400 === 0);
const cauldronDataUrl = new URL(`../data/secret_messages/cauldron_data${isLeapYear ? '_leap' : ''}.json`, import.meta.url);
const CAULDRON_CALENDAR = await fetch(cauldronDataUrl).then(res => res.json());

export async function getCauldronState() {
    const datetime = getDateAndTime();
    const isLeapYear = (datetime.year % 4 === 0 && datetime.year % 100 !== 0) || (datetime.year % 400 === 0);
	if (isLeapYear && datetime.month === 12) {
		return 2; // Yeah idk either
	}
	// This will break if the page isn't reloaded between new year and leap day, but that seems unrealistic so it's probably fine
	for (const entry of CAULDRON_CALENDAR) {
		if (parseInt(entry[0]) === datetime.month && parseInt(entry[1]) === datetime.day) {
			console.log(`Cauldron state for ${datetime.month}/${datetime.day}: ${entry[2]}`);
			return parseInt(entry[2]);
		}
	}
	return null;
}

export function getCauldronVariation() {
	const datetime = getDateAndTime();
	const seconds = datetime.hour * 3600 + datetime.minute * 60 + datetime.second;
	// Hack lol
	setTimeout(() => {
		app.draw();
	}, 1000);
	return parseInt(CAULDRON_CALENDAR[seconds%CAULDRON_CALENDAR.length][2]);
}
const fs = require("fs");
const { Command } = require("commander");
const coordinate_to_code = require("coordinate_to_country");
const code_to_country = require("country-code-lookup");
const nanospinner = require("nanospinner");

const SPINNER = nanospinner.createSpinner(`Processing your Google history...\n`).start();

// CLI argument parsing using commander
const program = new Command();
program
	.requiredOption("-y, --years <years>", "Comma-separated list of years or ranges (e.g., '2014,2016-2018')")
	.option("-i, --input <file>", "Input file name", "Timeline.json")
	.option("-o, --output <file>", "Output file name", "output.json")
	.option("-p, --preferred-country <country>", "Preferred country to prioritize when handling ambiguous locations");

program.parse(process.argv);

const options = program.opts();
const preferred_country = options.preferredCountry || null;

// This will be a history of days -> location
let history = {};

// Return today's date, in YYYY-MM-DD format
function today() {
	return new Date().toISOString().slice(0, 10);
}

function getAllDaysOfYear(year) {
	for (let month = 0; month < 12; month++) {
		const lastDayOfMonth = new Date(year, month + 1, 0).getDate();
		for (let day = 1; day <= lastDayOfMonth; day++) {
			let date = new Date(year, month, day).toISOString().slice(0, 10);
			history[date] = null;
		}
	}
}

// Given a date, lat, and lng, insert the date and location into history.
// Does some special handling for Puerto Rico locations which are unknown.
function insertHistory(date, lat, lng, expected_year) {
	if (date.slice(0, 4) != expected_year) return;
	if (lat == null || lng == null) return;

	SPINNER.update({ text: `Processing: ${date}` });
	SPINNER.spin();

	const code = coordinate_to_code(lat, lng);
	let country_object = null;
	if (code.length > 0) {
		// Multiple countries may be returned, in cases like Puerto Rico: `[ 'USA', 'PRI' ]`
		// We take the last one by default.
		country_object = code_to_country.byIso(code.pop());
	}

	let country = country_object ? country_object.country : "Unknown";
	let record = { date, country, lat, lng, guess: false };

	if (preferred_country && preferred_country !== record.country) {
		if (history[date] && history[date].country === preferred_country) {
			// If there is already some history in the preferred country,
			// do not overwrite it with non-preferred countries. This is a guess.
			history[date].guess = true;
			return;
		}
	}

	history[date] = record;
}

function parseLatLng(latLngStr) {
	const [latStr, lngStr] = latLngStr.split(", ");
	const lat = parseFloat(latStr.replace("°", "").trim());
	const lng = parseFloat(lngStr.replace("°", "").trim());
	return { lat, lng };
}

// Main function. Parses all the location history for a year.
function parseYear(timeline, year) {
	getAllDaysOfYear(year);

	for (const object of timeline.semanticSegments) {
		// Google has two types of timeline objects:
		// 1. visit
		// 2. activity
		//
		// Both of these have "start" and "end" information.
		// The way this is programmed, we will prefer "end" information.
		if (object.hasOwnProperty("visit")) {
			let place = object.visit;
			let topCandidate = place.topCandidate;
			let { lat, lng } = parseLatLng(topCandidate.placeLocation.latLng);

			let start_date = object.startTime.slice(0, 10);
			insertHistory(start_date, lat, lng, year);

			let end_date = object.endTime.slice(0, 10);
			insertHistory(end_date, lat, lng, year);
		} else if (object.hasOwnProperty("activity")) {
			let activity = object.activity;
			let start_date = object.startTime.slice(0, 10);
			let { start_lat, start_lng } = parseLatLng(activity.start.latLng);
			insertHistory(start_date, start_lat, start_lng, year);

			let end_date = object.endTime.slice(0, 10);
			let { end_lat, end_lng } = parseLatLng(activity.end.latLng);
			insertHistory(end_date, end_lat, end_lng, year);
		}
	}
}

// This logic handles what to do with days which did not generate a history.
//
// If you don't move much, google wont track any `timelineObjects`. So instead
// we will assume you are in the last spot you were tracked. All of these days
// will have `guess = true`.
//
// Days which have not yet happened will be removed from the list.
function handleMissingDays() {
	let lastDay = Object.values(history)[0];
	for (const [day, value] of Object.entries(history)) {
		if (day > today()) {
			delete history[day];
		} else {
			if (value == null && lastDay != null) {
				history[day] = { ...lastDay };
				history[day].guess = true;
			}
			lastDay = history[day];
		}
	}
}

// Converts a string representing a range of years: "2014,2016-2018,2022"
// into an array containing all the implied years: `[2014, 2016, 2017, 2018, 2022]`
function parseYears(yearsString) {
	const yearRanges = yearsString.split(",");
	const years = [];
	for (const range of yearRanges) {
		if (range.includes("-")) {
			const [startYear, endYear] = range.split("-").map(Number);
			for (let year = startYear; year <= endYear; year++) {
				years.push(year);
			}
		} else {
			years.push(Number(range));
		}
	}
	return years;
}

function main() {
	let timeline;
	try {
		let rawData = fs.readFileSync(options.input);
		timeline = JSON.parse(rawData);
	} catch (error) {
		console.error(`Failed to read or parse the input file: ${error.message}`);
		process.exit(1);
	}

	const years = parseYears(options.years);

	for (const year of years) {
		parseYear(timeline, year);
	}
	SPINNER.success({ text: "Processing Complete!" });

	handleMissingDays();

	let country_counter = {};
	if (years.length > 1) {
		country_counter["total"] = {};
	}
	for (const year of years) {
		country_counter[year] = {};
	}
	let missing = [];
	let guessed = [];

	for (const [day, value] of Object.entries(history)) {
		let year = day.slice(0, 4);
		if (value == null) {
			missing.push(day);
			continue;
		}
		if (value.guess) {
			guessed.push(day);
		}
		if (years.length > 1) {
			if (country_counter["total"][value.country]) {
				country_counter["total"][value.country] += 1;
			} else {
				country_counter["total"][value.country] = 1;
			}
		}

		if (country_counter[year][value.country]) {
			country_counter[year][value.country] += 1;
		} else {
			country_counter[year][value.country] = 1;
		}
	}
	console.log(country_counter);
	console.log({
		days_in_year: Object.keys(history).length,
		days_missing: missing.length,
		days_guessed: guessed.length,
	});

	let outputData = JSON.stringify(history, null, 2);
	try {
		fs.writeFileSync(options.output, outputData);
		console.log(`Location history saved to ${options.output}`);
	} catch (error) {
		console.error(`Failed to write the output file: ${error.message}`);
	}
}

main();

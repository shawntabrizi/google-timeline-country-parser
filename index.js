const fs = require('fs');
const coordinate_to_code = require("coordinate_to_country");
const code_to_country = require('country-code-lookup');
const nanospinner = require('nanospinner');
const preferred_country = null;

const SPINNER = nanospinner.createSpinner(`Processing your Google history...`).start();
const MONTHS = ["JANUARY", "FEBRUARY", "MARCH", "APRIL", "MAY", "JUNE", "JULY", "AUGUST", "SEPTEMBER", "OCTOBER", "NOVEMBER", "DECEMBER"];

// Copy the google timeline folder to this project directory.
const BASE_LOCATION = "./Takeout/Location History (Timeline)/Semantic Location History";

// This will be a history of days -> location
let history = {};

// Return today's date, in YYYY-MM-DD format
function today() {
	return (new Date()).toISOString().slice(0, 10);
}

// Here we can fill the history with every day in the year,
// so we can catch the days there is no information.
function getAllDaysOfYear(year) {
	for (let month = 0; month < 12; month++) {
		const lastDayOfMonth = new Date(year, month + 1, 0).getDate();
		for (let day = 1; day < lastDayOfMonth + 1; day++) {
			let date = (new Date(year, month, day)).toISOString().slice(0, 10);
			history[date] = null;
		}
	}
}

// Given a date, lat, and lng, insert the date and location into history.
// Does some special handling for Puerto Rico locations which are unknown.
function insertHistory(date, lat, lng, expected_year) {

	console.log({ date, lat, lng, expected_year})
	if (date.slice(0, 4) != expected_year) { return; }
	if (lat == null || lng == null) { return; }

	SPINNER.update({ text: `Processing: ${date}` });
	SPINNER.spin();

	// This represents if something in the list isn't known for sure.
	let guess = false;

	const code = coordinate_to_code(lat, lng);
	let country_object = null;
	if (code.length > 0) {
		// Multiple countries may be returned, in cases like Puerto Rico: `[ 'USA', 'PRI' ]`
		// We take the last one by default.
		country_object = code_to_country.byIso(code.pop());
	}

	let country;
	if (country_object) {
		country = country_object.country;
	} else {
		country = "Unknown";
	}

	let record = { date, country, lat, lng, guess };

	if (preferred_country && preferred_country != record.country) {
		if (history[date] && history[date].country == preferred_country) {
			// If there is already some history in the preferred country,
			// do not overwrite it with non-preferred countries. This is a guess.
			history[date].guess = true;
			return;
		}
	}

	history[date] = record;
}

function parseLatLng(latLngStr) {
	// Split the string into latitude and longitude
	const [latStr, lngStr] = latLngStr.split(', ');

	// Parse latitude and longitude into numbers
	const lat = parseFloat(latStr.replace('°', '').trim());
	const lng = parseFloat(lngStr.replace('°', '').trim());

	return { lat, lng };
}

// Main function. Parses all the location history for a year.
function parseYear(year) {
	getAllDaysOfYear(year);

		let file_path = `Timeline.json`;

		let rawdata = fs.readFileSync(file_path);
		let locations = JSON.parse(rawdata);

		for (const object of locations.semanticSegments) {
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
			} else {
				//console.error("unknown google object type", { object })
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
	const yearRanges = yearsString.split(',');
	const years = [];

	for (const range of yearRanges) {
		if (range.includes('-')) {
			const [startYear, endYear] = range.split('-').map(Number);
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
	let years_string = process.argv[2];

	if (!years_string) {
		console.error("ERROR: Please tell me which year(s) you want to parse.")
		return
	}

	let years = parseYears(years_string);

	for (const year of years) {
		parseYear(year)
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

	let output = JSON.stringify(history, null, 2);

	fs.writeFileSync("output.json", output);
}

main();

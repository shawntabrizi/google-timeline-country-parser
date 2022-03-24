const fs = require('fs');
const crg = require('country-reverse-geocoding').country_reverse_geocoding();

const MONTHS = ["JANUARY", "FEBRUARY", "MARCH", "APRIL", "MAY", "JUNE", "JULY", "AUGUST", "SEPTEMBER", "OCTOBER", "NOVEMBER", "DECEMBER"];

// Copy the google timeline folder to this project directory.
const BASE_LOCATION = "./Takeout/Location History/Semantic Location History";

// This will be a history of days -> location
let history = {};

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

// Given a date, lat, and lon, insert the date and location into history.
// Does some special handling for Puerto Rico locations which are unknown.
function insertHistory(date, lat, lon, expected_year) {
	if (date.slice(0, 4) != expected_year) { return; }

	// This represents if something in the list isn't known for sure.
	let guess = false;

	// Google uses lat and lon multiplied by 10^7
	let e7 = 10000000;
	lat = lat / e7;
	lon = lon / e7;

	let country = crg.get_country(lat, lon)
	if (country) {
		country = country.name;
	} else {
		// Pretty sure this is Culebra.
		if (lat > 18 && lat < 18.5 && lon > -66.1 && lon < -65) {
			country = "Puerto Rico";
			guess = true;
		} else {
			country = "Unknown";
		}
	}

	let record = { date, country, lat, lon, guess };
	history[date] = record;
}

// Main function. Parses all the location history for a year.
function parseYear(year) {
	getAllDaysOfYear(year);

	for (month of MONTHS) {
		let file_path = `${BASE_LOCATION}/${year}/${year}_${month}.json`;
		if (!fs.existsSync(file_path)) { continue; }

		let rawdata = fs.readFileSync(file_path);
		let locations = JSON.parse(rawdata);

		for (const object of locations.timelineObjects) {
			// Google has two types of timeline objects:
			// 1. placeVisit
			// 2. activitySegment
			//
			// Both of these have "start" and "end" information.
			// The way this is programmed, we will prefer "end" information.
			if (object.hasOwnProperty("placeVisit")) {
				let place = object.placeVisit;
				let lat = place.location.latitudeE7;
				let lon = place.location.longitudeE7;

				let start_date = place.duration.startTimestamp.slice(0, 10);
				insertHistory(start_date, lat, lon, year);

				let end_date = place.duration.endTimestamp.slice(0, 10);
				insertHistory(end_date, lat, lon, year);
			} else {
				let activity = object.activitySegment;
				let start_date = activity.duration.startTimestamp.slice(0, 10);
				let start_lat = activity.startLocation.latitudeE7;
				let start_lon = activity.startLocation.longitudeE7;
				insertHistory(start_date, start_lat, start_lon, year);

				let end_date = activity.duration.endTimestamp.slice(0, 10);
				let end_lat = activity.endLocation.latitudeE7;
				let end_lon = activity.endLocation.longitudeE7;
				insertHistory(end_date, end_lat, end_lon, year);
			}
		}
	}
}

// If you don't move much, google wont track any `timelineObjects`. So instead
// we will assume you are in the last spot you were tracked.
//
// All of these days will have `guess = true`.
function fillMissingDays() {
	let lastDay = Object.values(history)[0];
	for (const [day, value] of Object.entries(history)) {
		if (value == null && lastDay != null) {
			history[day] = lastDay;
			history[day].guess = true;
		}

		lastDay = history[day];
	}
}

function main() {
	for (year of [2021]) {
		parseYear(year)
	}

	fillMissingDays();

	let counter = {};
	for (const [day, value] of Object.entries(history)) {
		if (value == null) {
			console.log(`Missing: ${day}`);
			continue;
		}
		if (counter[value.country]) {
			counter[value.country] += 1;
		} else {
			counter[value.country] = 1;
		}
	}
	console.log(counter);
	console.log(`Total Days: ${Object.keys(history).length}`);

	let output = JSON.stringify(history, null, 2);

	fs.writeFileSync("output.json", output);
}

main();

// Populate this with locations that should assist the results from the reverse
// geocoding library.
//
// Provide a square of latitude and longitude values where you want to override.
const customLocations = {
	// The whole island
	"Puerto Rico": {
		lat1: 17.8,
		lat2: 18.6,
		lng1: -67.5,
		lng2: -65.1,
	},
	// Edge of Rovinj
	"Croatia": {
		lat1: 45.0952677,
		lat2: 45.0552677,
		lng1: 13.6214077,
		lng2: 13.6514077,
	},
	// Edge of California
	"United States of America": {
		lat1: 36.2510416,
		lat2: 38.2510416,
		lng1: -120.7834097,
		lng2: -122.7834097,
	},
	// Tenerife
	"Spain": {
		lat1: 28.6039895,
		lat2: 28.00039895,
		lng1: -16.9307323,
		lng2: -15.9307323,
	}
};

function get_custom_country(lat, lng) {
	for (const [country, loc] of Object.entries(customLocations)) {
		const [lat_small, lat_large] = loc.lat1 < loc.lat2 ? [loc.lat1, loc.lat2] : [loc.lat2, loc.lat1];
		const [lng_small, lng_large] = loc.lng1 < loc.lng2 ? [loc.lng1, loc.lng2] : [loc.lng2, loc.lng1];

		if (lat >= lat_small && lat <= lat_large && lng >= lng_small && lng <= lng_large) {
			return country
		}
	}

	// no match found
	return null
}

module.exports = { get_custom_country, customLocations };

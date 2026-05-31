"use strict"

// ── Shared map data ───────────────────────────────────────────────
//
// Single source of truth for map geometry, loaded by both:
//   rules.js  — const { MAPS, get_terrain, hex_label } = require("./map.js")
//   play.js   — via <script src="map.js"> (lands as globals)
//
// To add a second map:
//   1. Add an entry to MAPS with the same shape as "gold".
//   2. Add exports.options in rules.js:
//        exports.options = () => [{ name:"map", label:"Map", items: Object.keys(MAPS) }]
//   3. The RTT lobby will show the dropdown automatically.

const MAPS = {
	gold: {
		name: "Gold",
		road_track_start: 25,
		rows: [
			{ offset: 7, count: 4,  city: [],    river: [2],   mountain: [],    desert: [] },
			{ offset: 7, count: 4,  city: [0],   river: [2],   mountain: [],    desert: [] },
			{ offset: 5, count: 6,  city: [],    river: [3],   mountain: [],    desert: [5] },
			{ offset: 5, count: 6,  city: [],    river: [3],   mountain: [],    desert: [5] },
			{ offset: 4, count: 7,  city: [0],   river: [2,3], mountain: [],    desert: [5,6] },
			{ offset: 3, count: 8,  city: [],    river: [3],   mountain: [],    desert: [6,7] },
			{ offset: 2, count: 9,  city: [],    river: [3],   mountain: [],    desert: [6,7,8] },
			{ offset: 2, count: 9,  city: [],    river: [2,3], mountain: [],    desert: [6,7,8] },
			{ offset: 1, count: 10, city: [],    river: [2],   mountain: [6],   desert: [7,8,9] },
			{ offset: 1, count: 10, city: [3,9], river: [2],   mountain: [6],   desert: [7,8] },
			{ offset: 0, count: 11, city: [],    river: [2],   mountain: [5,6], desert: [8,9,10] },
			{ offset: 1, count: 10, city: [0],   river: [1],   mountain: [5],   desert: [7,8,9] },
			{ offset: 0, count: 11, city: [],    river: [2],   mountain: [5],   desert: [7,8,9,10] },
			{ offset: 1, count: 10, city: [3],   river: [2],   mountain: [4],   desert: [7,8,9] },
			{ offset: 0, count: 11, city: [],    river: [2],   mountain: [5,6], desert: [7,8,9,10] },
			{ offset: 1, count: 10, city: [9],   river: [2],   mountain: [5],   desert: [6,7,8] },
			{ offset: 0, count: 11, city: [],    river: [3],   mountain: [6],   desert: [7,8,9,10] },
		],
		player_row_skip: { 3: 5, 4: 3, 5: 0 },
	},
	granite: {
		name: "Granite",
		road_track_start: 25,
		// Rows Q(r=0) … A(r=16), top to bottom.
		// Cities: Q11, O19, N10, M15, K5, B12
		rows: [
			{ offset: 1, count: 7,  city: [4],   river: [],    mountain: [],    desert: [] }, // Q
			{ offset: 1, count: 9,  city: [],    river: [],    mountain: [],    desert: [] }, // P
			{ offset: 1, count: 9,  city: [8],   river: [],    mountain: [],    desert: [] }, // O
			{ offset: 2, count: 8,  city: [3],   river: [],    mountain: [],    desert: [] }, // N
			{ offset: 1, count: 8,  city: [6],   river: [],    mountain: [],    desert: [] }, // M
			{ offset: 2, count: 7,  city: [],    river: [],    mountain: [],    desert: [] }, // L
			{ offset: 2, count: 6,  city: [0],   river: [],    mountain: [],    desert: [] }, // K
			{ offset: 3, count: 6,  city: [],    river: [],    mountain: [],    desert: [] }, // J
			{ offset: 3, count: 5,  city: [],    river: [],    mountain: [],    desert: [] }, // I
			{ offset: 4, count: 5,  city: [],    river: [],    mountain: [],    desert: [] }, // H
			{ offset: 3, count: 6,  city: [],    river: [],    mountain: [],    desert: [] }, // G
			{ offset: 5, count: 4,  city: [],    river: [],    mountain: [],    desert: [] }, // F
			{ offset: 5, count: 3,  city: [],    river: [],    mountain: [],    desert: [] }, // E
			{ offset: 5, count: 4,  city: [],    river: [],    mountain: [],    desert: [] }, // D
			{ offset: 5, count: 3,  city: [],    river: [],    mountain: [],    desert: [] }, // C
			{ offset: 6, count: 3,  city: [0],   river: [],    mountain: [],    desert: [] }, // B
			{ offset: 6, count: 2,  city: [],    river: [],    mountain: [],    desert: [] }, // A
		],
		player_row_skip: {},
	},
}

// Returns the terrain type string for hex (r, c) on a given map.
function get_terrain(map, r, c) {
	const rd = map.rows[r]
	if (rd.city.includes(c))     return "city"
	if (rd.river.includes(c))    return "river"
	if (rd.mountain.includes(c)) return "mountain"
	if (rd.desert.includes(c))   return "desert"
	return "plain"
}

// Returns the 18xx-style alphanumeric label for hex (r, c) on a given map.
// Letters are anchored to the FULL map (map.rows.length, not the visible row
// count). Index r=0 is the bottom-of-screen row and gets the highest letter;
// in the full map the top-of-screen row (highest index) is "A". Because
// player_row_skip hides rows from the top (high indices), anchoring to the
// full count keeps every remaining hex's coordinate stable across 3P/4P/5P.
function hex_label(map, r, c) {
	const gc  = c + map.rows[r].offset
	const col = 2 * gc + (r % 2 === 0 ? 1 : 0)
	return String.fromCharCode(65 + (map.rows.length - 1 - r)) + col
}

// ── Export ────────────────────────────────────────────────────────
// Node (rules.js): const { MAPS, get_terrain, hex_label } = require("./map.js")
// Browser (play.js): MAPS, get_terrain, hex_label land as globals via <script>

if (typeof module !== "undefined")
	module.exports = { MAPS, get_terrain, hex_label }

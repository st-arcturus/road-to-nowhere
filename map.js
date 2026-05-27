"use strict"

// ── Shared map data ───────────────────────────────────────────────
//
// Single source of truth for map geometry, loaded by both:
//   rules.js  — const { MAPS, get_terrain, hex_label } = require("./map.js")
//   play.js   — via <script src="map.js"> (lands as globals)
//
// To add a second map:
//   1. Add an entry to MAPS with the same shape as "default".
//   2. Add exports.options in rules.js:
//        exports.options = () => [{ name:"map", label:"Map", items: Object.keys(MAPS) }]
//   3. The RTT lobby will show the dropdown automatically.

const MAPS = {
	default: {
		name: "Standard",
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
// Row letters count from the bottom of the full 5P map so coordinates
// remain stable regardless of how many rows are hidden for 3P/4P.
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

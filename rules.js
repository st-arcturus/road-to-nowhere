"use strict"

// ── Constants ──────────────────────────────────────────────────────

const COMPANY_DEFS = [
	{ key: "hovering", name: "Hovering Highways" },
	{ key: "muddy",    name: "Muddy Machinery" },
	{ key: "scuttle",  name: "Scuttle Surveyors" },
	{ key: "whooping", name: "Whooping Workzone" },
	{ key: "buzzing",  name: "Buzzing Blacktop" },
	{ key: "coiled",   name: "Coiled Construction" },
]

const ROAD_TRACK_START = 25

const MAP = {
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
}

// ── Scenarios & Roles ─────────────────────────────────────────────

exports.scenarios = [ "3P", "4P", "5P" ]

exports.roles = function (scenario) {
	const n = { "3P": 3, "4P": 4, "5P": 5 }[scenario]
	return Array.from({ length: n }, (_, i) => `P${i + 1}`)
}

// ── Module-level game variable ────────────────────────────────────

let game

function load_game(state) {
	game = state
}

function save_game() {
	return game
}

// ── Seeded PRNG ───────────────────────────────────────────────────

function random(n) {
	game.seed = game.seed * 200105 % 34359738337
	return game.seed % n
}

function shuffle(arr) {
	for (let i = arr.length - 1; i > 0; i--) {
		let j = random(i + 1)
		let tmp = arr[j]
		arr[j] = arr[i]
		arr[i] = tmp
	}
}

// ── Role / index utilities ────────────────────────────────────────

function role_to_idx(role) {
	return parseInt(role.slice(1)) - 1
}

// ── Map helpers ───────────────────────────────────────────────────

function get_terrain(r, c) {
	const rd = MAP.rows[r]
	if (rd.city.includes(c))     return "city"
	if (rd.river.includes(c))    return "river"
	if (rd.mountain.includes(c)) return "mountain"
	if (rd.desert.includes(c))   return "desert"
	return "plain"
}

function build_nb_map(num_players) {
	const skip = MAP.player_row_skip[num_players] || 0
	const max_r = MAP.rows.length - skip
	const hex_map = {}
	for (let r = 0; r < max_r; r++)
		for (let c = 0; c < MAP.rows[r].count; c++)
			hex_map[`${r}_${c}`] = true
	const nb = {}
	for (let r = 0; r < max_r; r++) {
		const rd = MAP.rows[r]
		for (let c = 0; c < rd.count; c++) {
			const id = `${r}_${c}`, gc = c + rd.offset, nbs = []
			if (c > 0) nbs.push(`${r}_${c - 1}`)
			if (c < rd.count - 1) nbs.push(`${r}_${c + 1}`)
			const add_nr = nr => {
				if (nr < 0 || nr >= max_r) return
				const nrd = MAP.rows[nr]
				for (const dg of (r % 2 === 0 ? [0, 1] : [-1, 0])) {
					const ngc = gc + dg, nc = ngc - nrd.offset
					if (nc >= 0 && nc < nrd.count && hex_map[`${nr}_${nc}`])
						nbs.push(`${nr}_${nc}`)
				}
			}
			add_nr(r - 1)
			add_nr(r + 1)
			nb[id] = [...new Set(nbs)].filter(x => hex_map[x])
		}
	}
	return nb
}

// Cache by player count — deterministic, so safe to reuse across calls
const nb_cache = {}
function nb_map() {
	const pc = game.num_players
	if (!nb_cache[pc]) nb_cache[pc] = build_nb_map(pc)
	return nb_cache[pc]
}

// ── Game logic helpers ────────────────────────────────────────────

function build_cost(terrain) {
	return terrain === "mountain" ? 2 : 1
}

function turn_order() {
	return game.turn_track.filter(s => s.player !== null).map(s => s.player)
}

function active_company_indices() {
	return game.companies.map((_, i) => i).filter(i => game.companies[i].active)
}

function can_build(ci, hex_id) {
	const co = game.companies[ci]
	const hs = game.hex_state[hex_id]
	if (!hs) return { ok: false }
	if (hs.terrain === "city") {
		if (hs.roads.includes(ci)) return { ok: false, reason: "Already here" }
	} else {
		if (hs.roads.length >= 1) return { ok: false, reason: "Hex full" }
	}
	if (co.last_road === null) {
		if (hs.terrain !== "city") return { ok: false, reason: "First road must be in a city" }
	} else {
		if (!(nb_map()[co.last_road] || []).includes(hex_id))
			return { ok: false, reason: "Not adjacent to last road" }
		const other_nbs = (nb_map()[hex_id] || []).filter(
			nid => nid !== co.last_road && game.hex_state[nid]?.roads.includes(ci))
		if (other_nbs.length > 0)
			return { ok: false, reason: "Adjacent to another road of same company" }
	}
	if (hs.terrain === "river" && co.last_road !== null &&
			game.hex_state[co.last_road]?.terrain === "river")
		return { ok: false, reason: "No consecutive rivers" }
	if (hs.terrain === "desert" && co.treasury < 1)
		return { ok: false, reason: "Needs $1 in treasury" }
	if (co.road_track <= 0) return { ok: false, reason: "Road track empty" }
	return { ok: true }
}

function has_any_build(ci, bp) {
	return Object.keys(game.hex_state).some(hid => {
		const r = can_build(ci, hid)
		return r.ok && build_cost(game.hex_state[hid].terrain) <= bp
	})
}

// DFS to check whether the company can still reach a second city.
// Mirrors the HTML's canReachSecondCity exactly.
function can_reach_second_city(ci) {
	const co = game.companies[ci]
	if (co.last_road === null) return true
	const start_terrain = game.hex_state[co.last_road]?.terrain
	const path = new Set([co.last_road])
	function has_road(x) {
		return game.hex_state[x]?.roads.includes(ci) || path.has(x)
	}
	function dfs(hex_id, last_was_river) {
		for (const nid of (nb_map()[hex_id] || [])) {
			const nhs = game.hex_state[nid]
			if (!nhs) continue
			const t = nhs.terrain
			if (t === "city") {
				if (!co.built_in_city.includes(nid)) {
					const city_blocked = (nb_map()[nid] || []).some(x => x !== hex_id && has_road(x))
					if (!city_blocked) return true
				}
				continue
			}
			if (nhs.roads.length >= 1) continue
			if (t === "river" && last_was_river) continue
			if (path.has(nid)) continue
			if ((nb_map()[nid] || []).some(x => x !== hex_id && has_road(x))) continue
			path.add(nid)
			if (dfs(nid, t === "river")) return true
			path.delete(nid)
		}
		return false
	}
	return dfs(co.last_road, start_terrain === "river")
}

function deactivate(ci) {
	const co = game.companies[ci]
	if (!co.active) return
	co.active = false
	add_log(`${co.name} becomes inactive!`)
	const i = game.active_box.indexOf(ci)
	if (i !== -1) game.active_box.splice(i, 1)
	for (const s of game.turn_track) if (s.cube === ci) s.cube = null
}

function check_inactive(ci) {
	const co = game.companies[ci]
	if (!co.active) return
	if (co.built_in_city.length >= 2) { deactivate(ci); return }
	if (co.road_track <= 0)           { deactivate(ci); return }
	if (!can_reach_second_city(ci))   { deactivate(ci); return }
}

function check_all_inactive() {
	for (let i = 0; i < game.companies.length; i++) check_inactive(i)
}

function check_game_end() {
	if (game.companies.filter(c => c.active).length < 2) {
		game.phase = "game_end"
		compute_scores()
		return true
	}
	return false
}

function compute_scores() {
	add_log("=== GAME OVER ===")
	const share_value = ci => Math.ceil((ROAD_TRACK_START - game.companies[ci].road_track) / 2)
	const built_on_count = pi => {
		let n = 0
		for (let ci = 0; ci < game.companies.length; ci++) {
			game.companies[ci].claim_owners.forEach((owner, idx) => {
				if (owner === pi && (game.hex_state[game.companies[ci].claims[idx]]?.roads.length || 0) > 0)
					n++
			})
		}
		return n
	}
	const scores = game.players.map((p, pi) => {
		const shares = p.shares.reduce((s, ci) => s + share_value(ci), 0)
		let claims = 0
		for (let ci = 0; ci < game.companies.length; ci++) {
			const co = game.companies[ci]
			if (!co.claims.length) continue
			const mine = co.claim_owners.filter(o => o === pi).length
			if (mine > 0) claims += Math.ceil(co.treasury / co.claims.length) * mine
		}
		return { player: pi, cash: p.cash, shares, claims, total: p.cash + shares + claims }
	})
	scores.sort((a, b) => {
		if (b.total !== a.total) return b.total - a.total
		const as = game.players[a.player].shares.length
		const bs = game.players[b.player].shares.length
		if (as !== bs) return as - bs
		return built_on_count(a.player) - built_on_count(b.player)
	})
	game.final_scores = scores
	for (const s of scores) add_log(`P${s.player + 1}: $${s.total}`)
}

function add_log(msg) {
	game.log.push(msg)
	if (game.log.length > 200) game.log.splice(0, game.log.length - 200)
}

// ── Phase transitions ─────────────────────────────────────────────

function start_bid() {
	game.active_box = active_company_indices()
	const order = turn_order()
	for (const s of game.turn_track) {
		s.bottom_player = s.player
		s.player = null
		s.cube = null
	}
	game.phase = "bid"
	game.bid = { current_bid: 0, passed: [], active: [...order], bids: {} }
	game.active_player = order[0]
	add_log(`--- Round ${game.round}: Bid ---`)
}

function start_buy_shares() {
	game.active_box = active_company_indices()
	for (const s of game.turn_track) { s.bottom_player = null; s.cube = null }
	game.phase = "buy_shares"
	const order = turn_order()
	const eligible = order.filter(p => (game.bid.bids[p] || 0) > 0)
	for (const p of order) if (!eligible.includes(p)) game.players[p].last_bid = null
	game.buy_shares = { pending: [...eligible] }
	if (!eligible.length) { start_build_roads(); return }
	game.active_player = eligible[0]
	add_log(`--- Round ${game.round}: Buy Shares ---`)
}

function start_build_roads() {
	game.active_box = active_company_indices()
	for (const s of game.turn_track) { s.bottom_player = null; s.cube = null }
	game.phase = "build_roads"
	add_log(`--- Round ${game.round}: Build Roads ---`)
	const order = turn_order()
	game.build_roads = {
		state: "draft",
		draft_queue: [...order],
		current_company: null,
		build_queue: [],
		current_builder: null,
		build_points_remaining: 0,
		roads_built: 0,
	}
	if (!game.active_box.length || !order.length) { start_claim_land(); return }
	game.active_player = order[0]
}

function advance_draft() {
	const br = game.build_roads
	br.current_company = null
	br.current_builder = null
	br.state = "draft"
	br.draft_queue.shift()
	game.active_box = game.active_box.filter(ci => game.companies[ci].active)
	if (!br.draft_queue.length) {
		for (const ci of [...game.active_box]) check_inactive(ci)
		start_claim_land()
		return
	}
	if (!game.active_box.length) { start_claim_land(); return }
	game.active_player = br.draft_queue[0]
}

function next_builder() {
	const br = game.build_roads
	if (!br.build_queue.length) {
		check_all_inactive()
		advance_draft()
		return
	}
	const ci = br.current_company
	br.current_builder = br.build_queue.shift()
	const bp = game.players[br.current_builder].shares.filter(s => s === ci).length
	br.build_points_remaining = bp
	game.active_player = br.current_builder
	add_log(`${game.companies[ci].name}: P${br.current_builder + 1} (${bp} BP).`)
}

function has_valid_claim(player) {
	if (game.players[player].claims_left <= 0) return false
	return Object.values(game.hex_state).some(
		hs => hs.terrain !== "city" && hs.disc === null && hs.roads.length === 0)
}

function claim_advance() {
	while (game.claim_land.pending.length > 0) {
		const p = game.claim_land.pending[0]
		if (has_valid_claim(p)) break
		game.claim_land.pending.shift()
		const reason = game.players[p].claims_left <= 0 ? "no claims remaining" : "no valid hexes"
		add_log(`P${p + 1} auto-skipped (${reason}).`)
	}
	if (!game.claim_land.pending.length) { end_round(); return }
	game.active_player = game.claim_land.pending[0]
}

function start_claim_land() {
	// 7-share shutdown
	for (let ci = 0; ci < game.companies.length; ci++) {
		const co = game.companies[ci]
		if (co.active && co.shares.length >= 7) {
			add_log(`${co.name} shut down — all shares issued.`)
			deactivate(ci)
		}
	}
	if (check_game_end()) return
	// Stalemate: no roads built this phase
	if (game.build_roads.roads_built === 0) {
		add_log("No roads built this phase — game ends.")
		game.phase = "game_end"
		compute_scores()
		return
	}
	game.phase = "claim_land"
	game.claim_land = { pending: [...turn_order()] }
	add_log(`--- Round ${game.round}: Claim Land ---`)
	claim_advance()
}

function end_round() {
	game.round++
	add_log(`=== Round ${game.round} ===`)
	start_bid()
}

// ── Action handlers ───────────────────────────────────────────────

function do_initial_pick(player, action, arg) {
	if (player !== game.active_player) throw new Error("Not your turn")
	if (action !== "pick_share") throw new Error("Must pick a share")
	const ci = arg
	if (!game.active_box.includes(ci)) throw new Error("Company not available")
	if (game.players[player].shares.includes(ci)) throw new Error("Must pick a different company from your first")
	game.active_box.splice(game.active_box.indexOf(ci), 1)
	game.players[player].shares.push(ci)
	game.companies[ci].shares.push(player)
	const slot = game.turn_track.find(s => s.player === player)
	if (slot) slot.cube = ci
	add_log(`P${player + 1} picks ${game.companies[ci].name}.`)
	if (game.initial_share_pick_queue.length > 0) {
		game.active_player = game.initial_share_pick_queue.shift()
		add_log(`P${game.active_player + 1}: pick your second share.`)
	} else {
		add_log("All shares dealt!")
		start_bid()
	}
}

function do_bid(player, action, arg) {
	if (!game.bid.active.includes(player)) throw new Error("Not in bid")
	if (action === "pass") {
		game.bid.active.splice(game.bid.active.indexOf(player), 1)
		game.bid.passed.push(player)
		const slot_idx = game.turn_track.length - game.bid.passed.length
		if (slot_idx >= 0) {
			game.turn_track[slot_idx].player = player
			game.players[player].disc_on_track = slot_idx + 1
		}
		for (const s of game.turn_track) if (s.bottom_player === player) s.bottom_player = null
		add_log(`P${player + 1} passes.`)
		if (game.bid.active.length === 1) {
			const w = game.bid.active[0]
			game.turn_track[0].player = w
			game.players[w].disc_on_track = 1
			game.bid.bids[w] = game.bid.current_bid
			game.bid.active = []
			for (const s of game.turn_track) s.bottom_player = null
			add_log(`P${w + 1} wins 1st at $${game.bid.current_bid}.`)
			start_buy_shares()
			return
		}
		game.active_player = game.bid.active[0]
	} else if (action === "raise") {
		if (player !== game.bid.active[0]) throw new Error("Not your turn to raise")
		const amount = arg
		if (typeof amount !== "number" || amount <= game.bid.current_bid)
			throw new Error(`Must bid > $${game.bid.current_bid}`)
		if (amount > game.players[player].cash) throw new Error("Not enough cash")
		game.bid.current_bid = amount
		game.bid.bids[player] = amount
		game.players[player].last_bid = amount
		add_log(`P${player + 1} bids $${amount}.`)
		game.bid.active.splice(game.bid.active.indexOf(player), 1)
		game.bid.active.push(player)
		game.active_player = game.bid.active[0]
	} else {
		throw new Error("Unknown bid action: " + action)
	}
}

function do_buy(player, action, arg) {
	if (game.buy_shares.pending[0] !== player) throw new Error("Not your turn")
	if (action !== "buy") throw new Error("Buying is mandatory")
	if (!game.active_box.length) throw new Error("Active box empty")
	const ci = arg
	if (ci === undefined || !game.active_box.includes(ci)) throw new Error("Invalid company")
	const bid_amt = game.bid.bids[player] || 0
	const cost = game.players[player].disc_on_track === 1 ? bid_amt : Math.ceil(bid_amt / 2)
	if (game.players[player].cash < cost) throw new Error("Not enough cash")
	game.players[player].cash -= cost
	game.companies[ci].treasury += cost
	game.players[player].shares.push(ci)
	game.companies[ci].shares.push(player)
	game.active_box.splice(game.active_box.indexOf(ci), 1)
	game.buy_shares.pending.shift()
	game.players[player].last_bid = null
	add_log(`P${player + 1} buys ${game.companies[ci].name} for $${cost}.`)
	if (!game.buy_shares.pending.length || !game.active_box.length) {
		for (const p of game.buy_shares.pending) game.players[p].last_bid = null
		start_build_roads()
		return
	}
	game.active_player = game.buy_shares.pending[0]
}

function do_build_roads(player, action, arg) {
	const br = game.build_roads
	// Draft sub-phase: pick a company to activate
	if (br.state === "draft") {
		if (player !== br.draft_queue[0]) throw new Error("Not your turn to pick")
		if (action !== "pick_company") throw new Error("Must pick a company")
		const ci = arg
		if (!game.active_box.includes(ci)) throw new Error("Company not available")
		game.active_box.splice(game.active_box.indexOf(ci), 1)
		add_log(`P${player + 1} activates ${game.companies[ci].name}.`)
		check_inactive(ci)
		if (!game.companies[ci].active) { advance_draft(); return }
		const order = turn_order()
		const idx = order.indexOf(player)
		const wrapped = [...order.slice(idx), ...order.slice(0, idx)]
		const build_queue = wrapped.filter(p => game.players[p].shares.includes(ci))
		if (!build_queue.length) {
			add_log(`${game.companies[ci].name}: no shareholders this round, skipping build.`)
			advance_draft()
			return
		}
		br.current_company = ci
		br.build_queue = build_queue
		br.state = "building"
		next_builder()
		return
	}
	// Building sub-phase
	if (player !== br.current_builder) throw new Error("Not your turn to build")
	const ci = br.current_company
	const co = game.companies[ci]
	if (action === "pass_build") {
		if (has_any_build(ci, br.build_points_remaining))
			throw new Error("Must build — legal moves exist")
		add_log(`P${player + 1} done building.`)
		next_builder()
		return
	}
	if (action === "build") {
		const hex_id = arg
		const hs = game.hex_state[hex_id]
		if (!hs) throw new Error("Invalid hex")
		const chk = can_build(ci, hex_id)
		if (!chk.ok) throw new Error(chk.reason)
		const cost = build_cost(hs.terrain)
		if (br.build_points_remaining < cost) throw new Error(`Need ${cost} BP`)
		if (hs.terrain === "desert") co.treasury -= 1
		hs.roads.push(ci)
		co.last_road = hex_id
		co.road_track = Math.max(0, co.road_track - 1)
		br.build_points_remaining -= cost
		if (hs.terrain === "city" && !co.built_in_city.includes(hex_id))
			co.built_in_city.push(hex_id)
		if (hs.disc !== null) {
			co.claims.push(hex_id)
			co.claim_owners.push(hs.disc)
			add_log(`${co.name} builds on P${hs.disc + 1}'s claim!`)
			hs.disc = null
		}
		br.roads_built++
		add_log(`P${player + 1} builds ${co.name} at ${hex_id} (${hs.terrain}).`)
		check_all_inactive()
		if (!co.active) { advance_draft(); return }
		if (br.build_points_remaining === 0 || !has_any_build(ci, br.build_points_remaining)) {
			next_builder()
			return
		}
		return
	}
	throw new Error("Unknown build action: " + action)
}

function do_claim(player, action, arg) {
	if (game.claim_land.pending[0] !== player) throw new Error("Not your turn")
	if (action !== "claim") throw new Error("Claiming is mandatory — pick a hex")
	const hex_id = arg
	const hs = game.hex_state[hex_id]
	if (!hs)                          throw new Error("Invalid hex")
	if (hs.terrain === "city")        throw new Error("Cannot claim a city")
	if (hs.disc !== null)             throw new Error("Already claimed")
	if (hs.roads.length > 0)          throw new Error("Hex has a road")
	if (game.players[player].claims_left <= 0) throw new Error("No claims left")
	hs.disc = player
	game.players[player].claims_left--
	game.claim_land.pending.shift()
	add_log(`P${player + 1} claims ${hex_id}.`)
	claim_advance()
}

// ── exports.setup ─────────────────────────────────────────────────

exports.setup = function (seed, scenario, options) {
	const pc = { "3P": 3, "4P": 4, "5P": 5 }[scenario]
	const cc = pc + 1
	const starting_cash = { 3: 25, 4: 30, 5: 35 }[pc]
	const skip = MAP.player_row_skip[pc] || 0
	const max_r = MAP.rows.length - skip

	// Build hex state
	const hex_state = {}
	for (let r = 0; r < max_r; r++)
		for (let c = 0; c < MAP.rows[r].count; c++)
			hex_state[`${r}_${c}`] = { terrain: get_terrain(r, c), roads: [], disc: null }

	// Initialise game object (seed must be set before any shuffle calls)
	game = {
		seed,
		num_players: pc,
		round: 1,
		phase: "initial_share_pick",
		active_player: 0,
		initial_share_pick_queue: [],
		players: [],
		companies: [],
		active_box: [],
		turn_track: [],
		hex_state,
		bid: { current_bid: 0, passed: [], active: [], bids: {} },
		buy_shares: { pending: [] },
		build_roads: {
			state: "draft", draft_queue: [], current_company: null,
			build_queue: [], current_builder: null, build_points_remaining: 0, roads_built: 0,
		},
		claim_land: { pending: [] },
		log: [`Road to Nowhere — ${pc} players, ${cc} companies.`],
		final_scores: null,
	}

	// Cache nb_map before any shuffle (shuffle itself doesn't need it, but later helpers do)
	nb_cache[pc] = build_nb_map(pc)

	for (let i = 0; i < cc; i++)
		game.companies.push({
			key: COMPANY_DEFS[i].key,
			name: COMPANY_DEFS[i].name,
			road_track: ROAD_TRACK_START,
			treasury: 0,
			active: true,
			built_in_city: [],
			last_road: null,
			claims: [],
			claim_owners: [],
			shares: [],
		})

	for (let p = 0; p < pc; p++)
		game.players.push({
			cash: starting_cash,
			shares: [],
			disc_on_track: null,
			last_bid: null,
			claims_left: 10,
		})

	// Randomise initial turn order
	const init_order = Array.from({ length: pc }, (_, i) => i)
	shuffle(init_order)
	for (let i = 0; i < pc; i++) {
		game.turn_track.push({ player: init_order[i], cube: null, bottom_player: null })
		game.players[init_order[i]].disc_on_track = i + 1
	}

	// Deal one first share per player (direct assignment, not through active_box)
	const all_company_indices = Array.from({ length: cc }, (_, i) => i)
	shuffle(all_company_indices)
	const first_shares = all_company_indices.slice(0, pc)
	for (let i = 0; i < pc; i++) {
		const p = init_order[i], ci = first_shares[i]
		game.players[p].shares.push(ci)
		game.companies[ci].shares.push(p)
	}

	// Active box starts as ALL companies — second share picks can duplicate first
	// (the constraint is just "not the same company you already hold")
	game.active_box = Array.from({ length: cc }, (_, i) => i)

	// Pick queue for second shares is reverse of init_order
	const rev_order = [...init_order].reverse()
	game.active_player = rev_order[0]
	game.initial_share_pick_queue = rev_order.slice(1)

	add_log(`P${rev_order[0] + 1}: pick your second share.`)

	return save_game()
}

// ── exports.action ────────────────────────────────────────────────

exports.action = function (state, current, action, arg) {
	load_game(state)
	const player = role_to_idx(current)

	switch (game.phase) {
	case "initial_share_pick": do_initial_pick(player, action, arg); break
	case "bid":                do_bid(player, action, arg);          break
	case "buy_shares":         do_buy(player, action, arg);          break
	case "build_roads":        do_build_roads(player, action, arg);  break
	case "claim_land":         do_claim(player, action, arg);        break
	default: throw new Error("No actions available in phase: " + game.phase)
	}

	return save_game()
}

// ── exports.view ──────────────────────────────────────────────────

exports.view = function (state, current) {
	load_game(state)
	const player = role_to_idx(current)
	const br = game.build_roads
	const is_active = game.active_player === player

	const view = {
		prompt: null,
		phase: game.phase,
		round: game.round,
		active_player: game.active_player,
		companies: game.companies,
		players: game.players,
		active_box: game.active_box,
		turn_track: game.turn_track,
		hex_state: game.hex_state,
		build_roads: br,
		bid: game.bid,
		buy_shares: game.buy_shares,
		log: game.log,
		final_scores: game.final_scores,
	}

	if (game.phase === "game_end") {
		view.prompt = "Game over!"
		return view
	}

	if (!is_active) {
		view.prompt = `Waiting for P${game.active_player + 1}\u2026`
		return view
	}

	view.actions = {}

	if (game.phase === "initial_share_pick") {
		const held = game.players[player].shares
		const picks = game.active_box.filter(ci => !held.includes(ci))
		if (picks.length) view.actions.pick_share = picks
		view.prompt = "Pick your second share — must differ from your first."
	}

	else if (game.phase === "bid" && game.bid.active.includes(player)) {
		view.actions.pass = 1
		view.actions.raise = 1
		view.prompt = "Raise the bid to claim 1st position, or pass."
	}

	else if (game.phase === "buy_shares" && game.buy_shares.pending[0] === player) {
		if (game.active_box.length) view.actions.buy = [...game.active_box]
		view.prompt = "Pick a share from the active box. Buying is mandatory."
	}

	else if (game.phase === "build_roads") {
		if (br.state === "draft" && br.draft_queue[0] === player) {
			view.actions.pick_company = [...game.active_box]
			view.prompt = "Pick a company to activate. You will build first."
		} else if (br.state === "building" && br.current_builder === player) {
			const ci = br.current_company
			const bp = br.build_points_remaining
			if (ci !== null) {
				const buildable = Object.keys(game.hex_state).filter(hid => {
					const r = can_build(ci, hid)
					return r.ok && build_cost(game.hex_state[hid].terrain) <= bp
				})
				if (buildable.length) view.actions.build = buildable
			}
			if (!has_any_build(ci, br.build_points_remaining))
				view.actions.pass_build = 1
			view.prompt = `Building ${game.companies[br.current_company]?.name || ""}. ${br.build_points_remaining} BP left.`
		}
	}

	else if (game.phase === "claim_land" && game.claim_land.pending[0] === player) {
		const claimable = Object.keys(game.hex_state).filter(hid => {
			const hs = game.hex_state[hid]
			return hs.terrain !== "city" && hs.disc === null && hs.roads.length === 0
		})
		if (claimable.length) view.actions.claim = claimable
		view.prompt = "Click any highlighted hex to place your claim disc."
	}

	return view
}

// ── exports.resign ────────────────────────────────────────────────

exports.resign = function (state, current) {
	load_game(state)
	add_log(`${current} has resigned.`)
	game.phase = "game_end"
	compute_scores()
	return save_game()
}

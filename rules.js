"use strict"

// ── Constants ──────────────────────────────────────────────────────

const COMPANY_DEFS = [
	{ key: "hovering", name: "Hovering Highways" },
	{ key: "dusty",    name: "Dusty Digging" },
	{ key: "scuttle",  name: "Scuttle Surveyors" },
	{ key: "whooping", name: "Whooping Workzone" },
	{ key: "teeming",  name: "Teeming Transit" },
	{ key: "coiled",   name: "Coiled Construction" },
]

const { MAPS, get_terrain, hex_label } = require("./map.js")

// ── Scenarios & Roles ─────────────────────────────────────────────

const ROLE_NAMES = ["Blue", "Purple", "Magenta", "Orange", "Yellow"]

exports.scenarios        = ["Gold", "Granite"]
exports.default_scenario = "Gold"

const VALID_PLAYER_COUNTS = new Set([3, 4, 5])

exports.roles = function (scenario, options) {
	const pc = Number(options?.players) || 5
	if (!VALID_PLAYER_COUNTS.has(pc)) throw new Error(`Invalid player count: ${pc}`)
	return ROLE_NAMES.slice(0, pc)
}

// ── Module-level game variable ────────────────────────────────────

let game

function load_game(state) {
	game = state
}

function save_game() {
	game.active = game.phase === "game_end" ? "None" : ROLE_NAMES[game.active_player]
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

// ── Undo ──────────────────────────────────────────────────────────

function deep_copy(o) {
	if (typeof o !== "object" || o === null) return o
	if (Array.isArray(o)) return o.map(deep_copy)
	const r = {}
	for (let k in o) r[k] = deep_copy(o[k])
	return r
}

function push_undo() {
	let copy = {}
	for (let k in game) {
		let v = game[k]
		if (k === "undo") continue
		else if (k === "log") v = v.length
		else if (typeof v === "object" && v !== null) v = deep_copy(v)
		copy[k] = v
	}
	game.undo.push(copy)
}

function pop_undo() {
	let save_log = game.log
	let save_undo = game.undo
	game = save_undo.pop()
	save_log.length = game.log
	game.log = save_log
	game.undo = save_undo
}

function clear_undo() {
	game.undo = []
}

// Clears the undo stack whenever the active player changes, so players
// can only undo their own actions within their current turn.
function set_active_player(p) {
	if (game.active_player !== p)
		clear_undo()
	game.active_player = p
}

// ── Role / index utilities ────────────────────────────────────────

function role_to_idx(role) {
	const idx = ROLE_NAMES.indexOf(role)
	if (idx === -1) throw new Error("Unknown role: " + role)
	return idx
}

// ── Map helpers ───────────────────────────────────────────────────
//
// hex_label(map, r, c) and get_terrain(map, r, c) imported from map.js.

function game_map() { return MAPS[game.map_id] || MAPS.gold }

function build_nb_map(map, num_players) {
	const skip = map.player_row_skip[num_players] || 0
	const max_r = map.rows.length - skip
	const hex_map = {}
	for (let r = 0; r < max_r; r++)
		for (let c = 0; c < map.rows[r].count; c++)
			hex_map[`${r}_${c}`] = true
	const nb = {}
	for (let r = 0; r < max_r; r++) {
		const rd = map.rows[r]
		for (let c = 0; c < rd.count; c++) {
			const id = `${r}_${c}`, gc = c + rd.offset, nbs = []
			if (c > 0) nbs.push(`${r}_${c - 1}`)
			if (c < rd.count - 1) nbs.push(`${r}_${c + 1}`)
			const add_nr = nr => {
				if (nr < 0 || nr >= max_r) return
				const nrd = map.rows[nr]
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

// Cache by map ID + player count — deterministic, safe to reuse across calls
const nb_cache = {}
function nb_map() {
	const key = `${game.map_id}:${game.num_players}`
	if (!nb_cache[key]) nb_cache[key] = build_nb_map(game_map(), game.num_players)
	return nb_cache[key]
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
	const i = game.active_box.indexOf(ci)
	if (i !== -1) game.active_box.splice(i, 1)
	for (const s of game.turn_track) if (s.cube === ci) s.cube = null
}

function check_inactive(ci) {
	const co = game.companies[ci]
	if (!co.active) return
	if (co.built_in_city.length >= 2) {
		add_log(`${co.name} deactivated (reached a 2nd city).`)
		deactivate(ci); return
	}
	if (co.road_track <= 0) {
		add_log(`${co.name} deactivated (no roads left).`)
		deactivate(ci); return
	}
	if (!can_reach_second_city(ci)) {
		add_log(`${co.name} deactivated (cannot reach a 2nd city).`)
		deactivate(ci); return
	}
}

function check_all_inactive() {
	for (let i = 0; i < game.companies.length; i++) check_inactive(i)
}

function check_game_end() {
	if (game.companies.filter(c => c.active).length < 2) {
		add_log("Fewer than 2 companies active at end of Build Phase. Game over.")
		game.phase = "game_end"
		compute_scores()
		return true
	}
	return false
}

function compute_scores() {
	add_log("=== GAME OVER ===")
	const share_value = ci => Math.ceil((game_map().road_track_start - game.companies[ci].road_track) / 2)
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
	const top = scores[0]
	const top_shares = game.players[top.player].shares.length
	const top_built  = built_on_count(top.player)
	const tied = scores.filter(s =>
		s.total === top.total &&
		game.players[s.player].shares.length === top_shares &&
		built_on_count(s.player) === top_built
	)
	if (tied.length > 1) {
		game.result  = tied.map(s => ROLE_NAMES[s.player]).join(", ")
		game.victory = `${game.result} tie.`
	} else {
		game.result  = ROLE_NAMES[top.player]
		game.victory = `${game.result} wins.`
	}
	add_log(game.victory)
	for (const s of scores) add_log(`${ROLE_NAMES[s.player]}: $${s.total} ($${s.shares} in shares, $${s.claims} in claims, $${s.cash} in cash).`)
}

function add_log(msg) {
	game.log.push(msg)
}

// ── Phase transitions ─────────────────────────────────────────────

function start_bid() {
	clear_undo()
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
	add_log(`--- Round ${game.round}: Bid for Turn Order ---`)
}

function start_buy_shares() {
	clear_undo()
	game.active_box = active_company_indices()
	for (const s of game.turn_track) { s.bottom_player = null; s.cube = null }
	game.phase = "buy_shares"
	const order = turn_order()
	const eligible = order.filter(p => (game.bid.bids[p] || 0) > 0)
	for (const p of order) if (!eligible.includes(p)) game.players[p].last_bid = null
	game.buy_shares = { pending: [...eligible] }
	add_log(`--- Round ${game.round}: Buy Shares ---`)
	if (!eligible.length) { add_log("No players eligible to buy."); start_build_roads(); return }
	game.active_player = eligible[0]
}

function start_build_roads() {
	clear_undo()
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
	set_active_player(order[0])
}

function advance_draft() {
	const br = game.build_roads
	br.current_company = null
	br.current_builder = null
	br.build_points_remaining = 0
	br.state = "draft"
	br.draft_queue.shift()
	game.active_box = game.active_box.filter(ci => game.companies[ci].active)
	if (!br.draft_queue.length) {
		for (const ci of [...game.active_box]) check_inactive(ci)
		start_claim_land()
		return
	}
	if (!game.active_box.length) { start_claim_land(); return }
	set_active_player(br.draft_queue[0])
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
	add_log(`${game.companies[ci].name}: ${ROLE_NAMES[br.current_builder]} (${bp} BP).`)
	set_active_player(br.current_builder)
	if (!has_any_build(ci, bp)) game.waiting_end_turn = true
}

function advance_bid() {
	if (game.bid.active.length === 0) {
		start_buy_shares()
	} else {
		set_active_player(game.bid.active[0])
	}
}

function advance_buy() {
	if (!game.buy_shares.pending.length || !game.active_box.length) {
		for (const p of game.buy_shares.pending) game.players[p].last_bid = null
		start_build_roads()
	} else {
		set_active_player(game.buy_shares.pending[0])
	}
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
		add_log(`${ROLE_NAMES[p]} auto-skipped (${reason}).`)
	}
	if (!game.claim_land.pending.length) { end_round(); return }
	set_active_player(game.claim_land.pending[0])
}

function start_claim_land() {
	clear_undo()
	game.active_box = active_company_indices()
	for (const s of game.turn_track) { s.bottom_player = null; s.cube = null }
	// 7-share shutdown
	for (let ci = 0; ci < game.companies.length; ci++) {
		const co = game.companies[ci]
		if (co.active && co.shares.length >= 7) {
			add_log(`${co.name} deactivated (no shares left).`)
			deactivate(ci)
		}
	}
	if (check_game_end()) return
	// Stalemate: no roads built this phase
	if (game.build_roads.roads_built === 0) {
		add_log("No roads built in Build Phase. Game over.")
		game.phase = "game_end"
		compute_scores()
		return
	}
	game.phase = "claim_land"
	game.claim_land = { pending: [...turn_order()] }
	add_log(`--- Round ${game.round}: Claim Land ---`)
	claim_advance()
}

function advance_initial_pick() {
	if (game.initial_share_pick_queue.length > 0) {
		const next = game.initial_share_pick_queue.shift()
		set_active_player(next)
	} else {
		add_log("All shares dealt.")
		if (game.subsidies) {
			const per_share = 2 * game.num_players  // $2 per share per player
			for (const co of game.companies) {
				const amount = Math.max(0, 2 - co.shares.length) * per_share
				if (amount > 0) {
					co.treasury += amount
					add_log(`${co.name} receives $${amount} subsidy (${co.shares.length}/2 shares issued).`)
				}
			}
		}
		add_log(`=== Round ${game.round} ===`)
		start_bid()
	}
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
	push_undo()
	game.active_box.splice(game.active_box.indexOf(ci), 1)
	game.players[player].shares.push(ci)
	game.companies[ci].shares.push(player)
	const slot = game.turn_track.find(s => s.player === player)
	if (slot) slot.cube = ci
	add_log(`${ROLE_NAMES[player]} picks ${game.companies[ci].name}.`)
	game.waiting_end_turn = true
}

function do_bid(player, action, arg) {
	if (!game.bid.active.includes(player)) throw new Error("Not in bid")
	push_undo()
	if (action === "pass") {
		game.bid.active.splice(game.bid.active.indexOf(player), 1)
		game.bid.passed.push(player)
		const slot_idx = game.turn_track.length - game.bid.passed.length
		if (slot_idx >= 0) {
			game.turn_track[slot_idx].player = player
			game.players[player].disc_on_track = slot_idx + 1
		}
		for (const s of game.turn_track) if (s.bottom_player === player) s.bottom_player = null
		add_log(`${ROLE_NAMES[player]} passes.`)
		if (game.bid.active.length === 1) {
			const w = game.bid.active[0]
			game.turn_track[0].player = w
			game.players[w].disc_on_track = 1
			game.bid.bids[w] = game.bid.current_bid
			game.bid.active = []
			for (const s of game.turn_track) s.bottom_player = null
			add_log(`${ROLE_NAMES[w]} wins 1st at $${game.bid.current_bid}.`)
		}
		game.waiting_end_turn = true
	} else if (action === "raise") {
		if (player !== game.bid.active[0]) throw new Error("Not your turn to raise")
		const amount = arg
		if (typeof amount !== "number" || amount <= game.bid.current_bid)
			throw new Error(`Must bid > $${game.bid.current_bid}`)
		if (amount > game.players[player].cash) throw new Error("Not enough cash")
		game.bid.current_bid = amount
		game.bid.bids[player] = amount
		game.players[player].last_bid = amount
		add_log(`${ROLE_NAMES[player]} bids $${amount}.`)
		game.bid.active.splice(game.bid.active.indexOf(player), 1)
		game.bid.active.push(player)
		game.waiting_end_turn = true
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
	push_undo()
	game.players[player].cash -= cost
	game.companies[ci].treasury += cost
	game.players[player].shares.push(ci)
	game.companies[ci].shares.push(player)
	game.active_box.splice(game.active_box.indexOf(ci), 1)
	game.buy_shares.pending.shift()
	game.players[player].last_bid = null
	const buy_slot = game.turn_track.find(s => s.player === player)
	if (buy_slot) buy_slot.cube = ci
	add_log(`${ROLE_NAMES[player]} buys ${game.companies[ci].name} for $${cost}.`)
	game.waiting_end_turn = true
}

function do_build_roads(player, action, arg) {
	const br = game.build_roads
	// Draft sub-phase: pick a company to activate
	if (br.state === "draft") {
		if (player !== br.draft_queue[0]) throw new Error("Not your turn to pick")
		if (action !== "pick_company") throw new Error("Must pick a company")
		push_undo()
		const ci = arg
		if (!game.active_box.includes(ci)) throw new Error("Company not available")
		game.active_box.splice(game.active_box.indexOf(ci), 1)
		const draft_slot = game.turn_track.find(s => s.player === player)
		if (draft_slot) draft_slot.cube = ci
		add_log(`=co=${game.companies[ci].key}`)
		add_log(`${ROLE_NAMES[player]} activates ${game.companies[ci].name}.`)
		check_inactive(ci)
		if (!game.companies[ci].active) { game.waiting_end_turn = true; return }
		const order = turn_order()
		const idx = order.indexOf(player)
		const wrapped = [...order.slice(idx), ...order.slice(0, idx)]
		const build_queue = wrapped.filter(p => game.players[p].shares.includes(ci))
		if (!build_queue.length) {
			add_log(`${game.companies[ci].name}: no shareholders yet, skipping build.`)
			game.waiting_end_turn = true
			return
		}
		br.current_company = ci
		br.build_queue = build_queue
		br.state = "building"
		if (build_queue[0] === player) next_builder()
		else game.waiting_end_turn = true
		return
	}
	// Building sub-phase
	if (player !== br.current_builder) throw new Error("Not your turn to build")
	push_undo()
	const ci = br.current_company
	const co = game.companies[ci]
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
		br.roads_built++
		const [hr, hc] = hex_id.split("_").map(Number)
		add_log(`${ROLE_NAMES[player]} builds ${co.name} at ${hex_label(game_map(), hr, hc)} (${hs.terrain}).`)
		if (hs.disc !== null) {
			co.claims.push(hex_id)
			co.claim_owners.push(hs.disc)
			add_log(`${co.name} builds on ${ROLE_NAMES[hs.disc]}'s claim.`)
			hs.disc = null
		}
		check_all_inactive()
		if (!co.active) { game.waiting_end_turn = true; return }
		if (br.build_points_remaining === 0 || !has_any_build(ci, br.build_points_remaining)) {
			game.waiting_end_turn = true
			return
		}
		return
	}
	throw new Error("Unknown build action: " + action)
}

function do_claim(player, action, arg) {
	if (game.claim_land.pending[0] !== player) throw new Error("Not your turn")
	if (action !== "claim") throw new Error("Claiming is mandatory. Pick a hex.")
	const hex_id = arg
	const hs = game.hex_state[hex_id]
	if (!hs)                          throw new Error("Invalid hex")
	if (hs.terrain === "city")        throw new Error("Cannot claim a city")
	if (hs.disc !== null)             throw new Error("Already claimed")
	if (hs.roads.length > 0)          throw new Error("Hex has a road")
	if (game.players[player].claims_left <= 0) throw new Error("No claims left")
	push_undo()
	hs.disc = player
	game.players[player].claims_left--
	game.claim_land.pending.shift()
	const [hr, hc] = hex_id.split("_").map(Number)
	add_log(`${ROLE_NAMES[player]} claims ${hex_label(game_map(), hr, hc)}.`)
	game.waiting_end_turn = true
}

// ── exports.static_view ───────────────────────────────────────────

exports.static_view = function (game) {
	return null
}

// ── exports.setup ─────────────────────────────────────────────────

exports.setup = function (seed, scenario, options) {
	const pc = Number(options?.players) || 5
	if (!VALID_PLAYER_COUNTS.has(pc)) throw new Error(`Invalid player count: ${pc}`)
	const map_id = scenario.toLowerCase()
	if (!MAPS[map_id]) throw new Error(`Unknown scenario: ${scenario}`)
	const cc = pc + 1
	const starting_cash = { 3: 25, 4: 30, 5: 35 }[pc]
	const subsidies = !!options?.Subsidies_variant
	const map    = MAPS[map_id]
	const skip   = map.player_row_skip[pc] || 0
	const max_r  = map.rows.length - skip

	// Build hex state
	const hex_state = {}
	for (let r = 0; r < max_r; r++)
		for (let c = 0; c < map.rows[r].count; c++)
			hex_state[`${r}_${c}`] = { terrain: get_terrain(map, r, c), roads: [], disc: null }

	// Initialise game object (seed must be set before any shuffle calls)
	game = {
		seed,
		num_players: pc,
		map_id,
		subsidies,
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
		log: [`Road to Nowhere. ${pc} players, ${cc} companies.`],
		undo: [],
		waiting_end_turn: false,
		final_scores: null,
	}

	// Pre-cache the neighbour map for this map + player count
	nb_cache[`${map_id}:${pc}`] = build_nb_map(map, pc)

	for (let i = 0; i < cc; i++)
		game.companies.push({
			key: COMPANY_DEFS[i].key,
			name: COMPANY_DEFS[i].name,
			road_track: map.road_track_start,
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
			initial_order: null,
			last_bid: null,
			claims_left: 10,
		})

	// Randomise initial turn order
	const init_order = Array.from({ length: pc }, (_, i) => i)
	shuffle(init_order)
	for (let i = 0; i < pc; i++) {
		game.turn_track.push({ player: init_order[i], cube: null, bottom_player: null })
		game.players[init_order[i]].disc_on_track = i + 1
		game.players[init_order[i]].initial_order = i + 1
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

	// Pool is all cc companies. A player's 2nd pick can coincide with another
	// player's 1st share — only your own first share is excluded (checked in do_initial_pick).
	game.active_box = Array.from({ length: cc }, (_, i) => i)

	// Pick queue for second shares is reverse of init_order
	const rev_order = [...init_order].reverse()
	game.active_player = rev_order[0]
	game.initial_share_pick_queue = rev_order.slice(1)

	add_log("--- Initial Share Draft ---")

	return save_game()
}

// ── exports.action ────────────────────────────────────────────────

exports.action = function (state, current, action, arg) {
	load_game(state)
	const player = role_to_idx(current)

	if (action === "undo") {
		if (!game.undo || !game.undo.length) throw new Error("Nothing to undo")
		if (game.active_player !== player) throw new Error("Not your turn to undo")
		pop_undo()
		return save_game()
	}

	if (action === "end_turn") {
		if (!game.waiting_end_turn) throw new Error("No turn to end")
		if (game.active_player !== player) throw new Error("Not your turn")
		game.waiting_end_turn = false
		clear_undo()
		switch (game.phase) {
		case "initial_share_pick": advance_initial_pick(); break
		case "bid":                advance_bid();          break
		case "buy_shares":         advance_buy();          break
		case "build_roads": {
			const br = game.build_roads
			const ci = br.current_company
			if (br.state === "draft" || (ci !== null && !game.companies[ci].active)) advance_draft()
			else next_builder()
			break
		}
		case "claim_land":         claim_advance();        break
		default: throw new Error(`end_turn not valid in phase: ${game.phase}`)
		}
		return save_game()
	}

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

	// Observer or unexpected role — return a read-only snapshot
	if (!current || !ROLE_NAMES.includes(current)) {
		let prompt
		if (game.phase === "game_end")
			prompt = game.victory || "Game over!"
		else
			prompt = `Waiting for ${ROLE_NAMES[game.active_player]}…`
		return {
			prompt,
			phase: game.phase,
			round: game.round,
			active_player: game.active_player,
			active: game.phase === "game_end" ? "None" : ROLE_NAMES[game.active_player],
			map_id: game.map_id,
			companies: game.companies,
			players: game.players,
			active_box: game.active_box,
			turn_track: game.turn_track,
			hex_state: game.hex_state,
			build_roads: game.build_roads,
			bid: game.bid,
			buy_shares: game.buy_shares,
			log: game.log,
			final_scores: game.final_scores,
		}
	}

	const player = role_to_idx(current)
	const br = game.build_roads
	const is_active = game.active_player === player

	const view = {
		prompt: null,
		phase: game.phase,
		round: game.round,
		active_player: game.active_player,
		active: game.phase === "game_end" ? "None" : ROLE_NAMES[game.active_player],
		map_id: game.map_id,
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
		view.prompt = game.victory || "Game over!"
		return view
	}

	if (!is_active) {
		view.prompt = `Waiting for ${ROLE_NAMES[game.active_player]}\u2026`
		return view
	}

	if (game.waiting_end_turn) {
		const has_undo = game.undo && game.undo.length > 0
		let prompt = "You have no more actions."
		if (game.phase === "build_roads" && game.build_roads.state === "building"
				&& game.build_roads.build_points_remaining > 0)
			prompt = `No legal moves. ${game.build_roads.build_points_remaining} BP unused.`
		view.actions = { end_turn: 1, undo: has_undo ? 1 : 0 }
		view.prompt = prompt
		return view
	}

	view.actions = {}

	if (game.phase === "initial_share_pick") {
		const held = game.players[player].shares
		const picks = game.active_box.filter(ci => !held.includes(ci))
		if (picks.length) view.actions.pick_share = picks
		view.prompt = "Pick your second share, it must differ from your first."
	}

	else if (game.phase === "bid" && game.bid.active.includes(player)) {
		const min_raise = game.bid.current_bid + 1
		const max_raise = game.players[player].cash
		view.actions.pass = 1
		if (min_raise <= max_raise) {
			view.actions.raise = []
			for (let a = min_raise; a <= max_raise; a++) view.actions.raise.push(a)
		}
		view.prompt = "Raise the bid to claim 1st position, or pass."
	}

	else if (game.phase === "buy_shares" && game.buy_shares.pending[0] === player) {
		if (game.active_box.length) view.actions.buy = [...game.active_box]
		const bid_amt = game.bid.bids?.[player] || 0
		const is_1st  = game.players[player].disc_on_track === 1
		const cost    = is_1st ? bid_amt : Math.ceil(bid_amt / 2)
		view.prompt = `Pick a share from the active box. Bid $${bid_amt} must pay $${cost}.`
	}

	else if (game.phase === "build_roads") {
		if (br.state === "draft" && br.draft_queue[0] === player) {
			view.actions.pick_company = [...game.active_box]
			view.prompt = "Pick a company to activate."
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
			view.prompt = `Building ${game.companies[br.current_company]?.name || ""}. ${br.build_points_remaining} BP left.`
		}
	}

	else if (game.phase === "claim_land" && game.claim_land.pending[0] === player) {
		const claimable = Object.keys(game.hex_state).filter(hid => {
			const hs = game.hex_state[hid]
			return hs.terrain !== "city" && hs.disc === null && hs.roads.length === 0
		})
		if (claimable.length) view.actions.claim = claimable
		view.prompt = "Place your claim disc."
	}

	view.actions.undo = (game.undo && game.undo.length > 0) ? 1 : 0

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

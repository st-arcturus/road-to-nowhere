"use strict"

const assert = require("node:assert/strict")
const rules  = require("../rules.js")

function clone(o) { return JSON.parse(JSON.stringify(o)) }

// Simulate framework behavior: pass current player role string and dispatch action.
// Returns the new state.
function take(state, role, action, arg) {
	state = clone(state)
	return rules.action(state, role, action, arg)
}

function test(name, fn) {
	try {
		fn()
		console.log("ok -", name)
	} catch (e) {
		console.log("fail -", name)
		console.error(e)
		process.exitCode = 1
	}
}

// ── Basic setup ───────────────────────────────────────────────────

test("setup creates valid 3P game", () => {
	const g = rules.setup(42, "3P", {})
	assert.equal(typeof g, "object")
	assert.equal(g.players.length, 3)
	assert.ok(["Blue","Purple","Magenta","Orange","Yellow"].includes(g.active))
	assert.equal(g.phase, "initial_share_pick")
	assert.deepEqual(g.undo, [])
})

test("roles() returns color names", () => {
	const r = rules.roles("3P")
	assert.deepEqual(r, ["Blue","Purple","Magenta","Orange"].slice(0,3))
})

test("view as Observer returns read-only snapshot (no actions)", () => {
	const g = rules.setup(42, "3P", {})
	const v = rules.view(g, "Observer")
	assert.equal(v.actions, undefined, "observer view must not have actions")
	assert.equal(v.phase, "initial_share_pick")
})

test("view as inactive player has no actions", () => {
	const g = rules.setup(42, "3P", {})
	const inactive = ["Blue","Purple","Magenta"].find(r => r !== g.active)
	const v = rules.view(g, inactive)
	assert.equal(v.actions, undefined, "inactive player must not have actions")
	assert.match(v.prompt, /Waiting for/)
})

test("view as active player has actions in initial_share_pick", () => {
	const g = rules.setup(42, "3P", {})
	const v = rules.view(g, g.active)
	assert.ok(v.actions, "active player should have actions")
	assert.ok(Array.isArray(v.actions.pick_share), "should have pick_share array")
})

// ── End turn / undo flow ──────────────────────────────────────────

function play_initial_picks(g) {
	// Each player picks their second share (whatever's available)
	let safety = 20
	while (g.phase === "initial_share_pick" && safety-- > 0) {
		const v = rules.view(g, g.active)
		if (v.actions?.pick_share?.length) {
			g = take(g, g.active, "pick_share", v.actions.pick_share[0])
			// Then end turn
			const v2 = rules.view(g, g.active)
			if (v2.actions?.end_turn) {
				g = take(g, g.active, "end_turn")
			}
		} else {
			break
		}
	}
	return g
}

test("end_turn advances after pick_share", () => {
	let g = rules.setup(42, "3P", {})
	const first = g.active
	const v = rules.view(g, first)
	assert.ok(v.actions.pick_share?.length, "should offer pick_share")
	g = take(g, first, "pick_share", v.actions.pick_share[0])

	// After pick_share completes, waiting_end_turn should be true
	const v2 = rules.view(g, first)
	assert.equal(v2.actions.end_turn, 1, "should now wait for end_turn")
	assert.equal(v2.actions.undo, 1, "undo should be available")

	g = take(g, first, "end_turn")
	const v3 = rules.view(g, first)
	// First player is no longer active (or phase advanced)
	assert.ok(g.active !== first || g.phase !== "initial_share_pick" || v3.actions === undefined,
		"after end_turn, this player shouldn't still be acting in same state")
})

test("undo restores state and clears waiting_end_turn", () => {
	let g = rules.setup(42, "3P", {})
	const first = g.active
	const orig = clone(g)
	const v = rules.view(g, first)
	g = take(g, first, "pick_share", v.actions.pick_share[0])
	assert.equal(g.waiting_end_turn, true)
	assert.equal(g.undo.length, 1, "undo stack should have 1 entry")

	// Undo
	g = take(g, first, "undo")
	assert.equal(g.waiting_end_turn, false, "waiting_end_turn must be cleared by undo")
	assert.equal(g.undo.length, 0, "undo stack empty after pop")
	assert.deepEqual(g.players[rules.roles("3P").indexOf(first)].shares,
		orig.players[rules.roles("3P").indexOf(first)].shares,
		"shares restored")
})

test("undo throws if nothing to undo", () => {
	const g = rules.setup(42, "3P", {})
	assert.throws(() => take(g, g.active, "undo"), /Nothing to undo/)
})

test("undo throws if not active player", () => {
	let g = rules.setup(42, "3P", {})
	const first = g.active
	const v = rules.view(g, first)
	g = take(g, first, "pick_share", v.actions.pick_share[0])
	const other = ["Blue","Purple","Magenta"].find(r => r !== first)
	assert.throws(() => take(g, other, "undo"), /Not your turn/)
})

test("end_turn throws if waiting_end_turn is false", () => {
	const g = rules.setup(42, "3P", {})
	assert.throws(() => take(g, g.active, "end_turn"), /No turn to end/)
})

// ── Bid phase tests ──────────────────────────────────────────────

test("bid phase: undo available after raise", () => {
	let g = rules.setup(42, "3P", {})
	g = play_initial_picks(g)
	assert.equal(g.phase, "bid", `expected bid phase, got ${g.phase}`)

	const bidder = g.active
	const v = rules.view(g, bidder)
	assert.ok(v.actions, "bidder should have actions")
	// Either pass or raise should be available
	assert.ok(v.actions.pass || v.actions.raise, "should have pass or raise")

	if (v.actions.raise) {
		const before_undo_len = g.undo.length
		g = take(g, bidder, "raise", v.actions.raise[0])
		assert.equal(g.undo.length, before_undo_len + 1, "raise should push_undo")
	}
})

test("undo clears on active player change", () => {
	let g = rules.setup(42, "3P", {})
	const first = g.active
	const v = rules.view(g, first)
	g = take(g, first, "pick_share", v.actions.pick_share[0])
	assert.equal(g.undo.length, 1)
	g = take(g, first, "end_turn")
	// Active player changed; undo should be empty
	assert.equal(g.undo.length, 0, "undo cleared when active player changes")
})

// ── Replay simulation: view called during replay must not mutate state ──

test("view does not mutate state (replay-safe)", () => {
	const g = rules.setup(42, "3P", {})
	const before = JSON.stringify(g)
	rules.view(g, g.active)
	rules.view(g, "Observer")
	const inactive = ["Blue","Purple","Magenta"].find(r => r !== g.active)
	rules.view(g, inactive)
	assert.equal(JSON.stringify(g), before, "view must not mutate state")
})

// ── Mid-turn undo visibility ─────────────────────────────────────

test("undo always exposed mid-turn in pick_share view", () => {
	const g = rules.setup(42, "3P", {})
	const v = rules.view(g, g.active)
	// First action of turn — undo stack empty, so undo should be 0 (present, disabled)
	assert.equal(v.actions.undo, 0, "undo present but disabled when stack empty")
})

test("undo exposed during bid phase actions", () => {
	let g = rules.setup(42, "3P", {})
	g = play_initial_picks(g)
	if (g.phase !== "bid") return
	const v = rules.view(g, g.active)
	assert.notEqual(v.actions.undo, undefined, "undo should be in actions during bid phase")
})

test("buy_shares prompt includes 'Bid $x must pay $y'", () => {
	let g = rules.setup(42, "3P", {})
	g = play_initial_picks(g)
	// Pass through bid phase
	let safety = 30
	while (g.phase === "bid" && safety-- > 0) {
		const v = rules.view(g, g.active)
		if (v.actions?.pass) g = take(g, g.active, "pass")
		else if (v.actions?.end_turn) g = take(g, g.active, "end_turn")
		else break
	}
	if (g.phase !== "buy_shares") return
	const v = rules.view(g, g.active)
	assert.match(v.prompt, /Bid \$\d+ must pay \$\d+/, `expected bid info in prompt; got: ${v.prompt}`)
})

test("undo enabled after a build action mid-turn", () => {
	let g = rules.setup(42, "3P", {})
	g = play_initial_picks(g)
	// Pass through bid phase
	let safety = 60
	while (g.phase !== "build_roads" && safety-- > 0) {
		const v = rules.view(g, g.active)
		if (v.actions?.pass) g = take(g, g.active, "pass")
		else if (v.actions?.end_turn) g = take(g, g.active, "end_turn")
		else if (v.actions?.buy?.length) g = take(g, g.active, "buy", v.actions.buy[0])
		else if (v.actions?.pick_company?.length) g = take(g, g.active, "pick_company", v.actions.pick_company[0])
		else break
	}
	if (g.phase !== "build_roads" || g.build_roads.state !== "building") return

	const v = rules.view(g, g.active)
	if (!v.actions?.build?.length) return
	const before_undo = g.undo.length
	g = take(g, g.active, "build", v.actions.build[0])
	const v2 = rules.view(g, g.active)
	// Either we're still building (undo should be exposed) or moved to end_turn
	assert.notEqual(v2.actions?.undo, undefined, "undo must be exposed after build action")
	if (g.undo.length > before_undo)
		assert.equal(v2.actions.undo, 1, "undo enabled when stack has entries")
})

// ── Group A: Error cases ─────────────────────────────────────────

test("unknown action throws in initial_share_pick", () => {
	const g = rules.setup(42, "3P", {})
	assert.throws(() => take(g, g.active, "flurble"), /Must pick a share|Unknown/)
})

test("unknown role throws in action()", () => {
	const g = rules.setup(42, "3P", {})
	assert.throws(() => take(g, "Chartreuse", "pick_share", 0), /Unknown role/)
})

test("wrong-phase action throws", () => {
	const g = rules.setup(42, "3P", {})
	// claim is not valid in initial_share_pick
	assert.throws(() => take(g, g.active, "claim", "5_2"))
})

test("pick_share throws for already-held company", () => {
	let g = rules.setup(42, "3P", {})
	const pi = rules.roles("3P").indexOf(g.active)
	const held_ci = g.players[pi].shares[0]
	assert.throws(
		() => take(g, g.active, "pick_share", held_ci),
		/different company/
	)
})

test("bid raise below current_bid throws", () => {
	let g = rules.setup(42, "3P", {})
	g = play_initial_picks(g)
	assert.equal(g.phase, "bid")
	// Set current bid above 1 so a raise of 1 is invalid
	g = clone(g)
	g.bid.current_bid = 5
	assert.throws(() => take(g, g.active, "raise", 3), /Must bid >/)
})

test("bid raise above player cash throws", () => {
	let g = rules.setup(42, "3P", {})
	g = play_initial_picks(g)
	assert.equal(g.phase, "bid")
	assert.throws(() => take(g, g.active, "raise", 99999), /enough cash/)
})

// ── Group B: Claim phase ──────────────────────────────────────────

function play_to_claim_land(g) {
	let safety = 120
	while (g.phase !== "claim_land" && g.phase !== "game_end" && safety-- > 0) {
		const v = rules.view(g, g.active)
		if (!v.actions) break
		if (v.actions.pass)          g = take(g, g.active, "pass")
		else if (v.actions.end_turn) g = take(g, g.active, "end_turn")
		else if (v.actions.buy?.length)          g = take(g, g.active, "buy", v.actions.buy[0])
		else if (v.actions.pick_company?.length) g = take(g, g.active, "pick_company", v.actions.pick_company[0])
		else if (v.actions.build?.length)        g = take(g, g.active, "build", v.actions.build[0])
		else break
	}
	return g
}

test("claim places disc on hex and advances pending", () => {
	let g = rules.setup(42, "3P", {})
	g = play_initial_picks(g)
	g = play_to_claim_land(g)
	if (g.phase !== "claim_land") return

	const actor = g.active
	const v = rules.view(g, actor)
	if (!v.actions?.claim?.length) return

	const hex_id = v.actions.claim[0]
	const before_pending = g.claim_land.pending.length
	g = take(g, actor, "claim", hex_id)

	assert.equal(g.hex_state[hex_id].disc, rules.roles("3P").indexOf(actor),
		"disc placed with correct player index")
	assert.equal(g.claim_land.pending.length, before_pending - 1, "pending shrinks by 1")
})

test("claim throws for city hex", () => {
	let g = rules.setup(42, "3P", {})
	g = play_initial_picks(g)
	g = play_to_claim_land(g)
	if (g.phase !== "claim_land") return

	// Find a city hex
	const city_hex = Object.keys(g.hex_state).find(id => g.hex_state[id].terrain === "city")
	if (!city_hex) return

	assert.throws(() => take(g, g.active, "claim", city_hex), /city/)
})

test("claim throws for already-claimed hex", () => {
	let g = rules.setup(42, "3P", {})
	g = play_initial_picks(g)
	g = play_to_claim_land(g)
	if (g.phase !== "claim_land") return

	const actor = g.active
	const v = rules.view(g, actor)
	if (!v.actions?.claim?.length) return

	// Pre-plant a disc on the target hex
	const hex_id = v.actions.claim[0]
	g = clone(g)
	g.hex_state[hex_id].disc = 0

	assert.throws(() => take(g, actor, "claim", hex_id), /Already claimed/)
})

test("claim throws for hex with a road", () => {
	let g = rules.setup(42, "3P", {})
	g = play_initial_picks(g)
	g = play_to_claim_land(g)
	if (g.phase !== "claim_land") return

	const actor = g.active
	const v = rules.view(g, actor)
	if (!v.actions?.claim?.length) return

	// Pre-plant a road on the target hex
	const hex_id = v.actions.claim[0]
	g = clone(g)
	g.hex_state[hex_id].roads = [0]

	assert.throws(() => take(g, actor, "claim", hex_id), /road/)
})

test("claim throws when player has no claims left", () => {
	let g = rules.setup(42, "3P", {})
	g = play_initial_picks(g)
	g = play_to_claim_land(g)
	if (g.phase !== "claim_land") return

	const actor = g.active
	const pi = rules.roles("3P").indexOf(actor)
	const v = rules.view(g, actor)
	if (!v.actions?.claim?.length) return

	g = clone(g)
	g.players[pi].claims_left = 0

	assert.throws(() => take(g, actor, "claim", v.actions.claim[0]), /No claims left/)
})

// ── Group C: Build phase economics ───────────────────────────────

function play_to_build_roads(g) {
	let safety = 60
	while (g.phase !== "build_roads" && g.phase !== "game_end" && safety-- > 0) {
		const v = rules.view(g, g.active)
		if (!v.actions) break
		if (v.actions.pass)          g = take(g, g.active, "pass")
		else if (v.actions.end_turn) g = take(g, g.active, "end_turn")
		else if (v.actions.buy?.length) g = take(g, g.active, "buy", v.actions.buy[0])
		else break
	}
	return g
}

function play_to_building(g) {
	let safety = 30
	while (g.phase === "build_roads" && g.build_roads.state === "draft" && safety-- > 0) {
		const v = rules.view(g, g.active)
		if (v.actions?.pick_company?.length)
			g = take(g, g.active, "pick_company", v.actions.pick_company[0])
		else if (v.actions?.end_turn)
			g = take(g, g.active, "end_turn")
		else break
	}
	return g
}

test("mountain build costs 2 BP", () => {
	let g = rules.setup(42, "3P", {})
	g = play_initial_picks(g)
	g = play_to_build_roads(g)
	g = play_to_building(g)
	if (g.phase !== "build_roads" || g.build_roads.state !== "building") return

	const ci = g.build_roads.current_company
	const mountain_hex = Object.keys(g.hex_state).find(id => {
		const hs = g.hex_state[id]
		return hs.terrain === "mountain" && hs.roads.length === 0
	})
	if (!mountain_hex) return

	const v = rules.view(g, g.active)
	if (!v.actions?.build?.includes(mountain_hex)) return

	const before_bp = g.build_roads.build_points_remaining
	g = take(g, g.active, "build", mountain_hex)
	assert.equal(g.build_roads.build_points_remaining, before_bp - 2,
		"mountain build should cost 2 BP")
})

test("desert build drains company treasury by 1", () => {
	let g = rules.setup(42, "3P", {})
	g = play_initial_picks(g)
	g = play_to_build_roads(g)
	g = play_to_building(g)
	if (g.phase !== "build_roads" || g.build_roads.state !== "building") return

	const ci = g.build_roads.current_company
	const desert_hex = Object.keys(g.hex_state).find(id => {
		const hs = g.hex_state[id]
		return hs.terrain === "desert" && hs.roads.length === 0
	})
	if (!desert_hex) return

	const v = rules.view(g, g.active)
	if (!v.actions?.build?.includes(desert_hex)) return

	const before_treas = g.companies[ci].treasury
	g = take(g, g.active, "build", desert_hex)
	assert.equal(g.companies[ci].treasury, before_treas - 1,
		"desert build should drain company treasury by 1")
})

test("building over a disc records claim and nulls disc", () => {
	let g = rules.setup(42, "3P", {})
	g = play_initial_picks(g)
	g = play_to_build_roads(g)
	g = play_to_building(g)
	if (g.phase !== "build_roads" || g.build_roads.state !== "building") return

	const ci = g.build_roads.current_company
	const v = rules.view(g, g.active)
	if (!v.actions?.build?.length) return

	// Plant a disc on the first buildable plain hex
	const target = v.actions.build.find(id => g.hex_state[id].terrain === "plain")
	if (!target) return

	const disc_owner = 0
	g = clone(g)
	g.hex_state[target].disc = disc_owner

	g = take(g, g.active, "build", target)
	const co = g.companies[ci]
	assert.ok(co.claims.includes(target), "claim hex recorded")
	assert.ok(co.claim_owners.includes(disc_owner), "claim owner recorded")
	assert.equal(g.hex_state[target].disc, null, "disc nulled after road built over it")
})

// ── Group D: Scoring ──────────────────────────────────────────────

test("compute_scores: totals are cash + shares + claims", () => {
	// Build a minimal end-game state to verify scoring formula
	let g = rules.setup(99, "3P", {})
	g = clone(g)

	// Force game_end with known cash values
	g.phase = "game_end"
	// Zero out shares and claims for clean math
	for (const p of g.players) { p.shares = []; p.cash = 10 }
	for (const co of g.companies) { co.shares = []; co.claims = []; co.claim_owners = []; co.road_track = 25 }
	g.final_scores = null

	// Trigger compute_scores via resign
	const role = g.active
	g = rules.resign(g, role)

	assert.ok(g.final_scores, "final_scores should be set")
	for (const s of g.final_scores) {
		assert.equal(s.total, s.cash + s.shares + s.claims,
			`total must equal cash+shares+claims for player ${s.player}`)
	}
})

test("compute_scores: winner is first in sorted array", () => {
	let g = rules.setup(99, "3P", {})
	g = clone(g)
	// Give player 2 much more cash so they definitely win
	g.players[2].cash = 999
	g.players[0].cash = 1
	g.players[1].cash = 1
	for (const p of g.players) p.shares = []
	for (const co of g.companies) { co.shares = []; co.claims = []; co.claim_owners = []; co.road_track = 25 }

	const roles = rules.roles("3P")
	g = rules.resign(g, roles[0])

	assert.equal(g.final_scores[0].player, 2, "player 2 should win")
	assert.ok(g.final_scores[0].total > g.final_scores[1].total, "winner has highest total")
})

test("compute_scores: game.result set to winner role name", () => {
	let g = rules.setup(99, "3P", {})
	g = clone(g)
	g.players[1].cash = 999
	g.players[0].cash = 1
	g.players[2].cash = 1
	for (const p of g.players) p.shares = []
	for (const co of g.companies) { co.shares = []; co.claims = []; co.claim_owners = []; co.road_track = 25 }

	const roles = rules.roles("3P")
	g = rules.resign(g, roles[0])

	assert.equal(g.final_scores[0].player, 1)
	assert.equal(g.result, roles[1], "result should be winner's role name")
})

// ── Group E: resign ───────────────────────────────────────────────

test("resign triggers game_end with final_scores", () => {
	const g = rules.setup(42, "3P", {})
	const role = g.active
	const g2 = rules.resign(g, role)
	assert.equal(g2.phase, "game_end", "phase must be game_end after resign")
	assert.ok(Array.isArray(g2.final_scores), "final_scores must be an array")
	assert.equal(g2.final_scores.length, 3, "one score entry per player")
})

test("resign: each score entry has player, cash, shares, claims, total", () => {
	const g = rules.setup(42, "3P", {})
	const g2 = rules.resign(g, g.active)
	for (const s of g2.final_scores) {
		assert.ok("player" in s && "cash" in s && "shares" in s && "claims" in s && "total" in s,
			"score entry has all fields")
	}
})

// ── Group F: Rules edge cases ─────────────────────────────────────

test("7-share shutdown deactivates a company", () => {
	let g = rules.setup(42, "3P", {})
	g = play_initial_picks(g)
	g = clone(g)
	// Manually give company 0 the maximum 7 shares
	g.companies[0].shares = [0, 0, 0, 0, 0, 0, 0]
	// Play through to claim_land or game_end — start_claim_land fires the shutdown
	g = play_to_claim_land(g)
	assert.equal(g.companies[0].active, false, "company with 7 shares must be deactivated")
})

test("game ends when fewer than 2 companies remain active after 7-share shutdown", () => {
	let g = rules.setup(42, "3P", {})
	g = play_initial_picks(g)
	g = clone(g)
	// In a 3P game there are 4 companies. Giving 3 of them 7 shares means
	// start_claim_land deactivates them, leaving only 1 active → game_end.
	g.companies[0].shares = [0, 0, 0, 0, 0, 0, 0]
	g.companies[1].shares = [1, 1, 1, 1, 1, 1, 1]
	g.companies[2].shares = [2, 2, 2, 2, 2, 2, 2]
	g = play_to_claim_land(g)
	assert.equal(g.phase, "game_end", "game must end when < 2 companies remain active")
	assert.ok(Array.isArray(g.final_scores), "final_scores must be present")
})

test("stalemate: game ends when 0 roads are built in build phase", () => {
	let g = rules.setup(42, "3P", {})
	g = play_initial_picks(g)
	g = clone(g)
	// Block all builds without deactivating companies: mark every city hex as already
	// containing each company's road. Since last_road === null for all companies, the
	// first build must be a city — but all cities are "Already here" → can_build fails
	// for every hex. can_reach_second_city returns true when last_road is null, so
	// companies stay active and check_game_end doesn't fire, leaving stalemate to trigger.
	const city_hexes = Object.keys(g.hex_state).filter(id => g.hex_state[id].terrain === "city")
	for (const id of city_hexes)
		for (let ci = 0; ci < g.companies.length; ci++)
			if (!g.hex_state[id].roads.includes(ci)) g.hex_state[id].roads.push(ci)
	g = play_to_claim_land(g)
	assert.equal(g.phase, "game_end", "stalemate must trigger game_end")
	assert.ok(g.log.some(l => l.includes("No roads built")), "log must mention stalemate reason")
})

console.log("---")
console.log("Done.")

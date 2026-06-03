"use strict"

const assert = require("node:assert/strict")
const rules  = require("../rules.js")
const { MAPS, get_terrain, hex_label } = require("../map.js")

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
	const g = rules.setup(42, "Gold", { players: 3 })
	assert.equal(typeof g, "object")
	assert.equal(g.players.length, 3)
	assert.ok(["Blue","Purple","Magenta","Orange","Yellow"].includes(g.active))
	assert.equal(g.phase, "initial_share_pick")
	assert.deepEqual(g.undo, [])
})

test("roles() returns color names", () => {
	const r = rules.roles("Gold", { players: 3 })
	assert.deepEqual(r, ["Blue","Purple","Magenta","Orange"].slice(0,3))
})

test("view as Observer returns read-only snapshot (no actions)", () => {
	const g = rules.setup(42, "Gold", { players: 3 })
	const v = rules.view(g, "Observer")
	assert.equal(v.actions, undefined, "observer view must not have actions")
	assert.equal(v.phase, "initial_share_pick")
})

test("view as inactive player has no actions", () => {
	const g = rules.setup(42, "Gold", { players: 3 })
	const inactive = ["Blue","Purple","Magenta"].find(r => r !== g.active)
	const v = rules.view(g, inactive)
	assert.equal(v.actions, undefined, "inactive player must not have actions")
	assert.match(v.prompt, /Waiting for/)
})

test("view as active player has actions in initial_share_pick", () => {
	const g = rules.setup(42, "Gold", { players: 3 })
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
	let g = rules.setup(42, "Gold", { players: 3 })
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
	let g = rules.setup(42, "Gold", { players: 3 })
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
	assert.deepEqual(g.players[rules.roles("Gold", { players: 3 }).indexOf(first)].shares,
		orig.players[rules.roles("Gold", { players: 3 }).indexOf(first)].shares,
		"shares restored")
})

test("undo throws if nothing to undo", () => {
	const g = rules.setup(42, "Gold", { players: 3 })
	assert.throws(() => take(g, g.active, "undo"), /Nothing to undo/)
})

test("undo throws if not active player", () => {
	let g = rules.setup(42, "Gold", { players: 3 })
	const first = g.active
	const v = rules.view(g, first)
	g = take(g, first, "pick_share", v.actions.pick_share[0])
	const other = ["Blue","Purple","Magenta"].find(r => r !== first)
	assert.throws(() => take(g, other, "undo"), /Not your turn/)
})

test("end_turn throws if waiting_end_turn is false", () => {
	const g = rules.setup(42, "Gold", { players: 3 })
	assert.throws(() => take(g, g.active, "end_turn"), /No turn to end/)
})

// ── Bid phase tests ──────────────────────────────────────────────

test("bid phase: undo available after raise", () => {
	let g = rules.setup(42, "Gold", { players: 3 })
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
	let g = rules.setup(42, "Gold", { players: 3 })
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
	const g = rules.setup(42, "Gold", { players: 3 })
	const before = JSON.stringify(g)
	rules.view(g, g.active)
	rules.view(g, "Observer")
	const inactive = ["Blue","Purple","Magenta"].find(r => r !== g.active)
	rules.view(g, inactive)
	assert.equal(JSON.stringify(g), before, "view must not mutate state")
})

// ── Mid-turn undo visibility ─────────────────────────────────────

test("undo always exposed mid-turn in pick_share view", () => {
	const g = rules.setup(42, "Gold", { players: 3 })
	const v = rules.view(g, g.active)
	// First action of turn — undo stack empty, so undo should be 0 (present, disabled)
	assert.equal(v.actions.undo, 0, "undo present but disabled when stack empty")
})

test("undo exposed during bid phase actions", () => {
	let g = rules.setup(42, "Gold", { players: 3 })
	g = play_initial_picks(g)
	if (g.phase !== "bid") return
	const v = rules.view(g, g.active)
	assert.notEqual(v.actions.undo, undefined, "undo should be in actions during bid phase")
})

test("buy_shares prompt includes 'Bid $x must pay $y'", () => {
	let g = rules.setup(42, "Gold", { players: 3 })
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
	let g = rules.setup(42, "Gold", { players: 3 })
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
	const g = rules.setup(42, "Gold", { players: 3 })
	assert.throws(() => take(g, g.active, "flurble"), /Must pick a share|Unknown/)
})

test("unknown role throws in action()", () => {
	const g = rules.setup(42, "Gold", { players: 3 })
	assert.throws(() => take(g, "Chartreuse", "pick_share", 0), /Unknown role/)
})

test("wrong-phase action throws", () => {
	const g = rules.setup(42, "Gold", { players: 3 })
	// claim is not valid in initial_share_pick
	assert.throws(() => take(g, g.active, "claim", "5_2"))
})

test("pick_share throws for already-held company", () => {
	let g = rules.setup(42, "Gold", { players: 3 })
	const pi = rules.roles("Gold", { players: 3 }).indexOf(g.active)
	const held_ci = g.players[pi].shares[0]
	assert.throws(
		() => take(g, g.active, "pick_share", held_ci),
		/different company/
	)
})

test("bid raise below current_bid throws", () => {
	let g = rules.setup(42, "Gold", { players: 3 })
	g = play_initial_picks(g)
	assert.equal(g.phase, "bid")
	// Set current bid above 1 so a raise of 1 is invalid
	g = clone(g)
	g.bid.current_bid = 5
	assert.throws(() => take(g, g.active, "raise", 3), /Must bid >/)
})

test("bid raise above player cash throws", () => {
	let g = rules.setup(42, "Gold", { players: 3 })
	g = play_initial_picks(g)
	assert.equal(g.phase, "bid")
	assert.throws(() => take(g, g.active, "raise", 99999), /enough cash/)
})

test("bid view.actions.raise includes all valid amounts, not just minimum", () => {
	// Regression: previously only [min_raise] was in the array, so the framework's
	// send_action(.includes check) silently rejected any bid above the minimum.
	let g = rules.setup(42, "Gold", { players: 3 })
	g = play_initial_picks(g)
	assert.equal(g.phase, "bid")

	const bidder = g.active
	const pi = rules.roles("Gold", { players: 3 }).indexOf(bidder)
	const cash = g.players[pi].cash
	const min_raise = g.bid.current_bid + 1

	const v = rules.view(g, bidder)
	assert.ok(Array.isArray(v.actions.raise), "raise must be an array")

	// Every amount from min_raise to player cash must be present
	for (let amount = min_raise; amount <= cash; amount++)
		assert.ok(v.actions.raise.includes(amount),
			`view.actions.raise missing $${amount} (min=$${min_raise}, cash=$${cash})`)

	// A non-minimum raise must also be accepted by the action handler
	if (cash > min_raise) {
		const g2 = take(g, bidder, "raise", min_raise + 1)
		assert.equal(g2.bid.current_bid, min_raise + 1,
			"server must accept a raise above the minimum")
	}
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
	let g = rules.setup(42, "Gold", { players: 3 })
	g = play_initial_picks(g)
	g = play_to_claim_land(g)
	if (g.phase !== "claim_land") return

	const actor = g.active
	const v = rules.view(g, actor)
	if (!v.actions?.claim?.length) return

	const hex_id = v.actions.claim[0]
	const before_pending = g.claim_land.pending.length
	g = take(g, actor, "claim", hex_id)

	assert.equal(g.hex_state[hex_id].disc, rules.roles("Gold", { players: 3 }).indexOf(actor),
		"disc placed with correct player index")
	assert.equal(g.claim_land.pending.length, before_pending - 1, "pending shrinks by 1")
})

test("claim throws for city hex", () => {
	let g = rules.setup(42, "Gold", { players: 3 })
	g = play_initial_picks(g)
	g = play_to_claim_land(g)
	if (g.phase !== "claim_land") return

	// Find a city hex
	const city_hex = Object.keys(g.hex_state).find(id => g.hex_state[id].terrain === "city")
	if (!city_hex) return

	assert.throws(() => take(g, g.active, "claim", city_hex), /city/)
})

test("claim throws for already-claimed hex", () => {
	let g = rules.setup(42, "Gold", { players: 3 })
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
	let g = rules.setup(42, "Gold", { players: 3 })
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
	let g = rules.setup(42, "Gold", { players: 3 })
	g = play_initial_picks(g)
	g = play_to_claim_land(g)
	if (g.phase !== "claim_land") return

	const actor = g.active
	const pi = rules.roles("Gold", { players: 3 }).indexOf(actor)
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
	let g = rules.setup(42, "Gold", { players: 3 })
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
	let g = rules.setup(42, "Gold", { players: 3 })
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
	let g = rules.setup(42, "Gold", { players: 3 })
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
	let g = rules.setup(99, "Gold", { players: 3 })
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
	let g = rules.setup(99, "Gold", { players: 3 })
	g = clone(g)
	// Give player 2 much more cash so they definitely win
	g.players[2].cash = 999
	g.players[0].cash = 1
	g.players[1].cash = 1
	for (const p of g.players) p.shares = []
	for (const co of g.companies) { co.shares = []; co.claims = []; co.claim_owners = []; co.road_track = 25 }

	const roles = rules.roles("Gold", { players: 3 })
	g = rules.resign(g, roles[0])

	assert.equal(g.final_scores[0].player, 2, "player 2 should win")
	assert.ok(g.final_scores[0].total > g.final_scores[1].total, "winner has highest total")
})

test("compute_scores: game.result set to winner role name", () => {
	let g = rules.setup(99, "Gold", { players: 3 })
	g = clone(g)
	g.players[1].cash = 999
	g.players[0].cash = 1
	g.players[2].cash = 1
	for (const p of g.players) p.shares = []
	for (const co of g.companies) { co.shares = []; co.claims = []; co.claim_owners = []; co.road_track = 25 }

	const roles = rules.roles("Gold", { players: 3 })
	g = rules.resign(g, roles[0])

	assert.equal(g.final_scores[0].player, 1)
	assert.equal(g.result, roles[1], "result should be winner's role name")
})

test("compute_scores: shared victory when all tiebreakers equal", () => {
	let g = rules.setup(99, "Gold", { players: 3 })
	g = clone(g)
	// Give all players identical totals with no shares or claims
	for (const p of g.players) { p.cash = 50; p.shares = [] }
	for (const co of g.companies) { co.shares = []; co.claims = []; co.claim_owners = []; co.road_track = 25 }

	const roles = rules.roles("Gold", { players: 3 })
	g = rules.resign(g, roles[0])

	assert.ok(g.result.includes(roles[0]), "result includes Blue")
	assert.ok(g.result.includes(roles[1]), "result includes Purple")
	assert.ok(g.result.includes(roles[2]), "result includes Magenta")
	assert.ok(g.victory.includes("tie"), "victory message says tie")
})

// ── Group E: resign ───────────────────────────────────────────────

test("resign triggers game_end with final_scores", () => {
	const g = rules.setup(42, "Gold", { players: 3 })
	const role = g.active
	const g2 = rules.resign(g, role)
	assert.equal(g2.phase, "game_end", "phase must be game_end after resign")
	assert.ok(Array.isArray(g2.final_scores), "final_scores must be an array")
	assert.equal(g2.final_scores.length, 3, "one score entry per player")
})

test("resign: each score entry has player, cash, shares, claims, total", () => {
	const g = rules.setup(42, "Gold", { players: 3 })
	const g2 = rules.resign(g, g.active)
	for (const s of g2.final_scores) {
		assert.ok("player" in s && "cash" in s && "shares" in s && "claims" in s && "total" in s,
			"score entry has all fields")
	}
})

// ── Group F: Rules edge cases ─────────────────────────────────────

test("7-share shutdown deactivates a company", () => {
	let g = rules.setup(42, "Gold", { players: 3 })
	g = play_initial_picks(g)
	g = clone(g)
	// Manually give company 0 the maximum 7 shares
	g.companies[0].shares = [0, 0, 0, 0, 0, 0, 0]
	// Play through to claim_land or game_end — start_claim_land fires the shutdown
	g = play_to_claim_land(g)
	assert.equal(g.companies[0].active, false, "company with 7 shares must be deactivated")
})

test("game ends when fewer than 2 companies remain active after 7-share shutdown", () => {
	let g = rules.setup(42, "Gold", { players: 3 })
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
	let g = rules.setup(42, "Gold", { players: 3 })
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

// ── Group G: Build phase undo ────────────────────────────────────
//
// These tests cover the regression where undo was not available after
// pick_company in the draft sub-phase when the company had no shareholders
// (or when the drafter held no shares). The fix was ensuring push_undo()
// is called before all mutations in do_build_roads draft path.

test("build draft: undo available after pick_company with no shareholders", () => {
	let g = rules.setup(42, "Gold", { players: 3 })
	g = play_initial_picks(g)
	g = play_to_build_roads(g)
	if (g.phase !== "build_roads" || g.build_roads.state !== "draft") return

	const ci = g.active_box[0]
	const drafter = g.active

	// Remove all players' shares in this company so build_queue will be empty
	g = clone(g)
	for (const p of g.players) p.shares = p.shares.filter(s => s !== ci)
	g.companies[ci].shares = []

	g = take(g, drafter, "pick_company", ci)

	assert.equal(g.waiting_end_turn, true, "should be waiting for end_turn")
	assert.equal(g.undo.length, 1, "push_undo must have been called before mutations")
	const v = rules.view(g, drafter)
	assert.equal(v.actions.undo, 1, "undo must be enabled (regression: was absent when push_undo missing)")
	assert.equal(v.actions.end_turn, 1, "end_turn must also be available")
})

test("build draft: undo of no-shareholder pick restores full state", () => {
	let g = rules.setup(42, "Gold", { players: 3 })
	g = play_initial_picks(g)
	g = play_to_build_roads(g)
	if (g.phase !== "build_roads" || g.build_roads.state !== "draft") return

	const ci = g.active_box[0]
	const drafter = g.active

	g = clone(g)
	for (const p of g.players) p.shares = p.shares.filter(s => s !== ci)
	g.companies[ci].shares = []

	const log_len_before = g.log.length
	g = take(g, drafter, "pick_company", ci)
	assert.ok(g.log.length > log_len_before, "log should have grown after pick")
	assert.equal(g.undo.length, 1)

	// Undo should fully restore pre-pick state
	g = take(g, drafter, "undo")
	assert.equal(g.waiting_end_turn, false, "waiting_end_turn cleared by undo")
	assert.equal(g.undo.length, 0, "undo stack empty after pop")
	assert.ok(g.active_box.includes(ci), "company must be back in active_box after undo")
	assert.equal(g.build_roads.state, "draft", "sub-phase must still be draft")
	assert.equal(g.log.length, log_len_before, "log must be truncated back to pre-pick length")
})

test("build draft: undo available when drafter has no shares but others do", () => {
	// The drafter picks a company they don't own shares in; another player does.
	// build_queue excludes the drafter → waiting_end_turn = true before build starts.
	// Regression: this path also needed push_undo() to have been called.
	let g = rules.setup(42, "Gold", { players: 3 })
	g = play_initial_picks(g)
	g = play_to_build_roads(g)
	if (g.phase !== "build_roads" || g.build_roads.state !== "draft") return

	const ci = g.active_box[0]
	const drafter = g.active
	const drafter_pi = rules.roles("Gold", { players: 3 }).indexOf(drafter)

	g = clone(g)
	// Remove drafter's shares in ci
	g.players[drafter_pi].shares = g.players[drafter_pi].shares.filter(s => s !== ci)
	// Ensure a different player has at least one share in ci so build_queue is non-empty
	const other_pi = (drafter_pi + 1) % 3
	if (!g.players[other_pi].shares.includes(ci)) g.players[other_pi].shares.push(ci)
	if (!g.companies[ci].shares.includes(other_pi)) g.companies[ci].shares.push(other_pi)

	g = take(g, drafter, "pick_company", ci)

	// Since drafter isn't in build_queue, control goes to waiting_end_turn
	assert.equal(g.waiting_end_turn, true, "drafter waits while another player is first builder")
	assert.equal(g.undo.length, 1, "undo stack must have 1 entry")
	const v = rules.view(g, drafter)
	assert.equal(v.actions.undo, 1, "undo must be enabled for the drafter")
})

test("build draft: undo after end_turn is not available (clear_undo was called)", () => {
	// end_turn unconditionally calls clear_undo(), so after it fires, undo stack is empty.
	let g = rules.setup(42, "Gold", { players: 3 })
	g = play_initial_picks(g)
	g = play_to_build_roads(g)
	if (g.phase !== "build_roads" || g.build_roads.state !== "draft") return

	const ci = g.active_box[0]
	const drafter = g.active

	g = clone(g)
	for (const p of g.players) p.shares = p.shares.filter(s => s !== ci)
	g.companies[ci].shares = []

	g = take(g, drafter, "pick_company", ci)
	assert.equal(g.undo.length, 1, "undo has 1 entry before end_turn")

	g = take(g, drafter, "end_turn")
	assert.equal(g.undo.length, 0, "undo cleared by end_turn — cannot undo a completed turn")
})

test("build action: undo restores hex road and build points", () => {
	let g = rules.setup(42, "Gold", { players: 3 })
	g = play_initial_picks(g)
	g = play_to_build_roads(g)
	g = play_to_building(g)
	if (g.phase !== "build_roads" || g.build_roads.state !== "building") return

	const builder = g.active
	const ci = g.build_roads.current_company
	const before_bp = g.build_roads.build_points_remaining
	const before_undo_len = g.undo.length  // may be > 0 (draft push_undo still on stack)

	const v = rules.view(g, builder)
	if (!v.actions?.build?.length) return

	const hex_id = v.actions.build[0]
	g = take(g, builder, "build", hex_id)

	assert.ok(g.hex_state[hex_id].roads.includes(ci), "road placed on hex after build")
	assert.ok(g.build_roads.build_points_remaining < before_bp, "BP reduced after build")
	assert.equal(g.undo.length, before_undo_len + 1, "build action pushed one undo entry")

	// Undo the build action
	g = take(g, builder, "undo")
	assert.ok(!g.hex_state[hex_id].roads.includes(ci), "road removed from hex after undo")
	assert.equal(g.build_roads.build_points_remaining, before_bp, "BP fully restored after undo")
	assert.equal(g.undo.length, before_undo_len, "undo stack back to pre-build depth")
})

// ── Group H: map.js module and refactor integration ──────────────
//
// These tests pin the shared map data so that:
//   - accidental edits to a row in MAPS are caught immediately
//   - the hex coordinate formula is locked to known expected values
//   - view.map_id is confirmed present so the client can look up the right map
//
// Reference values computed from MAPS.gold and verified by hand.

test("map.js: get_terrain returns correct terrain for known hexes", () => {
	const map = MAPS.gold
	// Cities — row 9 has city: [3, 9]
	assert.equal(get_terrain(map, 9, 3),  "city",     "9_3 should be city")
	assert.equal(get_terrain(map, 9, 9),  "city",     "9_9 should be city")
	// Mountain — row 8 has mountain: [6]
	assert.equal(get_terrain(map, 8, 6),  "mountain", "8_6 should be mountain")
	// River — row 10 has river: [2]
	assert.equal(get_terrain(map, 10, 2), "river",    "10_2 should be river")
	// Desert — row 6 has desert: [6,7,8]
	assert.equal(get_terrain(map, 6, 7),  "desert",   "6_7 should be desert")
	// Plain — row 0 col 0 has no special terrain
	assert.equal(get_terrain(map, 0, 0),  "plain",    "0_0 should be plain")
})

test("map.js: hex_label returns correct 18xx coordinates", () => {
	const map = MAPS.gold
	// Letters anchored to the full 17-row map: A = row 16 (top of screen),
	// Q = row 0 (bottom of screen). Index r=0 is the bottom-of-screen row.
	// Columns: col = 2*(c + offset) + (r%2===0 ? 1 : 0)
	assert.equal(hex_label(map, 9,  3),  "H8",  "city 9_3  → H8")
	assert.equal(hex_label(map, 9,  9),  "H20", "city 9_9  → H20")
	assert.equal(hex_label(map, 8,  6),  "I15", "mountain 8_6  → I15")
	assert.equal(hex_label(map, 0,  0),  "Q15", "bottom-right corner 0_0 → Q15")
	assert.equal(hex_label(map, 16, 0),  "A1",  "top-left corner 16_0 → A1")
})

test("setup: game.map_id defaults to 'gold' when options is empty", () => {
	const g = rules.setup(42, "Gold", { players: 3 })
	assert.equal(g.map_id, "gold", "map_id must be stored in game state")
})

test("setup: Granite scenario sets map_id to granite", () => {
	const g = rules.setup(42, "Granite", { players: 3 })
	assert.equal(g.map_id, "granite", "Granite scenario must set map_id to granite")
})

test("view: map_id present for active player, inactive player, and observer", () => {
	const g = rules.setup(42, "Gold", { players: 3 })
	const roles    = ["Blue", "Purple", "Magenta"]
	const inactive = roles.find(r => r !== g.active)

	const v_active   = rules.view(g, g.active)
	const v_inactive = rules.view(g, inactive)
	const v_observer = rules.view(g, "Observer")

	assert.equal(v_active.map_id,   "gold", "active player view must have map_id")
	assert.equal(v_inactive.map_id, "gold", "inactive player view must have map_id")
	assert.equal(v_observer.map_id, "gold", "observer view must have map_id")
})

test("setup: hex_state terrain matches MAPS.gold for known hexes", () => {
	// Use 5P so all 17 rows are present in the game
	const g = rules.setup(42, "Gold", { players: 5 })
	assert.equal(g.hex_state["9_3"]?.terrain,  "city",     "9_3  terrain: city")
	assert.equal(g.hex_state["9_9"]?.terrain,  "city",     "9_9  terrain: city")
	assert.equal(g.hex_state["8_6"]?.terrain,  "mountain", "8_6  terrain: mountain")
	assert.equal(g.hex_state["10_2"]?.terrain, "river",    "10_2 terrain: river")
	assert.equal(g.hex_state["6_7"]?.terrain,  "desert",   "6_7  terrain: desert")
	assert.equal(g.hex_state["0_0"]?.terrain,  "plain",    "0_0  terrain: plain")
})

test("setup: hex_state respects player_row_skip for each player count", () => {
	// Boundaries are derived from the map definition, not hardcoded,
	// so this test stays correct when player_row_skip values change or a
	// new map with a different row count / skip table is added.
	const map = MAPS.gold
	for (const pc of [3, 4, 5]) {
		const g      = rules.setup(42, "Gold", { players: pc })
		const skip   = map.player_row_skip[pc] || 0
		const max_r  = map.rows.length - skip
		const last_visible = max_r - 1
		const first_hidden = max_r

		assert.ok(g.hex_state[`${last_visible}_0`] !== undefined,
			`${pc}P: row ${last_visible} must be present (last visible row)`)

		if (skip > 0) {
			assert.ok(g.hex_state[`${first_hidden}_0`] === undefined,
				`${pc}P: row ${first_hidden} must be absent (first skipped row)`)
		}
	}
})

test("map.js: hex labels are top-anchored to the full map, stable under row-skip", () => {
	// Row letters must be anchored to the FULL map (map.rows.length), not to
	// the trimmed row count for a given player count. So a fixed physical hex
	// keeps its coordinate no matter how many top rows are hidden.
	//
	// Geometry: r=0 (Q, narrow) is at the BOTTOM of the screen; r=16 (A, wide)
	// is at the TOP. player_row_skip trims from the END of the rows array (high
	// indices = top of screen), so the top-VISIBLE row climbs the alphabet as
	// player count decreases: 5P→A, 4P→D, 3P→F.
	//
	// This catches a regression the other label tests cannot: at 5P the full
	// map and the visible map coincide, so an implementation that (wrongly)
	// anchored to the visible row count would still pass every 5P-based check.
	const map = MAPS.gold

	// 1. Same (r, c) yields the same label across every player count.
	for (const r of [0, 5, 11]) {
		const labels = [3, 4, 5].map(pc => {
			rules.setup(42, "Gold", { players: pc }) // skip changes per player count…
			return hex_label(map, r, 0)              // …but the label must not.
		})
		assert.equal(labels[0], labels[1], `row ${r}: 3P and 4P labels must match`)
		assert.equal(labels[1], labels[2], `row ${r}: 4P and 5P labels must match`)
	}

	// 2. The top-VISIBLE row (highest surviving array index) carries its
	//    full-map letter, not a relabeled "A".
	for (const pc of [3, 4, 5]) {
		const skip    = map.player_row_skip[pc] || 0
		const top_row = map.rows.length - skip - 1   // highest visible index = top of screen
		const letter  = String.fromCharCode(65 + (map.rows.length - 1 - top_row))
		const label   = hex_label(map, top_row, 0)
		assert.ok(label.startsWith(letter),
			`${pc}P: top visible row ${top_row} must be letter ${letter}, got ${label}`)
	}
	// Spell out the expected anchoring so the intent is obvious if this breaks.
	assert.ok(hex_label(map, 16, 0).startsWith("A"), "5P top visible row (r=16) → A")
	assert.ok(hex_label(map, 13, 0).startsWith("D"), "4P top visible row (r=13) → D")
	assert.ok(hex_label(map, 11, 0).startsWith("F"), "3P top visible row (r=11) → F")
})

// ── Multi-map invariants ─────────────────────────────────────────
//
// The tests above pin one specific map (gold). These tests run over
// EVERY map in MAPS, so adding or editing a map can't silently ship a
// structurally broken board (out-of-range terrain, no city to start a
// road in, a skip that hides the whole map, etc.).

test("map.js: every map is structurally valid", () => {
	for (const [id, map] of Object.entries(MAPS)) {
		assert.ok(map.name, `${id}: must have a display name`)
		assert.ok(map.road_track_start > 0, `${id}: road_track_start must be positive`)
		assert.ok(Array.isArray(map.rows) && map.rows.length > 0, `${id}: must have rows`)

		let city_count = 0
		map.rows.forEach((rd, r) => {
			assert.ok(rd.count > 0,  `${id} row ${r}: count must be positive`)
			assert.ok(rd.offset >= 0, `${id} row ${r}: offset must be >= 0`)
			for (const kind of ["city", "river", "mountain", "desert"]) {
				assert.ok(Array.isArray(rd[kind]),
					`${id} row ${r}: ${kind} must be an array`)
				for (const c of rd[kind]) {
					assert.ok(c >= 0 && c < rd.count,
						`${id} row ${r}: ${kind} index ${c} out of range [0,${rd.count})`)
				}
			}
			city_count += rd.city.length
		})

		// Companies must start their first road in a city, so a map with
		// zero cities is unplayable.
		assert.ok(city_count > 0, `${id}: must have at least one city`)

		// A skip must never hide every row.
		for (const [pc, skip] of Object.entries(map.player_row_skip || {})) {
			assert.ok(skip >= 0 && skip < map.rows.length,
				`${id}: player_row_skip[${pc}]=${skip} must leave at least one row`)
		}
	}
})

test("setup: Granite scenario round-trips map_id for every player count", () => {
	// Proves the Granite scenario works correctly for all player counts.
	for (const pc of [3, 4, 5]) {
		const g = rules.setup(42, "Granite", { players: pc })
		assert.equal(g.map_id, "granite", `${pc}P: granite map_id must round-trip`)
		const skip  = MAPS.granite.player_row_skip[pc] || 0
		const max_r = MAPS.granite.rows.length - skip
		assert.ok(g.hex_state[`${max_r - 1}_0`] !== undefined,
			`${pc}P: last visible row must exist on granite`)
	}
})

test("map.js: granite cities land at their published 18xx coordinates", () => {
	const map = MAPS.granite
	const labels = []
	map.rows.forEach((rd, r) => rd.city.forEach(c => labels.push(hex_label(map, r, c))))
	assert.deepEqual(labels.sort(),
		["B12", "K5", "M15", "N10", "O19", "Q11"].sort(),
		"granite cities must match the published layout B12/K5/M15/N10/O19/Q11")
})

test("setup: granite hex_state marks city terrain at the right hexes", () => {
	const g = rules.setup(42, "Granite", { players: 5 })
	assert.equal(g.hex_state["0_4"]?.terrain, "city",  "Q11 (0_4) must be a city")
	assert.equal(g.hex_state["2_8"]?.terrain, "city",  "O19 (2_8) must be a city")
	assert.equal(g.hex_state["6_0"]?.terrain, "city",  "K5  (6_0) must be a city")
	assert.equal(g.hex_state["1_0"]?.terrain, "plain", "a non-city granite hex must be plain")
})

// ── Subsidies variant ─────────────────────────────────────────────

test("setup: Subsidies_variant is stored in game state", () => {
	const g_on  = rules.setup(42, "Gold", { players: 3, Subsidies_variant: true })
	const g_off = rules.setup(42, "Gold", { players: 3 })
	assert.equal(g_on.subsidies,  true,  "Subsidies_variant:true must set subsidies=true")
	assert.equal(g_off.subsidies, false, "omitted option must set subsidies=false")
})

test("subsidies: each company receives $2 per share per player per unissued share", () => {
	let g = rules.setup(1, "Gold", { players: 3, Subsidies_variant: true })
	// 3P: per-share subsidy = $2 * 3 players = $6
	// 4 companies, 3 players each hold 2 shares → 6 shares total
	// Each company can hold at most 2; subsidy = (2 - held) * $6
	g = play_initial_picks(g)
	assert.notEqual(g.phase, "initial_share_pick", "draft must have ended")
	const total_subsidy = g.companies.reduce((sum, co) => sum + co.treasury, 0)
	// 8 possible shares; 6 issued → 2 unissued → 2 * $6 = $12 total subsidy
	assert.equal(total_subsidy, 12, "total subsidy across all companies must be $12 in 3P")
	for (const co of g.companies) {
		const expected = Math.max(0, 2 - co.shares.length) * 6
		assert.equal(co.treasury, expected,
			`${co.name}: treasury must equal (2 - ${co.shares.length}) * $6 = $${expected}`)
	}
})

test("subsidies: no treasury added when variant is off", () => {
	let g = rules.setup(1, "Gold", { players: 3 })
	g = play_initial_picks(g)
	for (const co of g.companies)
		assert.equal(co.treasury, 0, `${co.name}: treasury must be $0 without Subsidies variant`)
})

test("subsidies: per-share subsidy scales $2/share/player across player counts", () => {
	// Always exactly 2 unissued shares; per-share = $2 * num_players
	// 3P: 2 * ($2*3) = $12   4P: 2 * ($2*4) = $16   5P: 2 * ($2*5) = $20
	for (const [pc, expected] of [[3, 12], [4, 16], [5, 20]]) {
		let g = rules.setup(7, "Gold", { players: pc, Subsidies_variant: true })
		g = play_initial_picks(g)
		const total = g.companies.reduce((sum, co) => sum + co.treasury, 0)
		assert.equal(total, expected, `${pc}P: total subsidy must be $${expected}`)
	}
})

test("subsidies: works with Granite map", () => {
	let g = rules.setup(3, "Granite", { players: 4, Subsidies_variant: true })
	assert.equal(g.map_id,    "granite", "granite map must be selected")
	assert.equal(g.subsidies, true,      "subsidies flag must be set")
	g = play_initial_picks(g)
	const total = g.companies.reduce((sum, co) => sum + co.treasury, 0)
	// 4P: 2 unissued * ($2*4) = $16
	assert.equal(total, 16, "4P granite: total subsidy must be $16")
})

console.log("---")
console.log("Done.")

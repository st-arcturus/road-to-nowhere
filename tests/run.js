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

console.log("---")
console.log("Done.")

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

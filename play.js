"use strict"

// ── Display constants ─────────────────────────────────────────────

const COMPANY_DEFS = [
	{ key: "hovering", name: "Hovering Highways",   color: "#56B4E9", light: false },
	{ key: "muddy",    name: "Muddy Machinery",      color: "#CC79A7", light: false },
	{ key: "scuttle",  name: "Scuttle Surveyors",    color: "#BBBBBB", light: true  },
	{ key: "whooping", name: "Whooping Workzone",    color: "#191919", light: false },
	{ key: "buzzing",  name: "Buzzing Blacktop",     color: "#E69F00", light: true  },
	{ key: "coiled",   name: "Coiled Construction",  color: "#A8F1A4", light: true  },
]

const ROAD_TRACK_START = 25

const PLAYER_COLORS = [ "#0072B2", "#D55E00", "#9467BD", "#DC267F", "#44AA99" ]

function player_bg(i) {
	const c = PLAYER_COLORS[i] || "#888"
	const r = parseInt(c.slice(1,3), 16)
	const g = parseInt(c.slice(3,5), 16)
	const b = parseInt(c.slice(5,7), 16)
	return `rgb(${Math.round(r*.35+60*.65)},${Math.round(g*.35+60*.65)},${Math.round(b*.35+60*.65)})`
}

// Map rows — needed client-side for terrain lookup and hex geometry
const MAP_ROWS = [
	{ offset:7, count:4,  city:[],    river:[2],   mountain:[],    desert:[] },
	{ offset:7, count:4,  city:[0],   river:[2],   mountain:[],    desert:[] },
	{ offset:5, count:6,  city:[],    river:[3],   mountain:[],    desert:[5] },
	{ offset:5, count:6,  city:[],    river:[3],   mountain:[],    desert:[5] },
	{ offset:4, count:7,  city:[0],   river:[2,3], mountain:[],    desert:[5,6] },
	{ offset:3, count:8,  city:[],    river:[3],   mountain:[],    desert:[6,7] },
	{ offset:2, count:9,  city:[],    river:[3],   mountain:[],    desert:[6,7,8] },
	{ offset:2, count:9,  city:[],    river:[2,3], mountain:[],    desert:[6,7,8] },
	{ offset:1, count:10, city:[],    river:[2],   mountain:[6],   desert:[7,8,9] },
	{ offset:1, count:10, city:[3,9], river:[2],   mountain:[6],   desert:[7,8] },
	{ offset:0, count:11, city:[],    river:[2],   mountain:[5,6], desert:[8,9,10] },
	{ offset:1, count:10, city:[0],   river:[1],   mountain:[5],   desert:[7,8,9] },
	{ offset:0, count:11, city:[],    river:[2],   mountain:[5],   desert:[7,8,9,10] },
	{ offset:1, count:10, city:[3],   river:[2],   mountain:[4],   desert:[7,8,9] },
	{ offset:0, count:11, city:[],    river:[2],   mountain:[5,6], desert:[7,8,9,10] },
	{ offset:1, count:10, city:[9],   river:[2],   mountain:[5],   desert:[6,7,8] },
	{ offset:0, count:11, city:[],    river:[3],   mountain:[6],   desert:[7,8,9,10] },
]

const PLAYER_ROW_SKIP = { 3: 5, 4: 3, 5: 0 }

const HEX_SIZE = 26
const HEX_W = Math.sqrt(3) * HEX_SIZE
const HEX_H = 2 * HEX_SIZE

const TFILL = {
	plain:    "#2a2820",
	river:    "#192e3e",
	mountain: "#312e28",
	desert:   "#362e18",
	city:     "#3a3845",
}

const TICONS = { mountain: "▲", river: "≋", desert: "·" }
const TICOL  = { mountain: "#6a5f54", river: "#3e7898", desert: "#746c3a" }

// ── Map geometry ──────────────────────────────────────────────────

function get_terrain(r, c) {
	const rd = MAP_ROWS[r]
	if (rd.city.includes(c))     return "city"
	if (rd.river.includes(c))    return "river"
	if (rd.mountain.includes(c)) return "mountain"
	if (rd.desert.includes(c))   return "desert"
	return "plain"
}

function hex_center(r, c, skip) {
	const rd = MAP_ROWS[r]
	const dr = (MAP_ROWS.length - 1 - skip) - r
	const gc = c + rd.offset
	const x = HEX_W * (gc + (r % 2 === 1 ? -0.5 : 0)) + HEX_W * 0.5
	const y = HEX_H * 0.75 * dr + HEX_SIZE
	return [x, y]
}

function hex_corners(cx, cy, s) {
	const pts = []
	for (let i = 0; i < 6; i++) {
		const a = Math.PI / 180 * (60 * i - 30)
		pts.push(`${(cx + s * Math.cos(a)).toFixed(1)},${(cy + s * Math.sin(a)).toFixed(1)}`)
	}
	return pts.join(" ")
}

// ── Bid widget state ──────────────────────────────────────────────

let bid_amount = 1

// ── RTT client callbacks ──────────────────────────────────────────

function on_init(scenario, options) {
	// scenario ("3P"/"4P"/"5P") and options are fixed at game creation.
	// All dynamic state arrives through the view in on_update.
}

function on_update() {
	if (!view || !view.players || !view.players.length) return

	const pc   = view.players.length
	const skip = PLAYER_ROW_SKIP[pc] || 0
	const br   = view.build_roads || { state: "draft", current_company: null, build_points_remaining: 0 }

	const phase_labels = {
		initial_share_pick: "Initial Shares",
		bid:         "Bid for Turn Order",
		buy_shares:  "Buy Shares",
		build_roads: br.state === "draft" ? "Build Roads — Draft" : "Build Roads — Building",
		claim_land:  "Claim Land",
		game_end:    "Game Over",
	}

	document.getElementById("phase-badge").textContent = phase_labels[view.phase] || view.phase
	document.getElementById("round-lbl").textContent   = `Round ${view.round}`

	render_map(skip)
	render_left()
	render_right()

	if (view.final_scores) render_scores()
}

// ── Map rendering ─────────────────────────────────────────────────

function render_map(skip) {
	const svg    = document.getElementById("map")
	const max_r  = MAP_ROWS.length - skip
	const max_gc = Math.max(...MAP_ROWS.slice(0, max_r).map(rd => rd.offset + rd.count - 1))
	svg.innerHTML = ""
	svg.setAttribute("width",  HEX_W * (max_gc + 1.5) + 10)
	svg.setAttribute("height", HEX_H * 0.75 * (max_r - 1) + HEX_H + 10)

	const buildable = new Set((view.actions?.build  || []))
	const claimable = new Set((view.actions?.claim  || []))
	const ns = "http://www.w3.org/2000/svg"

	for (let r = 0; r < max_r; r++) {
		const rd = MAP_ROWS[r]
		for (let c = 0; c < rd.count; c++) {
			const hex_id  = `${r}_${c}`
			const terrain = get_terrain(r, c)
			const [cx, cy] = hex_center(r, c, skip)
			const hs = view.hex_state?.[hex_id]
			const g  = document.createElementNS(ns, "g")
			g.style.cursor = "pointer"

			// Hex fill
			const poly = document.createElementNS(ns, "polygon")
			poly.setAttribute("points", hex_corners(cx, cy, HEX_SIZE - 1))
			poly.setAttribute("fill", TFILL[terrain])
			if (buildable.has(hex_id)) {
				poly.setAttribute("stroke", "#c8a84b"); poly.setAttribute("stroke-width", "2")
			} else if (claimable.has(hex_id)) {
				poly.setAttribute("stroke", "#56B4E9"); poly.setAttribute("stroke-width", "1.8")
			} else {
				poly.setAttribute("stroke", "none"); poly.setAttribute("stroke-width", "0")
			}
			g.appendChild(poly)

			// Terrain icon / city buildings
			if (terrain === "city") {
				const bld_col = "#aeacc3"
				const b1 = document.createElementNS(ns, "rect")
				b1.setAttribute("x",      (cx - 13.1).toFixed(1))
				b1.setAttribute("y",      (cy - 12.6).toFixed(1))
				b1.setAttribute("width",  "12.6")
				b1.setAttribute("height", "25.2")
				b1.setAttribute("fill", bld_col)
				b1.setAttribute("pointer-events", "none")
				g.appendChild(b1)
				const b2 = document.createElementNS(ns, "rect")
				b2.setAttribute("x",      (cx - 1.4).toFixed(1))
				b2.setAttribute("y",      (cy - 5.4).toFixed(1))
				b2.setAttribute("width",  "14.4")
				b2.setAttribute("height", "18")
				b2.setAttribute("fill", bld_col)
				b2.setAttribute("pointer-events", "none")
				g.appendChild(b2)
			} else if (TICONS[terrain]) {
				const t = document.createElementNS(ns, "text")
				t.setAttribute("x", cx); t.setAttribute("y", cy + 4)
				t.setAttribute("text-anchor", "middle"); t.setAttribute("font-size", "11")
				t.setAttribute("fill", TICOL[terrain]); t.setAttribute("pointer-events", "none")
				t.textContent = TICONS[terrain]
				g.appendChild(t)
			}

			// Road cubes
			if (hs?.roads?.length) {
				const n = hs.roads.length
				const S = 12
				if (terrain === "city" && n > 1) {
					const cols = 3, gap = 2
					const rows = Math.ceil(n / cols)
					const grid_w = cols * S + (cols - 1) * gap
					const grid_h = rows * S + (rows - 1) * gap
					const x0 = cx - grid_w / 2, y0 = cy - grid_h / 2
					hs.roads.forEach((ci, i) => {
						const col = i % cols, row = Math.floor(i / cols)
						const rect = document.createElementNS(ns, "rect")
						rect.setAttribute("x", (x0 + col * (S + gap)).toFixed(1))
						rect.setAttribute("y", (y0 + row * (S + gap)).toFixed(1))
						rect.setAttribute("width", S); rect.setAttribute("height", S)
						rect.setAttribute("fill", COMPANY_DEFS[ci]?.color || "#888")
						rect.setAttribute("pointer-events", "none")
						g.appendChild(rect)
					})
				} else {
					const rect = document.createElementNS(ns, "rect")
					rect.setAttribute("x", (cx - S/2).toFixed(1)); rect.setAttribute("y", (cy - S/2).toFixed(1))
					rect.setAttribute("width", S); rect.setAttribute("height", S)
					rect.setAttribute("fill", COMPANY_DEFS[hs.roads[0]]?.color || "#888")
					rect.setAttribute("pointer-events", "none")
					g.appendChild(rect)
				}
			}

			// Claim disc
			if (hs?.disc != null) {
				const disc = document.createElementNS(ns, "circle")
				disc.setAttribute("cx", cx); disc.setAttribute("cy", cy); disc.setAttribute("r", "13")
				disc.setAttribute("fill", PLAYER_COLORS[hs.disc] || "#aaa")
				disc.setAttribute("fill-opacity", "0.5")
				disc.setAttribute("stroke", PLAYER_COLORS[hs.disc] || "#aaa")
				disc.setAttribute("stroke-width", "1")
				disc.setAttribute("pointer-events", "none")
				g.appendChild(disc)
			}

			// Highlight overlay
			if (buildable.has(hex_id) || claimable.has(hex_id)) {
				const ring = document.createElementNS(ns, "polygon")
				ring.setAttribute("points", hex_corners(cx, cy, HEX_SIZE - 3))
				ring.setAttribute("fill", buildable.has(hex_id) ? "rgba(200,168,75,0.12)" : "rgba(86,180,233,0.12)")
				ring.setAttribute("pointer-events", "none")
				g.appendChild(ring)
			}

			g.addEventListener("click",      ()  => on_hex_click(hex_id))
			g.addEventListener("mouseenter", (e) => show_tooltip(e, hex_id, terrain, hs))
			g.addEventListener("mouseleave", ()  => { document.getElementById("tt").style.display = "none" })
			svg.appendChild(g)
		}
	}
}

function on_hex_click(hex_id) {
	if (!view.actions) return
	if (view.actions.build?.includes(hex_id))  send_action("build", hex_id)
	else if (view.actions.claim?.includes(hex_id)) send_action("claim", hex_id)
}

function show_tooltip(e, hex_id, terrain, hs) {
	const tt    = document.getElementById("tt")
	const parts = [terrain.toUpperCase()]
	if (terrain === "mountain") parts.push("Cost: 2 BP")
	if (terrain === "desert")   parts.push("Cost: $1/hex")
	if (terrain === "river")    parts.push("No consecutive")
	if (hs?.roads?.length)      parts.push("Roads: " + hs.roads.map(ci => COMPANY_DEFS[ci]?.name.split(" ")[0]).join(", "))
	if (hs?.disc != null)       parts.push(`P${hs.disc + 1}'s claim`)
	tt.textContent = parts.join(" · ")
	tt.style.display = "block"
	tt.style.left = (e.clientX + 14) + "px"
	tt.style.top  = (e.clientY + 12) + "px"
}

// ── Left panel ────────────────────────────────────────────────────

function render_left() {
	// Companies
	const cl = document.getElementById("co-list")
	cl.innerHTML = ""
	view.companies.forEach((co, ci) => {
		const sv          = Math.ceil((ROAD_TRACK_START - co.road_track) / 2)
		const shares_left = 7 - co.shares.length
		const d = document.createElement("div")
		d.className = "co-card" + (co.active ? "" : " inactive")
		d.innerHTML = `
			<div class="co-dot" style="background:${COMPANY_DEFS[ci].color}"></div>
			<div class="co-nm">${co.name.split(" ")[0]}</div>
			<div class="co-stats">
				<div class="co-primary">
					<span class="co-val" title="Share value">$${sv}/sh</span>
					<span class="co-treas" title="Treasury">$${co.treasury}</span>
					${co.claim_owners?.length ? `<span class="co-claimval" title="Per claim">($${Math.ceil(co.treasury / co.claim_owners.length)}/cl)</span>` : ""}
				</div>
				<div class="co-claims-row" id="co-claims-${ci}"></div>
				<div class="co-secondary">
					<span title="Shares remaining">${shares_left}/7 sh</span>
					<span title="Road cubes remaining">${co.road_track} cubes</span>
				</div>
			</div>`
		cl.appendChild(d)
		// Claim owner counters
		if (co.claim_owners?.length) {
			const counts = {}
			co.claim_owners.forEach(o => { counts[o] = (counts[o] || 0) + 1 })
			const row = document.getElementById(`co-claims-${ci}`)
			Object.entries(counts).forEach(([owner, count]) => {
				const pip = document.createElement("div")
				pip.className = "claim-counter"
				pip.style.background = PLAYER_COLORS[owner] || "#aaa"
				pip.style.color = "#f0f0f0"
				pip.title = `Player ${+owner + 1}`
				pip.textContent = count
				row.appendChild(pip)
			})
		}
	})

	// Turn track
	const tt   = document.getElementById("ttrack")
	tt.innerHTML = ""
	const suf  = ["st", "nd", "rd", "th", "th"]

	function make_player_badge(pi) {
		const span = document.createElement("div")
		span.className = "tplayer-badge"
		span.style.background     = player_bg(pi)
		span.style.borderLeftColor = PLAYER_COLORS[pi] || "#888"
		span.textContent = `P${pi + 1}`
		span.title = `Player ${pi + 1}`
		return span
	}

	const top_row = document.createElement("div")
	top_row.className = "ttrack-row"
	view.turn_track.forEach((slot, i) => {
		const d   = document.createElement("div")
		d.className = "tslot" + (slot.player == null ? " empty" : "")
		const pos = document.createElement("div")
		pos.className   = "tpos"
		pos.textContent = `${i + 1}${suf[i] || ""}`
		d.appendChild(pos)
		if (slot.player != null) d.appendChild(make_player_badge(slot.player))
		top_row.appendChild(d)
	})

	const bot_row = document.createElement("div")
	bot_row.className = "ttrack-row"
	view.turn_track.forEach(slot => {
		const d = document.createElement("div")
		const has_bot  = slot.bottom_player != null
		const has_cube = slot.cube != null
		d.className = "tslot" + (!has_bot && !has_cube ? " empty" : "")
		if (has_bot) {
			d.appendChild(make_player_badge(slot.bottom_player))
		} else if (has_cube) {
			const cube = document.createElement("div")
			cube.className = "tcube-bot"
			cube.style.background = COMPANY_DEFS[slot.cube]?.color || "#888"
			cube.title = view.companies[slot.cube]?.name
			d.appendChild(cube)
		}
		bot_row.appendChild(d)
	})

	tt.appendChild(top_row)
	tt.appendChild(bot_row)

	// Active box
	const ab = document.getElementById("abox")
	ab.innerHTML = ""
	if (!view.active_box?.length) {
		ab.innerHTML = '<span style="color:var(--muted);font-size:9px">empty</span>'
	} else {
		view.active_box.forEach(ci => {
			const cube = document.createElement("div")
			cube.className        = "acube"
			cube.style.background = COMPANY_DEFS[ci]?.color || "#888"
			cube.title            = view.companies[ci]?.name
			ab.appendChild(cube)
		})
	}

	// Log
	const log = document.getElementById("log")
	log.innerHTML = ""
	;(view.log || []).slice(-30).forEach((entry, i, arr) => {
		const d = document.createElement("div")
		d.className   = "logentry" + (i === arr.length - 1 ? " hi" : "")
		d.textContent = entry
		log.appendChild(d)
	})
	log.scrollTop = log.scrollHeight
}

// ── Right panel ───────────────────────────────────────────────────

function render_right() {
	const pl = document.getElementById("pl-list")
	pl.innerHTML = ""

	const sorted = view.players
		.map((p, i) => ({ ...p, i }))
		.sort((a, b) => (a.disc_on_track || 99) - (b.disc_on_track || 99))

	for (const p of sorted) {
		const is_active = p.i === view.active_player
		const d = document.createElement("div")
		d.className = "plcard"
		d.innerHTML = `
			<div class="plhdr">
				<div class="plpos">${p.disc_on_track ? p.disc_on_track + "." : "—"}</div>
				${is_active ? '<div class="pldot"></div>' : ""}
				<div class="plnm" style="background:${player_bg(p.i)};border-left:2px solid ${PLAYER_COLORS[p.i] || "#888"};padding:1px 5px;border-radius:2px;">P${p.i + 1}</div>
				<div class="plcash">$${p.cash}</div>
				${p.last_bid ? `<div class="pl-bid" title="Last bid">bid $${p.last_bid}</div>` : ""}
			</div>
			<div class="pl-meta">
				<span class="pl-claims" title="Claim discs remaining">${p.claims_left}/10 claims</span>
			</div>
			<div class="pips" id="pips-${p.i}"></div>`
		pl.appendChild(d)

		const pips_el = document.getElementById(`pips-${p.i}`)
		const share_counts = {}
		p.shares.forEach(ci => { share_counts[ci] = (share_counts[ci] || 0) + 1 })
		Object.entries(share_counts).forEach(([ci, count]) => {
			ci = parseInt(ci)
			const pip = document.createElement("div")
			pip.className        = "pip-counter"
			pip.style.background = COMPANY_DEFS[ci]?.color || "#888"
			pip.style.color      = COMPANY_DEFS[ci]?.light ? "#111" : "#f0f0f0"
			pip.title            = view.companies[ci]?.name
			pip.textContent      = count
			pips_el.appendChild(pip)
		})
	}

	render_actions()
}

// ── Actions panel ─────────────────────────────────────────────────

function render_actions() {
	const msg_el = document.getElementById("actmsg")
	const btn_el = document.getElementById("actbtns")
	btn_el.innerHTML = ""

	msg_el.textContent = view.prompt || ""

	if (!view.actions) return

	const br = view.build_roads
	const ap = view.active_player

	// Initial share pick
	if (view.actions.pick_share) {
		view.actions.pick_share.forEach(ci => {
			const btn = document.createElement("button")
			btn.className = "btn primary"
			btn.innerHTML = `<span style="display:inline-block;width:10px;height:10px;background:${COMPANY_DEFS[ci].color};margin-right:6px;vertical-align:middle"></span>${view.companies[ci].name}`
			btn.onclick = () => send_action("pick_share", ci)
			btn_el.appendChild(btn)
		})
	}

	// Bid phase
	if (view.actions.pass || view.actions.raise) {
		const min_bid = (view.bid.current_bid || 0) + 1
		const max_bid = view.players[ap].cash
		if (bid_amount < min_bid) bid_amount = min_bid
		if (bid_amount > max_bid) bid_amount = max_bid

		const hint = document.createElement("div")
		hint.className   = "bid-hint"
		hint.textContent = `Winning bid: $${view.bid.current_bid} · Your cash: $${max_bid}`
		btn_el.appendChild(hint)

		const widget  = document.createElement("div");  widget.className = "bid-widget"
		const row     = document.createElement("div");  row.className    = "bid-row"
		const counter = document.createElement("div");  counter.className = "bid-counter"

		const btn_minus = document.createElement("button"); btn_minus.textContent = "−"
		btn_minus.disabled = bid_amount <= min_bid
		btn_minus.onclick  = () => { bid_amount = Math.max(min_bid, bid_amount - 1); render_actions() }

		const val_span = document.createElement("span"); val_span.className = "bid-val"; val_span.textContent = `$${bid_amount}`

		const btn_plus = document.createElement("button"); btn_plus.textContent = "+"
		btn_plus.disabled = bid_amount >= max_bid
		btn_plus.onclick  = () => { bid_amount = Math.min(max_bid, bid_amount + 1); render_actions() }

		counter.appendChild(btn_minus); counter.appendChild(val_span); counter.appendChild(btn_plus)

		const bid_btn = document.createElement("button")
		bid_btn.className   = "btn primary"
		bid_btn.style.flex  = "1"
		bid_btn.style.marginBottom = "0"
		bid_btn.textContent = `Bid $${bid_amount}`
		bid_btn.disabled    = bid_amount > max_bid || bid_amount <= view.bid.current_bid
		bid_btn.onclick     = () => { send_action("raise", bid_amount) }

		row.appendChild(counter); row.appendChild(bid_btn); widget.appendChild(row)

		const pass_btn = document.createElement("button")
		pass_btn.className   = "btn danger"
		pass_btn.textContent = "Pass"
		pass_btn.onclick     = () => send_action("pass", 0)
		widget.appendChild(pass_btn)

		btn_el.appendChild(widget)
	}

	// Buy shares
	if (view.actions.buy) {
		const bid_amt = view.bid.bids?.[ap] || 0
		const is_1st  = view.players[ap].disc_on_track === 1
		const cost    = is_1st ? bid_amt : Math.ceil(bid_amt / 2)

		const hint = document.createElement("div"); hint.className = "bid-hint"; hint.style.marginBottom = "6px"
		hint.textContent = `Bid $${bid_amt} → pay $${cost}${is_1st ? " (1st, full)" : " (half, rounded up)"}`
		btn_el.appendChild(hint)

		const grid = document.createElement("div"); grid.className = "buy-grid"
		view.actions.buy.forEach(ci => {
			const btn = document.createElement("button"); btn.className = "btn buy-btn primary"
			btn.innerHTML = `<div class="buy-dot" style="background:${COMPANY_DEFS[ci].color}"></div>${view.companies[ci].name}`
			btn.onclick = () => send_action("buy", ci)
			grid.appendChild(btn)
		})
		btn_el.appendChild(grid)
	}

	// Build roads — draft
	if (view.actions.pick_company) {
		const grid = document.createElement("div"); grid.className = "draft-grid"
		view.actions.pick_company.forEach(ci => {
			const btn = document.createElement("button"); btn.className = "btn draft-btn primary"
			btn.innerHTML = `<div class="draft-dot" style="background:${COMPANY_DEFS[ci].color}"></div>${view.companies[ci].name}`
			btn.onclick = () => send_action("pick_company", ci)
			grid.appendChild(btn)
		})
		btn_el.appendChild(grid)
	}

	// Build roads — building
	if (view.actions.build) {
		const hint = document.createElement("div"); hint.className = "maphint"
		hint.textContent = `${view.actions.build.length} valid hex${view.actions.build.length > 1 ? "es" : ""} highlighted — click map to build`
		btn_el.appendChild(hint)
	}
	if (view.actions.pass_build) {
		const btn = document.createElement("button"); btn.className = "btn danger"
		btn.textContent = "Done Building (no legal moves)"
		btn.onclick = () => send_action("pass_build", 0)
		btn_el.appendChild(btn)
	}

	// Claim land
	if (view.actions.claim) {
		const hint = document.createElement("div"); hint.className = "maphint"
		hint.textContent = `${view.actions.claim.length} hex${view.actions.claim.length > 1 ? "es" : ""} available — click map to claim`
		btn_el.appendChild(hint)
	}
}

// ── Score card ────────────────────────────────────────────────────

let scorecard_wired = false

function render_scores() {
	const card = document.getElementById("scorecard")
	card.style.display = "block"

	if (!scorecard_wired) {
		scorecard_wired = true
		document.getElementById("score-minimize").addEventListener("click", () => {
			card.classList.toggle("minimized")
			document.getElementById("score-minimize").textContent =
				card.classList.contains("minimized") ? "□" : "—"
		})
		// Draggable
		const hdr = document.getElementById("scorecard-header")
		let mx = 0, my = 0
		hdr.addEventListener("mousedown", e => {
			mx = e.clientX; my = e.clientY
			const r = card.getBoundingClientRect()
			card.style.top    = r.top  + "px"
			card.style.left   = r.left + "px"
			card.style.bottom = "auto"
			card.style.right  = "auto"
			function on_move(e) {
				const dx = e.clientX - mx, dy = e.clientY - my
				mx = e.clientX; my = e.clientY
				card.style.top  = (card.offsetTop  + dy) + "px"
				card.style.left = (card.offsetLeft + dx) + "px"
			}
			function on_up() {
				document.removeEventListener("mousemove", on_move)
				document.removeEventListener("mouseup", on_up)
			}
			document.addEventListener("mousemove", on_move)
			document.addEventListener("mouseup", on_up)
		})
	}

	const rows = document.getElementById("scorerows")
	rows.innerHTML = ""
	view.final_scores.forEach((s, i) => {
		const d = document.createElement("div")
		d.className = "scorerow" + (i === 0 ? " winner" : "")
		d.innerHTML = `<span>P${s.player + 1}${i === 0 ? " ★" : ""}</span><span>$${s.total}</span>`
		rows.appendChild(d)
		const det = document.createElement("div"); det.className = "scoredet"
		det.textContent = `cash $${s.cash}  +  shares $${s.shares}  +  claims $${s.claims}`
		rows.appendChild(det)
	})
}

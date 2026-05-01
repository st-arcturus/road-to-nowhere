"use strict"

// ── Display constants ─────────────────────────────────────────────

const COMPANY_DEFS = [
	{ key: "hovering", name: "Hovering Highways",   color: "#56B4E9", light: false },
	{ key: "muddy",    name: "Muddy Machinery",      color: "#CC79A7", light: false },
	{ key: "scuttle",  name: "Scuttle Surveyors",    color: "#7D3C00", light: false },
	{ key: "whooping", name: "Whooping Workzone",    color: "#191919", light: false },
	{ key: "buzzing",  name: "Buzzing Blacktop",     color: "#E69F00", light: true  },
	{ key: "coiled",   name: "Coiled Construction",  color: "#A8F1A4", light: true  },
]

const ROAD_TRACK_START = 25

const PLAYER_COLORS = [ "#0072B2", "#D55E00", "#9467BD", "#DC267F", "#44AA99" ]

// Light pastel tint for player backgrounds on the white left panel
function player_bg_light(i) {
	const c = PLAYER_COLORS[i] || "#888"
	const r = parseInt(c.slice(1,3), 16)
	const g = parseInt(c.slice(3,5), 16)
	const b = parseInt(c.slice(5,7), 16)
	return `rgb(${Math.round(r*.5+255*.5)},${Math.round(g*.5+255*.5)},${Math.round(b*.5+255*.5)})`
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

const TFILL = "#e8e8e8"

const TICONS = { mountain: { g: "▲", sz: 17 }, river: { g: "≋", sz: 11 }, desert: { g: "★", sz: 17 } }

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

function get_phase_label() {
	const br = view.build_roads
	const labels = {
		initial_share_pick: "Initial Shares",
		bid:         "Bid for Turn Order",
		buy_shares:  "Buy Shares",
		build_roads: br?.state === "draft" ? "Build Roads — Draft" : "Build Roads — Building",
		claim_land:  "Claim Land",
		game_end:    "Game Over",
	}
	return labels[view.phase] || view.phase
}

function on_update() {
	if (!view || !view.players || !view.players.length) return

	const pc   = view.players.length
	const skip = PLAYER_ROW_SKIP[pc] || 0

	render_map(skip)
	render_left()
	render_players()

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
			poly.setAttribute("fill", TFILL)
			if (buildable.has(hex_id)) {
				poly.setAttribute("stroke", "#c8a84b"); poly.setAttribute("stroke-width", "2")
			} else if (claimable.has(hex_id)) {
				poly.setAttribute("stroke", "#56B4E9"); poly.setAttribute("stroke-width", "1.8")
			} else {
				poly.setAttribute("stroke", "#3a3a3a"); poly.setAttribute("stroke-width", "0.8")
			}
			g.appendChild(poly)

			// Terrain icon / city buildings
			if (terrain === "city") {
				const b1 = document.createElementNS(ns, "rect")
				b1.setAttribute("x",      (cx - 13.1).toFixed(1))
				b1.setAttribute("y",      (cy - 12.6).toFixed(1))
				b1.setAttribute("width",  "12.6")
				b1.setAttribute("height", "25.2")
				b1.setAttribute("fill", TFILL)
				b1.setAttribute("stroke", "#111")
				b1.setAttribute("stroke-width", "1")
				b1.setAttribute("pointer-events", "none")
				g.appendChild(b1)
				const b2 = document.createElementNS(ns, "rect")
				b2.setAttribute("x",      (cx - 1.4).toFixed(1))
				b2.setAttribute("y",      (cy - 5.4).toFixed(1))
				b2.setAttribute("width",  "14.4")
				b2.setAttribute("height", "18")
				b2.setAttribute("fill", TFILL)
				b2.setAttribute("stroke", "#111")
				b2.setAttribute("stroke-width", "1")
				b2.setAttribute("pointer-events", "none")
				g.appendChild(b2)
			} else if (TICONS[terrain]) {
				const icon = TICONS[terrain]
				const t = document.createElementNS(ns, "text")
				t.setAttribute("x", cx); t.setAttribute("y", cy)
				t.setAttribute("text-anchor", "middle")
				t.setAttribute("dominant-baseline", "central")
				t.setAttribute("font-size", icon.sz)
				t.setAttribute("fill", "#111")
				t.setAttribute("pointer-events", "none")
				t.textContent = icon.g
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
		d.style.borderLeft = `10px solid ${COMPANY_DEFS[ci].color}`
		d.innerHTML = `
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
		span.style.background = PLAYER_COLORS[pi] || "#888"
		span.style.color = "#fff"
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

}

// ── Log (RTT framework calls this per entry) ──────────────────────

function on_log(text) {
	const p = document.createElement("div")
	if (text.startsWith("===")) {
		p.className = "log-section"
		p.textContent = text.replace(/^=+\s*|\s*=+$/g, "")
	} else if (text.startsWith("---")) {
		p.className = "log-phase"
		p.textContent = text.replace(/^-+\s*|\s*-+$/g, "")
	} else if (text.startsWith("=co=")) {
		const def = COMPANY_DEFS.find(c => c.key === text.slice(4))
		p.className = "log-company"
		p.textContent = def ? def.name : text.slice(4)
		if (def) {
			p.style.backgroundColor = def.color
			p.style.color = def.light ? "#111" : "#f0f0f0"
		}
	} else {
		p.textContent = text
	}
	return p
}

// ── Player info (merged with RTT #roles) ─────────────────────────
// The framework creates #role_P1, #role_P2 etc. inside #roles.
// We populate .role_stat with cash/bid, and append a .role_pips row
// for disc position, shares, and claims. The framework handles the
// active/present classes and the username link in .role_user.

function render_players() {
	view.players.forEach((p, i) => {
		const role_el = document.getElementById(`role_P${i + 1}`)
		if (!role_el) return

		role_el.style.backgroundColor = player_bg_light(i)

		const stat = role_el.querySelector(".role_stat")
		if (stat) {
			stat.innerHTML = `<span class="rstat-cash">$${p.cash}</span>` +
				(p.last_bid ? `<br><span class="rstat-bid">bid $${p.last_bid}</span>` : "")
		}

		let pips_el = role_el.querySelector(".role_pips")
		if (!pips_el) {
			pips_el = document.createElement("div")
			pips_el.className = "role_pips"
			role_el.appendChild(pips_el)
		}
		pips_el.innerHTML = ""

		const pos = document.createElement("span")
		pos.className = "rstat-pos"
		pos.textContent = p.disc_on_track ? `${p.disc_on_track}.` : "—"
		pips_el.appendChild(pos)

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

		const claims = document.createElement("span")
		claims.className = "rstat-claims"
		claims.textContent = `${p.claims_left} cl`
		pips_el.appendChild(claims)
	})

	render_actions()
}

// ── Actions panel ─────────────────────────────────────────────────

function render_actions() {
	const msg_el = document.getElementById("prompt")
	const btn_el = document.getElementById("actions")
	if (!msg_el || !btn_el) return
	btn_el.innerHTML = ""
	msg_el.innerHTML = ""

	const prompt = view.prompt || ""
	if (prompt) msg_el.appendChild(document.createTextNode(prompt))

	if (!view.actions) return

	const br = view.build_roads
	const ap = view.active_player

	// Buy shares — append bid cost info directly into the prompt
	if (view.actions.buy) {
		const bid_amt = view.bid.bids?.[ap] || 0
		const is_1st  = view.players[ap].disc_on_track === 1
		const cost    = is_1st ? bid_amt : Math.ceil(bid_amt / 2)
		const span = document.createElement("span")
		span.className = "bid-hint"
		span.textContent = (prompt ? " · " : "") + `Bid $${bid_amt} → pay $${cost}${is_1st ? " (1st, full)" : " (half, rounded up)"}`
		msg_el.appendChild(span)
	}

	// Build roads — append hex count to prompt
	if (view.actions.build) {
		const n = view.actions.build.length
		const span = document.createElement("span")
		span.className = "maphint"
		span.textContent = (prompt ? " · " : "") + `${n} valid hex${n > 1 ? "es" : ""} highlighted — click to build`
		msg_el.appendChild(span)
	}

	if (view.actions.pick_share) {
		view.actions.pick_share.forEach(ci => {
			const btn = document.createElement("button")
			btn.textContent = view.companies[ci].name
			btn.style.backgroundColor = COMPANY_DEFS[ci].color
			btn.style.color = COMPANY_DEFS[ci].light ? "#111" : "#f0f0f0"
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

		const widget  = document.createElement("div"); widget.className = "bid-widget"
		const counter = document.createElement("div"); counter.className = "bid-counter"

		const btn_minus = document.createElement("button"); btn_minus.textContent = "−"
		btn_minus.disabled = bid_amount <= min_bid
		btn_minus.onclick  = () => { bid_amount = Math.max(min_bid, bid_amount - 1); render_actions() }

		const val_span = document.createElement("span"); val_span.className = "bid-val"; val_span.textContent = `$${bid_amount}`

		const btn_plus = document.createElement("button"); btn_plus.textContent = "+"
		btn_plus.disabled = bid_amount >= max_bid
		btn_plus.onclick  = () => { bid_amount = Math.min(max_bid, bid_amount + 1); render_actions() }

		counter.appendChild(btn_minus); counter.appendChild(val_span); counter.appendChild(btn_plus)

		const bid_btn = document.createElement("button")
		bid_btn.textContent = `Bid $${bid_amount}`
		bid_btn.disabled    = bid_amount > max_bid || bid_amount <= view.bid.current_bid
		bid_btn.onclick     = () => { if (view.actions) view.actions.raise = [bid_amount]; send_action("raise", bid_amount) }

		const pass_btn = document.createElement("button")
		pass_btn.textContent = "Pass"
		pass_btn.onclick     = () => send_action("pass")

		widget.appendChild(counter)
		widget.appendChild(bid_btn)
		widget.appendChild(pass_btn)

		btn_el.appendChild(widget)
	}

	// Buy shares
	if (view.actions.buy) {
		view.actions.buy.forEach(ci => {
			const btn = document.createElement("button")
			btn.textContent = view.companies[ci].name
			btn.style.backgroundColor = COMPANY_DEFS[ci].color
			btn.style.color = COMPANY_DEFS[ci].light ? "#111" : "#f0f0f0"
			btn.onclick = () => send_action("buy", ci)
			btn_el.appendChild(btn)
		})
	}

	// Build roads — draft
	if (view.actions.pick_company) {
		view.actions.pick_company.forEach(ci => {
			const btn = document.createElement("button")
			btn.textContent = view.companies[ci].name
			btn.style.backgroundColor = COMPANY_DEFS[ci].color
			btn.style.color = COMPANY_DEFS[ci].light ? "#111" : "#f0f0f0"
			btn.onclick = () => send_action("pick_company", ci)
			btn_el.appendChild(btn)
		})
	}

	// Build roads — building
	if (view.actions.pass_build) {
		const btn = document.createElement("button")
		btn.textContent = "Done Building (no legal moves)"
		btn.onclick = () => send_action("pass_build")
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

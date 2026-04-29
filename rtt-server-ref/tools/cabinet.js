/*

CABINET PROJECTION PIECE GENERATOR

Generate graphics of wood pieces with cabinet projection, in a simple
flat-shaded style with stroked outlines.

The cabinet projection is an oblique projection, that is not quite
isometric: we scale the depth axis by 1 / sqrt(2). With this factor the
pieces don't look too elongated, and the offset in each axis is exactly
1/2 of the piece depth.

We draw a 1px stroked line that is grid aligned (so centered at (0.5,
0.5) and size the pieces so that if you line them up the edge strokes
of adjacent pieces will overlap.

Example: A cube that is 20 pixels in each dimension:

	The top face of the cube is 19 x 19 filled, with a 1px stroked
	outline, for a total size of 21 x 21.

	The sides are offset by +10,+10, resulting in a 31x31 pixel
	wide drawing.

	Outside of this we add a 3px margin on each side, for drawing a
	3px thick highlight. Total size including this margin is 37 x 37.

We also generate shapes that can be stacked under the piece to draw an
extended outline to highlight active and and selected pieces.

Most pieces are generated with the shape seen from above (so lying flat
on the map) but we can also generate pieces standing up with the shaped
side facing "south".

NOTE: Concave shapes may need manual cleanup to remove partially and
fully obscured lines.

*/

"use strict"

const fs = require("fs")

const { brightness } = require("./oklab.js")

// https://jfly.uni-koeln.de/color/
const palette = {
	black: "#000000",
	orange: "#e69f00",
	skyblue: "#56b4e9",
	green: "#009e73",
	yellow: "#f0e442",
	blue: "#0072b2",
	red: "#d55e00",
	purple: "#cc79a7",
}

var stroke_width = 1
var outline_width = 3
var outline = (outline_width * 2) + stroke_width
var debug = false

function darker(color, m=0.8) {
	return brightness(color, m)
}

function darkest(color) {
	return "#000"
}

function enable_logging() {
	debug = true
}

function set_stroke_width(w) {
	stroke_width = w
	outline = (outline_width * 2) + stroke_width
}

function set_outline_width(w) {
	outline_width = w
	outline = (outline_width * 2) + stroke_width
}

function emit(output, w, h, dx, dy, lines) {
	var margin = outline / 2
	w = Math.ceil(w + dx + margin * 2)
	h = Math.ceil(h + dy + margin * 2)
	var t = outline_width + dy
	var r = outline_width + stroke_width
	var b = outline_width + stroke_width
	var l = outline_width + dx
	if (debug)
		console.log(`CABINET { width: ${w}px; height: ${h}px; margin: -${t}px -${r}px -${b}px -${l}px; background-image: url(${output}); }`)
	if (typeof lines === "string")
		lines = lines.trim().split("\n").map(line => line.trim()).filter(line => line.length > 0)
	fs.writeFileSync(output,
		`<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="${w}" height="${h}">\n` +
		`<g transform="translate(${margin},${margin})" stroke-width="${stroke_width}" stroke-linejoin="round" stroke-linecap="round">\n` +
		lines.join("\n") +
		"\n</g>\n</svg>\n"
	)
}

function read_png(path, w, h, x=0, y=0) {
	// NOTE: Always use w and h 1 smaller than piece that uses it!
	// NOTE: Make sure the PNG is transparent as we don't apply any clipping!
	var data = fs.readFileSync(path).toString("base64")
	return `<image xlink:href="data:image/png;base64,${data}" x="${x+.5}" y="${y+.5}" width="${w}" height="${h}"/>`
}

function read_svg(path, sx=1, sy=1, tx=0, ty=0, atts=null) {
	// NOTE: The SVG to be used as a badge must be simple and already sized correctly!
	// We trim the first and last lines (assuming the <svg> start and end tag are on their
	// own lines. Use `svgo --pretty` to clean up the file if that's not the case.
	// TODO: parse header width/height and apply scaling.
	var data = fs.readFileSync(path, "utf-8")
	data = data.split("\n").slice(1,-2)
	if (atts) {
		data.unshift(`<g ${atts}>`)
		data.push("</g>")
	}
	if (tx !== 0 || ty !== 0 || sx !== 1 || sy !== 1) {
		data.unshift(`<g transform="translate(${tx},${ty}) scale(${sx},${sy})">`)
		data.push("</g>")
	}
	return data.join("\n")
}

function parse_path(text) {
	// limited SVG path syntax parser
	var mode = 'M'
	var path = []
	var pen = [ 0, 0 ]
	var k, v
	for (var i of text.replaceAll(",", " ").split(" ")) {
		if ("MLHVZmlhvz".indexOf(i) >= 0) {
			mode = i
			k = 0
		} else {
			v = Number(i)
			if (mode === 'M' || mode === 'L') { pen[k++] = v; }
			if (mode === 'm' || mode === 'l') { pen[k++] += v; }
			if (mode === 'H') { pen[0] = v; k = 2; }
			if (mode === 'h') { pen[0] += v; k = 2; }
			if (mode === 'V') { pen[1] = v; k = 2; }
			if (mode === 'v') { pen[1] += v; k = 2; }
			if (k === 2) {
				path.push(pen.slice())
				k = 0
			}
		}
	}
	return path
}

function polygon_path(n, rx, ry, rotate) {
	var start = rotate * Math.PI / 180
	var delta = 2 * Math.PI / n
	var verts = []
	for (var i = 0; i < n; ++i) {
		var a = start + i * delta
		var x = Math.sin(a) * rx + rx
		var y = Math.cos(a) * ry + ry
		verts.push([x,y])
	}
	return round_path(verts)
}

function star_path(n, big, small, rotate) {
	var start = rotate * Math.PI / 180
	var delta = 2 * Math.PI / (n * 2)
	var verts = []
	for (var i = 0; i < n * 2; ++i) {
		var a = start + i * delta
		var x = Math.sin(a) * (i & 1 ? big : small) + big
		var y = Math.cos(a) * (i & 1 ? big : small) + big
		verts.push([x,y])
	}
	return round_path(verts)
}

function angle_from_vector(dx, dy) {
	// angle CCW from +x
	// east = 0
	// north = 90
	// west = 180
	// south = 270
	return Math.round(360 + Math.atan2(-dy, dx) * 180 / Math.PI) % 360
}

function angle_from_line(a, b) {
	var [ x1, y1 ] = a
	var [ x2, y2 ] = b
	return angle_from_vector(x2 - x1, y2 - y1)
}

function bound_path(points) {
	var [ x0, y0 ] = points[0]
	var [ x1, y1 ] = points[0]
	for (var [x,y] of points) {
		x0 = Math.min(x0, x)
		y0 = Math.min(y0, y)
		x1 = Math.max(x1, x)
		y1 = Math.max(y1, y)
	}
	return [ x0, y0, x1 - x0, y1 - y0 ]
}

function translate_path(points, dx, dy) {
	return points.map(([x,y]) => [ x + dx, y + dy ])
}

function scale_path(points, sx, sy) {
	return points.map(([x,y]) => [ x * sx, y * sy ])
}

function shear_path(points) {
	return points.map(([x,y]) => [ x + y, y ])
}

function rotate_path(points, deg, px=0, py=0) {
	var rad = deg * Math.PI / 180
	var c = Math.cos(rad)
	var s = Math.sin(rad)
	return points.map(([x,y]) => [
		px + (x-px) * c - (y-py) * s,
		py + (y-py) * c + (x-px) * s
	])
}

function close_path(points) {
	points = points.slice()
	if (points[0] != points.at(-1))
		points.push(points[0])
	return points
}

function round_path(path) {
	return path.map(([x,y]) => [ Math.round(x), Math.round(y) ])
}

function draw_prism_to_edit(shape, size_w, size_h, depth, fill, symbol, output) {
	var dx = depth/2, dy = depth/2
	var dark = darker(fill)
	var stroke = darkest(fill)
	var origin_x = 0
	var origin_y = 0

	var top = close_path(shape)

	// compute image size if needed
	if (!size_w) {
		[ origin_x, origin_y, size_w, size_h ] = bound_path(top)
		top = translate_path(top, -origin_x, -origin_y)
	}

	// bottom face
	var bot = translate_path(top, dx, dy)

	var svg = []

	// FILLS

	for (var i = 1; i < top.length; ++i) {
		var a = angle_from_line(top[i-1], top[i])
		if (a >= 315 || a <= 135)
			svg.push(`<path fill="${dark}" stroke="${stroke}" d="M ${top[i-1]} ${top[i]} ${bot[i]} ${bot[i-1]} z"/>`)
	}

	svg.push(`<path fill="${fill}" stroke="${stroke}" d="M ${top.join(" ")} z"/>`)

	// SYMBOL

	if (symbol) {
		if (origin_x !== 0 || origin_y !== 0) {
			svg.push(`<g transform="translate(${-origin_x},${-origin_y})">`)
			svg.push(symbol)
			svg.push(`</g>`)
		} else {
			svg.push(symbol)
		}
	}

	emit(output, size_w, size_h, dx, dy, svg)
}

function draw_prism(shape, size_w, size_h, depth, fill, symbol, output) {
	var dx = depth/2, dy = depth/2
	var dark = darker(fill)
	var stroke = darkest(fill)
	var origin_x = 0
	var origin_y = 0

	var top = close_path(shape)

	// compute image size if needed
	if (!size_w) {
		[ origin_x, origin_y, size_w, size_h ] = bound_path(top)
		top = translate_path(top, -origin_x, -origin_y)
	}

	// bottom face
	var bot = translate_path(top, dx, dy)

	var svg = []

	// FILLS

	for (var i = 1; i < top.length; ++i) {
		var a = angle_from_line(top[i-1], top[i])
		if (a >= 315 || a <= 135)
			svg.push(`<path fill="${dark}" d="M ${top[i-1]} ${top[i]} ${bot[i]} ${bot[i-1]} z"/>`)
	}

	svg.push(`<path fill="${fill}" d="M ${top.join(" ")} z"/>`)

	// SYMBOL

	if (symbol) {
		if (origin_x !== 0 || origin_y !== 0) {
			svg.push(`<g transform="translate(${-origin_x},${-origin_y})">`)
			svg.push(symbol)
			svg.push(`</g>`)
		} else {
			svg.push(symbol)
		}
	}

	// STROKES

	var bot_stroke = []
	var con_stroke = []
	var on = false
	for (var i = 1; i < top.length; ++i) {
		var a = angle_from_line(top[i-1], top[i])
		if (a >= 315 || a <= 135) {
			if (!on)
				con_stroke.push(`M ${top[i-1]} ${bot[i-1]}`)
			bot_stroke.push(`M ${bot[i-1]} ${bot[i]}`)
			con_stroke.push(`M ${top[i]} ${bot[i]}`)
			on = true
		} else {
			on = false
		}
	}
	// remove duplicate start/end diagonal strokes
	if (con_stroke[0] == con_stroke.at(-1))
		con_stroke.pop()

	svg.push(`<path fill="none" stroke="${stroke}" d="\nM ${top.join(" ")} z\n${bot_stroke.join(" ")}\n${con_stroke.join("\n")}\n"/>`)

	emit(output, size_w, size_h, dx, dy, svg)
}

function outline_prism(shape, size_w, size_h, depth, fill, output) {
	var dx = depth/2, dy = depth/2
	var origin_x = 0
	var origin_y = 0
	var top = close_path(shape)
	if (!size_w) {
		[ origin_x, origin_y, size_w, size_h ] = bound_path(top)
		top = translate_path(top, -origin_x, -origin_y)
	}
	var bot = translate_path(top, dx, dy)

	var bot_stroke = []
	var con_stroke = []
	var on = false
	for (var i = 1; i < top.length; ++i) {
		var a = angle_from_line(top[i-1], top[i])
		if (a >= 315 || a <= 135) {
			if (!on) con_stroke.push(`M ${top[i-1]} ${bot[i-1]}`)
			bot_stroke.push(`M ${bot[i-1]} ${bot[i]}`)
			con_stroke.push(`M ${top[i]} ${bot[i]}`)
			on = true
		} else {
			on = false
		}
	}
	if (con_stroke[0] == con_stroke.at(-1))
		con_stroke.pop()

	emit(output, size_w, size_h, dx, dy, `
		<g fill="${fill}" stroke="${fill}" stroke-width="${outline}">
			<path d="M ${top.join(" ")} z ${bot_stroke.join(" ")} ${con_stroke.join(" ")}"/>
		</g>
	`)
}

function draw_prism_v_to_edit(shape, size_w, size_h, depth, fill, symbol, output) {
	var dx = depth/2, dy = depth/2
	var dark = darker(fill)
	var stroke = darkest(fill)

	var origin_x = 0
	var origin_y = 0

	var top = close_path(shape)

	// front face
	top = scale_path(top, 1, 1/2)
	top = shear_path(top)

	// compute image size
	if (!size_w) {
		[ origin_x, origin_y, size_w, size_h ] = bound_path(top)
		top = translate_path(top, -origin_x, -origin_y)
	} else {
		// scale Y by 1/2, shear X by 45deg
		size_h = size_h / 2
		size_w += size_h
	}

	// translate by depth
	top = translate_path(top, 0, depth)

	// bottom face
	var bot = translate_path(top, 0, -depth)

	var svg = []

	// FILLS

	for (var i = 1; i < top.length; ++i) {
		var a = angle_from_line(top[i-1], top[i])
		if (a >= 90 && a <= 270) {
			if (a > 135 && a < 225)
				svg.push(`<path fill="${fill}" stroke="${stroke}" d="M ${top[i-1]} ${top[i]} ${bot[i]} ${bot[i-1]} z"/>`)
			else
				svg.push(`<path fill="${dark}" stroke="${stroke}" d="M ${top[i-1]} ${top[i]} ${bot[i]} ${bot[i-1]} z"/>`)
		}
	}

	svg.push(`<path fill="${dark}" stroke="${stroke}" d="M ${top.join(" ")} z"/>`)

	// SYMBOL

	if (symbol) {
		svg.push(`<g transform="translate(${-origin_x},${-origin_y + depth}) skewX(45) scale(1,0.5)">`)
		svg.push(symbol)
		svg.push(`</g>`)
	}

	// TODO: dx,dy
	emit(output, size_w, size_h + depth, 0, 0, svg)
}

function draw_prism_v(shape, size_w, size_h, depth, fill, symbol, output) {
	var dx = depth/2, dy = depth/2
	var dark = darker(fill)
	var stroke = darkest(fill)

	var origin_x = 0
	var origin_y = 0

	var top = close_path(shape)

	// front face
	top = scale_path(top, 1, 1/2)
	top = shear_path(top)

	// compute image size
	if (!size_w) {
		[ origin_x, origin_y, size_w, size_h ] = bound_path(top)
		top = translate_path(top, -origin_x, -origin_y)
	} else {
		// scale Y by 1/2, shear X by 45deg
		size_h = size_h / 2
		size_w += size_h
	}

	// translate by depth
	top = translate_path(top, 0, depth)

	// bottom face
	var bot = translate_path(top, 0, -depth)

	var svg = []

	// FILLS

	for (var i = 1; i < top.length; ++i) {
		var a = angle_from_line(top[i-1], top[i])
		if (a >= 90 && a <= 270) {
			if (a > 135 && a < 225)
				svg.push(`<path fill="${fill}" d="M ${top[i-1]} ${top[i]} ${bot[i]} ${bot[i-1]} z"/>`)
			else
				svg.push(`<path fill="${dark}" d="M ${top[i-1]} ${top[i]} ${bot[i]} ${bot[i-1]} z"/>`)
		}
	}

	svg.push(`<path fill="${dark}" d="M ${top.join(" ")} z"/>`)

	// SYMBOL

	if (symbol) {
		svg.push(`<g transform="translate(${-origin_x},${-origin_y + depth}) skewX(45) scale(1,0.5)">`)
		svg.push(symbol)
		svg.push(`</g>`)
	}

	// STROKES

	var bot_stroke = []
	var con_stroke = []
	var on = false
	for (var i = 1; i < top.length; ++i) {
		var a = angle_from_line(top[i-1], top[i])
		if (a >= 45 && a <= 225) {
			if (!on)
				con_stroke.push(`M ${top[i-1]} ${bot[i-1]}`)
			bot_stroke.push(`M ${bot[i-1]} ${bot[i]}`)
			con_stroke.push(`M ${top[i]} ${bot[i]}`)
			on = true
		} else {
			on = false
		}
	}
	// remove duplicate start/end diagonal strokes
	if (con_stroke[0] == con_stroke.at(-1))
		con_stroke.pop()

	svg.push(`<path fill="none" stroke="${stroke}" d="\nM ${top.join(" ")} z\n${bot_stroke.join(" ")}\n${con_stroke.join("\n")}\n"/>`)

	// TODO: dx,dy
	emit(output, size_w, size_h + depth, 0, 0, svg)
}

function outline_prism_v(shape, size_w, size_h, depth, fill, output) {
	var origin_x = 0
	var origin_y = 0
	var top = close_path(shape)
	top = scale_path(top, 1, 1/2)
	top = shear_path(top)
	if (!size_w) {
		[ origin_x, origin_y, size_w, size_h ] = bound_path(top)
		top = translate_path(top, -origin_x, -origin_y)
	} else {
		size_h = size_h / 2
		size_w += size_h
	}
	top = translate_path(top, 0, depth)
	var bot = translate_path(top, 0, -depth)

	var strokes = []
	for (var i = 1; i < top.length; ++i) {
		var a = angle_from_line(top[i-1], top[i])
		if (a >= 90 && a <= 270) {
			strokes.push(`M ${top[i-1]} ${bot[i-1]} ${bot[i]} ${top[i]} z`)
		}
	}

	// TODO: dx,dy
	emit(output, size_w, size_h + depth, 0, 0, `
		<g fill="${fill}" stroke="${fill}" stroke-width="${outline}">
			<path d="M ${top.join(" ")} z ${strokes.join(" ")}"/>
		</g>
	`)
}

function two_circle_tangents(c1, c2, r1, r2) {
	// https://mathworld.wolfram.com/Circle-CircleTangents.html
	// https://math.stackexchange.com/questions/1297189/calculate-tangent-points-of-two-circles
	// https://gieseanw.wordpress.com/2012/09/12/finding-external-tangent-points-for-two-circles/
	r1 = Math.max(0.01, r1)
	r2 = Math.max(0.01, r2)
	var D = Math.hypot(c2[0] - c1[0], c2[1] - c1[1])
	var H = Math.sqrt(D*D - (r1-r2)*(r1-r2))
	var Y = Math.hypot(H, r2)
	var axis = Math.atan2(c2[1] - c1[1], c2[0] - c1[0])
	var theta = Math.acos( ( r1*r1 + D*D - Y*Y) / ( 2 * r1 * D ) )
	var A = [ c1[0] + r1 * Math.cos(axis+theta), c1[1] + r1 * Math.sin(axis+theta) ]
	var B = [ A[0] + H * Math.cos(axis+theta-Math.PI/2), A[1] + H * Math.sin(axis+theta-Math.PI/2) ]
	var C = [ c1[0] + r1 * Math.cos(axis-theta), c1[1] + r1 * Math.sin(axis-theta) ]
	var D = [ C[0] + H * Math.cos(axis-theta+Math.PI/2), C[1] + H * Math.sin(axis-theta+Math.PI/2) ]
	return [ A, B, C, D ]
}

function cone_arcs(c1, c2, r1, r2) {
	var [ A, B, C, D ] = two_circle_tangents([c1,c1], [c2,c2], r1, r2)
	var ACA = `${r1} ${r1} 0 ${(r2<r1)|0} 1 ${C} ${r1} ${r1} 0 ${(r1<r2)|0} 1 ${A}`
	var CA = `${r1} ${r1} 0 ${(r2<r1)|0} 0 ${A}`
	var BD = `${r2} ${r2} 0 ${(r1<r2)|0} 0 ${D}`
	return { A, B, C, D, ACA, CA, BD }
}

function draw_cone(r1, r2, depth, fill, symbol, output) {
	var dx = depth/2
	var dark = darker(fill)
	var stroke = darkest(fill)
	var w = r1 + dx + r2
	var { A, B, C, D, ACA, BD } = cone_arcs(r1, r1 + dx, r1, r2)
	emit(output, r1+r2, r1+r2, dx, dx, `
		<path fill="${dark}" d="M ${A} ${B} A ${BD} L ${C}"/>
		<circle fill="${fill}" cx="${r1}" cy="${r1}" r="${r1}"/>
		${symbol ?? ""}
		<path fill="none" stroke="${stroke}" d="M ${A} A ${ACA} L ${B} A ${BD} L ${C}"/>
	`)
}

function outline_cone(r1, r2, depth, fill, output) {
	var dx = depth/2
	var w = r1 + dx + r2
	var { A, B, C, D, CA, BD } = cone_arcs(r1, r1 + dx, r1, r2)
	emit(output, r1+r2, r1+r2, dx, dx, `
		<g fill="${fill}" stroke="${fill}" stroke-width="${outline}">
			<path d="M ${C} A ${CA} L ${B} A ${BD} z"/>
		</g>
	`)
}

function draw_pawn(head, r1, r2, depth, fill, output) {
	var dx = depth/2
	var dark = darker(fill)
	var stroke = darkest(fill)
	var c1 = Math.max(head, r1)
	var w = c1 + dx + r2
	var { A, B, C, D, BD } = cone_arcs(c1, c1 + dx, r1, r2)
	emit(output, r2, r2, c1+dx, c1+dx, `
		<path fill="${dark}" stroke="${stroke}" d="M ${C} ${A} ${B} A ${BD} z"/>
		<circle fill="${fill}" stroke="${stroke}" cx="${c1}" cy="${c1}" r="${head}"/>
	`)
}

function outline_pawn(head, r1, r2, depth, fill, output) {
	var dx = depth/2
	var c1 = Math.max(head, r1)
	var w = c1 + dx + r2
	var { A, B, C, D, ACA, BD } = cone_arcs(c1, c1 + dx, r1, r2)
	emit(output, r2, r2, c1+dx, c1+dx, `
		<g fill="${fill}" stroke="${fill}" stroke-width="${outline}">
			<path d="M ${C} ${A} ${B} A ${BD} z"/>
			<circle cx="${c1}" cy="${c1}" r="${head}"/>
		</g>
	`)
}

function draw_cylinder(diameter, depth, fill, symbol, output) {
	draw_cone(diameter/2, diameter/2, depth, fill, symbol, output)
}

function outline_cylinder(diameter, depth, fill, output) {
	outline_cone(diameter/2, diameter/2, depth, fill, output)
}

function draw_raider(w, h, depth, fill, output) {
	var dx = depth/2, dy = depth/2
	var dark = darker(fill)
	var stroke = darkest(fill)

	var a1 = [ w/2, h ]
	var a11 = [ 0, h*2/3 ]
	var a12 = [ 0, h*1/3 ]
	var a2 = [ 0, 0 ]
	var a21 = [ w, h*2/3 ]
	var a22 = [ w, h*1/3 ]
	var a3 = [ w, 0 ]

	var b1 = [ w/2+dy, h+dx ]
	var b11 = [ 0+dy, dx+h*2/3 ]
	var b12 = [ 0+dy, dx+h*1/3 ]
	var b2 = [ 0+dy, 0+dx ]
	var b21 = [ w+dy, dx+h*2/3 ]
	var b22 = [ w+dy, dx+h*1/3 ]
	var b3 = [ w+dy, 0+dx ]

	emit(output, w, h, dx, dy, `
		<path fill="${dark}" d="M ${b1} C ${b11} ${b12} ${b2} L ${b3} C ${b22} ${b21} ${b1} z"/>
		<path fill="${dark}" d="M${[a1,a3,b3,b1]}"/>
		<path fill="${dark}" d="M${[a2,a3,b3,b2]}"/>
		<path fill="none" stroke="${stroke}" d="M ${a3} ${b3} C ${b22} ${b21} ${b1} L ${a1} M ${a3} ${b3} "/>
		<path fill="${fill}" stroke="${stroke}" d="M ${a1} C ${a11} ${a12} ${a2} L ${a3} C ${a22} ${a21} ${a1} z"/>
	`)
}

function outline_raider(w, h, depth, fill, output) {
	var dx = depth/2, dy = depth/2

	var a1 = [ w/2, h ]
	var a11 = [ 0, h*2/3 ]
	var a12 = [ 0, h*1/3 ]
	var a2 = [ 0, 0 ]
	var a21 = [ w, h*2/3 ]
	var a22 = [ w, h*1/3 ]
	var a3 = [ w, 0 ]

	var b1 = [ w/2+dy, h+dx ]
	var b11 = [ 0+dy, dx+h*2/3 ]
	var b12 = [ 0+dy, dx+h*1/3 ]
	var b2 = [ 0+dy, 0+dx ]
	var b21 = [ w+dy, dx+h*2/3 ]
	var b22 = [ w+dy, dx+h*1/3 ]
	var b3 = [ w+dy, 0+dx ]

	emit(output, w, h, dx, dy, `
		<g fill="${fill}" stroke="${fill}" stroke-width="${outline}">
			<path d="M ${a3} ${b3} C ${b22} ${b21} ${b1} L ${a1} C ${a11} ${a12} ${a2} L ${a3}"/>
		</g>
	`)
}

function draw_stronghold(w, r, depth, fill, output) {
	var dx = depth/2, dy = depth/2
	var dark = darker(fill)
	var stroke = darkest(fill)
	var x1 = r
	var x2 = r + w
	var z = Math.cos(Math.PI/4) * r
	emit(output, w + 2*r, w + 2*r, dx, dy, `
		<g fill="${dark}">
			<g stroke="${stroke}">
				<circle cx="${dx+x1}" cy="${dy+x1}" r="${r}"/>
				<circle cx="${dx+x2}" cy="${dy+x1}" r="${r}"/>
				<circle cx="${dx+x2}" cy="${dy+x2}" r="${r}"/>
				<circle cx="${dx+x1}" cy="${dy+x2}" r="${r}"/>
			</g>
			<rect x="${dx+x1}" y="${dy+x1}" width="${w}" height="${w}"/>
			<g fill="none" stroke="${stroke}">
				<path d="M ${dx+x1+r},${dy+x2} h ${w-r*2}"/>
				<path d="M ${dx+x2},${dy+x1+r} v ${w-r*2}"/>
			</g>
			<path d="
				M ${x1-z},${x1+z}
				l ${2*z},${-2*z}
				l ${w},${w}
				l ${dx},${dy}
				l ${-2*z},${2*z}
				z
				M ${x1-z},${x2+z}
				l ${w},${-w}
				l ${2*z},${-2*z}
				l ${dx},${dy}
				l ${-w},${w}
				l ${-2*z},${2*z}
				z
			"/>
		</g>
		<g fill="none" stroke="${stroke}">
			<path d="
				M ${x1-z},${x1+z} l ${dx},${dy}
				M ${x1+z},${x1-z} l ${dx},${dy}
				M ${x2-z},${x2+z} l ${dx},${dy}
				M ${x2+z},${x2-z} l ${dx},${dy}
				M ${x1-z},${x2+z} l ${dx},${dy}
				M ${x2+z},${x1-z} l ${dx},${dy}
				M ${x1+r},${x2} l ${dx},${dy}
				M ${x2},${x1+r} l ${dx},${dy}
			"/>
		</g>
		<g fill="${fill}">
			<g stroke="${stroke}">
				<circle cx="${x1}" cy="${x1}" r="${r}"/>
				<circle cx="${x2}" cy="${x1}" r="${r}"/>
				<circle cx="${x2}" cy="${x2}" r="${r}"/>
				<circle cx="${x1}" cy="${x2}" r="${r}"/>
			</g>
			<rect x="${x1}" y="${x1}" width="${w}" height="${w}"/>
			<g fill="none" stroke="${stroke}">
				<path d="M ${x1+r},${x1} h ${w-r*2}"/>
				<path d="M ${x1+r},${x2} h ${w-r*2}"/>
				<path d="M ${x1},${x1+r} v ${w-r*2}"/>
				<path d="M ${x2},${x1+r} v ${w-r*2}"/>
			</g>
		</g>
	`)
}

function outline_stronghold(w, r, depth, fill, output) {
	var dx = depth/2, dy = depth/2
	var x1 = r
	var x2 = r + w
	var z = Math.cos(Math.PI/4) * r
	emit(output, w + 2*r, w + 2*r, dx, dy, `
		<g fill="${fill}" stroke="${fill}" stroke-width="${outline}">
			<circle cx="${dx+x1}" cy="${dy+x1}" r="${r}"/>
			<circle cx="${dx+x2}" cy="${dy+x1}" r="${r}"/>
			<circle cx="${dx+x2}" cy="${dy+x2}" r="${r}"/>
			<circle cx="${dx+x1}" cy="${dy+x2}" r="${r}"/>
			<rect x="${dx+x1}" y="${dy+x1}" width="${w}" height="${w}"/>
			<path fill="none" d="
				M ${x1-z},${x1+z} l ${dx},${dy}
				M ${x1+z},${x1-z} l ${dx},${dy}
				M ${x2-z},${x2+z} l ${dx},${dy}
				M ${x2+z},${x2-z} l ${dx},${dy}
				M ${x1-z},${x2+z} l ${dx},${dy}
				M ${x2+z},${x1-z} l ${dx},${dy}
			"/>
			<circle cx="${x1}" cy="${x1}" r="${r}"/>
			<circle cx="${x2}" cy="${x1}" r="${r}"/>
			<circle cx="${x2}" cy="${x2}" r="${r}"/>
			<circle cx="${x1}" cy="${x2}" r="${r}"/>
			<rect x="${x1}" y="${x1}" width="${w}" height="${w}"/>
		</g>
	`)
}

function draw_polygon(n, rx, ry, depth, rotate, color, symbol, output) {
	draw_prism(polygon_path(n, rx, ry, rotate), 0, 0, depth, color, symbol, output)
}

function outline_polygon(n, rx, ry, depth, rotate, color, output) {
	outline_prism(polygon_path(n, rx, ry, rotate), 0, 0, depth, color, output)
}

function draw_star(n, big, small, depth, rotate, color, symbol, output) {
	draw_prism(star_path(n, big, small, rotate), 0, 0, depth, color, symbol, output)
}

function outline_star(n, big, small, rotate, depth, color, output) {
	outline_prism(star_path(n, big, small, rotate), 0, 0, depth, color, output)
}

function draw_cuboid(w, h, d, color, symbol, output) {
	draw_prism([[0,0], [0,h], [w,h], [w,0]], w, h, d, color, symbol, output)
}

function outline_cuboid(w, h, d, color, output) {
	outline_prism([[0,0], [0,h], [w,h], [w,0]], w, h, d, color, output)
}

function draw_cuboid_v(w, h, d, color, symbol, output) {
	draw_prism_v([[0,0], [0,h], [w,h], [w,0]], w, h, d, color, symbol, output)
}

function outline_cuboid_v(w, h, d, color, output) {
	outline_prism_v([[0,0], [0,h], [w,h], [w,0]], w, h, d, color, output)
}

function draw_octagon(diameter, depth, color, symbol, output) {
	// for total width: r = w * 0.5412 * 2
	draw_polygon(8, diameter/2, diameter/2, depth, 45/2, color, symbol, output)
}

function outline_octagon(diameter, depth, color, output) {
	outline_polygon(8, diameter/2, diameter/2, depth, 45/2, color, output)
}

function draw_octagon_of_width(w, depth, color, symbol, output) {
	draw_octagon(2 * w * 0.5412, depth, color, symbol, output)
}

function outline_octagon_of_width(w, depth, color, output) {
	outline_octagon(2 * w * 0.5412, depth, color, output)
}

function draw_hexagon_flat_top(diameter, depth, color, symbol, output) {
	draw_polygon(6, diameter/2, diameter/2, depth, 0, color, symbol, output)
}

function draw_hexagon_pointy_top(diameter, depth, color, symbol, output) {
	draw_polygon(6, diameter/2, diameter/2, depth, 30, color, symbol, output)
}

function outline_hexagon_flat_top(diameter, depth, color, output) {
	outline_polygon(6, diameter/2, diameter/2, depth, 0, color, output)
}

function outline_hexagon_pointy_top(diameter, depth, color, output) {
	outline_polygon(6, diameter/2, diameter/2, depth, 30, color, output)
}

function draw_path(path, depth, color, output) {
	draw_prism(round_path(path), 0, 0, depth, color, null, output)
}

function outline_path(path, depth, color, output) {
	outline_prism(round_path(path), 0, 0, depth, color, null, output)
}

function draw_path_from_svg(path_d, winding, depth, color, output) {
	var path = parse_path(path_d)
	if (winding)
		path = path.reverse()
	draw_path(round_path(path), depth, color, output)
}

function outline_path_from_svg(path_d, winding, depth, color, output) {
	var path = parse_path(path_d)
	if (winding)
		path = path.reverse()
	outline_path(round_path(path), depth, color, output)
}

var cabinet = module.exports = {
	enable_logging,
	palette,
	read_png, read_svg,
	set_stroke_width,
	set_outline_width,
	parse_path, polygon_path, star_path,
	round_path, translate_path, scale_path, shear_path, rotate_path,
	draw_prism_to_edit, draw_prism_v_to_edit,
	draw_prism, outline_prism,
	draw_prism_v, outline_prism_v,
	draw_cylinder, outline_cylinder,
	draw_cone, outline_cone,
	draw_pawn, outline_pawn,
	draw_raider, outline_raider,
	draw_stronghold, outline_stronghold,
	draw_polygon, outline_polygon,
	draw_star, outline_star,
	draw_cuboid, outline_cuboid,
	draw_cuboid_v, outline_cuboid_v,
	draw_octagon, outline_octagon,
	draw_octagon_of_width, outline_octagon_of_width,
	draw_hexagon_flat_top, outline_hexagon_flat_top,
	draw_hexagon_pointy_top, outline_hexagon_pointy_top,
	draw_path, outline_path,
	draw_path_from_svg, outline_path_from_svg,
}

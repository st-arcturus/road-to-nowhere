// oklab colorspace processing

"use strict"

function rgb_from_any(color) {
	switch (color.mode) {
	case "rgb": return color
	case "lrgb": return rgb_from_lrgb(color)
	case "oklab": return rgb_from_oklab(color)
	}
}

function lrgb_from_any(color) {
	switch (color.mode) {
	case "rgb": return lrgb_from_rgb(color)
	case "lrgb": return color
	case "oklab": return lrgb_from_oklab(color)
	}
}

function oklab_from_any(color) {
	switch (color.mode) {
	case "rgb": return oklab_from_rgb(color)
	case "lrgb": return oklab_from_lrgb(color)
	case "oklab": return color
	}
}

function format_hex(color) {
	let {r, g, b} = rgb_from_any(color)
	let adj = 1
	r = Math.round(Math.max(0, Math.min(1, r)) * 255)
	g = Math.round(Math.max(0, Math.min(1, g)) * 255)
	b = Math.round(Math.max(0, Math.min(1, b)) * 255)
	let x = (r << 16) | (g << 8) | b
	return "#" + x.toString(16).padStart(6, "0")
}

function parse_hex(str) {
	let x = parseInt(str.substring(1), 16)
	return {
		mode: "rgb",
		r: ((x >> 16) & 255) / 255.0,
		g: ((x >> 8) & 255) / 255.0,
		b: ((x) & 255) / 255.0
	}
}

function lrgb_from_rgb({ r, g, b }) {
	function to_linear(c) {
		let ac = Math.abs(c)
		if (ac < 0.04045)
			return c / 12.92
		return (Math.sign(c) || 1) * Math.pow((ac + 0.055) / 1.055, 2.4)
	}
	return {
		mode: "lrgb",
                r: to_linear(r),
                g: to_linear(g),
                b: to_linear(b)
        }
}

function rgb_from_lrgb({ r, g, b }) {
	function from_linear(c) {
		let ac = Math.abs(c)
		if (ac > 0.0031308)
			return (Math.sign(c) || 1) * (1.055 * Math.pow(ac, 1 / 2.4) - 0.055)
		return c * 12.92
	}
        return {
                mode: "rgb",
                r: from_linear(r),
                g: from_linear(g),
                b: from_linear(b)
	}
}

function oklab_from_lrgb({ r, g, b }) {
	let L = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b)
        let M = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b)
        let S = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b)
        return {
                mode: "oklab",
                l: 0.2104542553 * L + 0.793617785 * M - 0.0040720468 * S,
                a: 1.9779984951 * L - 2.428592205 * M + 0.4505937099 * S,
                b: 0.0259040371 * L + 0.7827717662 * M - 0.808675766 * S
        }
}

function lrgb_from_oklab({ l, a, b }) {
        let L = Math.pow(l + 0.3963377774 * a + 0.2158037573 * b, 3)
        let M = Math.pow(l - 0.1055613458 * a - 0.0638541728 * b, 3)
        let S = Math.pow(l - 0.0894841775 * a - 1.291485548 * b, 3)
        return {
                mode: "lrgb",
                r: +4.0767416621 * L - 3.3077115913 * M + 0.2309699292 * S,
                g: -1.2684380046 * L + 2.6097574011 * M - 0.3413193965 * S,
                b: -0.0041960863 * L - 0.7034186147 * M + 1.707614701 * S
	}
}

function oklab_from_rgb(rgb) {
        return oklab_from_lrgb(lrgb_from_rgb(rgb))
}

function rgb_from_oklab(oklab) {
	return rgb_from_lrgb(lrgb_from_oklab(oklab))
}

function lerp(a, b, t) {
	return a + (b - a) * t
}

function blend(x_hex, y_hex, t) {
	let x = oklab_from_any(parse_hex(x_hex))
	let y = oklab_from_any(parse_hex(y_hex))
	let c = {
		mode: "oklab",
		l: lerp(x.l, y.l, t),
		a: lerp(x.a, y.a, t),
		b: lerp(x.b, y.b, t),
	}
	return format_hex(c)
}

function brightness(hex, m) {
	let oklab = oklab_from_any(parse_hex(hex))
	oklab.l = Math.max(0, Math.min(1, oklab.l * m))
	return format_hex(oklab)
}

function css_bevel(selector, background) {
	var hi = brightness(background, 1.20)
	var lo = brightness(background, 0.8)
	var sh = brightness(background, 0.2)
	return `${selector} { background-color: ${background}; border-color: ${hi} ${lo} ${lo} ${hi}; box-shadow: 0 0 0 1px ${sh}; }`
}

if (typeof module === "object")
	module.exports = {
		format_hex,
		parse_hex,
		rgb_from_any,
		lrgb_from_any,
		oklab_from_any,
		brightness,
		blend,
		css_bevel,
	}

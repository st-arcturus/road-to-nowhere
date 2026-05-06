#!/usr/bin/env -S node

// names.txt is a CSV file with one line per layout node to add
// name, color, width, height, x, y
// all entries except name are optional
// if x and y are not specified, the nodes are placed outside

"use strict"

const fs = require("node:fs")
const print = console.log

if (process.argv.length < 4) {
	print("usage: node new-layout.js width height [ image.jpg [ names.txt ] ]")
	process.exit(1)
}

var w = Number(process.argv[2])
var h = Number(process.argv[3])
var m = process.argv[4] || "../map75.jpg"

var lines = []
if (process.argv[5]) {
	lines = fs.readFileSync(process.argv[5], "utf-8").trim().split("\n")
}

print(`<?xml version="1.0" encoding="UTF-8"?>
<svg
	xmlns="http://www.w3.org/2000/svg"
	xmlns:xlink="http://www.w3.org/1999/xlink"
	xmlns:inkscape="http://www.inkscape.org/namespaces/inkscape"
	xmlns:sodipodi="http://sodipodi.sourceforge.net/DTD/sodipodi-0.dtd"
	width="${w}"
	height="${h}"
>
<image xlink:href="${m}" x="0" y="0" width="${w}" height="${h}" image-rendering="pixelated" sodipodi:insensitive="true" />`)

var name, color
var y = 0
var x = w + 10
var rx, ry, rw, rh
for (var line of lines) {
	rx = ry = rw = rh = 0
	if (line.includes(",")) {
		line = line.split(",")
		name = line[0].replaceAll("&", "&amp;")
		color = line[1] ?? "black"
		rw = Number(line[2] ?? 0)
		rh = Number(line[3] ?? 0)
		rx = Number(line[4] ?? 0)
		ry = Number(line[5] ?? 0)
	} else {
		name = line.replaceAll("&", "&amp;")
		color = "black"
	}
	if (!rw || !rh) {
		rw = rh = 50
	}
	if (!rx || !ry) {
		rx = x
		ry = y
		y += rh + 10
		if (y > h) {
			y = 0
			x += rw + 10
		}
	}
	print(`<rect inkscape:label="${name}" fill-opacity="0.5" fill="${color}" x="${rx}" y="${ry}" width="${rw}" height="${rh}"/>`)
}

print("</svg>")

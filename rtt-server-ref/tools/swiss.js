// Use Drake/Hougardy Path Growing Algorithm to calculate maximal matchings
// https://sci-hub.st/https://doi.org/10.1016/S0020-0190(02)00393-9

// Note: This only works with even number of players!

var players = [
	{ name: "A", score: 0, last_side: 0, p1: 0, p2: 0 },
	{ name: "B", score: 0, last_side: 0, p1: 0, p2: 0 },
	{ name: "C", score: 0, last_side: 0, p1: 0, p2: 0 },
	{ name: "D", score: 0, last_side: 0, p1: 0, p2: 0 },
	{ name: "E", score: 0, last_side: 0, p1: 0, p2: 0 },
	//{ name: "F", score: 0, last_side: 0, p1: 0, p2: 0 },
	//{ name: "G", score: 0, last_side: 0, p1: 0, p2: 0 },
	//{ name: "H", score: 0, last_side: 0, p1: 0, p2: 0 },
	//{ name: "I", score: 0, last_side: 0, p1: 0, p2: 0 },
]

function array_remove(array, index) {
	let n = array.length
	for (let i = index + 1; i < n; ++i)
		array[i - 1] = array[i]
	array.length = n - 1
}

function array_remove_item(array, item) {
	let n = array.length
	for (let i = 0; i < n; ++i)
		if (array[i] === item)
			return array_remove(array, i)
}

var have_met = []

function weight(a, b) {
	let n = 0, s = 0
	if (a.last_side == b.last_side)
		++s
	for (let met of have_met) {
		if (met[0] === a && met[1] === b)
			++n
		if (met[1] === a && met[0] === b)
			++n
	}
	let w = Math.abs(a.score - b.score) + n * 100 + s * 10000
	//console.log("W", w, a.name, b.name, a.last_side, b.last_side)
	return w
}

function find_best_pair(V, x) {
	let best_w = weight(x, V[0])
	let best_y = 0
	for (let i = 1; i < V.length; ++i) {
		let w = weight(x, V[i])
		if (w < best_w) {
			best_w = w
			best_y = i
		}
	}
	//console.log("=>", x.name, V[best_y].name)
	return V[best_y]
}

function global_score(M) {
	let score = 0
	for (let [x, y] of M)
		score += weight(x, y)
	return score
}

function path_growing_algorithm(V, start) {
	let M = [ [], [] ]
	let i = 0
	let x, y

	x = V[start]
	while (V.length > 1) {
		array_remove_item(V, x)
		y = find_best_pair(V, x)
		if (x.last_side === 1)
			M[i].push( [y, x] )
		else
			M[i].push( [x, y] )
		i = 1 - i
		x = y
	}

	// console.log("SCORE", global_score(M[0]), M[0].map(([x,y])=>x.name +"-" + y.name))
	return M.flat()
	return M[0]
}

for (let r = 1; r <= 6; ++r) {
	console.log("ROUND", r)
	let best_matching = path_growing_algorithm(players.slice(), 0)
	let best_score = global_score(best_matching)
	for (let i = 1; i < players.length; ++i) {
		let matching = path_growing_algorithm(players.slice(), i)
		let score = global_score(matching)
		if (score < best_score) {
			best_matching = matching
			best_score = score
		}
	}

	console.log("M", best_score, best_matching.map(([x,y])=>x.name + "-" + y.name))

	for (let [x, y] of best_matching) {
		x.last_side = 1
		x.p1++
		y.last_side = 2
		y.p2++
		/*
		if (Math.random() > 0.5)
			x.score += 1
		else
			y.score += 1
		*/
		have_met.push([x,y])
	}

	players.sort((a,b) => b.score - a.score)
	//if (players[0].score > players[1].score) break
}
console.log(players)

# Road to Nowhere

## Branch
Develop and push on `claude/convert-rules-to-module`. Do not push to `main` or create other branches.

## Clarification
Always seek clarification from the user if instructions or the optimal solution are unclear.

## Project
RTT-framework board game, 3–5 players. `rules.js` runs server-side (Node.js);
`play.js` runs browser-side only. They communicate through the framework's
view/action protocol — never import one from the other.

## Testing
Run `node tests/run.js` after any change to `rules.js`. All tests must pass.

## Framework: send_action validation
`send_action(verb, noun)` validates noun via `view.actions[verb].includes(noun)`.
Every value the client may send must be present in the array — not just a minimum
or hint. Sparse arrays cause silent no-ops.

## Reference material
For any questions about module-to-server communication, the view/action protocol,
or complex framework behaviour, consult:

- `example/rtt-server-ref/docs/` — authoritative RTT framework documentation
  (architecture, module guide, rules API, tips)
- `example/pax-pamir-ref/` — a complete reference implementation of an RTT game
- `example/rtt-server-ref/public/common/client.js` and `client.css` — the actual
  framework client code

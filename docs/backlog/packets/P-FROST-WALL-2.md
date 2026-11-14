# P-FROST-WALL-2: Frost Wall on the wire, and the live profiles select it

- **Serves:** owner beta follow-up decision 2 (MIGRATION, 2026-11-10: "Frost Wall replaces Freeze"); the wire half
  cut from P-FROST-WALL-1 (its brief, lines 5, 20-21, 102, 112, 119)
- **Implementer tier:** implementer-opus (wire format, observation, cross-crate)
- **Reviewer:** reviewer-opus
- **Integration base:** feature/unity-rework, after P-FROST-WALL-1b (the sim rule complete) and P-WIRE17-MAP-3
  (serial on the protocol files)
- **D-rules touched:** D1 loose proof against the unreleased legacy patch (`78dd8bd4`, client `cde6f785`) · golden
  vectors required · observation and policy contract versions move · C-OBS

## 1. ID and outcome
P-FROST-WALL-1 put Frost Wall in the sim behind `SimConfig::frost_wish` (default `Freeze`), filtered out of every
observation, with no profile selecting it. When this lands: (a) a standing wall reaches every viewer who may see it
(its tiles or its segment, its owner's faction colour, when it falls), by the same visibility rule as the tiles it
stands on: say which legacy used (`cde6f785`: the client drew the wall from synced barrier state); (b) the placed
cast is a first-class wire command result: the `frostWall` ability id and its wire code, the landing event carrying
the wall's centre only to viewers who may see it (reviewer-opus could not confirm `CastLanded` is filtered by
visibility under `Wall`: establish it and pin it); (c) the client library exposes the walls (`RoguehallaNet`), and a
client can tell from the Welcome which Wish Frost has; (d) the `source-arena` and `training` profiles select `Wall`.
Bots: a fair observation carries the wall like any other viewer's; the Brain's use of it is not this packet.

## 2. Dependencies
- P-SIM-LIVE-CONTENT-1 merged (the live content world has one definition; the flip is one line there).
- P-FROST-WALL-1c merged (cannon landings, zombies, bruiser reach and Wind emblems read the wall; the wall's
  numbers are in content).
- P-FROST-WALL-1b merged (fighters under the wall, walks under way, mob paths and blink landings read the wall):
  the profiles must not select a half-built rule.
- Serial with every packet touching `observe.rs`, `status_runtime/observe.rs`, `state.rs`, `samples.rs`, the C# and
  JS decoders and `v17.json`.

## 5. Exclusive write scope
- named by the oracle author: the observation projection of fields (`crates/rh-sim/src/status_runtime/observe.rs`),
  `crates/rh-protocol/src/**` for the field kind and the ability code, `protocol/fixtures/v17.json`, the profile
  table in `crates/rh-server/`, `crates/rh-policy/src/delivery/**`, `client-unity/RoguehallaNet/**` (protocol and
  view state), `crates/rh-server/web/probe.html`, `tools/protocol-js/**`
- not Unity scripts (P-UNITY-FROST-WALL-1 draws it and adds the aim preview)

## 5b. Carried from P-SIM-LIVE-CONTENT-1's review (same write scope, one commit)
- The flip is `frost_wish: FrostWish::Wall` in `SimConfig::live_content()` (`crates/rh-sim/src/statics.rs`); the
  characterisation tables that state the live value move with it: `crates/rh-server/tests/live_content.rs:86` and
  `:115` (the oracle author of this packet amends them, since they are oracle files of the earlier packet).
- Two literal copies of the live world remain in `crates/rh-headless/examples/source_soak.rs:23-42` and
  `examples/full_map_cost.rs:33-50`: switch both to `..SimConfig::live_content()` and extend the source scan in
  `crates/rh-headless/tests/live_content.rs` to `crates/rh-headless/examples`, so they cannot stay on Freeze unseen.

## 8. Acceptance checks
- Wire vectors for a snapshot or state with a wall and refusals for malformed ones; Rust, C# and JS agree.
- C-OBS: a viewer who cannot see the wall's tiles receives neither the wall nor its landing centre; an unseated
  viewer as today.
- With the profiles selecting `Wall`, a Frost player's Wish raises a wall in a live room test and every parity
  fixture (which capture Freeze under the default config) is unchanged.
- `scripts/gate.sh --oracle packet/P-FROST-WALL-2` passes (with `--regen-fixtures`).

## Oracle files (read-only for implementers)
- listed by the oracle author on `packet/P-FROST-WALL-2`

## 10. Risk and suggested model tier
Opus. Selecting `Wall` in a live profile before the client draws it would give players an invisible wall.
Coordinator decision 2026-11-14: the flip is part of this packet, made in ONE place (`SimConfig::live_content()`,
P-SIM-LIVE-CONTENT-1, which therefore merges first; the operator flag `--frost-wish` still overrides it), and this
packet is pushed in the same integration batch as P-UNITY-FROST-WALL-1. No deploy happens between the two.

## Notes from previous attempts

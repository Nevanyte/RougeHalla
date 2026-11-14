# P-FROST-WALL-3: the live profiles select Frost Wall

- **Serves:** owner beta follow-up decision 2 (MIGRATION, 2026-11-10: "Frost Wall replaces Freeze")
- **Implementer tier:** implementer-opus (changes what the live server plays; cross-crate tests)
- **Reviewer:** reviewer-opus
- **Integration base:** feature/unity-rework after P-FROST-WALL-1c (the sim rule complete), P-FROST-WALL-2a (the
  wall's numbers in content), P-FROST-WALL-2 (the wall on the wire) and P-UNITY-FROST-WALL-1 (the client draws it and
  aims it). Pushed in the same integration batch as P-UNITY-FROST-WALL-1; no deploy happens between them.
- **D-rules touched:** D1 loose proof against the unreleased legacy patch `78dd8bd4` · parity fixtures run the default
  config (`Freeze`) and stay untouched · DEV-029 (signed; its amended text is the owner's to re-confirm)

## 1. ID and outcome
The wall is complete in the sim, on the wire and in the client, and nothing selects it. When this lands the live
world plays it: `frost_wish: FrostWish::Wall` in `SimConfig::live_content()` (`crates/rh-sim/src/statics.rs`), ONE
line, which reaches the source-arena server, the practice room and the Brain tournament world
(P-SIM-LIVE-CONTENT-1). With it:
1. The characterisation tables that state the live value move: `crates/rh-server/tests/live_content.rs` (the rows
   reviewer-opus named at `:86` and `:115`; the oracle author re-finds them).
2. The two literal copies of the live world that the scan does not see are switched to `..SimConfig::live_content()`
   and the scan is widened to `crates/rh-headless/examples`: `examples/source_soak.rs:23-42`,
   `examples/full_map_cost.rs:33-50`.
3. Bots: live fill bots (`HumanBot`) and the Brain aim Frost's Wish at a unit's position. Under the wall that puts
   ice between the caster and its target. The oracle author establishes what legacy's bots do with the wall
   (`packages/server/src/bots/abilityPolicy.ts` in `78dd8bd4`: `WALL_PEEL_*`) and whether today's Rust bots, given the
   wall, harm themselves or simply waste the cast. If they waste it, that is recorded (a bot packet follows the
   learner runs); if they harm themselves or stall, the smallest port of legacy's aiming rule is in scope.
4. An operator can still run Freeze: say how (an existing flag, or none: if none, add nothing and say so).

## 2. Dependencies
As the integration base lists. Serial with anything touching `statics.rs` or `rh-server/tests/live_content.rs`.

## 5. Exclusive write scope
- `crates/rh-sim/src/statics.rs` (the one line), `crates/rh-headless/examples/{source_soak,full_map_cost}.rs`,
  `crates/rh-headless/tests/live_content.rs` (the scan's directory list), `crates/rh-server/tests/live_content.rs`
  (the stated live values; amended by the oracle author), bot aiming only if item 3 requires it
- not the wire, not `content.rs`

## 7. Behaviour to preserve
- Every parity fixture and the default `SimConfig`: untouched. Core runtime: untouched.
- The training profile and the source-arena profile agree on Frost's Wish.

## 8. Acceptance checks
- Red today: `live_content().frost_wish == Wall`; a live room test (the server's real settings) in which a Frost
  player's Wish raises a wall that a second connected client receives; the Brain tournament world reports `Wall`; the
  two examples build on the constructor; the widened scan passes.
- Guards: the default config is `Freeze`; parity report all MATCH.
- A headless smoke of Brain and HumanBot matches with Frost seats completes without a stall or a self-kill by wall
  (state the numbers).
- `scripts/gate.sh --oracle packet/P-FROST-WALL-3` passes.

## 10. Risk and suggested model tier
Opus. This is the packet that changes what players get; it lands only with the client that draws it.

## Notes from previous attempts

# Map placement, repair and final gates

Three pure leaves complete additional generator stages: `spots` (camp/crate/ground placement), `repair` (safety nets
and territory repair/post-checks), and `tail` (terrain cleanup, post-loot decor/bush exclusion and final shape gate).
Their APIs are now integrated with live content identity. Orchestration, stage-six stylers, independently reviewed
certification and full canonical pins remain required; no completed generator or cutover is claimed.

## Source proof and independent review

- Spots: seven actual maps, 350 camps, 35 crate zones, seven ground operations and seven labelled synthetic cases.
  Canonical Linux x64 Node22.23.4 capture and byte-check passed. Six repository tests preserve complete outputs,
  exclusion masks, ordered decisions, every main-stream word/state and eight continuations. Six producer mutants
  fail. Independent review replays 200,879 RNG words and adds 96 host-arm64 diagnostic source operations. An extreme
  `crate_gap` overflow was reproduced and fixed before any draw; fixture continuation/event/refusal gaps were hardened.
- Repair: forty actual controls and twenty-two labelled synthetic cases, 104 stage entries and 110 ordered operations/
  notes, including twelve normal source refusals. Canonical capture/byte-check and injected source-RNG rejection pass.
  Five repository tests preserve all arrays, partial writes, refusal order, infill counts and exact territory decisions.
  Seven producer and seven different independent behavioral mutations fail. Independent review found that broad peel
  bounds admitted packed-key overflow after mutation; exact reachable-key preflight now refuses those definitions
  before changing caller state. Additional source cases prove both walling branches, fit priority, protected cells,
  painted-zone transfer and actual balancer movement. Two independent malformed/early-refusal controls also pass.
- Tail: nine genuine attempts and one labelled actual-styler prop-injection hook; 48 original closed-helper buried-kind
  probes, 120 ICE edge/class/neighbor probes and twelve shape cases. Canonical capture/byte-check passes. Five repository
  tests consume exact ordered phases and full arrays/props/masks. Independent review adds 120 host-arm64 diagnostic
  source cases and forty no-write malformed controls, rejects fifteen runtime mutations and eleven fixture attacks.
  Three initial evidence gaps were repaired: pool-filter deletion, forged final ownership and arbitrary picked pools.
  The source custom hook now supplies pool-halo props; tests recompute exact original pools from accepted Rust stages
  one through five and bind genuine final ownership to the separate accepted records oracle. The same attacks fail.

Host-arm64 diagnostic comparisons are supplemental and are not relabelled canonical. All three canonical tools enforce
Linux x64 Node22.23.4; source copies are observational, with complete final output/hash controls and untouched production
TypeScript. Every new leaf retains its own explicit domain and exact inventories. The checked-in independent reports
preserve their original review boundary and limitations; coordinator gates are recorded separately.

## Coordinator integration

The repair calls the existing partition balancer through a narrow `pub(crate)` wrapper with the original quota/keep
arguments and intentionally ignored completion flag. No second balancer is introduced. Its default clearing-class
slice is a compile-time projection of the existing terrain table, shared by runtime callers and content visitation.
The projection adds no second hand-maintained kind table or content-hash allocation. Content checks cover 21 spot,
16 repair and two tail policy mutations, including all new fields and relevant table order/length.

```sh
cargo test -p rh-sim --lib mapgen::spots --locked
cargo test -p rh-sim --lib mapgen::repair --locked
cargo test -p rh-sim --lib mapgen::tail --locked
cargo test -p rh-sim --test content --test map_spot_content --test map_repair_content --test map_tail_content --locked
node --import tsx tools/map-fixtures/spots.ts --check
node --import tsx tools/map-fixtures/repair.ts --check
node --import tsx tools/map-fixtures/tail.ts --check
```

The source checks run in Rust CI. Full native results, content identity and subsequent CI are recorded in MIGRATION.
Checkpoint /14, replay /12, observation 11, policy 8 and protocol 5 are unchanged. This batch changes no Unity,
cloud/DNS/production resources, gameplay parity fixtures or ML scope. The separate external handoff integrations are
reported independently; Kimi's verification harness is already an ancestor of this checkpoint.

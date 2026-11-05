# Player Fire and landmark foundations

Branch: `optimization_port`. Native arm64 M5 Pro integration passed **586 tests, zero failures/filters and one intentional
ignored heap measurement**; formatting and both workspace Clippy modes with warnings denied passed. Parity is
**65 compared scenarios, 13 capture-only and 300 path queries: all MATCH**. This checkpoint adds a bounded player Fire installation and stage-4 landmark foundations
inside `rh-sim`. Full gameplay, full map generation/certification/pins, bots, client flows and release gates remain open.
The integrated gate and current format identities are recorded in [MIGRATION](../../MIGRATION.md). Commit `7fe10989`
passed [Rust CI](https://github.com/Nevanyte/RougeHalla/actions/runs/42049800438) and
[legacy recapture CI](https://github.com/Nevanyte/RougeHalla/actions/runs/42049800443), including PostgreSQL, C#,
headless runs, all new source oracles and Chromium WSS.

## Fire gameplay

`FactionMode::EngagementHolyPlagueFire` extends the earlier explicit partial modes; the default remains Off. Burn is a
magic DoT using unpaused engaged time. Backlash is an instantaneous physical entry driven by the genuine afterWeapons
snapshot: melee requests precede projectile spawns, retaining order, duplicates and request-time weapons. Whiffs and
third-party attacks count. Cancelled windups, reflected projectiles and splash do not create extra requests. Backlash
uses the target's unbuffed request-weapon interval and the Fire actor's current weapon multiplier. It is not paused or
classified as DoT. Source evaluation order, cap, barrier, landed sustain and private chunk behavior remain exact.

Four actual-source traces cover **540 ticks**, each with restore/next-step continuation. Separate real-source helpers
cover twelve ledger setups and an ordinary-attack hidden-source pair. The canonical inventory grows from 76 to 80 files;
the previous 76 values are unchanged. See [the source-proof commands and manifest](../../../tools/fire-fixtures/README.md).

Independent gameplay review additionally ran **122 producer cases, 13 ledger cases and 12 ordinary-input streams**.
Their **720 steps** include 62 performed requests, 392 Burn/63 Disease/33 Backlash raw rows, six deaths and five endings.
Raw/landed amounts, HP/barrier/bits, engagement/pause clocks, private bucket order/first weapon, events and all 720
checkpoint continuations match the actual source exactly. Four request-weapon/pause/classification/first-weapon mutants
fail. Review found a validation gap: an emptied standalone ledger matrix passed without exercising cases. The repaired
validator requires all twelve ordered case identities; empty, missing, duplicate, renamed and reordered inputs fail.
The original empty-fixture mutation now fails at the actual Rust consumer.

## Instant public reporting

The actual Fire pair has three hidden bow sources versus four hidden fist sources, with identical visible actor history,
including exact HP. Tick 13's real whiff produces three/four private rows totaling **111.90727380248373**. Per-row redaction
would expose source count. A second helper proves that anchoring the aggregate to the first private row exposes hidden
ordering. [ADR 0013](../../adr/0013-temporal-damage-projection.md) now includes a fixed marker immediately after the actual
ledger call returns, before Holy healing. Empty ledgers retain their original early return and receive no extra payout.

The Rust projector keeps instant report-local buckets separate from retained Burn/Disease windows, freezes settled
eligibility, redacts before keys, suppresses hidden weapons, adds exactly and rounds once. Private raw pre-barrier FX
stay server-only; full absorption produces no instant FX. Delayed/instant flushes cannot clear or retain each other's
rows. Explicit capacity checks cover 128 delayed buckets, 16 instant buckets, per-owner performed requests, unique
markers and 784 output events. Unsupported reports fail explicitly.

Independent public review covers **6,400 mixed Fire transitions plus 5,400 delayed transitions**, eight malformed reports,
clone/restore/attach, visibility, fixed marker ordering, barrier/payout, terminal windows and command-handle isolation.
It also checks actual live catch-up/disconnect/resume, headless cadences 1/7/13 with identical state/replay/checkpoint
results, synchronous/async policy feeds, and a controlled stale-worker reply with a fresh-session positive control.
All six hidden-ID/weapon/private-anchor/cross-flush/post-barrier/arrival-order mutants fail. A fresh independent reviewer
reran the decisive suite and accepted the public/session/adapter boundary after the first reviewer hit model capacity.

All viewer feeds are included in warmed allocation measurement: **three Fire traces, 110 measured steps each**, after
40 warm-up steps, allocate zero. Result-bearing terminal steps retain the documented exclusion. This is a steady-step
measurement, not full-game performance evidence or a frame-rate limit.

## Landmark runtime

The runtime consumes genuine pre-landmark arrays and shared scratch, computes source-exact geometry, applies whole-wall
transactions and reservations, and preserves failed-request side effects on join budget/epochs/refusal counters. Tile,
terrain and write-count rollback does not refund those counters. Scorch planning views may override hard/open checks;
its actual placement closure still uses the original transaction mask. No speculative stateful guard calls are added.

Three pinned full command streams (five zones each) compare every intermediate layer, feature, scratch array, counter,
reservation and open query; nine helper boundaries supplement them. Independent review adds **eight real streams/40
zones/686 operations and 72 helper cases/2,160 actions**, exact geometry bits and three budget/BFS/pole mutations.
Review repaired a malformed terrain-length constructor admission hole before acceptance; invalid state now fails before
any partial write. The three runtime tuning words drive execution and content identity. Read-only geometry/original-hard
accessors support the separate template leaf.

## Landmark templates and stamping

The separate template leaf implements UTF-16 parsing, mirror-before-rotate orientations, original cell order, greedy
wall-first requirement rectangles, sparse bounds, changing grid widths, planning-view fit checks and the actual
`place_landmark` handoff. Feature door parameters are sorted; reservation calls retain stamp order. The independently
registered gap of three tiles is distinct from the runtime rim rule.

Seven checked-in differential tests consume three genuine caller runs: **757 events, 18 planning views and 116 runtime
snapshots** across all five faction zones. Each replay calls the Rust placement helper itself and compares every
post-call layer, feature, owner, reservation, counter and scratch array. The observational TypeScript oracle requires
complete output/hash equality with the unmodified generator before saving observations. Exact template, orientation,
sparse-case and caller inventories prevent empty or truncated fixtures from passing.

Independent review adds **83 actual-source templates, 616 orientation structures and 6,776 stamp calls**. All twelve
behavior mutations and five fixture-deletion mutations fail by assertion. Review repaired an exotic input-boundary
divergence: source Int32 cached offsets could produce an out-of-grid index while the first Rust implementation silently
aliased it to tile zero. Rust now performs the source's Int32 offset step and explicitly refuses invalid grids or final
indices outside its admitted signed-index grid. Valid Int16-wrapped coordinate results remain source-exact. Refusal of
the legacy out-of-grid overflow artifact is a documented admission correction, not a game-map rule change.

Both runtime and template leaves are independently accepted. Search, callback selection/recipes, plain/styled map pins,
full generation and certification remain open. `PINNED_PLAIN` still runs real landmarks and bushes. No source map pins,
production service, cloud resource or DNS records are changed.

## Reproduction

Use the pinned Rust toolchain and disposable local PostgreSQL 16 instance. Run the workspace all-feature test gate,
formatting, both workspace Clippy modes and `cargo run -p rh-parity --bin parity-report`. Map oracles use Linux x64 Node
22.23.4 with `tools/map-fixtures/landmark-runtime.ts --check` and `landmark-templates.ts --check`; Fire helpers are compared
byte-for-byte as shown in their README. CI checks the same committed proof outputs. No runtime Node dependency is added.

Current formats: checkpoint /12, replay /10, observation 9, policy 6 and wire 5. Protocol 5 explicitly omits every signature
kind/bits. No Unity gameplay or visual code was changed. Astra capacity failures required Sol 6.1/medium implementation
and Sol 6.1/high final public review substitutions; the independent gameplay reviewer completed its original high-tier
review. The coordinator made the small test-only inventory repair after its worker also hit capacity.

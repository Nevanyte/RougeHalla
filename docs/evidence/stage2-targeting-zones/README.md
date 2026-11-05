# Rust targeting and zone partition foundations

Branch: `optimization_port`. Targeting is authoritative Rust shared by policy/headless seats. Unity has no targeting,
combat or flight rules. Live protocol-5 target commands, target metadata and cancel presentation remain open.

## Targeting

The C3 slice implements wand-only locks, source chase/lead/trigger behavior, independent order-search and chase-plan
throttles, 1.5-second direct-LOS grace, point attack-move for every weapon and wand-only autonomous acquisition.
Committed targeted wand casts survive move/stop/attack-move; accepted retargeting and new autonomous acquisition can
cancel/refund the old cast. These source facts supersede stale packet expectations.

Twelve new installed-reference traces plus the original 100-tick `wand_lock` are compared. The report has 42 compared
scenarios and 300 path queries, with 14 scenarios still capture-only. Fresh pinned Linux x64 Node 22.23.4 capture matches
all 58 files after revision-only normalization. The original 727-tick full-world bow/wand trace retains every gameplay
value and stays capture-only: unported consumables allocate three shared IDs. A separately named explicit-module
combat twin is identified as such. No trace IDs were renumbered and no tolerance was widened.

Independent mixed and stacked-command legacy probes matched 3,120 ticks and 813 events. A 1,500-to-1,450 ms grace
mutation diverged at tick 37; corrupting a captured private timer also failed exactly. Warmed duel, live chase and
repeated-path probes allocate zero. Authentic active locks and same-tick target removal continue identically after
restore. Seven malformed lock tuples are rejected, including non-wand/ended owners and a goal without a prior plan.

Public explicit targets require a successfully delivered actor record plus current legitimate visibility. Every complete
delivery updates membership even when props do not change; discarded preparation and reconnect cannot grant stale
targets. Unknown/hidden nonzero guesses resolve to identical silent, budgeted, replayable misses. Zero remains invalid.
The public target mirror disappears when its actor becomes concealed, even before the private follow phase drops it.
Autonomous acquisition reads authoritative sight independently of delivery cadence.

### Deliberate visibility correction

Actual legacy lookup refreshes terrain memory merely because a concealed candidate exists. Paired moving-viewer runs
with identical rejected commands differed by 33 deadlines at tick 5 and 13 visible cells at tick 604; autonomous bush
scans differed by 44 deadlines and also produced later visible differences. This was independently reproduced.

The reviewed Rust correction computes one prospective due pre-movement origin. Missing/fully concealed candidates
never commit it; legitimately visible candidates commit at the source sight-check position even when range, weapon,
re-click or path throttle later refuses. Supported positive cases retain source timing; concealed-candidate private
tapes deliberately differ from that legacy defect. Paired Rust explicit/autonomous tests continue through tick 605.

Current Rust matches already use numeric public actor IDs. Exact-distance acquisition ties use their natural order;
legacy external session strings used lexical order. The p0–p7 capture identities agree under the existing mapping.
No claim is made about retaining arbitrary old live-session identity ordering across a migration.

## Zone partitioning (M2a)

The pure partition stage includes actual arithmetic angles, integer noise/chamfers, packed-key heaps, spines, quota
growth, balancing, peeling, smoothing, ring contact and sliver classification. It does not include camp placement,
territories/repair, stylers, complete generation, certification or seed-map pins.

The committed oracle records complete arrays and RNG words/continuations for eight cases and a 1,024-stream real
generator-prefix scan: all succeeded, 398 consumed retries, and no terminal-failing seed is claimed. A separately
labelled actual-function constant-zero RNG call covers terminal failure after 1,888 draws. All 28 rule fields drive
the implementation and the allocation-free content visitor; custom definitions rebuild derived geometry.

Independent pinned-reference differential testing covered 90 additional cases (83 successes, seven terminal failures)
and matched 19,324,440 bytes of arrays, metrics, draws and continuations. Reversing smoothing order and relaxing spine
heap ties both failed. Review found a panic for a larger admitted clearing radius; the fixed helper skips out-of-array
linear offsets as the reference does. With only CAMP_R changed to 4.5 in isolated reference copies, seed 1 matches the
entire zone/cost arrays after 236 draws and slivers `[0,0,0,21,0,0]`. Canonical branch source and pins were untouched.

## Reproduction and scope

```
cargo test -p rh-sim -p rh-policy -p rh-parity -p rh-headless --all-targets --all-features
cargo run -p rh-parity --bin parity-report
node --import tsx tools/map-fixtures/zones-partition.ts --check
```

Reference check requires Linux x64 Node 22.23.4 and locked npm dependencies. Current checkpoint/replay/observation/policy
versions are 8/6/6/4; wire remains 5. Protocol 5 explicitly omits `AttackCancelled` until a real codec/presentation change,
without fabricating an existing effect. The final integrated gate and content identity are recorded in MIGRATION.md.

Final integration: 489 tests passed, zero failed/filtered and one intentional heap measurement ignored; all/default-feature
Clippy and formatting passed. Hash coverage examined 17,613 leaves with zero unhashed and every optional pattern exercised.
Four eight-basic-bot practice matches all ended naturally (2,921 combined ticks); the first replay verified 989 steps.
The full-layer map smoke deliberately truncated at 4,000 ticks and verified its 4,000-step replay. These are bounded
headless checks, not full-bot/full-game performance claims. Content identity is `94b1832fdca005e4`.

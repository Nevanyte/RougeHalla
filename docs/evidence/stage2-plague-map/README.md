# Plague reporting and bounded map stages

Branch: `optimization_port`. Native arm64 M5 Pro integration passed **557 tests, zero failures/filters and one intentional
ignored heap measurement**. Formatting and all/default-feature workspace Clippy with warnings denied passed. Parity is
**61 compared scenarios, 13 capture-only and 300 path queries: all MATCH**. The original 72 capture files are unchanged;
four new traces bring the canonical inventory to 76 files. Commit `0fc178a0` passed Rust CI `42033821121` and legacy
recapture CI `42033821099`, including all new source/map checks, PostgreSQL, C#, headless and Chromium WSS.

## Rust combat and temporal observations

The explicit default-Off `FactionMode` replaces the Holy boolean. `EngagementHoly` preserves the existing foundation;
`EngagementHolyPlague` adds player-only Disease and its separate execute entry, proportional per-source DoT caps,
post-barrier landed accounting, stagger pauses, visible signature bits and ordered private reporting windows. Execute
reads target pre-ledger HP without barrier; public bits use post-damage/post-heal state. Private totals, first weapon,
death/departure retention, empty-window clock and periodic/run-end order remain source-exact. Signature entries do not
create physical contacts or axe shreds. Other factions, AP/cards, mobs and auxiliary installers are not part of this slice.

Four actual-source traces cover thresholds/swaps, fractional wand pause, multiple sources/barriers/lethality and early
end/departure. All **449 ticks** restore and continue exactly. Separate installed-source proofs reproduce twelve exact
ledger cases and the original hidden-history pair. Pinned host and Linux x64 Node 22.23.4 outputs agree byte-for-byte.
Strict decoders refuse missing/extra diagnostics and changed installer provenance.

Independent gameplay review additionally compared the actual pair, **20 supported ledger/lifecycle cases, 26 signature
sequences and two terminal sequences**; all **160 actual-step states** restore/continue. Raw/landed amounts, clocks,
private chunk/result order and first-weapon semantics match binary64-exactly. Three cap/weapon/execute mutations fail.
Five additional source cases exercise unported producers and remain explicit boundary references.

[ADR 0013](../../adr/0013-temporal-damage-projection.md) corrects the delayed hidden-history leak. A sealed report freezes
each contribution's settled eligibility. Retained Rust projectors redact identity before keys, suppress hidden weapons,
merge anonymous sources, add exactly and round once. Private aggregation stays source-ordered. Session identity,
fresh reconnect/restore baselines, gaps and idempotent reads never recover historical entitlement. Every live/headless/
policy step feeds projection independently of publication or decisions; FX delivery cannot issue actor/item handles.

Independent projection review passed **5,400 generated transitions** and actual live catch-up/disconnect/resume,
headless cadence/checkpoint/replay, policy and failed-delivery checks. Five eligibility/identity/history/catch-up mutations
fail. The exact arithmetic leaf separately matched **540 independent Fraction-derived cases**.

Review found and repaired one P1: a late asynchronous policy reply could be submitted after a foreign-simulation error.
A real-worker handshake reproduced movement from 400 to 408.5 before the repair. The repaired session returns a typed
error, discards pending replies, preserves cadence and cannot submit or mutate the world; a fresh seat works normally.
The same independent handshake and positive control passed. The post-fix 557-test gate is the accepted native gate;
the earlier 556-test run is historical pre-fix evidence.

Allocation measurement covers **110 steady steps in each of two long traces**, after 40 warm-up steps, with all viewer
projector feeds included: zero allocations. These traces have no terminal results; the general harness excludes Result/
Victory steps. This is steady-step evidence, not a whole-fixture/full-game performance claim.

## Map stages

M3b ports actual spawn preparation/picking/protection and pure final walk-gate decisions. It consumes genuine
post-landmark/final layers. Original pool protection survives gate member removal. Five pinned full cases and labelled
helper boundaries match; **157 path queries** match exact waypoints, length bits and hazard counts. Independent review
adds **12 full cases, 369 paths, 18 picker cases, 14 gate cases, five path/hazard cases and rule variants**. Both impactful
tie mutations fail. One runtime definition supplies all 27 content words.

The elite-bush leaf consumes actual repaired stage-11b inputs, retaining internal camp/territory order, real landmarks,
features, original protection and loot avoidance. Six pinned cases match every draft/ownership cell, per-camp stream and
continuation; other layers and the main attempt RNG are unchanged. Independent review adds **323 exact cases**, including
20 fresh real snapshots, all 11 runtime rule variants, adversarial helpers and Uint16 ownership wrapping. Four source
mutations fail. The independent corpus is byte-identical on pinned Linux x64 Node 22.23.4 and the supplemental native run.

Both captures verify complete tapped/unmodified final map/null and legacy hash equality before trusting private-stage
observations. Real snapshots have nine or ten landmarks; no empty landmark substitute was used. These are bounded
actual-input leaves. Landmark runtime/search/callbacks, intervening pipeline, records/hash, certification and full plain/
styled pin parity remain open. No source map behavior or pins changed.

## Formats and reproduction

Current content: `44fb7ebcf48f519f`; checkpoint /11, replay /9, observation 8, policy 5, wire 5. Protocol 5 explicitly omits
signature-qualified effects/bits rather than converting Disease into ordinary Hit. No Unity source was changed.

```
cargo test --workspace --all-features
cargo clippy --workspace --all-targets --all-features -- -D warnings
cargo clippy --workspace --all-targets -- -D warnings
cargo run -p rh-parity --bin parity-report
node --import tsx tools/map-fixtures/spawns.ts --check
node --import tsx tools/map-fixtures/bushes.ts --check
```

Use the disposable PG16 setup and pinned toolchain. Standalone source-proof commands, capture provenance and the
historical worker freeze checks are in [tools/plague-fixtures](../../../tools/plague-fixtures/README.md). Node oracle
checks use Linux x64 Node 22.23.4. The full game, full policy/bot behavior, browser flows/performance and cloud/release
gates remain open. No cloud resource, DNS or production change accompanies this checkpoint.

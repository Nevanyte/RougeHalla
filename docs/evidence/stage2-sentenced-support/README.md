# Base Sentenced and landmark recipe support

Branch: `optimization_port`. Native M5 Pro integration passed **634 tests, zero failures/filters and one intentional
ignored heap measurement**, formatting and both workspace Clippy modes with warnings denied. Parity: **97 compared
scenarios, 13 capture-only and 300 path queries, all MATCH**. Twenty-two new Sentenced traces bring canonical inventory
from 90 to 112 without changing the previous 90 values. Independent gameplay, public-boundary and shared-helper reviews
are accepted. Full game, recipes/generator/certifier/pins, bots, client flows and release gates remain open.

## Mark gameplay and source evidence

`EngagementHolyPlagueFireFrostSentenced` adds power-zero singleton player Mark and its typed swap, kill and execute-denial
hooks, preserving Off and previous modes. Hits are filtered and counted in source order before one promotion; all that
pass's pulses use the promoted tier. Mark is instantaneous, uses the hit's weapon and target max HP, and is not paused
or compensated per hit for chill. Swap progress, far-target grace, sentence growth/cap, pass-start denial index, payout
ordering and reset/linger clocks remain source-exact. Current neutral amp/tax/suppression/attack-speed factors are
specialized out in this bounded domain; they are not unused configurable knobs. Later card/nonneutral domains must add
their live data and identity before activation.

Twenty-two ordinary-input traces compare **5,042 ticks and every-tick continuations**, including all six weapons,
accepted/no-op swaps, block/riposte/reflection/splash, leash, kills/cap-five, PvP-off/barriers, Frost and terminal MIA.
A genuine old-wand/new-bow overlap produces two qualifying same-owner hits in a pass through ordinary cast/swap/move
inputs. Separate installed-source helper matrices cover **56 runtime cases and 13 denial cases**. One explicit source
arena case is reference-only: source arena has an explicit flag and sourced producer; it is not equivalent to Rust
`by=None`, and that producer/flag remains unported. No generic unowned-damage behavior changed to force helper parity.

Independent gameplay review reproduced every new trace and both matrices, added ten edge/ledger probes, and detected
twelve semantic mutants plus a cap-classification mutant. Checkpoint, replay, hash, headless and policy checks passed.
Hash coverage inspected 27,043 leaves with zero unhashed valid perturbations. Warmed measurement covers **660 mixed
eight-player steps** and **32 trusted denial-payout passes**, all zero allocations with retained observers/projectors.
Result-bearing terminal steps keep the existing exclusion. These are bounded simulation measurements, not full-game FPS.

## Public state, instant FX and two repaired defects

[ADR 0014](../../adr/0014-sentenced-public-state.md) defines victim tier/brand and eligible-before-numeric owner selection.
Current effects may reveal the strongest incoming tier; identity may reference only a matching owner already eligible in
the same complete viewer observation. Hidden tied IDs cannot suppress a visible owner. Viewerless/dead summaries omit
identity. Complete prepare/discard/commit, reconnect, cached/direct and same-tick departure tests pass; markers/FX do not
grant actor eligibility.

One genuine 64-tick pair changes only a hidden arbitrary owner ID, preserving exact visible history while changing the
legacy global lexical winner. A separate **41-tick producer triple** changes one hidden owner with two old/new hits into
two hidden owners with one each, then reverses private order. Exact visible actor/HP/tier/brand and redacted physical
history agree. Delivered Rust observations and retained FX agree: tick 36 has one anonymous Mark amount
**19.950907519446847**, no hidden weapon, and hidden targets remain unavailable. Bootstrap/map/position/inventory/HP
setup is explicit; no private targets, progress, projectiles, ledger rows or FX were injected.

Review found and repaired two defects. Between-step departure had current tier zero but stale public EXEC_BLOCKED;
projection now derives that one bit consistently, preserving private bits/hash and other effects. Synchronous policy
driving previously continued complete observation/fallback after a projector fault; feed/decision/driver now refuse
FxProjection-faulted seats before delivery, cadence and commands. Foreign-clone and real same-instance dense-overflow
regressions plus fresh-seat controls pass independently. Non-projection fallback behavior is preserved.

Raw qualified row count is distinct from public bucket count. Existing bounds remain **512 total raw events, 16 instant
buckets, 20 operations and 784 outputs**. A trusted restored forty-flight volley yields forty Mark rows/one public key;
a two-hundred-flight state applies all damage/pulses before explicitly refusing reporting beyond the envelope. No game
damage is truncated. Actual ordinary maxima were raw 30, Mark FX 3, instant keys 3, output 23, ledger 17, performed 4,
same-owner Mark hits 2. Arbitrary dense admitted volleys are not claimed as supported public workloads. Independent public
review reproduced source pairs and tested session/live/resume/headless/wire, malformed reports, exact sums and five mutants.

## Shared landmark support

The read-only support seam validates typed safe-integer metadata, borrows the corresponding immutable fixed rules and
provides source-exact noise/coercion, scale, direction, distance, argmax, camp-node/door and Gabriel helpers. It reuses
existing deterministic math and stream functions. Door selection reads current collision and original camp order;
changing a fixed ring rule changes its boundary rather than silently using a default. Immutable territory access exposes
the transaction's actual grid. No mutable guard interface, recipe or broad style framework is added.

Seven complete generator-output/hash controls validate observational captures of **35 landmark contexts**, all zero RNG
draws with exact independent continuations. Direct scalar probes distinguish exported helpers from labelled inline
count-expression evaluation. Independent review compared additional hash/noise/direction/sqrt/distance/graph/metadata
domains and detected fourteen mutations. It found two coverage gaps: empty helper/continuation inventories passed, and
floor-rounding/crossed-distance errors survived the checked-in tests. Exact inventories and source-backed scalar
boundaries repair both. All eight repository tests pass and all four previously surviving/truncation mutations now fail.
Fresh Linux x64 Node 22.23.4 recapture and all nineteen source hashes match. Recipes and stage-4 orchestration remain open.

## Formats and reproduction

Content **`aa629bdb1a320371`**, checkpoint /14, replay /12, observation 11, policy 8, wire 5. All 21 content checks pass;
live rule definitions and DIR16 coordinates are folded. One test-only serde_json dependency reuses the existing locked
version with float_roundtrip. No legacy package source, protocol, Unity, cloud, DNS or production-service change accompanies this checkpoint.
Protocol 5 intentionally omits new faction presentation and server-only notices.

Use the pinned Rust toolchain/PostgreSQL 16, workspace all-feature tests with `--locked`, formatting, both Clippy modes,
and parity report. Source reproduction is documented in [the Sentenced proofs](../../../parity/sentenced/README.md)
and the support README; CI compares helper/public-proof outputs and checks the support oracle on Linux x64 Node 22.23.4.
Independent reviews use the recorded Sol 6.1/high fallback after Astra capacity failures. The only post-review formatter
change wraps a parity JSON match arm in an equivalent block; the full 634-test/parity gate passed afterward.

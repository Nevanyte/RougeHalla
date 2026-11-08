# Private Wish / barrier networking candidate

This branch implements P-NET-12 under ADR0022. It is not an admitted release or a completed R-to-server feature.
The coordinator owns final composition, identities and admission.

- Branch: `codex/wish-barrier-net12`.
- Immutable base: `5e9f2ac1c54053fcff5e570ee3bc8a15b6bb5bcc`.
- Stable client runtime/API checkpoint for art: `abd1ccfe6edc90df16c64283af09c913bddbd81d`.
- Additional measured presentation-layout assertion: `f5b72387` (no runtime API change).
- Raw producer timestamps: `fa2aa817`; offset-clock producer regression: `21518355`.
- Per-step spatial publication: `a4892e89`.
- Candidate protocol12 / Observation18; policy interface unchanged. Native format and content reconciliation remain separate.

## Client contract for art

`Session.Me` is the owned scalar `SelfView`: `WishView?`, `Barrier` and `BarrierRingStep` are authoritative facts.
`WishView` carries the delivered ability, ready/full clocks, recharge duration, maximum/current stock, optional next
charge deadline and optional cast ability/start/landing clocks. A held charge is not local eligibility. Missing self,
missing Wish, Full/reset and explicit Delta clears reset these facts; the client does not compute gameplay stock rules.

`Session.Snapshots.Sample(renderMs, callerOwnedList)` supplies `InterpActor.BarrierPct` and `BarrierRingStep` with the
other delivered remote facts. `Latest` and `SnapshotReceived` expose recycled codec objects; callers must not retain
them. `FxReceived` carries confirmed `WishStarted`, `WishLanded` and `WishEnded` (wire6/7/8; fixture JSON `cast*`).
Landing identities and geometry are independently optional; do not reconstruct absent points or one-ended Blaze art.

Subscribe to `Session.TimelineReset`. Welcome and accepted non-increasing source-time samples start a new presentation
epoch; art clears old transient FX/animation queues and timers tied to that epoch while preserving canonical current
self, membership and movement state. `TimelineEpoch` exposes the reset count. The art lease covers lifecycle/subscription
hunks in `MatchClient`, plus its HUD/Arena/presenter files. R/Q/E, picked references, focus-loss release and the
Poll -> input -> FlushInput -> Present sequence stay in the networking scope.

## Measured memory implications

The existing layout/allocation tests now measure `WireActor` at32 bytes versus the base's28: two delivered barrier bytes
and two alignment bytes. At512 actors this adds2,048 bytes per actor array. The40-snapshot buffer and its single spare
therefore add at most83,968 bytes (82KiB) of retained actor-array data; this is not a total process-memory measurement.
The Snapshot object grows8 bytes and WireSelf grows16 bytes. Plain decode allocation bounds are measured at32 bytes per
actor plus88 bytes for a spectator snapshot or176 bytes with self, versus the old28 plus80/160. Some-Wish/Some-Cast pooled
decode and held-Wish Delta-copy controls retain zero steady allocations. `Unsafe.SizeOf<InterpActor>()` is32 bytes;
the two new members occupy existing padding, so this list element's footprint does not grow.

The native sealed report preallocates512 pairs of viewer masks, adding1KiB of retained mask data per Sim report.
Warmed ability and barrier observation allocation controls pass. Point permission checks run only for raw Start/Landed
rows and use the completed step's existing sight/ward rules; no final catch-up world is queried for carried geometry.

## Executed checks

- `dotnet test client-unity/RoguehallaNet.Tests --no-restore`:383 passed,0 failed. The later measured InterpActor assertion
  passed in the existing focused layout test.
- `bash client-unity/sync-net.sh --check`: copies match.
- `node tools/protocol-js/check-vectors.mjs`:39 server vectors,110 malformed,13 chains,18,032 checks.
- `cargo test -p rh-protocol`:88 passed,0 failed. `v11.json` unchanged. Generated `v12.json` SHA256:
  `11e2474cf1c9da8f72b016ea27249b7ac192b09e95b49853e42cbf6b0dcc9f36`.
- Native OwnerView tests:5 passed. Additive actual-source stock/cooldown/UI witness:5/10/6 cases and byte-exact check,
  corpus SHA256 `a8da4bd8c3b26216e30aacf4c2569378fa789ebcca879164a64294709d86908b`.
  See `tools/wish-publication-fixtures/README.md`; zero-duration helper diagnostics do not invent a production rule.
- Actual raw timestamp/required-serde tests:4 passed, including a genuine restored offset-clock cast and a real
  between-step removal cancellation retaining its earlier time after the next50ms advance.
- `cargo check -p rh-sim --all-targets`: passed.
- `cargo test -p rh-sim --lib`:589 passed,2 failed,1 ignored. The63-case original ability source gate passed. The two
  failures were Observation17 metadata expectations. The training expectation was corrected to18 and its focused test
  passed. The locked ability hash tape still stops at metadata before comparing actual gameplay hashes; it has not
  been regenerated or declared matching.
- `cargo test -p rh-sim --lib fx_projector::`:15 passed after the spatial changes.
- `cargo test -p rh-sim --test barrier_view_source --test barrier_observe_no_alloc --test abilities_no_alloc`:7 passed.
- Strict all-feature `rh-sim --lib` Clippy: passed.

The source barrier consumer imports the six immutable corpora and only claims its recorded numerical leaves/refusals.
Its imported NPC statement is narrowed to row-array invariance. It does not prove full perceive, renderer or G6 parity.

## Still required

The server Cast/owner/FX/explicit-Full opt-in integration and real Room/socket matrix are in progress. Native spatial
regressions, actual-time headless hashing and historical parity consumer adapters are also being completed separately.
The coordinator still holds state/checkpoint/hash-coverage/format/tape files while reviewing G6; required pending event
time restore bounds and the real cancellation checkpoint/hash/continue proof await that composition. Old source corpora
and derived tapes are preserved.

The separate source human R/queued FX/renderer witness, art's transient reset controls, and final composed Editor/Web
all-five R-to-server proof remain INCOMPLETE. Existing strict NPC-signature gates remain in place. No cloud deployment
or spend is part of this candidate work.

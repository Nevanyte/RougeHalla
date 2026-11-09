# Isolated Full scene candidate14

Review candidate on `codex/scene-candidate14`, based on public `986f44dfd9a61eb769700adc476fc8b9e9aa8011`. This is the bounded private first cut released in `p15-frozen-db5-independent-review.md`; it is not a P15 ABI or a live feature. Protocol14/checkpoint28/replay22/OBS21/policy15/content643d294869db55a4 remain unchanged. Root owns independent review and any merge/activation.

The only existing production-file changes are module declarations in `rh-protocol/src/lib.rs` and `rh-server/src/outbox.rs`. Room, live Outbox/writer, all existing codecs/trackers, policy dispatch, Sim, native identities, Cargo.lock, shared status and v14 golden vectors are unchanged. The new C# protocol source and Unity copy are exact mirrors; no Editor/UI/art run or change is involved.

## What the primitive does

The deliberately isolated `RHC14EXP` experimental container carries a checked Full Snapshot, one complete eleven-key State, then only already supported14 Events/Fx batches. Inner bytes, duplicate occurrences, batch order and original ticks survive exactly. Timeless14 events do not acquire fabricated origin timestamps from the envelope. The internal occurrence cursor counts existing event/Fx rows; it is not a new gameplay cue or public identity. The primary live Rust/C#/JS decoders reject experimental records. Delta/replay/resync/resume and new disclosures have no implemented path.

One candidate is assembled and checked before exposing a replacement view. Count/length/order/tuple/clock/EOF checks and the existing14 owner-lock, giver, focus, quest/roster/prop validation apply. All eleven keys are required; unavailable/absent and present-empty remain their existing typed14 states. Owner Clear, Held(None) and Held(Some current actor) remain distinct. This does **not** invent universal current-actor joins: global/deferred events, hunt targets and other14 references retain their existing per-family semantics.

Rust retains immutable owned bytes; C# retains a private owned byte array; JS retains bytes only in closures. Copy-out bytes and DTOs are detached. No accepted pooled DTO is overwritten. Constructing/decoding a View never creates AcceptedFrame or gameplay authority.

The server leaf models atomic FIFO admission, a bounded owned pending source for exact retry, publication metadata, queue/writer/retention leases, cancellation and ACK progress. `Publication` is an opaque caller metadata slot, not a new live ItemObserver capability implementation. The native bridge test additionally exercises actual prepared ItemObserver/collection objects: refusal does not commit them, discard/reprepare yields the same public NPC aliases/pickup handles/complete collections, and actual commits occur only after admission. No live Room transaction is rewired here.

Writer `start()` and `complete()` are **trusted model inputs**. A future socket adapter must invoke them at actual sink-write start and successful whole-record socket flush respectively; this cut performs no socket writes and does not identify/implement that adapter. Preparing a COMMIT does not make it in flight. ACK must match the exact retained tuple and connection/epoch and be at/below the fully-completed-COMMIT watermark. The one pending ACK slot is available only during an explicitly started final write; it confers no early credit. ACK is always an untrusted progress claim, never receipt/decode/display/AcceptedFrame attestation. Charges remain while any queue/writer/retention/record owner exists.

## Limits and deliberate boundary

Every limit is supplied and validated by the caller, with checked sizes and outer-header/frame bounds. There are no product defaults. The named `SYNTHETIC-small47-not-product-capacity` fixture profile uses small explicit numbers solely to exercise fragmentation/caps.

`retainedBodyBytes` is a **conservative cumulative encoded-body allocation budget per receiver epoch**. A candidate is charged before allocation; successful COMMIT transfers that charge to accepted ownership. Closing refunds only unfinished staging. Accepted-body charges are never silently refunded/pruned, so arbitrarily retained immutable views cannot cause unlimited accepted-body allocations within that epoch. This may refuse earlier than a resident-byte meter would. It is not a complete policy-history/ring lifecycle or a process RSS bound. Caller-owned copy-outs, legacy decoder temporary object graphs, assets and multiple contexts require separate integration budgets. The queue charges retained framed bytes, actual source Vec capacities during preparation, and exact writer-record Vec capacities; its index/queue metadata is bounded by entry/scene counts, not certified as an exact heap-byte budget. No producer, room/fleet capacity, source history parity or sustained throughput claim follows.

Failure that cannot preserve the exact required public sample/cue payload closes the epoch; it does not skip, coalesce, restamp or advance it. New contexts fence stale callbacks and start with Full. Already accepted gameplay inputs are not rolled back. Full accepted-policy handoff/Memory and transparent resume remain held.

## Proof inputs and checks

The shared [fixture](../../../protocol/fixtures/scene-candidate/full14.json) has **8 cases**: two actual native preparations (small two-player ordinary validated Target; solo practice with real dummies/rack and observer-resolved Target) plus six explicitly declared codec-shape variants. Constructor/maps/seeds are declared test setup. Synthetic cases exercise available-empty Quest/Trade, redacted/clear locks, exact mirror extremes, quest/prop relations and source-time/Arena shapes. They do not claim earned gameplay for those synthetic values.

Well-framed negative controls cover a dangling quest handle, negative Arena clock and redundant Full source-time override. The latter two exposed real differences between the old JS/C# decoders and Rust; candidate-local checks align them while leaving production codecs untouched. Existing14 numeric domains otherwise remain intact; no blanket nonnegative-time or raw-reencode-equality rule was added.

Final scoped results and exact source/fixture hashes are in the receipt/manifest. Commands:

```
cargo test -p rh-protocol scene_candidate --lib
cargo test -p rh-server scene_candidate --lib
dotnet test client-unity/RoguehallaNet.Tests/RoguehallaNet.Tests.csproj --filter FullyQualifiedName~SceneCandidate --no-restore
node tools/scene-candidate/check.mjs
cargo clippy -p rh-protocol -p rh-server --lib --tests -- -D warnings
```

Cargo uses only the coordinator-loaned `bot-fight-native/target`, final-env with jobs1/debug0/incremental0. The test-only fixture exporter runs under the already-built lib-test profile with explicit absolute `RH_SCENE_FIXTURE_OUT`; ordinary tests write no fixture. No source capture/full-map/whole-workspace/PG/Editor/browser/cloud campaign was run.

Original outcomes are preserved in `logs/`: server-attempt01 failed on omitted sparse-checkout fixtures; fixture-attempt01 hit ENOSPC while attempting a duplicate dev-profile build; fixture-attempt02 passed the in-memory cases but failed its relative export destination; csharp-attempt01 was a zero-output no-restore no-op and is **not** a test pass; csharp-attempt02 had2pass/1failure because a changed total-length header cannot be rejected until the remaining transaction arrives. The control now feeds the whole transaction and still requires refusal/unchanged prior view. Test-lint attempt01 similarly found a missing sparse persistence support file. No failed run was relabelled green. The coordinator reclaimed unrelated released cache; this lane deleted no other worker data.

For the inherited design's nonblocking prose errata: the Mark-tax source refold trigger is taxed membership presence/removal, not any already-taxed owner replacement; Training has **at most** two dummies per player. Those native mechanics are separate owners and are not changed by this transport experiment.

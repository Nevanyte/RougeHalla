# P-TEST-HARDEN-1: allocation and budget tests measure what they mean to measure

- **Serves:** owner decision 2026-11-14 (chat) on Q10, Q11, Q13 of `docs/coordination/OWNER_QUEUE.md`: "do technical backend future proofing, no need for front end changes". Not an ORDER_OF_OPERATIONS item; the owner's answer is the authority.
- **Implementer tier:** implementer-sonnet
- **Reviewer:** reviewer
- **Integration base:** `coord/int-43`
- **D-rules touched:** D1 n/a (no game behaviour) · D2 n/a · D5/D6/D9 none

## 1. ID and outcome
Make four tests measure what they mean to, so they cannot go red from machine load or go stale when a count changes. No look and no game behaviour changes. Outcome: ONE shared allocation-measuring helper per language that counts the measuring thread only, `terrain_no_alloc` and `GarbageTests` use it, and `MapBlobGroundTests` derives its plane budget from the real plane count.

## 2. Dependencies
none.

## 3. Established facts (causes, with file:line)

**Q11, Rust.** `crates/rh-sim/tests/terrain_no_alloc.rs:3-4` installs `dhat::Alloc` as the global allocator, and the measurement reads `dhat::HeapStats::get().total_blocks` (`:51`, `:59`), the process-wide block count. `PROFILE_LOCK` (`:5`, `:8`) only serialises the two tests of this file against each other. Every other thread in the test process is still counted: libtest's main thread (it allocates when it prints and records a test event, and under load it is scheduled late, into the other test's measured window), the thread of the second test while it starts, and any runtime thread. Nothing in the 120 measured steps allocates (the same loop passes alone), so a nonzero `used` is another thread. This is inferred from the code, not reproduced from a natural failure (the flake is rare); the oracle reproduces the mechanism on demand with background allocating threads. The fix: count on the measuring thread only (a `GlobalAlloc` wrapper over `System` that adds to a `thread_local!` `Cell<u64>` with const init and no destructor, so the allocator never allocates or recurses).

**Q10, C#.** `GarbageTests.PerCall` (`client-unity/RoguehallaNet.Tests/GarbageTests.cs:97-123`) is already per-thread: warm-up and measurement run on one dedicated worker, `GC.Collect()` retires the allocation block (`:90`), and the reading is `GC.GetAllocatedBytesForCurrentThread()` (`:106-109`). Other threads cannot add to it, so it cannot be made red by a background thread; I say so rather than invent a red. What the decode allocates today, measured here (.NET 8.0.427, idle machine): 128 / 648 / 2808 B for 1 / 14 / 68 actors without a self and 216 / 736 / 2896 B with one, that is exactly `88 + 40 n` and `176 + 40 n`, exactly the asserted bound (`:140-141`). So the margin is zero, not "close": any extra bytes (the comment at `:84-90` describes a block-retire jump of a few KB that `GC.Collect` removes) fail the test, and nothing else can. What `PerCall` still leaves to chance: (a) it is one run, so one disturbed run fails the test where the minimum of several would not; (b) the mean over 20000 calls turns one stray allocation into a fraction of a byte, so an exact test sees it only through `AreEqual` on the double; (c) the measured section includes the delegate call and the closure's `sink` write (no allocation today, but the test cannot tell). The helper therefore offers `PerCall` (exact) and `PerCallMin` (minimum of several runs, for a bound).

**Q13, C#.** `MapBlobGroundTests.cs:151` asserts `5 * Wire.MaxMapTiles == Wire.MaxMapDecodedBytes`. `Wire.MaxMapDecodedBytes` is `5 * MaxMapTiles` (`client-unity/RoguehallaNet/Protocol/Codec.cs:26`, copy at `client-unity/UnityProject/Assets/RoguehallaNet/Protocol/Codec.cs:26`) and nothing in shipped code reads it. The decoder's real budget is `MapBlob.MaxDecodedPlaneBytes = 6L * Wire.MaxMapTiles` (`MapBlob.cs:80`), as Rust's `MAX_DECODED_PLANES` (`crates/rh-protocol/src/map.rs:20`). `MapBlob` has six `byte[]` planes (Tiles, Terrain, Regions, Bushes, GroundVariants, Patience; `MapBlob.cs:107-129`). `ecb84602c` set the constant "back to 5x (out of packet)", so test and constant agree on the stale number. **The constant is shipped code**: the fix is `5` to `6` in `Codec.cs` and its Unity copy (the gate's Unity copy check compares them). Flagged for the coordinator: it is outside "test files only", it is a constant no code reads, and it changes no behaviour or look. The implementer may make exactly that edit and nothing else in those two files; if the coordinator refuses, the amended test goes back to the literal.

**Policy change needed for the Rust helper (decide before dispatch).** A counting allocator is an `unsafe impl GlobalAlloc`, and the root `Cargo.toml:14-15` sets `[workspace.lints.rust] unsafe_code = "forbid"`, which no `allow` can lift (first compile of the oracle: "implementation of an `unsafe` method", requested by `-F unsafe-code`). The stub commit `stub: ... rh-sim denies (not forbids) unsafe_code` therefore replaces `[lints] workspace = true` in `crates/rh-sim/Cargo.toml` by `[lints.rust] unsafe_code = "deny"` (the workspace has no other lint) and the one support file carries `#![allow(unsafe_code)]`. The rest of rh-sim still cannot use `unsafe`. This is a build-configuration change the owner has not seen: the coordinator should approve it, or choose another route (a new dev-dependency crate for the counter, which needs `Cargo.toml` and `Cargo.lock`). The oracle verified green against a real thread-local implementation (4 of 4, three runs).

## 4. Survey: every test that measures allocation

### Rust (`crates/rh-sim`; all use `dhat::Alloc` as `#[global_allocator]` and read `HeapStats::total_blocks`, so all share the Q11 defect)
Integration tests, `crates/rh-sim/tests/`: `terrain_no_alloc.rs` (Q11, two tests), `no_alloc.rs` (14 reads), `no_alloc_training.rs`, `abilities_no_alloc.rs`, `arena_no_alloc.rs`, `barrier_observe_no_alloc.rs`, `cards_no_alloc.rs`, `frost_wall_no_alloc.rs`, `frost_wall_push_no_alloc.rs`, `initial_loot_allocation.rs`, `item_offer_alloc.rs`, `pack_leader_warm.rs`, `player_faction_reset_no_alloc.rs`, `status_alloc_review.rs`, `status_no_alloc.rs`, `vision_pressure.rs`.
Unit tests in the lib, `crates/rh-sim/src/`: `systems/card_bleed_feedback/tests.rs` (`card_bleed_alloc` `:1319` and `card_bleed_alloc_public_output` `:2118`, both `#[ignore]`d and run serially by `.github/workflows/rust.yml:50-52` precisely because the profiler is process-global), `cards/fight_clock_tests.rs:724`, `abilities/source_tests/full_profile.rs`, `owner_combat/bridge_tests.rs`, `owner_combat/tests.rs`, `quests/giver_tests/source.rs`, `systems/frost/source_tests.rs` (holds the lib's only `#[global_allocator]`, `:3`), `systems/plague_corpses.rs`, `systems/sentenced/group_tests.rs`, `systems/sentenced/mark_tax/source_tests.rs`, `systems/sentenced/npc_tests.rs`, `systems/walk_hint/tests.rs`.
The helper makes the `#[ignore]` + `--test-threads=1` workaround unnecessary for the lib tests, but moving them is **not in this packet** (section 5): one follow-up per file or group, mechanical. `dhat::Profiler::builder().testing()` also writes a profile file at drop; the per-thread helper does not.

### C# (`client-unity/RoguehallaNet.Tests`)
- `GarbageTests.cs`: 14 test cases through `PerCall` (`PlainDecode...` x3, `DecodeIntoTheSpare...` x3, `...ReusesPresentWishOwner...`, `SnapshotTrackerCopies...`, `ASessionReceivingSnapshotsMakesNoGarbage` x3, `ASessionReceivingDeltasMakesNoGarbage` x3, `SampleMakesNoGarbage` x3) and `SessionMeMakesNoGarbageOnTheSteadyPath` (`:238-258`), which measures on the NUnit thread with a raw `GetAllocatedBytesForCurrentThread` pair.
- `AllocationMeasurementTests.cs`: the harness controls; it reaches `GarbageTests.PerCall` by reflection (`:12`), so it breaks if `PerCall` moves unless a forwarder stays.
- `NameMergeTests.cs:145-150` (`DecidingAllocatesNothing`), `NetTests.cs:248-250` (`IdleFlushAllocatesNothing`, `LessThan(1024)`: a 1 KB slack, unexplained), `OwnerCombatProtocolTests.cs:211-217` (`RetainingOwnerCombat...`): each measures on the NUnit thread with no block retirement and no worker, so each is exposed to the same block-retire jump `GarbageTests` documents.
- `client-unity/UnityProject/Assets/Tests/Editor/*` (13 EditMode files use `GC.GetAllocatedBytes...`/`GC.Collect`, for example `ChampionPanelNoGarbageEditModeTests.cs`): Unity side, run by the EditMode suite, cannot see `RoguehallaNet.Tests`. Not touched (owner: no front-end changes); listed so a later packet can decide.

## 5. Exclusive write scope
Helpers (stubbed by the oracle author, replaced by the implementer): `crates/rh-sim/tests/support/alloc_count.rs`; `client-unity/RoguehallaNet.Tests/AllocationProbe.cs`.
Existing files the implementer edits: `crates/rh-sim/Cargo.toml` (already changed by the stub commit; only keep it); `crates/rh-sim/tests/terrain_no_alloc.rs` (both tests move to the helper; its `dhat` use goes); `client-unity/RoguehallaNet.Tests/GarbageTests.cs` (`PerCall` and `RetireAllocationBlock` move to `AllocationProbe`; keep a private `PerCall` forwarder so `AllocationMeasurementTests` still reaches it, or edit that file; tighten the `PlainDecode` assertion to `AreEqual`, see section 8); `client-unity/RoguehallaNet.Tests/AllocationMeasurementTests.cs` (only if the forwarder is dropped); `client-unity/RoguehallaNet.Tests/NameMergeTests.cs`, `NetTests.cs`, `OwnerCombatProtocolTests.cs` (move their measured sections to the helper; `NetTests` replaces `LessThan(1024)` by zero or an explained bound); `client-unity/RoguehallaNet/Protocol/Codec.cs` and its Unity copy (the one constant, section 3).
NOT in scope: the other 27 Rust files of the survey (follow-up packets, each deleting its dhat use), the Unity EditMode tests, looks, presenters, game rules, `scripts/gate.sh`, `.github/`, `Cargo.toml` (the helper needs no new dependency; `dhat` stays for the files not yet moved).

## 6. Contracts and references
C-TICK untouched; `rh-sim` source is not edited (tests only). `crates/rh-sim/AGENTS.md`: "`tests/no_alloc.rs` (and the other `*_no_alloc.rs`): zero allocations per step" stays true.

## 7. Behaviour to preserve
Every allocation test keeps asserting what it asserts today (zero, or the decode's `88 + 40 n` / `176 + 40 n`), at least as strictly. No wire byte, state hash or schedule row changes. `GarbageTests` keeps its `Iterations = 20000` and the `GC.Collect` warm-up (owner: it stays).

## 8. Acceptance checks
- Rust helper API (the oracle compiles against it): `#[path = "support/alloc_count.rs"] mod alloc_count;` with `alloc_count::CountingAlloc` (a unit struct implementing `GlobalAlloc`, installed by the test with `#[global_allocator]`) and `alloc_count::blocks_on_this_thread(|| ...) -> (R, u64)`: the closure's result and the number of heap blocks (each `alloc`, `alloc_zeroed` and `realloc` call is one block; `dealloc` is none) that the calling thread requested while it ran. Allocations by other threads, including threads the closure spawns, are not counted. Top of the file: a short doc comment on how to write a new allocation test (warm first; measure only the steady section; `assert_eq!(blocks, 0)`; the counter is thread-local so tests need no lock and may run in parallel).
- C# helper API: `AllocationProbe.PerCall(Action<int> body, int iterations = 20000)` returns bytes allocated per call, measured with `GC.GetAllocatedBytesForCurrentThread()` on one dedicated worker started without the caller's execution context, 200 warm-up calls, `GC.Collect()` before the window, exceptions rethrown unchanged. `AllocationProbe.PerCallMin(Action<int> body, int runs = 5, int iterations = 20000)` returns the minimum over `runs` such measurements. A doc comment on how to write a new allocation test. `PerCall` behaves as today's, which `AllocationMeasurementTests` keeps proving.
- `GarbageTests.PlainDecode...` asserts `AreEqual(88 + 40 * actors, spectator)` and `AreEqual(176 + 40 * actors, withMe)`: no slack, measured exact (section 3). Implementer-owned edit, not oracle.
- `MapBlobGroundTests` line 151 is the amended derived expectation (see amendments).
- `scripts/gate.sh --quick --oracle packet/P-TEST-HARDEN-1` passes.

## Oracle files (read-only for implementers)
- `crates/rh-sim/tests/alloc_count_support.rs`
- `client-unity/RoguehallaNet.Tests/AllocationProbeTests.cs` (red today on the stub's process-wide count; verified green against the real per-thread probe: exact `88 + 40 n` / `176 + 40 n`, 50 runs, three noise threads)
- `client-unity/RoguehallaNet.Tests/MapBlobGroundTests.cs` (amended, see below)

Stub (implementer replaces): `crates/rh-sim/tests/support/alloc_count.rs`, `client-unity/RoguehallaNet.Tests/AllocationProbe.cs`.

### Amendments to existing tests (owner-directed by the 2026-11-14 answer; listed for approval)
1. `MapBlobGroundTests.ValidatesMaximumDecodedPlaneBudgetBeforeAllocatingAndHonorsFrameCap` (`:151`): the literal `5 * Wire.MaxMapTiles` becomes `(count of public byte[] planes of MapBlob) * Wire.MaxMapTiles`, so adding a plane edits no test. Red today (6 planes against 5).

## 9. Validation commands
- Rust: `export PATH="$HOME/.cargo/bin:$PATH"; CARGO_PROFILE_DEV_DEBUG=0 CARGO_PROFILE_TEST_DEBUG=0 CARGO_INCREMENTAL=0 cargo test -j 4 -p rh-sim --test alloc_count_support --test terrain_no_alloc`
- C#: `export PATH="$HOME/.dotnet:$PATH"; dotnet test client-unity/RoguehallaNet.Tests --filter "FullyQualifiedName~AllocationProbe|FullyQualifiedName~GarbageTests|FullyQualifiedName~AllocationMeasurement|FullyQualifiedName~MapBlobGround"`

## 10. Risk and suggested model tier
Sonnet: two small helpers and mechanical moves. Risk: a thread-local allocator that allocates (lazy `thread_local!` with a destructor) recurses or aborts; use `const { Cell::new(0) }` with a `u64`. Risk: a helper looser than today's tests; section 7 forbids it.

## 11. Known traps
- `GC.GetAllocatedBytesForCurrentThread()` charges the unused rest of a thread's allocation block after the collector retires it: `GC.Collect()` before the window (`GarbageTests.cs:84-90`).
- `dhat` writes a file and allows one profiler per process; the per-thread counter does neither.
- `Vec::with_capacity(0)` and `Box::new(())` allocate nothing; tests that must count one block use a sized allocation.
- The second `terrain_no_alloc` test is `cfg(feature = "trusted-status-probes")`: run the file with that feature too.

## Notes from previous attempts

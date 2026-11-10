# Private strategy native admission: HOLD

Independent review2026-11-10: **HOLD native admission** at receipt seal
`71fa0d35b9dc82404d2f3f6c88cec7ad3d218445`, native code `8baad8f583512213679d38372c3cc8911c793401` atop WIP
`23561203890acab1dec4039e0bcc133ab0910292` and original implementation `f8dad023937d28f6716e426d86a95e4566c5da2a`.
Original native base is `d21552d34966cd4a3ffd10d931b3543c269cf5d2`; Root's frozen source transfers are separate.
Clean immutable review checkout: backend-strategy-native-review. [inspected-seal.json](inspected-seal.json) binds all11
changed Rust files, relevant source artifacts and receipts by byte length/SHA-256. Reviewer ran no native/source tests
and authored no Rust. Root owns DeepSeek repair dispatch; source/fixtures/tools/expected outputs remain frozen.

The seven positive tests genuinely run primary98 cases/658 operations and module-key supplement4 histories/48 calls.
This is useful partial evidence, not complete packet admission: captured callback/RNG/private-state channels are not
enforced, actual replay decoding bypasses most strict-reader checks, and required native reader-negative evidence is absent.

## Concrete repair handoff

All locations below are under `crates/rh-policy/src/bots/temporal_percept/strategy/` at this exact seal.

| Finding and exact evidence | Required repair and meaningful test |
|---|---|
| **Missing callback/RNG oracle enforcement.** source_tests.rs:2042–2084 records only path coordinate pairs; calls is never read. OverrideRng:2204–2231 collects draws but no assertion consumes them. Knowledge setup:2299–2301 uses an unrecorded seed+3 stream. All replay loops compare result/getters/Memory only; none reads op.callbacks, drawCounts or case.setupTranscript. Source runner.mts:8–25,83–84,139–147 freezes one unified ordered callback/RNG transcript and cumulative four-stream counts. Native Strategy constructors:2530–2533 and2820–2822 pass logNone although source options.log exists. |Record actual callback identity, complete arguments, returned value and RNG stream/index/value in one per-case ordered sequence; compare setup and every operation plus cumulative decide/motor/lapse/Knowledge counts. Real callbacks must still compute from raw declared descriptors/real Memory/Knowledge/services, never replay captured answers. Include Memory.whereabouts, learned/typeWeight/module context projection, path/log/attacking callbacks and constructor draws. An in-memory negative removes/reorders one callback and one draw/count while keeping result unchanged; it must fail at that intended channel. Do not replace missing observations with expected transcript entries.|
| **Captured private own-state is ignored.** source_tests.rs loops:871–1188,2323–2661 and2790–2956 never consume op.own or case.initial. Strategy output state:2139–2176 exposes only avoidId/avoidUntil/chase/goalSince/candidates, omitting captured avoidSince/currentKey/fleeBanUntil/excluded/lootSkip/judged and nested adapter/hunter/route state. Source own includes hunter ban/eng/lastAt/nextPickAt, tracker records/rising, route contested/zoneHits/zoneAvoid/heading/lastAlive/plannedAt. |Map actual retained native fields to all captured source own diagnostics at initial state and after every call, including nested real classes. Callable/instance tags may have an explicitly documented representation; no expected diagnostics become runtime input. Source HuntAdapter closure-only variables remain bound by continuation behavior, not fabricated reflection. Negative controls alter one retained expiry/cache/ban/route field in a reached state, or corrupt its comparison snapshot, and must fail even when the immediate decision is unchanged. Existing19 source controls need no redundant source rerun.|
| **Actual intake is not the advertised strict reader.** load_source:604–615 checks only JSON syntax/cases array. Config/operation decoding uses sv:617–718; source_reader::parse is called only for map values:148,535. sv accepts unchecked tag fields/duplicate entries and wraps u8 via as-u8. Typed parsing silently coerces invalid enum/shape/range: seed/route/count casts; parse_strategy_self:1908–1943 truncates weapons with take(2), unknown weapon→None, slot as-u8; faction parsing uses and_then(parse), unknown→None. No strategy-native negative reader tests exist in source_reader/private tests. |Use a checked envelope+tagged-value+typed operation reader on the **actual replay path**, including format/methodValue/suite/method compatibility, all consumed enum/field/number/range/array shapes and collection uniqueness. Validate complete operation inputs before method mutation/RNG/callback calls. Distinguish legitimate internal sentinels/optional fields from malformed intake; do not blanket reject source sentinels. Add labelled native controls for unsupported tag/extra tag field, duplicate object/Map/Set key, malformed pair/u8 range, unknown enum, missing consumed field, wrong suite/method, wrong format, empty/skipped suite, wrong weapon/slot/array count and nonfinite forbidden declared facts. Typed rejection, not panic/coercion/default, is required.|
| **Failed operation can mutate Memory first.** source_tests.rs:2544–2548 and2833–2837 call mem.observe after parse_memory_percept, then parse_strategy_percept afterward. A missing/invalid strategy-only consumed field can fail after Memory advances. Config/RNG setup is likewise not a substitute for operation preflight. |Convert all consumed representations for a call before invoking observe/decide/etc. On a reached valid history, inject a malformed later field and prove Memory, strategy/hunter/route state, RNG and callback transcript do not advance. Do not merely test the standalone unused decoder.|
| **Raw Module.data ordering is normalized in primary replay.** source_reader.rs:239–248 treats Obj as keyed schema records. Primary compare:721–725 and2616–2644 uses that generic equality. same_raw/same_goal/same_goal_decision are only used by the supplement comparison:2666 onward, contrary to README's claim that both primary/supplement use goal-aware comparison. |Apply goal-aware ordered raw-data comparison to every primary/supplement goal/current guard/candidate/own projection that can carry Module.data, while leaving named schema records keyed. Test two otherwise equal raw objects with reversed property order, nested arrays/objects and source Undefined/null/nonfinite retention: a changed raw value/order must fail. No broad exotic JSON fuzz or new source corpus is requested.|
| **Process-global attacking leaks between parallel cases.** source_tests.rs:2234–2237 defines one AtomicBool callback. Adapter cases store true; concurrently run primary/supplement case setup stores false at2516–2519/2804–2807. Callback reads whichever test last wrote it. |Use per-case owned callback environment, preserving actual source options/operation env semantics. No process-global mutable case data. Add interleaved/concurrent two-instance true/false checks that retain independent state and transcripts; simply hoping the seven-test scheduling avoids the race is insufficient.|
| **Final declared regression receipt is missing.** focused-strategy.log runs original10 declared tests green on earlier implementation. private-strategy-final.log is a retained WIP failure15 passed/1 failed at path case. source-six-final.log final7 passes covers source suites/supplement, not the10 declared functions in private_strategy_tests.rs. |After repairs run the existing exact private_strategy_tests module filter (10 current tests), all new source/reader/control tests, scoped fmt and both strict default/all-feature policy library/tests Clippy. Preserve WIP failure as history; do not relabel it final green. Reuse unchanged Memory29 receipt with exact code binding unless a Memory change actually requires rerun.|

The intended checker negatives above are labelled synthetic controls, separate from actual-source parity. A comparator
mutation must fail for the intended field/channel rather than decode/compile failure. Full-suite guards must assert
the actual expected case/operation sets/counts; the present loops can skip unknown/missing suites and still pass with0
operations because they only print totals. Preserve primary98/658 and supplement4/48, and do not edit frozen cases to
make a new checked reader accept a narrower shape.

## What this review accepts as partial evidence

- Exact source payload pins match the released primary source12,263,237 bytes SHA
  `3a3ae0d498cc3933b5eee11c5be995f267f4a76530379ad7c73a934082125d8d`; coverage/controls match their prior release.
  Supplement1,004,072 bytes SHA `32836e03d47993fceec22fc7fb648e937d01b3e9b221da9499ea9e99d31efc0c` remains separate.
- Real admitted Memory and real native Strategy/HuntAdapter/MobHunter/MobTracker/BuildRoute are instantiated. Primary
  `$previous` uses the preceding native goal and separately guards captured current; supplement also uses native prior
  goal. No captured expected Memory/candidate is installed as runtime state. Preserve this boundary while expanding checks.
- The final path fix constructs TileMap from frozen static map bytes and uses real rh_sim Pathfinder/path_length for
  declared source-path services. This is valid method input/service reproduction, not a hidden World lookup. Source
  implementations, fixtures, expectations, public Goal/HumanBot, live/Unity/protocol/Cargo.lock are unchanged. Only
  existing-Rust hunks are mod strategy registration and Memory source_input visibility; new code stays private scope.
- Current result/getter/Memory comparisons are binary64-bit exact, with ordered arrays/Maps/Sets. No numeric epsilon
  whitelist was activated or widened. Adding the omitted diagnostics/callbacks may expose genuine libm leaves; use only
  independently reviewed source NUMERIC_CONTRACT path-specific inherited bounds, retaining exact branches/timers/RNG.
- source-six-final.log:7 passed,0 failed,1.36s, with totals14Tracker/127Hunter/36Route/122Memory/67Adapter/292Strategy and
 48Supplement. memory-final-regression.log:29 passed,0 failed,154.48s, including2112 protection and773 NPC rows. Final
 strict default/all-feature lint logs are terminal Finished; fmt output is empty. No whole-bot/headless activation claim.

The native classes contain the expected retained structures, but the omitted oracle channels prevent concluding full
source-fidelity admission from those seven passes. This handoff intentionally stops before a premature algorithm-wide
release. Root routes all repairs/tests to DeepSeek in the existing new-code lease, then supplies a new immutable seal
for finite follow-up review. No source recapture, public activation or tactical/module integration is authorized here.

## Suggested exact final gate scopes

Use Root's existing private target, pinned Rust, jobs1, locked/offline environment; reviewer has not run these commands:

```sh
cargo test -p rh-policy --lib bots::temporal_percept::strategy::private_strategy_tests --locked --offline -- --nocapture
cargo test -p rh-policy --lib bots::temporal_percept::strategy::source_tests --locked --offline -- --nocapture
cargo fmt -p rh-policy -- --check
cargo clippy -p rh-policy --lib --tests --locked --offline -- -D warnings
cargo clippy -p rh-policy --lib --tests --all-features --locked --offline -- -D warnings
```

The second filter must actually include the new strict replay/negative/comparator tests, or list a separate exact module
filter and results. Final evidence binds raw commands/exits, case/op/channel counts and code/source hashes. Do not
relabel absent checks as passed or rerun the unchanged heavy Memory/source campaigns merely to add totals.

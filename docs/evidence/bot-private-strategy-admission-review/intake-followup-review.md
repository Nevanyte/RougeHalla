# Private Strategy intake follow-up — independent review

2026-11-10. **RELEASE for bounded private Strategy method parity at clean seal `9bde44388c3ef1765db64ba88642acabf7d03ec4`.** This supersedes the three intake/numeric-ancestry HOLD groups in `trace-repair-review.md` at `64bfa62feff7a72f8373655d8b3c37732727c085`; it preserves that historical review and its substantial source/trace PASS evidence. Reviewer inspected the immutable native checkout `/Users/nevinmckinnon/Documents/Projects/RogueHalla-worktrees/backend-bot-strategy` read-only and ran no Rust tests, source captures or heavy Memory campaign. All implementation/tests remain DeepSeek-authored.

The follow-up changes exactly three Rust test-support files (`source_strict.rs`, `source_tests.rs`, `source_trace.rs`) and six evidence files. No engine/Memory implementation, declared regressions, source/corpus/tool, dependency, lock, World, public Goal, protocol, Unity/network or shared status change occurs in this delta. Earlier production implementation and admitted component review remain part of the complete admission chain; this document reviews the finite held delta rather than replacing them.

## Held groups resolved

All source references below are under `crates/rh-policy/src/bots/temporal_percept/strategy/` at the reviewed seal.

1. **Typed Result propagation: PASS.** `source_tests.rs:2322` propagates hunter `parse_mob_entries`; `:2484` does the same for trackerObserve; `:2374` propagates `can_farm_descriptor`. The route no longer discards its typed failure, and malformed mob rows no longer panic inside Result-returning preflight. The inspected preflight section also validates decide environment module ids against the actual config modules (`:2425` vicinity), rather than discarding config. The final actual controls reach `hp: expected a finite number`, `kind: missing field kind` and `canFarm.kind: unknown descriptor future` as typed errors.
2. **Declaration-consistent shared apply/rejection: PASS.** `Injection::apply` (`:2671` vicinity) synchronizes mutated nondecide input into `declaration.input`, or decide status into `declaration.status`; `source_strict.rs:536` vicinity additionally checks declared status/current/engaged against consumed values. A separate deliberately stale declaration control (`source_tests.rs:5030`) asserts its declaration-mismatch error; the coherent version asserts the semantic weapon error, not merely some Err.

   Six checked apply functions (`:2814`, `:2901`, `:3039`, `:3133`, `:3186`, `:3346`) perform complete operation preflight before resetting the transcript or dispatching mutation. Each normal replay loop and its injection branch call the same function. For example tracker uses it at `:3483` and `:3501`, while Strategy uses it at `:4089` and `:4125`. The injection controls thus no longer snapshot a separate inherently pure validator call.

   Eight reached-history controls (`:5082` onward) require exact semantic error substrings and compare real Memory, encoded nested own state and the actual ordered callback/RNG trace before/after (`:2744–2790`). They cover Strategy decide/observe, adapter observe, hunter walk/mob rows, tracker mob rows, route canFarm and Memory noteSent. Inspection confirms each checked function returns on preflight Err before it can mutate any supplied instance.

   Precision about the proof: Strategy/adapter snapshot construction reuses its pre-call draw-count array for the after snapshot (`:3800–3819`, `:4086–4109`); it does not independently re-read those counters. RNG nonadvance is nevertheless enforced by the real compared TraceLog: every actual `TraceRng::draw` unconditionally appends stream/index/value and advances index/count (`source_trace.rs:155–169`), and rejected operations return before transcript reset. Any draw would therefore change the compared transcript, including on the first prior-empty transcript. This is not a blocker for the actual checked path or an assertion that the cached array itself proves nonadvance.
3. **Actual judged-z ancestry: PASS.** `source_trace.rs:1020–1077` applies the approved Gaussian bound only when own-state root is an actual `Instance(StrategyImpl)`, field is `judged`, container is its Map and leaf is direct numeric `z`. All other fields fall through ordered binary64 comparison. The actual comparator controls (`source_tests.rs:4615–4669`) accept a tiny genuine judged delta, reject an out-of-bound judged delta and reject the SAME tiny change in raw Module.data. Raw-data order/nested-value controls remain present. This closes the previous shape-only Map relaxation without broadening the numeric contract.

## Exact code and immutable source bindings

| File | Bytes | SHA-256 |
| --- | ---: | --- |
| `source_tests.rs` | 190981 | `8503ff8ab779397bd1a0f9035ad5024f61bb8f027ae9f95e664359e05621a105` |
| `source_strict.rs` | 46282 | `17918b823b27b8998afa782500fea9dd46e9e050aba1ef8fc3fd54b8dcc9a85c` |
| `source_trace.rs` | 45762 | `13745f4d42b3829a73af6c91721284894fca9069c023d8f3fbd008cf9f08bb3f` |
| Primary source | 12263237 | `3a3ae0d498cc3933b5eee11c5be995f267f4a76530379ad7c73a934082125d8d` |
| Primary coverage | 1981587 | `a560ee78a81e9f851933aafda5d42fe566a0e72d346d74f51d15a1a1890d6e12` |
| Primary controls | 8143 | `ad9b789f8c40c922ac221c6e5eef7a483037383d23b3b8624b6fea774fd4877b` |
| Module-key supplement | 1004072 | `32836e03d47993fceec22fc7fb648e937d01b3e9b221da9499ea9e99d31efc0c` |

The four source artifacts remain byte-identical to the independently admitted source and earlier sealed review. Git diff from64bfa62f contains no parity/tool or declared-regression changes. The shared dispatch refactor preserves actual native previous-goal handling, the separate captured-current guard, actual service-generated callbacks, setup/op trace and own/getter comparisons already reviewed at64bfa62f. Expected snapshots/transcript returns are not newly installed as inputs.

## Actual receipts

Read the committed raw files under `docs/evidence/bot-private-strategy-native/`; no receipt below is a reviewer rerun. README binds the exact locked/offline filters, pinned Rust1.97.0, jobs1, incremental0 and private target `target/strategy-admission-repair`.

| Receipt / declared command | Actual terminal evidence |
| --- | --- |
| `intake-repair-red.log` / source_tests filter | 10 PASS, 1 FAIL; hunter malformed-mob preflight panics at `must`, 7.67s. Preserved historical red. |
| `intake-repair-green.log` / source_tests filter | 11 PASS, 0 FAIL, 7.11s; 33 reader labels, all8 intended semantic rejection traces and judged-ancestry controls. This intermediate green retains seven compiler warnings; it is not the final lint receipt. Extra final blank line preserved. |
| `source-trace-repair.log` / `cargo test -p rh-policy --lib bots::temporal_percept::strategy::source_tests --locked --offline -- --nocapture` | Final11 PASS, 0 FAIL, 8.29s; same controls and exact suite totals. |
| `declared-trace-repair.log` / analogous `...::private_strategy_tests` filter | 11 PASS, 0 FAIL, 0.00s; all original10 named regressions plus attacking-instance independence. |
| `clippy-default-trace-repair.log` / `cargo clippy -p rh-policy --lib --tests --locked --offline -- -D warnings` | Successful terminal dev-profile record, 0.12s; README records exit0. |
| `clippy-all-trace-repair.log` / same with `--all-features` | Successful terminal dev-profile record, 0.05s; README records exit0. |
| `fmt-trace-repair.log` / `cargo fmt -p rh-policy -- --check` | Empty raw output; README records exit0. |

The red log directly demonstrates the hunter parse panic, not every old HOLD independently: the old dropped canFarm Result and stale-declaration defects are established by the prior sealed source review. Its printed earlier nonadvance controls already use aligned inputs. The final green demonstrates the repaired intended branches. This distinction avoids turning explanatory README history into an invented multi-failure raw receipt.

Final primary totals: tracker1/14, hunter24/127, route17/36, Memory12/122, adapter9/67, Strategy35/292 =98 cases/658 operations; supplement4/48. All operation channels and source totals remain enforced. The earlier unchanged29-Memory PASS evidence is reused; no reason to repeat it for this test-support delta.

Receipt SHA-256: final source `1194609b0c64ec61a6e09539f8455da1cb285ae7951db218dcb0adfe34da3897`; declared `84f3fdc245627a20abccba9fd072bc34ed5189897c29b5e26ca742fd8a0c0015`; default lint `22e0df986057b9ba5be07526ac5fb348862a3dedef42108383cc3e088acbb889`; all-feature lint `ee1d3fffa2022e962e63e0dbe4d35c9c198450a20c29fc09030f635dbb38bfcd`; red `ca491dafaca537dcd98791645e5a2724064d0354e08a524bce6cf3958d1734ec`; intermediate green `b728ffa9a72132017c69d76573dc6a7ab082809ff5af4c476dd566de600cd1d3`. Empty fmt has standard empty SHA-256 `e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855`.

**Disposition: RELEASE the complete candidate through9bde4438 for the approved finite private Strategy/component consumption scope.** No remaining concrete blocker in the three held groups. This does not assert arbitrary JSON/stringify coverage, introspection of opaque module closures, all unwitnessed source branches, complete Brain, fair Observation binding, or live/public activation. Those remain separate scoped work. Root alone integrates and releases downstream leases.

## Root integration admission

Root integrated the reviewed native history as `489c4409` through `2b05e607`, excluding the already-admitted duplicate source-transfer commits. The complete13-file Rust component/support scope and native evidence are byte-identical to reviewed `9bde4438`; frozen source remains unchanged. At integration code `2b05e607`, Root ran `cargo test -p rh-policy --lib bots::temporal_percept::strategy:: --locked --offline -- --nocapture`:22 passed/0 failed, actual test time10.71s, command exit0 (including cold compile80.80s). [Raw receipt](root-integration-strategy.log). Existing author strict lint receipts remain revision-scoped; no repeated Memory campaign or full workspace claim.

Root also ran `cargo fmt -p rh-policy -p rh-sim -- --check`, exit0/empty output. Commands used pinned Rust1.97, jobs1, incremental0/offline and the isolated integration target `target/root-strategy-notice-admission/build`. This admits the complete finite private Strategy and unlocks separately allocated tactics/modules work.

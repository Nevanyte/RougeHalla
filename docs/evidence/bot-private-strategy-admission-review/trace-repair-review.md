# Private Strategy trace repair — independent review

2026-11-10. **HOLD at clean seal `64bfa62feff7a72f8373655d8b3c37732727c085`.** Read-only native checkout `backend-bot-strategy`; earlier held receipt seal71fa0d35/review17d3e41c remains historical. Source fixtures/expectations are immutable. Reviewer authored no Rust and ran no tests. This follow-up is bound to the sealed code, even if author repairs subsequently begin.

The trace/own-state/input/race repairs are substantial. Retain passing source11 and declared11 as scoped evidence, not complete admission: two concrete typed-intake/control defects remain below. This does not activate full Brain/live/public behavior.

## Mandatory repair: real typed preflight and controls

All line references are under `crates/rh-policy/src/bots/temporal_percept/strategy/` at64bfa62f.

1. **Dropped typed error / panic in preflight.** `source_tests.rs:2377` discards `can_farm_descriptor(field(input,"canFarm")?)` with `let _ = ...`, so an otherwise schema/declaration-consistent unknown canFarm kind/invalid inner descriptor passes `preflight_route_input`. Actual route dispatch later reparses with expect/must. Propagate its Result before any method mutation instead. `preflight_hunter_decide` around2322 and `preflight_operation` trackerObserve around2483 likewise call `must(parse_mob_entries(...))` inside functions promising `Result`; a malformed typed mob row panics rather than returning its typed intake error. Propagate those results with the same no-mutation boundary. Review the bounded existing preflight helpers for this exact dropped-Result/unwrap pattern, not a broad input campaign.
2. **Most new typed/nonadvance negatives stop at declaration mismatch.** `Injection::apply` (`source_tests.rs:2580–2628`) changes only `op.input`; non-decide `declaration.input` stays original. `source_strict.rs:516–522` checks their ordered equality before typed preflight, so wrong weapon/slot/array count/faction, malformed tracker now/missing awakeMoved, hunter walk, route canFarm, sent command and adapter observe mutations are rejected for “declaration.input differs” before their intended typed field. The standalone typed controls around4520 onward use the same input-only mutation and assert merely is_err. Decide status input and declaration.status also need a coherent malformed value when testing typed status rejection. This does not prove the advertised typed error paths or atomic rejection of those fields.

Required finite controls: mutate both declared and consumed copies consistently for each semantic-malformed operation; assert the returned error names the intended typed field/enum/descriptor rather than declaration mismatch, structural skip or panic. Preserve one separately labelled declaration-mismatch control. On reached native histories require Memory, nested own state, all RNG counts and ordered callbacks unchanged. Add a declaration-consistent malformed canFarm control that fails the repaired typed preflight, and representative malformed hunter/tracker mob-row controls that return errors rather than panic. No source/corpus mutation or generic fuzz matrix is requested. Re-run the affected new controls/source filter and existing declared regressions plus scoped lint/fmt; unchanged heavy Memory evidence needs no rerun.

The root manager was notified promptly; all Rust repair remains DeepSeek-owned. Remaining old-HOLD checklist review continues against64bfa62f and will be appended here.

### Shared-entrypoint requirement for the repaired negatives

`inject_non_advance` (`source_tests.rs:2644–2681`) snapshots then calls only `preflight_operation`; each replay loop has a special injection branch that breaks before its normal dispatch. The validator takes no mutable engine/Memory/RNG/service arguments, making that snapshot check structurally nonadvancing. It would still pass if a future normal-dispatch Memory mutation were moved before preflight. The repaired controls must call the same checked apply/dispatch entrypoint as normal replay and capture its typed Err, rather than testing the validator in a parallel special branch. Feed declaration-consistent malformed input into that real path and compare the real reached instance before/after. A shared Result-returning operation boundary is sufficient; no broad Rust API refactor or new source cases are needed.

## Mandatory repair: numeric whitelist must use actual ancestry

`source_trace.rs:1051–1059` enables the judged Gaussian epsilon for **any** Map value object that contains fields `until` and `z`, without checking its field ancestry. A raw Module.data Map containing an object `{until,z}` can consequently inherit the Gaussian allowance, contrary to the approved exact raw-data comparison and the sole `StrategyImpl.judged[id].z` whitelist. Scope the relaxation to that actual retained field path only. Add a bounded synthetic lookalike raw Module-data Map control: a tiny z change within the allowed Gaussian epsilon must fail there, while the same permitted delta in the genuine judged leaf passes. Until, all other fields, decision results and ordering remain exact. No wider tolerance or source fixture change is justified.

The decide declaration should also be kept coherent during controls: validate `declaration.status` and explicit declared current against the consumed input representation (while `$previous` continues to use the real native prior goal with the separate captured guard). Never allow an earlier declaration mismatch to masquerade as a typed malformed-field result.

## Earlier HOLD findings substantially resolved at this seal

- Unified per-case TraceLog/TraceRng now records actual callback name/full arguments/result and ordered stream/index/value; setup and every operation compare callbacks plus all four cumulative counts. Real Knowledge construction uses the declared separate seed+3 stream. Its70 actual draws are bound by admitted constructor code/consumption and a same-seed next-draw check; the70 trace values are independently reproduced from that deterministic stream, not fed back as captured outputs. This is a component witness, not createBrain's derive/tag wiring.
- RecordedMemory.whereabouts, actual Knowledge methods, argument-sensitive learned/typeWeight/module descriptors, real path/log/attacking callbacks and source full self/camp/mob argument fields are enforced. Actual native values compute callback returns; expected transcript entries are not runtime service answers.
- Complete initial own/Memory/getters and post-operation own/Memory/getters are now compared, including judged/excluded/lootSkip/avoid timers, nested tracker/hunter bans/engagement and BuildRoute contest/zone/heading/plan state. Closure-only adapter state remains continuation-bound rather than assigned from expected diagnostics. Callable tags are representation of actual configured callback presence, not fake state installation.
- Both primary/supplement use the real native previous goal for `$previous`, with a separate ordered captured-current guard. Ordered Module.data is retained through native MethodValue; primary decisions, candidate/own and current comparisons now use ordered comparators. Synthetic reversed/nested-data comparator controls exist; the ancestry bug above is the remaining relaxation gap.
- Process-global SOURCE_ATTACKING is removed; owned Rc callbacks retain per-instance attacking/log context. The new two-instance standalone/interleaved control checks independent actual decisions/state/transcripts. No global mutable test case environment remains.
- The strict decoder is genuinely called by `load_source`/`load_supplement` and by operation preflight, not only map decoding. Closed envelope/suite/method sets, case uniqueness, nonempty suite coverage, exact per-suite totals, tagged collections/duplicates/u8 constraints and source-supported nonfinite/Undefined/null values are represented. Complete typed config/input parsing is now intended on the actual replay path; the explicit Result/control defects above prevent admitting that claim yet.

## Frozen source and actual receipts

Independently read sealed Git blobs and verified unchanged against held71fa0d35:

| Artifact | Bytes | SHA-256 |
| --- | ---: | --- |
|Primary source|12263237|`3a3ae0d498cc3933b5eee11c5be995f267f4a76530379ad7c73a934082125d8d`|
|Primary coverage|1981587|`a560ee78a81e9f851933aafda5d42fe566a0e72d346d74f51d15a1a1890d6e12`|
|Primary controls|8143|`ad9b789f8c40c922ac221c6e5eef7a483037383d23b3b8624b6fea774fd4877b`|
|Module-key supplement|1004072|`32836e03d47993fceec22fc7fb648e937d01b3e9b221da9499ea9e99d31efc0c`|

At64bfa62f the core reviewed reader/trace code bindings are `source_tests.rs`176446bytes/SHA256 `8b883e1cf867093a2d5706f4bd50c20cf98e8d800046b5c67a5fc6a9cae79f5d`, `source_strict.rs`44389bytes/SHA256 `fc76b90db8668ac5ed446c6176a616b49279bb96dea495aaafa85d0c0f156680`, and `source_trace.rs`45541bytes/SHA256 `dd7c1847711afbac822a7c5c009df330ce1edcded713de216e90acfd2119a2d6`. New repair changes stay within the existing private strategy scope plus evidence. No Memory semantics/public Goal/Brain/World/protocol/Unity/dependency/lock/source change was found.

Read the actual raw final source log:11passed/0failed,7.29s. Exact primary totals are six suites/98cases/658operations: tracker1/14, hunter24/127, route17/36, memory12/122, adapter9/67, strategy35/292; supplement4/48. Initial/setup/own/callback/count checks are actually called, so this is substantially stronger positive evidence than the held seven-test run. Trace removal/reorder/draw-count/own-corruption controls fail their intended comparator channels while the decision remains unchanged. Reported31 reader negatives and six intake histories are **partial evidence only** because the typed-field/entrypoint issues above mask their intended reach.

Actual declared-regression log reports11passed/0failed: all original ten functions retained plus attacking-instance independence. Both final strict default/all-feature library/tests Clippy receipts terminate successfully (4.89s/0.05s), fmt is empty successful output as reported. README binds the exact filters, pinned Rust1.97.0, locked/offline/jobs1/private target; older WIP failures and intermediate greens remain explicitly historical. No unchanged heavy Memory rerun is required because Memory code is unchanged.

## Final disposition and finite repair gate

**HOLD** for typed error propagation, meaningful declaration-consistent same-entrypoint rejection/nonadvance controls and exact judged-path tolerance. Root has relayed these concrete requirements to DeepSeek. Preserve the source/trace/own-state/regression greens as valid scoped evidence; do not discard fixtures, widen tolerances or retune source to fix intake tests. After the narrow repair, inspect the new sealed delta and actual new source/declared/control/lint/fmt receipts; rerun no heavy Memory/source campaign solely for this review. Release will remain finite private method parity, not arbitrary JSON behavior, opaque-module closure introspection, complete Brain or live/public activation.

# Runtime admission CI repair (test-only)

Exact base `3126e5c3209334c637d1f067f3f0b8209dbf06f4`; private branch `codex/ci-runtime-admission`. Only `crates/rh-server/tests/runtime_admission.rs` changes executable source. No production runtime/gameplay/protocol, timeout, randomness, dependency, schema/header/content/tape, lock or shared-status change. Sealed MarkTax2cc1 remains untouched.

## Failure and diagnosis

Normal CI42615460588 / Rust job129154324524 failed the postgres-feature `source_endpoint_hello_planning_ready_and_live_quest_trade_state`, generic8-second public-condition timeout. The other5 runtime tests passed. `CI_FAILURE.txt` preserves the raw excerpt; `CI_SOURCE.json` pins the full retained raw log's SHA and exact commit. The old CI lacked predicate diagnostics, so its exact stalled predicate cannot be recovered retrospectively from that log alone. No retry relabels it green. `git diff 1a1ac8d7..3126 -- crates` is empty; the fixture defect predates the UI/evidence-only public delta.

The diagnostic-only overlay added decoded public tick/time/frame counts and exact caller location for each condition, leaving original inputs, predicates and8-second deadline unchanged. One initial diagnostic invocation passed. A bounded maximum12 further invocations used precisely the SAME overlay, ordinary fresh OS match entropy, no secret/seed/config/outcome installation; attempts1–6 passed and7 failed, at which point the loop stopped. Every raw invocation is retained and ordered in `ATTEMPTS.json`. There was no edit or timer adjustment between attempts, and no run-until-green campaign.

The failing call is diagnostic source493: waiting for `trade_used` after encoded Stats Trade pick0. The actual preceding public facts show why:

| Boundary | Actual delivered facts |
|---|---|
| Quest accepted, tick45/time2250 | Owner(690.383,124.323395), Alive/full HP. Stats broker(592,208). Three saved offers already exist from an earlier valid visit. |
| Move to central region then Move to broker submitted | Input sequence advances to5 then6. Current acknowledged input remains3. |
| Old `until(!offers.is_empty())` | Returns immediately on the SAME old public sample (ack3/6, tick45). It cannot prove receipt of either Move or current proximity. |
| Trade submitted | Sequence7 arrives before the owner has traversed the ~129.15-unit gap. Actual trader range is112. A Move command sets a path, not a teleport; action processing precedes movement. |
| Timeout | Tick2714/time135700, Active, owner Alive/full HP at(592,208), ack7/7, three saved offers, trade_used=false. The rejected trade is not automatically retried merely because the owner later arrives. |

Native `traders/runtime.rs` refuses farther-than112 or blocked LOS before applying any saved quote; source `packages/server/src/sim/traders.ts:65` does the same. Source lines109–113 produce quotes while visiting and do not clear them on departure. Native `traders/view_tests.rs:188–204` explicitly preserves saved quotes when the merchant leaves sight. Production behavior is correct for this reproduced failure; the test had mistaken retained owner data for a new arrival acknowledgement.

`diagnostic-overlay-reconstructed.txt` reconstructs the exact recorded diagnostic edit against immutable3126, with line493/276 assertions checked. Its SHA759fdfe49e8ed974e3d1d39e9e8ce73ef3a0c46bd64c663669b7a1b33ea51419 matches that edit. It is explicitly a reconstruction for source context, NOT a claimed historical Git commit.

## Repair and proof

Before submitting Trade, the test now waits for:

- the requested broker Move frame's cumulative acknowledgement;
- current delivered Alive owner and currently delivered Stats merchant within the existing source catalog `TRADER_RANGE`;
- the owner's saved offers.

This is test navigation, not trade authority. The unchanged subsequent encoded Trade, authoritative `trade_used`, nonempty saved stat deltas, owner/privacy checks, arena refusal of Training grants and all other original assertions remain required. No private Sim/map/entity read or forced outcome is used. The original8-second timeout and4-second frame-read timeout remain unchanged. Better failure context is retained for every existing `until` caller, excluding session/ticket/secret values.

The deterministic declared-public-facts test covers saved quote before receipt, ack-but-far, notack-but-near, exact ready, moved broker, missing owner/trade, and arrival without quotes. These are labelled control facts, not claimed earned World fixtures. Restoring the predecessor quote-only predicate causes the intended assertion failure (`old-quotes-only-control.log`), not a compile/setup failure. Exact source bytes were restored before final positive checks.

Focused final gates:

```
cargo test -p rh-server --features postgres --test runtime_admission --locked -- --nocapture
cargo clippy -p rh-server --features postgres --test runtime_admission --locked -- -D warnings
cargo fmt -p rh-server --check
```

All7 tests pass (original6 plus1 deterministic control); scoped strict lint and fmt pass. `fixed-runtime-seven-first.log` is the first all7 positive after the repair; `fixed-runtime-seven-final.log` is after the additional unavailable-quotes control and restored semantic mutation. No broad workspace/map/source/browser campaign was run. Raw diagnostic and initial fmt receipts are retained; final checks do not overwrite earlier outcomes. Evidence-local attributes only tolerate Cargo's terminal blank lines for raw logs, never ignore files or weaken tests.

All Cargo used pinned local tools, jobs1/debug0/incremental0 and the exclusively loaned final-target. DATABASE_URL was explicitly unset; Rig uses memory persistence even under postgres feature, and no PostgreSQL cluster was started/stopped or queried. Only original task-owned loopback routers/subprocesses ran and their existing Drop/runtime teardown completed. Final-target released after checks. Root owns review/merge/push and the next normal CI run; this is not a claim of overall CI or full runtime/browser admission.

`CI_FAILURE.txt` preserves GitHub's timestamp-only trailing spaces exactly; the evidence-local attribute disables only blank-at-EOL complaints for that one raw excerpt. No receipt bytes were trimmed or replaced.

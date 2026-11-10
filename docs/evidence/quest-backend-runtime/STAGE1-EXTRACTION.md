# Quest Stage1 — objectives/rewards extraction

Status: FINAL STAGE1 SEAL; PRIVATE CONTINUATION PASS; FINAL STRICT LINT/FMT PASS. Based exactly on released
Stage0/pin composition 36564c333d56beb8d47a9962cec033eea85b1921. Stage2/card work is NOT part of this packet.

## Identity / scope

Changed only four Rust paths plus this sanitized evidence directory:
crates/rh-sim/src/quests/{live.rs,mod.rs,objectives.rs,rewards.rs}. Catalog, rules, giver, roster, placement,
quest_view, all existing tests/corpora, source fixtures, versions, pins, Cargo.lock, shared status, client,
network and Claude scopes are untouched. Content hash remains 8edd862f48ffa100; protocol14/checkpoint29/
replay23/OBS21/policy15 unchanged.

## Final code inventory

| Path | Bytes | SHA-256 |
| --- | ---: | --- |
| crates/rh-sim/src/quests/live.rs | 34,144 | ef46370392f392f35d84c40be88be586d78ea696d74459077af40acb3bc1d631 |
| crates/rh-sim/src/quests/mod.rs | 1,246 | 20457504b023a4204464b4207de8608bf1fd96de502932d0c5af624da1f162c8 |
| crates/rh-sim/src/quests/objectives.rs | 4,029 | 0edd8532cba8ad8d912237be3f72c13a895f0a8ff61dcd8dc66de325113f2a89 |
| crates/rh-sim/src/quests/rewards.rs | 2,309 | cac543843c52fca0ec700767fbfda6b1246083781658c9e880c0c698d2ea6306 |

## Final no-op delta after gate set

The preserved canonical gate set below ran on the reviewed Stage1 code inventory
af48b280022b30428d9a6d1548e9467ba9cebf8cc127140d88001d63c8a52ef4 (live),
fded335464ea83787de4937b54825c8300af615197881627350ce1bca22f4557 (mod),
80cdbb391ea7a13094a17b1287b6c80f998deb7572af99d6d01b89366767fdfd (objectives),
a35af0afd927c43ddcbb1a2fb9ffe19a84174df41d6b0dec099237b1c3fa4371 (rewards).

Final strict-lint cleanup removed only the identity conversion u32::from(visits.count_ones()) and formatted
the four in-scope files. This is behavior-preserving, no state/event/order change; per Root direction the
13-minute hash coverage and completed canonical suites were not rerun for it. Independent review can verify
the delta mechanically. First lint failure is preserved in stage1-clippy-firstfailure-raw.log; first fmt
failure in stage1-fmt-firstfailure-raw.log.

## Production seam

- objectives.rs: derived Kill/Collect/Fetch objective from &catalog::Def, no stored value/World. Explicit
  count/mask and typed credited/supply facts. Capped count advancement returns None, not zero-row insertion;
  tour events retain visit-then-progress writes including saturated/repeated-region behavior. Readiness is
  carrier for Fetch, stored count otherwise; supply feasibility includes every standing human and repaired mask.
- rewards.rs: Plan {gv, stat, stacks} lowers existing rules::reward_stats; apply retains capped quest GV,
  training suppression, real grant_mob_stat and gained-only farm notice. No card grant/deferred payout.
- live.rs: lifecycle shell remains; acceptance/refusals, pickup/container effects, giver retirement,
  reveal/deadline/linger, tie rank, expiry/run-end and schedule/hook order stay in place. Any standing human
  (including unaccepted) prevents premature supply expiry; no standing human does not expire. Completion
  retires/marks once then pays GV, farm notice, owner completion, room completion.

## Private continuation evidence

Private archive (never committed): /Users/nevinmckinnon/.codex/tools/roguehalla-backend-20261109/
quest-stage1-compare/. Authoritative repaired harness hashes:
- lifecycle_tests.repaired.rs: 9c39d447508cee5b042b8d07d0dd02c3081d669e89fc734f1526e6bd0e19d95e
- tour_supply_source_tests.repaired.rs: 693f3c9e738967af95f3a35351494f7e34399f8b7d1ad47a5416a23d079054f9
- apply_harness.py verifies source/copy hashes; old one-step generators are explicitly historical/stale.

Mechanically identical baseline/candidate harnesses used identical source scripts/inputs. Results:
- Ten-case lifecycle: 10 cases / 37 main captured frames. Two later reset_active helper snapshots genuinely
  refuse restore as typed errors (retained honestly). At the selected initial boundary all 10 actual original,
  actual Clone and accepted-restored branches continue through 27 remaining frames and compare complete
  checkpoints, ordered events and prepared human QuestViews exactly.
- Two normal-constructor tour cases: 2 cases / 8 remaining frames. Both initial checkpoints restore accepted.
  Actual original, actual Clone and restored branches continue all remaining source actions; two pre-recheck
  records retain nonempty producer queues through the next ordinary step in every branch (never cleared).
- Baseline and Stage1 candidate main and continuation outputs are byte-identical. No production rule,
  expectation or admission was relaxed for equality. Full checkpoints/transcripts remain outside Git; this
  public evidence records counts/harness hashes only, not checkpoint/state/transcript content.

## Canonical final gates (private target, jobs1, locked/offline)

- cargo test -p rh-sim --all-features --lib quests:: -- --test-threads=1:
  34 passed, 1 ignored, 0 failed. Includes catalog/rewards/rosters/placements/wording, ten lifecycle cases,
  eight giver cases, fourteen public action cases, selected notice cases0/4, privacy, carrier/turn-in/expiry/
  run-end, Stage0 tour cases and the existing giver allocation guard (ignored by design).
- cargo test -p rh-sim --all-features --lib quest_view:: -- --test-threads=1:
  26 passed, 0 failed.
- cargo test -p rh-sim --test checkpoint --test replay --test content:
  6 + 6 + 21 passed, 0 failed.
- cargo test -p rh-parity --test schedule: 14 passed, 0 failed.
- cargo test -p rh-sim --test hash_coverage: 10 passed, 0 failed in 776.88s, exit0 (one owned background
  process, append-distinct log/exit; prior tool-window timeout raw preserved distinctly, no duplicate sweep).
- cargo clippy -p rh-sim --all-targets --all-features -- -D warnings: exit0.
- cargo fmt -p rh-sim -- --check: exit0, empty output.

Receipts are force-tracked under this evidence directory; absent logs are listed below.

## Preserved failures / limits

- Stage1 first compile/module-registration/deref failures: stage1-first-compile-failure.log and
  stage1-second-compile-failure.log.
- First strict-clippy and fmt failures: stage1-clippy-firstfailure-raw.log / stage1-fmt-firstfailure-raw.log.
- Prior incomplete hash/integration tool-window timeout logs: stage1-hash-coverage-prior-timeout-raw.log and
  stage1-integration-prior-timeout-raw.log; these are timeout receipts, not final-code failures.
- The private repaired continuation harness's own first compile failure (type inference for an unused map)
  was overwritten before preservation and is documented as unrecoverable, not reconstructed.
- No new card design/implementation, payout, persistence/endpoint, protocol/client/Unity, all-map/workspace
  admission or broad source equality claim. Stage2/card probes are cancelled for this session.

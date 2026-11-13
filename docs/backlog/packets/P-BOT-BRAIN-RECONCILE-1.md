# P-BOT-BRAIN-RECONCILE-1: one bot Brain from two sessions' work

- **Serves:** owner beta-follow-up decision 7 (2026-11-10: the ported Brain on live and headless seats); owner decision
  2026-11-12 evening (MIGRATION: the cloud session's Brain is kept and reconciled with this session's)
- **Implementer tier:** implementer-opus (cross-crate: rh-policy, rh-server, rh-headless; bot fairness)
- **Reviewer:** reviewer-opus (the whole Brain, not only the merge)
- **Integration base:** local `feature/unity-rework`; the result must contain `origin/feature/unity-rework` @ 5e7bc410
  so the integration branch can be pushed again without rewriting history
- **D-rules touched:** D1 loose proof · D9 bots act only through validate + submit · C-INPUT, C-OBS, R-ML-3/4

## 1. ID and outcome
Two sessions built the same thing in parallel from the same brief:
- **Cloud** (`origin/feature/unity-rework` @ 5e7bc410, commits 567c105d stub, 807c898a oracle, e3e1334e implementation;
  hand-off `docs/coordination/HANDOFF_P-BOT-BRAIN-LIVE-1_2026-11-12.md`): the whole packet end to end: its own
  `compose14.rs` (+ `compose14/tests.rs`), `room_paths.rs`, `brain_bot.rs` (+ tests), `Policy::finish`/`Seat::finish`,
  the shared `emit_command`, `rh-server --bot-brain off|full` with HumanBot fallback, budget, replay name and learning
  hand-off, `rh-headless` `BotKind::Brain` and `tests/brain_bots.rs`. Full gate in its container (no Postgres, no C#),
  no independent review. Measured: seats are passive (10 to 259 proposals per seat over 6,000 ticks).
- **Here** (merged locally): piece 1, the composer (`compose14.rs`, oracle `compose14_tests.rs` 16 tests, review tests
  `compose14_review_tests.rs` 4 tests), reviewed by reviewer-opus with three fairness fixes applied (windup events
  composed; zombies are their own kind with an unknown name and a non-mob death lane; body-empty and the chest panel
  need line of sight; hit weapon unknown). And piece 2a (`agent/opus/P-BOT-BRAIN-LIVE-2a` @ 6b4bd8ac, gate-green, not yet
  reviewed; oracle `brain_input_tests.rs` 11 tests): the Brain's readers take every unknown leaf down legacy's own
  undefined branch, `extras.wish` from the public catalog, `me_attack_held`, `Composed14.covered`, the pinned delays
  (world 100 ms, self 0), `Setup14::public`.

When this lands there is one composer and one Brain: the cloud line's end-to-end wiring, with a composer that passes
both sessions' tests. `--bot-brain` stays `off` by default, so live behaviour does not change.

## 2. Dependencies
none

## 5. Exclusive write scope
- `crates/rh-policy/src/bots/**`, `crates/rh-policy/src/lib.rs`, `crates/rh-headless/src/lib.rs`,
  `crates/rh-headless/tests/brain_bots.rs`, `crates/rh-server/src/{main.rs,bot_fill.rs,bot_fill_tests.rs,room.rs,
  director.rs,bot_learning.rs,bot_learning/tests.rs}` (only what the merge and the reconciliation need),
  `docs/DEVIATIONS.md` (the degraded-profile row, renumbered DEV-026, kept unsigned)
- Test files of either session are edited only where this brief says so (section 6) or where two tests contradict
  each other: then stop and report both, do not pick.

## 6. Decisions already made (coordinator; the owner confirms the two marked *)
1. One file `brain/compose14.rs`. Start from whichever composer is the smaller change to reach "all tests of both
   sessions green"; say which and why. The fairness behaviours the Opus review required must hold in the result:
   windup events for a drawn attacker; zombie kind with an unknown name; line of sight for body-empty and for the
   chest panel; hit and signature-hit weapon unknown; a refused or stale frame leaves the ring untouched.
2. From 2a, kept: the readers' undefined branches (cite of legacy lines in 2a's hand-off), `extras.wish`,
   `me_attack_held` and `is_engaged`, `Composed14.covered` (BrainBot skips the Brain tick while not covered), the
   pinned delays, `Setup14::public` (BrainBot builds its setup with it).
3. From the cloud line, kept: `FairPerceptRing14` fencing if it is stricter than this session's ring; the private
   plan event; `BrainBot`, `room_paths.rs`, `emit_command`, `Policy::finish`, the server flag and fallback, headless
   `BotKind`, the learning hand-off.
4. * `self.mobKills`: the cloud line counts the seat's own accepted `Death` events of regional mobs credited to it,
   because an unknown count makes every farm score NaN. That count is made only from what the seat's frame shows (an
   under-count when a credited death is out of sight), so it is kept, named in DEV-026, and this session's test
   expectation that `self.mobKills` is always unknown is changed to the derived count (the only assertion in
   `compose14_tests.rs` this packet may edit; name the line).
5. * Memory drops mob records whose reference is gone (live seats only; the frozen-corpus paths keep the source rule):
   kept, because references renew every tick and Memory otherwise grows without bound. Named in DEV-026. The
   passivity it causes (mob goals do not survive a tick) is NOT fixed here: it is the next packet (an entitled
   per-session mob continuity key, or goals keyed by camp and position).
6. Zone-themed camp buffs are live (P-CAMP-BUFF-THEMES-1): the Brain's route and hunt still weigh camps by
   `mob_type` (`strategy/build_route.rs:257`). Not fixed here; keep the line in DEV-027.

## 8. Acceptance checks
- `git merge-base --is-ancestor origin/feature/unity-rework HEAD` on the result (the cloud commits are in history).
- `cargo test -p rh-policy` green: this session's 16 + 4 + 11 composer and input tests, the cloud's composer and
  `brain_bot` tests, the `parity/policy` corpora.
- `cargo test -p rh-server` and `cargo test -p rh-headless` green; `cargo test --release -p rh-headless --test
  brain_bots` run once and its numbers reported (no fault, proposals accepted, equal hashes per seed, replays verify).
- A hidden-state guard still passes for the reconciled composer (two worlds that differ only in facts the seat cannot
  see compose identical percepts), and one new test that `BrainBot`'s setup is `Setup14::public`.
- clippy `-D warnings` on rh-policy, rh-server, rh-headless; `cargo fmt --all -- --check`;
  `scripts/gate.sh --quick` (no `--oracle`: the oracles are the test files above).

## 10. Risk and suggested model tier
Opus. The two composers differ in structure; a line-by-line merge is the wrong tool. The risk is a reconciled file
that passes both test sets while quietly dropping a fairness fix: the reviewer re-checks each one by name.

## 11. Known traps
- rh-policy's clippy.toml rejects hash-ordered collections, the wall clock and platform libm.
- The local integration branch also carries `SimConfig::camp_buffs`, observation 27 and policy contract 21: literals
  and pins in the cloud line's tests need them.
- DEV numbering: DEV-025 (drawer count) and DEV-027 (camp buffs) are taken; the cloud row is DEV-026.

## Notes from previous attempts

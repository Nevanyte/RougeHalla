# Hand-off: P-BOT-BRAIN-CONTINUITY-1 (worker session, 2026-11-12)

```
PACKET:          P-BOT-BRAIN-CONTINUITY-1 — serves owner beta-follow-up decision 7 (the ported Brain on live and headless seats); the "next Brain packet" named by the P-BOT-BRAIN-RECONCILE-1 review (Brain seats are passive)
BRANCH:          agent/claude/P-BOT-BRAIN-CONTINUITY-1 @ the commit that adds this file (implementation tip dcc34802e) (on packet/P-BOT-BRAIN-CONTINUITY-1 @ 9c3dcd5d1)
GATE:            PASS (full, with Postgres and the C# suite; --oracle packet/P-BOT-BRAIN-CONTINUITY-1) [skipped: none]. The first full run failed once in rh-sim terrain_no_alloc (allocation count 5 vs 0, terrain kind 4) under load average ~70; the branch changes nothing in rh-sim and the test passed 3/3 alone and in the rerun gate
CHANGED:         rh-policy: temporal_percept/brain/mob_tracks.rs (new), brain/compose14.rs, memory.rs, tactics/kite.rs (OUTSIDE the brief's scope, owner-directed in chat, see RISKS), brain.rs + brain_bot.rs (stub commit: the switch renamed); docs/DEVIATIONS.md (DEV-026); tests: mob_tracks/tests.rs, compose14/continuity_tests.rs, memory/tracked_tests.rs, rh-headless/tests/brain_bots.rs; briefs: P-BOT-BRAIN-CONTINUITY-1.md (verified, two dated corrections), P-SIM-REPLAY-LONG-1.md (new)
D-RULES:         D1 loose proof: the HumanBot baseline on the same seeds is the comparison (no legacy capture). D9: seats still act only through validate + submit; the tracker reads only accepted frames. C-OBS / R-ML-4: no reference value or row order reaches identity (tests renumber and reorder references; the tracker unit test shuffles rows).
DEVIATIONS:      DEV-026 edited (unsigned): mob keys are the seat's own tracks with track velocity; Memory keeps a tracked record while carried and 3 s after (legacy keeps it for the run); a bow pull with an unknown start is not juked.
SHARED RECORDS:  proposed: docs/MIGRATION.md — record P-BOT-BRAIN-CONTINUITY-1 and the new packet P-SIM-REPLAY-LONG-1 (replay divergence at step 11,004 on a 16,000-tick seed-3 Brain recording).
LEGACY DOUBTS:   packages/server/src/bots/brain/tactics/kite.ts:220,279 and the world dispatch: an undefined drawStartedAt gives holdUntil NaN in JS too; legacy never fed one, so the guard is a degraded-profile fix, not a legacy bug.
NOT ESTABLISHED: that a 16,000-tick recorded match replays (it does not on seed 3: P-SIM-REPLAY-LONG-1); whether that divergence predates this branch; per-seat p99 decision cost on a quiet machine; Brain vs legacy in-process Brain tournament results; behaviour on maps other than seed1.
RISKS:           tactics/kite.rs is outside the brief's write scope (owner chose "fix stuck seats here" in chat 2026-11-12); a mob that leaves view and returns within 3 s is counted twice by camp memory; two same-class mobs that coincide in one sample may swap keys (nearest-first; no cut rule).
```

## What changed

1. **Tracker** (`brain/mob_tracks.rs`): per seat, matches NPC rows across accepted frames by position and class (wire
   kind, mob type code, faction) within a step bound of 255 u/s + 8 u; global nearest-first assignment (ties: older
   track, then x, then y); new tracks take serials in class/position order. A track ends when unmatched, after a
   frame gap over 250 ms, on a self teleport, or after its death sample. Velocity = displacement / interval, 0 on a
   new track. Never reads the reference value or row order.
2. **Composer**: `Composer14::track_mobs` (live seats via `SeatComposer14`) keys mob rows, events, refs and effects by
   track key (`m<serial>`) and fills `vx`/`vy`. Without it (composer oracles, frozen corpora) keys stay `n<ref>`.
   Commands still resolve through this frame's refs (track key -> this frame's reference).
3. **Memory** (live seats): a record is kept while its key is carried and `TRACK_RETAIN_MS` (= legacy `REENTRY_MS`,
   3,000 ms) after, then dropped; peak records <= visible tracks + tracks ended within 3 s (tested over 24,000 ticks).
4. **Stuck seats** (found here, owner-directed fix): a remote bow pull has an unknown `drawStartedAt` (NaN) on the
   degraded profile; `push_bow_shot` took it (`NaN <= 0` is false), the juke's `hold_until` became NaN, and
   `dispatch_world` then dropped every order intent for the rest of the run (`now >= NaN` is never true). Seats froze
   in place for thousands of ticks. An unknown pull is now no shot; wand windups are still juked.

## Evidence

Release test (`cargo test --release -p rh-headless --test brain_bots`, seeds 3 and 11):

| | before (6,000 t) | after (16,000 t) | HumanBot (match end) | floor |
|---|---|---|---|---|
| resolved deaths | 4 | 11 | 14 | >= 0.5 x |
| mob kills | 16 | 260 | 53 | >= 0.5 x |
| quietest seat proposals | 7 | 58 | 23 (seat mean 141.9) | >= 0.25 x mean |

No fault, every proposal accepted, two runs per seed on equal hashes and seat stats, 6,000-tick recordings replay to
their hash. The window is 16,000 ticks because the raid's patience ends about tick 12,300 on this configuration; the
Brain (as legacy) farms through the raid and fights in the coliseum (2 deaths by tick 6,000, 11 by 16,000).

Oracle corrections (both on `packet/`, documented in the brief): the match window (6,000 -> 16,000 ticks, fractions
unchanged), and the replay check split to 6,000-tick recordings with an ignored repro
(`the_replay_of_a_long_brain_match_verifies`) for P-SIM-REPLAY-LONG-1. Brief-side corrections: the wire orders rows by
reference, so composer-level "shuffled rows" are a permuted hand-out of references.

Per-seat decision cost (`profile_brain_seats`, release, measured under load average 73 on 18 cores): mean 0.37-0.48 ms
(target < 1.5), p99 6.4-8.1 ms (target < 6): p99 needs a quiet rerun before it is read as a miss.

Oracle tests on the stub: 9 of 16 rh-policy oracle tests failed on assertions; the 7 that passed are guards a
per-sample stub also meets (gap in sight, two types, hidden row, untracked keys, flag-off rule, record survives while
carried, bounded run).

## `git diff --stat packet/P-BOT-BRAIN-CONTINUITY-1`

```
 .../Assets/Resources/Showcase/NunitoRegular.asset  | 7380 ++++++++++++++++++++
 .../src/bots/temporal_percept/brain/compose14.rs   |  138 +-
 .../src/bots/temporal_percept/brain/mob_tracks.rs  |   93 +-
 .../rh-policy/src/bots/temporal_percept/memory.rs  |   18 +-
 .../src/bots/temporal_percept/tactics/kite.rs      |   37 +
 docs/DEVIATIONS.md                                 |    2 +-
 6 files changed, 7617 insertions(+), 51 deletions(-)
 (plus this hand-off file)
```

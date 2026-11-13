# P-BOT-BRAIN-CONTINUITY-1: a Brain seat keeps track of a mob from one frame to the next, so its mob goals last

- **Serves:** owner beta-follow-up decision 7 (MIGRATION, 2026-11-10: the ported Brain on live and headless seats);
  the "next Brain packet" named by the reviewer of P-BOT-BRAIN-RECONCILE-1 (2026-11-12): Brain seats are passive
- **Implementer tier:** implementer-opus (rh-policy bots; bot fairness)
- **Reviewer:** reviewer-opus
- **Integration base:** feature/unity-rework
- **D-rules touched:** D1 loose proof · D9 bots act only through validate + submit · C-OBS, R-ML-4 (no hidden identity)

## 1. ID and outcome
The reconciled Brain (`rh-server --bot-brain full`, `rh-headless` `BotKind::Brain`) is passive: in the release test
`crates/rh-headless/tests/brain_bots.rs` eight Brain seats make 7 to 241 proposals each over 6,000 ticks and the match
sees two deaths. Cause: a mob has no identity a seat can hold on to. The sim gives each viewer a fresh block of NPC
references whenever the set of visible NPCs changes or the tick differs (`crates/rh-sim/src/actor_refs.rs:200-236`,
retired after a grace of ticks `:277-289`); players keep their roster id (`:180-183`, `:253`). The composer therefore
keys a mob by its per-sample reference (`brain/compose14.rs:1515-1526`; header `:31`: "NPC references are per-sample
(no cross-frame join)"), gives every mob velocity 0, and the live Brain drops a mob record as soon as its key is gone
(`Brain::use_sample_scoped_mob_ids`, `temporal_percept/brain.rs:411`, set in `brain_bot.rs:221`; `memory.rs:1199-1201`).
Legacy keys a mob by the server's fighter id for the whole run (`packages/server/src/bots/brain/memory.ts:561-605`),
so its hunt, farm and kite goals persist; here they are forgotten every tick.

When this lands, a Brain seat follows each mob it can see from frame to frame by what a player's eyes use: where it
is, what it is and how far it could have moved. The seat gives the mob a key of its own that stays the same for as
long as the mob stays in the seat's view, mob velocity is taken from that track (as legacy has it), and Memory keeps
the record for as long as the track lives. Nothing new is asked of the server or the wire: the track is built only
from the seat's accepted frames. Brain seats then farm and fight: the release test's floors rise (section 8).

## 2. Dependencies
- P-BOT-BRAIN-RECONCILE-1 merged (it is in the base).

## 3. Relevant legacy paths
- `packages/server/src/bots/brain/memory.ts:561-605`: mob memory keyed by fighter id; a vanished minimap dot marks
  the mob dead (`:585`).
- `packages/server/src/bots/brain/frames.ts:280-287`: velocity from the earlier sample; zero on a cut or a jump past
  `TELEPORT_DISTANCE` (the same cut rule applies to a track).
- `packages/shared/src/mobs.ts:247` (leash `min(territory radius, 24 tiles)`) and mob speeds in the mob catalog: the
  bound on how far a mob can move between two samples.

## 4. New paths
- `crates/rh-policy/src/bots/temporal_percept/brain/mob_tracks.rs` (the tracker) and its tests

## 5. Exclusive write scope
- `crates/rh-policy/src/bots/temporal_percept/brain/{mob_tracks.rs,compose14.rs}` (keys and velocity of mob rows; the
  ring keeps what the tracker needs), `crates/rh-policy/src/bots/temporal_percept/{brain.rs,memory.rs}` (the
  sample-scoped switch and what replaces it on live seats), `crates/rh-policy/src/bots/brain_bot.rs`
- `crates/rh-headless/tests/brain_bots.rs` (raise the floors; non-oracle parts only), `docs/DEVIATIONS.md` (DEV-026:
  one sentence)
- Not `crates/rh-sim/`, `crates/rh-protocol/`, `crates/rh-server/`: no stable NPC reference is added to the sim or
  the wire in this packet.

## 6. Contracts and references
- C-OBS and R-ML-4: "no leaks through ids, ordering, counts, masks, events or RNG". The tracker reads only the mob
  rows of the seat's accepted frames (position, kind, mob type code, signature, health); it must not use the
  per-sample reference's numeric value or the rows' order as a hint of identity across frames (the sim renews both).
- The owner-approved degraded fair profile (DEV-026): a fact the seat cannot see stays unknown.
- rh-policy `clippy.toml`: no hash-ordered collections, wall clock or platform libm; ordered iteration.

## 7. Behaviour to preserve
- Every test of P-BOT-BRAIN-RECONCILE-1 (composer, input side, BrainBot, the hidden-state and map twins), the
  `parity/policy` corpora (the frozen-corpus paths keep legacy's keying: the tracker runs on live seats only), and
  `--bot-brain off` byte-identical.
- Determinism: same seed and frames, same tracks and commands (two runs, equal hashes; replays verify).
- Player rows, events and everything else in the percept are untouched.

## 8. Acceptance checks
- Unit (`mob_tracks`): a mob that moves less than its step bound keeps its key across frames; two different mob
  types never share a track; two same-type mobs that cross are either kept apart by the nearest-assignment rule or
  both tracks are cut (state which, and test it); a mob that leaves view and returns later gets a new key (no
  identity is claimed across a gap); a death event ends its track; the assignment does not depend on row order (the
  same frame with rows shuffled gives the same tracks); velocity equals displacement over the sample interval and is
  zero on a new track.
- Fairness: two worlds that differ only in what the seat cannot see give identical tracks; shuffling or renumbering
  the per-sample NPC references between frames changes nothing.
- Memory: a tracked mob's record survives across ticks on a live seat; Memory stays bounded (records of ended
  tracks are dropped after the retention legacy uses for a dead mob; state the bound and test it over a long run).
- Release match (`cargo test --release -p rh-headless --test brain_bots`): no fault; every proposal accepted; equal
  hashes per seed across two runs; replays verify; and the passivity floors: the oracle author measures today's
  numbers and a HumanBot baseline on the same seeds, then pins floors that mean "plays": proposals per seat, mob
  kills per match and deaths per match each at least a stated fraction of the HumanBot baseline.
- Per-seat decision cost stays inside the P-BOTS-1 target (mean under 1.5 ms, p99 under 6 ms): report it.
- `scripts/gate.sh --oracle packet/P-BOT-BRAIN-CONTINUITY-1` passes (full).

## Oracle files (read-only for implementers)
- `crates/rh-policy/src/bots/temporal_percept/brain/mob_tracks/tests.rs` (8 tests: step bound, classes, crossing,
  tight camp, gap in sight, death, row order, velocity)
- `crates/rh-policy/src/bots/temporal_percept/brain/compose14/continuity_tests.rs` (4 tests: keys survive renewed
  references with velocity; renumbered and reordered references compose identical percepts; a hidden row changes no
  track (guard, passes on the stub); an untracked composer keeps reference keys (guard))
- `crates/rh-policy/src/bots/temporal_percept/memory/tracked_tests.rs` (4 tests: a record lives while its key is
  carried (guard); dropped `TRACK_RETAIN_MS` after; bounded over 24,000 ticks (guard); flag off keeps the source rule)
- `crates/rh-headless/tests/brain_bots.rs` (release: HumanBot baseline on the same seeds and the floors)

Verified against the code (oracle author, 2026-11-12): every path and line in section 1 holds at 038f83c8. Decisions
the oracle pins:
- Crossing rule: kept apart by global nearest-first assignment (ties: the older track, then the row's x, then y); no
  cut. Step bound 255 u/s (PLAYER_SPEED 170 x skirmisher 1.15 x G10 cap 1.3) + 8 u slack; a sample more than 250 ms
  after the previous one, or a self teleport, ends every track.
- Wire rows are in ascending reference order, so "rows shuffled" at the composer level is a permuted hand-out of
  references; the tracker's own unit test shuffles rows freely.
- Memory bound: legacy never drops a mob record (its key never changes); a track key never recurs, so on live seats a
  record is kept while carried and `TRACK_RETAIN_MS` = legacy `REENTRY_MS` (3,000 ms) after, then dropped. Peak
  records <= visible tracks + tracks ended in the last 3 s.
- Release floors, measured first (seeds 3 and 11, 6,000 ticks, 2026-11-12): Brain 4 resolved deaths, 16 mob kills,
  1,773 proposals, quietest seat 7; HumanBot 13 deaths, 52 kills, 2,175 proposals (136 a seat), quietest 23 (its
  seed 3 ends at tick 3,209). Floors over both seeds: Brain deaths >= 0.5 x HumanBot's, mob kills >= 0.5 x, and the
  quietest Brain seat >= 0.25 x the mean HumanBot seat's proposals. Correction (same day, after implementing): the
  matches run 16,000 ticks, not 6,000. The raid's patience ends about tick 12,300 on this configuration; the Brain,
  like legacy, farms through the raid and fights in the coliseum (with the tracker: 2 player deaths by tick 6,000,
  11 by tick 16,000; HumanBot's matches end at ticks 3,209 and 6,961 with 13). The fractions are unchanged. Per-seat decision cost is reported (the ignored
  `profile_brain_seats` diagnostic), not gated: wall-clock floors are not stable on shared CI cores.

## 9. Validation commands
- `cargo test -p rh-policy`; `cargo test --release -p rh-headless --test brain_bots`;
  `cargo clippy -p rh-policy -p rh-headless --all-targets --all-features -- -D warnings`; `scripts/gate.sh --quick`

## 10. Risk and suggested model tier
Opus. The tempting shortcut is to use the reference number or row order as identity when they happen to be stable:
that is exactly the leak R-ML-4 forbids, and it would pass every test until the sim renews a block mid-fight.

## 11. Known traps
- A reference block is renewed when the visible NPC set changes, not every tick: tests must renew it deliberately.
- Camps hold several mobs of one type close together: assignment must be global (nearest first over all pairs, ties
  by a stated order), not greedy per row.
- A Brain goal names a mob by key: when a track is cut the goal must fall back as legacy does for a vanished mob,
  not fault the seat.
- Zone-themed camp buffs are live: the Brain still weighs camps by mob type (`strategy/build_route.rs:257`,
  DEV-027). Not this packet.

## Notes from previous attempts

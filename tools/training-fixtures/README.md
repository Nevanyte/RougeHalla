# Training-room source witness (P-ARENA-2)

Canonical actual-source capture for the training room: the practice setup (two dummies and the weapon rack) and the
training/arena controls, a long training run, the dummies' refill/reset and the shield answers (sword riposte and
reflected arrow) with the training revive, a between-tick down, and the practice console (card, stat, camp, chest, clear)
including its caps, 300 ms gaps, refusals, toasts and the arena door. Every expected value is written by the unmodified
source; the harness only applies the declared steps and reads state/events.

The corpus is `parity/training/source.json`; the native comparison is
`crates/rh-sim/src/systems/training/corpus_tests.rs`. The capture runs in the pinned
`node:22.23.4-bookworm-slim@sha256:aaa4b5baf1ecff3b283486bb1f90405cdda225a3e6f79660d2c559fa510a7292` linux/amd64 image (the
same immutable image as the other fixture tools):

```
bash tools/training-fixtures/capture.sh            # capture to parity/training
bash tools/training-fixtures/capture.sh --check    # compare the checked-in corpus byte for byte
```

`RH_TRAINING_OUTPUT` points the capture at another directory. The recorder asserts the exact Node version, platform and
architecture, replays the whole scenario twice and requires byte-identical output, and hashes the complete
`packages/server/src/sim` + `packages/shared/src` TypeScript closure into the corpus provenance. This Docker release
cannot create the tool's tmpfs mountpoint over a read-only repo bind, so the container mounts the repo writable: `npm ci`
only writes the ignored `node_modules` (the source tree is never touched).

## Profile and harness boundary

- One declared 24x24 map (the same `declared-map-input.json` bytes the mob-runtime tool uses) with its spawn list replaced
  by the one declared spawn `(80,112)`; the lobby closes on the first step (`minPlayers 1`, `lobbySeconds 0`) exactly
  like the native `reset_active` bootstrap, so the world is the active practice world from tick 1 with the seat at the
  declared placement.
- `createGameWorld`'s module set with `signatures: false` and `walkHints: false` (the native training plan's
  faction-neutral profile), plus `installTraining` for the training cases. Seed 1, the world random stream seeded 12 (the
  corpus records the drawn order salt), reward salt `[1,2,3,4]`, quest salt `[5,6,7,8]`.
- The harness adds no gameplay: it sends the declared console/attack messages, applies forced ledger hits and the
  between-tick down the way the legacy tests do, and projects the source state/events. A forced ledger hit is a state
  witness only (the source fx of an out-of-band ledger entry is not compared); every ordinary attack's event list is
  compared exactly.

## Cases in the corpus

| case | what it witnesses |
| --- | --- |
| `training_setup` | active from tick 1, training flag, two dummies at 3 tiles facing the spawn, the five-weapon rack, full hp |
| `arena_control` | the same map/seat as an arena run: no training flag, no dummies, no rack |
| `long_training_run` | 400 ticks of a training run: still active, seat untouched, no result/GV/death event |
| `dummy_lethal_refill_then_reset` | a lethal forced hit refills the plain dummy to full, a 100 hit leaves max-100, and 3 s later the dummy reset heals it |
| `between_tick_down_revived` | a down outside a tick is stood up at full health by the next step (the resolved event is the only witness) |
| `shield_riposte_revive` | a sword riposte blocks, reflects onto the shooter (killed with no player by), and the training settle revives them in the same tick |
| `shield_reflected_arrow_revive` | the same for a reflected arrow (the arrow still wounds the shield dummy before reflecting) |
| `console_card` | a live interactive unique card is set once and removed, with the source's toasts |
| `console_stat` | a normal type's stacks are set and the cumulative text is the source's (a 0 count is refused at the door) |
| `console_camp_gap_and_new_ref` | a camp of three, the 300 ms gap refusal, then the next camp ref |
| `console_camp_alive_cap` | four camps fill the 12-alive cap and the next is refused with the source's toast |
| `console_camp_spawned_cap` | fifty camp/clear cycles spend the 150-spawn budget and the next camp is refused |
| `console_chest_chosen_and_roll` | a chosen live card chest, the gap refusal, then the normal augment-pool roll and its names |
| `console_chest_cap` | six chests fill the cap and the seventh is refused |
| `console_clear` | a clear removes cards/stats/mobs/chests with the source's toast (the rack and dummies stay) |
| `door_and_catalog_bounds` | unknown ids refused, card count clamped, the 10^9 stat stack and its grouped toast, duplicate/over-long/unknown chest options refused |
| `arena_door_refuses_train` | a train message is refused whole in an arena world |

Not captured: `DUMMIES=1` without `training` (the arena-with-dummies config) is not in this line's compiled gate plan
matrix (the dummies gate only comes with the training world); the console's internal stat removal (a 0 count) is
unreachable from the wire in the source and only the door refusal is witnessed.

Recapture only with the pinned container: the corpus is immutable source output, never regenerated from Rust.

## Mutants

%tools/training-fixtures/run-mutants.sh% applies every committed patch in %tools/training-fixtures/mutants/%, requires a
semantic failure of the native training suite (the corpus test and the training room's own tests), restores the tree, and
then requires the unchanged control to pass. The committed set:

| mutant | what it breaks |
| --- | --- |
| %01-dummy-refill-to-zero% | a lethal dummy hit clamps at 0 instead of refilling |
| %02-dummy-reset-clock-decades% | the dummy reset clock runs decennia long |
| %03-practice-camp-ref-minus-one% | a practice mob stores %ref - 1% as its camp |
| %04-chest-occupancy-dropped% | reward chests stop occupying their tile for the next drop |
| %05-stat-toast-ungrouped% | the console's number rendering loses thousands grouping |
| %06-camp-gap-tenfold% | the 300 ms console gap is scaled to 3 s |
| %07-stat-zero-door-accepted% | the door accepts a 0 stat count |
| %08-death-by-mob% | a mob-caused death names the mob as the killer |

%bash tools/training-fixtures/run-mutants.sh% reports %8/8 mutants killed; unchanged control passes%.

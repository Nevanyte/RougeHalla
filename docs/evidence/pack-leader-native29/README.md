# Pack Leader native29 — fixed camps outgoing/execute context

Base: exact private union `2f1c4758e0db84515551f483c6df0d23879f4a99`, with the released source seal
`fb650ec1e390043252256a03df2ec522fc58ac6f` merged in (only `tools/`, `parity/pack-leader/`, `docs/evidence/` added; no
unexpected production delta). Code head: `16e4951f0f0196a45ad44acf8de2619c653b4bf9`.

## Implementation (leased files only)

- `modifiers::outgoing_damage` takes an explicit `camps_cleared: u16`; `ScaleSrc::CampsCleared` is
  `per * floor(count / step + 1e-9)` with the existing row cap, G1 ceiling and farm-outside-cap unchanged.
- `modifiers::execute_share` takes the same explicit count and passes that **same value** to both the full and the
  without-hpBelow queries.
- `TickScratch::camps_at_pass_start: Vec<u16>` is transient pass scratch: `reserve_actors(count)` prepares its capacity
  (supports the >8 private bench), `apply_inner` clears+extends the actual players ONCE at pass start before any
  victim/payout (debug-asserting prepared capacity), reads it only by stable player slot (NPC/departed -> 0 via checked
  access, no new panic), clears it at the pass end and on the empty-ledger early exit, and `is_settled` includes its
  emptiness. No serialized/persistent cache, no hot reserve/resize/clamp/pool, no constant/content/lock/status edits.
- The `Pass` carries that slice; outgoing and apply_victim's execute queries read the same pass-start value, preserving
  ledger/settle ordering.

## Proof

- **Genuine source tape replay** (`pack_leader_native_tests`, immutable `parity/pack-leader/repair/source.json`): the 384
  real ordinary steps reproduce `CampCleared` at tick 169 / 8450 ms, camp deaths at ticks 37/146/169, canonical count
  clean at 0 before the clear pass and 1 after, cleared roster (state 2, alive 0), and the later ordinary p0->p1 wand hit
  at tick 321 / 16050 ms with amount **625.7285233040177** — from the real attack, not installed. Declared setup only
  (map/seed/cards/bulk stats/bootstrap); no HP/death/clear/outgoing/cache/event/RNG installed. Clone and real restore
  continue identically (events + state hash + count) after the tape.
- **Helper parity** (`modifiers::camps_tests`, immutable `helpers.json`): declared counts 0/1/7/8/9/20 -> 1/1.03/1.21/1.24/
  1.24/1.24, G1/baked hit -> 0.8333333..., execute share count0 -> 0.23076923076923084 and count1 ->
  0.22556390977443608, cache-refresh timing stale 1.0 / refreshed 1.03; farm is added outside the row cap. These are
  declared-helper contexts, not earned parity.
- **Pass-snapshot control** (`systems::ledger::camps_tests`): one pass really clears camp 0 (last members die, deferred
  real payout) while later player damage in the same pass uses the old count and the next ordinary pass uses the new one;
  plus per-attacker count scaling, snapshot cleared after pass and after the empty-ledger early exit, and the >8 actor
  prepared-capacity check.

## Gates (logs under logs/)

- focused `camps_tests`: 7 passed; tape: 1 passed; `camp_heal`: 3 passed; `mark_tax`: 14 passed / 1 ignored;
  `training_actor_scratch`: 1 passed; `cargo fmt -p rh-sim -- --check` exit 0; scoped `cargo clippy -p rh-sim
  --all-targets -- -D warnings` and `--all-features` exit 0.
- Mutants (compiled in place on the leased files, restored byte-identically, logs under mutants/):
  `01-count-ignored`, `02-execute-count-missing`, `03-farm-inside-cap`, `04-snapshot-missing` all **MUTANT-KILLED**
  (focused test failure), none a compiler/setup failure; restored re-run green.

## Limits

- `tests/no_alloc` warm-allocation integration gate was **NOT RUN** in this pass (scoped time); existing
  `training_actor_scratch` warm/growth/restore/clone gate passed and the new snapshot path performs no hot allocation by
  construction (prepared capacity, fixed 2 B per prepared actor). The known separate non-training WindEmblem 384 B
  after-clone red was not touched or concealed.
- The tape projection compares the claimed count/clear/death-order/later-damage/relevant-event facts, not whole-world
  equality; the declared native bootstrap (born/holy transformed map, seed/reward salt, full abilities/factions/mobs/
  quests/consumables/PvP config, declared cards/bulk stats) is setup only.
- Root owns hash/content/derived-tape/publication/main merge; no Content/header/lock/status/protocol/server/C#/Unity edits
  and no capture campaign were performed.

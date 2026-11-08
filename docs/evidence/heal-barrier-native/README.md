# P-G6-HEAL-BARRIER-NATIVE — private candidate evidence

Status: **implemented on the isolated candidate branch**, publication/activation held by the lead. Base
`origin/optimization_port` @ `febf1f3ffd5d421ac87855d2dd4938f4bc91b872`; branch `deepseek/p-g6-heal-barrier` (head in the
coordination report). No protocol/server/client/policy production change, no observation/policy/wire version, no live
activation, no merge.

## Identity

- Content identity **`356457e6ccfb22cd`** (the two registered G6 guards `BARRIER_MAX_SHARE = 0.25`,
  `BARRIER_DECAY_SHARE_PER_SECOND = 0.05` moved the registry; the old `801a76cde4cfd305` is not accepted by this build).
- Checkpoint **`rh-checkpoint/25`** and replay **`rh-replay/19`** (reserved by the packet). A checkpoint/replay carrying
  the old 24/18 tags is refused by tag, even though the two new player fields are `#[serde(default)]`.
- Observation 17 / policy 13 / protocol 11 unchanged; no public/native Observation or PublicSnapshot carries the private
  timer.

## Mechanics

- `systems/heal.rs`: after anti-heal/heal-taken scaling and before the hp clamp (overheal and lifesteal included), a
  standing player's folded `StatView.heal_barrier` grants `share * amount`; mobs and `QuietRegen` (source `noBarrier`) are
  excluded; refused/zero heals grant nothing. The share comes from the normal stat view (`modifiers::view` →
  `StatView.heal_barrier` from the folded `StatKey::HealBarrier`), not from a card id.
- `systems/buffs.rs`: `grant_heal_barrier` adds to the barrier, clamps to 25% of the **then-current** max hp, enables
  decay and extends the deadline to `max(previous, now + 5000 ms)` (lifetime derived from the two registered guards).
  `expire` (the real `buffs.expireBoosts`, at the same systems slot #4) clears on deadline/non-alive/decaying-zero and
  otherwise subtracts 5% of current max hp per second at the fixed 20 Hz step; a timerless barrier is untouched.
- Two private `Player` scalars: `barrier_until: f64` (0 = none) and `barrier_decays: bool`; both `#[serde(default)]`.
- Training `clear` resets the barrier and both fields with the rest of the practice memory.
- No universal barrier ≤ 25% invariant: validation only requires finite nonnegative barrier/deadline and
  `decays ⇒ deadline > 0`; the grant-only cap allows a later max-hp decrease to leave an over-cap barrier standing.

## Proof

- Focused replay `crates/rh-sim/src/systems/buffs/replay_tests.rs` over all 10 pinned source cases: passed.
- `crates/rh-sim/src/systems/buffs.rs` unit tests: grant/add/cap/extension, post-scaling+overheal+lifesteal+regen/refusal
  exclusions, decay/zero-tuple/clear/death/timerless, restore-continuation over the reachable private forms (including the
  over-cap and decay-zero-with-timer tuples), malformed-state refusal, equal public facts/different private timers observe
  equal, and the training clear. 7 `systems::buffs` tests pass.
- Checkpoint/replay native tests: 6 + 6 passed (25/19 strict formats, old-format refusal).
- Hash coverage six tests passed after the documented `VALIDATED` row for `world.players.*.barrier_decays`; the new
  fields are ordinary hashed leaves (no allowlist). `no_alloc` passed (the system allocates nothing; seeded barrier
  stays timerless). `rh-parity` schedule 14 passed (same slot, source order). Content 21 passed with the new identity.
- Pinned corpus: `parity/heal-barrier/runtime.json`, 82,780 B, SHA256 `2ae9c250…`; `capture.sh --check` byte-identical;
  source provenance 127 files digest `e6efe7f3048659701a589433d1690651e8a43d28aa2610bedad744cc3705e1a1`.
- Mutants: **8/8 killed with the unchanged control** (`01-grant-before-scaling`, `02-cap-ignored`, `03-decay-missing`,
  `04-expiry-missing`, `05-regen-grants`, `06-training-reset-missing`, `07-universal-cap-validation`,
  `08-wrong-systems-slot`), run through `tools/heal-barrier-fixtures/run-mutants.sh`.
- Both strict lint feature modes clean: `cargo fmt --all -- --check`;
  `cargo clippy -p rh-sim --all-targets --all-features -- -D warnings`; `cargo clippy -p rh-sim --all-targets -- -D
  warnings`.
- Derived tape: `parity/abilities/hash-tape.json` regenerated with the existing ignored recorder
  (`cargo test -p rh-sim --lib --all-features abilities::source_tests::hash_tape::record_ability_hash_tape --
  --ignored`): checkpoint `rh-checkpoint/25`, contentHash `356457e6ccfb22cd`, observationVersion 17, 58 case folds
  re-recorded (60 insertions/60 deletions in the tape). No source golden was touched.

## Remaining (lead decision)

1. **Publication gate**: Second Skin is already offerable while human protocol 11 does not publish `barrier` (no
   observation 18 / policy 14 / wire field is assigned here). Before admission the lead must pair this candidate with a
   reviewed public barrier transport or an explicit fail-closed profile/offer decision. The candidate intentionally does
   not change card eligibility or invent a flag.
2. **Real-producer same-tick systems-slot witness**: the corpus covers a heal granted between ticks (next-tick decay) and
   the slot position is pinned by the schedule/replay tests, but the attempted real lifesteal-from-afterDamage case
   captured divergence in the combat/lifesteal path (source barrier 17.97 vs 0 before expire) and was dropped rather than
   faked; a real same-tick producer case needs the faction combat parity reviewed. The decay math and slot order are
   unit/replay-covered.
3. **Teleport/training positions**: those corpus cases compare barrier/timer/hp/status/phase; their producer-specific
   positions are excluded (teleport spot math is the arena producer's own surface; the Rust practice map differs from the
   source training map).
4. R6 skill barrier producers (`grantBarrier`/trigger `barrier`) remain intentionally out of scope; no new public fact was
   added.

## Out-of-scope prerequisite (lead/root must apply during composition)

The new `StatView.heal_barrier` field breaks the feature-gated `rh-parity` status-probe bin, which constructs a
`StatView` literal and is outside this packet's writable scope. `cargo test -p rh-parity --test schedule --all-features`
fails with `E0063 missing field heal_barrier in initializer of StatView` at
`crates/rh-parity/src/bin/status_probe/boundary_v3.rs:58`. Any workspace `--all-features` gate needs this one-line fix
before the candidate can be composed:

```rust
// crates/rh-parity/src/bin/status_probe/boundary_v3.rs, in `Modifiers::view` after `heal_taken_mult`:
heal_barrier: f.sums.heal_barrier.max(0.),
```

It matches `modifiers::view` (the folded `StatKey::HealBarrier`, clamped at 0) and is exactly the ready-to-apply patch
`tools/heal-barrier-fixtures/rh-parity-statview-heal-barrier.patch` (`git apply --check` verified in a disposable copy;
the file is deliberately not committed here). The default-feature `rh-parity` schedule test passes 14/14 without it.

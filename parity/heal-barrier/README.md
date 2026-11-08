# `parity/heal-barrier` — pinned actual-source G6 heal-barrier witness

- `runtime.json` — `rh-heal-barrier-source/1`, 10 cases, 82,780 bytes, SHA256
  `2ae9c250cabdbc139a254000034df71efe597e67cea7c247b84ba3e863495495`, captured in the pinned linux/amd64
  `node:22.23.4-bookworm-slim@sha256:aaa4b5baf1ecff3b283486bb1f90405cdda225a3e6f79660d2c559fa510a7292` container by
  `tools/heal-barrier-fixtures/capture.mts` from the unmodified source harness (production module order; generated map
  seed 1 attempt 0, floor random `mulberry32(12)`, reward salt `[1,2,3,4]`). The provenance records the image, Node
  version, the map parameters and SHA256 of every imported `packages/shared/src` + `packages/server/src/sim` source
  file (127 files; digest `e6efe7f3048659701a589433d1690651e8a43d28aa2610bedad744cc3705e1a1`).
- Cases: `grant-overheal-cap` (folded 30% grant, add, grant-only 25% cap, deadline extension), `decay-expiry-zero`
  (5% max hp/s at 20 Hz, the reachable decay-to-zero tuple, the next pass's clear), `lifesteal-barrier` (the heal
  funnel's lifesteal kind also stands as barrier), `no-barrier-heals` (regen/noBarrier, lockout/refusal, zero heal, the
  Vampiric-Pact zero heal), `absorb-immunity-death` (barrier takes damage first, swallowed hits, immunity, a dead
  holder's timer-made barrier cleared), `maxhp-decrease` (a later max-hp decrease leaves the barrier over 25%; the next
  grant clamps to the then-current cap), `timerless-seed` (a barrier without a boost is left alone), `training-reset`
  (the real practice console clear removes barrier + both private fields), `teleport-survival` (a real patience-expiry
  coliseum teleport keeps the timer and decay running; immunity blocks damage) and `run-end-retention` (the ended
  state keeps the barrier and stops decaying).
- Each case records the ordered declared/producer action script (`place`, `weapon`, `setHp`, `setMaxHp`, `setBarrier`,
  `setImmunity`, real `grantCard`, the real factions heal funnel, real `applyDamage`, the real `downPlayer`, the real
  training console command) and per-frame public player facts (faction/position/hp/maxHp/barrier/status/weapon/slot/potion)
  plus the private `boost` timer (`shieldUntil`/`decays`); the source keeps an empty boost object after a clear, which the
  capture normalizes to null because only a set timer is private state.
- Native replay: `crates/rh-sim/src/systems/buffs/replay_tests.rs` regenerates the same map/config/secrets, applies the
  declared setup through the port's real `cards::grant`, `heal::apply`, `ledger::apply_declared_hit`, `settle::down_player`,
  the training `Train` input and the real systems/step path, and compares every captured public fact + private timer.
  The teleport case's post-teleport x/y (the arena producer's own parity surface) is excluded; the timer/barrier/hp facts
  are compared.
- `bash tools/heal-barrier-fixtures/capture.sh --check` re-runs the source capture and requires identical bytes;
  `bash tools/heal-barrier-fixtures/run-mutants.sh` applies the committed mutants (grant order, cap, decay, expiry, regen
  grant, training reset, universal current-max-hp validation, wrong systems slot) and requires a semantic test failure
  plus the unchanged control.

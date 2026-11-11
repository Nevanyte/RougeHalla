# rh-sim: local rules

The game itself, and the highest-stakes crate: a subtle change here desyncs replays, breaks the state hash and fails
parity weeks later. Layout and entry points: [README.md](README.md); design: ADR 0007 (determinism), ADR 0009 (layout).
State, tick-order, RNG and save/hash packets go to `implementer-opus` and `reviewer-opus`.

## Invariants

- Pure: no I/O, wall clock, threads, env vars or entropy. `clippy.toml` enforces the mechanical part (no `HashMap`/
  `HashSet`, `Instant`/`SystemTime`, platform libm, `mul_add`); a sanctioned exception carries its reason beside the
  `#[allow]`.
- Fixed 20 Hz step in legacy order. The tick is the table `schedule::PHASES`: a mechanic flips its rows from
  `Pending("P-…")` to `Ported(fn)` at their legacy position; rows keep their order (`crates/rh-parity/tests/schedule.rs`
  compares against `parity/schedule/legacy_schedule.json`).
- RNG streams are injected and seeded (C-RNG); every draw is behaviour, so adding, removing or reordering one changes
  parity. Secrets and the state hash stay server-private.
- Numbers follow legacy JS: f64, legacy operation order, `crate::math` (libm) for transcendentals (C-NUM). Watch integer
  overflow against JS number semantics.
- Only `validate` builds a `Command`; `Cx::submit` is the only input path inside a tick (C-INPUT). A new command is a
  `RawCommand` variant plus its `validate` arm.
- The sim rejects impossible actions without panicking, even though the server validated them.

## Where a mechanic goes

- A mechanic is a new file `src/systems/<mechanic>.rs` (entry points `fn(&mut Cx)`) plus its schedule rows; a ported hook
  link is a `fn(&mut Hx, &HookArgs)` in its own file, fired where legacy fires it (`hooks::fire`).
- Its state goes in `state.rs` (hashed, checkpointed); per-tick working sets in `scratch.rs` (`TickScratch`, never
  serialized); content in `content.rs` (which feeds `content_hash`).

## Every sim-editing packet keeps these green

- `tests/no_alloc.rs` (and the other `*_no_alloc.rs`): zero allocations per step.
- `tests/hash_coverage.rs`: every new serialized leaf changes the state hash.
- `check_world` in `src/checkpoint.rs`: a rule per new invariant, with one refusal test each.
- `crates/rh-parity/tests/schedule.rs` and `tests/content.rs`; update `what_the_slice_has_ported_stays_ported` for the rows
  you flip.
- Bump the identity whose format changed: `CHECKPOINT_FORMAT` (`checkpoint.rs`), `REPLAY_FORMAT` (`replay.rs`),
  `OBSERVATION_VERSION` (`observe.rs`); the coordinator records the new identities.

`schedule.rs`, `content.rs` and `observe.rs` are shared files: packets that touch them merge one at a time.

## Workflow

Find the legacy implementation under `packages/` and cite it by `file:line`. When legacy looks like a bug, match it and
flag it; the fix is a separate packet with a `DEVIATIONS.md` row. Archetype hitboxes (ADR 0024) are opt-in;
`LegacyCircle` keeps the existing fixtures valid.

Watch for: float order of operations, off-by-one-tick cooldowns, removal while iterating, same-tick competition between
effects, ids that legacy keeps as Uint16.

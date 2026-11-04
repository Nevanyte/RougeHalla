# ADR 0009: Core layout and the tick schedule as data

**Status:** Accepted. **Decision.** `rh-sim` is a facade over a layered core, and the tick is data that a test compares
with the legacy server.

**Layout** (`crates/rh-sim/README.md` has the table):
- `sim.rs` is the facade: `Sim`, its accessors and its few mutators. No game logic.
- `statics.rs` (`MatchStatic`: config, `Arc<Arena>`, secrets: immutable), `state.rs` (`World`: everything a later tick can
  depend on, the only thing the state hash and a checkpoint's `world` cover), `scratch.rs` (`TickScratch`: per-tick
  working sets, never serialized, never hashed).
- `systems/<module>.rs`: one file per legacy module, every entry point `fn(&mut Cx)` over borrow-split
  `Cx { k, w, s, ev, pf }`, so a system's first lines show its reach.
- `schedule.rs` (the tick as data), `hooks.rs` (hook dispatch), `input.rs` (commands, validation, the queue and budget).

**The schedule rule (C-TICK, executable).** In legacy the order of the tick is emergent: `updateActive` is 23 fixed phases,
but `systems`, `afterWeapons`, `beforeDamage`, `moveModifiers` and `modSources` fill by module install order, and every
`world.hooks` chain is built by `chainHook`, wrappers and replacing assignments. `parity/legacy-capture/schedule.ts` records
that from the real `createGameWorld` for three worlds (production, capture, training). `schedule.rs` holds the same
structure as tables:
- `PHASES`: the 23 rows of `updateActive`; `AFTER_WEAPONS`, `BEFORE_DAMAGE`, `SYSTEMS`, `MOVE_MODIFIERS` (a fold, left to
  right), `MOD_SOURCES`, `ACTIONS` and the 19 `HOOKS` chains (every link, in install order, with its mode
  default/append/wrap/replace).
- Each row is `{legacy name, config gate, run}`. `run` is `Ported(fn)` or `Pending("P-XXX-n")`, a real backlog packet id.
  The gate (`signatures`, `walkHints`, `mobs`, `quests`, `dummies`, training) is the legacy condition that decides whether
  a world has the row; the slice plays the capture world.
- A phase returns `Flow::Continue | EndTick` (legacy `return` inside `updateActive`, for `guard:voided`).
- `systems::update_active` is a loop over `PHASES`; `hooks:<list>` phases iterate their list; nothing else calls a system (the trace test sees only rows that run; `nothing_but_the_schedule_calls_a_system` reads the source and fails on a call from any other file).
- `crates/rh-parity/tests/schedule.rs` projects the tables under the three gate sets and compares them with the record
  (names, order, every hook chain and which links a later `replace` dropped), requires every `Pending` row to name a
  backlog packet, and, with the `schedule-trace` feature (an rh-parity dev-dependency feature, never in a production
  build), runs the slice fixtures and requires the ported rows to execute in table order. Mutation tests swap two phases,
  move `feed.flushAnnouncements` before `factions.afterDamage`, drop rows, reorder a chain, change a gate or mode, and
  invent a packet id: the same check functions must reject each.

**A mechanic packet** adds `systems/<mechanic>.rs` and flips its rows from `Pending` to `Ported`. It never reorders a table,
never adds a call to a system from anywhere else, and extends `what_the_slice_has_ported_stays_ported`. A row the record
does not have is a table the record must grow first (`parity/legacy-capture/schedule.ts`).

**Hooks.** A hook is fired through `hooks::fire(&mut Hx, HookArgs)` with typed arguments (one `HookArgs` variant per hook
that has a call site; a packet that fires another hook adds its variant and the call site at its legacy position). The
effective chain is the live links from the last live `replace` link on (`schedule::chain_from`, shared by dispatch and the
conformance projection). A link gets a `Hx` (statics, world, events), not the tick: it cannot touch the scratch or the path
search, so it decides from its arguments and queues what it pays for later. Legacy's two deferrals are typed data, never
closures, and they are two different queues that must not be mixed up. `payLater` (pay after the ledger pass, in the SAME
tick, or at once outside the pass: legacy `combat.collecting`) is `World::pay` (`PayQueue`) holding typed
`ledger::PayLater` variants; a link reaches it with `Hx::pay_later`, and `ledger::apply` pays the queue in order at the end
of the pass (a nested `pay_later` then pays at once, as legacy). The slice has one variant, `CreditKill`, which is the
kill's reward legacy queues with `payLater(creditKill)`, so the queue is exercised by every kill of the parity fixtures. A
packet whose link calls `payLater` (P-ABIL-1 `fighterOut` clear, P-STATUS-1, P-MOBS-1) adds its variant and its arm.
`combat.deferred` (`deferHit`, entries for the NEXT tick's ledger) is `World::deferred`, moved into the ledger by the
`ledger:openWithDeferred` row. A `payLater` effect must never be put in `World::deferred`: it would land one tick late.
`World::pay` is never checkpointed or hashed (empty and not collecting at every step boundary); `World::deferred` is in
the checkpoint and the state hash only while non-empty, so every state that existed before it keeps its hash.
First link through the seam: `loot.dropBody` (and the default it replaces), fired from
`settle::down_player` where legacy `downPlayer` calls it.

**Input seam (C-INPUT).** Commands are enqueued by one function, `input::accept` (`push` is private; `drain` also empties
the queue), whose one caller is
`systems::inputs::submit`. `Sim::submit` runs it, and so does `Cx::submit(PlayerId, Command)` (`Cx::propose` validates a
`RawCommand` first), so an actor inside the tick (a mob brain, P-MOBS-1) acts only through the same budget and queue rules.
The commands then apply in the secret action order through the `ACTIONS` table (legacy `world.actions[kind]`).

**Consequences.** Packets that add mechanics edit disjoint files plus rows in one table, and a reorder fails a test instead
of a fight months later. The tables cost nothing per tick: a `Plan` resolves them for a gate set in a `const` context
(only the live, ported rows, in table order; the three recorded worlds are three statics), so the loop is a walk over fn
pointers with no gate test and no skipped pending row (a first version that tested every row each tick cost +2.8% to +3.3%
Ir per step on the small duel workloads; the compiled plan measures 0.971 to 0.999 against the base with fewer
allocations per step, `tools/perfproof`). The gates are all-false for the slice until a packet adds the config switch it
needs (`Gates::of`).

**Evidence.** `crates/rh-parity/tests/schedule.rs`, `crates/rh-sim/src/schedule.rs` unit tests,
`crates/rh-sim/src/systems/tests.rs` (input seam, hooks, deferred queue, pay-later queue), `cargo run -p rh-parity --bin parity-report`.

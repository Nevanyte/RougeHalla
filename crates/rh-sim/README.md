# rh-sim

The authoritative simulation core: pure (no I/O, wall clock, entropy or hash-map iteration), a fixed 20 Hz step, and the
legacy tick order (`docs/CONTRACTS.md` C-TICK). Everything else (server, headless runner, parity harness, policies) drives
it through `Sim::submit` and `Sim::step`.

## Layout

| Module | Holds |
| --- | --- |
| `sim.rs` | The facade: `Sim`, `Placement`, the public read accessors (`tick()`, `phase()`, `server_time()`, `arena()`, `players()`, `player(id)`, ...) and the few mutators (`add_player`, `submit`, `mark_dropped`, `remove_player`, `step`). No game logic. |
| `statics.rs` | `MatchStatic { config, arena: Arc<Arena>, secrets }`: what the match is played with; immutable once it starts. `Arena`, `SimConfig`, `Secrets`. |
| `state.rs` | `World`: the evolving match state (players, clock, phase, run bookkeeping, events waiting between steps). The only thing the state hash covers; with the statics it is the whole checkpoint. `Player` and its runtime. |
| `scratch.rs` | `TickScratch`: per-tick working sets (damage ledger, melee requests, action ranks, tick-start bounties, the downed list). Never serialized, never hashed; each field is written before it is read within a tick. |
| `systems/` | One file per legacy module; every entry point is `fn(&mut Cx)`. See below. |
| `events.rs`, `results.rs` | `Event`; `RunResult`, `GvBreakdown`, `Outcome`. |
| `hash.rs` | `Sim::state_hash`, hand-written: the values and their order are part of the replay format (a replay recorded by an older build must keep verifying step by step). |
| `checkpoint.rs` | `{format, statics, world}` serde layout, the `rh-checkpoint/1` tag and `CheckpointError`. |
| `observe.rs`, `input.rs`, `replay.rs`, `rng.rs`, `map.rs`, `geometry.rs`, `pathfind.rs`, `content.rs`, `constants.rs`, `math.rs`, `arenas.rs` | Unchanged in role: the C-OBS filter, command validation and budgets, the replay recorder/runner, the RNG, collision, A*, tables. |

### Systems over a borrow-split `Cx`

```rust
pub(crate) struct Cx<'a> {
    k: &'a MatchStatic,        // read only
    w: &'a mut World,
    s: &'a mut TickScratch,
    ev: &'a mut Vec<Event>,    // the step's event log
    pf: &'a mut Pathfinder,    // path search scratch
}
```

A system entry point destructures only what it touches, so its first lines show its reach: `ledger::apply` splits the
scratch into the ledger, the action ranks, the tick-start bounties and the downed list, reads the statics and writes
players and events; the pathfinder is touched only by `inputs` (a move order plans its path); `credit` and `settle` never
read no statics. Helpers below an entry point take the narrowest borrows (one fighter and the clock, say). The
disjoint fields replace the earlier `mem::take` workarounds.

`systems::update_active` is the legacy `updateActive` in its order; the phases that are not ported yet are marked where they
go. Never reorder it. Adding a mechanic is a new `systems/<mechanic>.rs` plus one call at its legacy position.

### Checkpoints

`serde_json::to_value(&sim)` yields `{"format": "rh-checkpoint/1", "statics": ..., "world": ...}` with the tag first.
`Sim::restore(deserializer)` (or plain `Deserialize`) rebuilds the derived map tables and starts with empty scratch; a
missing tag, another tag or a payload without its parts is refused with a typed `CheckpointError`. A change that makes
`statics` or `world` unreadable by old checkpoints bumps `CHECKPOINT_FORMAT`.

The arena is an `Arc<Arena>` (serde `rc`): it serializes exactly as a plain `Arena`, so replay JSON is unchanged, and
`Sim::new` / `Sim::reset_active` accept anything `Into<Arc<Arena>>` (an `Arena` by value, or a shared `Arc`).

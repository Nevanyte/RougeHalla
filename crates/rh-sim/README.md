# rh-sim

The authoritative simulation core: pure (no I/O, wall clock, entropy or hash-map iteration), a fixed 20 Hz step, and the
legacy tick order (`docs/CONTRACTS.md` C-TICK). Everything else (server, headless runner, parity harness, policies) drives
it through `Sim::submit` and `Sim::step` (or `Sim::step_into`, the allocation-free entry that fills a reused event buffer;
`tests/no_alloc.rs` holds it at zero allocations per step).

## Layout

| Module | Holds |
| --- | --- |
| `sim.rs` | The facade: `Sim`, `Placement`, the public read accessors (`tick()`, `phase()`, `server_time()`, `arena()`, `players()`, `player(id)`, ...) and the few mutators (`add_player`, `submit`, `mark_dropped`, `remove_player`, `step`). No game logic. |
| `statics.rs` | `MatchStatic { config, arena: Arc<Arena>, secrets }`: what the match is played with; immutable once it starts. `Arena`, `SimConfig`, `Secrets`. |
| `state.rs` | `World`: the evolving match state (players, clock, phase, run bookkeeping, events waiting between steps). The state hash covers it (seeded with the statics digest); with the statics it is the whole checkpoint. `Player` and its runtime. |
| `fighter.rs` | The fighter as components: `FighterCore { id, body, vitals, weapon, motion, inputs }` (the components every fighter has) and `FighterRef` (a read-only view of a core plus whether it still stands), and what only a seated player adds: `Seat`, `Credit`, `Fate`. `Player` wraps a core and derefs to it. Today `FighterRef` has one consumer, the line-of-sight and fog filter in `observe.rs` (`sees`), so what an observer sees does not depend on the seated-player record. The tick systems (inputs, movement, weapons, melee, ledger, settle) still take `&Player` / `&mut Player`, reaching the core through `Deref`; a mob packet moves them onto the core when a second kind of fighter needs it. |
| `store.rs` | `EntityId` and `Store<T>`: entities in ascending id order (join order), looked up by id in O(1) while ids are dense and O(log n) otherwise; its slot is the index the dense per-slot scratch lists use. |
| `scratch.rs` | `TickScratch`: per-tick working sets (damage ledger, melee requests, action order and per-slot ranks, per-slot tick-start bounties, the standing list and move multipliers, the downed list). Never serialized, never hashed; each field is written before it is read within a tick. |
| `systems/` | One file per legacy module; every entry point is `fn(&mut Cx)`. See below. |
| `schedule.rs`, `hooks.rs` | The tick as data: `PHASES`, the registration lists, `ACTIONS` and the hook chains (each row a legacy name, a config gate and `Ported`/`Pending`), the loop that runs them, and hook dispatch (`hooks::fire`). |
| `events.rs`, `results.rs` | `Event`; `RunResult`, `GvBreakdown`, `Outcome`. |
| `hash.rs` | `Sim::state_hash`: the World serialized through a word-wise serde hasher, seeded with the statics digest (no statics secrets; server-private, see ADR 0007). Replays are rh-replay/5; other tags are refused. |
| `checkpoint.rs` | `{format, content_hash, build, statics, world}` serde layout (restore refuses another content hash), the `rh-checkpoint/7` tag and `CheckpointError`. |
| `vision.rs` | A living viewer sees the first wall face and live activity on its own revealed tiles for 30 seconds. Immutable-map origins refresh at 100 ms intervals. Actor/prop projections, catch-up events and pickup feedback read the same frozen trail. |
| `item_view.rs` | Per-seat item observations and exact pickup offers. `ItemObserver::prepare_into` stages a full observation and commits handles only on delivery. Retired batches have 20 ticks of grace. |
| `input.rs` | `PublicCommand` (observer proposal), `RawCommand` (trusted resolved/fixture input), `validate`, and `Command`, an opaque type: it is built only by `validate` or by decoding, which validates again and refuses a command validation would change, so a replay cannot inject an unvalidated command (C-INPUT). Also the order budget and the per-fighter queue. |
| `archetype.rs` | ADR0024 hitbox archetypes: `ArchetypeId`, `HitboxMode` (`SimConfig::hitboxes`, default `LegacyCircle`), the measured `ARCHETYPES` table (foot box for walls and paths, body box and chest for hits), `assign(mode, identity)` (the one writer of `FighterCore::archetype`). Data and pure functions only: no system, no schedule row. The geometric primitives (`Footprint`, `box_clear`, `arc_hits_box`, `segment_box_entry`) are in `geometry.rs`. |
| `systems/mob_spacing.rs` | ADR0024 addendum "Mob spacing": under `Archetypes` with `SimConfig::mob_spacing = Auto` (`archetype::mob_spacing`), a regional or practice mob that its policy keeps in place steps out of its pack-mates' room with one validated `Move` (a coordinate descent on the pack's squared overlap: packs come to rest), and a chasing mob's goal is shifted sideways away from overlapping pack-mates. Not a system and no schedule row: `mobAI.thinkMobs` builds the per-call neighbour index (`TickScratch::mob_spacing`, cells of `MOB_SPACING_CELL`) and `mob_ai::fight` asks for the step or the shift. Never runs under `LegacyCircle`. |
| `observe.rs`, `replay.rs`, `rng.rs`, `map.rs`, `geometry.rs`, `pathfind.rs`, `content.rs`, `constants.rs`, `math.rs`, `arenas.rs` | Unchanged in role: the C-OBS filter, command validation and budgets, the replay recorder/runner, the RNG, collision, A*, tables. |

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
players and events; the pathfinder is touched only by `inputs` (a move order plans its path); `credit` reads no
statics and `settle` reads them only to fire hooks and end the run. Helpers below an entry point take the narrowest borrows (one fighter and the clock, say). The
disjoint fields replace the earlier `mem::take` workarounds.

### The tick as data (`schedule.rs`, ADR 0009)

`systems::update_active` is a loop over `schedule::PHASES`, the 23 rows of legacy `updateActive` in order. Each row is
`{legacy name, gate, run}`: `Ported(fn(&mut Cx) -> Flow)` or `Pending("P-XXX-n")` (the backlog packet that ports it). The
registration lists legacy fills by module install order are tables too: `AFTER_WEAPONS`, `BEFORE_DAMAGE`, `SYSTEMS`
(`feed.flushAnnouncements` is #6, after `fireRoam`, `factions.afterDamage`, `factions.healOverTime`, `mobs.resetDummies`,
`buffs.expireBoosts`), `MOVE_MODIFIERS` (folded in table order), `MOD_SOURCES`, `ACTIONS` (queued commands run through it)
and the 19 `HOOKS` chains. A gate is the legacy condition that decides whether a world has a row (`signatures`,
`walkHints`, `mobs`, `quests`, `dummies`, training); the slice plays the capture world (`Gates::of`).
`crates/rh-parity/tests/schedule.rs` fails when a table stops matching `parity/schedule/legacy_schedule.json` in the
production, capture or training world, and (feature `schedule-trace`, enabled only as an rh-parity dev-dependency
feature) when a match runs its ported rows in another order than the table. Never reorder a table. **Adding a mechanic is a
new `systems/<mechanic>.rs` plus flipping its rows from `Pending` to `Ported`.**

Hooks are fired through `hooks::fire(&mut Hx, HookArgs)` (typed arguments; the chain follows the record's modes
default/append/wrap/replace; a link sees the statics, the world and the events, never the tick scratch). Effects that cross
a tick boundary are typed data in the world (`World::deferred`, legacy `combat.deferred`: entries that open the next tick's
ledger), never closures; legacy `payLater` (paid after the ledger pass, SAME tick) is the separate `World::pay` queue,
reached with `Hx::pay_later` and typed `ledger::PayLater` variants. Inside the tick an actor queues commands with
`Cx::submit`, which is `Sim::submit`'s own path: commands are enqueued only by `input::accept`.

### Checkpoints

`serde_json::to_value(&sim)` yields `{"format": "rh-checkpoint/30", "content_hash": ..., "build": ..., "statics": ..., "world": ...}` with the tag first.
`Sim::restore(deserializer)` (or plain `Deserialize`) rebuilds the derived map tables and starts with empty scratch; a
missing tag, another tag or a payload without its parts is refused with a typed `CheckpointError`. So is a state the tick
cannot survive (`CheckpointError::Malformed`): `next_id` at or below a seated or past player id, or at `u32::MAX`; a
roster or player list out of id order; a `server_time` that is negative, non-finite or beyond `u32::MAX` ticks (where the
clock's own additions stop being exact); `tick` at `u32::MAX`; a rewind history whose samples are not at least one tick apart (which also orders them) or that is
dated after `server_time` (a denser one fills the ring within a few steps); any body, rewind sample, waypoint or arena
spawn that is non-finite or more than 1024 units past the map (huge coordinates overflow the tile arithmetic, and opposite
extremes cancel in a finiteness sum); `bot_kills` above `kills`, `kills` above the roster length, `joined` or
`downs_between_ticks` above the roster length (natural bounds: a kill needs a victim, a down a fighter); a carried fist item or invalid active slot, an action whose kind or weapon mismatches the hand,
invalid container, item or flight identities, invalid flight positions, velocities, clocks or reflection counts, invalid shred timers or values, and queued inputs outside validation bounds. Counters with no natural bound (`inputs.dropped`, the gv parts and their sum) use saturating arithmetic, which is
bit-identical below `u32::MAX`. These are the rules the tick is known to rely on: each has a refusal test in
`checkpoint.rs`; a few hundred random and structured mutations of a real checkpoint restore, step, take commands and
join/leave without a panic; and `rh-headless/tests/restore_real.rs` restores checkpoints of real bot and lobby matches at
hundreds of steps and asserts none is refused. A change that makes
`statics` or `world` unreadable by old checkpoints bumps `CHECKPOINT_FORMAT`.

The arena is an `Arc<Arena>` (serde `rc`): it serializes exactly as a plain `Arena`, so replay JSON is unchanged, and
`Sim::new` / `Sim::reset_active` accept anything `Into<Arc<Arena>>` (an `Arena` by value, or a shared `Arc`).

Containers and projectiles share the legacy run-local entity counter. Fixtures encode its value in base 36
after `c` or `p`. An item UID uses its own decimal counter. Both counters and live gear and missiles are
authoritative checkpoint and hash fields. The ledger folds active axe shred after damage. Directional bow
and wand shots leave after movement, sweep on subsequent ticks, and can outlive the shooter. The simulation
keeps complete launch/end events private until viewer-specific projectile presentation is implemented.

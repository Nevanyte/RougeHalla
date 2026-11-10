# Root bridge request — P-BOT-BRAIN-NATIVE-1 (private Brain native)

Status: **worker request only; no lease is self-granted.** The implementation below proceeded only within the Root final
allocation (four existing files, exact hunks). This note returns two concrete interface limits the worker hit and the
smallest change that would lift each; neither is resolved by a provider copy, defaults, or an out-of-scope edit.

## 1. Hunt `paths.walk` source arguments (`HuntMobLike` visibility)

**Function/signature/path.** `crates/rh-policy/src/bots/temporal_percept/strategy/types.rs` (line ~475) defines
`PathApi::walk_mob(&mut self, from: Vec2, to: &super::mob_hunt::HuntMobLike)`. `mob_hunt` is a private module of the sealed
strategy component (`strategy.rs: mod mob_hunt;`), so a Brain-side adapter outside that module cannot name
`HuntMobLike` and therefore cannot override `walk_mob` to record the source's exact callback arguments
(`[{x,y}, MobLike]`). Implement `adapters::BrainPathAdapter` for `PathApi` without the override (the default falls through
to `walk` with point arguments).

**Smallest hunk requested (no behavior change):**

```rust
// crates/rh-policy/src/bots/temporal_percept/strategy.rs — next to the existing `pub(super) use engine::{...};`
pub(super) use mob_hunt::HuntMobLike;
```

With that single visibility line, the Brain adapter can add a 6-line `walk_mob` override that records the exact source
`MobLike` object order (`kind,type,status,x,y,hp,maxHp,faction,weapon0`). No engine/algorithm/RNG change is required.

**Current honest state.** The 4 frozen hunt `paths.walk` trace rows (rich `MobLike` arguments) are the only known
expected rows that cannot be reproduced exactly; the fallback records the source walk's point arguments instead. All
other path callbacks (strategy camp walks, tactics Foe/Container walks, module chest walks, los/clear/collisionMap,
results/stats) are exact. This is reported as an unreached source-compatibility row, not hidden by a widened comparator.

## 2. Humanizer concrete-Rng lane interleaving

**Interface.** `crates/rh-policy/src/bots/humanizer.rs: pub struct Context<'a> { p, engaged, motor: &'a mut Rng, lapse:
&'a mut Rng }` — the admitted Hand takes the concrete `Rng` lanes, so the Brain cannot wrap its draw sites (the source hand
receives a wrapped `ctx.rng[lane]` object). The native Brain therefore recovers the exact per-lane draw values/count from
the pure mulberry state delta: per-lane value order and counts are exact, released commands/stats/memory/path effects are
exact, but the **cross-lane interleaving inside one submit/release call** is unobservable through that public API and the
frozen trace's global `sequence` there has no observable native counterpart. The replay comparator compares every
non-RNG row and every decide-lane row exactly, and for hand-call motor/lapse rows compares the exact per-lane
`(index, value)` transcripts + counts (declared limit, never reduced tolerance or reordered expectation).

**Smallest option if Root wants exact global RNG transcript equality:** a test-only draw observer hook on the admitted
`Rng` (e.g. in `crates/rh-policy/src/bots/random.rs`, outside this packet's lease) that lets the Brain register a
per-lane recording sink; or change `Humanizer::Context` lanes to the already-admitted `RngStream` trait object (a larger
humanizer.rs change). Not applied; the packet's four-file lease does not include either file.


## 3. Root request: two-site `paths.rs` JS `Math.hypot` numeric hunk (1-ULP exactness)

**Obstruction.** The frozen Brain replay now matches 29/31 histories exactly (all 855 operations, setup traces, hand
6/12 global RNG transcripts). Two `paths.walk` result distances differ by exactly 1 ULP:

- `core-farm-route op[11] trace[29].result.dist`
- `core-coliseum op[7] trace[17].result.dist`

expected `586.7448329334259` (bits `0x408255f56af81062`), actual `586.7448329334258` (bits `0x408255f56af81061`).

Root cause: `crates/rh-policy/src/bots/paths.rs` (admitted path-budget component, outside this packet's lease) computes
source `pathLength` distances with `rh_sim::math::hypot` (forked libm) while the source service uses JavaScript
`Math.hypot`. The repository's source-exact JS `Math.hypot` leaf is `rh_sim::mapgen::certify::source_hypot` (used by the
admitted tactics/memory/modules leaves). The admitted path parity test used a 6-decimal tolerance, so the 1-ULP deviation
was not visible there; the frozen Brain comparator is bit-exact and no tolerance is admissible.

**Smallest hunk requested (prepared, NOT applied; outside granted lease):** in
`crates/rh-policy/src/bots/paths.rs`, replace the two `rh_sim::math::hypot` uses with
`rh_sim::mapgen::certify::source_hypot`:

1. `path_length()` — the exact-walk distance sum (each segment's distance).
2. `RoomPathService::walk_with`'s over-budget straight-line fallback (`hypot(...) * STRAIGHT_FACTOR`).

No behavior/order/cache/stats/budget semantics change beyond the source-exact numeric leaf. The independent adapter
owner validated this 2-site hunk in a scratch copy: with it, the full 31/31 frozen histories replay exactly, and the
existing path/budget/parity test filters stay green. Receipts: see `RUNS.md` / `FAILURES.md` in this evidence directory.

## Non-requests

The worker did not request any change to Memory, Strategy, Tactics, Modules, Humanizer, Knowledge, path service,
`PathBudget`, the public bot API, `Sim`/`World`, headless runners, protocol, dependencies, lockfile or shared status. The
frozen source/tool/corpus/expectations were not edited or recaptured.

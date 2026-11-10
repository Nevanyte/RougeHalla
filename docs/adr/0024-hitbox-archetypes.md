# ADR0024: Hitbox archetypes, foot and body boxes, chest-height projectiles

Status: **Proposed.** Review fixes 13-22 under "Changes during implementation"; items 14-16 and the rule-3 risk sign-off
are owner-approved 2026-11-10. Owner-approved direction 2026-11-09 ([UNITY_REWORK_FABLE.md](../prompts/UNITY_REWORK_FABLE.md)
section 4: "Hitboxes", "Projectiles fire from the chest", "Parity conflict", "Protocol"). Nothing is implemented. Two
points need the owner at Gate 1: the melee height rule (Decision 5) and the protocol number (Decision 9). Every line
reference is to `feature/unity-rework` at `e1f45765`.

**Parity conflict, stated plainly.** Live play under this ADR departs from legacy behaviour. That conflicts with the
`CLAUDE.md` parity non-negotiable and with C-PARITY ("Accepted, FROZEN"). It also anticipates ORDER_OF_OPERATIONS D1
(outcome-class parity), which is not yet an ADR, and it adds design inside the D5 freeze. The owner approved the
departure. This ADR does not resolve the conflict. It confines it: legacy behaviour stays bit-exact under a
`legacy_circle` archetype, every existing parity fixture runs only in that mode, and the live mode is a
`docs/DEVIATIONS.md` **balance** row checked by Rust-native goldens and the balance harness instead of legacy captures. Under
the existing records, a balance row cannot ship without a harness verdict (DEVIATIONS rule 3). Packet P-HB-9 owns that
verdict.

**Per-operation checklist** (ORDER_OF_OPERATIONS section 3). Phase/item: not in the plan; owner direction 2026-11-09
(Unity rework, Rust exception). D1: byte-exact for everything under `legacy_circle`; the live mode is a ledger deviation.
D2: a harness verdict is required before the live switch (P-HB-9). D5: an owner-approved exception. D9: only the foot-box
path is predicted, mirrored from Rust and corrected by the server. Shared records (MIGRATION checkpoint, CONTRACTS table,
`Cargo.lock`) are left to the coordinator.

## Context

What the code does today:

- **One circle, one point.** `PLAYER_RADIUS = 12 u` (`crates/rh-sim/src/constants.rs:71`, tile 32 u). An entity is the
  point `Body { x, y }` (`fighter.rs:41-46`). Characters never block each other.
- **Normal walking has no wall test.** `advance_along_path` (`systems/movement.rs:132-156`) follows the A* path. Walls
  are enforced only by the path's clearance: `circle_clear` and `segment_rays_clear` (`geometry.rs:288-367`) as used by
  `Pathfinder::find_path_into` and `clamp_clear` (`pathfind.rs:230-433`). The one exception is the per-axis disc sweep on
  slippery terrain (`systems/terrain/walk.rs:56-120`, called from `movement.rs:101`).
- **Melee.** It rewinds every body (attacker included) to `rewind_t = now - min(MAX_REWIND_MS, max(TICK_MS, lag_ms))`
  (`systems/weapons.rs:219`). Each hit goes through `in_arc(origin, a, reach, half_arc, at, PLAYER_RADIUS)`
  (`melee.rs:112`, defined at `:262-280`). The wall check is a ground ray from the attacker's feet to the target's feet
  (`:115-124`). Quest givers are never bodies (`:55`).
- **Projectiles.** A shot spawns at the owner's feet (`projectiles.rs:92`). Walls are a ground raycast per sub-step
  (`:179-184`). Bodies are a swept segment against a disc of reach `PLAYER_RADIUS + ARROW_RADIUS` (arrows) or
  `+ RANGED_SLACK` (balls) (`:251-305`). Each body is taken at `position_at(t)` for that sub-step.
- **Sim axes.** +x is east and +y is south, so screen-up (north) is -y. Evidence: `ArenaView.WorldPoint` maps sim y to
  `-y * Scale * GroundSquash` (`client-unity/UnityProject/Assets/Scripts/View/ArenaView.cs:14-16`), and facing pi/2
  selects the Flare S frame (`SpriteActorPresenter.cs:183-184`).

Findings that change how the direction can be applied:

1. **The ground is drawn squashed.** `GroundSquash = 0.78` (`ArenaView.cs:15`, inverted in `ScreenToServer` at
   `:424-427`). One Unity unit is 32 sim units across but 32 / 0.78 = 41.03 sim units vertically. A height drawn on
   screen therefore converts at 41.03 u per Unity unit, not 32. The direction's "32 sim units per world unit" is correct
   only horizontally.
2. **The three "sprite heights" are not heights.** `WorldHeight` (1.15 / 0.894 / 0.671,
   `Resources/Showcase/Catalog.asset`) is a scale factor applied to whole sprite cells
   (`SpriteActorPresenter.cs:189-190`; cells are 388, 384 and 288 px at 128 PPU). The visible characters under the same
   1.15 range from 41 u (goblin) to 72 u (knight). Read literally as heights (x1.2 x32), the numbers would give 44 / 34 /
   26 u boxes that match no sprite. The table below is measured instead from the trimmed opaque frame rectangles in
   `Assets/Art/Derived/ShowcaseLive/receipt.json`. The method is in P-HB-0.
3. **Arrows already stop at the first body, but only a hostile one.** `first_body` takes the minimum
   `(u, distance, rank, slot)` over contacted bodies (`projectiles.rs:273-305`). `advance` then ends the flight with
   `Hit`, or reflects/blocks it (`:453-488`). One flight hits at most one victim. Wand specials add a ground splash at
   the victim (`:329-361`), which does not pass through. The candidate list skips bodies that are not hostile to the
   owner, and mob-owned shots skip non-players (`:285-289`). So a character in front shields the one behind only from
   its enemies: allies do not block each other's shots. This ADR keeps that filter.
4. **Measuring melee from the attacker's chest is lopsided between archetypes of different sizes.** Notation: `c` is a
   chest height, `H` is how far a body box reaches above the feet (north), and `b` is how far it reaches below (south).
   With origin chest `c_a`, a target is hit north of the attacker out to `reach + b_t + c_a` and south out to
   `reach + H_t - c_a`. The two are equal only when `c_a` is the target's box centre. Example: a hero (c 30) against an
   antlion (H 29) reaches 38 u further north than south. Measuring from the feet, which the direction rules out, would be
   lopsided by 22 u. See Decision 5.
5. **Homing balls would orbit short targets.** A homing ball steers its ground point onto the target's feet
   (`projectiles.rs:143-159`). Raised by a chest height above the target's box top, it would never touch the box. See
   Decision 4.

## Decision

### 1. The archetype table (data model)

- **Where.** A new kernel module `crates/rh-sim/src/archetype.rs`, next to `content.rs`, `geometry.rs` and
  `mob_catalog/`. It is data plus pure functions, with no system and no schedule row, so the ADR0009 tables and C-TICK
  are untouched. Add it to the `crates/rh-sim/README.md` layout table. The new geometric primitives go in `geometry.rs`.
- **Types.** `ArchetypeId(u8)` (stable and append-only, like a protocol bit). `Archetype { id, key: &'static str, hull,
  chest: f64 }`, where `key` is the Unity catalog appearance key. `hull` is either `Hull::Circle { r }` or
  `Hull::Boxes { foot: Half, body: Half, body_offset: (f64, f64) }`. `Half` is a pair of half-extents. The foot box is
  centred on the feet. `pub const ARCHETYPES: [Archetype; 13]`. Every value is an integer in sim units, exact in f64 and
  in a u8 or i8 on the wire.
- **Content identity.** `archetype::visit_content` folds every row into `content_hash` as a tagged definition
  (`("hitbox-archetypes/1", ...)`, the pattern at `content.rs:1134-1135`). Changing the table changes the rules identity
  carried by Welcome, `/info` and replays. `tests/content.rs` registers the const.
- **How an entity gets its id.** A new field `FighterCore.archetype: ArchetypeId` (`fighter.rs:127`). Its one writer is
  `archetype::assign(mode, identity)`, called by every fighter constructor: players (`state.rs:678`), mobs and zombies
  (`mob_runtime.rs:176`, `:236`), dummies and givers. Under `Archetypes` the identity maps as follows:
  - Players by faction: Fire and Sentenced get `hero`, Plague `mage`, Frost `hero_female`, Holy `mage_female`, and no
    faction gets `knight`.
  - Training dummies get `knight`, corpse zombies get `zombie`, and quest givers get `hero` (the hero-sized default).
  - The 30 mob types copy today's art mapping (`ShowcaseActorLook.cs:8-15`, in `MobTypeId` order):
    EmberImp goblin, CinderHound antlion, MagmaBrute goblin_elite, FlameCaller skeleton_mage, Wyrmling goblin_elite,
    AshDrake antlion, Bailiff skeleton, ChainWarden goblin_elite, Inquisitor skeleton_archer, Pardoner skeleton_mage,
    Executioner goblin_elite, Gaoler skeleton_mage, PlagueRat antlion, Bloatfly antlion, RotMonk zombie, MiasmaWitch
    mage_female, RatOgre goblin_elite, PoxBehemoth zombie, FrostWisp skeleton_mage, IceGolem goblin_elite, RimeStalker
    skeleton_archer, FrostbowSentry skeleton_archer, GlacialWarden skeleton, AvalancheTroll goblin_elite, Acolyte mage,
    SeraphShard skeleton_mage, Penitent zombie, Zealot hero, BloodSaint mage_female, Archon hero_female.

  The mapping moves into Rust. Unity's `MobLooks` copy is deleted, and Unity picks the sprite from the archetype `key`
  instead.
- **Mode without branching the tick.** Add `SimConfig.hitboxes: HitboxMode { LegacyCircle, Archetypes }` with
  `#[serde(default)]`, and `Default` returns `LegacyCircle` (`statics.rs:194-281`). This mirrors the netcode branch's
  `lag_fairness` flag. Under `LegacyCircle`, `assign` returns id 0 for every entity. Hit code dispatches on the entity's
  `hull` (data), never on the config. A `Circle` hull calls today's functions with today's arguments, so legacy runs are
  bit-identical. Only `rh-server` live runtimes set `Archetypes` (`crates/rh-server/src/runtime.rs:122-124`).
- **Restore.** `Sim::restore` refuses three states: an unknown id, an id that differs from
  `assign(mode, identity)`, and a projectile height that is non-finite or negative. A test-only invariant check compares
  every fighter's id with `assign` after each step.

### 2. Geometry and numbers

All values are in sim units. North is -y. The body box spans `[x-bx, x+bx]` by `[y+oy-by, y+oy+by]`. Its top is
`-(oy-by)` north of the feet and its bottom is `oy+by` south of them. `chest = -oy`, the box centre, so equal archetypes
are even north and south. Projectile height is always one archetype's `chest`.

| id | key | foot half (x, y) | body half (bx, by) | body offset (0, oy) | chest | top / below feet |
|---|---|---|---|---|---|---|
| 0 | legacy_circle | circle r 12 (feet and body) | circle r 12 | n/a | 0 | n/a |
| 1 | hero | 10, 6 | 16, 35 | 0, -30 | 30 | 65 / 5 |
| 2 | hero_female | 10, 6 | 15, 35 | 0, -33 | 33 | 68 / 2 |
| 3 | mage | 10, 6 | 17, 28 | 0, -25 | 25 | 53 / 3 |
| 4 | mage_female | 10, 6 | 17, 28 | 0, -27 | 27 | 55 / 1 |
| 5 | knight | 10, 6 | 18, 37 | 0, -35 | 35 | 72 / 2 |
| 6 | goblin | 10, 6 | 17, 22 | 0, -19 | 19 | 41 / 3 |
| 7 | skeleton | 10, 6 | 18, 40 | 0, -31 | 31 | 71 / 9 |
| 8 | goblin_elite | 10, 6 | 13, 18 | 0, -16 | 16 | 34 / 2 |
| 9 | antlion | 10, 6 | 20, 18 | 0, -11 | 11 | 29 / 7 |
| 10 | skeleton_archer | 10, 6 | 14, 24 | 0, -21 | 21 | 45 / 3 |
| 11 | skeleton_mage | 10, 6 | 14, 23 | 0, -21 | 21 | 44 / 2 |
| 12 | zombie | 10, 6 | 9, 21 | 0, -21 | 21 | 42 / 0 |

How the table was measured (P-HB-0 makes this reproducible):

- **Top.** The median over Idle frames of the opaque top above the foot pivot, in Unity units:
  `px * WorldHeight * 1.2 / 128`. Then add the presenter's 0.096 body lift (`SpriteActorPresenter.cs:191`) and multiply
  by 41.03.
- **Below.** The same median for the opaque bottom below the pivot.
- **Half-width (`bx`).** Half the median Idle width of the N and S facings, multiplied by 32.
- **Rounding.** Values are rounded to whole units with `top + below` even.
- **Exception.** The skeleton's Idle frames include a two-handed weapon (all-facing median half-width 36), so its `bx`
  is set to the knight's 18.

The foot box is one value for every archetype. 10 by 6 lies inside the 12 u disc (sqrt(136) = 11.66), so every position
or segment that is clear for the legacy disc is also clear for the foot box. This invariant is what makes it safe to leave
spawn, placement and AI clearance at 12 u. A table test asserts `fx^2 + fy^2 <= PLAYER_RADIUS^2`,
`2 * max(fx, fy) < TILE` and `chest == -oy` for every boxed row.

### 3. Walls and pathfinding: the foot box

- `geometry.rs` gains `enum Footprint { Disc(f64), Box { hx, hy } }` with three operations:
  - `clear`: a box is blocked when it overlaps a blocked tile in the open interval, so touching is clear, matching the
    disc's `< r^2`.
  - `segment_clear`: both end boxes clear, plus the centre ray and the two silhouette-corner rays. A swept AABB is a
    hexagon, and a tile can only enter it through an end box or a silhouette edge, because the box diagonal (23.3) is
    less than a tile.
  - `clamp`: x is clamped by `hx` and y by `hy`.

  `Disc(r)` calls today's `circle_clear` and `segment_rays_clear` unchanged.
- `Pathfinder::find_path_into`, `plan_path` and `plan_path_into` (`pathfind.rs:437-450`) take a `Footprint` instead of a
  radius. Every caller must choose one:
  - The fighter's foot: `systems/inputs.rs:184`, `systems/targeting.rs:92`, `Path::replan` (`state.rs:238-251`, via
    `displace.rs:46` and `walk.rs:357`).
  - The legacy disc: `training.rs:145` and `training/console.rs:234` (placement reachability).
- `walk.rs`: `sweep` gets a box arm. A row counts when `[jT, (j+1)T]` openly overlaps `[y-hy, y+hy]`, and the stop face
  is offset by `hx` instead of the disc chord. `clear`, `regrip` (`:354`) and `replan` take the mover's footprint, as
  does `movement.rs:101`.
- A* itself (the tile graph and the corner rule) and `snap_to_floor` are unchanged.

### 4. Projectiles: ground position plus height

- `ProjectileLaunch` (`state.rs:788-798`) gains `height: f64`, set at spawn (`projectiles.rs:83-97`):
  - the owner's `chest`, or 0 under legacy;
  - a reflected arrow keeps the incoming height, so the drawn path does not jump (`:429-439`).
- **Walls** use the ground segment, as today (`stretch`, `:179-184`).
- **Bodies.** `first_body` (`:273-305`) dispatches on the target's hull:
  - `Circle`: today's `contact` on the ground segment.
  - `Boxes`: the raised segment `ground - (0, height)` against the body box grown by `ARROW_RADIUS` or `RANGED_SLACK` on
    every side. The test is a slab test with no sqrt, returning the entry `u`. Starting inside the box counts as `u = 0`
    only if the shot is not moving away from the box centre, which mirrors `contact` (`:251-271`).

  The contact point is `lerp(ground a, ground b, u)`. The tie-break tuple is unchanged.
- **Homing** (`:143-159`) steers the ground point toward `target feet + (0, oy_t + height)`, so the raised point heads
  for the target's box centre. This is the identity under legacy.
- **Ball against arrow** (`delete_arrows`, `:210-249`) compares the raised stretches. The occlusion ray stays at ground.
- **Splash** (`:329-361`) stays a ground circle around the victim.

### 5. Melee: arc against the body box at chest height

- **The test.** `geometry::arc_hits_box(o, a, reach, half_arc, box)` is exact. Let `p` be the point of the box closest
  to `o`:
  1. If `o` is inside the box, it hits.
  2. If `|p - o| > reach`, it misses. Use the squared distance with the same margin as `in_arc`.
  3. If `p`'s bearing is within `half_arc + ARC_EPS` of `a`, it hits.
  4. Otherwise it hits if either boundary ray segment `o + [0, reach] * dir(a +/- half_arc)` crosses the box.

  Proof: the box intersected with the disc is connected. If it holds a point inside the wedge but `p` is outside the
  wedge, it must cross the wedge boundary inside the disc.
- **Where it runs.** `melee.rs:112` dispatches on hull. `Circle` keeps `in_arc(.., PLAYER_RADIUS)`. The wall ray
  (`:115-124`) and the shield-facing test (`:145-151`) stay feet-to-feet. Reach and arc constants are unchanged.
- **Decided height rule: the target's chest** (coordinator ruling 2026-11-09). Measure from the attacker's rewound feet
  raised by the **target's** chest, `o = origin + (0, oy_t)`. That is the same as testing the feet against the target box
  centred on the target's feet, and it is even north and south for every pair of archetypes. For equal archetypes (every
  same-look PvP fight) it equals the literal "attacker's chest". This **replaces the owner direction's "attacker's
  chest"** wording, because the literal rule fails the direction's own stated purpose (reach even in all directions) for
  unequal sizes (Context, finding 4). **Flagged for the owner**: the fallback is one line, `oy_a` instead of `oy_t`
  (`systems/melee.rs`).
- **Ball interception.** Under this rule `meet_balls` (`projectiles.rs:526-574`) needs no change, because both ends are
  raised by the same height. Under the literal rule its origin would rise by `c_a` and the ball by its own height.

### 6. Aim

- **Humans.** The fix is client-only. `MatchClient.cs:319` becomes
  `atan2(cursorY - (myY - chest_self), cursorX - myX)`, with `chest_self` taken from the table on the wire. The raised
  path then leaves the chest and passes through the cursor. The same angle drives facing and melee. The sim takes the
  angle as given; no server change.
- **Bots and mobs.** Their aim logic is unchanged. A feet-to-feet aim puts the raised line through `(tx, ty - c_s)`,
  inside the target's box whenever `c_s <= top_t + slack`. That holds for every mob shot at a player and for every arrow.
  The one predicted miss: a hero_female's ball (c 33) against antlion-look mobs (top 29 + 2). The fix, if P-HB-9 measures
  misses, is "aim from own chest at target centre" and nothing more.

### 7. Every `PLAYER_RADIUS` use, classified

- **Foot box.**
  - `systems/movement.rs:101` (ice walk)
  - `systems/terrain/walk.rs:354` (regrip)
  - `pathfind.rs:438`, `:449` (`plan_path*`, the mover's path)
  - the indirect callers listed in Decision 3
  - C# `client-unity/RoguehallaNet/Net/Pathfinder.cs:35` (`PlayerRadius`, default in `FindPath`, `:98-101`)
- **Body box.**
  - `systems/melee.rs:112`
  - `systems/projectiles.rs:275`
- **Stays 12 u: spawn and placement clearance.**
  - `checkpoint.rs:316` (restore spawn check)
  - `initial_world/mod.rs:282`
  - `quests/placement.rs:309`, `:419`, `:495`, `:537`
  - `traders/runtime.rs:33`, `:192` (trader walk, not a fighter)
  - `abilities/blink.rs:182` (landing)
  - `systems/wind.rs:114`
  - `systems/plague_zombies.rs:71`
  - `systems/cannons.rs:51` (landing)
  - `systems/coliseum.rs:78`, `:87`
  - `systems/training.rs:104`
  - `systems/training/console.rs:219`
  - `systems/planning/deal.rs:58`
- **Stays 12 u: map generation.** Changing these would change map identity.
  - `mapgen/certify/mod.rs:892`
  - `mapgen/certify/diagnostics.rs:423`
  - `mapgen/pipeline/mod.rs:659`
  - `mapgen/style_rime/routes.rs:105`
- **Stays 12 u: AI ranges.**
  - `combat_policy.rs:19`
  - `systems/bruiser.rs:28-29`
  - `systems/signatures.rs:332-333`
  - `systems/mob_ai.rs:327` (kiting clearance)
  - `rh-policy` `bots/reflex.rs:141`
  - `bots/paths.rs:139`, `:194`
  - `bots/hazards.rs:101`, `:115`, `:184`, `:188`
  - `bots/fight.rs:529`
  - `bots/kite/reflex_geometry.rs:35-36`
- **Tests that keep 12 u.**
  - `tests/kernel.rs:13-1000`
  - `tests/content.rs:987-1008`
  - `systems/tests.rs:534-625`
  - `systems/status/tests.rs:102`
  - `systems/planning/source_tests.rs:744`
  - `mapgen/spawns/tests.rs:277`
  - `rh-policy` `bots/mob_hunt_parity_tests.rs:16-238`

Every "stays" site is conservative for the new foot box because the foot box lies inside the disc. AI melee ranges stay
sufficient, because the box test is at least as generous as the disc test at those ranges.

### 8. Determinism (ADR0007)

- **Arithmetic.** Table values are integers stored as f64. The new code uses only `+ - * /`, comparisons, and the
  existing `math::atan2/cos/sin` (libm) in `arc_hits_box`. It needs no new transcendental functions, no FMA and no
  hash-ordered collections.
- **State hash.** It covers `FighterCore.archetype`, `ProjectileLaunch.height` and `SimConfig.hitboxes` (through the
  statics digest, `statics.rs:76`).
- **Versions.** `CHECKPOINT_FORMAT` goes from `rh-checkpoint/29` to `/30` (`checkpoint.rs:23`) and `REPLAY_FORMAT` from
  `rh-replay/23` to `/24` (`replay.rs:11`).
- **Proof of no change.** Legacy-mode perfproof fingerprints must be identical to the merge-base, within Ir 1.03x.

### 9. Protocol and versions

- **Snapshots.** One new byte per actor, plus self and projectile fields.
  - Actor: Full actor-mask bit 10 and Delta actor bit 12 carry `archetype u8` (default 0). An entity's archetype never
    changes, so a delta carries it only for new actors.
  - Self: Full head bit 20 and Delta head bit 24 carry `archetype u8`. The self is not in the actor list, and faction is
    chosen after the lobby Welcome.
  - Projectile: `WireProjectile` (`rh-protocol/src/state.rs:878`) gains `height u8`.
- **Table.** It goes on the wire, not through generated code: a trailer on Welcome after the map
  (`encode.rs:1617-1660`). The trailer is a count followed by rows of `id`, `key`, `hull`, `r` or (`fx fy bx by`),
  `ox oy` (i8) and `chest`, about 260 bytes. Unity then matches whichever server it joins, and the table is covered by
  the Welcome content hash it already checks. Rust also writes `protocol/fixtures/archetypes_v1.json` as a golden, both
  for the C# and JS tests and as offline data for Unity preview tools. Nothing is hand-copied.
- **Version numbers.**
  - `PROTOCOL_VERSION` goes from 14 to **16** (`rh-protocol/src/lib.rs:172`). The unmerged
    `claude/peaceful-babbage-rtsgq6` (`1f7c5460`, "Rust side at protocol 15") already sets 15 and commits
    `protocol/fixtures/v15.json`. Reusing 15 would give two incompatible wires one number. Rule: numbers rise in merge
    order. If netcode merges first, it keeps 15. If this merges first, netcode rebases to 17 and regenerates its
    fixtures, which it must do anyway because the actor layout changed.
  - `OBSERVATION_VERSION` goes from 21 to 22 (`observe.rs:20`; `ActorView.archetype` at `:73`, `SelfView.archetype`,
    `ProjectileView.height` at `projectile_view.rs:12`).
  - `POLICY_CONTRACT_VERSION` goes from 15 to 16 (`rh-policy/src/lib.rs:37`; v15 binds accepted decoded public frames,
    and `rh-policy/src/delivery/frame.rs` decodes `WireProjectile`).
  - Checkpoint goes to 30 and replay to 24 (Decision 8). Content hash: new.
- **Regenerated or new fixtures.**
  - New `protocol/fixtures/v16.json` (`cargo run -p rh-protocol --bin protocol-fixtures`). `v14.json` stays as history.
  - New `protocol/fixtures/archetypes_v1.json`.
  - Decoders: Rust, C# (`client-unity/RoguehallaNet/Protocol/Codec.cs`, then `client-unity/sync-net.sh`) and JS
    (`tools/protocol-js/check-vectors.mjs`, `crates/rh-server/web/probe.html`) must all pass `v16.json`.
- **C-OBS.** The archetype id is derived from facts that are already public: kind, kit faction and mob type. Projectile
  height is a property of a visible projectile, and Unity draws it. As amended by change 16 (owner-approved 2026-11-10),
  every player look flies at one height (30), so the height of a projectile whose owner is redacted reveals only "a
  player-look shooter" versus a mob look, never a player's faction. To be recorded in C-OBS in exactly those words.

### 10. Prediction

- **`Pathfinder.cs`.** Mirror `Footprint` with `CircleClear`/`BoxClear`, `SegmentRaysClear`/`SegmentBoxClear` and
  `ClampClear` by axis. `FindPath` takes the footprint.
- **`LocalMotion.cs:475`.** Plan with the own archetype's foot from the Welcome table. With no table, or `legacy_circle`,
  use `Disc(12)`.
- **Vectors.**
  - `protocol/fixtures/pathfinding_v1.json` and `server_walk_v1.json` stay byte-identical as the Disc(12) oracle.
  - Add `pathfinding_v2.json` (`rh-pathfinding-golden/2`: the same blob and 300 queries plus `footprint`, with waypoints
    for Box(10, 6)) and `server_walk_v2.json` (`rh-server-walk/2`: three corner walks in `Archetypes` mode, hero).
  - A committed generator bin in rh-parity (with `--check`) replaces the throwaway crate the v1 note mentions.
  - `crates/rh-parity/tests/pnet1_goldens.rs` keeps v1 (its `RADIUS = 12`, `:34`). A sibling `pnet2_goldens.rs` checks
    v2. The C# tests in `client-unity/RoguehallaNet.Tests/` check both.
- The unpredicted ice walk is unchanged.

### 11. Parity

- **All 123 `parity/fixtures/*.json` are unchanged and still MATCH**, including `pathfinding_seed1.json`. The reason:
  `rh_parity` builds its config with `..Default::default()` (`crates/rh-parity/src/lib.rs:635-658`), and the default is
  `LegacyCircle`.
- `tools/*-fixtures` captures are untouched, and so are bot goldens (legacy mode, bot constants unchanged).
- **`parity-report` changes.**
  - It prints `hitboxes: legacy_circle` in its header.
  - A new test, `every_compared_scenario_runs_legacy_circle`, fails if a compared run used another mode.
  - A separate section reports the Rust-native archetype goldens (`crates/rh-sim/tests/hitbox_archetypes.rs`):
    directional melee, N/S/E/W bow and wand duels, a front body shielding a rear one, and wall-adjacent shots. The
    section is labelled "ADR0024 deviation, not legacy parity".
- **`docs/DEVIATIONS.md`.** Two balance rows, hitboxes and projectile height, each with the filter
  "parity runs `config.hitboxes = LegacyCircle`".

### 12. Lag compensation

Boxes are rigid translations of whatever feet position a test already uses. The archetype is constant, so no history is
needed.

- **Melee.** Rewound bodies (`melee.rs:57-111`), including the shared-rewind fast path, stay as they are.
- **Projectiles.** The sub-step `position_at(t)` (`projectiles.rs:291`) is unchanged.
- **`meet_balls`.** It uses the attacker's current position (`:538`), unchanged.
- **The netcode branch.** Its `lag_fairness` tick-start melee origin and back-dated `catch_up` flights reuse
  `advance`/`first_body`, so they compose with no extra work. The merge conflicts are textual: `melee.rs:83-86`, the
  `projectiles.rs` spawn, the `SimConfig` fields, `observe.rs` and `projectile_view.rs`.

## Consequences

- **Melee reach grows.** For hero against hero, east-west reach goes from `reach + 12` to `reach + 16`, and north-south
  from `reach + 12` to `reach + 35`.
- **Arrow targets grow.** An east-west arrow's vertical target window goes from 38 u to 84 u, and a north-south arrow's
  horizontal window from 38 u to 46 u. Ranged hits rise sharply, and bots dodge by today's 12 u geometry.
- **Faction now sets hitbox size.** Plague and Holy players (mages, 53-55 u tall) are smaller targets than
  Fire/Sentenced/Frost (65-68 u).
- **Walls.** Feet reach 6 u from north and south walls and 10 u from east and west walls (12 today).
- **Asymmetries between unequal archetypes are accepted.** Projectile reach north versus south differs by
  `2(c_t - c_s)`, which is visually honest. A shot whose ground path a 1-tile wall stops can still touch a box whose
  feet stand within about `c + b - 32` u north of that wall, at most about 10 u (skeleton target).
- These are deviations validated by P-HB-9's harness before the live switch, not parity bugs.

## Implementation plan

Packets marked **[cheap]** are safe for a cheaper model given this ADR. Packets marked **[careful]** need an Opus-class
implementer and independent review. Verification commands assume `export PATH="$HOME/.cargo/bin:$HOME/.dotnet:$PATH"`.

| Packet | Scope | Depends on | Verify |
|---|---|---|---|
| **P-HB-0 [cheap]** measurement | `tools/hitbox-measure/measure.mjs` reads `receipt.json` and the Catalog `WorldHeight` values and prints the Decision 2 table under the stated rule; `--check` compares it with `archetype.rs` | none | `node tools/hitbox-measure/measure.mjs --check` |
| **P-HB-1 [careful]** data model | `archetype.rs`, `HitboxMode`, `FighterCore.archetype` at every constructor, `ProjectileLaunch.height`, content fold, restore refusals, checkpoint 30, replay 24, `hash_coverage` | 0 | `cargo test -p rh-sim`; `cargo run -p rh-parity --bin parity-report` (all MATCH); perfproof legacy fingerprints identical |
| **P-HB-2 [cheap]** geometry kernels | `Footprint`, `box_clear`, `segment_box_clear`, `arc_hits_box`, `segment_box_entry` plus property tests against dense sampling (seeded `rh_sim::rng`); no callers | none (parallel with 1) | `cargo test -p rh-sim geometry` |
| **P-HB-3 [careful]** foot box | Decision 3 call sites, `walk.rs` box sweep, `Disc` paths bit-identical (`tests/kernel.rs` equivalence extended to boxes) | 1, 2 | `cargo test -p rh-sim`; `cargo test -p rh-parity --test pnet1_goldens`; parity-report |
| **P-HB-4 [careful]** melee | `melee.rs:112` dispatch, height rule per owner ruling | 1, 2 | `cargo test -p rh-sim`; parity-report; new `hitbox_archetypes.rs` melee cases |
| **P-HB-5 [careful]** projectiles | Decision 4 in `projectiles.rs` (spawn height, body test, homing, ball/arrow, reflect) | 1, 2 | as P-HB-4, plus projectile cases |
| **P-HB-6 [careful]** wire | observation 22, actor/self/projectile fields, Welcome table, server mapping, policy 16, `v16.json`, `archetypes_v1.json`, C#/JS decoders, `sync-net.sh` | 1 | `cargo test -p rh-protocol -p rh-server -p rh-policy`; `cargo run -p rh-protocol --bin protocol-fixtures`; `dotnet test client-unity/RoguehallaNet.Tests`; `node tools/protocol-js/check-vectors.mjs`; `node tools/browser-proof/proof.mjs` |
| **P-HB-7 [careful]** prediction | C# `Footprint`, `LocalMotion` own foot, v2 generator bin, `pnet2_goldens.rs` | 3, 6 | `cargo test -p rh-parity --test pnet1_goldens --test pnet2_goldens`; `dotnet test client-unity/RoguehallaNet.Tests` |
| **P-HB-8 [cheap]** Unity presentation | chest aim (`MatchClient.cs:319`), projectiles drawn at `WorldPoint(x, y - h)`, sprite from archetype `key` (delete `MobLooks`), debug box overlay toggle | 6 | `dotnet test ...`; Unity batch build (`client-unity/UnityProject/Tools/build-web.sh`) plus screenshot with overlay |
| **P-HB-9 [careful]** live switch | `runtime.rs` sets `Archetypes`; `rh-headless --hitboxes`; balance harness in both modes; bot hit-rate check (Decision 6); parity-report label and guard test; DEVIATIONS rows proposed to owner | 3-8 | parity-report; headless balance runs in both modes; owner playtest |
| **P-HB-10 [cheap]** records | proposed CONTRACTS (C-NET, C-OBS, C-PARITY note), MIGRATION and DEVIATIONS edits handed to the coordinator | 9 | doc review |

Order: 0 and 2 can run with 1. Then 3, 4 and 5 (disjoint files). Then 6. Then 7 and 8 in parallel. Then 9 and 10.

## Risks and open questions (recommended answers)

1. **Melee height rule** (finding 4). Recommendation: the target's chest. It meets the stated purpose for every pair and
   equals the literal rule for same-look fights. Needs the owner's yes.
2. **Balance shock** (Consequences). Recommendation: ship the measured table unchanged as the direction requires,
   gather the P-HB-9 harness verdict and an owner playtest before the live default flips, and keep the table as one data
   edit for retuning. No global scale knob.
3. **Faction-dependent player boxes.** Recommendation: keep them (one archetype per look). Report the hit-rate
   difference in P-HB-9.
4. **Protocol number clash.** Recommendation: 16, reserved in the state file now. Netcode renumbers if it merges second.
5. **Headless default.** Recommendation: `SimConfig::default()` stays `LegacyCircle`, so every existing test and golden
   holds. The live server and the balance harness opt in. Revisit after P-HB-9.
6. **Bot misses.** Recommendation: measure first. The predicted case is narrow (Decision 6), and the fix is the chest
   correction only.
7. **Projectile height as an observable.** Recommendation: allow it as a visible attribute of a visible projectile and
   record it in C-OBS.
8. **Reflected arrow height.** Recommendation: keep the incoming height. The alternative, the holder's chest, makes the
   drawn arrow jump.
9. **Thin-wall touch** (Consequences). Recommendation: accept it and pin it with a test. Reconsider only if playtests
   notice it.
10. **Rounded corners.** The grown box over-reaches a true rounded box by at most `slack * (sqrt(2) - 1)` (2.9 u for
    arrows) at the corners. Recommendation: accept it; it keeps the test sqrt-free.

## Changes during implementation

Recorded by the implementer of P-HB-0 to P-HB-6 and the P-HB-9 flags (branch `rework/hitbox`). Each is the smallest
sound choice where the code disagreed with the text above.

1. **Protocol number 16** (coordinator ruling), not 15.
2. **Melee height: the target's chest** (coordinator ruling, Decision 5 now states it). It replaces the owner direction's
   "attacker's chest" and is flagged for the owner; the fallback is one line in `systems/melee.rs`.
3. **Archetype `key` is the Unity catalog appearance key verbatim** (`hero-female`, `mob-goblin-elite`, ...). The table in
   Decision 2 writes underscored names; Unity looks sprites up by the catalog key, so the key must match it. Row 0 keeps
   `legacy_circle` (no art).
4. **Rounding rule made exact (P-HB-0).** "Rounded with top + below even" is: round both to whole units; when the sum is
   odd, lower `below` by one. This reproduces all 12 boxed rows (`tools/hitbox-measure/measure.mjs --check`).
5. **Wire bit numbers moved.** The text predates bits that are now taken: Full head bit 20 is owner combat and Delta head
   bit 24 is owner combat, Delta actor bit 12 is barrier. The archetype uses **Full head bit 21, Delta head bit 25, Full
   actor bit 10, Delta actor bit 13**. Projectile rows append `height u8` after the owner.
6. **The Welcome table sits between the header and the map, not after it.** `MapBlob::read` requires the map to end the
   frame (a trailer is `Trailing`). Layout: `count u8`, rows `id u8, key str, hull u8, r u8 | fx fy bx by u8 ox oy i8,
   chest u8` (at most 32 rows, keys at most 24 printable ASCII bytes). A Welcome built with no table carries one zero byte.
7. **`Pathfinder::find_path(_into)` take `impl Into<Footprint>`** (`f64` converts to `Footprint::Disc`), so every existing
   radius caller compiles unchanged and the disc path is the same evaluation. Movers use `plan_foot_path_into` with their
   own foot; `plan_path(_into)` stay the 12 u disc (training placement reachability).
8. **`Mob::born`, `Mob::zombie` and `Player::joining` take the `HitboxMode`** and call `archetype::assign`; restore
   recomputes and compares (players in `check_world`, mobs and givers through the existing "expected birth" comparisons).
9. **The scene-candidate experiment** (`rh_protocol::scene_candidate`, C# `SceneCandidate`) was pinned to protocol 14; its
   guard now accepts 14 or 16. Its committed fixtures (`protocol/fixtures/scene-candidate/*14.json`) are unchanged
   because its synthetic scenes carry no archetype, height or Welcome.
10. **The policy delivery context checks the current protocol** (`FrameContext14.protocol == PROTOCOL_VERSION`) instead of
    the literal 14; the `*14` type names are kept.
11. **The native ability hash tape** (`parity/abilities/hash-tape.json`, a rebindable native regression tape, not a
    legacy capture) is re-recorded: P-HB-1 changes the World layout (`FighterCore.archetype`, `ProjectileLaunch.height`,
    `SimConfig.hitboxes` in the statics digest), `contentHash` and the checkpoint tag; P-HB-6 changes
    `observationVersion`. Every tick count is unchanged, and after P-HB-1 no fold changes again (P-HB-3 to P-HB-6 leave
    every legacy state hash of the 63 cases identical).
12. **Live default (superseded by 13).** The implementation first defaulted `--runtime source-arena|training` to
    `Archetypes`; the review reverted that (finding 1).

Review fixes (independent review of P-HB-0..9, branch `rework/hitbox`, 2026-11-10). Items 14, 15 and 16 are
**owner-approved (2026-11-10)**, not coordinator rulings.

13. **Live default stays `LegacyCircle` (finding 1); one constant flips it.** The Unity client still predicts with the
    12 u disc and aims from the feet. `rh_server::runtime::LIVE_DEFAULT_HITBOXES` (today `LegacyCircle`) is the default of
    the live profiles: `--runtime source-arena`, `--runtime training` and `--first-playable`. The bare core binary (no
    `--runtime`, or `--runtime core`) is a development profile and stays `LegacyCircle`. `--hitboxes legacy|archetypes`
    overrides on every path, and it is no longer silently ignored on the core path (finding 9:
    `runtime::core_hitboxes`; a bad value is a startup error). The test `which_runtimes_default_to_which_hitbox_mode`
    pins the mapping, so the flip is a deliberate change of the constant and that test. The owner signed DEVIATIONS rule
    3's escape valve for DEV-009/DEV-010 (2026-11-10): the flip may happen once client prediction and chest aim are
    verified, without waiting for a balance-harness verdict.
14. **Melee: an origin inside the target's box uses the legacy arc (finding 2, owner-approved).** `arc_hits_box` step
    (1) made a facing-independent zone of about +-16 x +-35 u around the target's feet: a swing aimed south hit a target
    20 to 34 u north. `systems::melee::reaches` now resolves a target with the legacy `in_arc(origin, a, reach,
    half_arc, feet, PLAYER_RADIUS)` (ground to ground) when the raised origin `origin + (0, oy_t)` lies inside the
    target's body box, and with `arc_hits_box` otherwise. So the unconditional zone is legacy's 12 u disc and facing
    decides beyond it. No flip for a target squarely in front: inside the box the feet are at most 44 u away (skeleton)
    and the shortest legacy reach is fists 72 + 12. Reach north versus south stays even (`reach + by_t` straight out
    both ways; tested by a 0.5 u sweep across the 35 u boundary). Residual, stated plainly: for a target BESIDE the
    attacker (90 degrees off the aim) the verdict can change at the box edge, because the box test outside is wider than
    the 12 u disc inside: hero vs hero, sword aimed east, a target 34 u north misses (legacy, inside) and one 36 u north
    hits (the -45 degree boundary ray crosses the box corner). `arc_hits_box` keeps step (1) as the geometric answer.
15. **Projectiles: a raised start inside a target's box uses the legacy ground contact (finding 3, owner-approved).** The
    box rule's start-inside branch hit a target at (+1, +30) and missed one at (-1, +30) when firing east. In
    `first_body`, when the raised stretch start lies inside a target's grown body box, that target is resolved with the
    legacy swept ground contact (`contact(ground stretch, feet, 12 + slack)`); otherwise the raised segment against the
    grown box. The test is per stretch, so a launch, a reflected arrow (spawned at the contact point) and a homing flight
    all use it. Fired sideways from behind a target's upper body it misses on both sides; fired toward a target that
    overlaps the shooter it hits within the legacy reach. Residual: along the flight direction the verdict for a target
    offset 20-42 u vertically changes once, at the grown box's forward edge (bx + slack, 23 u for a hero target by
    arrow): nearer it misses (inside, legacy), beyond it hits (the flight enters the box). A body that walks onto a
    flight between sub-steps is also resolved by the legacy contact for that stretch.
16. **One projectile height for every player look (finding 8, owner-approved, C-OBS).** Measured chests made a
    projectile's height name the shooter's faction look (30, 25, 33, 27, 35). `archetype::PLAYER_CHEST = 30` (the hero's
    centre, inside every player look's box) is the `chest` of every look a player can have (hero, hero-female, mage,
    mage-female, knight; `player(..)` rows); mob-only looks keep their measured centre (`boxes(..)` rows). Body and foot
    boxes stay per look: the body offset is the measured centre, decoupled from `chest`, and melee and homing use the
    body centre. A reflected arrow takes the reflector's height (the reflector becomes its owner). What a projectile's
    height reveals now: "a player-look shooter (a player, or a mob drawn with a player look: Zealot, Archon, Acolyte,
    MiasmaWitch, BloodSaint, or a quest giver / dummy)" versus "one of the mob looks goblin 19, skeleton 31, goblin-elite
    16, antlion 11, skeleton-archer 21, skeleton-mage 21, zombie 21", which a visible projectile's kind and the visible
    mobs already make evident. It never names a player's faction. `tools/hitbox-measure/measure.mjs --check` states the
    rule (the player chest is a constant, not measured).

| id | key | body half (bx, by) | body centre (-oy) | chest (projectile height) |
|---|---|---|---|---|
| 1 | hero | 16, 35 | 30 | 30 |
| 2 | hero-female | 15, 35 | 33 | 30 |
| 3 | mage | 17, 28 | 25 | 30 |
| 4 | mage-female | 17, 28 | 27 | 30 |
| 5 | knight | 18, 37 | 35 | 30 |
| 6-12 | mob looks | as Decision 2 | as Decision 2 | = centre (19, 31, 16, 11, 21, 21, 21) |

17. **Restore checks projectile height against the mode (finding 4).** `archetype::valid_height`: exactly +0 under
    `LegacyCircle`, one of the table's boxed `chest` values under `Archetypes`; anything else is refused.
18. **Non-finite geometry input never touches (finding 5).** `segment_box_entry` returns `None` and `arc_hits_box`
    misses for any non-finite input, as the legacy `contact`/`in_arc` do for NaN.
19. **Wire vectors (finding 6).** `v16.json` gains the chain `self_archetype_delta` (delta head bit 25 set on a change,
    not resent) and malformed vectors `welcome_archetype_count`, `_key_long`, `_key_ascii`, `_truncated` and
    `delta_head_archetype_without_present_bit`.
20. **Welcome vision block (coordinator addition to protocol 16, which had not shipped).** The Unity fog of war mirrors
    the Rust sight rule; it now receives the rule's parameters instead of keeping a copy. Layout, after the archetype
    table and before the map (the map reader refuses trailing bytes): `version u8` (vision-rules version, 1), `tile f64`,
    `radius f64`, `trail_ms f64`, `update_ms f64`, `sight_mask u8` (tile-class bits that block sight), `coliseum u8`
    (0 absent, 1 present), then `x u16, y u16, w u16, h u16` (tiles; the exact rectangle `rh_sim::vision` reveals). All
    three decoders refuse a zero version, non-finite or out-of-range numbers (tile 0 < t <= 1024, radius 0 < r <= 1e6,
    trail 0 <= t <= 1e9, update 0 < u <= 1e6), a zero mask, a flag above 1, an empty rectangle or one outside the map.
    **C-OBS: none.** Every value is a build constant or public map metadata already on the wire.
21. **Parity report (finding 7, Decision 11).** `rh_parity::HITBOXES` is set explicitly; `parity-report` prints
    `hitboxes: legacy_circle` and a separate section for the Rust-native goldens; `every_compared_scenario_runs_legacy_circle`
    guards the config and every built fighter.
22. **Bot and mob aim (Decision 6, finding 10): unchanged, by measurement.** `rh-headless --example hitbox_compare` (40
    full-map bot matches per mode, same seeds) attributes every ranged shot to the hostile nearest its bearing at launch
    and reports hit rates per shooter look and target look. No pair with 30 or more shots in both modes misses
    measurably more in archetype mode for a geometric reason; overall bots' bows 0.541 -> 0.600, mobs' bows 0.837 ->
    0.924, mobs' wands 0.336 -> 0.488. With every player at chest 30, the predicted miss (a 33 u flight over an
    antlion's 29 + 2 u ball box) no longer exists. So no chest correction is applied (DEVIATIONS DEV-010 has the
    numbers). The run did find a rule bug: a homing ball whose raised start lies inside its own target's box orbited
    under the legacy fallback of change 15 (61 bot wand flights ended at range); its own target is now a hit at u = 0.
    The soaks (`tests/source_arena_soak.rs`, seeds 6, 17, 28, 42, 62) run in both modes.

## Addendum: Mob spacing (owner direction 2026-11-10; revised after review 2026-11-10)

Owner: "mobs tend to bunch up and stack on top of each other, give them some hit box room." Standing decisions kept: no
body blocking between characters (players walk through each other and through mobs); bot and mob decision-making,
target choice, aggro, timing and abilities unchanged; melee, projectiles and range checks unchanged.

**Legacy.** `packages/server/src/sim/mobAI.ts` has no separation: a fighting mob moves to its target's position until
its policy says stop, so a pack that arrives by one path stops on one spot. Spacing is a new behaviour, live mode only
(DEVIATIONS DEV-011).

**Switch.** Spacing is on when `SimConfig::hitboxes = Archetypes` and `SimConfig::mob_spacing = Auto` (the default;
`rh_sim::archetype::mob_spacing`); under `LegacyCircle` no spacing code runs. `MobSpacing::Off` is the measurement-only
A/B (`rh-headless --example hitbox_compare ... spacing`): `Auto` serializes as `null` and adds nothing to the statics
digest (every hash and pin from before the field is unchanged), `Off` is the string `"off"` and is folded into the
digest, so into the state hash, every checkpoint and every replay; `rh_server::wire::profile_supported` refuses to host
it. No cargo feature changes spacing (`--all-features` builds behave like normal builds).

**Room.** Each mob claims a personal-space disc of its foot box's larger half-extent plus `MOB_SPACING_MARGIN` (10 + 10 =
20 u with today's shared 10 x 6 foot box), so two mobs want 40 u centre to centre. A look with a bigger foot box gets
more room automatically; elites share their type's look and foot box today, so they get the same room. Movers and
neighbours: alive regional and practice mobs with a brain. Excluded: players (no body blocking), Plague zombies (owner
companions with their own AI), training dummies and quest givers (no fight brain).

**Standing still (the policy said `Stop`).** Mobs think one after another (store order) and read a neighbour index
built once per `mobAI.thinkMobs` call, in which a mob walking a spacing step stands where that step ends; a mob that
orders a step moves its own entry there, so later mobs see where it is going. A step is ordered only when it lowers the
mob's share of the pack's energy (the sum over pairs of the squared depth to which two rooms overlap) by at least
`MOB_SPACING_STEP_MIN`^2: a coordinate descent. The energy cannot go below zero, so after the last outside change (a
chase, an arrival, a death, a step that ends elsewhere than ordered) a pack of any size orders at most (energy /
`STEP_MIN`^2) more steps and comes to rest; a mob with no room left keeps its overlap quietly (no deadlock). The squares
make evening out the gaps along a chain of mobs pay, so a crowd spreads round its target instead of staying piled on the
side it came from. Candidates: the push (the sum over neighbours inside the room of the overlap along the line between
the two, capped at `MOB_SPACING_STEP_MAX` = 16 u), its half, and the push turned by +-90, +-45 and +-135 degrees (a mob
squeezed between two others on a line gains nothing along it). Each candidate is pulled back into the policy's stop band
round the target (melee `[0, far - MOB_SPACING_BAND_SLACK]`, ranged `[retreat + slack, far - slack]`) and capped at
`MOB_SPACING_STEP_MAX` again, so no step is longer than 16 u; the lowest-energy candidate that gains enough and passes
the mob's own foot-box segment test (the pathfinder's direct-path test), the leash with the retreat's margin and line
of sight to the target with the policy's mask is ordered as one `Move` (validate + `Cx::submit`, C-INPUT). A mob inside
its band's `lo` (its policy wanted a retreat it could not find) gets no step: spacing never carries out a retreat. Two
mobs on the very same point split left and right of the line to the target by id. Cost and churn bounds: a mob walking
a spacing step gets no new order until it arrives (one `Move`, one path search per step); a mob that cannot move this
tick (rooted, casting, winding a swing; a stunned mob does not think at all) gets none; a mob looks for a step on one
tick in `MOB_SPACING_LOOK_TICKS` = 4, staggered by id. The step does not use the chase's `send`: the repath clock and
chase goal are untouched.

**Chasing (the policy said `Move::Point` and it is a chase, not a retreat).** The chase order's goal is shifted
sideways (across the line from the mob to the goal) away from the pack-mates inside the mob's room: by the whole
overlap, summed (ahead/behind or coincident: lower id left, higher id right), capped at 16 u, then scaled by the
distance to the goal over two rooms, so the heading turns by at most atan(16/40) = 22 degrees and the shift shrinks to
nothing as the mob closes in (a melee mob entering its band at about 95 u is shifted at most 38 u: it still walks into
its band and stops; no circling). The shifted goal must clear the mob's foot box, be reachable from the plain goal in a
straight line with that foot box (same side of every wall and corner), see the target with the policy's mask and lie
inside the leash; otherwise the plain goal (a doorway or corridor: overlap where there is no room). It goes through the
same `send` on the same repath clock: no extra orders and no extra path searches. Retreats are never shifted.

**Where in the tick.** Inside the existing `mobAI.thinkMobs` row; no new schedule row, the tick order is untouched. The
index lives in `TickScratch::mob_spacing` (cells of `MOB_SPACING_CELL` = 64 u, at least two rooms plus one step, so a
query reads 3 x 3 cells; no per-tick allocation once the buffer has grown). Orders apply next tick through the inputs
phase and are walked by `movement.walk` like any other move.

**Determinism (ADR0007).** Fixed iteration order (store order for thinking, (cell, id) in the index), no RNG,
`crate::math` only; the index and the steps are derived from the world each call and never stored, so the state hash,
checkpoint and replay formats are unchanged (the `Off` switch aside). Six constants are registered in the content
registry; with `MOB_SPACING_LOOK_TICKS` the content hash is `06e2cdab2889abc5` (was `e1e44438b219196f`; before spacing
`026f083d8473fa4b`).

**What the tests prove** (`crates/rh-sim/src/systems/mob_spacing.rs` unit tests and `mob_spacing_tests.rs`; axe
`emberImp` practice mobs woken on one stationary player unless said otherwise; every pack test asserts at every tick that
every foot box is clear of walls):
* Rest: packs of 20, 30, 40 and 200 on open floor order zero `Move`s, walk 0 u and run zero path searches over ticks
  800-1000, and every mob of each pack lands hits; measured, the last spacing step falls on tick 171-175 and at most 43
  steps fall in one tick (200 mobs). "Comes to rest" means exactly that: no order and no movement over that window.
* Spread: eight mobs end inside the stop band with every pair at least 34 u apart (85 % of 40), over more than a quarter
  circle, all hitting; six wand mobs stay inside `[retreat, far]` with room; a pack of 12 with four elites, and packs of
  12 on an ice patch and in a bog (the seed1 map with a 20 x 20 tile terrain patch, hazards on) spread to 34 u, all hit,
  and order no step over their last 100 ticks.
* Held crowds: twelve mobs born overlapping and rooted (or stunned, Frost's Freeze) order no step and run no path search
  while held, then spread to 34 u and rest.
* Chasing: ten mobs chasing a player who walks a loop inside their leash for 60 s: ticks with two mobs under 8 u fall
  from 1.00 to 0.55 overall and from 0.97 to 0.41 among ticks with two or more mobs walking a chase path (spacing off
  vs on, same run); every mob still hits, first hits on ticks 51-54 instead of 48-49; a pack chasing through a one-tile
  doorway and up a one-tile corridor to its dead end: every mob hits at the far end, first hits within 2 ticks of
  spacing off, and path searches stay within the plain run's plus one per spacing step.
* Corridor dead end and doorway with a stationary target: no deadlock, the pack hits, then rests (0 u over 3 s).
* Unit: the step never exceeds 16 u after the band clamp, never moves a mob inside `band.lo`, needs no index entry of the
  mob's own, sidesteps a squeeze on a line, orders nothing that does not lower the energy, and the index stays sorted
  when an entry moves.
* Identity: `Off` is in the digest and survives a checkpoint, `Auto` adds nothing to it, a config without the field
  reads as `Auto`, every build (any features) spaces an archetype match, the server refuses `Off`; the same run twice and
  a checkpoint restored mid-run give the same hash every tick; the legacy-circle pack run's state-hash fold equals the
  value pinned with the spacing code removed. The parity report is unchanged (109 slice scenarios + 13 capture-only, 300
  pathfinding queries: all MATCH).

Not proven: a pack in a pocket of a crowd may keep some overlap where a better arrangement exists farther round the
ring (the descent is local); stacking among mobs hugging a moving player is reduced, not removed.

**Measured** (`rh-headless --example hitbox_compare <map> <from> <to> 12000 archetypes-nospacing` and `... archetypes`,
release, live source-arena config, 8 HumanBot seats, PvE, the same seeds; HEAD 4340e37e). Over every tick and every
engaged mob with another mob within 120 u: mean nearest-mob distance and the share under 20 u (foot boxes overlap);
"stacked engaged" is the share of ticks with two engaged mobs within 8 u among ticks with two or more engaged; "stacked
chasing" the same among mobs walking a chase path. Spacing steps and path searches (every A* search, players' too) are
per tick.

| run | mean nearest | overlap share | stacked engaged | stacked chasing | player deaths | mob deaths | hits | mean match (ticks) | mob melee landed (sword / axe / fists) | mob ranged (bow / wand) | spacing steps / tick (mean, max) | path searches / tick (mean, max) |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| seed1 map, seeds 1-40, off | 50.7 | 0.186 | 0.153 | 0.039 | 270 | 758 | 43896 | 4326 | 1.000 / 0.999 / 0.107 | 0.924 / 0.488 | 0, 0 | 0.014, 5 |
| seed1 map, seeds 1-40, on | 55.0 | 0.072 | 0.046 | 0.029 | 267 | 806 | 44239 | 4164 | 1.000 / 1.000 / 0.106 | 0.922 / 0.487 | 0.008, 2 | 0.015, 5 |
| first-playable, seeds 0-62, off | 62.7 | 0.101 | 0.002 | 0.003 | 397 | 102 | 26421 | 7119 | 1.000 / 0.988 / 0.331 | 0.974 / 0.681 | 0, 0 | 0.002, 2 |
| first-playable, seeds 0-62, on | 64.4 | 0.053 | 0.001 | 0.003 | 396 | 97 | 26423 | 7199 | 1.000 / 0.987 / 0.303 | 0.974 / 0.674 | 0.000, 1 | 0.001, 2 |

Both "off" rows reproduce the spacing-off rows measured before the review exactly (the runtime switch is the same A/B
as the old build feature). On the mob-dense seed1 map stacked-engaged ticks fall 0.153 -> 0.046 and stacked-chasing ticks 0.039 -> 0.029; player deaths 270 -> 267, mob deaths 758 -> 806 (+6 %), mean match 4326 -> 4164 ticks: within what a changed trajectory gives on 40 matches, not a balance verdict. Minimum nearest distance is still about 0 in both modes (mobs squeezed where no step is clear, a mob passing another). Every match ended or reached the tick cap: no panic, no hang. The soak seeds 6,
17, 28, 42 and 62 (`source_soak ... archetypes`) also ran clean; `tests/source_arena_soak.rs` runs them in archetype mode.

Cost (`spacing_tick_cost`, ignored test, release, 200 axe mobs on one player, a whole tick, best of three on a loaded
machine): standing (settled) 0.55 -> 0.62 ms, chasing a walking player 0.41 -> 0.50 ms (spacing off -> on).

## Addendum: Weapon shapes in the Welcome (coordinator addition to protocol 16, 2026-11-10)

The client draws a weapon hit-zone indicator (a translucent sector of the area a melee swing can hit). The swing's
origin and angle already travel in the `Swing` fx; the per-weapon shape did not, and the client must not keep a hand
copy. Protocol 16 has not shipped, so the Welcome grows once more, like the archetype table and the vision block.

**Layout.** Right after the vision block and before the map (the map reader refuses trailing bytes): `count u8` (at most
`MAX_WEAPONS` = 32, checked before allocating), then fixed 34-byte rows `id u8, kind u8, reach f64, half_arc f64,
speed f64, radius f64`, ids strictly ascending. `id` is `WeaponId::code()` (sword 0, bow 1, wand 2, shield 3, axe 4,
fists 5). `kind`: 0 no hit shape (all four values 0; reserved), 1 melee arc (`reach` sim units > 0, `0 < half_arc <= pi`
radians, speed and radius 0), 2 projectile (`reach` = maximum range > 0, `speed` sim units/s > 0, `half_arc` 0, `radius`
= the flight's body-contact radius: `ARROW_RADIUS` 7 for the bow's arrows, `RANGED_SLACK` 2 for the wand's balls).
Every value is finite and within 0..=1e6. Fixed-size rows keep the table append-friendly (a new kind is a new number).
Rust (`rh_protocol::weapon::table_fault`, encoder and decoder), C# and JS refuse anything else with `weapon count`,
`weapon kind`, `weapon` or `weapon order`, without panic or over-allocation. The server builds the rows from
`rh_sim::content::weapon(w).shape` (`rh_policy::delivery::projection::wire_weapons`), never by hand.

**Members.** Rust `ServerMsg::Welcome { weapons: Vec<WireWeapon> }`; C# `Protocol.WireWeapon { Id, Kind, Reach, HalfArc,
Speed, Radius }` (constants `KindNone`, `KindArc`, `KindProjectile`; `WireWeapon.Find(rows, id)`), `ServerMsg.Welcome.Weapons`
and `Session.Weapons` (empty before a Welcome); JS `m.weapons = [{id, kind, reach, halfArc, speed, radius}]`.

**What it covers.** The static shape of each weapon, which is all the sim uses: melee reads `weapon(w).shape` for every
swing (`melee.rs`), projectiles take speed and range from it at launch. No card, status or modifier changes a weapon's
reach, arc, range, speed or contact radius at runtime, so the table is exact, not a base value. Not covered: per-flight
state (a reflected flight keeps only its remaining range), wand splash, abilities with their own shapes, and the hit
test's margins: a melee target is hit when its BODY touches the sector (the body box under `Archetypes`, measured from
the attacker's feet raised by the target's body centre; the 12 u disc plus `ARC_EPS` under the legacy circle), and a
flight meets a body grown by `radius`. A sector drawn from `reach` and `half_arc` at the swing's origin is the nominal
arc the rule tests against; the client should not add margins of its own.

**C-OBS: none.** Every value is a public content constant (already folded into the content hash through `content.rs`);
the table is the same for every viewer and match. The content hash does not move.

# ADR0025: Lingering tracks, authoritative footprints that last 10 s

Status: **Proposed, design only.** Owner direction 2026-11-10: "lingering tracks that last 10 seconds behind the
character... should be built in Rust first; if this is a big undertaking just have them done in Unity first and only show
on client side (then we can add to Rust later)". The coordinator judged it big, so a presentation-only client version is
being built now (branch `rework/surface-fx`: `FootTracker.cs`, `SurfaceFxModel.cs`, prints only from actors the client is
shown, kept 10 s). This ADR designs the later server mechanic. Nothing is implemented. Line references are to
`feature/unity-rework` at `c7fc9587`.

**What changes for players, stated plainly.** Today a player learns only where visible actors are now. Under this ADR a
player can also learn where *some* character walked during the last 10 s on ground the player can see now, including
characters they never saw. That is new information on purpose. It is a new mechanic legacy does not have, so it is a
declared `docs/DEVIATIONS.md` **balance** row (ORDER_OF_OPERATIONS D1/D2), and it falls inside the D5 design freeze and the
D10 "Rust frozen except the hitbox change" rule. It needs an owner exception before any Rust packet starts.

**Per-operation checklist** (ORDER_OF_OPERATIONS section 3). Phase/item: not in the plan; owner direction 2026-11-10. D1:
every legacy parity scenario stays byte-exact under `TracksMode::Off`; the live mode is a ledger deviation. D2: no harness
can measure a human-only information aid (bots ignore tracks, Decision 8), so the row needs the owner's "accepted as risk"
or a playtest verdict. D5/D10: owner exception required. D9: nothing is predicted; Unity draws what is delivered. Shared
records (MIGRATION, CONTRACTS table, `Cargo.lock`) are left to the coordinator.

## Context

- **Vision is a per-tile trail.** A viewer sees a point when it is within `VISION_RADIUS = 900 u` on a clear line, when its
  tile is in the viewer's unexpired 30 s reveal trail, or when an owned ward sees it (`point_with`,
  `crates/rh-sim/src/vision.rs:357-370`; constants `constants.rs:73,85`). Only `MASK_SIGHT` tiles block
  (`scene_line_blocked`, `vision.rs:303-355`). A dead viewer sees nothing.
- **Actors add three exceptions** (`actor_with`, `vision.rs:373-395`): the Sentenced hunt target is seen through fog and
  bush, but "terrain and nearby actors stay hidden" (`:382-386`); a player with the `Hidden` effect bit is never shown to
  others (`:387-389`); a living actor on a bush tile is shown only to a viewer in the same bush or within
  `BUSH_REVEAL_RADIUS = 64 u` unless recently exposed (`bush_visible`, `:397-413`). Mobs use `point_visible` plus
  `status_runtime::hidden` (`observe.rs:803-817`).
- **Mob identity is not trackable by design.** NPC references are reissued whenever the visible cue set changes
  (`actor_refs.rs:222-240`), so a client cannot follow a mob by id. Projectiles are ID-free rows filtered by
  `point_visible` (`projectile_view.rs:55-91`).
- **Reliable State keys are complete replacements** (ADR0018; `rh-protocol/src/state.rs:6`, keys 1-11 at `:1661-1671`).
  The publisher sends a key only when it changed and forces full replacements at most every 20 ticks
  (`rh-policy/src/delivery/collections.rs:513-531`, `rh-protocol/src/delta.rs:32`). State frames carry the tick
  (`rh-protocol/src/lib.rs:763`).
- **Movement.** Base speed `PLAYER_SPEED = 170 u/s` (8.5 u per tick, `constants.rs:72`). Walking happens in
  `movement:walk` (`schedule.rs:1011`); forced moves (Blaze charge, travel-cannon blast) go through
  `systems/displace.rs`, which increments `motion.displace_seq` (`:49`). Blaze lands 64-300 u away
  (`abilities/blink.rs:5-6`).
- **The tick is data.** `PHASES` has 23 legacy rows ending with `projectiles:clearIfEnded` (`schedule.rs:959-1058`). A row
  the legacy record lacks cannot be added to a legacy table (ADR0009, `crates/rh-parity/tests/schedule.rs`).
- **Surfaces.** The server owns the public `terrain` and `region_grid` planes (`mapdata/model.rs:231-233`,
  `mapdata/mod.rs:113-133`; published by `rh-server/src/public_ground.rs:22-37`) and the bush feature grid. The client's
  `SurfaceMap` (`client-unity/.../View/Regions/SurfaceMap.cs:60-90`) adds decorative layers the server does not know
  (Holy temple floor, Plague grass and shallow water). The client-only version deliberately draws no dry print on stone,
  ice, lava, holy light or temple floor (`SurfaceFxModel.cs:30-50` on `rework/surface-fx`).
- **Versions today.** Protocol 16 (`rh-protocol/src/lib.rs:176`), observation 22 (`observe.rs:20`), policy 16
  (`rh-policy/src/lib.rs:38`), checkpoint `rh-checkpoint/30` (`checkpoint.rs:23`), replay `rh-replay/24`
  (`replay.rs:11`), vision rules 1 (`rh-protocol/src/vision.rs:15`). The unmerged netcode branch
  `claude/peaceful-babbage-rtsgq6` used 15 and must renumber after 16.

## Decision

### 1. What a track is

- **Sampling: by distance walked.** Each track-making player carries a walker anchor. At the end of every active tick the
  distance moved this tick, `hypot(dx, dy)` (`rh_sim::math`), is added to `walked`. When `walked >= TRACK_STRIDE`
  (36 u, about one tile and close to the client's 1.15 tiles) one print is laid at the current position and `walked -=
  TRACK_STRIDE` (the remainder is kept, clamped below one stride). At most one print per tick per walker, because no walk
  covers 36 u in 50 ms. Not per tile entered (prints would bunch at tile seams and say nothing about heading) and not per
  animation footfall (animation is client presentation).
- **A discontinuity lays nothing and resets the anchor**: a changed `displace_seq`, a one-tick move longer than
  `TRACK_JUMP = 48 u` (above any walk, below Blaze `MIN_DIST` 64), a status other than `Alive`, or the start of a run.
- **What a print stores** (`World`, server-private): `maker: PlayerId`, `laid: u32` (tick), `x: u16`, `y: u16` (eighths of a
  unit, the existing position code, `item_view::position`), `heading: u8` (direction of travel since the previous print,
  `round(atan2 / (TAU/256)) & 255`, not facing: a player aiming backwards still walks forward), `side: u8` (0 or 1,
  alternating per walker; the client offsets the foot sideways). No faction, look, size class or kind is stored, because
  only players make prints (Decision 2) and the wire carries none of it (Decision 4).
- **Lifetime** `TRACK_TTL_TICKS = 200` (10 s). A print with `tick - laid >= 200` is removed before the next is laid.
- **Representation: one world ring, not per-fighter rings.** `World.tracks: Tracks { prints: VecDeque<Print>, walkers:
  Vec<Walker> }`. `prints` is appended in (tick, player join order), so it is ordered by `laid` and expiry pops the front in
  O(expired); prints outlive a maker who dies or leaves. `walkers` holds `{ id, at: Option<Vec2>, walked: f64, seq: u8,
  side: u8 }` sorted by id, so `FighterCore` (shared with ~200 mobs) is untouched. Integer storage for prints keeps them
  exact and compact (12 bytes); the anchor stays f64 like every other position (ADR0007).
- **Cap** `MAX_PRINTS = 1024`, reserved at construction (no steady-state allocation, `tests/no_alloc.rs`). 12 players at
  base speed lay 12 x 4.7/s x 10 s = 567; 1024 covers everyone at 1.8x speed. When full, the oldest print is evicted first
  (deterministic) and a diagnostic counter rises; the soak asserts it stays 0 in live configs. The decoder is bounded like
  `VisionTrail` (`vision.rs:57-82`).
- All constants (`TRACK_STRIDE`, `TRACK_JUMP`, `TRACK_TTL_TICKS`, `MAX_PRINTS`, the ground table of Decision 3) go in
  `constants.rs` and fold into `content_hash` as a tagged definition `("tracks/1", ...)`, the ADR0024 pattern.

### 2. Who leaves tracks

| Mover | Prints | Why |
|---|---|---|
| Players, human or bot seats | yes, while `Alive` and walking | the owner's "the character"; bots are seats like humans (C-INPUT) |
| Mobs, Plague zombies, quest givers, dummies | **no** (v1) | ~200 fighters would swamp the cap and the wire; mob handles are deliberately untrackable (Context); open question 2 |
| Sprinting / speed buffs, ice sliding, bog | yes (more prints per second, same spacing) | continuous movement on the ground |
| Blaze Step, blinks, travel cannons, any `displace` | no print across the gap; anchor resets at landing | a dash is not a walk; also avoids drawing a line to the landing point |
| Knockback | follows its implementation: a `displace` call lays nothing; a path push lays prints | one rule, no special case |
| Standing still, turning on the spot | no | distance-based |
| A player with the `Hidden` effect bit | no, while hidden | a fresh print sits at the maker's live position; it must not undo concealment |
| Dead, downed, lobby, planning or ended phases | no | the native row runs only in `Phase::Active` (Decision 6) |

### 3. Where tracks can exist: a server-owned ground table

Decided: **surface-dependent, from data the server already owns and publishes**: `holds(region, terrain, bush)`.

| Ground | Holds prints |
|---|---|
| Fire (basalt, ash), Plague (mud), Frost (snow), Holy (sand) | yes |
| Sentenced (flagstone), Coliseum (limestone), no region | no |
| Terrain ember (4) | yes; lava 1, fence 2, crevasse 3, bog 5 (liquid), ice 6, light 7: no |
| Any bush feature tile | no (bushes conceal; a print there would expose the hider) |

Terrain applies only where the room's published `GroundMode` makes it active, the same way the client's `RegionMap`
reads it. A print is laid only if its tile holds prints; the walker's stride still advances, so spacing is unbroken
when the trail re-enters soft ground.

Reasons: it keeps the client's look decision (no clutter on stone, ice and light) and the regional identity (Sentenced
stone halls hide movement), and the client can compute the identical mask from planes it already receives. The
client-only decorations (temple floor inside Holy, Plague grass and shallow water) do not change existence: a print that
exists there must be drawn visibly with a fallback look (dusty print on temple floor, a lingering wet print in shallow
water). **Fairness rule: a delivered print is visible on every client and every quality setting.**

Alternatives: (a) surface-independent prints everywhere with client-chosen looks: simplest and most uniform, but forces
visible marks on stone and ice and removes a regional texture; kept as the fallback if the owner rejects the table. (b) A
new authored/generated surface plane in mapdata: the only way for decorative surfaces to matter, but it changes map
identity and every map fixture; deferred until decorative layers move to the server.

### 4. Visibility: when a print is delivered

- **Rule.** A print is in viewer V's observation iff V is `Alive`, the print's maker is not V, and
  `point_visible(map, V, print_point, tick, wards)` holds, the exact rule projectiles use (`projectile_view.rs:57`): direct
  sight within 900 u, or the print's tile in V's 30 s trail, or an owned ward. No bush, hunt or `Hidden` actor exception
  applies, because a print is ground, not an actor.
- **Why exactly this.** A print laid this tick sits on its maker's position. With the same point rule, a fresh print is
  delivered exactly when its maker would be, except for the three actor concealments, and those three cannot lay prints
  (bush tiles hold none, `Hidden` lays none) or already reveal the maker (the hunt). So tracks never expose an actor
  live; they expose only the past. A tile-centre rule or a shorter radius was rejected: it either delivers a fresh print
  where the maker is concealed by the exact-point line or creates a second fog the client cannot mirror.
- **Own prints are not delivered** (the viewer knows its own path; the client draws its own walk locally). **No ally
  distinction** and no identity: a row has position, heading, age and side only. Rows are sorted by value
  `(laid, x, y, heading, side)`, never by maker, serial or ring slot, and carry no global id, so the count and order of
  unseen prints never leak.
- **What a player newly learns:** that some player walked through visible ground within the last 10 s, where, which way,
  roughly when, and (from parallel trails) roughly how many. It never learns who, which faction, or anything about ground
  it cannot see. Information the trail already gave (an actor present on a revealed tile is delivered then) is unchanged;
  the gain is prints laid while their tile was unseen. That is the mechanic's purpose, so it is an intended public fact,
  not a leak.
- **Concealment interactions.** Bush: no prints inside; a trail that enters a bush stops at its edge (accepted: it shows
  someone went in up to 10 s ago). `Hidden`: no prints while hidden; prints laid before hiding remain. Sentenced hunt: the
  hunter sees no extra prints. Wards: a ward reveals prints in its sight like any point. Suppressing or erasing tracks
  (a card, a Swarm-like ability, rain) is **future design**, not proposed here; the wire reserves an early-remove form for
  it (Decision 5).
- **Proposed C-OBS wording:** "Tracks (ADR0025): an observation lists prints laid by other players in the last
  `TRACK_TTL_TICKS`, each delivered while its point is `point_visible` to the viewer. A print carries quantized position,
  travel heading, age and foot side only: no maker identity, faction, look or kind, no global id, sorted by value. Prints
  are never laid on bush tiles or by a player with the `Hidden` effect, so a print never reveals a concealed actor's
  current position. Revealing the recent passage of unseen players on visible ground is the intended public effect."

### 5. Wire: State key 12, an incremental collection

- **Observation.** `Observation.tracks: Vec<TrackView { x: u16, y: u16, heading: u8, age: u8, side: u8 }>`, the complete
  current set (policies and bots get exactly this). `OBSERVATION_VERSION` 22 -> 23.
- **Delivery.** Replacing the whole set whenever it changes would resend ~300 rows most ticks. Key 12 `Tracks` is therefore
  the **first incremental State key**: body `form u8` (0 delta, 1 replace), `adds: varint n, rows`, `removes: varint n,
  rows`. Row: `x u16, y u16, laid u16 (tick & 0xffff), heading u8, flags u8 (bit 0 side; other bits must be 0)` = 8 bytes.
  The publisher diffs the current set against the committed baseline by value with multiplicity (`collections.rs` already
  keeps per-key baselines and commits only after enqueue). **Age expiry is implicit on both sides** (a row with
  `state_tick - laid >= 200` is dropped by server baseline and client alike), so `removes` carries only prints that left
  sight before expiring (a 30 s trail tile lapsing) and, later, erasures. Initial, resumed and forced-resync clients get
  `form = 1` with the whole set, which is the ADR0018 replacement rule; a missing key 12 means no change.
- **Handles: none.** Prints are immutable values, identified by value like projectiles. No handle space to exhaust, renew
  or leak. ADR0018 is amended for key 12 only.
- **Bounds.** At most `MAX_PRINTS` rows in `adds` and in `removes`; decoders refuse a replace with removes, a delta that
  removes an absent row, a row whose reconstructed age is >= 200 against the frame tick, non-zero reserved flag bits or a
  position outside the map. Nothing is dropped under the bound: the sim cap (oldest evicted) bounds the set, and an
  over-size view is an `OfferError` like `TooManyProjectiles` (`projectile_view.rs:60-62`).
- **Bytes.** Busy match, a viewer near 6 walking players: 6 x 4.7 = 28 prints/s x 8 B = 225 B/s, plus about 4 B of key
  overhead on ~20 ticks/s = 80 B/s, so **~0.3 KB/s per player**. A burst when a large trail area comes into view is at most
  1024 x 8 = 8 KB once.
- **Welcome.** The vision block (ADR0024 change 20) gains `track_ttl_ticks u16` (0 = tracks off) and the ground table as a
  `u16` mask (bits 0-6 regions, bits 8-15 terrain kinds 0-7); `VISION_RULES_VERSION` 1 -> 2. The client then knows whether to draw server prints and can derive the
  identical holds mask.
- **Versions** (one bump each, all in one packet): `PROTOCOL_VERSION` 16 -> **17, or the next free number in merge order**
  (if netcode merges first and takes 17, tracks takes 18; the ADR0024 rule). Observation 23, `POLICY_CONTRACT_VERSION` 16 ->
  17 (the delivery frame decodes key 12), checkpoint `rh-checkpoint/31`, replay `rh-replay/25`, vision rules 2, content hash
  new. Golden vectors: new `protocol/fixtures/v17.json` (`cargo run -p rh-protocol --bin protocol-fixtures`) with chains
  `tracks_replace`, `tracks_add_then_remove`, `tracks_wrap` (laid across a 65536 boundary) and malformed
  `tracks_remove_absent`, `tracks_age`, `tracks_flags`, `tracks_replace_with_removes`; new `protocol/fixtures/tracks_ground_v1.json`
  (holds mask for the seed maps). Decoders: Rust, C# (`client-unity/RoguehallaNet/Protocol/State.cs`, `Vision.cs`, then
  `client-unity/sync-net.sh`) and JS (`tools/protocol-js/check-vectors.mjs`, `crates/rh-server/web/probe.html`).

### 6. Determinism, persistence, schedule

- **Arithmetic.** f64 anchor, `math::hypot` and `math::atan2` (libm), integer prints. No hash collections, no clock.
- **State hash and checkpoint.** `World.tracks` is a serde field, so it is hashed and checkpointed by construction
  (ADR0007 addendum). `SimConfig.tracks: TracksMode { Off, On }` (`#[serde(default)]`, default `Off`, next to `hitboxes`,
  `statics.rs:243-246`) enters the statics digest. `Sim::restore` refuses: prints or walkers under `Off`; more than
  `MAX_PRINTS`; prints not ordered by `laid`; `laid > tick` or `tick - laid >= 200`; a position off-map or on a tile that does
  not hold prints; a non-binary side; a walker for an absent player, walkers unsorted, a non-finite anchor or
  `walked >= TRACK_STRIDE`. `tests/hash_coverage.rs` gets a tracks-on scenario so every print leaf is perturbed, and its
  refusal list (`:1175-1177` pattern) names the mode-coupled leaves.
- **Replay.** The mode is configuration, so replays reproduce prints; `rh-headless` gains `--tracks on|off`.
- **Schedule: a native tail, not a legacy row.** No legacy row can host this without changing what that row means, and
  laying inside `movement:walk` would miss displacements and settle teleports. Decision: `schedule.rs` gains a
  `NATIVE_TAIL` table of rows the legacy record does not have, run by `systems::update_active` after the last `PHASES` row,
  only when no phase returned `Flow::EndTick`. Its one row, `native:tracks` (expire then lay, players in join order), is
  selected by `config.tracks`, outside the legacy `Gates`, so the 23 legacy rows, every compiled legacy `Plan` and the
  conformance projection are unchanged. Running last means prints see final positions after walk, ledger
  displacements and settle. **This amends ADR0009**: native rows may exist only in `NATIVE_TAIL`, after every legacy
  row, never inside a legacy table or hook chain. `crates/rh-parity/tests/schedule.rs` gains: the tail follows the last
  phase, the tail is empty for every recorded world's default config, `nothing_but_the_schedule_calls_a_system` still
  holds, and a mutation test that moves the row into `PHASES` fails.
- **Cost.** Lay: one hypot and compare per player, about 12 per tick. Expire: O(expired). Memory: 1024 x 12 B + 12
  walkers, about 13 KB. Observation, the real cost: per viewer up to 1024 `point_visible` tests, of which the trail part
  scans up to 600 reveals. Mitigations, all outside the `World`: skip own prints; reject prints outside the viewer's trail
  bounding box (reveal origins +- 900 u); memoize the trail verdict per tile for the pass (`remembers` is tile-based,
  `vision.rs:175-182`). Budget: with 12 seats and 1024 prints the tracks pass costs no more than the existing 200-mob
  visibility pass; measured with `tools/perfproof`. Under `Off`, perfproof fingerprints must equal the merge base within
  Ir 1.03x.

### 7. Parity and deviations

- **Gate.** Every parity scenario builds its config with `hitboxes: HITBOXES, ..Default::default()`
  (`rh-parity/src/lib.rs:584`, `:667-668`), so it runs `TracksMode::Off`: no native row runs, `World.tracks` is empty, and all `parity/fixtures/*.json` still MATCH.
  `rh_parity::TRACKS` is set explicitly beside `HITBOXES`, `parity-report` prints `tracks: off`, and a guard test
  `every_compared_scenario_runs_tracks_off` fails otherwise. The native ability hash tape is re-recorded once (the world
  layout and `contentHash` change, as ADR0024 change 11); no tick count may change.
- **Rust-native goldens** (`crates/rh-sim/tests/tracks.rs`, its own "ADR0025 deviation, not legacy parity" section in
  `parity-report`): straight walk (print count and spacing after N ticks, alternating side, heading codes for 8
  directions), Blaze and cannon gaps, `Hidden` and bush suppression, Sentenced floor and ice holding none, expiry at tick
  200 exactly, cap eviction, restore refusals; observation goldens: the **follow case** (A crosses a corridor and leaves; B
  arrives 8 s later and receives A's prints heading toward A's exit, but no A), a print behind a wall not delivered, a
  ward delivering, own prints absent.
- **DEVIATIONS row (proposed DEV-011, balance).** Legacy: no tracks. Rust: under `SimConfig.tracks = On`, players lay
  identity-free prints on soft ground, kept 200 ticks, delivered by `point_visible`. Filter: parity runs `tracks = Off`.
  Re-validation: none possible by harness (bots ignore tracks); owner playtest or "accepted as risk".
- **Balance question.** Tracks favour hunters and chasers (melee builds, the Sentenced hunt, anyone arriving second) and
  hurt escape and ambush play on soft ground; Sentenced and Coliseum stone, ice, bushes and `Hidden` become refuges. Humans
  gain an edge over bots that ignore tracks.

### 8. Bots and policies

Every seat's observation includes `tracks`, the same list a human gets (C-POLICY, ADR0005). Bot behaviour is out of scope:
scripted bots ignore tracks for now, and their goldens stay unchanged because no bot reads the field.

### 9. Client

When the Welcome vision block says `track_ttl_ticks > 0`, Unity stops generating its own prints for players and draws
exactly the key-12 set: the same `SurfaceFx` meshes, atlas and `TrackLife` fade (10 s, 2.5 s fade), the look chosen from
`SurfaceMap.SurfaceAtServer` (sand, snow, mud, ash; temple floor and shallow water take the visible fallback looks of
Decision 3), the foot offset from `side`, the heading from the row, fade from `laid` against the latest snapshot tick.
A row is never hidden by surface, quality setting or clutter rules. Its own walk keeps local prediction-driven prints.
Mob prints stay client-side from shown mobs only (no new information). With tracks off, today's client-only behaviour
is unchanged.

## Alternatives considered

1. **Client-only forever** (the current branch). Fair and cheap, but cannot show anyone the client was never shown, which
   is the owner's point.
2. **Per-fighter ring buffers.** Simpler laying, but prints vanish with a leaving or dying maker unless copied, expiry
   needs a scan of every ring, and iteration order is per maker, which invites leaking maker grouping.
3. **Tile-granular tracks** (a "last passed" tick and heading per tile). Fixed memory, but loses spacing, foot side and
   multiple passers, and a 255 x 255 grid is 65k cells in the hash and checkpoint.
4. **Snapshot channel with actor-style deltas.** Unreliable deltas against the last written snapshot would need a print id,
   and lost adds are lost forever; the reliable State channel already has the replace and resync machinery.
5. **Per-viewer handles** (the pickup pattern). Not needed: prints are immutable and never targeted by input.
6. **Shorter delivery radius or direct-line only.** Fewer bytes, but a second visibility rule the fog does not show, and
   it hides prints on ground the player plainly sees.

## Consequences

- One new world field, one native schedule row, one State key and one observation list; no change to any legacy rule.
- The client loses the freedom to hide prints on soft ground; the ground table becomes content and a balance lever.
- ADR0009 and ADR0018 each gain a narrow, named exception (native tail; incremental key 12).
- Every observation does up to 1024 extra point tests per viewer; the budget is pinned by perfproof.

## Implementation plan

Packets marked **[careful]** need an Opus-class implementer and independent review; **[cheap]** are safe for a cheaper
model given this ADR. Commands assume `export PATH="$HOME/.cargo/bin:$HOME/.dotnet:$PATH"`.

| Packet | Scope | Depends on | Verify |
|---|---|---|---|
| **P-TR-0 [careful]** native tail | `NATIVE_TAIL` in `schedule.rs`, `update_active` runs it after `PHASES` unless `EndTick`, schedule conformance and mutation tests; empty tail | none | `cargo test -p rh-parity --test schedule`; `cargo test -p rh-sim`; parity-report all MATCH; perfproof fingerprints identical |
| **P-TR-1 [careful]** data model and laying | `TracksMode`, `World.tracks`, constants and content fold, ground table, `systems/tracks.rs` (expire, lay), restore refusals, checkpoint 31, replay 25, `hash_coverage` scenario, `no_alloc` | 0 | `cargo test -p rh-sim`; parity-report (all MATCH, `tracks: off`); `cargo test -p rh-sim --test tracks` |
| **P-TR-2 [careful]** observation | `Observation.tracks`, `point_visible` filter with own-print skip, bbox and per-tile trail memo, value sort, observation 23, C-OBS leak tests (follow case, wall, bush, `Hidden`, sorting carries no maker) | 1 | `cargo test -p rh-sim --test observe`; `cargo test -p rh-headless`; perfproof observation budget |
| **P-TR-3 [careful]** wire | key 12 codec, incremental publisher diff, vision block v2, protocol 17 (or next), policy 17, `v17.json`, `tracks_ground_v1.json`, C# and JS decoders, `sync-net.sh` | 2 | `cargo test -p rh-protocol -p rh-server -p rh-policy`; `cargo run -p rh-protocol --bin protocol-fixtures`; `dotnet test client-unity/RoguehallaNet.Tests`; `node tools/protocol-js/check-vectors.mjs`; `node tools/browser-proof/proof.mjs` |
| **P-TR-4 [cheap]** headless and soak | `rh-headless --tracks`, soaks in both modes asserting cap counter 0 and bytes per player per second | 3 | `cargo test -p rh-headless`; `cargo run --release -p rh-headless --example ...` report |
| **P-TR-5 [cheap]** Unity | switch from local player prints to key 12, fallback looks, holds-mask test against `tracks_ground_v1.json`, visibility test (every delivered row draws) | 3 | `dotnet test client-unity/RoguehallaNet.Tests`; Unity EditMode tests; `client-unity/UnityProject/Tools/build-web.sh` plus a follow-case screenshot |
| **P-TR-6 [careful]** live switch and records | `--tracks` server flag and live default constant (stays `Off` until owner playtest), DEVIATIONS DEV-011, C-OBS and C-NET wording, ADR0009/0018 amendments handed to the coordinator | 4, 5 | parity-report; owner playtest |

Order: 0, then 1, 2, 3 in sequence; 4 and 5 in parallel; then 6. Independent review: 0 (schedule invariant), 2 (leak
surface) and 3 (wire, three decoders).

**Size.** About half of ADR0024. The hitbox change touched geometry, pathing, melee, projectiles, prediction and every
fighter constructor across 11 packets. This adds one self-contained system, one world field and one list, but carries
the same wire and version cost (three decoders, golden vectors, five version bumps) plus a schedule-layout amendment that
has no precedent.

## Open questions for the owner (recommended answers)

1. **Exception to D5/D10** for a Rust mechanic during the Unity rework. Recommendation: schedule it after the current
   rework gate; the client-only version covers the look until then.
2. **Do mobs leave server tracks?** Recommendation: no in v1 (players only). Revisit with a per-camp cap if hunting mobs by
   trail becomes a design goal.
3. **Ground table** (Decision 3: soft regions yes, Sentenced and Coliseum stone, ice, light, bog and bushes no).
   Recommendation: accept it. The fallback is "prints everywhere, client picks the look".
4. **Own prints over the wire.** Recommendation: not sent; the client draws its own walk locally.
5. **Identity in prints** (size class, faction tint). Recommendation: none. Any tint names a faction (the ADR0024 change 16
   argument).
6. **Erasure abilities or cards.** Recommendation: none now; the wire's remove form is reserved for them.
7. **Live default.** Recommendation: `SimConfig::default()` and parity stay `Off`; the live profile flips after an owner
   playtest, with DEV-011 signed as "accepted as risk" (no harness can measure it).
8. **Protocol number.** Recommendation: the next free number at merge time (17 if it merges before netcode).

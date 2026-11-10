# ADR0026: Legacy indicator facts on the wire

Status: **Proposed.** Owner direction 2026-11-10 (final UI pass against the legacy game: "the indicators above someone's
head about what stat they have most of, or secondary weapon indicator"). Branch `rework/wire-facts`, cut from
`rework/mob-spacing` (`d8b61da6`, protocol 16 not yet shipped). Shared records (MIGRATION checkpoint, CONTRACTS status
table, `Cargo.lock`) are left to the coordinator; the CONTRACTS proposals are at the end.

**Per-operation checklist** (ORDER_OF_OPERATIONS section 3). Phase/item: not in the plan; owner direction 2026-11-10
(Unity rework, UI pass). D1: no gameplay changes; every `LegacyCircle` parity scenario is bit-identical. D9: the client
computes no game fact; it draws what this ADR delivers.

## Context

The legacy indicator audit (`docs/rework/LEGACY_INDICATORS.md` on `feature/unity-rework`, section 4, rows B1 to B19)
found about 20 legacy indicators that Unity cannot draw only because the server does not send the fact. In legacy every one
was public synced state (Colyseus schema fields or room-wide fx). The Rust observation already held some of them
(`ActorView.mark_tier/brand/mark_tax`), the sim held the rest, and Unity must not compute them (it holds no card formulas
and no sim state). Protocol 16 has not shipped, so its layout may still grow (ADR0024 precedent: archetype table, vision
block and weapon table were added the same way).

## Decision

### 1. Fairness rule

- A fact about an actor travels **only on that actor's delivered row** (`ActorView`, built inside the existing sight
  verdict of `observe_with`); an actor the viewer is not delivered contributes nothing. The facts live in one struct,
  `rh_sim::observe::IndicatorFacts`, filled in the same branch that pushes the row, so there is no second path.
- Every fact is a **verdict, never a clock or a magnitude**: keys of the build marks without scores, "Wish ready" without
  the ready time, "the immunity ring is up" without the deadline, "engaged" without the cooldown.
- Fx follow the sim's declared visibility (`Event::visibility`, `filter_events`, the `FxProjector` masks): the windup is
  declared `IfSeen(by)`, exactly as its swing.
- Owner-only facts go only into the owner's own `SelfView` / head bits.
- The roster (B3) is the one match-wide fact: names and bot flags of seated players, the same for every viewer, with no
  position, faction, health or sight fact. It does name a seated player who is hidden or out of sight (legacy's player
  list and kill feed did too); two sim tests that compared a hidden player with an absent one now compare the scene
  without the roster.

### 2. The facts

| ID | Fact | Source in the sim | Legacy | What a viewer gains |
|---|---|---|---|---|
| B1 | Off-hand weapon of a delivered player | `Player.weapon.weapon0/1` (the slot not in hand) | `weapon1`/`weapon0` synced, drawn as the secondary-weapon mark | the weapon a visible player can swap to |
| B2 | Top two invested stats (build marks) | `kill_augments::build_marks`: legacy `combatReadability` scores in display mode from the sim's folds (decoded mirrors, max hp, cards, farm rows, kill stats) | `drawBuildMarks`, computed client-side from synced build and mirrors | which two of nine stats a visible player invested most in (keys only; legacy showed the same two icons) |
| B4 | Wish ready | `now >= stocks.wish_ready_at`, Wishes on, not in the lobby | `wishReadyAt` synced; icon coloured once passed | whether a visible player's Wish is ready now (legacy gave the exact time) |
| B5 | Sentenced mark plate | `public_mark_tier`, brand (`tier * 25`), `mark_tax::public_percent` (already in `ActorView`) | `markTier`, `brand`, `markTax` synced | the mark plate of a visible actor |
| B7 | Teleport-immunity ring | `0 < immune_until - now <= 1500` (`coliseum::IMMUNITY_MS`); players only | `immuneUntil` synced, ring while `<= TELEPORT_IMMUNITY_MS` left | that the ring is up (legacy gave the deadline) |
| B8 | Fire roam ready | `Player.roam.ready` | `roamReady` synced | that a visible Fire player's burst is armed |
| B10 | Mob engaged | regional/practice mob: `weapon.draw_started_at > 0 \|\| weapon.ready_at > now` | MobView `fighting` from synced `drawStartedAt`/`readyAt` | that a visible mob is fighting (legacy gave both clocks) |
| B11 | Hit kind and critical | `Event::Hit.critical` (new, from the ledger entry); signature and ability chunks from the `FxProjector` | hit fx `sig`, `ability`, `crit` | the damage-number style; chunks were already projected to exactly these observers and dropped at the wire |
| B12 | Heals and camp clears | `Event::Heal` (IfSeen), `Event::CampCleared` (Everyone) | heal fx; camp-clear ring | heal numbers of visible fighters; the camp index of a clear (already public to everyone in the sim's declaration) |
| B13 | Windup telegraph and cancel | `Event::Windup` (now `IfSeen(by)`), `Event::AttackCancelled` | windup fx (`ms`), cancel fx | that a visible attacker started a windup, its weapon, aim and remaining time |
| B3 | Roster | `Player.seat.name`, `seat.bot` | names over every head, kill feed | the names and bot flags of everyone seated |

**Strength glow: not sent.** Legacy's glow (`drawStrength`) reads `combatReadability.power`, the normalised PvP factor of
the card power, not the investment scores; it is a different derivation, so it stays out of this ADR (the coordinator
can add it as one more byte).

**Bleed hit kind: reserved, never sent.** The sim does not emit card bleed chunks yet (`cardHooks.flushBleeds` is a
pending link, P-CARDS-1), so `HIT_KIND_BLEED = 5` is reserved and decoders accept it.

**Holy camp lifesteal in the build marks: a known deviation.** Legacy's leech score adds `holyCampLifestealOf(campClears)`
(0.005 per eligible camp clear). The Rust sim counts camp clears but has no Holy camp-lifesteal passive, so its leech score
omits the term; `parity/build-marks/legacy.json` case `holy_camp_clears` pins the gap (the Rust marks equal legacy at zero
clears). Nothing was invented. Proposed DEVIATIONS row in the branch report.

**Camp-clear heal: not a heal in Rust.** The Rust camp clear pays a potion (`systems::camp_heal`), so no heal carries a
camp index; the legacy ring is driven by the camp-clear event instead.

### 3. Wire layout (protocol 16, append only)

Snapshot (Full) actor mask bits, after the archetype byte, in bit order:

| bit | field | default (bit clear) | refused |
|---|---|---|---|
| 11 | flags u8: bit 0 Wish ready, 1 engaged, 2 teleport immune, 3 roam ready | 0 | any other bit |
| 12 | off-hand u8: 0 empty slot, else weapon code + 1 | 0 | > 16 |
| 13 | build marks u8: first key low nibble, second high nibble; key 0 none, 1..=9 ad, ap, damage, health, attack speed, armor, mr, speed, leech | 0 | a key > 9, a second key without a first, two equal keys |
| 14 | mark plate: tier u8, brand u8, tax u8 | 0, 0, 0 | tier > 4, brand or tax > 100 |

Delta actor bits 14 flags, 15 off-hand, 16 build marks, 17 mark plate (same fields, sent when they change; a new actor
carries every non-default one). Full head bits 22 flags, 23 build marks, 24 mark plate and delta head bits 26, 27, 28 carry
the same facts for the self (a self has no off-hand field: the owner's inventory key already holds both slots). Head and
actor masks stay canonical varints: a Full actor row with bit 14 takes a three-byte mask, the delta head can take five bytes.

Fx (tags append only):

| tag | record | refused |
|---|---|---|
| 2 Hit | unchanged, its last byte becomes flags: bit 0 passive, bit 1 critical | other bits |
| 9 Windup | by varint, weapon u8, angle u16 (as Swing), ms u16 (whole ms, saturated) | weapon > 15 |
| 10 Cancel | id varint | |
| 11 SigHit | victim varint, by varint (u32::MAX absent), kind u8, amount f32 | kind not 1..=5 or 16..=20 |
| 12 Heal | id varint, amount f32 | |

Kinds: 1 burn, 2 disease, 3 backlash, 4 mark, 5 bleed (reserved), 16 + ability code (Freeze 0 .. Last Stand 4).

Events: tag 11 CampCleared, camp u16.

State key 12 Roster (sent with every Welcome like the other keys, then on change): `count u8` (at most 32), rows ascending
by id: `id varint` (nonzero), `flags u8` (bit 0 bot; other values refused), `name` (u8 length, 1..=24 UTF-8 bytes, no
control character).

The isolated scene-candidate experiment (`rh_protocol::scene_candidate`) accepts a complete State of keys 1..=11 or
1..=12; its committed fixtures (`protocol/fixtures/scene-candidate/*`) are unchanged because its synthetic State drops key
12 (`outbox/scene_candidate/fixture.rs::experiment_state`).

Golden vectors: `protocol/fixtures/v16.json` regenerated, with `snapshot_indicator_facts`, `fx_indicators`,
`events_camp_cleared`, the chain `indicator_facts_delta`, and malformed vectors for every new field (named in
`crates/rh-protocol/tests/vectors.rs`).

### 4. Versions

- `PROTOCOL_VERSION` stays 16 (unshipped; coordinator ruling).
- `OBSERVATION_VERSION` 22 -> 23 (`ActorView/SelfView.facts`, `SeenEvent::Windup`, `SeenEvent::Hit.critical`,
  `Observation.roster`).
- `POLICY_CONTRACT_VERSION` 16 -> 17 (policies decode the same frames).
- Checkpoint and replay format strings unchanged (`rh-checkpoint/30`, `rh-replay/24`), with one honest caveat: events
  between steps (`World.pending_events`) ARE world state, serialized into checkpoints and folded into the state hash, so
  `Event::Hit.critical` is always serialized (`#[serde(default)]`, no `skip_serializing_if`, which the hash layout
  forbids; review fix). A checkpoint whose pending events hold a `Hit` therefore serializes and hashes one more field.
  `default` restores checkpoints written before the field. No committed checkpoint, replay or hash golden holds a
  pending `Hit` (the queue carries a leave's result and Wish cues; the repository's goldens were searched and the full
  suite, including the replay and hash-coverage tests and the ability hash tape, passes unchanged), so no committed
  bytes move. Replays record inputs and per-tick hashes, not events. A test pins that a pending `Hit`, critical or not,
  keeps `check_layout`, round-trips a checkpoint and changes the hash with the flag. The ability hash tape rebinds
  `observationVersion` only.
- Content hash unchanged: no content constant was added (the score divisors already lived in `kill_augments`).

### 5. Consequences

- Unity can draw the secondary-weapon and build marks, the Wish icon state, the mark plate, the immunity ring, the roam
  glow, the mob fighting state, damage numbers by kind with crits, heal numbers, the camp-clear ring, windup telegraphs and
  names, all from server facts.
- Build marks are computed once per player per tick at the end of the step (`fx_report::BuildMarkCache`, derived, never
  hashed or checkpointed; a clone or restore computes them directly until the next step).
- The roster carries at most 32 rows; a larger seat count is cut to the lowest ids (debug builds assert).
- Bots and policies receive the same frames; their perception reads only `WireFx::Hit` and is unchanged, so bot
  behaviour and goldens do not move.
- Bandwidth (`cargo run --release -p rh-server --bin wirebench -- --scenario all`, 8 bots, 2400 ticks, base `d8b61da6`
  against this branch; payload bytes per player per second):

  | scenario | base total | branch total | snapshot | fx |
  |---|---|---|---|---|
  | idle | 140 | 140 | 140 -> 140 | 0 -> 0 |
  | typical | 343 | 360 (+17, +5 %) | 300 -> 300 | 43 -> 60 |
  | heavy (8-way melee) | 1885 | 2028 (+143, +7.6 %) | 619 -> 619 | 1266 -> 1409 |

  The growth is the windup telegraphs, cancels and heal/chunk fx (droppable fx). Snapshot bytes did not move in these
  bot matches: a field costs bytes only when it differs from its default and, in deltas, only when it changes (Wishes
  are off in the bench config and the bots buy no cards). The roster is keyed State (sent with full state and on change)
  and the Welcome is unchanged (5428 bytes). The worst case stays inside the frame limit
  (`a_busy_match_with_every_indicator_fact_stays_within_the_frame_bounds`: 512 actors with every field at its maximum,
  Full and all-fields delta).

## Proposed CONTRACTS edits (coordinator)

- C-NET: protocol 16 also carries the ADR0026 indicator facts (actor bits 11..=14, delta actor bits 14..=17, head bits
  22..=24, delta head bits 26..=28, fx tags 9..=12, event tag 11, State key 12).
- C-OBS: "An actor's indicator facts (off-hand, build-mark keys, Wish-ready, engaged, immunity-ring, roam-ready, mark
  plate) are delivered only on that actor's delivered row and only as legacy's verdicts; the windup telegraph follows its
  swing's visibility; the roster reveals who is seated (name, bot flag), nothing about where."

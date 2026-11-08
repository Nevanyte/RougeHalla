# Proposal — fair Observation client leaves and the perceive() port (task-28, paused)

Status: **proposal only, no code or schema change.** The lead's directive changed ownership: new observation leaves or schema
changes need this concrete proposal and C-OBS absence/hidden controls before integration, and the consolidated union
observation version (17) must not be reused for a different contract. The leaf code that had been started before that directive
is **uncommitted and not pushed** (files listed at the end); the branch's verified head remains slice 3 at
`13d38a41» (PR #58). The rest of the brain (memory/frames/strategy/tactics) stays blocked on approval, not approximated.

## 1. Why this proposal exists

The full fair perception view model is `packages/server/src/bots/brain/perception.ts»'s `perceive()»: it turns the client's
fair state + fx stream into the full Percept (self/fighter/mob/container/camp/field/minimap views, decoded events,
projectiles). The Rust policy today gets a deliberately narrowed `rh_sim::Observation». The P-BOTS-3 evidence lists the exact
missing input side; this document proposes each missing leaf, its legacy derivation, its public-only argument, the C-OBS
controls, the version/schema impact, and the perceive() port + pinned-corpus plan.

The fair-observation rule this proposal is measured against: an observation may contain only facts the legacy client is sent
or draws, and changing hidden state must not change it (docs/CONTRACTS.md C-OBS; the existing leak suite in
`crates/rh-sim/tests/observe.rs» is the reference).

## 2. What the fair Observation already carries (no new leaf needed)

Checked against `crates/rh-sim/src/observe.rs», `item_view.rs» and `perception.ts»:

- **Containers labels/contents/interactable: already covered by `props» + `inventory».** `Observation.props» is the client
  item observation: one `VisibleProp { handle: PickupHandle, cue: PropCue }» per container the viewer can see, with the
  1/8-unit position (the same public grid the client draws), the drawn kind — ground weapon (its weapon), chest with its open
  flag, body with its public label — the single focused interaction target (`focused») and its body-weapon hint
  (`body_hint»). `inventory» carries both slots' items, the active slot and the potion counts. Legacy `seeContainers» reads
  exactly these public facts; no hidden content is exposed (only the focused target's weapon hint is drawn, and the
  candidate rule is reach + line-of-sight, not inventory identity).
- **Minimap repaint inputs: proposed NO new leaf.** The legacy minimap draws synced mob dots regardless of the client's
  direct sight; the Rust observation deliberately contains only directly seen actors (C-OBS). A minimap leaf would widen the
  client's information beyond the current fair model — an owner/lead decision, not a mechanical port. Today the minimap view
  can be derived from `visible» (same pixels the fair view already allows). **Decision requested:** keep it derived (no leaf);
  if the lead wants legacy-accurate minimap information, that is a separate widening proposal.
- **build: already covered by `Observation.build» (BuildView).**
- **potion counts: already covered by `inventory» (potion_small, potions_healing).**

## 3. Proposed new leaves

Each row: the legacy derivation, why it is public-only, the absence control (change hidden state → observation identical) and
the positive control (change a public fact → observation changes) that the C-OBS tests would add.

| # | Leaf | Legacy derivation | Public-only argument | C-OBS absence control | C-OBS positive control |
|---|---|---|---|---|---|
| 1 | `SelfView.ready_at» (absolute; the existing `ready_in_ms» stays on the wire path) | `perception.selfView» reads `PlayerState.readyAt» (client HUD ready clock) | The owner's own HUD clock, synced to the owner | Perturb a hidden player's `readyAt» → viewer observation unchanged | Advance the owner's attack → `ready_at» changes |
| 2 | `SelfView.barrier» | `selfView» reads `PlayerState.barrier» (the blue bar beside hp) | Owner's own drawn HUD value | Hidden player's barrier change → unchanged | Set owner barrier through a public checkpoint edit → value appears |
| 3 | `SelfView.draw_started_at» | `selfView» reads `PlayerState.drawStartedAt» (the draw widget) | Owner's own drawn HUD value | Hidden player's draw changes → unchanged | Begin a bow draw → value appears |
| 4 | `SelfView.immune_until» | `selfView» reads `PlayerState.immuneUntil» (teleport shield against render time) | Owner's own drawn HUD value | Hidden player's immunity changes → unchanged | Teleport immunity set → value appears |
| 5 | `SelfView.name» | `selfView» reads `PlayerState.name» | The owner's own name (already in the roster for everyone) | Hidden player's name change → unchanged | Roster rename through the public path → value appears |
| 6 | `SelfView.as_mult», `speed_mult», `windup_mult» (decoded) | `selfView» decodes `PlayerState.asMult/speedMult/windupMult» (the HUD's attack/move speed and timing display) | The owner's own decoded mirrors (the wire already syncs them to the owner) | Hidden player's mirror change → unchanged | Public build/status change → mirrors change on the owner only |
| 7 | `ActorView.name» | `fighterSeen»/`mobSeen» carry `name» (player roster label; mob catalog name) | Names are public: the client draws them and death lines use them | Hidden (out-of-sight) player/mob name change → unchanged | Rename a visible player/mob → name changes |
| 8 | `ActorView.bot» (public [BOT] tag; players only, mobs false) | `fighterSeen» copies `PlayerState.bot» | The [BOT] tag is drawn publicly; docs/BOTS.md 2.6 already forbids decisions on it | Flip a hidden player's bot flag → unchanged | Flip a visible player's tag → tag changes (no command change; existing humans test covers decisions) |
| 9 | `ActorView.barrier_frac» (hundredths, like `hp_frac») | `fighterSeen» draws `barrierFrac» from the barrier bar | Another fighter's shield bar is drawn | Hidden player's barrier change → unchanged | Set a visible player's barrier → fraction changes |
| 10 | `ActorView.draw_started_at» | `fighterSeen» copies `drawStartedAt» (the drawn draw) | Another fighter's draw is drawn | Hidden draw change → unchanged | Visible bow draw → value changes |
| 11 | `ActorView.immune_until» | `fighterSeen» draws `immune» from `immuneUntil» and render time | The teleport shield is drawn on the fighter | Hidden immunity change → unchanged | Visible immunity set → value changes |
| 12 | `ActorView.in_hand» (the active slot's item; None = fists) | `fighterSeen» `inHandOf(p)» = `weapon0/weapon1[slot]» | The drawn hand is public | Hidden hand change → unchanged | Swap a visible player's hand → value changes |
| 13 | `Observation.alive_players», `player_count», `min_players» | `perceive» HUD `alive/playerCount/minPlayers» from the room state | The HUD's "Alive n/N" counters are public room facts | Hidden player's own state changes → counts unchanged (only seat presence moves them) | Join/leave/kill a player → counts change |
| 14 | `Observation.winner» (public id) | `perceive» HUD `winner» string | The result banner is public | — (end state) | End the run → winner id appears |
| 15 | **decoded fx stream** (the hard one): the source `ObservedEvent» set — windup, swing, hit (with weapon/signature), block, stagger, cancel, projEnd, death, heal, teleport, bounty, victory, plus named casts/statuses | `perception.observe/observeExt» decodes the client FxBatch stream; the sim's fx events are the same facts before delivery | Fx are shown to clients that can see the subject at the source step; hidden fighters' fx are withheld/masked | A hidden attacker's windup/hit/signature/cast fx must not appear; hidden victim's death must be redacted exactly as today's event redaction test requires | A visible attacker's windup/hit appears; a death line appears with the visible killer only |

Items 1-14 are additive primitive leaves on the existing `SelfView»/`ActorView»/`Observation» shapes. Item 15 is the only
**event-shape** change: several sim fx events are currently `Event::visibility() == ServerOnly» (e.g. `Windup»,
`AbilityHit», `SignatureHit», projectile launch/end); exposing them to a fair observation is an event-classification
decision with a per-event visibility rule (who can see the subject when the fx plays, plus the existing masking
conventions for hidden/untargeted identities). It must be proposed per event and needs the lead's sign-off; the wire protocol
does not change either way (the client fx stream is separate).

## 4. C-OBS control matrix and tests to add

All tests go into `crates/rh-sim/tests/observe.rs» (the existing leak suite), one pair per leaf or group:

1. **Absence control** (must not leak): build two sims identical except in hidden state (behind the practice pillar, an
   out-of-sight player/mob, hidden-status effects, lobby seat), mutate the hidden facts (barrier, draw, immunity, name, bot
   tag, in-hand, mirrors, winner-side facts) through the public checkpoint edit path, and assert the two observations are
   byte-identical (serialize + compare), exactly like `hidden_actors_change_nothing_the_viewer_is_shown».
2. **Positive control** (must show): mutate the same facts on a visible actor/owner through the public path and assert the
   named leaf changed to the expected value (this catches a leaf wired to the wrong source or dropped).
3. **Counters control**: seat presence changes only the counters (the existing status-observation test is the precedent: a
   departing seat shows in `player_count»/`alive_players» and nowhere else).
4. **Fx redaction controls** (item 15, if approved): hidden attacker's windup/hit/sig/cast absent; visible attacker's
   present; hidden victim's death line redacted exactly as today; a third party's identity never enters the payload.
5. **Fairness mutation test**: for each leaf, a hidden-state mutation must not move the observation hash (the test
   serializes the observation, not the world), and a public mutation must.

## 5. Version, schema and checkpoint impact

- **Observation version:** the consolidated union is at observation **17** (checkpoint 24, protocol 11). This proposal must
  **not** take 17. The leaf set is an additive layout change; the lead should assign the next free observation slot after the
  union (for example **18**, or fold it into the next union bump). The policy pin is derived from
  `rh_sim::observe::OBSERVATION_VERSION» and moves automatically; the policy-contract version does not change.
- **Wire protocol:** no change. The new leaves are Rust-side observation facts; the wire keeps its current subset (the
  paused experiment kept the existing `ready_in_ms» wire path untouched).
- **World schema / checkpoint / hash coverage:** none of items 1-14 introduces world state. They are projections of
  already serialized and validated state (players, vitals, weapon runtime, modifiers, containers/props), so checkpoint format,
  checkpoint validation and hash_coverage rows are unaffected. `OBSERVATION_VERSION» is already registered as the
  NON_GAMEPLAY observation-layout row in `crates/rh-sim/tests/content.rs»; a bump changes nothing in the content hash.
  If any leaf were instead to require new world state (none does in this proposal), that would be a separate schema change
  with its own checkpoint/hash coverage.
- **Allocation constraint (experiment finding):** the paused prototype added `String» names to `SelfView»/`ActorView» and
  broke the warmed-cast allocation invariant: `crates/rh-sim/tests/abilities_no_alloc.rs» fails with 36 heap blocks on the
  warm Frost cast (the rest of the workspace was green up to that test). The proposal therefore requires allocation-free
  representations: names as `Arc<str>» clones from the roster (no per-observation heap block) or, if that still trips the
  suite, a reused name arena inside the observation buffer; every leaf must be measured against that test before
  integration. This is exactly the class of issue the lead's proposal-first rule is meant to catch.

## 6. perceive() port plan and pinned corpus (after approval)

Once the leaves (or the approved subset) are in:

1. Port `perceive()» onto a new `crates/rh-policy/src/bots/view.rs»-style constructor: `Observation -> Percept» with the full
   self/HUD/fighter/mob/container/camp/field/minimap views, the decoded event list and projectiles, feature flags from the
   already-ported `detectFeatures» foundation (slice 3). Containers come from `props» + `inventory»; container views need the
   handle/pickup semantics the seat already has.
2. **Pinned corpus plan:** add a `tools/perception-fixtures/» capture that builds a legacy world with the existing
   legacy-capture module profile in the pinned Linux x64 Node 22.23.4 container, drives a declared scenario (players, mobs,
   containers, camps, fields, events) and records the actual source `perceive()» output per viewer per tick (the full
   Percept, JSON-safe, with source-closure hashes and a `--check» byte-identical mode). The Rust parity test builds the same
   scenario through `rh_parity»/`Sim», walks the same ticks, calls the ported constructor on the fair Observation and compares
   the full Percept field by field (positions/quantization, drawn sets, event stream, extras); mutants: flip a hidden
   fighter's fact, a window boundary, a name masking, a projectile stop — each must fail.
3. Then port `memory.ts» (its fair-input is the full Percept: containers via props, HUD/self/fighter leaves, decoded events,
   projectiles) with its own pinned corpus, then `frames.ts», then strategy/tactics. None of that starts before approval.

**Buildability assessment:** the primitive leaves 1-14 are small and low-risk (additive fields, derivation is mechanical,
controls straightforward); the only architecturally significant piece is item 15 (fx event visibility/classification), and the
name representation must respect the allocation suite. If the lead approves items 1-14 plus a per-event visibility rule for
item 15, perceive() is buildable with the pinned corpus plan above without approximation. If item 15 is deferred, perceive()
can be ported only for the view/self/container/HUD side (no fx-event stream), which would leave memory.ts's stimulus side
blocked — that is the concrete decision point, not a code-size question.

## 7. Current lane state (paused code, not pushed)

Uncommitted experiments in the worktree `p-bbots-brain» (not committed, not pushed; branch head stays `13d38a41»):
`crates/rh-sim/src/observe.rs», `crates/rh-sim/tests/observe.rs», `crates/rh-sim/src/status_runtime/observe.rs»,
`crates/rh-policy/src/lib.rs», `crates/rh-policy/src/bots/planning_parity_tests.rs»,
`crates/rh-policy/src/bots/wish_module_tests.rs», `crates/rh-server/src/wire.rs». They prototype leaves 1-14 with
`String» names (the allocation finding above) and must not be integrated as-is; they are left in place only as the
experiment record. No observation/schema code will be committed or pushed until the lead decides the version and the leaf set.

No docs/MIGRATION.md, docs/CONTRACTS.md status table or Cargo.lock edit; no merge.

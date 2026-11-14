# P-BOT-BRAIN-CHOICES-1: a Brain seat records the choices it makes, so the learner has something to learn from

- **Serves:** owner decision 8 (MIGRATION, 2026-11-10: the legacy learner on); finding of reviewer-opus on
  P-BOT-LEARN-ON-1 (2026-11-13): with P-BOT-BRAIN-CONTINUITY-1 merged in a scratch tree, Brain seats report no
  choices of their own; the learner's store holds only `faction|…` keys
- **Implementer tier:** implementer-opus (rh-policy Brain: bot priority and learning facts)
- **Reviewer:** reviewer-opus
- **Integration base:** feature/unity-rework, after P-BOT-BRAIN-CONTINUITY-1
- **D-rules touched:** D1 loose proof against the legacy Brain (`packages/server/src/bots/brain.ts`) · R-ML: the
  ported learner only · no wire, sim or live-default change (`--bot-brain` stays off)

## 1. ID and outcome
The legacy Brain records a learning choice when a goal decision carries one (`brain.ts:246`; the port:
`crates/rh-policy/src/bots/temporal_percept/brain.rs:1186`), in the learner's eight domains (opener, boon, skill,
camp, …). In the port's tournaments none is ever recorded: probed with the brief's fast settings and with a 15 s
planning phase added, the store's keys are all `faction|…`, and in a tournament the lineup fixes each seat's faction,
so nothing learned steers anything. First establish WHY: which legacy decisions carry a choice key, whether the
port's strategy modules produce those decisions at all on the fair degraded profile (DEV-026) or produce them without
the key, and whether the facts they need are missing from the fair percept. When this lands a Brain seat in a
headless match records the same kinds of choices legacy's does (the eight domains that the fair profile can decide),
each exactly once per decision as legacy does, and a learning tournament's store holds non-faction keys.

## 2. Dependencies
- P-BOT-BRAIN-CONTINUITY-1 merged (seats that act). P-BOT-LEARN-ON-1 merged (the tournament's store).

## 5. Exclusive write scope
- `crates/rh-policy/src/bots/**` where the choice is produced and recorded (the oracle author names the files); not
  `rh-sim`, not `rh-server`, not the tournament runner unless the oracle author shows the fault is there

## 6. Contracts
- C-OBS, C-INPUT: a choice is made from the seat's own fair observation and recorded by the seat; nothing from the
  sim. C-RNG: any draw (the learner's exploration, softmax sampling) comes from the seat's own seeded stream, in
  legacy's order. A domain legacy decides from a fact the fair profile does not deliver stays undecided and is named
  in DEV-026's list: no new fact is added to the percept here (that is a wire or observation packet).

## 8. Acceptance checks
- A headless Brain match of a stated length, seeded: each seat's recorded choices include at least the domains the
  oracle author lists, with legacy's key shapes (`domain|persona|choice` or whatever legacy uses: cite it); red today
  (no choices).
- A learning tournament of a few games: the store holds non-faction keys; two seeded runs are byte-identical; with
  learning off the tournament's golden is unchanged.
- One loose-proof case against legacy for one domain: the same percept, the same seed, the same choice key.
- `scripts/gate.sh --quick --oracle packet/P-BOT-BRAIN-CHOICES-1` passes.

## Oracle files (read-only for implementers)
- `crates/rh-headless/tests/brain_choices.rs`
- this packet file (once committed)

## 10. Risk and suggested model tier
Opus. If the cause is that the degraded profile cannot make these decisions at all, the packet's answer is the list
of facts it lacks, and the owner decides whether to deliver them (each is an observation change).

## Oracle author's completion (2026-11-13, on `coord/int-34`)

### The answer to "why": the tournament's world, not the Brain
The Brain makes and records legacy's choices already. The headless tournament seats it in a world where the decisions
those choices belong to cannot arise: `tournament_cli::default_arena()` is `rh_sim::arenas::practice_arena()`
(`crates/rh-headless/src/tournament_cli.rs:501-503`, a 48x32 walled field with no camps) and `sim_config_for(plan)`
(`crates/rh-headless/src/tournament.rs:301-316`, `:320`) is `SimConfig::default()` plus the source lifecycle:
`mob_mode: Off`, `initial_loot: false`, `faction_mode: Off` (`crates/rh-sim/src/statics.rs:414-441`). No mob to farm,
no camp to walk to, no weapon to loot: so no `opener` and no `second`, and the store holds only the manager's
`faction|…` keys. The binary uses that world for every policy (`src/bin/tournament.rs:79`, `:82`). Legacy's tournament
plays `generateMap(seed)` with mobs on (`packages/server/src/bots/tournament/headlessRoom.ts:27-34` `HEADLESS_CONFIG`
`mobs: true`; `:110`).

Measured on this base (release, seed 3, the admitted seed1 map with the `brain_bots` live config, 8 Brain seats): by
tick 2,000 every seat has recorded `opener|<own>|<zone>`; by tick 6,000 six of eight have also recorded one or two
`second|<own>|<weapon>`. With the same tournament plan as the oracle on that world, 6 of 6 resolved seats record an
opener and 2 of 6 a second (3.5 s for two games). The brief's suspicion (the degraded profile lacks facts) is wrong for
both domains legacy records: the opener reads the delivered mob's faction or a camp's static zone (public by the
DEV-026 owner ruling), the second reads a container's weapon only when it is known to the seat
(`ContainersWeapon::Weapon`, else no key).

### Established facts: legacy
- Recording: `adopt` records `d.choice` only when the goal changes (`packages/server/src/bots/brain/brain.ts:240-246`);
  strategy carries a choice only for a newly chosen goal (`brain/strategy.ts:321`: `kept || !chosen.choice`).
- Producers (the whole set; `rg recordChoice|ChoiceKey packages/` finds no other):
  - `opener|<own faction>|<mob faction>` in `farm` while `mobKills === 0` and no opener recorded (`strategy.ts:487-488`);
  - `opener|<own faction>|<camp zone>` in `camps` while no opener recorded (`strategy.ts:659`, `:696`);
  - `second|<own faction>|<weapon>` in `loot` for a known weapon while carrying exactly one (`strategy.ts:626-635`),
    at every adoption of such a goal (duplicates are recorded; the store counts a key once per run,
    `learning/BotStatsStore.ts:211` loop with its touched set);
  - `faction|<persona>|<faction>` appended by the manager at the result (`BotManager.ts:480`).
- Not recorded by legacy: `spawn|…` and `boon|…` are READ as biases in the planning module
  (`brain/modules/planning.ts:107`, `:117`) and never recorded, so they never learn (a legacy bug, pinned: see doubts);
  `skill`, `relic`, `camp` are declared in `ChoiceDomain` (`brain/types.ts:1102`) and produced nowhere.
- So "the eight domains" of the brief are the learner's KEY VOCABULARY (`learning.rs:25` `DOMAINS`); legacy's Brain
  exercises three of them. The oracle pins exactly those three and refuses any other domain in a recorded key.
- Vocabulary: `FACTION_IDS` `packages/shared/src/factions.ts:74`; `WEAPON_IDS` `packages/shared/src/weapons.ts:21`.

### Established facts: the Rust seams (unchanged by this packet)
- Producers: `strategy/engine.rs:666-677` (farm opener), `:997-1018` (loot second), `:1063`, `:1140-1148` (camp
  opener), `:366-370` (kept rule), `scored` `:453-483` (learned bias added from `ctx.cfg.learned`).
- Recording: `temporal_percept/brain.rs:1175-1189` `adopt` → `memory.rs:1781` `record_choice`; `brain.rs:1246-1256`
  `end()` copies the choices; `brain_bot.rs:302-318` `finish` returns them (`None` for an unseated/faulted seat:
  DEV-026); `tournament_learning.rs:155-181` `seat_record` appends the faction key; `play_learning` `:367-373` folds
  records in arrival order.
- Loose proof against legacy for one domain (acceptance item 3) is ALREADY established and is not re-added: the
  `parity/policy/bot-private-brain` capture (legacy Brain, same percept, same seed) carries `opener|fire|sentenced`,
  `opener|fire|holy`, `second|fire|bow` in its memory snapshots and `end()` summary, compared field for field by
  `temporal_percept/brain/tests.rs` (`trace.rs:1240-1260` `RunSummary.choices`, `:1609` memory `choices`);
  `bot-private-strategy` carries `opener|…` goal decisions with their `choice`.
- Determinism: no new draw. The Brain's softmax and lapse draws are already on the seat's own seeded streams; the
  learned bias only shifts utilities. (a) Same seed, same store bytes: pinned on the new world. (b) Keys are built from
  the seat's own faction, a delivered mob's faction, a camp's static zone, a known container weapon: nothing hidden.
  (c) A faulted seat reports none: unchanged (`tournament_learning.rs` test
  `a_faulted_or_silent_seat_records_only_the_managers_faction_key`). (d) Learning off and HumanBot seats: the world
  for `SeatPolicy::Human` is exactly today's (pinned). (e) Live server: nothing in rh-policy or rh-server changes;
  `record_choice` is already a `Vec` push at a goal adoption, on and off alike, as in legacy.

### 5. Exclusive write scope (replaces the brief's; the fault is in the runner)
- `crates/rh-headless/src/tournament_learning.rs`: replace the Brain arm of the `tournament_world` stub; the Human arm
  stays `(default_arena(), sim_config_for(plan))`; `LEARNING_USAGE` may say which world `--policy brain` plays.
- `crates/rh-headless/src/bin/tournament.rs`: take the arena and config from `tournament_world(&plan, learning.policy)`
  (`:79`, `:82`) for every path (learning on, `--policy brain` off, Human).
- `crates/rh-headless/src/lib.rs` only if a loader from embedded text is needed (e.g. `include_str!` of
  `crates/rh-sim/src/mapdata/fixtures/seed1.map.json`; the binary must not depend on the working directory).
- Not `rh-policy` (the Brain is right), not `rh-sim`, not `rh-server`, not `tournament_cli.rs` (the pinned source CLI
  corpus), not `tune.rs`/`bin/tune.rs` (see risks).
- Intended world (what the throwaway check used; the oracle pins only the starred items): the admitted seed1 map;
  `sim_config_for(plan)` with *`mob_mode: Pve`*, *`initial_loot: true`*, `faction_mode:
  EngagementHolyPlagueFireFrostSentencedFireRoam`, `abilities: Full`, `regen`, `quests`, `hazards`, `walk_hints:
  Some(true)` (the `--runtime source-arena` content, `rh-server/src/runtime.rs:209-246` `Settings::sim`, which also sets
  `regen_in_combat: Off` and `hazards: Map`: the implementer picks one and says which; `brain_bots.rs` `live_config`
  is the same set with `hazards: All`), keeping *the plan's lifecycle,
  `min_players`, `lobby_seconds`, `fill_seconds`*; *the Brain's `camps` feature is on* for it.

### Stubbed (`stub:` commit)
- `tournament_learning::tournament_world(plan, policy) -> (Arena, SimConfig)`: returns today's world for every policy.

### The oracle (`crates/rh-headless/tests/brain_choices.rs`)
Plan: 2 games, seed 7, lineup E,N,H, cap 3 simulated minutes, patience 60 s, sudden death 20 s; `play_learning` on
`tournament_world(plan, Brain)`.
- `the_brain_tournament_world_has_mobs_loot_and_camps_and_keeps_the_plans_timers`: red (`mob_mode` Off).
- `guard_the_default_seats_play_todays_world`: green.
- `a_learning_brain_tournament_records_legacys_choice_kinds_in_sane_numbers`: every recorded key is valid and in
  {faction, opener, second}; opener/second context is the seat's own faction; option a legacy faction / weapon id; at
  most one opener per seat; the faction key exactly once; at most 10 seconds per seat (a loose runaway bound: legacy
  records duplicates); at least 4 records, at least half with an opener, at least one second; the store holds opener
  and second keys. Red (0 of 6 seats record an opener).
- `two_seeded_brain_learning_runs_write_byte_identical_stores_with_choices`: red (the stores hold no opener).
- `the_tournament_binary_learns_from_brain_choices_on_the_brain_world`: `tournament --policy brain --learn on` with
  the same plan writes a store with opener keys equal to the library's: red.
- Reachable in this short run: opener, second, faction. Not reachable by any run: spawn, boon, skill, relic, camp
  (legacy never records them).
- Time: 6.2 s release for the file (build excluded), checked green with a throwaway implementation (reverted, not
  committed). Guards run green with it: `tournament_learning`, `learn_tune_fix`, `tournament_cli_timers`.

### Identities that move
- None: no wire, observation, policy contract, checkpoint, replay or state-hash change. A `--policy brain` tournament's
  output (report and learning file) changes because its world changes; no golden pins it. HumanBot tournaments and
  every golden (`tests/fixtures/tournament_learn_off.json`, the CLI corpus) stay byte-identical.

### Baseline (on `coord/int-34` @ the stub)
- `brain_choices`: 1 passed, 4 failed (assertions as above).

### Legacy doubts
- `packages/server/src/bots/brain/modules/planning.ts:107`, `:117`: `spawn|…` and `boon|…` biases are read but no
  legacy code records those keys, so they stay 0 for ever. Pinned as is (the oracle refuses those domains); a fix is
  its own packet.
- Legacy plays a generated map per game seed (`headlessRoom.ts:110`); the port will play one admitted map for every
  game. Proposed DEVIATIONS row (the coordinator words it): "a `--policy brain` tournament plays the admitted seed1 map
  with the source-arena content for every game, not `generateMap(gameSeed)`". The Human tournament on the empty
  practice arena is itself an unrecorded difference from legacy (legacy seats its Brain with mobs on).

### What this does NOT establish
- That learning improves play: no learned bias has been shown to change placements, and no searched table has been
  shown better (DEV-030, DEV-031; P-BOT-TUNER-2's verdicts are "not distinguishable").
- Exact counts, or that the port records the same choices as legacy in the same tournament (different maps; loose
  proof only). The per-decision bound is per seat, not per decision: decisions are not counted by the runner.
- Anything about the live server (`--bot-brain full` already plays the content world).

### Risks
- The tuner (`src/bin/tune.rs`, `tune.rs`) also seats Brain bots on `default_arena()` + `sim_config_for`: a Brain
  search there tunes bots that never meet a mob, a camp or a weapon. Out of scope here (its digests are pinned by
  `tune_evidence`); a follow-up packet should move it to `tournament_world` and re-pin.
- A content-world Brain game is slower than a practice-arena one (0.1 s to ~1.7 s a game here); long learning runs
  scale with it.

## Notes from previous attempts

# P-QUEST-1 — K1 quests: the data layer (catalog, roster, placement, rewards)

`INCOMPLETE` for the full P-QUEST-1 row; **the quest data layer is DONE-VERIFIED** against a pinned-container actual-source
corpus, stacked on the P-CARDS-3 head (`9c2b97b9`). The remaining lifecycle/consumer scope is listed at the bottom with
its exact current state, so the next packet can start from the verified layer instead of the source.

**No `P-QUEST-1` packet file exists** in `docs/backlog/packets/`: the backlog row is the only textual record, so the scope
below is derived from that row, `packages/shared/src/quests.ts`, `packages/server/src/sim/quests.ts`, `docs/quests.md` and
the schedule slots the base already reserved (`questAccept` action, `quests.*` hook links, `quests.questSystem`).

## What is live (DONE-VERIFIED)

1. **Catalog as typed rows** (`crates/rh-sim/src/quests/catalog.rs`): the twenty source `QUEST_DEFS` rows with the closed
   verb model `Kind::{Kill, Collect, Fetch}`, optional objective modifiers as typed fields (`region`, `elite`, `players`,
   `tour`, `tokens`, `tokenSpawns`), the effort fields, the historical reward-card fields and the expiry. Registered as the
   `quests/1` content table (every string and number folded), so a quest rule cannot influence a match without moving the
   rules identity.
2. **Reward rules** (`quests/rules.rs`): `questTierPoints`/`parityGv`/`questTier` (including the player-kill tier-1 rule),
   `questBase`, `questRewardCard` with the source feed brake, `questRewardCopies`, `questRewardStats` (zone-matched
   normal-mob row and the 10–20 time-based stack payout), `mobStatText` (JS `toLocaleString` semantics) and
   `questRewardText`, plus `QUEST_REFUSAL` and the accepted/accept-first wording exactly as the source words them.
3. **Roster selection** (`quests/roster.rs`): `selectQuests` over the source private stream — at least two of each verb
   from privately shuffled per-kind pools, a shuffled kind cycle for the rest, and the first ten of a privately shuffled
   order known.
4. **Map placement** (`quests/placement.rs`): `questHomeComponent`, `npcCandidates` (camp/start/hazard/coliseum
   clearances, home walkable component, dense-map relaxations), `spreadSpots` (greedy gap relaxation), the known and hidden
   giver passes with the reveal-radius start clearance ladder, the region-pole farthest-spot pick, collect tokens
   (farthest-camp, outer-start and middle-camp sites) and fetch parcels (farthest reachable zone-tagged site), with every
   piece on the giver's walkable component, off camp halos and off hazards.
5. **Content registration**: the new `QUEST_*`/`FARM_*` rules rows and the `quests/1` table move the content hash to
   `b6f9d4c2aa07e30b`; `tests/content.rs` covers the catalog table and explains the verb/refusal identifier constants.

Nothing in this slice changes serialized state, the tick order, observation, wire or protocol: it is pure data/rules over
the ported map contract (`TileMap` components, terrain, collision, camps/spawnPool/regions/coliseum from P-MAP-1).

## Captured witness

`parity/quests/data.json` (79,403 bytes, SHA256 `c01c045f…`, captured by `tools/quest-fixtures/capture.sh` in the pinned
linux/amd64 Node 22.23.4 container from unmodified source; `--check` re-runs it byte-identically). It records:

- all twenty catalog rows and every reward rule output (tier points, parity GV, tier, base, reward card at feed 0 and 6,
  copies, stat row + stack count, reward text);
- the roster for three declared quest salts;
- placements on the two real generated maps (seeds 1 and 2, verified by seed/attempt/`mapHashU32`): candidate counts and
  a position fold, the home component, and all twenty placements per case including tokens and parcels for three salts;
- the refusal and accept wording for every offer.

The native consumer (`crates/rh-sim/src/quests/tests.rs`) reads the corpus, **regenerates both 160×160 maps through the
ported generator and requires the source `mapHashU32` before comparing placement**, and covers what the corpus cannot:
exact bit-level agreement of every f64 rule output and the roster/placement order. Six committed mutants (tier rounding,
the route premium, the feed brake, the kind-cycle order, the known/hidden pass order, the start-clearance relaxation)
are killed by these tests; the unchanged control passes.

## Commands

```
cargo test -p rh-sim --lib --all-features -- quests::
bash tools/quest-fixtures/capture.sh --check
bash tools/quest-fixtures/run-mutants.sh
cargo test --workspace --all-features --locked   # with PostgreSQL from tools/pgtest/start.sh
```

## Measurements

- Content hash: `b6f9d4c2aa07e30b` (the registered `QUEST_*`/`FARM_*` rules rows plus the `quests/1` catalog table).
- `cargo test -p rh-sim --lib --all-features -- quests::`: 4 passed (catalog+rules, rosters, placements, wording).
- `cargo test -p rh-sim --all-features --test content`: 21 passed with the new golden hash.
- `bash tools/quest-fixtures/capture.sh --check`: PASS (pinned container, byte-identical).
- Mutants (`bash tools/quest-fixtures/run-mutants.sh`): **6/6 killed, unchanged control passes** — tier rounding, the
  route premium, the feed brake, the kind-cycle order, the known/hidden pass order, and the start-clearance relaxation.
- Workspace gate: GATE_TBD. `cargo fmt --all -- --check` and `cargo clippy --workspace --all-targets
  --all-features -- -D warnings`: CLEAN_TBD.

## Remaining for the P-QUEST-1 row (not in this slice)

1. **Accept action**: the schedule reserves `ActionId::QuestAccept` (`Run::Pending("P-QUEST-1")`). It needs a
   `RawCommand`/`ActionCmd` variant through the C-INPUT door (plus a wire/command projection decision), the busy/over/far/
   LOS/already check order from `handleQuestAccept`, and the accepted-set write.
2. **Lifecycle state + systems**: `QuestsRuntime` (offers, published flags, progress/visited-region maps, carriers,
   timers, closed linger) as serialized/hashed world state (checkpoint format bump + hash tape), `spawnQuests` at
   planning/raid start from a private quest stream (deriving `questSaltFrom(rewardSalt)` exactly, source `mixedSalt` "QUES"),
   the `questSystem` slot (hidden reveal radius + head start + tie rank, expiry, closed linger sweep, automatic turn-in
   with range/LOS, camp-clear supply recheck and impossible-kill closure), the `mobKilled`/`playerKilled`/`campCleared`
   progress hooks, `teleported`/`runEnded` close-all and the `dropBody` parcel-drop wrap — every slot already exists in
   `schedule.rs` as Pending with the source link names.
3. **Quest pieces as world objects**: quest NPC givers (source mobs of kind `quest`, currently no native actor kind),
   ground quest-item containers and the parcel carrier link (source `ContainerKind` "quest" + `quest:<id>` items), and the
   pickup override that advances collect progress / starts a fetch carry.
4. **Rewards path**: `awardQuestGv` into the existing quest GV bucket (`credit.gv_parts.quest`, cap `QUEST_GV_CAP`) and
   the mob-stat stack grant through the existing `grant_mob_stat`, plus the `questAccepted`/`questCompleted` hook taps.
5. **Public transport (coordinator-owned)**: the source syncs quest rows, the public accepted/progress/visited sets, the
   carrier and `unknownQuests`; the Rust observation has no quest facts yet. Adding them needs the C-NET set (observation
   fields + wire `StateItem` + fixtures/decoders) and a protocol bump, which this slice deliberately does not touch
   (line A is protocol 7; never bump without the full set).
6. **Tour/feeding and bots**: `tiers`/`tours` progress bookkeeping, bot exclusion (`takesPart`) and the quest HUD text
   transport ride with items 2–5.

## Coordinator files

No `docs/MIGRATION.md`, `docs/CONTRACTS.md` status table or `Cargo.lock` edit; no merge; no protocol bump; no wire change.

# P-QUEST-1 — K1 quests: the data layer (catalog, roster, placement, rewards)

`INCOMPLETE` for the full P-QUEST-1 row; **the quest data layer and the native lifecycle are DONE-VERIFIED** — the data
layer against a pinned-container actual-source corpus, the lifecycle by in-crate wiring tests over the real action/hook/
system slots — stacked on the P-CARDS-3 head (`9c2b97b9`). The remaining scope (a pinned-container lifecycle witness and
the coordinator-owned public transport/NPC bodies) is listed at the bottom with its exact current state.

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

## Lifecycle round (native wiring, verified in-crate)

The source `sim/quests.ts` lifecycle is now ported on top of the verified data layer, with every reserved schedule slot
flipped at its recorded position:

- **State** (`quests/live.rs`): the run's offers (id, catalog row, known, giver spot, tokens/parcel, status, deadline,
  accepted set, progress, tour zone masks, carrier/last carrier, giver presence, published/publish_at/finder, closed_at,
  done_by, container ids), the carried map and the camp-clear recheck flag, plus the private quest stream. Serialized and
  hashed as `world.quests`; checkpoint format moves to `rh-checkpoint/22` (the coordinator will take the union identity
  with the sibling /21 moves) and the ability hash tape is re-recorded.
- **Spawn**: `planningStarted` and `raidStarted` links call `spawnQuests` (idempotent): the stream is
  `Sfc32::from_words(questSaltFrom(rewardSalt))` (`mixedSalt` "QUES"), the roster and placements come from the verified
  data layer, known offers publish at once, and every published offer places its giver presence and its token/parcel
  containers at the raid start.
- **System** `quests.questSystem`: closed linger sweep (20 s), camp-clear supply recheck and impossible-kill closure
  (hidden offers are never closed early, only on their own deadline/teleport/run end), deadlines, hidden reveals
  (reveal radius, tick tie rank, the 4 s head start, publish + placement), and automatic turn-ins (range, LOS, tie rank,
  ready by progress or by carrier).
- **Hooks**: `mobKilled` (region/any/elite/tour kill offers), `playerKilled` (the player-kill offer, died only),
  `campCleared` (recheck flag), `teleported`/`runEnded` (close every open offer; hidden ones vanish, public rows linger as
  expired), and the `dropBody` wrap (a dying carrier drops the parcel where they fall).
- **Accept**: `questAccept` is a real action through the C-INPUT door — `RawCommand::QuestAccept` / `ActionCmd::QuestAccept`
  with the source check order (busy, offer published/open/giver present, accept range, LOS, already accepted) and the
  deadline started on the first acceptance. The client wire message stays coordinator-owned: `rh-server/src/wire.rs`'s
  command projection carries the one documented gap (no quest message until the transport packet), and the headless/policy
  door is what the tests use.
- **Pieces**: quest tokens/parcels are native containers (`ContainerKind::Quest`, one `ItemDef::Quest(id)`) created and
  removed with the offer's lifecycle; the ordinary pickup path hands them to the runtime (collect progress, fetch carrier,
  "one item" carry cap, accepted-first and carried-steal rules) instead of the weapon/potion logic. They are excluded from
  the public item observation (single site in `item_view.rs`), like the rest of the quest transport.
- **Rewards**: `awardQuestGv` semantics (per-player cumulative `QUEST_GV_CAP`` — the quest GV bucket) and the zone-matched
  mob-stat stack grant through the existing `grant_mob_stat`; fill bots take no part in any quest path.

Verified by eight in-crate lifecycle tests driving the real hooks/action/system: raid-start spawn (20 offers/10 known,
pieces placed), accept through `Sim::submit` (far refusal, accept, timer, repeat no-op), collect tokens → progress →
automatic turn-in paying both GV and the mob-stack row, fetch parcel → carrier → dropBody drop, hidden reveal + head start +
placement, deadline expiry + linger sweep, kill progress + camp-clear impossible closure, teleport close-all, and a
checkpoint serialize/restore/perturb round trip for the new state. There are no captured lifecycle frames yet: the pinned
container corpus covers the data layer only (see the remaining list for the exact uncaptured surfaces).

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
- `cargo test -p rh-sim --lib --all-features -- quests::`: **14 passed** (4 data-layer tests + 8 lifecycle tests + the
  checkpoint serialize/restore/perturb round trip).
- `cargo test -p rh-sim --all-features --test content`: 21 passed with the new golden hash.
- `bash tools/quest-fixtures/capture.sh --check`: PASS (pinned container, byte-identical).
- Mutants (`bash tools/quest-fixtures/run-mutants.sh`): **9/9 killed, unchanged control passes** — tier
  rounding, the route premium, the feed brake, the kind-cycle order, the known/hidden pass order, the start-clearance
  relaxation, the accept range, the reveal head start and the turn-in stack grant.
- Checkpoint format `rh-checkpoint/22` (the new `world.quests` and the quest container/item variants); the ability hash
  tape is re-recorded for the new state layout; `hash_coverage` 6 passed with the documented optional quests leaf; the
  content hash is unchanged (`b6f9d4c2aa07e30b`, the lifecycle adds no new registered rule); schedule conformance 14
  passed with the ported quest action/system/links.
- Workspace gate: **1,451 passed, 0 failed, 3 ignored, 151 test binaries, exit 0** (with PostgreSQL; the previous
  1,442 plus the eight lifecycle tests and the checkpoint round trip).
- `cargo fmt --all -- --check` and `cargo clippy --workspace --all-targets --all-features -- -D warnings`: clean.

## Remaining for the P-QUEST-1 row

1. **Pinned lifecycle witness**: no captured lifecycle frames exist yet. The uncaptured surfaces are exactly: spawn
   (offer ids/positions/pieces/known flags at raid start), accept/refusal ordering and the deadline start, hidden reveal
   timing and head start, collect/fetch pickup outcomes and carrier/drop/steal rules, automatic turn-in rewards
   (GV bucket + mob-stack counts), expiry/linger/camp-clear closure and teleport/run-end close. They are verified natively
   in-crate; a pinned-container capture driver is the follow-up (the data-layer corpus already pins the roster/placement
   inputs those frames would start from).
2. **Public transport (coordinator-owned)**: quest offers, accepted/progress/visited sets, carrier, giver actors and
   `unknownQuests`, plus the accept client message, need observation fields and the full C-NET set (wire state items,
   protocol bump, Rust/C#/JS decoders) before any protocol version change. The two documented single sites are
   `crates/rh-sim/src/item_view.rs` (quest props excluded) and `crates/rh-server/src/wire.rs` (no `questAccept` message);
   the live `room.rs` config keeps `quests: false` until that packet lands.
3. **Quest giver actor bodies**: the sim tracks giver presence as quest state (`npc_alive`); the source spawns a mob of kind
   `quest` (render/target/collision body). Adding that native actor kind and its observation facts rides with item 2.
4. **Toast/reveal event transport and telemetry taps**: the sim emits no toasts, `questReveal` or the
   `questAccepted`/`questCompleted` hook taps; those are presentation/telemetry surfaces for the same transport packet.
5. **Tours/tiers beyond the kill offers and the feed/quest-card legacy fields** stay as registered catalog metadata; the
   active rewards are the GV + mob-stack channels the source now pays.
6. The release script/CI capture wiring for `tools/quest-fixtures` (data layer) and a future lifecycle driver.

## Coordinator files
## Coordinator files

No `docs/MIGRATION.md`, `docs/CONTRACTS.md` status table or `Cargo.lock` edit; no merge; no protocol bump; no wire change.

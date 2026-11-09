# Connected bot memory / scheduling / world-goal prefix

Private base: `6db02195abab67d9867f6340cc61a8dc7d4f6114`. This is a connected `rh-policy` behavior
slice, not full advanced-brain admission. No simulation, protocol, client, content, identity header,
lockfile or shared-status record changes. Source code and all existing corpora remain unchanged.

## What actually runs

`HumanBot` now folds the observed-player/owner-motion prefix before deciding, consumes its reentry-aware
stimuli, retains a goal, runs strategy/tactics on the source coordinator's deadlines and salient/status
conditions, and sends released commands through its existing `PublicCommand` path. Its roam goal uses
the source world executor, including arrival, settling and unreachable results. Real Seat tests exercise
`drive_seats_with` -> ItemObserver -> validate -> Sim::submit, without fallback, twice identically.
Roam also executes/validates ordinary moves over 100 steps and queries the actual retained path service.
Idle and non-coliseum hold are complete executor branches, checked against source; the current provisional
candidate generator does not ordinarily select them except idle when no map exists. This is not a claim
that a complete source strategy already generates hold goals.

The existing nearest-player / nearest-regional-mob / random-roam candidate selection and combat executor
remain explicitly **compatibility** behavior. Goal selection is not a port of strategy.ts. Wish remains
the existing module, now arbitrated through the source scheduling/channel seam. The prior compatibility
engagement predicate (owner attack lock) remains; full trade-aware source `isEngaged` is pending.

Existing `delivered.rs` is unchanged: it still accepts a codec-shaped owned decoded subset and makes no
network-delivery attestation. `memory_prefix.rs` exposes an explicitly copied `Scene` for the policy and
shares one fold kernel with that existing diagnostic path. It does not manufacture a protocol13 delivery
from an Observation. Source-clock refusals are atomic before perception/brain/RNG changes. Equal or
backward source times retain the prior prefix's explicit-reset requirement; a future FrameRing/reordering
or training-reset adapter must resolve its lifecycle explicitly, not substitute tick-derived time.

## Exact component evidence

`parity/policy/bot-brain-prefix/source.json` is captured by pinned linux/amd64 Node22.23.4 using the
unmodified actual source `createMemory`, `createWorldTactics` and `createBrain` APIs. All inputs/services
are **labelled declared component rigs**, not live producer, socket, browser, game or tournament proof.
The complete shared/bots TypeScript source closure, package lock, image and capture tool are pinned.

- Nine memory sequences / 63 frames: owner anchor strictly greater than1u, first sight, weapon changes,
  empty hand, hidden-suspect versus edge disappearance, 3-second reentry, permanent death, hp forgetting
  and tier position expiry. The native consumer compares all projected records, stimuli, whereabouts and
  motion history, not only one selected result. Missing names/tags/draws/events are outside this projection.
- Five real `noteSent` calls: move/stop/target replace last order, cast replaces last cast, swap does neither.
  The native policy records only commands it actually emits. Pending reflection/arrival, pickup feedback
  and source movement sequence stamping are not claimed. The source API permits the declared no-seq calls.
- Thirteen stateful world steps compare every output intent, priority/timing/reason/status/attacking field
  and walk-query count: arrival/settling, walking/refusal, idle, wait/ambush hold, retries and stale slots.
- Three real `createBrain` coordinator sequences / 483 frames compare actual source strategy/tactic call
  timing and original RNG returns, including salient memory stimuli, toast forcing and blocked/done/failed
  status. The declared module dominates candidates and emits no commands; `lapseP:0` is an explicit rig
  override. Its observe hook wraps the provided RNG functions, forwards original returns unchanged and adds
  no draws. Source strategy remains opaque: native tests consume its recorded excluded draw counts before
  the cadence draw. They do not claim to reproduce its scoring or use copied cadence formulas as expected
  deadlines. Native source cadences must independently produce the same actual callback schedule.
- Four source arbitration cases observe the actual private `mergeIntents` through a non-module idle goal
  and the public module `adjust` callback, before humanizer submission. These compare first accepted extra,
  equal priority and order/cast channels. A targeted native control also checks the complete closed-channel
  priority rule; not every theoretically possible base/channel combination is source-witnessed here.

The connected native controls cover same observations/seed, actual validate/submit, reset, another seat's
independent activity, varied hidden geometry/weapon/hp/bounty, typed noncombat categories, duplicate-clock
refusal atomicity and per-frame path search counts. Existing source humanizer/Wish/Knowledge/path/planning/
hazard/decoded-memory tests remain in the 99-test policy library gate. This is not a zero-allocation claim.
The existing path quota is **8 per seat per frame**, not proof of the source room-shared quota.

Five semantic native mutants fail the actual-source consumers: reentry cutoff, inclusive roam boundary,
salient NewThreat, first-extra arbitration and an extra decision RNG draw. Compiler failures do not count
as kills. Comment-only and restored controls pass. `mutants/results.json` binds the corpus hash.

## Reset RNG mismatch remains open

`HumanBot::reset` deliberately retains its pre-existing streams:

- motor: low32(seed) XOR `0x9e3779b9`;
- lapse: high32(seed) XOR `0x85ebca6b`;
- decide: low32(seed) wrapping-multiplied by `0x27d4eb2d`, XOR `0x1b56c4e9`;
- Knowledge: `derive(low32(seed),3)`.

Actual source brain.ts creates decide/motor/lapse from `derive(seed,0/1/2)` and Knowledge from tag3.
The prior Knowledge repair intentionally preserved the already running front-end stream rather than
moving all later decisions by its former70 construction draws; its regression certified isolation, not
correctness of tags0/1/2. This packet preserves that compatibility decision as instructed. The source
coordinator component test uses the true source-derived controlled stream; the real HumanBot determinism
control uses the retained native seeds. They are distinct claims. New scheduling draws change native
behavior even though reset seeds are preserved. Whole-brain source command/tournament equality remains
unproved until root reconciles stream derivation and its downstream traces; this is not waived forever.

## Exact remaining work / adaptation seams

- Full `memory.ts`: event hp credits, trades, locks/orders/reflection/arrival, cast/feint history, NPC/camp/
  container/minimap memory and extra modules. Current HP-loss heuristic is still compatibility behavior;
  LowHp now follows the actual source half-hp downward crossing rather than repeated persona-threshold spam.
- `frames.ts`: self/world delay,100ms motion sampling, cuts, once-only timed FX/projectile births/stops,
  immediate delivery, history bounds and actor-reference epoch lifetime. This prefix is instantaneous and
  must not be described as network/render parity.
- Stateful MobHunter/BuildRoute/huntAdapter, full strategy candidates/scoring/hysteresis/chase breaker and
  fight/flee/reflex/orb-walk/coliseum-hold/loot/chest executors. Existing files mostly contain helpers,
  not those complete consumers. `bot-tactics.json` is a path corpus and its name is not tactics proof.
- Required fact decisions include owner mob-kill/stat history, mirrors/draw timing, public immunity,
  launch/end/event timing, item continuity, minimap and held counts/winner semantics. Owner build counts
  cannot reconstruct actual mob-kill history. No missing fact is introduced by this patch.
- Hazards remains the reused, unmodified detached prefix: the policy still needs an honest actual-mode
  disclosure/adapter before activating it. Public map terrain alone does not prove effects are enabled.
- QG Slice1 adaptation is isolated in `perception.rs::actor_class` and `memory_players`: replace numeric
  classification by exhaustive `ActorKind::{Player,Regional,Zombie,Dummy,QuestGiver}`; only the first two
  enter current goal candidates. Player faction extraction must use checked `faction_id()` and optional
  weapon extraction preserves None/Fists as unarmed. Neutral must never become fake Fire or a farm target.
  The current negative controls use kinds2/3/4/unknown; adapt their types when root composes b4d209fe.

Root owns merge, final policy/header/content identities and later end-to-end evaluation. No broad
workspace/map/source campaign or tournament was run for this packet.

## Reproduction

Use the repository's pinned Rust toolchain and set `CARGO_BUILD_JOBS=1`, a private `CARGO_TARGET_DIR`
and private `RH_PGTEST_STATE` **after** sourcing any shared environment file. Do not use root final-target.

```sh
tools/bot-brain-prefix-fixtures/capture.sh --check
cargo test -p rh-policy --locked --lib
python3 tools/bot-brain-prefix-fixtures/run-mutants.py
cargo clippy -p rh-policy --all-targets --locked -- -D warnings
cargo clippy -p rh-policy --all-targets --all-features --locked -- -D warnings
cargo fmt -p rh-policy -- --check
```

`capture` writes only the new corpus directory; `--check` bytecompares. Mutation controls must run in an
isolated checkout with no concurrent compilation; files are restored in finally. `checks/` contains exact
revision-scoped logs. `attempts/` preserves the initial source harness's real strategy exclusion failure and
the later borrowed-array capture diagnostic: copying the source record at capture time repaired the harness,
not the native expectation. No older source expected values were rewritten.

Portable log copies strip only trailing blank lines; original untrimmed attempt/check logs remain
in the private packet directory outside Git. The source corpus itself is byte-exact and unnormalized.

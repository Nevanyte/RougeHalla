# Native trader public flow (private candidate)

Base: frozen quest-notice candidate `ea99b12429398f4e9b34c02d55b447bb30f9aca8`.
This candidate completes native trader input, private feedback, and observations. Public wire,
server admission, client UI and the final observation/policy/format union remain coordinator-owned.
It assigns no header/version, content identity, tape, protocol tag or shared status record.

## Authoritative path

`PublicCommand::Trade { merchant: traders::Kind, pick }` names either of the two fixed catalog
merchants. `ItemObserver::resolve` lowers it through the existing `RawCommand::Trade` validation;
`Sim::submit` and the ordinary input queue execute the existing handler. This command neither
requires nor creates a combat actor reference, item/quest handle or hidden identity binding.
Source range/LOS/status/phase/used/cooldown/inventory checks remain authoritative. A guessed fixed
catalog kind receives exactly those checks; observing a merchant is not a new gameplay prerequisite.

`Observation.trade` contains only the selected seat's saved parsed offers, accumulated trade stat
deltas, used flag and optional existing barter deadline. These facts remain available after the
merchant leaves sight. Separate `MerchantView { kind, at }` rows use ordinary `point_visible`; they
have no combat actor ID, HP, faction, weapon, brain or target reference. Names are fixed catalog
metadata. No observer rolls offers, recomputes modifiers, changes prices/state or consumes RNG.
Reused output buffers erase the previous owner's rows. Only the selected owner's malformed numeric
facts cause typed `OfferError::Trades(InvalidOwnerState)` refusal; foreign private rows are not
validated or disclosed. Trade admits bots as the source does; the quest bot exclusion is not reused.
The existing `config.quests`/nontraining activation boundary remains unchanged.

All source trader feedback is `Event::Toast { to: Some(owner), ... }`, except the already existing
successful potion grant's `PotionNotice::Stored`, which is preserved before the final barter receipt.
No duplicate potion notice, generic event, feedback cache, presentation timer or `can_trade_now`
rule is introduced. The existing Committed `LockSecondSlot` accessor/fold is reused unchanged.

## Captured source evidence

No fixture or source capture is regenerated or edited. The native source-action test runs the real
constructor/join/first step, declared source inputs/setups, and real producers. Expected outputs
are assertions only, never installed as runtime outcomes.

| Immutable corpus | Cases / claims | SHA-256 |
| --- | --- | --- |
| `parity/trade/runtime.json` | Existing six state replays, including real Committed grant refusal | `a03bfd021997c99e60a1cf1307c34dabef1bd1dd6c1c75d78ecd0818ad0805e1` |
| `parity/trade-public/doors.json` | 17 action recipes; 18 actual feedback rows, exact recipient/text/order; own quotes/deltas/used/cooldown/inventory/tick | `2ace515574261ef6d092cf8e973f8df0c0218a462037ab707badc73540ac5cc5` |
| `parity/trade-public/schema-receivers.json` | Source schema/receiver disclosure evidence, not native wire equivalence | `ca15081396b494009d0bdf09c46942ae04dd5930133e7f4a68b4ffce6824ca8f` |

The source17 profile is explicit Full abilities + Map hazards, signatures Off, FireRoam Off, mobs,
quests and initial loot enabled, source arena lifecycle, regen/PvP disabled. Source setup moves
players, changes weapons/potions/status, grants Committed through the real card producer and uses
one declared wall for LOS. That wall uses the test-only collision fixture which rebuilds collision,
nav and padded caches; the resulting declared fixture is not claimed canonical. Source method
setup forcing phase Ended still has the known source retained-action/native drained-action queue
difference. This candidate compares its silent feedback and unchanged owner outcomes, not intake
queue parity or whole-world event equality. The unknown legacy trader string is unrepresentable in
the native fixed-kind grammar: the native invalid raw kind is rejected before submission, and the
quiet step is compared only for feedback/outcomes, not identical intake/budget semantics.

The source publicly syncs every player's `tradeOffers`, `tradeStats` and `tradeUsed` even though
its panel reads only `frame.me`. This native owner-only view intentionally closes that foreign-offer
disclosure under C-OBS. It is a privacy repair, not a claim of legacy wire/schema parity. The source
700 ms panel latch, real DOM/rendering, socket/session checks and current client transport are not
exercised by these native tests. The source's unreachable ordinary-cycle `already hold` branch is
ported literally but no fabricated fixture is presented as captured branch coverage.

## Native controls and integration limits

Focused native tests cover owner versus foreign state and recipients, a genuine bot join, missing
seat, hidden merchant positions, saved quote stability after leaving sight/reconnecting, same output
buffer reused between owners, observation preserving serialized state/RNG before and after contact,
first-contact wait-before-roll, own typed invalid-fact refusal versus irrelevant foreign invalid data,
Committed no-spend/no-cooldown refusal, and invalid-pick intake refusal.

A headless external session uses real deterministic merchant producers and ordinary typed initial
placements. Its fixture reads a probe checkpoint only to find the seed's navigation position; no
trader, quote, cooldown, result or reward is inserted. Actual `Env.step` executes stat acceptance,
repeat refusal, barter acceptance/cooldown refusal, owner feedback and restored-session saved facts.
It does not exercise sockets or a client decoder.

No authoritative state layout is added. The native observation/input API is unpublished and changed;
coordinator observation/policy/format reconciliation and a checked server transport boundary are
mandatory before public activation. Frozen server/protocol/client files are intentionally untouched
here. In particular, an old adapter must refuse this unsupported trade shape rather than silently
publishing an incomplete frame. Source-to-public/client gameplay admission stays held for that union.

## Earned-trade restore correction

The actual headless trade producer exposed an existing validator bug: a legitimate Armor cost of
9.4 produces folded/cached armor −9.4 (wire −94), while `Runtime::valid` formerly imposed an absolute
−6 (wire −60) floor. The sole correction is a lower bound of
`encode_flat(folded_armor_bonus − AXE_SHRED_CAP)`. Exact fold equality, integer mirrors, upper bound,
Frost passive and every other stat remain unchanged. This admits legitimate negative folded armor
and tightens the lower bound for positive folded armor; it is not a general range relaxation.
No state field, cache, serialization, header, source fixture or gameplay fold changes.

Real accepted negative- and positive-armor trades exercise canonical restore and continuation.
For each real checkpoint, one-cache-field controls below the relative lower bound and above the
exact upper bound are refused (four rejections); successful expected outcomes are never installed.
The production bound correction is committed separately from the broader public-flow leaf.

## Recorded checks

Production/test head: `261b9af22f30c7be60dc23bbf49edf86c7a2d346`.
Separate armor-bound correction: `5f7444ee48ec52c940312c8a576dd8386abae0ba`.
All commands use `final-env.sh` and this worktree's dedicated `CARGO_TARGET_DIR`.

- `cargo test -p rh-sim --lib traders:: --features trusted-status-probes`: 8 passed,
  including all six existing source state cases and all 17 source action cases / 18 feedback rows.
- The follow-up `traders::view_tests::owner_quotes` run after adding recipient controls: 1 passed.
- `cargo test -p rh-headless --test trader_public`: 2 passed after the relative armor correction.
- `cargo test -p rh-sim --lib modifiers:: --features trusted-status-probes`: 6 passed after that correction.
- Scoped `cargo clippy -p rh-sim -p rh-policy -p rh-headless -p rh-parity --all-targets -- -D warnings`:
  passed, also passed with `--all-features`.
- `cargo fmt --all -- --check`: passed.

The state/action tests precede the restore-only bound correction; their gameplay/producer code is
unchanged. The earned-state headless restore, affected modifier controls and both strict lint modes
run after it. No unchanged whole-source/workspace campaign is repeated. Source/profile limits and
public admission holds above still apply. Check logs and file hashes are in `manifest.json`.

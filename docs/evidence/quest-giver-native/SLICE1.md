# Neutral actor representation prerequisite (private Slice 1)

This candidate continues private union `5321bc4d3c1393cf0afee4d3b30af45aab75d384`. It introduces an honest neutral actor representation; **quest giver births are still disabled**. It is not the completed native quest-giver port, Full/public quest admission, or an eight-case source comparison.

`FighterAffiliation::Faction(FactionId) | Neutral` keeps the five faction content rows. Actual player reads use a validated `Player::faction()` facade; restore checks player and mob affiliation/brain classes before any faction facade or regional brain consumer. Real regional/practice brains are `Some`; source-passive dummy/zombie/giver actors carry `None`, with zombie behavior retained in its existing typed runtime. No whole retired body or signature cache is invented.

`ActorKind` is a native enum. A giver's native actor view contains neutral affiliation and no weapon, rather than an observed Fire/Fists kit. Self/player faction and weapon stay concrete. Native headless digest and bot perception handle this representation explicitly; neutral scene actors do not become bot combat/hunt candidates. No public numeric giver tag is assigned. The protocol13 adapter refuses giver, neutral, and unarmed views before publisher conversion/cache work; it neither drops bodies nor substitutes values. The existing `config.quests` gate remains closed before preparing observer offers, including reconnect/resync callers.

The optional faction-spec accessor excludes source actors with no FactionSpec. Defense is zero without a spec, including modifier defense. Real zombie attacks retain their own profile. Generic cadence uses the source's explicit no-spec result zero (`packages/server/src/sim/factions.ts:507–510`); generic afterDamage windup bookkeeping retains the source's special zombie timings (`combatant.ts:122–126`). These are distinct operations. Other Full signature/diagnostic/combat fixes remain owned by the separate Full source worker and must be composed before lifecycle Slice 2; this candidate only makes necessary local type adaptations at those sites.

Affiliation serializes through `Option<FactionId>`: JSON keeps the existing faction strings and neutral null, while the canonical serializer hashes an explicit Some/None marker. Optional Brain similarly changes canonical words. **The root-reserved checkpoint28/replay22 registration is required before admission.** This worker intentionally leaves the private branch's current checkpoint27/replay21, OBS20/policy14, content, tapes, wire13 bytes/tags, fixtures and shared records untouched.

## Verification

The receipt records exact tested source-file hashes and log hashes. All commands use `final-env.sh` followed by an isolated `CARGO_TARGET_DIR`.

| Gate | Result |
|---|---|
| `cargo test -p rh-sim --lib neutral` | 5 passed: four new constructor/view/hash/restore checks plus one existing Frost test selected by the filter |
| `cargo test -p rh-server --lib neutral_giver` | 1 passed: unsupported native kinds/factions/kits refuse on normal, spare/full-delta and fresh publisher paths without caching a prefix |
| `cargo test -p rh-sim --lib quests::` | 18 passed, including existing captured quest lifecycle/placement consumers |
| `cargo test -p rh-sim --lib systems::training` | 14 passed, including existing captured training corpus and restore/Clone growth regressions |
| `cargo test -p rh-sim --lib systems::mob_life --features trusted-status-probes` | 3 passed, including existing captured hooks/rewards/180-second respawn |
| `cargo test -p rh-sim --lib systems::plague::` | 2 passed, existing actual-source direct ledger matrix plus its schema/provenance guard |
| Strict Clippy, sim/server/policy/headless/parity, all targets | Default and all-feature modes passed |
| Formatting / whitespace | `cargo fmt --all --check`, `git diff --check` passed |

These are scoped gates, not an aggregate full-workspace claim. No Unity, browser, cloud, performance, new source capture or golden/tape update was run.

## Remaining Slice 2

Wire actual offer→giver links, global birth before parcel/token containers, real stationary history/terrain participation, giver-specific hostility/status/immunity and clean retirement with retained provenance. Add strict crosslinks/canonical restore, birth headroom and late scratch preparation; consume all eight already-admitted source cases without rewriting their outcomes. Public successor schema/activation remains root-owned. Source `rt.fighters` cache lifetime after removal is not exposed by the existing eight-case corpus and is not claimed from diagnostic snapshots.

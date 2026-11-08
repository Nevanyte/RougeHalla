# Unity presentation contract

This is the presentation inventory and implementation boundary for the Unity browser client. It does not implement cues, authorize final art, change gameplay, or claim full-game/Unity parity. The canonical, machine-checked cue list is [presentation-inventory.json](presentation-inventory.json); the exact outstanding public-data work is generated as [PROTOCOL_GAPS.md](PROTOCOL_GAPS.md).

## Source and version inspected

- Legacy presentation source is `packages/client` at `7e131bac788a6d654ebfdeb3b6ab02b7771f704c` (the workstream base). Every cue names its real legacy file and symbol. Pure layout/model/stylesheet modules are either included in an owning cue or explicitly excluded with that owner.
- The base checkout and its Unity netcode describe protocol 6. That is **not** the protocol version used for this contract.
- Current upstream source was inspected read-only from `origin/deepseek/rust-completion` at **`9f79a3acbe8dbf67ebde52df4657ef4a38ceaa3b`**: `PROTOCOL_VERSION = 7` in `crates/rh-protocol/src/lib.rs` and `OBSERVATION_VERSION = 16` in `crates/rh-sim/src/observe.rs`.
- Protocol names in `trigger` and `protocolUnused` come from that revision's `WireSelf`, `WireActor`, `WireEvent`, `WireFx`, `WireResult`, `MapBlob`, keyed-State records, `Observation`, `SelfView`, `ActorView` and `SeenEvent`. `crates/rh-server/src/wire.rs` was also inspected read-only to distinguish wire omissions from explicit refusals.
- The CLI checks that the named upstream ref still resolves to the reviewed commit and that `packages/client` still matches the legacy revision. An upstream or legacy change therefore fails until the inventory is reviewed and re-pinned deliberately.

No DeepSeek-owned source, protocol fixture, shared status table or central ledger is changed by this workstream.

## Entry meaning

Every inventory entry contains all of the following:

| Field | Contract |
|---|---|
| `id`, `category`, `cue` | Stable mechanic identity and the complete player-facing cue or closely coupled cue family. |
| `legacySources[]` | Real `packages/client/src` path and symbol for each source that owns the cue. |
| `trigger` | `protocol` names an actual inspected event/field; `client` is local input/settings/session presentation; `external` is an authorized HTTP/account/hosting flow; `legacy` identifies a legacy cue whose current public trigger is absent. |
| `trigger.consumption` | `consume` is available public consumption; `blocked` means present in observation/transport code but omitted, incomplete or refused for this cue; `unused` is an explicit non-cue classification; `not-applicable` belongs to nonprotocol triggers. |
| `timing` | The event tick, snapshot/State application, interpolation, lifetime, countdown, expiry and reduced-motion rule. |
| `privacy` | Who may perceive it and what must happen when an actor, target, endpoint or prop is hidden or out of sight. |
| `nonHueCue` | Required shape, text, icon, number, pattern, position or other non-colour channel. This is a requirement even where legacy used hue alone. |
| `status` | `available`, `missing-in-protocol` or `missing-mechanic`, as defined below. |
| `protocolNeeds` | Exact per-mechanic missing `events`, `fields` and `mechanics`; the checker alone renders these into the gap report. |
| `notes` | Scope limits, related entries and known partial slices. |

`available` means the necessary public mechanism/fact exists at the inspected source boundary. It does **not** mean the Unity cue is implemented, visually complete, browser-tested or performant. `missing-in-protocol` means an authoritative mechanic exists at least in bounded native form, but observation/wire/external data needed by the legacy presentation is absent, omitted or refused. `missing-mechanic` means the producer/flow itself remains unported; its protocol needs are still listed so implementation cannot silently stop at an inert panel.

The `protocolUnused` list is an exhaustive explicit classification for fields/events without an independent entry trigger. Its reason names the aggregate consumer where one exists (for example `WireResult.outcome` belongs to `results.core`) or why the value is metadata/input acknowledgement rather than a cue. No protocol member may be silently omitted.

## Authority and privacy are presentation constraints

Unity supplies presentation and input only. It must not calculate combat, damage, collisions, projectile hits, cast acceptance, cooldown spending, quest/trade outcomes, mob AI, builds, rewards or any other game rule. The only movement-prediction exception remains the separately verified, server-corrected Rust-vector path; this contract does not activate it.

The following rules apply to every entry, including particles, light, shadow, animation, audio, minimap and edge UI:

1. Render only `SelfView` and entities/facts delivered for that observer. A public roster, camp count, event id or result is never permission to create a hidden actor/contact.
2. `Option`/redacted source and target fields stay absent. `WIRE_NO_SOURCE` is not an actor id. Observer-local pickup/reward/actor handles are not global runtime identities and cannot be used to discover concealed objects.
3. Hidden actors lose all dependent cues: body, shadow, light, particles, status art, telegraph, target ring, projectile target, sound, minimap dot, edge indicator and objective marker. The owner-only faint hidden self is the legacy exception.
4. `CastStarted`/`CastLanded` already redact hidden targets and coordinates in observation 16. Unity must also stop an existing beam/ring if an endpoint becomes hidden; it cannot recover the point from history.
5. Hits use the public per-step contribution. Private delayed signature windows, exact private damage rows, hidden sources and concealed recipient healing never enter presentation.
6. Static map, zone, camp and public respawn facts may remain visible under fog where legacy says so. They never include live mob/player positions. Ward/hunted vision remains actor/cell scoped exactly as delivered.
7. Secret deals, hidden quests/offers, chest rolls, drop contents, credentials, tickets, resume tokens, RNG and server-private diagnostics are never presentation inputs or logged output.

Client-side culling is defense in depth, not a replacement for server observation filtering.

## Timing and lifecycle contract

### Clocks and channels

- Rust advances at fixed 20 Hz: one tick is 50 ms. Snapshot server time is derived from `tick`; protocol Fx/Events/State frames carry their own tick/timing facts. Presentation never advances authoritative time.
- Remote actors use the existing 70–150 ms adaptive render delay, starting at 100 ms. Render time never runs backwards. Starved actors hold the newest sample; there is no unbounded extrapolation.
- A snapshot scalar may be newer than the delayed body. Keep HP/status/death presentation aligned as specified by the entry; use `displace_seq` for authoritative interpolation snaps rather than inventing a teleport rule from distance.
- `StateItem.*` collections are complete per-key replacements. Missing keys retain; explicit empty values clear. Welcome/resume/resync must establish complete current state without relying on a missed event. Handles belong to the observer epoch and are rebound only through the lawful observer flow.
- Reliable `Events` drive one-shot deaths, refusals, results and public announcements. Droppable `Fx` may be lost under backpressure, so persistent State/Snapshot indicators must remain sufficient for current gameplay state. `Result` is idempotent and may be resent after resume.
- Legacy Fx queuing is preserved as a presentation rule: play when render time reaches the event; if unsynchronized or more than 1000 ms in the future, play immediately; drop events more than 2000 ms stale. Camera/impact juice is limited to fresh events within 250 ms so a stalled tab does not replay a burst of shakes.

### Telegraphs and effects

- `WireFx.Swing` presents the landed sector; it does not prove that a future hit occurred. A real windup requires the exact missing `Windup { by, weapon, a, ms }` public path in `combat.windup`, followed by swing/cancel/stagger/death/teleport cleanup. Never infer remote windup from `ready_in_ms`.
- Wish cast art requires `CastStarted`, `CastLanded` and `CastEnded` with their actual observation fields and explicit visibility. Local cast previews expire/reconcile as `wish.cast-input-lifecycle` specifies and never decide acceptance or outcome.
- Fields appear at `started_at`, use delivered geometry/velocity on render time and disappear/fade at `ends_at`. They never move gameplay hit areas in Unity.
- Persistent `EFFECT_*` and signature bits follow the latest delivered state. One-shot application/hit cues require their own events; a set bit must not replay a burst every frame.
- Projectile State currently supplies visible current points only. Stable launch/homing/end presentation requires the explicit `projectile.*` additions. Interpolation is allowed; client collision, homing simulation and impact decisions are not.

### UI and local presentation

Local loading, settings, route drawing, menu focus, camera peek and hover feedback may respond immediately to local input. Any authoritative action remains pending until its server State/event arrives. Reconnect, timeout and expiry paths must remove stale previews rather than leave them as false confirmations.

## Non-hue, reduced-motion and quality requirements

Every entry has its own non-hue requirement. The shared minimum is:

- Factions/zones use names plus distinct glyphs, silhouettes, hatch or dash patterns. Mob roles/elites retain shape marks. Weapons/projectiles retain distinct silhouettes. Statuses and signatures retain their unique icons, rings, chains, stars, crystals or other geometry.
- Damage, healing, cooldowns, chests, camps, quests and results retain text/numbers. No critical state is encoded only by red/green, saturation, brightness, bloom, motion or sound.
- Telegraphs, cast rings, field boundaries, HP bars, target rings, hidden/untargetable state and gameplay geometry remain on every quality tier.
- Reduced motion removes screen shake and effect travel, freezes orbiting/growing/swirling art at a readable static geometry, and preserves event duration and all essential indicators. Flash intensity has its own setting; disabling it does not remove the underlying shape/text.
- Text scaling, minimap scaling, keyboard focus, ARIA labels/meters/status and accessible error/result text are required. The legacy edge indicator's hue-only distance encoding must gain the directional shape/text specified in `vision.edge-indicators`.
- Quality tiers and renderer fallbacks can remove decorative lights, particles and post-processing only. Nothing at any tier may expose an actor absent from the observation.
- Assets may be redesigned under `docs/VISUAL_DIRECTION.md`; this contract records cues, not final art. Asset provenance and actual Unity performance/browser evidence remain separate gates.

## Coverage map

The JSON is intentionally finer-grained than this index. Each row below points to the owning entry prefix/family; all details, exact source symbols and gaps are in the JSON.

| Presentation surface | Inventory families |
|---|---|
| Map, terrain, zones, features, gates, projection, camera and rendering quality | `map.*`, `render.*`, `terrain.feedback-chips` |
| Player/mob bodies, names, cosmetics, weapons, HP, bounty, role/elite art, zombies/corpses | `actor.*`, `mob.*`, `plague.*` |
| Windups, swings, cancellation, hit/crit/signature/ability numbers, block, stagger, death, heal and screen feedback | `combat.*` |
| Current projectiles, launch/recoil/homing and every `projEnd` reason | `projectile.*` |
| Trial zones, Blaze trails, Swarm clouds and field lifecycle | `field.*` |
| Every `EFFECT_*` bit, application burst, immunity and shred | `status.*` |
| Burning, chill, disease/execute, brand, mark plate and execute-blocked presentation | `signature.*` |
| Wish owner HUD, input/confirmation/end lifecycle, Freeze, Trial, Swarm, Blaze and Last Stand | `wish.*` |
| Target hover/lock/range, visible loot/focus/refusals, consumables and cannons | `target.*`, `loot.*`, `consumables.*` |
| Reward chest world timer, choice panel, refusal and own-taken toast | `chest.*` |
| Selected/full builds, cards, passives, opponent inspector, map roster and Fire roam | `cards.*`, `build.*`, `fire.roam` |
| Camp markers/rewards/clear/heal/wards/patience/respawn | `camp.*` |
| Quest givers/items/carriers, log/dialog, toasts, minimap and planning objectives | `quest.*` |
| Minimap terrain, live contacts, chests/camps, route and pointer flow | `minimap.*` |
| Vision culling, fog/trail, wards, hunted actor and non-hue edge indicators | `vision.*` |
| Planning deal/ready/timer, route shell and hold-Tab map | `planning.*` |
| HUD vitals/status/arena/death, core/full results and toasts | `hud.*`, `results.*`, `toasts.*` |
| Reconnect/errors/reload/loading, settings/accessibility/performance, hub/menu/lobby/training | `connection.*`, `settings.*`, `accessibility.*`, `menu.*`, `hub.*`, `lobby.*`, `training.*` |
| Audio absence and future privacy-safe accessible decision | `audio.decision` |

There is no legacy audio implementation to reproduce. Future audio must reuse an authorized cue trigger, obey that cue's visibility/timing and retain the visual/non-hue channel; it must never become a hidden-actor detector.

## Checker and generated output

Run from the repository root:

```sh
node tools/unity-readiness/check-inventory.mjs
node tools/unity-readiness/check-inventory.mjs --check
node --test tools/unity-readiness/check-inventory.test.mjs
```

The first command validates and writes `docs/unity/PROTOCOL_GAPS.md`. The second validates and fails if the existing generated file is missing or differs byte-for-byte. Any unknown/missing schema key, missing legacy symbol, unowned render/ui/Fx/Stylesheet module, unclassified current protocol member, version mismatch, invalid status or source-pin drift exits nonzero and does not write output.

`PROTOCOL_GAPS.md` is generated only by this checker. Never hand-edit it. DeepSeek follow-up should consume its exact per-mechanic Events/Fields/Mechanics lists while preserving the privacy and timing constraints above.

## Evidence boundary

Existing evidence proves a selected protocol-6 MVP loop, not this full presentation surface. In particular, full Wish and Source arena/planning observations are explicitly refused by the inspected protocol-7 adapter; stable projectile identity/end events, public map layers, trail cells, quest/trade/training flows, full build/result details and several one-shot cues remain open. The generated report is the authoritative list of those gaps. No full-port, final-art, browser-matrix, performance or release claim follows from this contract.

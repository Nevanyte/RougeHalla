# Fair-observation admission review

Coordinator review, 2026-11-08, against `0fa50eeb`. Three independent read-only audits checked the retained
[proposal](../evidence/stage2-bots-brain/OBSERVATION_PROPOSAL.md) against current code. **The broad leaf/event proposal
is not approved.** This record authorizes no schema, event visibility, wire or gameplay change. Current identity remains
observation17/policy13/protocol11; no next version is reserved by this review. Preserve the paused experiment separately.

## Findings that determine sequencing

| Proposed input | Current evidence and disposition |
|---|---|
| Active item / `in_hand` | Already conveyed by `ActorView.weapon` and the human weapon enum. `Fists` can map to an empty-hand compatibility value. No new observation leaf is needed. |
| Exact `ready_at` | Native observation has a remaining clock; human wire floors/caps it to u16 milliseconds. A reconstructed deadline is not the source's absolute historical timestamp. Exact parity needs an explicit transport decision. |
| Barrier, bow draw, immunity, self multiplier mirrors | Authoritative runtime exists, but the proposed exact fields are absent from human protocol11 and C# views. Do not grant policies the values under a "no wire change" assumption. Legacy multiplier mirrors decode thousandths. |
| Names and BOT tag | No delivered canonical player-name/tag table exists in this transport. Requested Hello callsigns are intent, not canonical delivery. A static regional-mob catalog label may be derived from an already-delivered mob type; this does not supply arbitrary names or tags. No bot-tag-dependent decisions. |
| Actor barrier/immunity | Source barrier fractions use `max(maxHp, hp+barrier)` before bar quantization. Source `fighterSeen` emits derived boolean immunity, not the proposed absolute timestamp. Specify the intended public precision and render-time semantics first. |
| Run counts | Legacy `perceive()` counts all stored player rows before sight filtering. An unseen death can change Alive. The proposal's unchanged-hidden-count control contradicts this positive behavior. These counters are absent from current Observation and human wire. |
| Winner | Legacy stores a display name, not a player ID. Current reliable MatchEnded carries an ID/draw notification, but no durable owner-observation winner name. Missed events/resume and retained winner identity need an explicit projection. |
| Event stream | Raw simulation events, filtered native SeenEvents, and delivered protocol11 Fx are different surfaces. Full perception cannot assume they are interchangeable or infer originating event time from the latest observation clock. |

Primary source anchors: `packages/server/src/bots/brain/perception.ts` (`selfView`, `fighterSeen`, `perceive`),
`packages/shared/src/schema.ts`, `packages/shared/src/hpView.ts`, `packages/client/src/ui/hud.ts`,
`crates/rh-sim/src/{observe.rs,events.rs,actor_refs.rs}`, `crates/rh-sim/src/fx_projector/`,
`crates/rh-server/src/wire.rs`, and the C# protocol/view sources. Code wins over the retained proposal.

## Public Run Summary is the first decision boundary

Candidate transport direction: one shared projection for policy/headless and human reliable replacement state. Candidate
semantics, requiring source witnesses and independent review before implementation:

- `alive`: number of current player rows whose status equals Alive, not transient `standing()`, connection count or
  NPC count. The source bot reads it in every phase; human HUD computes it only for non-training Active. Decide and
  document availability for all phases/training rather than silently narrowing the bot contract.
- `player_count`: current player rows, including bots and retained dead seats. Exclude removed rows and roster history.
  Reconnect grace holds the row; permanent departure removes it. Numerator and minimum-start threshold have different
  populations: the legacy lobby threshold is advanced by humans.
- `min_players`: configured public threshold, not computed "players still needed". Legacy schema is uint8; native
  configuration is usize. The eventual transport must define representable input/refusal bounds, with no silent truncation.
- `started_with`: the fixed public run denominator already carried by ArenaView. It does not shrink on departure and
  must not be substituted with current player count.
- Terminal winner: retain the source's public winner name and the distinction between a live notification and durable
  resync state. The source name is empty before a winner, after a draw and when nobody wins; existing MatchEnded/result
  semantics distinguish other outcomes. Do not invent a durable draw bit from an empty winner name alone.

Any admitted global counters need a **named aggregate exception**: hidden death/removal may alter only the enumerated
public aggregates, while hidden identities, coordinates, equipment, event payloads and unrelated observation leaves
remain equal. Current hidden-player-removal tests compare whole observations; they are not an existing counter exception.
Only a reviewed ADR may authorize the narrow exception and corresponding assertions. C-OBS remains unchanged today.

The actual held-Tab roster is a stronger human precedent than the hidden Active HUD status line: RaidScene passes all
synced player rows to `mapRosterRows`, which displays names and Alive/Out labels without sight filtering. Its availability
is non-training Active, Tab held, with results closed; map positions are filtered separately. Lobby activity is different:
it polls the first non-training room and includes recognized human/bot seats. Neither surface alone proves all-phase or
training availability, nor authorizes copying roster identities, equipment or order into a new Rust observation.

## Event boundary

Protocol11 sends Swing/Hit/Block/Stagger/identity-free Teleport; death/bounty/end are separate reliable events. Raw
Windup/projectile launch/end remain private. Current visible projectile State7 has no launch ID or stop history.
Ability/signature damage chunks remain private even though FxProjector separately synthesizes fair, aggregated native
SeenEvents at fixed flush boundaries. Those intermediate IDs still require ItemObserver/actor-reference projection;
human wire deliberately omits the synthesized cues. Heal/cancel/cast-end/status also lack human event transport, and
Full Wish start/landing remains refused. Do not bypass the projector with raw reclassification.

Native event carry preserves originating native completed-step visibility and order, but SeenEvent has no origin timestamp; human catch-up
batches carry the final observation tick. Legacy TimedFx retains source batch time. A future memory adapter must not
invent original times, recover redacted IDs or add projectile history from world state. Review hidden source, hidden
target and own-attacker exceptions separately, with duplicate/reconnect/bounded-buffer controls.
Legacy `perceive()` applies frame-time visibility; equivalence with native completed-step visibility must be witnessed,
not assumed.

## Next authorized evidence work and held work

[P-PERCEPTION-WITNESS-1](P-PERCEPTION-WITNESS-1.md) is a bounded source/projection witness task, with unchanged production
classifications and versions. It prepares the Run Summary and event decisions; completing it is not full perception parity.

After that evidence, the lead defines/reviews the shared human/native transport and observation shape before activating
new leaves. Recheck unused versions at integration. Memory/frames/strategy/tactics remain held. Names must also pass real
warmed allocation gates: roster Arc clones are cheap, but `World::actor_label` currently allocates Arcs for catalog mobs/
dummies and copies zombie names. A type substitution alone is not allocation proof. Preserve genuine-cast, owner,
visible-player, mob and dummy measurements with reused buffers.

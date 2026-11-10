# Fair activation inventory after Unity primary protocol-16 merge

Date: 2026-11-10. Read-only delta review against the F0/F1 [field closure](../bot-fair-activation-plan/field-closure.md) (whose backend source contract is protocol 14). No source, contract, Rust, Unity, capture, test, or protocol files were changed or executed for this review. No Claude or external-worker communication occurred.

## Exact inspected cut

Unity primary: `/Users/nevinmckinnon/Documents/Projects/RogueHalla`, branch `feature/unity-rework`, HEAD `feaae8e474b857bb03515913d95d6fde913c8e1a`; working tree was clean. The relevant merged code is in `da30a098` (hitbox archetype table, projectile chest height, protocol 16), `d1345720` (Unity hitbox client), and `55b064bc` (Unity Vision reads the Welcome block). HEAD `feaae8e` is a documentation/spec commit after these merges. No unmerged Wave3 branch or later decoder WIP was counted.

Primary identifies [PROTOCOL_VERSION 16](/Users/nevinmckinnon/Documents/Projects/RogueHalla/crates/rh-protocol/src/lib.rs:176). The baseline F0 field-closure document and packet live in integration and were not edited.

## What protocol 16 newly gives the client

| New or newly exposed fact | Authoritative producer and consumers | Effect on F0 source-Brain closure |
|---|---|---|
| Hitbox archetype ID on self and each delivered actor; Welcome table of keys, hull geometry, offsets and chest height | Rust [wire_self / wire_actor and wire_archetypes](/Users/nevinmckinnon/Documents/Projects/RogueHalla/crates/rh-policy/src/delivery/projection.rs:56) project sim archetypes; [ServerMsg::Welcome](/Users/nevinmckinnon/Documents/Projects/RogueHalla/crates/rh-protocol/src/lib.rs:710) carries the table. Unity decodes it in `Protocol/Archetype.cs`, exposes it through `Session.Archetypes`, and `Footprint` / `ChestAim` use it for local movement and aim. JS `tools/protocol-js/check-vectors.mjs` verifies the Rust-generated Welcome vectors. | **New static geometry/presentation fact, not a missing source-Brain fact.** The closed private Brain source reads owner/remote weapon/status/cues, not collision hull/archetype geometry. It can help future fair path/collision agreement only if a source consumer is shown; it does not supply bow draw, wand activity, immunity, or owner progression. |
| Public sight-rule parameters in Welcome: version, tile size, radius, memory trail/update periods, sight mask, and optional Coliseum rectangle | [wire_vision(map)](/Users/nevinmckinnon/Documents/Projects/RogueHalla/crates/rh-policy/src/delivery/projection.rs:466) uses sim constants plus public map metadata; room Welcome uses it (`crates/rh-server/src/room.rs:580-592`). Unity `Protocol/Vision.cs` parses/validates the block; `Session.Vision` exposes it and `Net/Vision.cs` consumes the parameters. `tools/protocol-js/check-vectors.mjs:450-457` compares generated Rust/JS Welcome values. | **Closes the static-rule-parameter gap only.** It is useful input for reproducing sight over accepted history. It does not carry a per-frame visible/hidden mask, owner bush-reveal deadline, camp ward owner/expiry, or the exact historical visibility results required after delayed interpolation. The Vision merge is client-side fog support, not proof that the Bot Percept’s delayed `Vision.filter` is now source-equivalent. |
| Visible projectile current height, plus existing current point/facing/kind/optional visible owner | `rh-sim::ProjectileView` now documents that it is an ID-free current flight and carries `height`; `projectile_view::project` checks current-point visibility and projects launch chest height (`crates/rh-sim/src/projectile_view.rs:1-25,45-89`). `WireProjectile` serializes kind, x/y, facing, optional owner, height (`crates/rh-protocol/src/state.rs:876-910`); Unity decodes these fields in `Protocol/State.cs:91-96,468-471`. | **Partial projectile fact only.** Height can improve client hit geometry/presentation. No global projectile ID, original course `(x0,y0,vx,vy,t0,range)`, launch/end events, or launch time is carried; the sim code expressly says “No client flight rules or launch history.” Source `FrameRing`/Memory projectile-flight and dedupe consumers therefore remain **needs provider**. Do not use the point/height as an invented course or stable identity. |

These fields are genuinely produced/decoded in the merged server/client code; the JS file is the protocol vector verifier, not a second live game-rule provider. The Unity hitbox and Vision improvements do not author bot inputs or alter the private TypeScript Brain’s input facts.

## Previously classified consumed facts: still unresolved

The F0 closure remains accurate on all remaining source consumers; none is added by the protocol-16 commits above:

- **Owner progression:** no `mobKills` field is added to `WireSelf`, `WireOwnerCombat`, `WireBuild`, or state extras. `WireSelf.kills` is player-kill count only. The owner mob-kill source-equivalence/provider gate remains open; do not infer from quest data or hidden `World`.
- **Owner lock:** `WireOwnerCombat.lock` already expresses Clear versus Held(Some target)/Held(None redacted). The commit adds no lock identity. Held-ness is available; the target behind Held(None) remains unavailable and source-equivalence is unresolved. Do not collapse to Clear or fabricate an alias.
- **Remote draw/windup and wand cues:** protocol 16 does not add remote draw timestamp, ready clock, immunity deadline, or cast/wand cue history to `WireActor`/`WireFx`. `WireOwnerCombat.draw_started_at`, `ready_at`, `as_milli`, `windup_milli`, and `speed_milli` remain owner-only fields already present in the protocol-14 F0 baseline; they were not added by this merge and do not solve remote actor cues.
- **Minimap history:** the new Unity map/minimap UI and static canonical map do not add source Memory’s independently refreshed regional mob-dot rows, dot timestamp, or stable mob identity. These still need provider or a reviewed source-consumer equivalence proof.
- **NPC continuity:** protocol 16's actor archetype is appearance/geometry metadata, not an identity token. `ActorRefs` renewal and per-sample references remain as classified; no cross-sample NPC continuity key is added.
- **Ward and reveal facts:** Welcome vision adds a public Coliseum rectangle but not `WireCamp.wardOwner/wardExpiresAt` or owner `bushRevealUntil`. Static reveal geometry is not the dynamic owner/camp entitlement. The provider/proof gate for delayed Vision filtering remains.
- **Course and event times:** the new projectile height does not supply stable projectile ID, launch/end rows, course/time, or missing event variants/per-event millisecond times needed by source replay.
- **Room-level and static setup:** no whole-room alive count, owner combat history source-equivalence for `mobKills`, or exact feature/content/static service binding for a policy Brain is newly established here.

The previously admitted potion fact remains deliberately narrow: the proof at `aa05af1c` / integration `ae29dc1b` / Root check `06833e40` covers same-sample Active owner frames and refuses Ended; Lobby/Planning remain unproved. Protocol 16 does not broaden that domain.

## Minimal coordination questions after the no-contact window

These are planning questions only; no new provider or protocol change is proposed by this review.

1. For each unresolved fact, can a current accepted owner/viewer projection prove exact source-equivalent history without hidden `World` reads (especially `mobKills`, Held(None) target behavior, NPC continuity and delayed Vision)? If not, which exact source feature must the live adapter refuse until an entitled provider is admitted?
2. Will any later reviewed protocol/client work add **remote** bow draw/wand cue timing, minimap dots/refresh identity, projectile launch/course/end identity/time, missing event timestamps/kinds, or dynamic ward/reveal inputs? Require producer path, viewer entitlement, field optionality, protocol version/golden vectors and C# decoder evidence before treating it as available.
3. Can accepted per-sample visibility masks plus the now-public Vision rule reproduce source delayed/interpolated filtering without widening visibility? If yes, record the proof and limits; otherwise identify the smallest owner-only facts needed. Do not infer that Unity’s local fog algorithm is automatically a policy-safe producer.

## Disposition and limits

Protocol 16 adds useful, real client facts: static hitbox geometry, static sight-rule configuration, and projectile chest height. It does **not** close the listed live Brain binding gaps. This review authorizes no code, wire, Rust, or client edits; it does not count unmerged branches, and it is not a F0 implementation/admission or a Unity behavior/build claim.

# Current asset status — 2026-11-08

This compact snapshot binds presentation assets to the existing IDs in `docs/art/inventory/asset-checklist.json`; that historical inventory is unchanged. It describes the base checkpoint `4b58dbf3` and the `9181dc32` continuation. These identifiers are abbreviated; the JSON stores the full continuation SHA. Nine original gap-prop sprites are now compiled and reviewed in Unity on an isolated continuation; the icon API is compiled for the separate UI lane.

| Existing inventory ID | State in this checkpoint | Current evidence and limits |
|---|---|---|
| `actor.faction-body` | Bound and compiled | 12 coherent Flare appearances and 3,008 persistent frame sprites. Authored eight-direction clips are preserved; the static knight intentionally has idle only. Five faction appearances are mapped. |
| `mob.role-elite-art` | Bound and compiled | Explicit canonical mob mappings and ten elite emblems. Appearance families are reused across mob types; this is not thirty unique species artworks. |
| `loot.world-props` | Imported as an opt-in review catalog | 42 sourced prop sprites, with tile definitions and pivots retained; no physics shapes. The samples do not establish world placement, zone facts, or complete geometry for every prop kind. Nine original gap props have a separate actual Unity review capture; placement remains open. |
| `combat.swing`, `combat.block` | Audio library bound; supported sound mappings compiled | The library contains 24 pinned clips in 21 semantic cue groups. Current presentation maps supported delivered cues. This is not a completed final mix; sound balance candidates remain a separate review. |
| `map.zone-art`, `map.terrain-animation`, `terrain.feedback-chips` | Art study compiled; runtime terrain mapping is protocol-gated | Five biome floors and four terrain-effect studies are available in the opt-in review scene. The reviewed native capture contains only public collision facts (`Floor`/`Wall`/`Low`), with zero biome or terrain identities, so it proves no biome-specific runtime placement. |
| `hud.vitals-build`, `settings.display-accessibility`, `connection.banner-errors` | Separate UI lane | 35 procedural icon sprites are compiled for the UI lane. They are not integrated UI, and this checkpoint does not claim the corresponding interface work is complete. |

## Verification boundary

The current Unity EditMode checkpoint reports **62 passed, 0 failed**. Domain-reload evidence records 12 appearances, 3,008 persistent sprites and 24 non-null audio variants. The native Unity proof used protocol 13: one input pass recorded three hits; a separate pass recorded zero hits. The retained [native camera capture](evidence/live-integration-2026-11-08/native-combat.png) is from the actual Unity client camera, not a browser capture. A submitted Wish input produced no Wish FX in that proof.

No new Web build, browser proof, final audio-mix acceptance, or physical performance acceptance is claimed here. Live world placement and UI use remain separate integration work. Audio gain candidates are awaiting context playback review.

# Frost-NPC recipients fixtures (P-FROST-NPC-RECIPIENTS-1)

Pinned linux/amd64 Node22.23.4 actual-source witnesses for player Frost sources chilling the source-born admitted basic
Fire/Holy regional NPCs. The capture binds the declared pve-dot map/config profile with the unchanged source installers
`loot, weapons, targeting, projectiles, factions, mobs, buffs, feed, camps, chests, mobLife, mobAI, abilities, vision,
cardHooks, bruiserPassives, mods` (Frozen Justice included because the native PvE config always carries it), declared
player placements, and actual enqueued target/attack/release client messages. Observation is passive post-step snapshots
only; no expected chill/cooldown/draw/movement value is fed back into the world.

`parity/frost-npc/source.json` (`rh-frost-npc-source/1`) records three declared cases: a Frost sword player fighting the
Fire camp (near melee chill + melee clock correction), a Frost bow player at the Holy camp (ranged chill window reaching
basic NPCs), and a no-Frost Holy control (every NPC stays unchilled with unchanged movement/clocks). Per tick it records
players, camps, mobs (state/brain/weapon/inputs/path), containers, events, landed hits, the source signature map for
players and NPCs, and the dot buckets, plus the exact commands replayed by the Rust consumer. Provenance pins node,
platform, architecture, the complete source .ts closure, the declared map input and the recorder hash; the recorder runs
every case twice and requires byte-identical output, and `--check` compares the committed corpus byte for byte.

Run (pinned image; the image is re-used from the other capture tools):

    bash tools/frost-npc-fixtures/capture.sh            # write parity/frost-npc/source.json
    bash tools/frost-npc-fixtures/capture.sh --check    # byte-identical check

Consumer: `crates/rh-sim/src/systems/frost.rs` tests `actual_source_player_frost_chills_basic_npcs_with_strict_restore`
(source/native timeline parity for NPC chill/chillers/exposure/ranged/movement and NPC readyAt/buffered/action clocks,
strict restore after every source frame, no-Frost unchanged control, malformed tuple/source/AP refusals and preserved
basic gear/Mark checks) and `instant_attack_started_hook_is_player_only_and_npc_timing_corrects_in_after_weapons`.

## Re-runnable semantic mutants

`mutants/01-missing-npc-recipients.patch` removes the NPC recipients from after_damage;
`mutants/02-instant-npc-hook-timing.patch` extends the instant attackStarted hook to NPCs;
`mutants/03-npc-restore-rejected.patch` rejects the newly reachable chilled NPC state on restore. Each is applied to a
disposable copy and must fail its actual consumer semantically, then the unchanged Frost module control must pass:

    bash tools/frost-npc-fixtures/run-mutants.sh
    # CARGO=/path/to/pinned/cargo bash tools/frost-npc-fixtures/run-mutants.sh

Expected final line: 3/3 mutants killed; unchanged control passes.

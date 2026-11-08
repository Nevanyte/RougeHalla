# Frost-NPC recipients fixtures (P-FROST-NPC-RECIPIENTS-1 / REPAIR)

Pinned linux/amd64 Node22.23.4 actual-source witnesses for player Frost sources chilling the source-born admitted basic
Fire/Holy/Plague regional NPCs. The capture binds the declared pve-dot map/config profile with the unchanged source
installers: loot, weapons, targeting, projectiles, factions, mobs, buffs, feed, camps, chests, mobLife, mobAI, abilities,
vision, cardHooks, bruiserPassives, mods (Frozen Justice included because the native PvE config always carries it),
declared player placements, and actual enqueued target/attack/release client messages. Observation is passive post-step
snapshot only; no expected chill/cooldown/draw/movement value is fed back into the world.

parity/frost-npc/source.json (rh-frost-npc-source/1) is the delivered base corpus and is unchanged byte for byte
(sha256 4d1fafe91f8bbf61518c420c88017d69be3ab0d4c4aca1fdf042e435ad0cd20a): a Frost sword player fighting the Fire camp
(near melee chill + melee clock correction), a Frost bow player at the Holy camp (ranged chill window reaching basic
NPCs), and a no-Frost Holy control. Per tick it records players, camps, mobs (state/brain/weapon/inputs/path), containers,
events, landed hits, the source signature map for players and NPCs, and dot buckets, plus the exact commands replayed by
the Rust consumer. Provenance pins node, platform, architecture, the complete source .ts closure, the declared map input
and the recorder hash; the recorder runs every case twice and requires byte-identical output, and --check compares the
committed corpus byte for byte.

    bash tools/frost-npc-fixtures/capture.sh            # write parity/frost-npc/source.json
    bash tools/frost-npc-fixtures/capture.sh --check    # byte-identical check

## Repair packet: bound profile + additive boundary corpus

The repair adds a second, additive harness without touching the base corpus or its recorder:

- tools/frost-npc-fixtures/capture-boundary.mts + capture-boundary.sh -> parity/frost-npc/boundary.json
  (rh-frost-npc-boundary-source/1). It records the same pinned source closure/installers and a structured profile.config
  plus an explicit inert-installer list. The native profile is bound, not assumed: consumables=false (the installer list
  omits consumables), quests=false, abilities=Off (installer present but no ability producer is used; the capture asserts
  no ability/cast event), lifecycle=Off (the 3600 s patience/practice/sudden-death timers are outside the bounded window
  and no teleport/sudden-death event is recorded), hazards=Off, initial_loot=false, regen=false, training/dummies=false,
  PvE with the four admitted factions, min_players/lobby/fill bound from the source config.
- Four declared cases: a Frost sword vs the Plague camp (real source-born Plague recipients and genuinely admitted NPC bow
  draws, 160 frames); a Frost bow vs the Holy camp (near + ranged overlap and thaw/exposure timeline, 170 frames); a
  non-Frost Fire/Plague DoT death/camp-alive lifecycle control (104 frames, damage drift documented); and a no-Frost
  Plague control (every NPC unchilled and movement unchanged, 120 frames).
- The consumer actual_source_boundary_covers_plague_bow_draw_death_and_thaw replays every boundary frame through the
  same strong comparator as the base corpus and asserts the Plague recipient, NPC draw, ranged/near and death/camp facts.

The strong comparator resolves every source actor key through typed birth provenance (camp, elite, catalog type, home),
never a contiguous-id assumption, and fails on an unexpected or missing signature actor. It compares players and NPCs on
position/facing/hp/maxHp/status/weapon/readyAt/drawStartedAt, NPC brain mode/target/holding/home/path, camp
alive/clearedAt/respawnAt/type/elite, landed hits (by/victim/weapon/sig/amount), fx windup/swing/hit/projEnd/heal/stagger/
block/death counts against typed native events, and the restored state's next four reward draws as the continuation
witness. It does not claim all-world/event/RNG equality: containers, the full private event queue, DoT tick details and
the source draw count are outside the compared contract; the non-Frost DoT control stops strict frame comparison at its
documented phase divergence. A provenance-only metadata mutation is a NON-kill control, and the missing-actor control is
asserted inside the consumer test.

Known remaining gap (reported, not hidden): the bounded source runs did not produce a brain.mode "return" frame. The
corpus therefore does not claim source Return-mode parity; a dedicated long leash/return capture is still needed before
this packet's return requirement is closed.

## Re-runnable semantic mutants

mutants/01-missing-npc-recipients.patch removes the NPC recipients from after_damage;
mutants/02-instant-npc-hook-timing.patch extends the instant attackStarted hook to NPCs;
mutants/03-npc-restore-rejected.patch rejects the newly reachable chilled NPC state on restore. Each is applied to a
disposable copy and must fail its actual consumer semantically, then the unchanged Frost module control must pass:

    bash tools/frost-npc-fixtures/run-mutants.sh
    # CARGO=/path/to/pinned/cargo bash tools/frost-npc-fixtures/run-mutants.sh

Expected final line: 3/3 mutants killed; unchanged control passes.

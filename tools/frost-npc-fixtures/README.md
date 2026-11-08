# Frost-NPC recipients fixtures (P-FROST-NPC-RECIPIENTS-1 / REPAIR continuation)

Pinned linux/amd64 Node22.23.4 actual-source witnesses for player Frost sources chilling source-born admitted basic
Fire/Holy/Plague regional NPCs, plus the genuine source Return-mode lifecycle. The capture binds the declared pve-dot
map/config profile with the unchanged installers: loot, weapons, targeting, projectiles, factions, mobs, buffs, feed,
camps, chests, mobLife, mobAI, abilities, vision, cardHooks, bruiserPassives, mods (Frozen Justice included because the
native PvE config always carries it), declared player placements, and actual enqueued target/attack/release/move client
messages. Observation is passive post-step snapshot only; no expected chill/cooldown/draw/movement/mode value is fed back.

parity/frost-npc/source.json (rh-frost-npc-source/1) is the delivered base corpus and is unchanged byte for byte
(sha256 4d1fafe91f8bbf61518c420c88017d69be3ab0d4c4aca1fdf042e435ad0cd20a). It records a Frost sword vs the Fire camp, a
Frost bow vs the Holy camp, and a no-Frost Holy control (120/160/120 frames). Per tick it records players, camps, mobs
(state/brain/weapon/inputs/path), containers, events, landed hits, signatures and dot buckets, plus the exact commands
replayed by Rust. Provenance pins node/platform/arch, the complete source .ts closure, the declared map input and the
recorder hash; every tool double-runs and --check compares the committed bytes.

    bash tools/frost-npc-fixtures/capture.sh            # parity/frost-npc/source.json
    bash tools/frost-npc-fixtures/capture.sh --check

## Bound profile

parity/frost-npc/boundary.json (rh-frost-npc-boundary-source/1) is the additive repair corpus
(sha256 c4b967b9440fb44c59519c8d3c17cfca6ffe7369c1ee385014ea7b45f1c3fded): Plague camp with real source-born Plague
recipients and genuinely admitted NPC bow draws (160 frames), Holy Frost bow near+ranged overlap/thaw (170), a non-Frost
Fire/Plague DoT death/camp-alive lifecycle control (104, documented damage drift), and a no-Frost Plague control (120).
It records a structured profile.config and explicit inert list. The native profile is bound, not assumed:
consumables=false (installer omitted), quests=false, abilities=Off (installer present but no ability producer used;
asserted), lifecycle=Off (3600 s timers outside the bounded window), hazards=Off, initial_loot=false, regen=false,
training/dummies=false, PvE with the four admitted factions, min_players/lobby/fill bound from the source config.

## Genuine source Return-mode lifecycle

parity/frost-npc/return.json (rh-frost-npc-return-source/1, additive) records two 240-frame cases: a Frost bow player
pulls the Fire camp across its 192-unit territory leash and dies (the two far observers keep the run active), so the
source genuinely drops the target and emits brain.mode "return" frames walking home; and the same pull with a no-Frost
puller as the control (Return is the generic source lifecycle, not a Frost artifact). It captures the homeward path,
target=null/holding=false, the death of the puller, the standing observers and the active phase. No mode/content/weapon
is injected: the mode is written by the real source mobAI after the source's own target-loss give-up.

    bash tools/frost-npc-fixtures/capture-boundary.sh --check
    bash tools/frost-npc-fixtures/capture-return.sh --check

## Consumer

The strong comparator resolves every source actor key through typed birth provenance (camp, elite, catalog type, home),
never a contiguous-id assumption, and fails on an unexpected/missing signature actor. It compares players and NPCs on
position/facing/hp/maxHp/status/weapon/readyAt/drawStartedAt, NPC brain mode/target/holding/home/path, camp
alive/clearedAt/respawnAt/type/elite, landed hits (by/victim/weapon/sig/amount), fx windup/swing/hit/projEnd/heal/stagger/
block/death counts against typed native events, and the restored state's next four reward draws as the continuation
witness. It does not claim all-world/event/RNG equality: containers, the full private event queue, DoT tick details and
the source draw count are outside the compared contract; the non-Frost DoT control stops strict frame comparison at its
documented phase divergence. A provenance-only metadata mutation is a NON-kill control; the missing-actor control is
asserted inside the consumer test. The Return corpus is compared through the same consumer, explicitly including
brain.mode return/path/home/holding and the death/phase lifecycle facts.

## Re-runnable semantic mutants and adapter tests

mutants/01-missing-npc-recipients.patch removes the NPC recipients from after_damage;
mutants/02-instant-npc-hook-timing.patch extends the instant attackStarted hook to NPCs;
mutants/03-npc-restore-rejected.patch rejects the newly reachable chilled NPC state on restore. Each is applied to a
disposable copy and must fail its actual consumer semantically, then the unchanged Frost module control must pass:

    bash tools/frost-npc-fixtures/run-mutants.sh
    # CARGO=/path/to/pinned/cargo bash tools/frost-npc-fixtures/run-mutants.sh

Expected final line: 3/3 mutants killed; unchanged control passes.

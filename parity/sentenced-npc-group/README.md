# `parity/sentenced-npc-group` — pinned source NPC/group witness

`source.json` — `rh-sentenced-npc-group-source/1`, 6 cases, 555,087 bytes, SHA256
`82f1c909fa8679f5bda697a3537951f72bc89d17d7d2d28cfb87f50a4b29381f`, captured from unmodified source by
`tools/sentenced-npc-group-fixtures/capture.mts` in the pinned linux/amd64 Node 22.23.4 image.

Declared profile: real `createGameWorld` on generated map seed1 attempt0, two players`
(Sentenced p0, Holy p1), `mobs:true, signatures:true, quests:false, training:false, dummies:false` (training/dummies
only for the dummy case); real catalog-rolled camps/NPCs, real AI and player attack commands, 50 ms steps. Cases:
source-born Sentenced melee and ranged NPCs attacking a player, a Sentenced player attacking a real 5-member camp,
a sibling/retarget continuation attempt, Gathering Storm vs the same camp, and a training-dummy singleton control.
Focused frames carry player/NPC fighter Mark state, camp mobs, action counts/IDs and labelled pulse rows.

Provenance records image/platform/Node, tool hashes, package-lock and all 127 source files. This is source-only; no
native world/hash equality or replacement-kernel claim.

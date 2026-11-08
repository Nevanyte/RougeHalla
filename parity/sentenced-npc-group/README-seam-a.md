# `parity/sentenced-npc-group/source-seam-a-holy.json` — corrected seam-A corpus

`rh-sentenced-seam-a-holy/1`, 2 cases, 140,255 bytes, SHA256
`88dc9f5d8a54df280d05be0f19390019a3bae6161edc5754b2523c699f133375`. Captured from unmodified source by
`tools/sentenced-npc-group-fixtures/capture-seam-a.mts` in the pinned linux/amd64 Node 22.23.4 image.

Declared profile: generated map seed1, two players (Sentenced p0, ordinary **Holy** p1), catalog Sentenced camps, real
AI and ordinary bow attack inputs/50 ms steps; p0 is placed away, p1 wakes the camp. Cases:
`sentenced-npc-melee-marks-holy-human` (camp20 NPC `mob3i`, sword) and
`sentenced-npc-ranged-marks-holy-human` (camp17 NPC `mob36`, bow). In both the Sentenced NPC owns a singleton Mark on
the Holy human p1 (`target p1`, `group fighter:p1`, nonempty tier/hits/progress) while p1's own Mark fields are absent
(group null, tier/hits/progress 0). Exact direction metadata, IDs, ordered pulse rows and frames are in the corpus.
The frozen `source.json` (`3808dac2…`), `source-supplement.json` (`292496f0…`) and `source-holy-components.json`
(`d1129f2d…`) are untouched. No native/hash equality claim.

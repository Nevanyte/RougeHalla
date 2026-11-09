# `parity/sentenced-npc-group/source-supplement.json` — additive source supplement

`rh-sentenced-npc-group-supplement/1`, 2 cases, 530,381 bytes, SHA256
`292496f06ddc3edb8ccb142df76e2661fd257b0679a2132809ad9e4560e75183`. The delivered six-case
`parity/sentenced-npc-group/source.json` is untouched: SHA256
`3808dac248d5fd01286ceb2abe4d2a179a1702e3b8c4bd863a02250654a3d5a3`.

Captured from unmodified source by `tools/sentenced-npc-group-fixtures/capture-supplement.mts` in the pinned linux/amd64
Node 22.23.4 image. Declared real `createGameWorld` profile with generated map seed1, three players (Sentenced p0,
Holy p1, Sentenced p2), catalog camps/NPCs, real AI and ordinary attack/move/cast inputs, 50 ms steps; the labelled
read-only ledger tap is diagnostic only. Provenance records image/platform/Node, tool hashes, package-lock hashes, the
declared config/seeds and all 127 source files; no native world/hash equality is claimed. The trial-after frames
contain the actual source events `status zoned mob1b ms5000 by p2` and `castLand trial`; those prove the real Trial cast
by p2 on the unfocused member `mob1b` and its observed status on that member. Camp-zone admission semantics, propagation
to other camp members and any wider zone/status matrix are NOT claimed.

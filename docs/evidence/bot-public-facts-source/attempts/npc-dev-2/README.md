# NPC wall fog history development run

This is a focused development capture of the added wall-history cases in `tools/bot-public-facts-fixtures/npc.mts`. It does not replace or modify `npc-dev-1`. The player and mob snapshots are declared inputs round-tripped through the real Colyseus schema; they are not outcomes from a Sim death/respawn or movement run.

## Pinned runtime and capture

- Source checkout: `a3d4b3ce575442c9a06916888035ca849a6cd05a`
- Runtime: `node:22.23.4-bookworm-slim@sha256:aaa4b5baf1ecff3b283486bb1f90405cdda225a3e6f79660d2c559fa510a7292`, linux/amd64, Node `v22.23.4`
- Dependencies installed with `npm ci --ignore-scripts --no-audit --no-fund` to a container tmpfs; source was mounted read-only.
- Capture module SHA-256: `0de873699a29ecd814f70a21a70efd0fa256e623a64d8de1c9f2decbb651ac82`.
- Generated [npc-source-output.json](npc-source-output.json) SHA-256: `c997478c0d8442b7ce0558dc75ad419af188dc35feb4e377558708b4c9902ebb`.

The command was the same focused capture as `npc-dev-1`, with output directory changed to `docs/evidence/bot-public-facts-source/attempts/npc-dev-2` and the added output fields `wallFogHistory.sameIdentity` and `wallFogHistory.hiddenReplacement`.

## Source-observed wall history

Both cases use `RaidVision` against a real `mapFromTiles` wall, at x tile 18, with viewer `(528,528)`, visible point `(550,528)`, and blocked point `(720,528)`. `perceive`, `FrameRing.compose`, and `Memory.observe` receive each declared state in order.

- Same identity: `npc-fog-A` is visible at t=5000, occluded at t=5050/5100, then visible at t=5150/5200. At t=5050 the old minimap dot remains because its remembered quantized point is still visible. On the t=5100 repaint the dot disappears and source Memory marks the remembered actor `alive:false`. The actor later returns to the visible frame and minimap at t=5200, but the same memory remains `alive:false`. This records the actual source behavior; it is not interpreted as an earned death.
- Hidden replacement: `npc-fog-A` starts visible, then `npc-fog-B` replaces it behind the wall with the same row attributes. At t=6100 the old A dot disappears and A memory becomes dead; B is still absent from memory while occluded. B becomes visible at t=6150, creating a separate alive memory under B's ID; the minimap dot appears at t=6200. No coordinate/name identity join is made.

The corresponding wall, LOS, schema, Percept, and memory source hashes/anchors are in the output's top-level provenance. No rendering pixels or Phaser scene behavior were measured.

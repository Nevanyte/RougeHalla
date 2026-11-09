# `parity/quest-giver` — pinned source quest-giver witness

`source.json` — `rh-quest-giver-source/1`, 8 cases, 1,229,693 bytes on disk, SHA256
`49ca8a7c83d007fcf8dfbaad15552ef52c3cbfa8c42e67981877b68ae64e7f99` (the capture runner reports the JS string length
1,229,692; the file is UTF-8). Captured from unmodified source by `tools/quest-giver-fixtures/capture.mts` in the pinned
linux/amd64 Node 22.23.4 image.

Declared profile: generated map seed 1 attempt 0 (`decor:false`), three players Fire/Frost/Sentenced, real
`createGameWorld` with `mobs:true, signatures:true, quests:true, training:false, dummies:false, planSeconds` per case,
`wishLockSeconds:0` (the status-attempt case), real inputs and 50 ms steps. Cases: known planning publication with no
actor then active birth, movement through the giver, projectile and melee attempts with a valid player behind it,
status-producing Wish attempts, a declared giver-on-ember/Fire crossing, real expiry retirement and real completion
retirement. Frames include ID counters, giver/runtime/signature state, standing kinds, quests, players, landed hits,
projectiles, terrain/hazard stats and public events; the declared read-only diagnostic ledger tap is labelled separately.

Provenance records the image/platform/Node, source/tool/package-lock hashes, the declared profile and all 127 imported
source files (digest `e6efe7f3048659701a589433d1690651e8a43d28aa2610bedad744cc3705e1a1`). This is source-only; no native
world/hash equality is claimed.

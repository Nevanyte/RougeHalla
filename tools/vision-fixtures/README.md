# Bounded camp-ward vision probes (P-VISION-1 remainder)

`ward-sight.ts` imports the original TypeScript modules. It does not patch `packages/`, replace functions or assign a
ward by hand: it installs the real gameplay assembler (`createScenarioWorld` -> `createGameWorld` with
`signatures:false`), places the seats and then runs the **actual installed producer chain** for a camp clear
(`mobLife.hurtMob` -> `killMob` -> `camps.campMobDied`). Every recorded verdict is the exported installed consumer:
`canPlayerSee` for points, `canPlayerSeeActor` for actors, and the private `VisionMemory` for the "a ward never leaves
a trail" rule.

The only trusted input is the scenario's seat placement and the camp it targets: those are the facts a scenario would
otherwise have to play hundreds of ticks to reach. The map is the certified legacy `generateMap(1, undefined,
{decor:false})` output and the fixture pins its seed and `mapHashU32`, so the Rust test replays against the admitted
`crates/rh-sim/src/mapdata/fixtures/seed1.map.json` (collision, seed and hash are re-checked before any comparison).

Cases (all recorded at server time 10,000 / tick 200 unless a probe names its own clock):

- `producer_and_two_camps`: camp `fire-9` cleared by p0 and `plague-9` by p1 through the actual kill path. Records the
  published camp/ward fields after **every** mob death (only the final death clears and hands the ward over), then a
  15x15 tile-centre probe grid around each camp for both viewers (only the owner's ward answers true), the exact
  900-unit radius boundary points, actor probes (ward point visible + `canPlayerSeeActor` true) and the empty private
  trail of both viewers.
- `engaged_only`: one mob hurt, camp engaged but not cleared: no ward exists, every probe is false.
- `expiry_boundary`: the same cleared camp at `wardExpiresAt - 1` (visible), `wardExpiresAt` (invisible: the source
  test is `now < wardExpiresAt`) and `wardExpiresAt + VISION_TRAIL_MS` (still invisible; the ward never becomes a
  remembered tile).
- `dead_missing_locked`: the owner's view while dead, an absent viewer id, and the same grid with `gatesLocked` (the
  ward's current sight uses the gated collision map).
- `ward_bush_actor`: the first camp whose ward reveals a bush: the bush point is visible through the ward, but the
  actor standing in it stays concealed (the source applies `bushConceals` after point visibility).

Only the pinned Linux x64 Node 22.23.4 runtime is accepted; the fixture records `nodeSha256` and the Rust test pins
`v22.23.4`/`linux`/`x64`. The image is `c86ecead9e55` with a read-only `/repo`, an executable writable tmpfs
`/repo/node_modules` (create an empty `node_modules` directory in the worktree first), the Node 22.23.4 prefix mounted
at `/node`, an external writable `/out` and a persistent npm cache:

```sh
mkdir -p node_modules                                        # mountpoint for the read-only /repo tmpfs
bash tools/vision-fixtures/capture.sh
cp "${RH_VISION_OUT:-$HOME/.codex/tools/rougehalla-stage2/vision-capture}/ward-sight.json" \
   parity/vision/ward-sight.json
```

The committed fixture must be compared byte-for-byte after a re-capture (`cmp`); only the pinned container's bytes are
parity evidence. Host package source is unchanged from the accepted baseline (the container mounts the worktree
read-only and checks nothing in).

Rust validation: `cargo test -p rh-sim --lib vision::ward`. The focused test replays each case through
`Sim::reset_active` (mob PvE mode, the same certified map), performs the same kills through the ported
`mob_life::hurt` producer and compares the published camp/ward fields after each death, then every captured verdict
through `Sim::can_see_point` / the private observation actor list / the ported trail. A mutation guard clears the
captured ward expiry and moves the owner to an unknown seat and requires both to change the verdict; public sampling
must leave the state hash identical.

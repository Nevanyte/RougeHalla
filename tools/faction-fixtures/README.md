# Bounded faction teleport-reset probes (P-FACTION-1 remainder)

These programs import the original TypeScript modules. They do not patch `packages/`, replace functions or inject
damage: the only trusted part is the private faction state a scenario would otherwise have to play hundreds of ticks
to reach.

`teleport-reset.ts` installs the explicit recorded module list (`HOLY_MODULES`: the default modules plus `factions`,
in `createGameWorld` install order), builds one world per case, applies the case's trusted private faction setup, reads
it back as `before`, fires the **actual installed `teleported` hook** (or the **actual `teleportToColiseum` producer**
for the producer case), and records `after`: every modeled faction field (target, mark, chill/chillers, frost move
multiplier, DoT buckets, combat clock), the source-only presentation/group fields, the events the hook emitted (none:
the source reset drops the DoT buckets without flushing), the retained `fired`/heal-over-time bookkeeping
(`rearmTriggers` forgets only `rearm: "teleport"` trigger rows; the shipped catalog has none, so the fired set
survives), and two ordinary-heal lockout probes (a heal inside the kept 3 s lockout is refused, a heal after it lands).

Only the pinned Linux x64 Node 22.23.4 runtime is accepted; the fixture records `nodeSha256` and the Rust test pins
`v22.23.4`/`linux`/`x64`. The image is `c86ecead9e55` with a read-only `/repo`, an executable writable tmpfs
`/repo/node_modules`, the Node 22.23.4 prefix mounted at `/node`, an external writable `/out` and a persistent
npm cache:

```sh
bash tools/faction-fixtures/capture.sh
cp "${RH_FACTION_OUT:-$HOME/.codex/tools/rougehalla-stage2/faction-capture}/teleport-reset.json" \
   parity/faction/teleport-reset.json
```

The committed fixture must be compared byte-for-byte after a re-capture (`cmp`); only the pinned container's bytes are
parity evidence. Host package source is unchanged from the accepted baseline (the container mounts the worktree
read-only and checks nothing in).

Rust validation: `cargo test -p rh-sim --lib systems::signatures::teleport_tests` and
`cargo test -p rh-parity --test schedule`. The focused test replays each captured case's state through the ported hook
and compares every modeled field, the DoT/HoT bookkeeping, the retained fired set and both heal-lockout probes; the
mutation guard rewrites one cleared field and requires the comparison to fail.

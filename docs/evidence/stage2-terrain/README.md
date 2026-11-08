# Native terrain kernel - the arena continuation slice is verified, full terrain remains incomplete

The integrated Rust kernel implements ember damage, bog slowing, ice movement/collision/recovery and light healing in
their source schedule positions. Off/Map/All modes preserve faction home rules. Terrain memory, path replacement
identity, source attribution and clocks remain private; checkpoints validate and continue them. The public MVP keeps
hazards Off and its deployed build. Unity contains no new gameplay rules.

This evidence covers the P-TERRAIN-1 remainder on `deepseek/p-terrain-1`, created from and targeting
`deepseek/p-abil-1`: the last source-born comparison boundary was closed by P-CARDS-1, the strict comparator no longer
permits any known divergence, and the packet's remaining "actual arena-lock/teleport continuation" item now has a
genuine source witness and native consumer. No serialized state, schedule row order, protocol/observation layout,
content or rules constant changed in this remainder; the code identity of this branch is inherited unchanged (content
`9f7a0ff31bf3b6d4`, checkpoint20/replay17, observation15/policy12, protocol7). The parallel P-ARENA-1 branch
(`deepseek/p-arena-1` at `2dc7bab1`, protocol 8) owns the later identity and is the intended restack parent for the
next packet; this branch contains no arena changes. Full P-TERRAIN-1 is still **INCOMPLETE** for the producer domains
named below, as the packet requires.

## Source and review

The [original witness](../../../parity/terrain/README.md) retains 66 installed/helper/runtime cases, 11 ice traces and
surface/sweep/history/regrip/math probes. Five mixed NPC/reset cases include helper-only assertions for unadmitted
training/gate domains. The separate [born witness](../../../parity/terrain/BORN.md) supplies 21 cases/88 action frames
through genuine constructor/raid births, without expected post-state inputs or forged actor provenance. Both pinned
Linux amd64 Node22.23.4 reproductions pass; the source files and frozen manifests match.

The new [arena-lock/teleport continuation witness](../../../parity/terrain/ARENA.md) adds `arena-source.json`
(`rh-terrain-arena-source/1`, 45 frames, SHA256 `c6c8543970152292b92a63e0d2279035ccde63fb57531f06b2f4dfa3a75c42ee`):
an actual source constructor, ordinary lobby close, the real scheduled `settle`/`teleportToColiseum` producer, real
locked ticks, a real between-tick death that reopens the gates, the 1500 ms teleport-immunity window and ordinary ticks
after it. It is captured and `--check`-verified only in the pinned official Linux amd64 Node22.23.4 container, and it
keeps the two frozen corpora byte-identical (asserted by the capture).

Independent review approved the exact bounded kernel manifest
`ea6463e7c307e0d88ea8c3695713356445dc7d461f2a00dbe81b327c8642ca96` and patch
`c9547bc1e8e5719622e272cbfa8d67a91d59991f4d66db2d177cf7f31d8bf248`.
The [reviewed manifest](reviewed-kernel-manifest.json) preserves that proposal. The
[coordinator overlay](coordinator-overlay.patch) updates the internal schedule expectation, explicitly keeps existing
server/load/example configurations Off, and completes older checkpoint test builders. A Mark-execute refusal now
also proves that the otherwise-valid packet restores, preventing a malformed fixture from supplying a false positive.
The stored overlay uses zero context; reconstruction uses `git apply --unidiff-zero` after the reviewed kernel patch.

## Verification

The prior integration's [coordinator checks](coordinator-checks.json) retain their exact commands, log digests and
scope (1,127 distinct tests, both strict Clippy modes, formatting, CI). This remainder re-verified the packet in the
current stack:

- `cargo test -p rh-sim --all-features --lib systems::terrain` - 13 passed / 0 failed (the surface/sweep/walk/math/
  runtime corpus consumers, the native checkpoint/hash/restore tests, the three mutation-guard tests, the born
  kernel and the new arena consumer).
- `cargo test --workspace --all-features --locked` with the PostgreSQL test cluster (`tools/pgtest/start.sh`) -
  1,427 passed / 0 failed / 3 existing ignored across 151 test binaries; exit 0.
- `cargo clippy --workspace --all-targets --all-features -- -D warnings` - clean (exit 0, zero warnings).
- `cargo fmt --all -- --check` - clean.

The hash audit still examines the earlier 44,690 leaves with zero unhashed leaves; this remainder adds no hashed state.
The 480 warmed ordinary terrain steps still allocate zero blocks (unchanged `terrain_no_alloc` corpus), and the
Fire->Holy exemption mutation still fails surface parity/content identity while exact source restoration passes
([negative control](negative-control.json)).

## Full-world comparison: resolved

The earlier record's single boundary was the interactive card-pool drop of
`born-plague-ember-real-attack-credit` (native options `siphon, slowBurn, pocketSand` versus the source's
`siphon, tankEngine, thirdTimesTheCharm`). P-CARDS-1 made that pool match exactly, so the born consumer now compares
all 21 cases and every declared frame in full: the c4 carve-out and the `RH_TERRAIN_REQUIRE_FULL` relaxation were
removed, and any new mismatch fails the ordinary gate rather than being reported as a known boundary. The strict
record [strict-full-check.json](strict-full-check.json) is now a **PASS** (21/21, 0 partial) and the frozen expected
source bytes are unchanged.

## Actual arena-lock/teleport continuation

The source witness and its native consumer are described in [ARENA.md](../../../parity/terrain/ARENA.md). In summary,
through the real lifecycle producers only:

- the real scheduled teleport clears every player slide, preserves the terrain light accumulator/report clock and the
  landed-hit combat clock, locks the gates, sets the coliseum flag and fires the real `teleported` chain;
- while the gates are really locked the ember pass is suppressed (no hazard seconds, no damage, no ledger entry) even
  for a fighter standing on ember;
- a real between-tick `removePlayer` death resolves MIA, reopens the gates, clears sudden death and reschedules the
  next source slot on the run clock;
- the 1500 ms teleport immunity is observed exactly: the burn pass runs and counts hazard seconds while the ledger
  takes no hp, and ordinary ember damage resumes from the tick at/after the boundary;
- the produced locked and unlocked states round-trip through `Sim::restore` with identical hashes, events and
  continuation, and the complete source main-stream tape (constructor order salt, raid spawn shuffle, teleport shuffle)
  is reproduced by the live private stream.

Two mutation guards start from the replay's own native snapshots: a slide recreated after the produced teleport and a
locked tick that counted the ember pass must each fail the frame comparison.

## Required full-world failure: remaining producer domains

Full P-TERRAIN-1 remains **INCOMPLETE** and no success line in this remainder claims otherwise:

- **Training dummies** (owner P-ARENA-2): dummy admission and the neutral surface/no-light rule are not admitted; the
  five original mixed-NPC/reset cases stay helper-only and the training-producer rows stay `Pending`.
- **Remaining NPC signature faction domains** (owners P-FACTION-2..5): the born witness runs signatures Off; burning
  returning mobs, no NPC light healing and ice/bog home rules are covered through genuine births, but the full
  signature-installed faction gameplay is not.
- **Mob slide clearing through a real roster teleport producer**: mob slides are covered as leaves (helper teleport case
  and born captures); the new actual-producer witness is the arena core profile and therefore has no mobs.
- **Public terrain facts/activation** (coordinator): the public first-playable profile keeps hazards Off; clients do not
  carry terrain layers or effects.

[The packet](../../backlog/packets/P-TERRAIN-1.md) retains these gates; the correct status line remains
`P-TERRAIN-1 INCOMPLETE: training-dummy producer, remaining NPC signature domains, mob roster teleport producer,
public terrain facts`.

## Commands

```sh
tools/terrain-fixtures/capture.sh --check
tools/terrain-fixtures/born-capture.sh --check
tools/terrain-fixtures/arena-capture.sh --check
cargo test -p rh-sim --lib --all-features systems::terrain
cargo test -p rh-sim --test checkpoint --test replay --test hash_coverage --test content --test terrain_no_alloc
cargo test -p rh-parity
cargo test -p rh-headless
```

P-TERRAIN-1 evidence ledger row: [`docs/evidence/deepseek-rust/PROGRESS.md`](../deepseek-rust/PROGRESS.md).

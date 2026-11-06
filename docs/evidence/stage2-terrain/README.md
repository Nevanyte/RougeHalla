# Native terrain kernel — full terrain remains incomplete

The integrated Rust kernel implements ember damage, bog slowing, ice movement/collision/recovery and light healing in
their source schedule positions. Off/Map/All modes preserve faction home rules. Terrain memory, path replacement
identity, source attribution and clocks remain private; checkpoints validate and continue them. The public MVP keeps
hazards Off and its deployed build. Unity contains no new gameplay rules.

Current native content is `cb27362236f2d3c2`, checkpoint17/replay15; observation13/policy10/protocol6 are unchanged.
The original full-port goal remains active under [REQUIREMENTS](../../REQUIREMENTS.md).

## Source and review

The [original witness](../../../parity/terrain/README.md) retains66 installed/helper/runtime cases,11 ice traces and
surface/sweep/history/regrip/math probes. Five mixed NPC/reset cases include helper-only assertions for unadmitted
training/gate domains. The separate [born witness](../../../parity/terrain/BORN.md) supplies21 cases/88 action frames
through genuine constructor/raid births, without expected post-state inputs or forged actor provenance. Both pinned
Linux amd64 Node22.23.4 reproductions pass; the source files and frozen manifests match.

Independent review approved the exact bounded kernel manifest
`ea6463e7c307e0d88ea8c3695713356445dc7d461f2a00dbe81b327c8642ca96` and patch
`c9547bc1e8e5719622e272cbfa8d67a91d59991f4d66db2d177cf7f31d8bf248`.
The [reviewed manifest](reviewed-kernel-manifest.json) preserves that proposal. The
[coordinator overlay](coordinator-overlay.patch) updates the internal schedule expectation, explicitly keeps existing
server/load/example configurations Off, and completes older checkpoint test builders. A Mark-execute refusal now
also proves that the otherwise-valid packet restores, preventing a malformed fixture from supplying a false positive.
The stored overlay uses zero context; reconstruction uses `git apply --unidiff-zero` after the reviewed kernel patch.

## Verification

[Coordinator checks](coordinator-checks.json) record exact commands, log digests and scope. On the native M5 Pro:

- 1,127 distinct tests pass across split batches:220 non-map core unit tests,155 simulation integration tests,
  three compile-fail documentation checks,90 headless/load checks,65 parity checks and594 remaining workspace checks.
  Two existing manual tests remain ignored. The191 unchanged map-generator unit tests await full CI; they were not
  repeated locally. The final CI result is recorded in MIGRATION when observed.
- Both strict workspace Clippy modes and formatting pass. The existing97 compared scenarios/13 capture-only cases
  and300 path queries retain their result; terrain coverage is reported separately here.
- The hash audit examines44,690 leaves with zero unhashed leaves. A real admitted ice player supplies populated slip
  state; a separate44-leaf probe covers player/mob/path/terrain details. Restore rejects invalid clock/provenance/slip
  tuples and unreachable path generations. The earlier fixed-tail epoch admission could panic after valid Stop inputs;
  the reviewed tick-derived bound removes that accepted-state failure.
- 480 warmed ordinary terrain steps allocate zero blocks. A separate source junction trace also allocates zero while
  executing actual collision replans and grip. A Fire→Holy exemption mutation fails surface parity and content identity;
  exact source restoration passes both. See [the negative control](negative-control.json).

## Required full-world failure

Twenty born cases fully compare. The lethal-credit case compares its terrain finish, death, threat,29GV, streams,
restore and other container fields, but retains one exact card-pool boundary across actions3/4:

| Native MVP options | Original source options |
| --- | --- |
| siphon, slowBurn, pocketSand | siphon, tankEngine, thirdTimesTheCharm |

```sh
RH_TERRAIN_REQUIRE_FULL=1 cargo test --locked -p rh-sim --all-features --lib terrain_born_kernel_twenty_complete_one_reward_gap -- --nocapture
```

The integrated strict command exits101 at `born-plague-ember-real-attack-credit/3/containers/c4/options/1`.
Its [record](strict-full-check.json) is **INCOMPLETE**, not a full-world pass. Default kernel coverage pins both exact
arrays and compares all remaining fields; any additional mismatch fails. Full rewards must make the strict gate
mandatory and passing. The frozen expected source is unchanged.

Full P-TERRAIN-1 also still requires real arena/locked-gate lifecycle, training actors, remaining NPC faction domains
and public terrain facts. [The packet](../../backlog/packets/P-TERRAIN-1.md) retains these gates. The next Rust arena
work is private and independently designed; it has not activated a public mode or completed the full port.

# Pack Leader source-first seal — evidence receipts

Status: sealed SOURCE-FIRST slice only. This packet does **not** start native work: the native consumer is a separate
Root-allocated packet after Root reviews this source and allocates a cache/target. Base commit
`db5ed80b2b89a156eae09cd0bd3f4c9e77e9e6de`.

## Artifacts

| artifact | purpose |
|---|---|
| `parity/pack-leader/source.json` | one genuine bounded actual-source witness (format `rh-pack-leader-source/1`), 6.5 MB |
| `parity/pack-leader/helpers.json` | 8 separately labelled pure **declared-helper-count** probes (format `rh-pack-leader-helpers/1`) |
| `parity/pack-leader/README.md` | exact setup, witness facts, schema, reproduction, limitations |
| `tools/pack-leader-fixtures/` | capture, helper probes, first-difference comparator, exact unified-diff applier, six control patches, control runner |
| `docs/evidence/pack-leader/manifest.txt` | per-file bytes + SHA256 for every added source/tool/evidence file |
| `docs/evidence/pack-leader/logs/` | raw portable capture/helper logs |
| `docs/evidence/pack-leader/controls/` | raw portable control logs (per mutant, restored, bytecheck, run.log) |

## Exact commands (portable; pinned `node:22.23.4-bookworm-slim` linux/amd64 image)

```
mkdir -p node_modules   # gitignored mountpoint for the tmpfs
RH_PACK_LEADER_BASE=$(git rev-parse HEAD) RH_PACK_LEADER_DIRECTORY=$PWD/parity/pack-leader \
  bash tools/pack-leader-fixtures/capture.sh                      # exit 0; docs/evidence/pack-leader/logs/capture.log
# helpers: same docker pattern, -> parity/pack-leader/helpers.json  # exit 0; logs/helpers.log
RH_PACK_CONTROLS_LOG=$PWD/docs/evidence/pack-leader/controls \
  bash tools/pack-leader-fixtures/run-controls.sh                 # exit 0; controls/run.log ends CONTROLS-GREEN
```

Failures preserved: none of the six control captures failed to compile/run; the two earlier failed control attempts (stale
patch offsets, then unguarded control-mode assertions) are superseded by the passing `run.log` and their raw logs stay in
the same directory only as the current passing versions. No native build, workspace suite, Docker recapture, Editor or
cloud command was run.

## Genuine witness (asserted by the capture before it writes)

- Real one camp clear from ordinary `target`/`release` inputs and the real source weapon/ledger pipeline: `campCleared`
  hook at **tick 169 / 8450 ms**, mob deaths at ticks 37/146/169, p0 damage contribution to all three camp members,
  `state=2/active`, `alive=0`, `wardOwner=p0`, `campsCleared` 0 -> **1**.
- Real later nonneutral damage after the count transition: first p0 -> p1 hit at **tick 321 / 16050 ms**, amount
  **625.7285233040177** (raw 615.9515151515152, wand); p1 still alive at the end.
- Lexical source cache reads: cached `camps=0` during the clear pass, `camps=1` after the real refresh (382 samples).
- No installed HP/death/Return/clear/count/clock/outgoing/private-cache value; only ordinary step/span/target/release
  inputs; declared player bootstrap and constructor card setup only.

**Acquisition scope:** Pack Leader is owned by the constructor's real declared card setup. This is explicitly NOT an
earned Choose/TrainCard reward and is not reward-acquisition parity. Bulk stat cards are declared bounded setup for the
one fight, not earned.

## Controls (actual compiled source mutations, writable copy under /tmp; /repo never patched)

| control | patch target | expected | observed first difference |
|---|---|---|---|
| 01-constant-zero | mods.ts camps scale bonus forced 0 | DIFF | `.result.completeNonemptyEventTape[111].events[1].fx.amount` 625.73 -> 611.06 |
| 02-wrong-per | cards.ts per 0.03 -> 0.06 | DIFF | same path 625.73 -> 640.39 |
| 03-wrong-step | cards.ts step 1 -> 2 (count 1 => 0 rows) | DIFF | same path 625.73 -> 611.06 |
| 04-cache-refresh-timing | updateMods refresh forced 0 | DIFF | same path 625.73 -> 611.06 |
| 05-comment-only | mods.ts provenance-only comment | **IDENTICAL** | none (nonkill) |
| 06-excluded-count | campHeal eligible increment removed | DIFF | same path 625.73 -> 611.06 |
| restored | none (pristine restore) | **IDENTICAL** | none |

All patches applied cleanly and every mutant capture compiled and ran; no compiler/setup failure counted as a kill.
Protected source inventory before/after the control run is byte-identical: 208 files,
`85a220c1911579b5189b9d3acf34b13cdc51e51dd594988a74edd9cccceb7453`; the five protected files hash
`cards.ts 4a51376a...`, `mods.ts 93db949f...`, `campHeal.ts 978239a9...`, `camps.ts 878c2ac0...`, `ledger.ts cc73151c...`.

## Limits (explicit, partial)

- One genuine clear only; no eight-earned-clear, cap-in-World, contributor-selection or restore/clone claim.
- Helper probes are declared-helper-count contexts only: they cover 0/1/7/8/9/20 counts, per/step/cap step function,
  G1/baked ceiling (`OUTGOING_ROW_CAP=2.5`, baked 3 -> 0.8333), execute share (Coup de Grace count 0 vs 1), and the
  actual cache-refresh timing (stale 1.0 before refresh, 1.03 after). They are NOT earned parity and native test names
  must keep the distinction.
- `pvpRules=true` is part of the declared source config so the later ordinary player hit is a real damage result; it is
  not a PvP campaign and no other player input exists.
- No native consumer, protocol/public/canonical/tape/status/Cargo.lock/content change in this seal.

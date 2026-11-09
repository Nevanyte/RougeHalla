# Pack Leader source witness (bounded, one genuine camp clear)

Format `rh-pack-leader-source/1`; one case: `pack-leader-genuine-one-clear`. This is the source-first seal for the
Pack Leader (`packLeader`) camps-cleared damage consumer; it is **not** native code, not a Sim install, and not an
earned-reward or eight-clear campaign.

## Exact setup (honest, declared)

- Base commit: `db5ed80b2b89a156eae09cd0bd3f4c9e77e9e6de`.
- Pinned pinned `node:22.23.4-bookworm-slim@sha256:aaa4b5baf1ecff3b283486bb1f90405cdda225a3e6f79660d2c559fa510a7292`, linux/amd64,
  Node v22.23.4 asserted by the tool; repository mounted read-only; source package installed with
  `npm ci --ignore-scripts --no-audit --no-fund` into a writable tmpfs.
- Source map `born`, zone `holy`, profile `full`, `config.mobs=true`, `config.pvpRules=true`, `mainSeed=12`,
  `rewardSalt=[1,2,3,4]`; module installs are the unmodified `profiles.full` list.
- Players are declared bootstrap setup (never a runtime place helper):
  - p0 fire, wand, declared initial cards `packLeader, bigGameHunter, thickSkull, secondWind, siphon` plus bulk
    `ap3 x16, vitality3 x8, armor3 x10, mr3 x10` (bounded bulk only to make one real fight feasible);
  - p1 holy, declared bulk `vitality3 x30, armor3 x30, mr3 x30` (later-damage witness; no inputs of its own);
  - p2 frost, no cards.
- **Acquisition scope**: Pack Leader is legitimately owned by the constructor's real declared card setup (the harness
  `players[].cards` grant option). This is **not** an earned `Choose`/TrainCard reward and must not be reported as
  reward-acquisition parity.

## Ordinary actions (no helper inputs)

1. `step`: p0 ordinary `target` the camp elite (`@m0` = first birth mob).
2. `span 300` ordinary steps: the real weapon/targeting/ledger/melee pipeline kills the whole camp; no attack-aim,
   attack, place, damage, death, clear, count, clock or cache value is installed.
3. `step`: p0 ordinary `target p1` (the later-damage witness).
4. `span 80` ordinary steps, then ordinary `release`.

The capture asserts before writing that actions are only ordinary `step`/`span` with `target`/`release` inputs, that
Pack Leader is in the declared card list, and that no helper action kind is used.

## Witness facts (source-produced, asserted by the capture)

- Camp: one source camp, roster `zealot x2 + bloodSaint elite`, spots 3; real `campCleared` hook once at
  **tick 169 / time 8450 ms**; real mob deaths at ticks 37 (mob3), 146 (mob1), 169 (mob2) — all before the clear payment.
- p0 genuinely contributed damage to **all three** camp members before the clear (`hitLanded` hooks, p0 by, positive
  amounts).
- Real count transition: p0 `campsCleared` absent/0 before, **1** after; camp `state=2` (cleared), `alive=0`,
  `wardOwner=p0`, `clearedAt=8450`.
- Later real nonneutral damage after the clear: first post-clear p0 -> p1 hit at **tick 321 / time 16050**, damage
  **625.7285233040177** on a raw packet of 615.9515151515152 with the wand; p1 is still alive at the end (the capture
  also asserts that).
- Lexical source cache reads after ordinary execution (resolved from the source `mods` WeakMap cache through the
  read-only inspector, never supplied): cached build `camps=0` during the clear pass, then `camps=1` after the actual
  tick refresh; 382 samples in `witness.sourceStates` cover bootstrap, every retained frame and the final state.
- Full retained frames and complete ordinary hook/event tapes, RNG draw tape (`result.randomTape`) and the final
  snapshot are in `result`; nothing is reconstructed from expected outputs.

## Files

- `parity/pack-leader/source.json` — the captured corpus (sha256 in the evidence manifest).
- `parity/pack-leader/helpers.json` — 8 separately labelled pure **declared-helper-count** probes. They cover counts
  0/1/7/8/9/20 (per=0.03, step=1, cap=0.24), a G1/baked hit probe (`OUTGOING_ROW_CAP=2.5`, baked 3 -> ceiling 0.8333),
  an execute-share probe with Coup de Grace at count 0 vs 1, and a cache-refresh-timing probe (stale value before the
  actual refresh, 1.03 after). They do **not** prove earned clears, contributor selection or World timing; native tests
  must keep that distinction in their names.
- `tools/pack-leader-fixtures/` — capture/probes/controls scripts (see `docs/evidence/pack-leader/README.md`).

## Reproduce

```
mkdir -p node_modules   # mountpoint only (gitignored)
RH_PACK_LEADER_BASE=$(git rev-parse HEAD) RH_PACK_LEADER_DIRECTORY=$PWD/parity/pack-leader \
  bash tools/pack-leader-fixtures/capture.sh
```

## Limitations (explicit)

- One genuine clear only (one clear is sufficient for this source seal). No eight-clear, no cap-in-World, no
  contributor-selection or restore/clone claim from this corpus; those stay helper/native-phase questions.
- No native consumer here; the native second seal is a separate Root-allocated packet after this source review.
- The 6 control patches are semantic/provenance checks on this capture, not additional gameplay claims.

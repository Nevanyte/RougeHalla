# P-BARRIER-VIEW-WITNESS-1 source-witness evidence

**Status: complete source-witness slice; evidence only.** No production, observation, policy, protocol, version,
profile, card-eligibility, Unity or precision change is made. The lead owns the precision/transport decision and all
integration; this branch neither approves the wider fair-view proposal nor closes G6's publication gate.

- Immutable base: `01b14dca9ff94963c539f111a4e30fb208e9c472`.
- Branch: `deepseek/barrier-view-witness-1` (isolated worktree; no merge, no push).
- Source-witness commit: `a05cf1c99c055345d91e4a6be04f81745e0835f1`.
- Lead-review clarification correction: the commit containing this README update (ring schema-f32 barrier + f64 maxHp;
  NaN diagnostics through the helper guards). Branch head at handoff: recorded in the coordination report.
- Packet: `docs/coordination/P-BARRIER-VIEW-WITNESS-1.md`; research: `docs/coordination/BARRIER_PUBLICATION_RESEARCH.md`.

## Isolation and write scope

All work used absolute paths inside the isolated worktree. The primary checkout and every other worktree/golden were
never written. Containers mount the repository read-only at `/repo`, the tool directory read-only at `/capture`, and the
output directory writable (read-only for `--check`) at `/out`; `/repo/node_modules` is a fresh tmpfs and no host cache is
touched. Adds only: `tools/barrier-view-fixtures/**`, `parity/barrier-view/**`, `docs/evidence/barrier-view/**`.
Existing source, goldens, crates, clients, `Cargo.lock` and shared statuses are untouched.

## Artifacts (after the Lead clarification correction)

| file | bytes | sha256 | captureSha256 | probes |
|---|---:|---|---|---:|
| `parity/barrier-view/continuous-bars.json` | 46,852 | `b61007e3f62aa44475727eeeecbef52ba506dbad43f5f650d4049966a6da7ec5` | `03ea0b2ee702dc95a935b3458a95d8484a0612b0215524742157fe631f70e6e4` | 20 + 13 diagnostics |
| `parity/barrier-view/owner-fighter.json` | 48,714 | `4117383c792edee3adf709ad1c7d2caf468d2443740ee78acafe302e6058d238` | `545ed4caa4443e3a8c6417f7cfe1a59b172269c946717a352414bdcf6fdfc1ff` | 21 |
| `parity/barrier-view/schema-f32.json` | 29,091 | `bed4b340726d8c4af2a9d8762c2d0ee3b605169ecc4967bd531f98e0ca69df19` | `632fd5688ffec5ce45ba52139d5924ff9fb4028017b840172ee8eab1845acacf` | 16 |
| `parity/barrier-view/human-ring.json` | 43,416 | `cee922b37e00e9031a0d9853bc7e2f869bfd9d1b8f6969cad366b43d0443b3fc` | `298e89ebb2307940ecf04177fd7c96ec4b292d3473aa7993813c3ee956dbb38e` | 36 + 16 + 4 f64-maxHp + 3 sequences |
| `parity/barrier-view/npc-forms.json` | 22,026 | `13195a72ec240c2a20c47322db9f3a84e0dc686463fcf83e63d52fa1188e3391` | `e0f97063c0f0e51b3b05a4964473795f960bedec5bd0726df32b74ce53b5f92e` | 5 forms + 4 stray controls |
| `parity/barrier-view/visibility.json` | 24,089 | `8876a16b13af4643ee01ffae5518e153a74cb7caf2a018cd73b9cfd9eb6fef9c` | `8d15087d6cc93543ab842ecb79cfd049a5e66b7c45f29d0943256b14f19262fb` | 4 controls + 6 distinctness |

Each corpus is `format: "rh-barrier-view-witness/1"` and `JSON.stringify(corpus) + "\n"`. The profile pins the image
digest, the Node/linux/x64 asserts, the lockfile/package-manifest/TypeScript-config sha256 (9 files; lockfile
`991869bd...d481`), 99 internal TypeScript source files and 1 CSS file, `@colyseus/schema` 5.0.42 and `phaser` as the
external imports, the tool hashes, and the actual `HP_QUANT` (0.05) and `BARRIER_FULL_SHARE` (0.3) values. External
package contents are outside the closure and are named, not hashed.

## Commands and actual results (Lead re-ran every step independently)

```sh
bash tools/barrier-view-fixtures/capture.sh            # corrected capture (writes all six corpora)
bash tools/barrier-view-fixtures/capture.sh --check    # twice, output mounted read-only
bash tools/barrier-view-fixtures/run-mutants.sh
```

- Corrected `capture.sh` wrote all six corpora and its in-run `--check` passed byte for byte (exit 0).
- Two independent `--check` runs with the output mounted read-only printed the same six sha256 values and passed
  byte for byte (exit 0 each).
- `run-mutants.sh` killed all four compiled semantic mutants with exactly the signatures in
  `tools/barrier-view-fixtures/mutants/expected.txt`, then reran the unmutated read-only capture:
  `RESTORED CONTROL PASS` and the same six sha256 values (exit 0):
  - `01-combined-denominator`: continuous-bars `/cases/2/actual/fractions/barrier/tag` expected "value", mutant "+0";
  - `02-twentieth-precision`: owner-fighter `/cases/2/actual/fighter/barrierFrac/value` 0.05 -> 0.01;
  - `03-f32-identity`: owner-fighter `/cases/3/actual/selfBarrier/tag` expected "+0", mutant "value";
  - `04-ring-normalization`: human-ring `/sequences/cacheRepeat/calls/0/stepAfter` expected 4, mutant 2.
- A separate Lead cross-check probe ran the actual helpers/schema in the same pinned container and agreed with the
  corpus on the key values (e.g. `hpBarFractions(NaN,100,10)` -> hp 0, barrier 0.1; ring f64-maxHp case -> step 2).

## Lead-review clarifications applied in the correction commit

1. **Human ring inputs:** the actual human `PlayerView` call is `setBarrier(barrierStrength(p.barrier, p.maxHp))`, where
   `p.barrier` is the schema-decoded **float32** barrier and `p.maxHp` is the **original f64** number field. `maxHp` is
   *not* `Math.fround`-ed for the human ring; `fighterSeen` is the path that `Math.fround`s hp/maxHp/barrier. The
   corrected `normalized` probes feed `barrierStrength(Math.fround(barrier), maxHp)` and the new
   `schemaF32BarrierF64MaxHp` table records a discriminating threshold: barrier 9.375 with maxHp 100.000001 gives the
   actual ring step **2**, while a (deliberately labelled, non-source) diagnostic if `maxHp` were erroneously
   `Math.fround`-ed would give step **3**.
2. **NaN diagnostics:** the finite-input denominator shorthand is *not* used for diagnostics. `hpBarFractions` is
   called on the declared values, so the helper's `value > 0 ? value : 0` guards execute and NaN, infinities,
   negatives and signed zero are preserved exactly as the helper returns them (`finiteShorthandApplied: false`).
   These remain explicitly labelled numeric-domain diagnostics, not admission rules.

## Witness facts (narrow)

- **Owner barrier.** `selfView.barrier` is `Math.fround(barrier)` exactly: 0.025 -> 0.02500000037252903; 16777217 ->
  16777216; f32::MAX unchanged; 1e39 -> +Infinity; 1e-46 -> +0; -1e-46 -> -0; +0/-0 keep their tags and f32 bits.
- **Visible fighter share.** `barrierFrac = barShare(hpBarFractions(f32(hp), f32(maxHp), f32(barrier)).barrier)`
  (twentieths plus a one-step positive sliver): 0.025 -> 0.05; 75 -> 0.45 with hpFrac 0.55; 250.5 -> 0.7 with
  hpFrac 0.3; integer boundaries give independently rounded sums of 1.05; a 1e39 barrier (f32 Infinity) makes the
  helper's barrier share NaN, which `barShare` guards to 0; negative barriers produce 0 while the owner keeps them.
- **Continuous bars.** Combined denominator `max(maxHp, positive hp + positive barrier)`; overheal, overfull combined
  bars and maxHP-decrease forms recorded; tiny positive barriers keep a nonzero fraction and a display value of 1;
  `hpText` rounds hp and barrier independently, so its display sum can exceed the displayed maxHp. The 13 labelled
  numeric-domain diagnostics preserve NaN/infinities/negatives/overflow through the actual guards.
- **Schema float32.** Actual `PlayerState.barrier` Encoder/Decoder: +0 -> +0; -0 assigned to a fresh default-0 field
  stays +0 (change-tree equality); -0 after a non-zero assignment survives; a later +0 does not replace -0; 1e-46 ->
  +0; subnormal survives; 16777217 -> 16777216; f32::MAX survives; 1e39 -> +Infinity; NaN/±Infinity survive;
  0.1 -> 0.10000000149011612. Metadata `{type:"float32",index:32,name:"barrier"}` is recorded separately.
- **Human ring.** The actual `setBarrier` computes `step = strength > 0 ? max(1, round(strength*8)) : 0`, caches by
  step and calls `clear()` then draws on a change. Observed: fresh 0 -> no call; tiny positive -> 1; ties round up
  (0.1875 -> 2 ... 0.9375 -> 8); 1 -> 8; a repeated/same-step strength makes no second call; a positive -> 0
  transition calls only clear. The method itself does not clamp (declared 1.5 gives step 12); callers pass a
  `barrierStrength` result in 0..1.
- **NPC forms.** `mob`/`elite`/`dummy`/`quest`/`zombie` rows appear through actual `perceive`; only living `mob`/
  `elite` rows get minimap dots. `MobSeen` has no barrier/barrierFrac leaf and `MobState` has no barrier field; a
  declared stray barrier of 50/1e39/NaN leaves the frames byte-identical.
- **Hidden controls.** The EFFECT_HIDDEN row, the out-of-frame row and a `canSee = false` control carry no actor
  fact; neither hidden nor far id occurs anywhere in the frame JSON; swapping the hidden row's barrier to 1e39 leaves
  the frame identical; the owner self barrier is still projected.
- **Distinctness.** Owner continuous shares, bot twentieths and the ring are different outputs: 75/100/75 gives owner
  shares 0.5714/0.4286, bot shares 0.55/0.45, ring step 8; barrier 0.075 gives owner barrier share 0.000749, bot 0.05
  (hp share 1, sum 1.05) and ring step 1. They are not interchangeable.

## Admission matrix for the next public transport (source evidence only; no decision here)

| Surface | Legacy source fact (witnessed) | Current native observation/wire | Disposition / lead decision needed |
|---|---|---|---|
| Owner barrier | `selfView.barrier = f32(barrier)`; owner wire preserves nonfinite/signed-zero bits | not a public observation leaf; privileged owner projection is the later gate | precision + refusal seam decision; hidden actors must never fail a visible frame |
| Visible fighter bar share | `f32` inputs -> combined denominator -> twentieths (0.05) + one-step positive sliver | native remote HP uses hundredths; no barrier share | deliberately narrower native today; changing quantization alone is insufficient (f32 + guards + denominator all matter) |
| Continuous bar display | `hpBarFractions`/`hpText` combinations; display sums may exceed maxHp | no native continuous bar projection | source-only arithmetic; not a native parity claim |
| Human ring | eight-step `round(strength*8)` of `barrierStrength(schema-f32 barrier, f64 maxHp)`, cached/cleared, positive sliver | absent | publication shape (ring step vs share) and precision decision owned by lead; overfull shares cannot reconstruct the ring |
| NPC forms | `MobSeen` has no barrier leaf; `MobState` has no barrier field | same absence | explicit NPC zero behavior must stay explicit; no stray-property leak |
| Schema float32 | actual `@colyseus/schema` float32 encode/decode incl. signed zero/subnormal/NaN/Inf boundaries | native uses f64 sim values and hundredths on the wire | numeric-domain/refusal design before any new conversion |
| Nonfinite/negative diagnostics | actual helper guard results preserved; signed zero/NaN/±Inf tagged, never JSON null | current owner wire preserves bits; checked-observation seam undecided | diagnostics are not admission rules; refusal seam must be designed, not substituted |

## Blocked / prerequisites

None for this slice: under the pinned image the actual `PlayerView.prototype.setBarrier` method was importable and
invocable with the declared recorder objects (phaser/CSS empty-module loader; no scene, DOM or renderer lifecycle),
and the actual schema Encoder/Decoder round trip ran. The ring evidence is method-level only; a real scene render
remains outside this packet. No hidden timer, decay, producer, roster exception or private G6 fact is published, and no
native/client parity or precision decision is claimed. Prerequisites for the next step are the lead's precision/
refusal-seam and ring-projection decisions plus the G6 producer/publication gate; none is exercised or approved here.

## Constraints honoured

Source evidence only; no production/observation/policy/protocol/version/profile/card/Unity/precision change; no Rust
work or duplicated G6 corpus; all outputs inside the isolated worktree; no older golden regenerated; declared probes
and stubs labelled; numeric-domain diagnostics separated; commits only on the isolated branch; no merge or push.

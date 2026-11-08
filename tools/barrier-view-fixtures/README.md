# Barrier-view source witness (P-BARRIER-VIEW-WITNESS-1)

Canonical actual-source capture of the legacy barrier presentation/perception arithmetic. Evidence only: this tool
changes no production, schema, protocol, observation, policy, version, profile, card-eligibility, Unity or precision
rule, and it does not implement or duplicate the Rust lane's private G6 producer/decay corpus.

The capture runs in pinned `node:22.23.4-bookworm-slim@sha256:aaa4b5baf1ecff3b283486bb1f90405cdda225a3e6f79660d2c559fa510a7292`
with `--platform linux/amd64`: the repository is mounted read-only at `/repo` (its `node_modules` is a writable
tmpfs), this tool directory is read-only at `/capture`, and the output is mounted at `/out` (`readonly` for `--check`).
Setup is `npm ci --ignore-scripts --no-audit --no-fund` and `node --import tsx`.

```sh
bash tools/barrier-view-fixtures/capture.sh            # write parity/barrier-view/*.json
bash tools/barrier-view-fixtures/capture.sh --check    # compare byte for byte (output mounted read-only)
bash tools/barrier-view-fixtures/run-mutants.sh        # four compiled semantic mutants + restored control
```

`RH_BARRIER_VIEW_OUTPUT` redirects the capture; the path must stay inside this isolated worktree. The canonical
serialization is `JSON.stringify(corpus) + "\n"`. Each corpus carries `format: "rh-barrier-view-witness/1"` and a
`profile` with the pinned image digest, the Node/linux/x64 asserts, sha256 and byte size of the lockfile, package
manifests and TypeScript configs, sha256 of the internal TypeScript source closure actually imported (99 files), sha256
of the one imported CSS file, external import names, the tool hashes and the actual `HP_QUANT`/`BARRIER_FULL_SHARE`
constants. `profile.captureSha256` is taken over the corpus with the profile present and `captureSha256` absent;
`--check` compares exact bytes, not parsed JSON.

## Corpora

| file | probes | content |
|---|---:|---|
| `continuous-bars.json` | 20 + 13 diagnostics | actual `hpBarFractions`, `barrierStrength`, `hpDisplayValue`, `hpText` over declared (hp, maxHp, barrier): zero/zero-maxHP/overheal/overfull-combined/tiny shares/half-step neighbours/maxHP-decrease forms. The 13 diagnostics are a separately labelled numeric-domain block (NaN, infinities, negatives, overflowing sum). Derived `shareSum` and `displaySum` fields are sums of the actual outputs, recorded rather than corrected. |
| `owner-fighter.json` | 21 | actual `perceive()` with declared source-schema rows: `frame.self.barrier = f32(barrier)` and one visible fighter's `barrierFrac = barShare(hpBarFractions(f32(hp), f32(maxHp), f32(barrier)).barrier)`. Covers +0/-0, f32 subnormal and underflow, 0.025/0.0499999/0.05/0.0500001/0.075, 16777216/16777217/33554432, f32 max, 1e39, 75/100/250.5, -1/-0.5/-1e-46. |
| `schema-f32.json` | 16 | the real `PlayerState` class and the actual `@colyseus/schema` 5.0.42 `Encoder.encodeAll`/`Decoder.decode` over a full `RaidState`: default, +0, -0 direct and after a non-zero assignment, +0 after -0, subnormal, 1e-46, f32 integer limits, f32 max, 1e39, NaN, ±infinity, 0.1, 75. The decode result is the witness; `[Symbol.metadata]` `{type:"float32",index:32,name:"barrier"}` is recorded as secondary metadata only. |
| `human-ring.json` | 36 + 16 + 3 sequences | the actual `PlayerView.prototype.setBarrier` private method called as `setBarrier.call(recorder, strength)` on declared `{barrierStep, barrierRing}` recorders. Records the eight-step mapping, every Math.round tie and its neighbours, `barrierStrength`-normalized strengths (barriers 0.06/0.075, 30 = 0.3 x maxHP), cache skips, clears, and the draw calls (`clear`, `fillStyle`, `fillCircle`, `lineStyle`, `strokeCircle`) with their actual arguments. |
| `npc-forms.json` | 5 forms | actual `perceive()` over declared `mob`/`elite`/`dummy`/`quest`/`zombie` (Plague companion) rows, including a declared stray `barrier` property (50 / 1e39 / NaN). Records frame rows, minimap dots, the actual `MobState` field list, and byte-identical NPC row arrays with and without the stray property. |
| `visibility.json` | 4 controls + 6 distinctness | the same owner/fighter barrier witness for a visible row, an EFFECT_HIDDEN (256) row, an out-of-frame row and a `canSee = false` control through actual `perceive`, plus owner-continuous vs bot-twentieths vs ring rows for the same declared values. |

## What is declared and what is stubbed

Every input is a declared source-schema `StateLike` row, a declared number, or (for the schema corpus) a real schema
instance assigned declared values. Every recorded output is the unmodified source's return value; no expected value is
hand-written into a corpus. The declared probes are labelled `declared`.

The human-ring import uses `stub-loader.mjs`, which resolves `phaser` and every `*.css` to an empty ESM module. The
render modules in this closure name Phaser only in type positions, and no value export is used at module scope.
`PlayerView` is never constructed: no scene, graphics object, DOM node or renderer lifecycle runs. The recorder's
`barrierRing` is a declared object that records the method's own calls, and the method itself is the imported source
method, not a copied formula. This is a method-level witness, not renderer or pixel proof.

The schema corpus additionally shows a real property of the schema class: the change tree treats `0` and `-0` as
equal, so assigning `-0` to a fresh default-0 field leaves `+0`; a non-zero -> `-0` assignment stores `-0` and the
float32 wire preserves it, and a later `+0` assignment does not replace it.

## Semantic mutants

`run-mutants.sh` copies the repository to a writable `/tmp/repo` inside the container, restores every patched file from
the read-only `/repo` before each mutant, applies the exact unified diff with `apply-patch.mjs`, and recaptures with
`RH_BARRIER_VIEW_RECORD=1` (expectation assertions become recorded booleans; the semantic comparator is not weakened).
`compare.mjs` reports the first JSON-path mismatch, skipping only `/profile` (a mutant necessarily changes the mutated
file's source hash). The runner fails unless the first mismatch matches `mutants/expected.txt`; after the four mutants
it re-runs the unmutated capture with `--check` against the checked-in corpora.

| mutant | first mismatch |
|---|---|
| `01-combined-denominator` (`hpView.ts`: denominator drops the combined `h + b` term) | `continuous-bars.json /cases/2/actual/fractions/barrier/tag` "value" -> "+0" |
| `02-twentieth-precision` (`types.ts`: `HP_QUANT` 0.05 -> 0.01) | `owner-fighter.json /cases/2/actual/fighter/barrierFrac/value` 0.05 -> 0.01 |
| `03-f32-identity` (`perception.ts`: `f32 = Math.fround` -> identity) | `owner-fighter.json /cases/3/actual/selfBarrier/tag` "+0" -> "value" |
| `04-ring-normalization` (`PlayerView.ts`: `BARRIER_STEPS` 8 -> 4) | `human-ring.json /sequences/cacheRepeat/calls/0/stepAfter` 4 -> 2 |

## Boundaries of this evidence

These are source and projection witnesses, not a native publication, wire-admission, precision or Unity decision. The
numeric-domain diagnostics are non-finite/negative/overflow arithmetic observations only; they authorize no restore or
refusal rule. No hidden timer, decay, producer, roster exception or private G6 state is published. The ring witness is
the actual method with declared recorder objects, not a real scene render.

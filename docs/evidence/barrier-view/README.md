# P-BARRIER-VIEW-WITNESS-1 source-witness evidence

**Status: complete source-witness slice; evidence only.** No production, observation, policy, protocol, version,
profile, card-eligibility, Unity or precision change is made. The lead owns the precision/transport decision and all
integration; this branch neither approves the wider fair-view proposal nor closes G6's publication gate.

- Immutable base: `01b14dca9ff94963c539f111a4e30fb208e9c472`.
- Branch: `deepseek/barrier-view-witness-1` (isolated worktree; no merge, no push).
- Source-witness commit: the commit containing this file.
- Packet: `docs/coordination/P-BARRIER-VIEW-WITNESS-1.md`; research: `docs/coordination/BARRIER_PUBLICATION_RESEARCH.md`.

## Isolation and write scope

All work used absolute paths inside the isolated worktree. The primary checkout and every other worktree/golden were
never written. Containers mount the repository read-only at `/repo`, the tool directory read-only at `/capture`, and the
output directory writable (read-only for `--check`) at `/out`; `/repo/node_modules` is a fresh tmpfs and no host cache is
touched. Adds only: `tools/barrier-view-fixtures/**`, `parity/barrier-view/**`, `docs/evidence/barrier-view/**`.
Existing source, goldens, crates, clients, `Cargo.lock` and shared statuses are untouched.

## Artifacts

| file | bytes | sha256 | captureSha256 | probes |
|---|---:|---|---|---:|
| `parity/barrier-view/continuous-bars.json` | 46,553 | `d47e0e11b4bbff21d7b649382d647d27a274e328aec632c2f5a09ee16688824a` | `c186fb4ca5cbeffc8462489464a32d4654af61c6cbb874c198b80e3ca81699fb` | 20 + 13 diagnostics |
| `parity/barrier-view/owner-fighter.json` | 48,714 | `531553256ed8fe8340d6856c0de36749bbcf6c70cfb5f7c00d6f994cc412d6d5` | `c298ae08239adadf5bd6e09e45ca3b3918bcc5dc99934fb2078a02f3dd617e9c` | 21 |
| `parity/barrier-view/schema-f32.json` | 29,091 | `7b67edddca1ad1ab4a8902aa494ba34fdd45e1b22d85f188c32afe2e6edb3220` | `0340e1f5635ee36f2946c793def026b5c56ca30540165b1015776a6e152ebfa7` | 16 |
| `parity/barrier-view/human-ring.json` | 37,520 | `a79b212b722709484a4bef1a09bfaba68bf0fbba894d78fbd4dc273284a14d0d` | `d576e02e7722c0423de619764e546dbee8de888281ae3da46bb895bdcaf5f92f` | 36 + 16 + 3 sequences |
| `parity/barrier-view/npc-forms.json` | 22,026 | `34cb62c57f6e3210355d66582dd24eec57fafbddaf6677d8d40720c3f4ce5036` | `50eb50a4d1cceb9d0dce181d32584ad2f46016bb07287b9ce3ed720c38e48029` | 5 forms + 4 stray controls |
| `parity/barrier-view/visibility.json` | 24,089 | `4596609f1246d63e92d76b20936a65e83ce5947d086680629d50f5be6dfec63b` | `fabed5af600304a2264379582e0b8c87a1e27c6a40f81b9f36c185e24a830ae5` | 4 controls + 6 distinctness |

Each corpus is `format: "rh-barrier-view-witness/1"` and `JSON.stringify(corpus) + "\n"`. The profile pins the image
digest, the Node/linux/x64 asserts, the lockfile/package-manifest/TypeScript-config sha256 (9 files; lockfile
`991869bd...d481`), 99 internal TypeScript source files and 1 CSS file, `@colyseus/schema` 5.0.42 and `phaser` as the
external imports, the tool hashes (`capture.mts` `f1e2617d...a615`, `capture.sh` `f72f044a...f4e7`, `stub-loader.mjs`
`c665f5ed...2e59`), and the actual `HP_QUANT` (0.05) and `BARRIER_FULL_SHARE` (0.3) values. External package contents are
outside the closure and are named, not hashed.

## Commands and actual results

```sh
bash tools/barrier-view-fixtures/capture.sh
bash tools/barrier-view-fixtures/capture.sh --check   # run twice
bash tools/barrier-view-fixtures/run-mutants.sh
```

- Capture wrote all six corpora and its in-run `--check` passed byte for byte.
- The two independent `--check` runs (output mounted read-only) passed byte for byte and printed the same six
  sha256 values as above.
- `run-mutants.sh` killed all four mutants with exactly the signatures in `tools/barrier-view-fixtures/mutants/expected.txt`,
  then reran the unmutated capture against the read-only baseline: `RESTORED CONTROL PASS` and the same six sha256
  values.

## Witness facts (narrow)

- **Owner barrier.** `selfView.barrier` is `Math.fround(barrier)` exactly. Examples: 0.025 -> 0.02500000037252903;
  16777216 -> 16777216; 16777217 -> 16777216; 33554432 -> 33554432; f32::MAX -> unchanged; 1e39 -> +Infinity; 1e-46 ->
  +0; -1e-46 -> -0; +0 and -0 keep their tags and f32 bits.
- **Visible fighter share.** `barrierFrac` is `barShare(hpBarFractions(f32(hp), f32(maxHp), f32(barrier)).barrier)`
  (twentieths plus a one-step positive sliver), with a fixed 100/100 hp/maxHp witness row. Examples: 0.025 -> 0.05;
  0.0499999/0.05/0.0500001/0.075 -> 0.05; 75 -> 0.45 with hpFrac 0.55; 250.5 -> 0.7 with hpFrac 0.3; barrier 1e39
  (f32 +Infinity) makes the helper return NaN for the barrier share, which the `barShare` guard records as 0, and the
  hp share is 0 too; 16777216/16777217/33554432/f32::MAX give barrierFrac 1 with hpFrac 0.05 (independently rounded sum
  1.05). Negative barriers produce 0, and the owner still sees the negative value.
- **Continuous bars.** `hpBarFractions` uses the combined denominator `max(maxHp, positive hp + positive barrier)`;
  overheal, overfull combined bars and maxHP-decrease forms are recorded. Tiny positive barriers keep a nonzero
  fraction and a display value of 1; hpText rounds hp and the barrier independently, so its display sum can exceed the
  displayed maxHp (e.g. 10.4/10 +10.4 -> "HP 11/10 +11 barrier"). The 13 labelled numeric-domain diagnostics preserve
  NaN, +/-Infinity, negative and overflowing inputs and the source's `value > 0 ? value : 0` guards; they are not
  admission rules.
- **Schema float32.** Actual `PlayerState.barrier` encode/decode: +0 -> +0; `-0` assigned directly to a fresh
  default-0 field stays +0 (the change tree treats 0 and -0 as equal); `-0` after a non-zero assignment survives as -0;
  a later +0 does not replace a stored -0; 1e-46 -> +0; smallest subnormal survives; 16777217 -> 16777216; f32::MAX
  survives; 1e39 -> +Infinity; NaN -> NaN; +/-Infinity survive; 0.1 -> 0.10000000149011612. Metadata
  `{type:"float32",index:32,name:"barrier"}` and the 0 default are secondary metadata, recorded separately.
- **Human ring.** The actual `setBarrier` computes `step = strength > 0 ? max(1, round(strength*8)) : 0` and caches by
  step. Observed: 0 -> 0 (fresh recorder: no calls); tiny positive -> 1; 1/16 -> 1; 0.125 -> 1; 0.1875 -> 2; each tie
  rounds up (0.3125 -> 3 ... 0.9375 -> 8); 1 -> 8. A repeated or same-step strength makes no second call, a changed
  step calls clear then redraws, and a positive -> 0 transition calls only clear. Normalized barriers 0.06 and 0.075
  (maxHp 100) both give step 1; barrier 30 (0.3 x maxHP) gives strength 1 and step 8. The method itself does not clamp
  (declared 1.5 gives step 12); callers pass a `barrierStrength` result in 0..1.
- **NPC forms.** `mob`, `elite`, `dummy`, `quest` and `zombie` companion rows all appear through actual `perceive`; only
  living `mob`/`elite` rows get minimap dots. `MobSeen` has no barrier/barrierFrac leaf and `MobState` has no barrier
  field. A declared stray `barrier` of 50, 1e39 or NaN on every mob row leaves the frames byte-identical.
- **Hidden controls.** The visible fighter row carries the barrier witness; the EFFECT_HIDDEN row, the out-of-frame row
  and a `canSee = false` control carry no actor fact. Neither hidden nor far id occurs anywhere in the frame JSON, and
  swapping the hidden row's barrier to 1e39 leaves the frame identical. The owner self barrier is still projected.
- **Distinctness.** Owner continuous shares, bot twentieths and the ring are different outputs: for hp/maxHp/barrier
  75/100/75 the owner shares are 0.5714/0.4286, the bot shares 0.55/0.45 and the ring step 8; for barrier 0.075 the
  owner barrier share is 0.000749, the bot share 0.05 (hp share 1, sum 1.05) and the ring step 1. They are not
  interchangeable.

## Blocked / prerequisites

None for this slice: under the pinned image the actual `PlayerView.prototype.setBarrier` method was importable and
invocable with the declared recorder objects, and the actual schema Encoder/Decoder round trip ran. The ring evidence
is method-level only (no scene, DOM or renderer); a real scene render remains outside this packet. No hidden timer,
decay, producer, roster exception or private G6 fact is published, and no native/client parity is claimed.

## Constraints honoured

Source evidence only; no production/observation/policy/protocol/version/profile/card/Unity/precision change; no Rust
work or duplicated G6 corpus; all outputs inside the isolated worktree; no older golden regenerated; declared probes
and stubs labelled; numeric-domain diagnostics separated; commits only on the isolated branch.

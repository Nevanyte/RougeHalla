# P-CARD-BLEED-FEEDBACK-1 — exact scoped seal manifest (DeepSeek Card worker)

Candidate worktree: `/Users/nevinmckinnon/Documents/Projects/RogueHalla-worktrees/backend-card-bleed-feedback`
Branch: `codex/deepseek-card-bleed-feedback`; clean base HEAD `03ec330be74d695ee6034def69c1cb5df72e7b34`
(integration `31a5df0b` + documentation transfer). Pinned Rust 1.97.0, offline/locked/jobs1, worktree-local target.

**Seal status:** git metadata writes in this worktree are refused by the workspace sandbox
(`index.lock: Operation not permitted`), so **no commit was created locally**; this is an exact uncommitted
worktree candidate for Root to seal. No permission mode was expanded. No merge/push/deploy and **no native
or public admission** is claimed. CI later runs the ignored Card allocation profilers serially.

All paths below are relative to the worktree root; SHA-256 values are of the final file bytes. This manifest's own
file is the only candidate path intentionally not listed (it is written last).

## Card production/helper (new)

| Path | Git state | SHA-256 |
|---|---|---|
| `crates/rh-sim/src/fx_projector/card.rs` | new | `a18458b5d3bbf7e35a8723bbd5cc975ba67d0a1ce1a50470f93e4f24ef9dfdaa` |
| `crates/rh-sim/src/systems/card_bleed_feedback.rs` | new | `d5c7b754cf0f67f490394634cd6a3014e47141c5983f2061c5753a7f7456f8b0` |
| `crates/rh-sim/src/systems/card_bleed_feedback/index.rs` | new | `9bdf89e2f531b7f90d98f0c496760f75fcfc17987ce6f4fecac97eb5e0ae5644` |

## Card tests (new)

| Path | Git state | SHA-256 |
|---|---|---|
| `crates/rh-sim/src/systems/card_bleed_feedback/source_tests.rs` | new | `eba6f2874839c8f920c887381cc002dbe745fd70f57f016c7e5d48e2eb6795e3` |
| `crates/rh-sim/src/systems/card_bleed_feedback/tests.rs` | new | `120b3a6ba6626b73d5d7bcbcbe5d23cc77ce4d6fb263220842c7b98a21a3c0fb` |

## Existing Card-lease hunks (modified)

| Path | Git state | SHA-256 |
|---|---|---|
| `crates/rh-headless/src/digest.rs` | modified | `9e5d25a09d73d06909afce4da4ee43b1187d087f97df117b1eea1f1ddf10cc58` |
| `crates/rh-parity/src/canon.rs` | modified | `70d5e7fbe44c3084ae779dd972b41c32baaaa9b9213c45ec2402ac04104bcfcc` |
| `crates/rh-policy/src/lib.rs` | modified | `4e573f0887fe087d469c896f87430c9fd4462a20782d7e50257fcf949260fc99` |
| `crates/rh-sim/src/cards/after_damage.rs` | modified | `fc54b34bc9e0d5fc29321d8aba333837c6457f18afdf3e41b7db65c49b921261` |
| `crates/rh-sim/src/cards/runtime.rs` | modified | `f332f3af9077cf03b6ac7a62c3d5c3c79321bf3fa437b5eccef5b59a0862a5a2` |
| `crates/rh-sim/src/checkpoint.rs` | modified | `567a9463e9de1ce7c1548bc948230ce9bbe8a319d2645b0a0bde85c0c234f02a` |
| `crates/rh-sim/src/content.rs` | modified | `666c301d17146c4b43529b8ed25de74469347ded702bf43c7d2bf94bc9e7371c` |
| `crates/rh-sim/src/events.rs` | modified | `7a432b9ba335a993052fcbd3b741a726d0d0546ea1eee38e34de10358e90e35b` |
| `crates/rh-sim/src/fx_projector/exact.rs` | modified | `07e9536bf0eb5a945362d54e6598d057346182ab4b6ea61f8efccc32d9570f8f` |
| `crates/rh-sim/src/fx_projector/mod.rs` | modified | `f57dcb1995c0fa5a93507839d88b285b95a0efe3f66be1d818525c9159f08b31` |
| `crates/rh-sim/src/fx_report.rs` | modified | `6d56e2f40f8ec468d1b72734b5b6014449b94f7026cf558fd8e944b5715bae0e` |
| `crates/rh-sim/src/observe.rs` | modified | `6d9b7f4f7eef0aed1ca0a1b1780861d651af0878de053e3a5f12c68c919455bb` |
| `crates/rh-sim/src/replay.rs` | modified | `d2e51387712b864ccabb5ea7c1697d29073c577b8697fdc0ee0685a79e674774` |
| `crates/rh-sim/src/schedule.rs` | modified | `b4c363c2c8cc13d6e0224a2f9ee12b612163aeada0d33f3cbe5afcf362b30590` |
| `crates/rh-sim/src/scratch.rs` | modified | `992967d62f44a290011fe6aa5daf93c601ca05b63077d3083ffb843feb44155e` |
| `crates/rh-sim/src/sim.rs` | modified | `eb769df56a1c0614fbf62eb9c4a7634c08bbe2c65ebf035c88d1033926c14094` |
| `crates/rh-sim/src/state.rs` | modified | `ec3ed9b734dd020f6f569cebd049045a34d331380a21f6315c21bd2ef1c3f5d0` |
| `crates/rh-sim/src/systems/mod.rs` | modified | `2546b3bb0daa8d7110344cc2b2608d192d3f67d54963d401503efc55611adbf1` |
| `crates/rh-sim/tests/hash_coverage.rs` | modified | `d3bb995e9532d188c3697c7fb8c1796a316a2486e4d6d24b74ffdbaed5fd20ae` |

## Version identity hunks (authorized)

| Path | Git state | SHA-256 |
|---|---|---|
| `crates/rh-sim/src/fighter.rs` | modified | `ee6c5b27dd9cdf48adddec903a6fd3357346567416a54a9a5dd3170da1218efa` |
| `crates/rh-sim/src/reward_chests/trophy_observer_tests.rs` | modified | `4c37d80681e21fcf6831aea87e643c2bac005135ce29b174c2e361cc0bde3c92` |
| `crates/rh-sim/src/systems/sentenced/npc_tests.rs` | modified | `a6db7f2350fb166f95c3d6bf026e1e59df71f88931d9907459a665e74b0a8072` |
| `crates/rh-sim/tests/checkpoint.rs` | modified | `98fd202c3ce1f3aeb3dbecc0252a6fb823d70bf20c2abe4eb7e321f85bc459af` |
| `crates/rh-sim/tests/replay.rs` | modified | `ff90e6a0ec1b029bc1584818f272ba72194f9713e41c12475e5c91b925150ac6` |

## Derived identity (narrow 827422b5 authorization)

| Path | Git state | SHA-256 |
|---|---|---|
| `crates/rh-sim/tests/content.rs` | modified | `57f1ee8bfdbb8d8437d0f7ebcfef380e8caaefe9d28e9fef33c4a89405069de4` |
| `parity/abilities/hash-tape.json` | modified | `17fc8309e839fdc411686ec455fc5178ccb1e2a88b303896fe77eaa054457393` |

## NPC pre-admitted candidate (exact 0be00f95 content; not re-authored)

| Path | Git state | SHA-256 |
|---|---|---|
| `crates/rh-sim/src/systems/mob_checkpoint.rs` | modified | `10262155531cc4621e07c19307dcaa152d91557d58e902ac4bd8ad70d5a31002` |
| `crates/rh-sim/src/systems/mob_checkpoint/bleed_tests.rs` | new | `125af1504c9e2736e861d93e0078477e2bc49c8e0e2707e3f44cce3e913921a1` |
| `docs/evidence/npc-bleed-restore/README.md` | new | `91d7bf67a6b10c3be8bd9bebf9973f5bca4d9e8799ef7ceb248a3a57968d85d8` |

## Sanitized Card evidence (new)

| Path | Git state | SHA-256 |
|---|---|---|
| `docs/evidence/card-bleed-native/README.md` | new | `560329800644d7abadf08d5df5278285779c5a5b0a2aeb445731a54704071f7f` |
| `docs/evidence/card-bleed-native/receipts/ability-63-source-final.log` | new | `28fae9d25952160b46b75295a685070c2030a2e275373d7ec61082329d689669` |
| `docs/evidence/card-bleed-native/receipts/ability-63-source-prefinal.log` | new | `ae0262fc4f954474aa1505f5ec5ecf214f24849ec5c294962102d10dc3278578` |
| `docs/evidence/card-bleed-native/receipts/ability-hash-tape-record.log` | new | `40f6879c6ae990fb8c05713732129c8b89a1e55db292c9ee13ba48836f22cdf3` |
| `docs/evidence/card-bleed-native/receipts/capacity-ledger.txt` | new | `496c67330771f535b9634d6a44e35b3e5b74120e75a7a2adb48fc4bccf532f16` |
| `docs/evidence/card-bleed-native/receipts/card-alloc-GREEN.log` | new | `d07f8f045dbc2cd2a4e28989d73b4803986142d56a197d83de90a963797bb186` |
| `docs/evidence/card-bleed-native/receipts/card-alloc-RED.log` | new | `7ad6ff9ff6b1a8c179b9d54f440af9dbe45d97c743d5815420effa19bc5661fc` |
| `docs/evidence/card-bleed-native/receipts/card-focused-delta.log` | new | `082762fbf0ac1356df6b2761cc4faa3e3c814f57db4439317e380a70cdaa9148` |
| `docs/evidence/card-bleed-native/receipts/card-fractional-clock-GREEN.log` | new | `4df6d52b00226a48d08dfae655c9cf07a90f693f2f4b615afbc3da8277355c99` |
| `docs/evidence/card-bleed-native/receipts/card-fractional-clock-RED.log` | new | `0676b35ea6e8a7ff2ee979d645126a5a9752db9e28143dbc7baa78847845971a` |
| `docs/evidence/card-bleed-native/receipts/card-history-envelope-GREEN.log` | new | `e710a6de86882760028e33ae089d9565b5bb76fcaee059c622b1316409164e68` |
| `docs/evidence/card-bleed-native/receipts/card-history-envelope-RED.log` | new | `209f4914184affc9d7cc8fb094fa7f766cdee1ee653bc7c825ebd0f7f412ceac` |
| `docs/evidence/card-bleed-native/receipts/card-public-output-alloc.log` | new | `49afb8695af179bd899b55a841687d2ef1cc678d3b51bd342dbac7deb80507c5` |
| `docs/evidence/card-bleed-native/receipts/card-strict-b3-alias-GREEN.log` | new | `2d145d0b9341908c971baeaa37f8adc24a2519079f960abd3863c991a68d5eb7` |
| `docs/evidence/card-bleed-native/receipts/card-strict-b3-alias-RED.log` | new | `66a9df00d19e461676220f85b9b4d60bcb889f5c7c046363a2285676a1ba8510` |
| `docs/evidence/card-bleed-native/receipts/clippy-rh-sim-all-features-final.log` | new | `50ddcc9fb308e145cfb190f0d98e4c627df5c7b3c776308fa9c9adbbc9fdd938` |
| `docs/evidence/card-bleed-native/receipts/clippy-rh-sim-default-final.log` | new | `88b35f73df961dc6803fa2ce5ce6f87dcac54efa6c9d3fd4fae5c0604543d86b` |
| `docs/evidence/card-bleed-native/receipts/full-suite-final-summary.txt` | new | `828731cfb08fe130ce5618916a170d6d0106299137edda9a1437ca0ccc2feb6a` |
| `docs/evidence/card-bleed-native/receipts/full-suite-final.log` | new | `8da480470fb3b8ae28a30ad84fbd47eb8239e5f21e970618486599a3c5ee515d` |
| `docs/evidence/card-bleed-native/receipts/pins.log` | new | `d0be27ab87dffd1aa684871f8579099eced2ac062bce37c4537a4d935c117332` |
| `docs/evidence/card-bleed-native/receipts/pre-record-derived-failures.txt` | new | `87236487948ce92be01b265dc02136d62999d06ca63d650710ce31723fbaacdf` |
| `docs/evidence/card-bleed-native/receipts/tape-after.sha` | new | `dcdacd01f5173aa4a64405bd891df7a84195f95074331839078f3a832897ff45` |
| `docs/evidence/card-bleed-native/receipts/tape-before.sha` | new | `81d520bbd4d1d941de157c8ee3e15e1de7de43d1d779ca27935367d55c6f55c5` |

## Version / identity reservation binding

`CHECKPOINT_FORMAT` `rh-checkpoint/30`; `REPLAY_FORMAT` `rh-replay/24`; `OBSERVATION_VERSION` 22;
`POLICY_CONTRACT_VERSION` 16; content visitor marker `card-bleed-feedback/1`; protocol/wire remains **14** and
no protocol fixture, client, Unity or Cargo.lock file is in this manifest (unchanged).

Derived identity authorized by Root at `827422b5`: only the existing `record_ability_hash_tape` recorder was run
(tape before `9df7ffb87d81062d513257f17efe6e003fab047fc62d0177e7f8396e1ca3d4c4`, after
`17fc8309e839fdc411686ec455fc5178ccb1e2a88b303896fe77eaa054457393`; format `rh-ability-hash-tape/2`,
checkpoint 30, contentHash `fa16f195dc22ef69`, observationVersion 22, 63 cases) and only `GOLDEN_CONTENT_HASH` in
`crates/rh-sim/tests/content.rs` was updated. No hand-edited fold answers; source fixtures/tools/cases untouched.

## Explicit exclusions (not part of the candidate)

`target/` and any build caches; all private `/tmp` transcripts and full private checkpoints (only the sanitized
`docs/evidence/card-bleed-native/receipts/` files are in the candidate); the primary checkout; Claude networking/
Unity/`client-unity`; `protocol/` fixtures and generated codecs; `Cargo.lock`; all source fixtures, capture tools
and released source/design evidence under `parity/card-bleed-feedback/`, `tools/card-bleed-fixtures/` and
`docs/evidence/card-bleed-*review*`; shared status records (`docs/MIGRATION.md`, `docs/CONTRACTS.md`); quest/bot
worker trees. `mob_checkpoint.rs`/`mob_checkpoint/bleed_tests.rs` were **not re-authored** — the worktree contains
the exact pre-admitted `0be00f95` content for combined testing only, already admitted by Root.

## Final validation binding (exact receipts in `docs/evidence/card-bleed-native/receipts/`)

* Unchanged 63-case ability SOURCE gate on final producer semantics: `frozen_full_source_all_63_cases`, exit 0,
  1 passed/0 failed, 16.24 s (`ability-63-source-prefinal.log`). The retained `ability-63-source-final.log` is the
  HISTORICAL 15.85 s pre-capacity run, not a standalone post-record receipt. No retained receipt verifies the
  previously stated 15.60 s timing; that claim is withdrawn. The final full-suite receipt also contains the
  unchanged 63-case SOURCE gate passing.
* Full `rh-sim` suite `--no-fail-fast`: EXIT 0, library 881 passed/0 failed/15 ignored (765.79 s), slowest
  integration target `hash_coverage` 10 passed/0 failed, `FAILED` lines 0. Raw log preserved as
  `receipts/full-suite-final.log`; summary `receipts/full-suite-final-summary.txt`. This run binds production
  semantics; every later change is test-only witness/capacity/evidence work plus `cfg(test)` accessors and
  `cfg_attr(allow)` cleanup (production code unchanged).
* Final strict lint binding on the final code: `cargo clippy -p rh-sim --all-targets -- -D warnings` exit 0 and
  `--all-features` exit 0; `rustfmt --check` exit 0 (`clippy-rh-sim-*-final.log`).
* Isolated allocation profilers (CI runs serially): `card_bleed_alloc` (cold construct/clone/restore/rebind, first
  and second unseen pair, repeated and bounded growth as reported in the README) and
  `card_bleed_alloc_public_output` (2,104-row >legacy-output public flush, `feed_alloc_blocks=0`).
* Strict B3 intake, >512 restored-report vs pending-`Q+T0` envelope, representability refusal, fractional
  accepted clock, derived content/tape and the actual public-stream comparator are covered by the focused tests
  and RED/GREEN receipts listed in the README.

**No claim of native admission, universal memory cap, all-ability coverage, speedup, zero-allocation combat or
client/Unity parity is made by this manifest.** Root alone seals, integrates and records admission.

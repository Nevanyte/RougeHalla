# P-AUG-PERF-1: the rework's instruction cost in legacy worlds (2026-11-21)

Oracle: `python3 tools/perfproof/perfproof.py --baseline 1dd79a938 --max-ir-ratio 1.03 --max-alloc-increase 0`, run in a
native arm64 Linux container (`rust:1-bookworm`, toolchain 1.97.0 from `rust-toolchain.toml`, valgrind 3.19). Instruction
counts are deterministic; arm64 ratios approximate CI's x86 ones (CI is the final word).

## Before (`d686f84a2`, the brief's base)

| workload | Ir base | Ir cand | ratio | allocs | same behaviour |
|---|---|---|---|---|---|
| sim_crowded_8 | 153565 | 178295 | 1.1610 | 0.24 = 0.24 | yes |
| sim_duel_chase | 38606 | 45271 | 1.1726 | 0.15 = 0.15 | yes |
| sim_fists_duel | 38054 | 44573 | 1.1713 | 0.39 = 0.39 | yes |
| paths_300 | 368132 | 368131 | 1.0000 | 1.30 = 1.30 | yes |
| wire_seed1_8bots | 924579 | 960186 | 1.0385 | 21.27 = 21.27 | yes |
| headless_seed1_8bots | 294296 | 317490 | 1.0788 | 0.19 = 0.19 | yes |
| headless_seed1_recorded | 265800 | 286692 | 1.0786 | 0.14 = 0.14 | yes |
| headless_arena_8bots | 363468 | 388675 | 1.0694 | 0.95 = 0.95 | yes |
| verify_replay | 222819 | 243180 | 1.0914 | 0.13 = 0.13 | NO: contentHash same -> ignored |

## After (`05d7c357a`, run with `--allow-fingerprint-change verify_replay.contentHash`: `gate: pass`)

| workload | Ir base | Ir cand | ratio | allocs | same behaviour |
|---|---|---|---|---|---|
| sim_crowded_8 | 153565 | 140889 | 0.9175 | 0.24 = 0.24 | yes |
| sim_duel_chase | 38604 | 35083 | 0.9088 | 0.15 = 0.15 | yes |
| sim_fists_duel | 38053 | 34700 | 0.9119 | 0.39 = 0.39 | yes |
| paths_300 | 368132 | 368137 | 1.0000 | 1.30 = 1.30 | yes |
| wire_seed1_8bots | 924579 | 913430 | 0.9879 | 21.27 = 21.27 | yes |
| headless_seed1_8bots | 294296 | 283288 | 0.9626 | 0.19 = 0.19 | yes |
| headless_seed1_recorded | 265800 | 255316 | 0.9606 | 0.14 = 0.14 | yes |
| headless_arena_8bots | 363468 | 350121 | 0.9633 | 0.95 = 0.95 | yes |
| verify_replay | 222819 | 212298 | 0.9528 | 0.13 = 0.13 | NO (declared): contentHash same -> ignored |

The same run without the declaration (at `46ec5aff7`, the same generated code: every Ir figure within 5 of these) fails
on that one line only.

Every fingerprint (final state hashes, outcome digests, state-hash folds, wire byte counts, replay `finalHash` and
`verified: true`) is identical before and after, and identical to the baseline's. The one remaining violation,
`verify_replay.contentHash` (`same` -> `ignored`), is not an instruction cost and not this packet's: the rework changed
the content hash on purpose (the card tables are folded into it), so a replay recorded by the baseline binary carries the
old hash and the candidate verifies it with `--ignore-content-hash` (every step hash is still compared: `verified: true`).
CI run 44862423148 reports the same line. It is cleared by declaring it in PR 80's description:
`Perf-Allow-Fingerprint: verify_replay.contentHash` (`.github/workflows/perfproof.yml` reads that line).

## Where the delta was (callgrind, per step, `duel_chase`, long minus short runs, both builds)

Base 38,607 Ir/step, candidate 45,272 (+6,666). Self-cost attribution by function:

- `Build::cards()` (+~5k net): P-AUG-NATIVE-1a chained the held native cards onto the filtered catalog walk
  (`Filter<IntoIter<CardId, 80>>.chain(NativeCards::held())`). The chained adapter stopped inlining into its callers and
  ran out of line, one call per catalog slot, in every walk: `after_damage` (every player, every step), `Build::rows` (each
  stat fold), `invested_scores` (each build mark), `has_flag` (Plant Your Feet's stillness, Best Offense). The new symbol
  alone cost 6,721 Ir/step; `after_damage` fell by 2,737 because its inlined walk moved into it.
- `systems::weapons::step_weapon` (+~1.2k at fix 1's point): P-SIM-PLANT moved Plant Your Feet's `plant_armed` from a
  landed melee hit to every standing player's weapon step, so `Build::has_flag` (a walk of every held card's rows) ran for
  every player every step, whether or not an attack started.
- The other suspects in the brief (`Tuning` lookups, the rule-aware cache check, the hook seams, the elite reads, new
  hashed state) did not show above noise: `Tuning::def` on the legacy table is an empty-slice search, and the state hash
  is folded once per run in the sim benches.

## The fixes, each measured (`duel_chase` Ir per step against the baseline)

| step | change | ratio |
|---|---|---|
| before | | 1.1727 |
| fix 1 | `Build::cards()` as one hand-written cursor (`HeldCards`): the 80 catalog slots, then the 14 native slots, the same cards in the same order | 1.0621 |
| fix 1 + 2 | the cursor skips an all-zero 8-byte word of catalog counts (a build holds few of the 80) | 0.9185 |
| fix 1 + 2 + 3 | `step_weapon` decides whether an attack starts first and reads `plant_armed` only then (the same reads, in the same step, before any write) | 0.9088 |

Fix 2 relies on `CardId::ALL[i].index() == i` and `CardId::NATIVE[j].index() == 80 + j`; `Build::cards` asserts both
at compile time (an inline `const` block over `cursor_is_index`).

No serialized field, hash definition, checkpoint, replay, observation or wire format, content hash, RNG draw or schedule
row changed. No allocation count moved.

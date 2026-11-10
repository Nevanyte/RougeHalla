# Sealed candidate receipt — P-BOT-MODULES-1 native modules

Status: **scoped native candidate sealed for Root/independent admission.** This is not native admission, not live
activation and not a whole-Brain completion claim.

| Fact | Value |
|---|---|
| Worktree | `/Users/nevinmckinnon/Documents/Projects/RogueHalla-worktrees/backend-bot-modules` (gitdir `/Users/nevinmckinnon/Documents/Projects/RogueHalla/.git/worktrees/backend-bot-modules`) |
| Branch | `codex/deepseek-private-modules` |
| Base HEAD at dispatch | `9f74ff3e87461ff31f84720240455d6ef33f420b` |
| Candidate implementation commit | **not created in this session** — the worktree gitdir is outside the session workspace and `git add` is denied (`fatal: Unable to create '.../index.lock': Operation not permitted`); per dispatch no permission expansion was requested. Root seals from the exact scoped-file manifest below. |
| Exact scoped-file manifest | [CANDIDATE-MANIFEST.sha256](CANDIDATE-MANIFEST.sha256) (SHA-256 + git blob SHA-1 + bytes + mode per file) |
| Tracked-file change patch | [CANDIDATE-MODIFIED.patch](CANDIDATE-MODIFIED.patch) (`git diff --binary` from base `9f74ff3e`; the five leased existing files) |
| Content seal receipt | [SEAL.txt](SEAL.txt) (base, manifest SHA-256, patch SHA-256, file count, reproduction commands) |
| Root bridge lease | `de908f2b` (read-only; not cherry-picked/merged) |
| Frozen source corpus | 12,755,158 B SHA-256 `645e85f16adbea001f8d0e06a70b6e5d311864ed9691622c06b789c95578b012` (untouched) |

No merge/push/rebase was performed; no shared status record, Cargo.lock, dependency, source/golden/tool/corpus,
World/Sim/observation/protocol/client, learning store or live-activation file was changed by this lane.

## Scoped file inventory (candidate implementation commit)

Tracked existing files changed exactly as leased (five):

- `crates/rh-policy/src/bots/planning.rs` — shared plan transition core + source f64 deal/index adapter.
- `crates/rh-policy/src/bots/wish.rs` — thin public adapters over the new shared wish core.
- `crates/rh-policy/src/bots/hazards.rs` — thin public adapters over the new shared hazard core.
- `crates/rh-policy/src/bots/temporal_percept.rs` — `mod modules;` only.
- `crates/rh-policy/src/bots/temporal_percept/strategy.rs` — `pub(super) mod types;` only.

New files added (all packet-owned new-file lease; no deps):

- `crates/rh-policy/src/bots/wish/source_core.rs`
- `crates/rh-policy/src/bots/hazards/source_core.rs`
- `crates/rh-policy/src/bots/temporal_percept/modules.rs`
- `crates/rh-policy/src/bots/temporal_percept/modules/` — `types.rs`, `choice.rs`, `chest_hunt.rs`, `chests.rs`,
  `planning.rs`, `wishes.rs`, `hazards.rs`, `registry.rs`, `source_reader.rs`, `source_input.rs`, `source_trace.rs`,
  `source_tests.rs`, `controls_tests.rs`, `catalog_tests.rs`, `planning_core_tests.rs`
- `docs/evidence/bot-private-modules-native/` — this evidence set (`README/REPLAY/CONTROLS/OVERLAPS/NUMERICS/BRIDGES/
  SEND-COMPAT/LEDGER/RUNS/CANDIDATE`, `bridge-proposal.md`, `LEASES-ACK.md`).

Inventory was verified with `git status`/`git diff --stat` and is frozen in `CANDIDATE-MANIFEST.sha256`; a checker
re-runs every SHA-256, git blob SHA-1 and byte count against the worktree. Root can reproduce the candidate from base
`9f74ff3e` by applying `CANDIDATE-MODIFIED.patch` and placing the manifest-listed new files, or by committing the files
directly from this worktree with Root's own git access. `SEAL.txt` records the manifest/patch digests; it is generated
last and is excluded from the manifest (as is the manifest itself).

## Seal method (git metadata not writable)

The worktree git metadata lives at `/Users/nevinmckinnon/Documents/Projects/RogueHalla/.git/worktrees/backend-bot-modules`
(outside the session workspace). `git add`/commit is denied and no permission expansion is requested per dispatch, so the
candidate is sealed by exact content instead: every scoped file's SHA-256, git blob SHA-1, size and mode, the tracked-file
binary patch from base, and a final `SEAL.txt` digest receipt. `git diff --stat` of the tracked files (read-only) is:

```
 crates/rh-policy/src/bots/hazards.rs               | 220 ++-----
 crates/rh-policy/src/bots/planning.rs              | 641 +++++++++++++++------
 crates/rh-policy/src/bots/temporal_percept.rs      |   1 +
 crates/rh-policy/src/bots/temporal_percept/strategy.rs |   2 +-
 crates/rh-policy/src/bots/wish.rs                  | 361 ++++--------
 5 files changed, 627 insertions(+), 598 deletions(-)
```

## Candidate gate results (all on the frozen final tree)

- Frozen source replay: **255 cases / 3,259 operations / 0 failures** (exact).
- Whole `cargo test -p rh-policy --lib`: **354 passed / 0 failed**.
- Controls: 24/24 strict intake negatives; 28 native semantic controls; KILL-id coverage map in CONTROLS.md.
- Old overlaps: planning_parity 6/6, wish_parity 6/6, wish_module 8/8, old hazards 4/4, bot hand 17/17, Memory 13/13,
  Strategy source 11/11, plus parity/knowledge/paths/view/mob-hunt/knowledge-repair filters (OVERLAPS.md).
- `cargo fmt -p rh-policy -- --check`: clean.
- `cargo clippy -p rh-policy --lib --tests [--all-features] --locked --offline -j1 -- -D warnings`: clean.
- Numeric policy: exact-only, no tolerance applied or pre-approved (NUMERICS.md); first failures retained (RUNS.md).
- Root pre-seal `Send` correction applied and asserted (SEND-COMPAT.md).

## Admission boundary

Root/independent admission still required for: the sealed tree, the leased existing-engine bridges, the finite module
method profile, and this candidate's claimed closure. Native modules are inactive private policy code: no fair
publication, no earned observation intake, no createBrain composition/cadence/hand features/sequences/stats/end and no
live/headless seat activation are claimed. Source seal ≠ native admission.

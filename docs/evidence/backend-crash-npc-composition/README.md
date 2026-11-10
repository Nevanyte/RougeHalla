# Backend crash and NPC restore composition

Root execution,2026-11-10. Imported Claude crash commits `a1f1d129`/`406279b3` as `700a3ae7`/`094f612f`,
then independently admitted DeepSeek NPC restore `0be00f95` as `dedb8658`. Root preserves the existing Frost
guard ordering from the backend; no whole-file replacement was used. This is bounded integration evidence,
not final whole-workspace, live bot, client or deployed-runtime acceptance.

## Exact execution

Cwd `/Users/nevinmckinnon/Documents/Projects/RogueHalla-worktrees/backend-gameplay-quests`;
`/Users/nevinmckinnon/.cargo/bin/cargo`, Rust1.97.0, locked/offline tests, jobs1, incremental0.
Worktree-local shared Root target `target/root-strategy-notice-admission/build`.

- Initial `rh-sim` lib filter `systems::fighter_churn_tests` (locked/offline):
  2PASS/0FAIL,853filtered,test0.03s,wall98.52s. This compiled before the NPC merge and is scoped to that cut.
- `cargo test --release -p rh-headless --test source_arena_soak --locked --offline -- --ignored`:
  1PASS/0FAIL,test42.28s,wall309.23s. Release compilation followed the NPC integration. It exercises five historically
  failing seeds twice each, up to6000ticks, comparing tick count and private state hash. The runner exits on either
  terminated **or truncated**; this proves bounded no-panic/determinism, not that every run reached normal match end.
  It uses the existing HumanBot, not the unfinished full private Brain.
- Initial `cargo fmt -p rh-sim -p rh-headless -- --check`: exit0,wall2.47s.

To bind the final NPC/crash combination directly, Root then froze Rust at `dedb8658` (only docs advanced to
`9f74ff3e` during this check) and ran:

- `cargo test -p rh-sim --lib systems::mob_checkpoint::bleed_tests:: --locked --offline`:
  6PASS/0FAIL,855filtered,test3.40s,wall113.23s including compile.
- `cargo test -p rh-sim --lib systems::fighter_churn_tests:: --locked --offline`:
  2PASS/0FAIL,859filtered,test0.01s,wall0.24s.
- `cargo fmt -p rh-sim -p rh-headless -- --check`: exit0,wall2.65s.

Raw logs are adjacent. No private checkpoint, state hash value or credentials are published. No failures occurred in
these Root commands; earlier author/reviewer failures remain in their original evidence. Broader final integration
checks will run after the remaining admitted backend work is composed, not be inferred from these filters.

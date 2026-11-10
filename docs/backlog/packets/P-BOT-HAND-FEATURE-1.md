# P-BOT-HAND-FEATURE-1: preserve source feature rejection before hand work

Root dispatch,2026-11-10, from admitted backend `ff31fb22` plus this record; isolated
`codex/deepseek-hand-feature` in `backend-bot-hand-feature`. This implements B0 in
[BOT_BRAIN_COMPLETION.md](../../coordination/BOT_BRAIN_COMPLETION.md). DeepSeek owns all Rust/tests. No Claude contact
before10:30am Edmonton (17:30UTC). This does not activate bots or change any client/wire/runtime identity.

## Exact scope

Existing `crates/rh-policy/src/bots/humanizer.rs`: only optional immutable message-type membership state, an opt-in
constructor while preserving the existing `new(tier,map)` behavior, and the source feature check at the start of offer,
before alreadyLocked/pending/repeat/reaction/delay/RNG work. Add a cfg(test) declaration for new focused tests under
`crates/rh-policy/src/bots/humanizer/feature_tests.rs` (and helpers beneath that new directory only if needed).
New evidence only: `docs/evidence/bot-hand-feature-native/**`. No other existing Rust write, types.rs redesign,
new dependencies, Cargo.lock, old fixtures/capture or shared status. Return any concrete missing visibility lease first.

Actual authority is `packages/server/src/bots/brain/humanizer.ts` offer/COMMAND_TYPE and actual constructor semantics.
Optional absent features retains old behavior. Present empty messageTypes drops every offer without consuming hand
state or draws. Partial membership is by the **intent's** mapped command type: lock is checked as target even if its
later non-wand conversion emits attack. Preserve arbitrary source strings/membership rather than inventing capabilities.
Submit sorting/channel behavior, pending prior commands, release/flush and all existing humanizer behavior stay intact.

## Source and gates

Read required repo docs and the full real source/native engine. Sol's full Brain source packet includes six actual
hand profiles/twelve calls, but that source is still being sealed. Implementation may proceed from actual source now;
fixture reader/comparison/admission waits for Root's independent source release and exact transfer. Do not read evolving
source answers to tune inputs or write expected output from the native answer. Do not recapture old corpora.

After source release, compare all hand supplement channels and histories, valid source-supported absence/empty/partial
features, old absent-features overlap and real no-draw/no-state-change behavior on rejected offers. A continuation must
establish earlier accepted pending work is preserved. Add an actual semantic control for moving the feature check after
draw/state work and the lock target-vs-attack distinction. Run relevant unchanged hand/core filters, format, strict
rh-policy lib/tests Clippy default and all-features with -D warnings. Use Rust1.97.0, locked/offline, jobs1,
incremental0/debug0, worktree-local target; preserve first failures and exact command/cwd/code/source receipts.

Seal the scoped result for independent review; no merge/push. The full private Brain composition and fair live/headless
binding remain separate required admissions.

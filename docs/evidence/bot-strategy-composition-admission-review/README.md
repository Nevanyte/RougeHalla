# Strategy composition bridge — independent candidate review

Date: 2026-11-10. Scope: independent read-only review of the six-file candidate in
`/Users/nevinmckinnon/Documents/Projects/RogueHalla-worktrees/backend-bot-strategy-composition`, against the released
[P-BOT-STRATEGY-COMPOSITION-BRIDGE-1](../../backlog/packets/P-BOT-STRATEGY-COMPOSITION-BRIDGE-1.md) and its plan review. No Rust/test command was run and no candidate file was edited.

## Candidate identity and scope

The inspected worktree remained at `bed245bd9c1a966d61dc449335f97f1102ec4555` (`codex/deepseek-strategy-composition`), with six modified Rust files and only the new `docs/evidence/bot-strategy-composition-native/` evidence directory untracked. The author receipt's saved and live diff SHA-256 both equal `8b796701fbe99f3548a61b05a5da53921c41a31827316beea40c53e5c298983e`; its six file hashes are in `bot-strategy-composition-native/logs/final-candidate-hashes.txt`. The independent inspection began while these exact bytes were uncommitted. The candidate has since been sealed as `96905908bbe1ae9faf8c4b78f434a8061d1cdc79`; I verified that commit has the same six-file diff SHA-256 and file hashes above, plus only the scoped native evidence receipt/logs. This review binds to seal `96905908bbe1ae9faf8c4b78f434a8061d1cdc79`.

The six-file delta is confined to `strategy/{types.rs,mob_hunt.rs,engine.rs,source_trace.rs,private_strategy_tests.rs,source_tests.rs}`. The `hunt_adapter.rs`, `build_route.rs`, `source_reader.rs`, and `source_strict.rs` bytes match the base receipt. No source corpus/tool/expectation, lockfile, manifest, public Policy interface, or strategy algorithm delta was found.

## Review findings

**Conditional RELEASE of this exact candidate for Root's final seal/integration, with no substantive HOLD found in the assigned bridge scope.** The code matches the approved seams:

- `types.rs` changes only the persisted callback aliases to `Arc<dyn Fn... + Send + Sync>` and the default `FeatureModule::goals` context to `&mut StrategyContext`, retaining `&self` and its empty default. `mob_hunt.rs` constructs the existing no-op callback with `Arc`.
- `engine.rs` forwards the current mutable context at the existing goal-hook stage. It copies only the immutable `modules` slice and `features` references from cfg; ordering, enabled checks, candidate normalization, and later dedupe/selection remain in their existing positions.
- No `hunt_adapter.rs` rewrite is needed: its existing `opts.log.clone()` and the Strategy callback clones now clone the same Arc callback allocation. There is no wrapper closure or independent callback state. The no-op and callback storage are Send-safe without unsafe implementations or a broader trait bound.
- The persisted test callbacks now use `Arc<Mutex<_>>`; the short guards are released before callback return/dispatch and poisoned locks panic. Source replay changes are the eight leased trace snapshot/reset accesses only. Both current `FeatureModule` test implementations adopt the signature.
- The new Send control asserts actual `Strategy`, `HuntAdapter`, `MobHunter`, options, and callback types; it additionally checks Arc pointer identity and the ordered callback transcript. The forwarding control reaches the module through actual `Strategy::decide`, makes a sentinel path request and a declared decide-stream draw, then checks the same caller-owned fake service/stream transcript. This proves Rust plumbing identity, not production path search or module parity.

## Receipt review and limits

The candidate receipt records baseline filters (11 declared and 11 source tests), then final declared filter **13 passed**, source filter **11 passed**, formatting, and default/all-feature `rh-policy` clippy with `-D warnings`, all exit 0. The unmodified source replay reports **98 cases / 658 operations plus 4 histories / 48 calls**, with the strict reader, trace-negative, and intake non-advance controls in the source filter. First compile and formatting failures are preserved, followed by recorded fixes and green final gates. The source and expected outputs were not edited. These are author-provided logs, reviewed read-only; I did not independently rerun them.

This bounded bridge does not demonstrate full Brain Send, production module composition, live/headless activation, fair observation binding, `validate`/`Sim::submit`, shared room path-budget ownership, or full-game parity. Those remain separate gates. The candidate is not yet sealed; Root should bind its final seal to the six hashes and diff identity above before integration.

## Tier lifetime check for future Brain composition

The current live bot producers use canonical static tier tables; I found no runtime tier resolver that creates a dynamic per-Brain tier:

- `packages/server/src/bots/brain/types.ts:125` defines the finite `TIERS` record. `BrainConfig.tier` at `:1150` is typed as `TierParams`, so the interface itself can accept values, but it does not imply that live callers construct them dynamically.
- `packages/server/src/bots/BotManager.ts:269,333` chooses a `TierId` from configured weights/seat overrides, then passes `TIERS[spec.tier]` at `:333` into `makeBrain` and runner. `packages/server/src/bots/BotClient.ts:301` likewise selects `TIERS[this.opts.tier ?? "hard"]` before `createBrain`.
- Native `crates/rh-policy/src/bots/types.rs:206` stores the same three canonical values in `pub const TIERS`; `TierParams::by_id` at `:482` returns `&'static Self` into that table.
- The `&'static TierParams` in `MemoryConfig` and retained `Memory` (`crates/rh-policy/src/bots/temporal_percept/memory.rs:91,276`) is therefore compatible with the observed live constructor contract. Strategy/Tactics can continue borrowing the caller's static reference. The source replay's `Box::leak` (`strategy/source_tests.rs:1796`) belongs to finite per-case fixture setup when the corpus supplies custom tier values; it is not evidence that production needs an owned dynamic tier.

Recommendation: for the current live path, let the private Brain receive the canonical `&'static TierParams` supplied by its caller and select it through `TierParams::by_id`/`TIERS`, with no production leak. Keep custom dynamic test profiles in finite test-owned storage or fixture-only allocations. Revisit the proposed `MemoryConfig<'a>`/owned-tier bridge only if a live producer is added that genuinely supplies mutable/custom per-Brain tier values; current BotManager/BotClient paths do not establish that requirement. This does not adjudicate Persona lifetime or broader Brain composition interfaces.


## Root seal and integration receipt

Root independently verified the exact six-file patch and all candidate file identities, sealed the reviewed bytes as
`96905908bbe1ae9faf8c4b78f434a8061d1cdc79`, and integrated them as
`0457716918b398320a38b93666b274bb68b35c29` on the backend branch. The earlier unsealed-candidate wording describes the
initial inspection only. The final seal satisfies the review's identity condition; the scoped bridge is admitted.
A combined full `rh-policy` check will follow the final Modules admission so it tests both composition dependencies.
This receipt does not claim that later combined check has run.

# P-BOT-MODULES-1 native lane — Root corrected bridge lease acknowledgement

Date: 2026-11-10. Worktree/branch: `backend-bot-modules` / `codex/deepseek-private-modules` (base `9f74ff3e`, admitted
backend `dedb8658`). Native lane: DeepSeek. Root allocation: committed `de908f2b` (branch
`codex/backend-gameplay-quests`), read via `git show de908f2b:docs/backlog/packets/P-BOT-MODULES-1.md` section
"Root corrected bridge allocation" and `git show de908f2b:docs/evidence/bot-module-bridge-review/README.md`.

## Binding corrections folded in

1. The two dispatched visibility lines only: `temporal_percept.rs` adds `mod modules;`; `strategy.rs` exposes
   `pub(super) mod types;`. No further edits there.
2. Planning: `TierId` is correct for the read/settle schedule tables (Schedules/index by `tier.id`); full declared
   `TierParams` is supplied wherever the source consumes `reaction.mu`, `softmaxT`, `lapseP`, etc. Raw finite-f64
   `SourcePlanDeal` is retained; the source spawn array-index adapter resolves only nonnegative integral in-range
   indices (`-0` → 0) and returns `-Infinity` otherwise, never truncating. The old public `PlanModule` wrapper and the
   source module run one private transition core (schedule/first-deal latch/phase/no-deal/read/last-call/asks/resend/
   settle/ready), with the old typed `PlanDeal` adapting into it (`planning_parity_tests` still green).
3. Wish: source rank is a finite f64 with source `floor`/clamp; no `u8` narrowing. The finite reader accepts the five
   actual built-in definitions plus all captured absent/invalid-def guard cases, validates preserved ordered
   `ai`/`blockedBy`/targeting/rank fields and Blaze's 64/300 distances, and refuses unknown future valid custom
   shapes before mutation — never a static-catalog fallback. No `rh-sim` blink edit: the existing fixed-distance leaf
   is used only under that proved profile, with the real open/collision maps and actual gate flag; the old public
   open/unlocked adapter behavior is retained unchanged. Availability/retry/slip transitions are one shared core; the
   source adapter consumes actual Memory `noteSent` lastCast/hit facts (never an inferred casting start or the old
   capped hit list), with the precise legacy-only fields documented in the wrapper.
4. Hazards: classification/search/step/hold/expiry/arrival/throttle/light/adjust become one private fact+service core;
   the old Observation wrapper and the source module both use it, no fabricated Observation/PlayerId. Distance origin,
   ordered preference tests and the actual clear/collisionMap callback timing are parameterized; stable ties, hold
   order and unchanged-list identity preserved; unknown/empty faction has no home exception and no fabricated faction.
5. No temporary mirrored engine survives in the final architecture. If a transition cannot be shared without changing
   source/public behavior, the lane reports the exact field and counterexample instead of duplicating.
6. Exact comparison first, no tolerance pre-approved. Any tolerance request must name a real failing leaf with
   source/native ancestry. Old overlaps (planning/Wish/hazard/hand/Memory/Strategy), all 255 histories/3,259
   operations, meaningful intake/nonadvance/semantic controls and strict default/all-feature fmt/clippy remain
   required; final code still needs independent admission.

## Current lane split (all DeepSeek-authored)

- Lead: planning shared transition core + source planning adapter, replay driver/evidence, integration.
- chest-core: choice leaves, `ChestHunter`, chests module (new files only).
- fixture-reader: strict atomic corpus reader/preflight (`modules/source_input.rs`).
- trace-encode: ordered encode/compare/callback transcript (`modules/source_trace.rs`).
- wish-core: `bots/wish/source_core.rs`, shared wish policy/transition refactor, source Wishes adapter.
- hazard-core: `bots/hazards/source_core.rs`, shared hazard core, source hazards adapter.

No source/golden/tool/corpus was written; the frozen corpus is read-only. Evidence directory:
`docs/evidence/bot-private-modules-native/**`.

# P-BOT-MODULES-1 bridge proposal review

**Disposition: partial approval in principle; corrections and a narrower shared-engine boundary are required before Root
allocates any existing-file hunk.** Read-only review of DeepSeek proposal at module worktree `9f74ff3e`, against the
admitted source candidate `d48b79bf` / review `63f6fda8`, its frozen finite corpus, P-BOT-MODULES-1, and the current
`planning.rs`, `wish.rs`, `hazards.rs`, and `rh-sim` blink helper. No Rust/test edits or executions were made.

## Safe direction

- The two already allocated visibility lines (`temporal_percept.rs: mod modules;` and
  `strategy.rs: pub(super) mod types;`) are narrow and fit the planned child-module access. They do not justify any
  further edits in those files.
- A raw `SourcePlanDeal` that keeps captured finite f64 values, literal-true `taken`, and string-only boons is the
  right boundary for `readDeal`. Exposing the learned-bias constants/callback and drawing through the real Brain RNG
  closures are also sensible shared leaf seams.
- Generalizing the existing pure wish cast policy behind a source-shaped definition/context adapter is preferable to
  adding another independent decision policy. The static `WISHES` adapter must continue to run the same cast-policy
  implementation and keep the old public functions/fixtures stable.
- Parameterizing the existing hazards search/classification leaves is appropriate. Source must call the actual
  path-service collision/clear callbacks at the exact hook point; a fabricated `Observation`, `PlayerId`, or synthetic
  `WishView` is not an acceptable bridge.
- Keep comparisons exact initially. The source candidate's NUMERICS explicitly authorizes no tolerance. Any later
  tolerance must be justified by an observed red path through the same source/native calculation and approved for that
  exact output leaf. Do not inherit strategy's `2e-6` path whitelist for whole callback records or module outputs.

## Required corrections before dispatch

### Planning

1. `source_schedule(..., tier: TierId, ...)` is correct for the source's read/settle lookup: `planning.ts` explicitly
   indexes `PLAN_RULES.read/settle` by `ctx.cfg.tier.id`. It is not a place to substitute `TierParams::by_id` for the
   full caller tier. `chooseSpawn`/`chooseBoon` use the actual `ctx.cfg.tier.softmaxT/lapseP`, and `mayAsk`/`spentAsks`
   use its `reaction.mu`; the source adapter must receive and preserve the complete declared tier values for those
   branches. Do not fail or broaden the schedule signature on this point.
2. The proposed raw f64 deal cannot be passed directly to the current `plan_spawn_score`, whose input is `i32`
   (`planning.rs:512-523`). Source JS indexes `spawnPool` with the raw number. Preserve its exact finite numeric value;
   only a nonnegative integral value that is a valid array index resolves a spawn. Fractional, negative, or out-of-range
   indexes have no `spawnPool[index]`, and `planSpawnScore` returns `-Infinity`. Do not truncate/cast them to i32 or
   replace that score with a default. Add a narrow f64 source adapter to the existing score leaf, keeping the old i32
   helper/public behavior unchanged.
3. The state transitions are compatible and should not be cloned into a second full planner. The raw deal and ordered
   event parser are genuinely source-specific, but schedule timing, first-deal latch, phase/no-deal timing, asks,
   resend count, settle, ready latch and output selection are already `PlanModule` behavior (`planning.rs:634-705` and
   following). Factor a shared private transition engine over the source-preserving deal/accessors and callback inputs;
   keep the existing public `PlanModule` methods as adapters so `bot-planning.json` remains unchanged. The current
   proposal describes the new source state machine in the module layer while sharing only some math; that is broader
   duplication than the packet permits.

### Wish cast policy

1. The `rank: u8` signatures in the current engine and proposal do not preserve the actual source contract or the frozen
   module corpus. The corpus calls ranks `-10` and `999`; source `rankOf` accepts a JS number, uses `floor` (nonfinite
   becomes 1), then clamps to `[1, ranks.length]`. Pass the original finite f64 through the source adapter and apply
   that exact operation before indexing. The one-rank current catalog happens to select rank 1, but a native reader
   that rejects or narrows the captured input is still wrong.
2. The current `TargetRule` enum has only Self/Unit/Point. The source union also has `dir`, and unit has `who`; source
   `decideCast` has a real `dir` engage branch. The frozen finite corpus is explicitly only the five current built-in
   Wish definitions and excludes arbitrary custom future `dir`/target combinations (LEDGER.md). Therefore either
   constrain/validate the reader to those five exact actual definitions and reject unsupported descriptors before
   any mutation, or represent the complete source variants. Do not claim a general opaque-AbilityDef port while
   silently discarding `dir`, `who`, unknown tags, or unknown effect members. For supported built-ins preserve ordered
   `ai`, `blockedBy`, targeting and rank effects exactly. Unknown tag behavior is not independently in this corpus;
   it must be explicitly outside the profile, not mapped to a recognized enum or dropped.
3. The existing `blink::landing` signature is `(map, collision_map, ring, locked, from, toward)` and uses fixed
   `MIN_DIST=64`/`MAX_DIST=300` (`rh-sim/src/abilities/blink.rs:136-180`). It does **not** accept `maxDist` or
   `minDist`; current `wish.rs:341-351` discards those args and forces the open map/unlocked path. The proposed claim
   that the sim leaf already takes effect-defined distances is false. For this finite five-Wish profile, validate that
   the actual Blaze effect distances equal 64/300 and call the existing leaf with the true source open map, actual
   `collisionMap()` and gate flag; keep the finite scope explicit. If arbitrary effect-defined blink distances are
   intended, Root must separately allocate a parameterized landing helper. Preserve ring membership from the public
   map and collision tests from the actual collision map; do not conflate those maps.
4. Reuse the existing Wish module state where source-compatible; current `WishModule` has its own availability,
   remember draw, retry, last-hit map, armed/sent slip, from/leg and reset state (`wish.rs:535-730`). The source
   adapter needs the full cfg-keyed Memory and actual lastCast plus arbitrary captured def, so its input seam is
   genuinely different, but that does not justify leaving two independently maintained implementations of the
   same availability/retry/slip transitions. Factor a shared private state transition core or document a precise
   incompatible legacy behavior per field and retain the public `WishModule` as a wrapper. Do not create temporary
   mirrored state that survives as the final architecture.

### Hazards

1. `hazards.rs` already contains the compatible full step/hold/expiry/arrival/throttle/light and adjust state machine
   (`Hazards::intents/adjust`, lines 131-234), not just reusable `burns`/`bad`. The source new file currently proposes
   another `Step` state machine. Reuse the existing state transitions by extracting a private fact/service-based core
   that accepts real owner/faction/phase/coliseum/goal/still/engaged facts plus the actual collision-map and clear
   callbacks. Keep the existing `Observation` API as a compatibility adapter; the new module calls the core directly
   from its already earned private context. Never construct an `Observation` or arbitrary `PlayerId` to fit the old
   API.
2. The shared current `nearest_tile` fixes both the distance origin (`around`) and accept rule (`segment_clear`), and
   hardcodes the two strictness passes (`hazards.rs:88-123`). The proposed source adapter has the right source inputs
   `around`, `from`, ordered tests and `accept`, but should be a parameterized shared search core, with existing Rust
   calls wrapping it as `[Clean, NotBad]` and their existing clear predicate. Preserve the source stable tie order
   (dy/dx candidate generation, then nearest-from ordering), strict test order, actual callback timing and no-change
   list identity. A separate `source_nearest_tile` that duplicates the tile search should not remain alongside the
   existing compatible engine.
3. Keep the actual source faction domain faithful. The finite source ledger covers six faction strings; an empty or
   unknown string has no home-terrain exception. An `Option<FactionId>` adapter is fine only if it preserves that
   exact non-home behavior and rejects no captured string. Do not invent a faction or derive it from a player ID.
4. `collisionMap()` has observable call timing: `intents` first returns a retained step without calling it, while
   `adjust` obtains it for an alive owner/faction even on an unchanged empty intent list. Keep these callback receipts
   in the shared core/adapter boundary; moving the call earlier or skipping it changes source behavior.

## Allocation recommendation

Approve the two existing visibility lines already dispatched. Before approving sections 2-4 as written, revise the
proposal to:

- preserve full source `TierParams` everywhere its methods consume it; keep `TierId` only for the schedule table;
- add raw-f64 planning score access without narrowing captured indices, and share the planner transition engine;
- preserve source rank as f64 and either close the reader to the five exact actual definitions or represent unsupported
  source unions without loss; correct the claim about effect-specific blink distances;
- route Wish and Hazards through shared transition cores where compatible, with legacy public wrappers retaining their
  current inputs/fixtures and the source modules using their actual accepted/source facts directly; and
- parameterize the existing hazards search with source-required origin, ordered tests and clear callback instead of a
  second tile-search implementation.

These amendments are small enough for a bounded Root lease but are not authorized by this review. The new-file
implementation may proceed only after Root allocates exact shared hunks and resolves the required corrections. The
source profile is finite (255 cases, 3,259 operations) and does not establish arbitrary future ability definitions,
all direct JavaScript accepted domains, full Brain integration, fair live publication, or live/headless activation.

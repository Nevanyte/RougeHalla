# Native hand feature gate and sealed direct-hand source comparison

P-BOT-HAND-FEATURE-1 (`docs/backlog/packets/P-BOT-HAND-FEATURE-1.md`), the B0 stage of
`docs/coordination/BOT_BRAIN_COMPLETION.md`: preserve the source's **feature rejection before hand work** in the
humanizer, and prove it against the sealed actual-source direct-hand supplement. Source `codex/deepseek-hand-feature`,
worktree `backend-bot-hand-feature`. DeepSeek authored every Rust/test line here; Root owns source transfer, scope and
admission; Sol/Luna prepared/reviewed the source. No live/public activation, protocol/wire/client change, merge or push.

**Result:** implemented and green on the final bytes: the old absent-features hand is unchanged, the optional
`messageTypes` gate rejects at the start of `offer`, and the native hand reproduces the sealed source's **6 direct-hand
feature profiles / 12 real submit→later-release operations** exactly (raw draws, counts, released commands, misses,
stats), with 13 malformed declared-intake controls refused by the new strict reader. The admitted old hand/core overlap
(`bot_core_humanizer_matches_source`) and the full `rh-policy` lib suite stay green, as do rustfmt and strict default /
all-feature `rh-policy` Clippy.

## Write inventory (lease compliance)

Modified existing Rust (only file leased):

- `crates/rh-policy/src/bots/humanizer.rs` (+38 lines): optional immutable message-type membership state, the opt-in
  `with_features` constructor keeping `new(tier, map)` behavior, the source feature check at the start of `offer`, and
  the `#[cfg(test)] mod feature_tests;` declaration. No other line/behavior changed; `rustfmt` clean.

New files (all inside the leased new directories):

- `crates/rh-policy/src/bots/humanizer/feature_tests.rs` (548 lines): six focused semantic controls.
- `crates/rh-policy/src/bots/humanizer/source.rs` (2588 lines): strict intake + comparison of the sealed direct-hand
  supplement and 13 malformed-declaration controls. Declared from `feature_tests.rs` via `#[path = "source.rs"]` so the
  helper sits directly beneath the new `humanizer/` test directory.
- `docs/evidence/bot-hand-feature-native/**`: this record, the baseline/first-failure record and raw receipts.

Not touched: `types.rs` or any other existing engine, dependencies, `Cargo.lock`, old fixtures/capture, parity goldens,
shared status records, protocol/wire/client/Unity, or public activation. No visibility lease was needed: the existing
`crate::bots::view::Features` type (runtime `detectFeatures`) is already public and is reused unchanged; `IntentKind::
command_type` already existed. The only missing input was Root's sealed source supplement, received as below.

## Source semantics implemented (unchanged authority)

`packages/server/src/bots/brain/humanizer.ts` (pinned SHA-256 `650519070f2580783e0e4c595950c1e41a35bf66f0f846f763eb5e4fb464f09b`):

```ts
export interface HumanizerConfig {
  readonly tier: TierParams;
  readonly map: GameMap;
  /** When given, an intent whose message type this server does not list is dropped here too (the adapter checks as well). */
  readonly features?: Features;
}
...
const COMMAND_TYPE: Readonly<Record<IntentKind, CommandType>> = {
  lock: "target", move: "move", stop: "stop", swap: "swap", pickup: "pickup", cast: "cast", plan: "plan", choose: "choose",
};
...
function offer(intent: Intent, ctx: BrainContext): void {
  const now = ctx.p.now;
  const ch = CHANNEL[intent.kind];
  if (cfg.features && !cfg.features.messageTypes.includes(COMMAND_TYPE[intent.kind])) return;
  if (intent.kind === "lock" && alreadyLocked(intent.target, ctx.p, now)) return;
  ...
```

Native mapping, kept deliberately minimal:

- `Humanizer::new(tier, map)` = source **absent** `cfg.features` (old hand exactly; all existing consumers unchanged).
- `Humanizer::with_features(tier, map, &Features)` = source **present** `cfg.features`: copies
  `features.message_types` once into private immutable state (`Option<Vec<String>>`). Membership stays arbitrary source
  strings — no capability enum, no parsing/normalization, unknown strings simply match nothing.
- The check is the first statement after the channel lookup in `offer`, exactly as in the source: before
  `already_locked`, before pending/repeat/supersede arbitration, before `new_decision_due` and therefore before every
  motor/lapse draw. A rejected offer cannot change pending work, priorities, `decision_due`, tokens, clocks, misses,
  stats or either RNG.
- The checked type is the intent's **mapped** command type (`IntentKind::command_type`): a lock checks `"target"` even
  though the later non-wand conversion emits `attack`+`release`. Present empty membership drops every offer; absent
  membership keeps the old behavior. `submit` sorting/channels, pending prior commands, release/flush and every other
  humanizer behavior are untouched.

## Tests

### Six focused semantic controls (`feature_tests.rs`, 6 tests)

| Control | What it establishes |
|---|---|
| `absent_features_and_present_full_membership_keep_the_old_hand` | `new` and `with_features` over the whole admitted command surface plus unknown strings produce identical releases, misses, stats and final motor/lapse stream positions on a scripted old-hand run; the script really releases Move/Attack/Release/Stop/Swap/Cast/Plan/Choose. |
| `empty_membership_rejects_every_offer_before_any_hand_state_or_draw` | With present-but-empty `messageTypes`, all offers are dropped with zero pending, decision clock, stats, tokens, `last*`, misses; both streams are byte-identical to their pre-submit state, and a later release is inert. This is the control for moving the check **after** draw/state work. |
| `lock_is_gated_by_its_mapped_target_type_not_the_attack_conversion` | `["target"]` accepts the non-wand lock (which converts to Attack+Release); `["attack"]` drops the identical lock with no state or draw. The target-versus-attack control. |
| `partial_membership_accepts_only_listed_command_types_and_preserves_arbitrary_strings` | The source test's core client set drops cast and keeps swap; extending the exact set with `"cast"` admits it; `"Cast"`, `"bogus"`, `""` list nothing (arbitrary strings, no invented capabilities). |
| `rejected_offers_do_not_draw_or_touch_hand_state` | Offering six unsupported intents beside one supported swap leaves exactly the pending rows, `decision_due`, stats and stream positions of a swap-only submission, and identical releases. |
| `rejected_offer_preserves_earlier_accepted_pending_work` | An accepted timed move stays pending unchanged when a later unsupported same-order-channel `stop` is rejected (no supersede/throttle/draw/re-time), and the earlier move still becomes exactly one click. |

### Sealed direct-hand source comparison (`source.rs`, 2 tests)

`parity/policy/bot-private-brain/source.json` (`rh-bot-private-brain-source/1`, direct supplement produced by unchanged
`createHumanizer` in `tools/bot-private-brain-fixtures/hand.mts`) declares six profiles — `absent`, `empty`,
`attack-only`, `target-only`, `partial` (`move`,`plan`), `all` — two real submit→later-release operations each, with the
raw per-lane draw traces, released commands, misses, stats, continued counts and a real-Memory side snapshot.

- `sealed_source_hand_supplement_matches_all_profiles` reads the supplement strictly (format tags, closed profile/op
  records, full hard tier, four seeds, open map and its declared layers/lengths, percepts, intents, traces, commands,
  misses, stats, counts, memory shape), asserts the declared tier equals the admitted `TIERS::Hard` table (constructor
  requires the existing `&'static` tier), then drives only the real hand APIs: `new`/`with_features`, `submit`,
  `release`, `drain_misses`, `stats`.
  - **Exact:** raw uniform draw values (bit-equal; the legacy mulberry32 is the admitted Rust stream), per-phase draw
    counts, cumulative per-lane indices/counts, released command count/order/kind, command ids/slots/flags, intents,
    priorities, stimulus presence/kind/subject/central, misses' target ids, every stats counter and reaction-kind set.
  - **Tolerance 1e-9 relative only on continuous leaves** (`at`, move/cast geometry, attack/release angle, stimulus and
    reaction times): the source computes Gaussians/angles with platform `Math.log`/`Math.atan2`, the port with the
    admitted Newton `ln` over forked libm and `rh_sim::math` — the same tolerance the admitted
    `bot_core_humanizer_matches_source` hand overlap uses.
  - The `absent` profile is the source-based old absent-features hand overlap; `all` proves present full membership is
    the same hand; `empty`/`attack-only` prove rejection before any draw/state; `target-only`/`partial` prove mapped-type
    gating (lock gated as `target`).
  - The declared `memory` side snapshot is shape-checked only (ordered real-Memory eight-field view). The hand never
    reads `ctx.mem`; the admitted Memory component owns its own method witnesses, and comparing it here would exceed the
    narrow hand lease. Nothing is reconstructed: the source expected values are decoded and only compared.
- `sealed_source_hand_reader_rejects_malformed_declarations` refuses 13 in-memory mutations of the frozen envelope
  before any hand is constructed or drawn: wrong source/method-value format, missing supplement, renamed profile, extra
  profile member, nonfinite declared clock, unknown tier id, `decide`-lane draw in the hand trace, skipped draw index,
  unknown intent kind, missing operation member, short profile lifetime, missing memory side field.

### Old hand/core overlap (unchanged fixtures)

`cargo test -p rh-policy --lib bot_core` passes the five unchanged admitted bot-core suite tests, including
`bot_core_humanizer_matches_source` (captured legacy timed commands/stats/misses; it constructs the old `new` hand).
No fixture, golden or expected value was edited or recaptured.

## Source transfer and provenance

- Sealed source: independent fresh pinned reproduction of full Brain source `6aaa4c6d33dad8a47ab7957b41d420fa78954af6`
  (parent `74e91370…`) passed exact capture/coverage bytes, controls, strict reader and manifest, with all 244 protected
  files unchanged; [independent review](../../../docs/evidence/bot-private-brain-source/README.md) release (Root
  integration copy `docs/evidence/bot-private-brain-source-review/README.md` at `8fa97f24`). The author seal is
  `docs/evidence/bot-private-brain-source/README.md`.
- Root transferred the exact 44 new source/tool/evidence files by cherry-pick **`90b191b3`** onto this worktree's
  `dcb33d15`; the uncommitted Rust WIP was preserved. The four canonical files' SHA-256 values match the author seal
  exactly (raw pins in `logs/12-source-transfer-and-corpus-pins.log`):
  - `parity/policy/bot-private-brain/source.json` — 22,020,382 bytes, `ed054bfd2663f4aa64d08f517295d07459c4543b92cae99c0356fb0d14ae3943`
  - `coverage.json` — 2,136,299 bytes, `c4ea7643d5dd16432f8788a8bd22ebe0bb6bdee45fa89902588e7f39d51a4c21`
  - `controls.json` — 20,336 bytes, `13a366f62aef962352656817843a15d9ff222af3c93641d609e35a34b45b1307`
  - `manifest.json` — 57,523 bytes, `f51b0f3a8766e613acef9263d1537fcc27ce03de1db40918da6ac11441161927`
  - trusted direct-hand tool pins include `hand.mts` `841a3610…`, `codec.mts` `18af593c…`, `verify.mjs` `c634fa70…`.
- No source was recaptured, no evolving source answer was read to tune inputs, and no expected output was generated from
  a native answer. The reader consumes only the frozen corpus.

## Commands, environment, exits (all run from this worktree root)

Environment for every Rust command (pinned toolchain 1.97.0, locked/offline, jobs 1, no incremental, no debug info,
worktree-local target):

```sh
CARGO_TARGET_DIR="$PWD/target" CARGO_INCREMENTAL=0 CARGO_PROFILE_DEV_DEBUG=0 \
CARGO_PROFILE_TEST_DEBUG=0 CARGO_NET_OFFLINE=true /Users/nevinmckinnon/.cargo/bin/cargo <args> --locked --offline -j 1
```

`cargo 1.97.0 (c980f4866 2026-06-30)`, `rustc 1.97.0 (2d8144b78 2026-07-07)` (from `rust-toolchain.toml`).

| # | Command (after `-p rh-policy --lib`) | Exit | Receipt |
|---|---|---|---|
| 02 | `cargo test … bot_core` — unchanged old hand/core overlap | 0 | `logs/02-old-bot-core.log`: 5 passed / 0 failed / 223 filtered |
| 03 | `cargo test … feature_tests` — 6 semantic + 2 sealed-source tests | 0 | `logs/03-new-feature-and-sealed-source-tests.log`: 8 passed / 0 failed / 220 filtered |
| 04 | `cargo test …` — complete `rh-policy` lib suite | 0 | `logs/04-full-rh-policy-lib.log`: **228 passed** / 0 failed / 0 filtered, 245.41 s |
| 05 | `cargo fmt --all --check` | 0 | `logs/05-fmt-check.log`: empty output |
| 06 | `cargo clippy -p rh-policy --lib --tests … -- -D warnings` | 0 | `logs/06-clippy-default.log`: clean |
| 07 | `cargo clippy -p rh-policy --lib --tests --all-features … -- -D warnings` | 0 | `logs/07-clippy-all-features.log`: clean |

Transcript-level receipts are committed with explicit `git add -f` because this repository's `.gitignore` ignores
`*.log`; the existing evidence directories keep their logs the same way.

## Semantic mutation controls (native code, disposable, reverted)

The controls execute real compiled tests; a mutation only counts when the build is captured successfully and the
assertions fail.

| Control | Mutation | Result | Restored |
|---|---|---|---|
| `logs/08-…` (semantic set) + `logs/10-…` (semantic + sealed source) | Move the source feature check from the start of `offer` to after `new_decision_due`/offer bookkeeping (the check-after-draw/state mutation). | Exit 101. With the sealed source: 5 failed — `empty_membership_…`, `rejected_offers_…`, `rejected_offer_preserves_…`, `lock_is_gated_…`, and `source::sealed_source_hand_supplement_matches_all_profiles` (the empty/attack-only profiles immediately expose the extra draws/commands). | `humanizer.rs` restored (SHA-256 verified at that revision) |
| `logs/09-…` (semantic set) + `logs/11-…` (semantic + sealed source) | Gate a lock by the later non-wand conversion type `"attack"` instead of its mapped `COMMAND_TYPE` `"target"`. | Exit 101. With the sealed source: 2 failed — `lock_is_gated_by_its_mapped_target_type_not_the_attack_conversion` and the sealed source comparison (`target-only`/`partial` profiles). | `humanizer.rs` restored |
| `logs/10-…`/`logs/11-…` | The same two controls re-run after the sealed supplement was transferred. | As above; no survivor. | Final `humanizer.rs` differs from the restored file only by the two updated doc comments; `git diff` review shows only the intended state/constructor/gate/module-declaration hunks. |

The earlier semantic-only receipts (`logs/08`, `logs/09`) are retained as the historical pre-transfer runs, same
mutations and same kills.

## Preserved first failures

See `00-baseline-and-first-failures.md` for the recorded baseline transcript and the exact first failures, including the
pre-change hand parity run, the incomplete shared-cargo-cache offline workspace-metadata probe, the two strict-Clippy
first failures (`clippy::unnecessary_mut_passed`, then `clippy::type_complexity`) and their repairs, and the source
reader integration failures (open-map `terrain` member, raw `seeds`/`counts` descriptors, and the negative-control shape
panic) before the final green receipts. No failure was silenced; the final receipts above are the final bytes.

## Limits (what this evidence does not establish)

- This is the narrow B0 hand seam only. No full private Brain composition, no B1 caller, no fair Observation/FrameRing
  binding, no `validate`+`submit`/headless/live bot activation, no runner/session/driver behavior, no persistence,
  protocol/wire/client/Unity change, no learning store, no public bot activation and no gameplay-rule change.
- The declared `memory` side snapshots are shape-checked but not compared: the direct hand never reads them and Memory is
  a separately admitted component with its own witnesses. Comparing it here would exceed the leased seam.
- Declared Percept facts the narrowed hand `Percept` does not carry (`viewT`, projectiles, minimap, the event stream,
  `percept.features`, and self/fighter/hud fields outside the hand's reads) are structurally/typed validated as source
  facts but cannot influence the native hand; only the hand-consumed fields are compared. This matches the existing
  narrowed `Percept` in `types.rs`.
- The hand's click model reads only the open map's collision layer (`BotMap` tiles); the other declared map layers are
  shape/length validated and not reconstructed. The declared open-map hash pin `696510049` is read and asserted, not
  recomputed natively (no map-hash port in this lease).
- The declared full tier is parsed and asserted equal to the admitted `TIERS::Hard` static because the existing
  constructor requires `&'static TierParams`; the hand runs with that static, as all existing consumers do.
- Scope of the gates is the `rh-policy` lib/test target only (as the packet requires): no full-workspace run, no
  workspace Clippy and no unchanged map/simulation campaigns were repeated locally. 228 is the complete `rh-policy` lib
  suite at this revision, not a workspace count.
- The 1e-9 relative tolerance is used only for genuinely continuous leaves, as justified above; there is no blanket
  tolerance on discrete outcomes, ids, counts, stats or draws.
- No merge, push, AWS operation or Claude contact occurred (the owner's no-Claude window ends 10:30 America/Edmonton /
  17:30 UTC on 2026-11-10; these commands ran before it).

## Per-operation checklist (`docs/ORDER_OF_OPERATIONS.md`)

1. **Phase/item:** Stage B0 “prepare hand feature gate” in `docs/coordination/BOT_BRAIN_COMPLETION.md`, serving
   P-BOTS-1/`P-BOT-HAND-FEATURE-1`; it is the prerequisite seam for B1.
2. **D-rules:** no design decision. D1 is not invoked — this is exact source parity with the admitted hand tolerance,
   not an outcome-class relaxation. D2 n/a. D5: no new design. D6 n/a. D9 n/a (no client prediction/trust).
3. **DEVIATIONS:** none — no intentional gameplay difference; absence/empty/partial membership match the source exactly.
4. **Shared status:** MIGRATION/CONTRACTS/backlog status/Cargo.lock untouched; Root integrates and updates them.
5. **Evidence:** this dossier names what it does **not** establish (above) and keeps the first failures and mutation
   receipts.

## Seal: git metadata unavailable, exact inventory handed to Root

The dispatch says “seal a scoped candidate (or exact file inventory if git metadata is unavailable); no permission
expansion”. Git metadata is **not available** to this session: the worktree's common git directory is
`/Users/nevinmckinnon/Documents/Projects/RogueHalla/.git/worktrees/backend-bot-hand-feature`, outside the session
workspace, and the Workspace Write file policy refuses writes there. The one seal attempt failed exactly (recorded in
`logs/13-seal-attempt-git-metadata-unavailable.log`, not re-run because the denial is a policy outcome):

```text
$ git add crates/rh-policy/src/bots/humanizer.rs crates/rh-policy/src/bots/humanizer/feature_tests.rs         crates/rh-policy/src/bots/humanizer/source.rs docs/evidence/bot-hand-feature-native/README.md         docs/evidence/bot-hand-feature-native/00-baseline-and-first-failures.md
fatal: Unable to create '/Users/nevinmckinnon/Documents/Projects/RogueHalla/.git/worktrees/backend-bot-hand-feature/index.lock': Operation not permitted
exit 128
```

No wider sandbox mode was requested and no workspace-write/settings change was made; no commit, merge or push followed.
The index is unchanged (`git status` lists only ` M` / `??`). **Root seals** the following exact inventory on top of
source-transfer commit `90b191b3` (whose parent is `dcb33d15`). Because this repository ignores `*.log`, Root must
`git add -f docs/evidence/bot-hand-feature-native/logs/*.log` (the existing evidence directories keep logs the same
way).

Existing file modified (1, and only 1):

- `crates/rh-policy/src/bots/humanizer.rs` — +38 added lines, no other hunk; `crates/rh-policy/src/bots/humanizer.rs`
  SHA-256 `6d08c937974ec6dd778cece44846b73ba4d72167c3021d9f442fe40e51843793`; `git diff --stat` shows exactly
  `1 file changed, 38 insertions(+)`.

New files (2 Rust tests + 2 evidence docs + 12 log receipts):

- `crates/rh-policy/src/bots/humanizer/feature_tests.rs` (548 lines),
  SHA-256 `d49bdd12ebec2916202a4f0132baed52d867f45b50c71c9793b9698082f56f6e`
- `crates/rh-policy/src/bots/humanizer/source.rs` (2588 lines),
  SHA-256 `03708d426e718704f048560b7246593b71d964d5f8ba1f10d5a6838aee1e9fd6`
- `docs/evidence/bot-hand-feature-native/README.md`
- `docs/evidence/bot-hand-feature-native/00-baseline-and-first-failures.md`
- `docs/evidence/bot-hand-feature-native/logs/02…12` (raw receipts listed in the commands/tests/mutations sections) plus
  `logs/13-seal-attempt-git-metadata-unavailable.log`.

Final hashes of the candidate code, this record and the receipts (the inventory receipt omits only its own
self-reference), the full working-tree inventory and the corpus/tool pins are in
`logs/12-source-transfer-and-corpus-pins.log`, regenerated after the evidence was finalized. The candidate commit hash
is therefore not claimed; this dossier plus the listed bytes is the seal handoff. The full private Brain composition (B1)
and fair live/headless binding remain separate required admissions; no merge, push, AWS or Claude contact occurred.

# Card bleed source candidate: HOLD

**HOLD source admission for `10519519bd4d9a5b55b1bf3042500d20c7ff4ea0`.** Independent pinned-runtime byte reproduction
passes, and the captured raw events genuinely exercise ordered card totals/cadence/run-end/teleport/reset. However, the
derived `cardContributions` list counts retained combat scratch on an already-ended step as another processed damage
contribution. Correct that source-reader/schema distinction before immutable admission. This review changes no source,
tool, corpus, Rust, client or shared status file. Root accepted this hold; source author owns the repair and new seal.

## Independent reproduction

Fresh review worktree: `/Users/nevinmckinnon/Documents/Projects/RogueHalla-worktrees/backend-card-source-review`, branch
`codex/card-bleed-source-review`, exact HEAD above. The tracked and untracked tree was clean before review receipts were
created. An empty ignored `node_modules` mountpoint was created solely for Docker's tmpfs mount.

Ran exactly `bash tools/card-bleed-fixtures/capture.sh --check`, exit0, with repository and canonical output mounted
read-only by the existing wrapper. Runtime is pinned to
`node:22.23.4-bookworm-slim@sha256:aaa4b5baf1ecff3b283486bb1f90405cdda225a3e6f79660d2c559fa510a7292`, linux/amd64;
the executed capture asserts Nodev22.23.4, linux, x64. The script installs the unchanged pinned lock with npm ci inside
container tmpfs. No host Node byte-proof, capture write mode, mutant sweep or old broad test was run.

- [Raw output](capture-check.log):7 cases,390 ordinary steps,289141 bytes, SHA-256
  `6bd92fff24f2825d708962e24d971adcc0161e271777a8c4bc35681254865af5`.
- [Command/exit receipt](capture-check-receipt.json): exit0, finished2026-11-10T06:21:12.495333Z; before snapshot was
  recorded2026-11-10T06:20:59.523593Z.
- [Before](before.json) and [after](after.json): independently checked all133 source inputs,5 harness inputs, corpus,
  controls and preparation manifest hashes/lengths. Every file and HEAD is unchanged; tracked diff remains empty. Only
  this new review evidence directory is untracked. Source provenance and preparation manifest agree on all input pins.
- Controls3191 bytes SHA-256 `880766ad160c3399ed3addf1c5fa59bbd760627da233bf7ca52ee97b7c0e332b` remain immutable.

Byte reproducibility establishes that these are the sealed source results, including the incorrect derived freshness
label. It does not validate that label or admit native parity/privacy.

## Material finding: retained scratch is not fresh damage

`tools/card-bleed-fixtures/capture.mts`'s `tick` calls `worldStep(w,50)` then copies all `w.combat.landed` into the
trace. Its `cardContributions` projection then filters every trace row's landed snapshot, without a producer-pass guard.

Actual source guards in `packages/server/src/sim/step.ts`:

- `step:302–320` increments tick/time for every call but invokes `updateActive` only when phase is active before dispatch.
- `updateActive:241–253` returns immediately if arena.voided; only the real active pass clears `world.combat.landed=[]`.
- The active pass runs ledger, systems (including cardHooks.afterDamage), then settle/runEnded. A tick that starts
  active and ends the run has real contributions and must be retained. A later already-ended tick runs none of those.

Concrete frozen case `run-ended-before-periodic-window`:

| Row | Actual source facts |
|---|---|
| tick3–6,150–300ms |Four fresh eligible card hits, each0.22360089783170145.|
| `action-3-step-1`, tick7/350ms |Fifth fresh card hit kills p1 after declared HP0.01 setup; ordinary settle ends the run. Real raw Hit flush is1.1180044891585073, followed by victory.|
| `action-3-step-2`, tick8/400ms |Already ended before dispatch: HP/status unchanged, returned events empty. Retained `world.combat.landed` still contains tick7's hit; no active pass/afterDamage runs.|

The current derived list advertises6 contributions by counting the last row again. Only5 were processed; the emitted
total equals five additions, not six. This would mislead a native consumer that used the list as fresh producer input
or compared each row to native newly landed damage. Raw scratch retention itself is legitimate source behavior and may
remain as explicitly labelled diagnostics; it must not be fed back into an accumulator or described as damage that ran.

**Smallest recommended repair:** record the pre-dispatch phase and whether the actual active pass is eligible under
the unchanged source guard (`phaseBefore === "active"` and not arena.voided). Distinguish a raw `landedSnapshot` from
fresh/processed landed rows, or derive `cardContributions` only from real active-pass rows. Preserve the tick7 end-pass
contribution/flush: filtering on post-step `phase === "active"` would incorrectly drop that tick. Keep the tick8 ended
step and its empty events as a useful negative boundary; do not install/clear source scratch or call flush directly.
The author can change only the unadmitted harness/schema/derived summaries and regenerate a new candidate from the same
unchanged producers. Preserve this failed-candidate review and old bytes/provenance as historical evidence.

## Other source and control findings

The input setup is explicit, rather than an earned full-match claim: source createWorld plus declared installer profile,
normal lobby/start step, real grantCard and declared position/history/weapon/HP setup. Attack/release use real enqueue
and ordinary fixed50ms stepping. The run-end HP reduction is declared setup; damage and end/flush then run normally.
Raid reset calls the actual exported startRaid at an explicit lifecycle boundary; it is not an ordinary input action.
No expected pending report state is installed, and the capture never directly calls flushBleeds.

Actual events and raw landed snapshots are retained in full on every trace row; the derived `cardFx` filter does not
discard them from the corpus. Eligible card classification matches the source dottrue/abilityundefined/sigundefined
predicate for the reached shapes. Pair ordering/repeats and first-use clock are real: first fresh card damage is
tick3/150ms, first periodic FX tick13/650ms. The first-use case's last contribution is2050ms, last feedback2150ms,
then later empty intervals emit none. Teleport occurs tick7/350ms after a partial report exists, and650ms feedback
retains it. startRaid deletes the partial report before the old window and subsequent steps emit no old report. Source
card passive is absent; no signature/ability/passive discriminator is invented.

The mixed-profile case reaches Fire `sig:"burn"` and `sig:"backlash"` rows, plus card DoT. It reaches **no ability-tagged
landed hit**. Its title `card-dot-excludes-signature-and-ability-dot` and OR guard do not establish independent ability
exclusion coverage. Narrow the claim to these reached signature paths; all ability variants remain outside this finite
witness. No new broad ability matrix is required to repair the freshness issue. Every eligible source in these cases
is a named p0/p1 actor; anonymous/absent-source and arbitrary identity cases are not covered by these seven cases.

Read-only control implementation/receipts support the reported semantic controls, without a redundant independent
rerun: disposable source copy and outputs, canonical source/output read-only; exact mutation sites; grouping mutant
fully executes and changes10 grouped FX to282 per-contribution FX; strict threshold fails the intended first-use guard
with550ms versus500ms; removed runEnded hook fails only after actual ended phase and real damage, with zero feedback.
Comment-only changes provenance but preserves all case transcripts; restoration reproduces the entire corpus and
immutable-original byte check passes. These are semantic controls, not compile/read failures. The stale sixth row does
not invalidate the genuine run-end control's reached flush, but its6-count description must be corrected with the schema.

The preparation receipts honestly retain earlier import/producer/guard failures. No native expected answer was used to
tune the source. Source's500ms threshold is tested on a50ms clock;550ms under a strict-greater mutation is not another
ordinary-source greater-than boundary fixture. This finite witness does not separately execute an empty runEnded hook;
an already-ended step is not another runEnded invocation.

## Privacy and release boundary

`cardHooks.ts:270–287` holds only first-use/cadence and ordered victim/by/amount totals; afterDamage folds fresh hits and
flush emits raw trusted FX. `resetAll` deletes the report on raidStarted; teleport's resetFight/dropDeferred do not.
No contribution audience is stored. `FxChannel.batch` packs supplied FX without viewer/sight logic; RaidRoom:715–757
collects all raw FX and broadcasts one batch. This capture records those raw simulation events, not a viewer projection
or a transport encoding/decoder test.

ADR0013 contribution-tick entitlement/redaction/anonymous merge and retained per-viewer projector state are a deliberate
native privacy extension. Neither global source totals nor later visibility can prove it. Generic delayed Hit emission
cannot safely substitute for a reviewed Card contribution/flush domain. No native implementation, historical audience,
public-wire/client semantics or privacy claim is released here.

Disposition remains **HOLD this bounded source candidate until freshness/schema and reached-classification claims are
corrected and resealed**. Fresh byte reproduction and substantive aggregate controls pass; no request is made to mutate
the unchanged source gameplay or broaden capture into unrelated systems. Root coordinates the author repair and new
independent review. Existing source/protocol/Unity/shared records remain untouched.

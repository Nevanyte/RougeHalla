# Corrected card source: RELEASE

**RELEASE for finite source-only admission**, reviewed2026-11-10 at clean transferred seal
`c76f8e46eebebd91a25c8cd7e4f1dd88ba4f4538` (integration source seal `570fe186`). This supersedes the freshness/schema
hold for the corrected candidate only. The [original HOLD](../README.md), its receipts and the held candidate remain
unchanged. No native card dispatch, Rust parity, public FX/client semantics or ADR0013 privacy implementation is admitted.

| Corrected artifact | Bytes | SHA-256 |
|---|---:|---|
| `parity/card-bleed-feedback/source.json`, schema `rh-card-bleed-source/2` |410111|`6b36256739bd473bc70ebd160a8632a26470ab8e4190f873026bd714e53d36ed`|
| `parity/card-bleed-feedback/controls.json` |3191|`248a3be77749e9f966a9fff3ad6f7ba44ea4db4d3eddba3e0c9be9a71578fcd9`|
| `docs/evidence/card-bleed-source-preparation/FINAL-MANIFEST.json` |32722|`9869a390c4f5a3ad939254d94e0ef44571397b653f3c10ec6e9d171d3bd29d8e`|

## Fresh independent reproduction

Ran exactly `bash tools/card-bleed-fixtures/capture.sh --check` in the fresh clean review worktree
`/Users/nevinmckinnon/Documents/Projects/RogueHalla-worktrees/backend-card-source-review`. Exit0 reproduces all7 cases,
390 ordinary steps and the exact410111 canonical bytes/hash above. Raw output is retained as [capture-check.txt](capture-check.txt),
with [command/exit receipt](capture-check-receipt.json). Capture began after the before snapshot at
2026-11-10T06:32:37.124805Z and completed2026-11-10T06:32:55.104742Z.

The unchanged wrapper mounts repository and canonical output read-only, installs the pinned lock via npm ci into tmpfs,
and runs image `node:22.23.4-bookworm-slim@sha256:aaa4b5baf1ecff3b283486bb1f90405cdda225a3e6f79660d2c559fa510a7292`
with linux/amd64. Executed capture assertions verify Nodev22.23.4, linux, x64. The previously created empty ignored
node_modules mountpoint was reused; no source/tool/corpus write mode or unpinned host Node proof was used.

[Before](before.json) and [after](after.json) independently protect all133 source inputs,5 harness inputs, current
corpus/control/manifest, retained history/archived candidate, logs and prior review receipts. Every protected byte/hash
and HEAD is unchanged, with no tracked diff; the only untracked files are this new corrected review directory. Current
source input pins equal all prior133 pins exactly. Old tool pins were checked against actual10519519 git bytes. Held
source, controls and manifest were compared byte-for-byte to their original paths at10519519; original held source SHA
remains `6bd92fff24f2825d708962e24d971adcc0161e271777a8c4bc35681254865af5`, controls remains
`880766ad160c3399ed3addf1c5fa59bbd760627da233bf7ca52ee97b7c0e332b`. No source implementation changed.

## Freshness correction and exact reached facts

The new schema separates raw `landedSnapshot` from `processedLanded`, with recorded preDispatchPhase,
arenaVoidedBefore and activePassEligible. `cardContributions` derives only from processed rows. This matches unchanged
`step.ts:302–320`: only pre-dispatch active phase enters updateActive; `updateActive:241–253` returns if arena.voided
before clearing scratch/running the active producer pass. arena.voided is a source boolean, so the capture's explicit
true check preserves that guard. Declared non-step setup rows have no processed pass.

In `run-ended-before-periodic-window`:

- Tick3–6/150–300ms contribute four fresh eligible hits.
- Tick7/350ms begins active and nonvoided, processes one further hit and ends the run. There are **five cumulative
  fresh contributions through tick7**, each0.22360089783170145; real runEnded flush emits1.1180044891585073, preserving
  death/flush/victory ordering. Tick7 itself has one processed row, not five. Preparation prose mentioning five hits at
  tick7 should be read cumulatively; its explicit manifest rows and corrected corpus show the exact per-step facts.
- Tick8/400ms begins ended. Raw retained scratch has one hit, processedLanded has zero, returned events are empty and
  no fresh contribution is recorded. Filtering by post-step active phase would lose tick7; the corrected guard does not.

Independent old/new comparison confirms every raw event, player snapshot and raw scratch row is identical, and all
cardFx/final outcomes are identical. The only derived contribution change is removal of the stale tick8 row in this case.
No expected pending report, gameplay state, source damage, action timing or emission was installed/retuned for the repair.
The new explicit source guards assert ending-pass inclusion, ended-step exclusion and five total fresh hits.

The mixed case is correctly renamed `card-dot-excludes-fire-burn-and-backlash`. Separate source assertions reach actual
burn and backlash processed rows. Independent corpus inspection confirms both tags and zero ability-tagged landed
rows; no ability-exclusion coverage is claimed. This finite witness does not cover anonymous/absent-source pairs,
arbitrary identities, a voided-active scenario, or an independently invoked empty runEnded hook. The void guard is
source-inspected; it is not described as a newly reached voided case.

## Controls and retained behavior

The correction changes only the capture schema/freshness projection/assertions and the mixed-case name/claims. Existing
producer cases/actions and gameplay source are unchanged. Source still runs real createWorld/installers, real grantCard
with declared position/loadout/HP setup, accepted queued attack/release and ordinary fixed50ms World.step. The declared
HP reduction leads to a real lethal step and natural runEnded; reset invokes actual startRaid at its labelled lifecycle
boundary. No direct flushBleeds call or installed report state is used. Full raw events remain in each trace; cardFx is
an additional derived view, not destructive event filtering.

Unchanged mutation runner/code and corrected raw receipts were inspected, without repeating the mutant sweep. Selectors
still target the actual grouping/cadence/runEnded sites and the same reached cases:

| Semantic control | Corrected evidence |
|---|---|
| One row per contribution |Executes all source cases and changes10 grouped FX to282 rows; semantic KILL.|
| Strict `>500` |Intended first-use guard fails at550ms instead of500ms on the50ms clock; semantic KILL.|
| Skip runEnded flush |Actual ended case has5 fresh contributions and zero feedback; intended flush assertion fails.|
| Comment-only |All case transcripts equal; provenance changes, NONKILL.|
| Restore/original immutability |Full corrected corpus equal; canonical source/output unchanged.|

Control source/mutant implementation hashes remain the same as the held candidate; corrected receipt rebinds the new
corpus and reports5 genuine run-end contributions. No compile/read failure is substituted for a semantic KILL.
Grouping/insertion order, first-use500ms cadence/empty later intervals, natural early run-end, teleport retention,
raid reset and no-card control retain their previously reviewed actual producer reach. No claim of broad branch or
all-ability coverage follows from these seven cases.

## Native boundary remains separate

This admission releases the corrected **legacy trusted raw aggregate source witness** only. Source BleedReport holds
since plus ordered victim/by/amount totals and no historical audience; FxChannel/RaidRoom globally pack/broadcast raw
FX. Actual source passive remains absent, and no signature/ability discriminator is invented for Card.

Native ADR0013 contribution-tick eligibility, unseen-source redaction before grouping, anonymous merge and per-viewer
retention are deliberate privacy extensions. They require the separately reviewed Card contribution/flush domain,
authoritative cadence/aggregate identity/restore design and Root/Claude lease/output decisions already identified by
the design review. Reusing a delayed plain public Hit would not establish that privacy contract. No Rust/client/public
wire, checkpoint/hash layout, live activation or native dispatch is authorized by this source-only RELEASE.

# P-NPC-BLEED-RESTORE-1 — earned regional NPC Hemorrhage checkpoint admission

**Status: narrow checkpoint-reader compatibility repair, ready for independent review.** It accepts only the actual
status the real Card producer earns on a regional NPC when it restores from a checked-in checkpoint. It does not change
combat, the status shape, tick order/arithmetic, Card report storage/projection, numeric admission or the public privacy
contract, and it makes no Card numeric-closure decision. The prior disposable probe archive is untouched.

- Base: `1163f18ec2a31c97d8b62b9855b887654eabb106` (`codex/deepseek-npc-bleed-restore`; production `36564c33` + probe
  evidence/docs transfer). Worktree only: this private probe checkout.
- Dispatch/design: [P-NPC-BLEED-RESTORE-1.md](../../backlog/packets/P-NPC-BLEED-RESTORE-1.md) and the independent numeric
  review [numeric-options.md](../card-bleed-probe-review/numeric-options.md) (its "Independent regional NPC checkpoint
  fault" section).
- Toolchain/flags: `cargo 1.97.0 (c980f4866 2026-06-30)`, `rustc 1.97.0 (2d8144b78 2026-07-07)`; every cargo command
  `--offline --locked -j 1`; `CARGO_TARGET_DIR=<private-worktree>/target/card-design-probes-build`; cwd
  `/Users/nevinmckinnon/.codex/tools/roguehalla-backend-20261109/card-bleed-design-probe/repo`. No network, no capture,
  no full-workspace or serialized-leaf sweep, no Cargo/dependency/lock/fixture/source/version edit.

## Exact code scope

Only the leased paths changed (`git status`): modified `crates/rh-sim/src/systems/mob_checkpoint.rs` (+89/−1) and new
`crates/rh-sim/src/systems/mob_checkpoint/bleed_tests.rs`, plus this evidence README. No stored type, serde field,
`World` shape, tick schedule, combat/status arithmetic, replay/checkpoint format constant, content hash/version,
protocol, shared status or fixture changed. The change is reached only from the checkpoint reader (`Sim::restore` →
`check_world` → `mob_checkpoint::validate`) and adds one acceptance clause beside the existing Full-Blaze exception.
Nothing is written to World and no accepted state is mutated; the new accepted set is a strict superset of the old one.

## Clock-domain HOLD from independent pre-review (found, fixed, receipted)

The first revision additionally required `started_at == tag_tick * TICK_MS`. Root's independent pre-review raised a
concrete HOLD: the producer tags from `world.tick` (`cards/on_hit.rs`) while `status_runtime::apply` stores
`world.server_time`, and the checkpoint reader validates the clock **numeric range and tick maximum** (`checkpoint.rs`),
not that equality. For this trajectory's `ArenaMode::Off` profile the `server_time == tick * TICK_MS` check in
`arena_validation` is inside the lifecycle-rules-Some branch and does **not** apply to accepted states. The same HOLD
noted that `until - started_at == duration` is not automatically the producer's operation for every accepted clock.

Fixed in the leased code only:

- removed the unproven `started_at == tag_tick * TICK_MS` requirement (canonical tag spelling, `tick >= 1` and
  `tag_tick <= world.tick` remain);
- the duration is now compared with the producer's actual binary64 operation, `until == started_at + ms`
  (`status_runtime::mutation` computes `until = now + a.ms.min(max)`), with **no fitted epsilon and no range cap**.

The two accepted restored-clock trajectories below then reproduce the real earned/restore path under clocks that are
not `tick * TICK_MS`, including a proof assertion that the fractional case's `started_at != tag_tick * TICK_MS`.

The forward-operation requirement is also receipted against the exact static binary64 counterexample from the
independent review: `started_at = nextafter(2000, +Infinity) = 2000.0000000000002`; the producer's forward addition
`started_at + 2000` rounds to `4000`, while the reverse subtraction `4000 - started_at` is `1999.9999999999998`. A
focused predicate-shape control (constructed instance, not an installed status or checkpoint row) confirms the helper
admits the forward-produced row and rejects the neighboring binary64 duration (no fitted epsilon/tolerance). Real
accepted-clock producer/restore evidence is supplied by the two trajectories above, not by this arithmetic control.

## First failures while executing (recorded, not hidden)

- Probe harness compile: `E0603` (test imported `DamageShares` through a private re-import) → exit 101; fixed in the new
  test only.
- **Pre-repair semantic failure** (the intended boundary): the promoted regression failed at post-hit restore with
  `Malformed("unsupported mob status domain")` (exit 101), *after* the pre-hit checkpoint restore and the real earned NPC
  bleed were asserted. Saved privately in `pre-fix-first-failure.log`.
- First post-repair run: 2 passed, 1 failed — the departure test's trailing presence assumption did not hold because the
  run had legitimately entered its ordinary Ended transition; acceptance/hash/continuation comparisons had already
  passed. Only the test's trailing assertion was corrected; no production change.
- **Pre-review HOLD** (above) on the candidate rule's unproven clock equality/duration form; corrected in the leased
  files and re-receipted with the accepted restored-clock trajectories.
- `cargo fmt --all -- --check` first exit 1 (formatting in the new test file); `cargo clippy … -D warnings` first exit 101
  (`clippy::field_reassign_with_default` in a test-only initializer). Both were test-side formatting/lint fixes.

## Implemented admission rule (reader only)

`mob_checkpoint` now also accepts a mob Dot whose immutable persisted fields match the real producer's Hemorrhage shape:

| producer fact (from `cards/on_hit.rs` + `status_runtime::mutation`) | checked |
|---|---|
| `kind == Dot`, `ability == None` | yes |
| canonical text tag `bleed:{application_tick}` (decimal spelling; tick ≥ 1; tick ≤ `world.tick`) | yes |
| duration equals the existing Hemorrhage card row's `ms` (derived from the catalog, no new tuning), compared as the producer's `until == started_at + ms` | yes |
| retained source `id` has typed `ActorOrigin::Player` provenance; `source.name` equals the retained roster label; `owner_id == None` | yes |
| persisted `value` finite and nonnegative (the producer's positive-raw gate/materialization cannot persist a negative or non-finite value; an underflowing raw may round the stored scalar to zero) | yes, **no magnitude cap** |
| `data == Payload { shares: Some(phys-only (1,0,0)), ..default }`; `reveal_from`/`taken` absent | yes |

The predicate deliberately does **not** compare `started_at` to the tag tick or to `tick * TICK_MS` (unproven in the
reader-accepted Lifecycle-Off clock domain; generic time validation remains authoritative). It does **not** require
current source presence, aliveness/standing, current card ownership, a current `players` entry, any expiry beyond generic
validation, or an expected damage scalar. The existing Full-abilities `abilities::checkpoint::blaze_dot` exception,
`status_runtime::validate` and the known-actor provenance loop remain unchanged and authoritative after this clause.

## Promoted ordinary regression (actual execution)

Normal five-faction seed1 PvE constructor, real `add_player` (Holy physical seat), normal raid-start step, real
`cards::grant` of Hemorrhage, declared placement, then validated/budgeted `Sim::submit`:

- pre-hit baseline checkpoint restore **accepted** (restored state/checkpoint identical);
- ordinary **Attack** step reached the ledger/hit producer (**2 Fists weapon-hit landed rows**) and the real on-hit
  producer earned a no-ability bleed on a surviving regional NPC: canonical tag `bleed:2`, 2000 ms producer duration,
  producer-stored start time, finite nonnegative value, physical-only shares, retained player source;
- ordinary **Release** then further steps; region NPC alive with hp > 0;
- **post-hit checkpoint restore now accepted**; original, `Clone` and restored then received the same remaining input and
  identical ordinary steps (60 steps): identical events and state hashes every step, identical full serialized
  checkpoints at the restore point and every 15th/final step, the bleed expired through the ordinary status clock on all
  three, `check_layout == Ok`, and the continued checkpoint restored again;
- source-departure case: after the bleed was earned, the producer player was permanently removed through the ordinary
  lifecycle API (`remove_player`); while the world was still `Active` the NPC still carried the bleed with its retained
  source, and the checkpoint restored **accepted** through retained known-actor history/roster label (player not
  present). Original and restored continued 20 ordinary steps with identical events/hashes/checkpoints.

## Accepted restored-clock trajectories (HOLD receipt)

Both start from the normal constructor, label only the clock declaration on that produced world, and prove the actual
reader accepts the declared-clock baseline **before** the hit. The declared clock is not reset, retimed or installed as
an expected answer; it is a labelled input fact.

- **Fractional clock:** `server_time = 1284.5` while `world.tick` is 1 (not `tick * TICK_MS`). Declared-clock baseline
  restore accepted; real placed Attack produces the NPC bleed with `started_at = 1334.5`, canonical `bleed:2`; the test
  asserts `started_at != tag_tick * TICK_MS` and `until == started_at + 2000`; Release + post-hit checkpoint restore
  **accepted**, then 10 identical continuation steps and checkpoint equality.
- **Large clock:** `server_time = u32::MAX * TICK_MS - 10_000` (near the reader's admitted numeric clock bound, far below
  2^53). Declared-clock baseline restore accepted; real Attack earns the bleed, `started_at = declared + TICK_MS`,
  `until == started_at + ms` exactly; Release + post-hit restore **accepted**, 10 identical continuation steps.

No clock equality, epsilon, fitted tolerance or range cap is added to the predicate or to generic validation.

## Malformed-shape controls (all reach the status-domain predicate)

From the real earned post-hit checkpoint, each single-field mutation below is refused with exactly
`Malformed("unsupported mob status domain")`; each mutated row keeps the generic status/provenance fields admissible, so
the typed refusal is the narrow status-domain clause (which this reader evaluates before the generic status validator):
source-less generic NPC Dot; noncanonical
leading-zero tag; wrong tag; non-`None` ability; player-only kind; nondefault payload field; non-physical shares; wrong
duration; future tag tick beyond the world tick; zero tag tick; changed owner semantics; forged source name; known
non-player source; negative value; status `cast` fact on a mob. Acceptance is not over-constrained: clearing the source
player's Hemorrhage build copy still restores, and a finite `1e300` scalar still restores (no new magnitude cap). Generic
validation remains authoritative: a direct `status_runtime::validate` table with a non-finite value, an over-max
`until`, a non-finite payload field, or non-finite shares is still rejected with the unchanged reasons.

## Applicable Card-runtime source consumer / prior receipt

The packet's required unchanged Card source-consumer gate is recorded with its exact existing filter:
`card_witness_tests::the_witness_cases_reproduce_the_source_landed_amounts` — **1 passed / 0 failed**, unchanged and
honest about its bounded witness limits. A repo-wide search found no dedicated native replay consumer of
`parity/card-runtime/source.json::onhit-bleed-physical` at this base; the only native loader of that immutable 65-case
corpus is `kill_augments::tests` (Trophy case, also run unchanged: 6 passed), and the Card-runtime companion witness
corpus is the consumer above. The Card **on-hit producer source-shape** tests `cards::on_hit` were also run unchanged
(6 passed).

Direct read-only inspection of the immutable `onhit-bleed-physical` source case: it is a 93-ordinary-step real-source
witness whose persisted bleed on its player target is Dot/no-ability, tag `bleed:2`, 2000 ms, physical-only shares
(1,0,0) — the same persisted shape this predicate admits. It is producer documentation, not a native NPC checkpoint
gate; no new full runtime consumer was invented.

The exact prior matching receipt for the earned **native NPC** on-hit path is the committed disposable probe evidence
[card-bleed-native-probes](../card-bleed-native-probes/README.md) Probe 3 (real Holy Attack/Release on a regional NPC,
then the typed reader refusal), independently reviewed in [numeric-options.md](../card-bleed-probe-review/numeric-options.md)
and independently reproduced by this repair's regression. No source recapture, golden/tape recorder, expected-output
change or installed-status proof was made. The source-corpus `capture.sh --check` was not run: it requires an
in-container `npm ci` (network) and the pinned linux/amd64 Docker image, and no recapture is required by the packet.

## Unchanged relevant overlap receipts (actual)

| test | result |
|---|---|
| new `mob_checkpoint::bleed_tests` (ordinary regression + accepted-clock trajectories + binary64 forward-op control + departure + malformed/overlap controls) | 6 passed / 0 failed |
| required unchanged Card source consumer `card_witness_tests::the_witness_cases_reproduce_the_source_landed_amounts` | 1 passed / 0 failed |
| existing Full-abilities Blaze NPC restore `overlapping_real_blaze_charges_restore_player_and_born_npc` | 1 passed / 0 failed |
| existing generic `status_runtime::checkpoint` suite | 6 passed / 0 failed |
| existing PvE source restore `systems::signatures::pve_tests::actual_source_basic_faction_pve_frames_and_restore` (additional generic overlap, not the Card witness) | 1 passed / 0 failed |
| existing checkpoint unit suite `checkpoint::tests` | 31 passed / 0 failed |
| unchanged native loader of the same Card-runtime source corpus `kill_augments::tests` | 6 passed / 0 failed |
| unchanged Card on-hit producer tests `cards::on_hit` | 6 passed / 0 failed |
| `cargo fmt --all -- --check` | exit 0 |
| `cargo clippy -p rh-sim --all-targets -- -D warnings` | exit 0 |
| `cargo clippy -p rh-sim --all-targets --all-features -- -D warnings` | exit 0 |

Exact commands, cwd/flags and exit codes are in the private `commands.log`/logs. No full-workspace run or all-leaf sweep
was performed.

## Independent review status

Root's independent pre-review (external read-only document
`/Users/nevinmckinnon/Documents/Projects/RogueHalla-worktrees/backend-gameplay-quests/docs/evidence/npc-bleed-restore-review/README.md`)
placed a HOLD on the pre-correction WIP for exactly three findings: the unproven tag/start clock equality, the
reverse-subtraction duration form, and the missing exact Card source-consumer gate. This delivery addresses all three in
the leased files: the clock equality is removed while canonical tag/tag-tick bounds and generic clocks remain; the
producer's forward `until = started_at + ms` operation is used with the exact static binary64 counterexample receipted and
no epsilon; and the exact `card_witness_tests::the_witness_cases_reproduce_the_source_landed_amounts` filter is recorded
unchanged. The normal producer/restore/continuation/history/negative receipts are retained. Final approval and seal
remain Root's; this packet implies no Card B3/storage/projection lease or generic numeric admission change.

### Final delta after the released v2 cut, and final hashes

Root's Luna follow-up released the pre-counterexample v2 cut: production
`crates/rh-sim/src/systems/mob_checkpoint.rs` SHA-256 `10262155531cc4621e07c19307dcaa152d91557d58e902ac4bd8ad70d5a31002`
and `bleed_tests.rs` SHA-256 `ffd5502dde18bb2b8bd82b68cf8f40d938a0e8e25105b52fcc53d8e1921393ff`. The only post-release
delta is in the new test file: final `bleed_tests.rs` SHA-256
`125af1504c9e2736e861d93e0078477e2bc49c8e0e2707e3f44cce3e913921a1` adds the focused binary64 forward-vs-reverse
predicate control requested by the explanatory example plus comment corrections. **No production line changed after
v2** — the final production helper file is still `10262155531cc4…a31002`, and the final patch reverse-applies cleanly.
The final this-README SHA-256 and the final evidence patch are recorded in the private
`target/npc-bleed-restore-private/evidence-sha256-final.txt` and `evidence.patch`.

A second independent read-only verifier inspected the final worktree (HEAD `1163f18e…`, final hashes above),
independently reproduced the Lifecycle-Off clock-domain finding and the binary64 arithmetic, confirmed the patch
reverse-applies, and re-ran the final filters/formats/lint: new module 6/0, exact Card witness consumer 1/0, Blaze 1/0,
generic status checkpoint 6/0, Card-runtime corpus consumer 6/0, Card on-hit producer 6/0, PvE restore 1/0, checkpoint
units 31/0, `cargo fmt --all -- --check` 0, strict default and all-feature Clippy 0. It independently confirmed the
acceptance-only/no-stored-state-change condition and that both HOLD groups are resolved. Residual risks are limited to:
shape-vs-provenance admission within the trusted-checkpoint scope (no runtime/step/hash effect), catalog coupling of the
derived duration if Hemorrhage's catalog/producer shape changes, an untested Full-abilities combination, future
producer-refresh/roster-rename changes, and the fact that the sixth test is a predicate arithmetic control, not itself a
restore receipt. Root's seal remains the outstanding gate.

## Compatibility / content condition

The diff changes only restore admission for an already-produced valid state: no stored shape, serialization, step,
arithmetic, hash or replay/content identity is touched, and the regression asserts restore→checkpoint JSON equality and
state-hash equality on the admitted state. On this diff the approved condition for **preserving versions/content** holds;
no version/content bump, stored-state migration or additional lease is required. The *only* semantic expansion is the
approved additional acceptance of this earned NPC bleed; no broader NPC status parity or Card numeric closure is claimed.
No concrete need beyond the approved expansion was found.

## Delivery / git limitation

This checkout is a linked worktree whose git metadata lives outside the writable workspace, so `git add`/`git commit`
remain sandbox-denied (`index.lock: Operation not permitted`, exit 128). The exact scoped code and this evidence are left
in the worktree for Root to seal; no permission mode was changed. Sanitized evidence is only this directory; full private
patches/logs (including the pre-repair failure and continuation comparisons) are preserved under the ignored
`target/npc-bleed-restore-private/`, and the prior probe archive `target/card-design-probes-private/` is untouched.

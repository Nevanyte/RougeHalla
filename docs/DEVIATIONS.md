# Deviation ledger

The parity invariant is **"byte-exact legacy behaviour except where this ledger records an owner ruling."** Any
intentional difference between the Rust port and the frozen legacy source lives here. A difference that is not in this
file is a parity bug, not a deviation.

Status: **seeded 2026-11-07 from existing ADRs and CONTRACTS notes; the owner has not yet signed off the seeded rows.**
The "Owner" column is blank until the owner confirms each one. Rows marked "unverified" are my reading of the docs,
not a re-check against code.

## Rules

1. A deviation needs an entry **before** it merges. The entry names the legacy behaviour, the Rust behaviour, the reason
   and the parity artifact that changes (fixture, scenario or comparison filter).
2. Only the owner approves an entry. Workers and reviewers may propose; they cannot rule.
3. Categories: **privacy** (C-OBS fixes, no balance effect), **bug-fix** (legacy defect with no intended behaviour),
   **balance** (player-visible numbers or timing change) and **platform** (storage, identity, transport).
   A **balance** entry must also state how it was re-validated; "no harness available" is a blocking answer, not a pass.
4. Parity scenarios that cover a deviation compare the Rust side to the **legacy capture filtered through the entry**,
   never to an edited capture. State the filter in the entry.
5. Reversal: delete the row's Rust change and the filter together; keep the row, mark it `Reverted` with a date.

## Entries

| ID | Category | Legacy behaviour | Rust behaviour | Reason / evidence | Re-validation | Reversibility | Owner |
|---|---|---|---|---|---|---|---|
| DEV-001 | privacy | Signature damage chunks are filtered at flush time; a chunk that mixes hidden and visible earlier damage can disclose hidden damage (e.g. 12.147 vs 8.098 against a visible 4.049). | `FxProjector` projects each contribution at its own settled tick; unseen sources are redacted before keys form; anonymous sources merge. Trusted totals, order and flush timing keep source semantics. | [ADR 0013](adr/0013-temporal-damage-projection.md); actual-source pair test. | Public-view only; gameplay totals unchanged and parity MATCH. | permanent (privacy) | pending |
| DEV-002 | privacy | Mark tie order uses JS string `<` on arbitrary IDs; a hidden tied owner can win the raw selection, then redaction suppresses a visible owner's identity. | Select among **eligible (visible) owners** at the public max tier; lowest numeric runtime ID wins. | [ADR 0014](adr/0014-sentenced-public-state.md); `tools/sentenced-fixtures/public-pairs.ts`. | Private state, damage and credit unchanged; the parity harness reconstructs the lexical order for comparison only. | permanent (privacy) | pending |
| DEV-003 | bug-fix | A stored Mark tier/owner waits for the next `syncVisuals` pass after a between-step departure. | Public observations derive surviving owners immediately; no departed marker identity persists. | ADR 0014 (last paragraph). | Presentation only. | reversible, presentation only | pending |
| DEV-004 | privacy | A failed hidden-ID guess changed 33 tile deadlines and 13 later visible cells (reproduced). | Prospective-view rule commits only legitimate visibility; concealed and missing probes are equal. | [CONTRACTS.md](CONTRACTS.md) C-OBS (Stage 2 targeting note). | Reproduced legacy side effect; supported positive timing preserved. | permanent (privacy) | pending |
| DEV-005 | privacy | Status-field IDs come from the shared `nextId` counter, so publishing them leaks gaps from unseen entities. | `Observation.fields` carries no runtime field ID; owner/subject are redacted and sorted by public facts only. | [ADR 0017](adr/0017-visible-status-fields.md) (**Provisional**). | None needed beyond C-OBS tests. | permanent while provisional ADR holds | pending |
| DEV-006 | platform | Sentenced and PlayerId tie rules use string order on source IDs. | Rust `PlayerId` is monotonically allocated numeric identity; private ties use the numeric correction (the "C3" precedent). | ADR 0014. | Fixture IDs `p<n>` live only in the parity harness. | permanent (platform) | pending |
| DEV-007 | platform | Legacy callsigns are case-sensitive. | The new store is case-insensitive. | Listed as an owner decision in [MIGRATION.md](MIGRATION.md) known gaps. | n/a | reversible with a store migration | owner decision recorded in backlog list (confirm) |
| DEV-008 | privacy | Item and chunk visibility identity details (unverified; the "hidden-ID side effect" may be DEV-004 only). | Check whether a second hidden-ID case exists before closing this row. | Placeholder from the critique. | – | n/a | pending |

## Not deviations (inherited on purpose)

| Item | Why it is here |
|---|---|
| The secret order salt is observable through tied outcomes (legacy behaviour, C-RNG). | Documented as inherited; changing it is owner decision 14 in the backlog README. |

## Open questions for the owner

1. **Capture-only scenarios (13).** These cannot be compared. For each, record: mechanic, why capture-only, and whether it
   is balance-significant. If any is, it needs its own row here as a "ported on faith" entry. Not yet audited.
2. **Balance re-validation (confirmed 2026-11-07).** The legacy harness exists only under `packages/server/src/harness/`
   (`duel.ts`, `matrix.ts`, `factionCycle.ts`, `kiting.ts`, `zoneDuel.ts`, `questBench*.ts`). A search of `crates/` and
   `tools/` for TTK / time-to-kill / win-rate finds nothing, so there is no Rust equivalent. Until one exists, a
   `balance` entry cannot be re-validated; DEV-001 to DEV-006 avoid this because they change presentation or identity
   only. Proposed packet: **P-BALANCE-1**, a duel/matrix harness over `rh-headless`, gated on the same edge and TTK
   targets the legacy harness reports. Not yet written.
3. **Design changes after the freeze.** Rows here cover port-time corrections. Post-baseline design changes (Sentenced
   redesign, controls rework) need a separate freeze/crossover rule; this ledger does not decide that.
4. Confirm or delete DEV-008.

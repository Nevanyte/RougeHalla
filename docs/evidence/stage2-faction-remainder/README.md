# P-FACTION-1 remainder: the coliseum teleport reset (DONE-VERIFIED)

Phase: the stage-2 tail of the backlog packet [P-FACTION-1](../../backlog/packets/P-FACTION-1.md). Branch
`deepseek/p-faction-1`, stacked on `deepseek/p-cards-1` (itself stacked on `deepseek/p-content-1` over `856618eb`
`optimization_port`): it was created from `5ab14916` and is **restacked on the current P-CARDS-1 head `92dcb662`**
(the live while-hold context and G8 evidence; `git merge-base --is-ancestor 92dcb662 HEAD` holds). The PR states the
stack. Evidence for the earlier P-FACTION-1 slices:
[`stage2-sentenced-support`](../stage2-sentenced-support/README.md), [`stage2-frost-search`](../stage2-frost-search/README.md),
[`stage2-fire-landmarks`](../stage2-fire-landmarks/README.md), [`stage2-plague-map`](../stage2-plague-map/README.md),
[`stage2-holy-camps`](../stage2-holy-camps/README.md).

Pull request: [#37](https://github.com/Nevanyte/RougeHalla/pull/37), stacked on the P-CARDS-1 PR #36; commit range
`92dcb662`..`814a2224` on `deepseek/p-faction-1`. Ledger row:
[`docs/evidence/deepseek-rust/PROGRESS.md`](../deepseek-rust/PROGRESS.md).

## Assessment before writing (code and git, not memory)

At `5ab14916` the schedule rows still labelled `P-FACTION-1` were exactly two:

1. `hooks.teleported` link `factions.<arrow>` (`crates/rh-sim/src/schedule.rs`, `TELEPORTED`, third link) — a **real
   behaviour gap**. The source installs `chainHook(world, "teleported", () => resetAll(world, true) + dropHealsOverTime +
   rearmTriggers)`; the port had no link, so a coliseum teleport left every target, mark tier, chill, DoT bucket and
   synced signature bit in place even though the packet's behaviour list says a target is "forgotten ... at the coliseum
   teleport" (P-FACTION-1 "Behaviour to preserve").
2. `modSources` row `factions.markTaxSource` — **intentionally neutral**, see the section at the end. It stays
   `Pending` by design.

The two candidates that looked open in the old install list were already ported elsewhere and were **not** redone:
`factions.healOverTime` is `systems::heal::over_time` (`schedule.rs` `SYSTEMS`, ported by P-CARDS-1) and
`factions.onHurt` is `cards::on_hurt` (`schedule.rs` `HURT`, ported by P-CARDS-1; see
[`stage2-cards-1`](../stage2-cards-1/README.md) items 7–8).

## The ported consumer

`crates/rh-sim/src/systems/signatures.rs::teleported` reproduces the source chain in the source's order:

- **`resetAll(world, true)`** — every fighter's faction runtime (players *and* mobs) starts over: target, mark, reach,
  engagement, chill sources/episode, ranged chill, DoT pause, AP hit history and the synced signature bits; only the heal
  lockout clock (source `combatAt`) survives. The damage-over-time buckets are **dropped without a flush** and
  `dotSince` moves to now, exactly as the source reset does (unlike `runEnded`, which flushes).
- **`dropHealsOverTime`** — `systems::heal::drop_over_time` forgets the heal-over-time steps still to come (the first
  step has already been paid); `cardHooks.resetFight` later in the same chain finds the runs already gone.
- **`rearmTriggers`** — the source forgets the once-keys of trigger rows whose `rearm` is `"teleport"`. The shipped
  catalog carries no such row (the generated `TriggerRow` has no `rearm` field and the captured catalog source has no
  `rearm` key), so the source loop deletes nothing; the port keeps the fired set and the capture pins the retention.
- The source's ephemeral mark index is dropped too; in the ported domain the tax/suppress index does not exist (the
  remaining neutral tax source is `Pending`, below), and the public mark tier is derived from the surviving mark state
  (ADR 0014), so clearing the mark clears the wire presentation.
- The source's synced `sig` clear is partial: it masks out the mark-derived bits (taxed, suppressed, exec-blocked) and
  lets the next after-damage pass rebuild the rest. The port models the same: the non-mark bits are kept and only
  `SIG_EXEC_BLOCKED` (the one mark bit the ported domain has) is cleared. `brand`/`markTier`/`markBy`/`markTax`/
  `frostMoveMult` are source-only presentation fields with no Rust storage (protocol 5 omits signature bits/effects);
  the capture pins them neutral after the teleport.

The schedule row was flipped **in place** (`pending_link` → `ported_link` at its recorded position; no reorder, C-TICK).
`crates/rh-parity/tests/schedule.rs` now requires the ported link; the record's names/order/modes/gates are unchanged, so
no legacy schedule recapture was needed. No new serialized state was added (a teleport writes defaults into existing
fields), so the checkpoint format, replay identity, hash coverage, observation layout and protocol stay as they were.

## Captured legacy fixture (pinned container only)

`parity/faction/teleport-reset.json` (`rh-faction-teleport-reset/1`, sha256
`476e16b27740c22cda4b5af3020b673089e5369d30af7b253e40c9547f69eb20`) is captured by
[`tools/faction-fixtures/teleport-reset.ts`](../../../tools/faction-fixtures/teleport-reset.ts) in the established pinned
Linux x64 Node 22.23.4 container (image `c86ecead9e55` with the `v22.23.4-linux-x64` prefix mounted at `/node`; the
fixture records `nodeSha256` `94efd062…`). The probe installs the explicit recorded module list (`HOLY_MODULES`: the
default modules plus `factions`, in `createGameWorld` install order — 22 modules, recorded in the fixture), applies a
trusted private faction setup, reads it back as `before`, fires the **actual installed `teleported` hook** (or the
**actual `teleportToColiseum` producer** for the third case) and records `after`. The committed bytes are the pinned
container's bytes; `bash tools/faction-fixtures/capture.sh` + `cmp` re-captures them (the README records the exact
commands and mount set). Host `packages/` is byte-unchanged from the accepted baseline (the container mounts the worktree
read-only). Captured cases:

| case | how it fires | pinned behaviour |
|---|---|---|
| `marked_chilled_locked` | actual installed hook | targets/marks/chill/DoT/HoT cleared, `combatAt` kept (heal inside 3 s refused, after 3 s paid), fired key retained, no events emitted |
| `clear_fighters` | actual installed hook | defaults preserved; positions/ready clocks untouched; heal-lockout boundary exactly 3 s |
| `producer_teleport` | actual `teleportToColiseum` | same faction after-state through the real producer; its own `fx` teleport event is the only event |

## Tests

- `crates/rh-sim/src/systems/signatures/teleport_tests.rs` replays each captured case through
  `hooks::fire(HookArgs::Teleported)` (the one dispatcher `coliseum::teleport` calls), compares the whole modeled
  `before`/`after` dumps field by field, asserts the source-only presentation fields are neutral, the DoT buckets are
  dropped without events, the fired set survives, both heal probes land exactly as captured, and includes a mutation
  guard (a surviving mark tier, a surviving DoT bucket and a changed lockout heal each must fail the comparison).
- A focused producer call-site test configures the source lifecycle in-test and proves the settle-phase teleport reaches
  the ported link (the production admission gate for a source-arena + faction world stays closed; see "Remaining").
- `cargo test -p rh-parity --test schedule`: 14/14 conformance tests pass with the flipped row.

## Why `factions.markTaxSource` stays `Pending`

The source row is the Sentenced mark's attack-speed tax (`packages/server/src/sim/factions.ts` `taxFactor`/
`markTaxSource` l.787–822). The shipped sheet is neutral: `packages/shared/src/factions.ts` l.55 sets
`tax_keep: 1, tax_cap: 99` alongside `suppress: 1`, and `taxedRate` (`packages/shared/src/mark.ts` l.36–38) never
cuts below `MARK_TAX_THRESHOLD = 1.0` (`packages/shared/src/constants.ts` l.328). For `keep = 1` the formula is
`min(99, 1 + (r − 1)) = r` for every `r ≤ 99`. In the packet's base-player domain (`cardAsMultOf` is 1: no cards, and
the farm rows are mob-reward domains owned by P-MOBS/P-CARDS) the realisable `r` is just the faction rate, `≤ 1.85`.
Even a maximal shipped card build stays far below the cap (the whole 80-card catalog carries six attack-speed rows
totalling 1.3, so `r ≤ 1.85 × (1 + 1.3) = 4.255`); the only theoretical route to the cap is thousands of the two farm
attack-speed mob kills (0.01 each, ≈5,200 kills to reach 99), which is a mob/farm domain that is neither installed nor
part of this packet. So `taxFactor` is 1 and the source returns `null`: installing it would be unreachable dead code.
 The accepted Sentenced slice says so explicitly: "Current neutral amp/tax/suppression/attack-speed factors are
specialized out in this bounded domain; they are not unused configurable knobs. Later card/nonneutral domains must add
their live data and identity before activation"
([`stage2-sentenced-support`](../stage2-sentenced-support/README.md#mark-gameplay-and-source-evidence)), and P-FACTION-1
asks to "Keep remaining unported rows pending rather than installing placeholder handlers". Turning the neutral values
into content-registry knobs would also move `content_hash` for zero behaviour. So the row stays `Pending` by design; the
parity conformance test keeps it visible and the existing captured Sentenced traces (which reach tiers 2–4 on near targets
while the marked fighters keep attacking — every `sentenced_*` fixture with a tier 3/4 mark, e.g.
`sentenced_execute_denial` and `sentenced_weapon_axe`) still compare every hit tick and amount exactly, so a carelessly
applied tax cannot pass. **Owner question only if the shipped tuning ever changes
(`tax_keep < 1` or `tax_cap ≤ threshold`): then the source's full mark index and this row are a real port.**

## Gates (native, this Mac)

- `cargo test --workspace --all-features --locked` against the throwaway pinned PostgreSQL:
  **1,422 passed, 0 failed, 3 ignored, 151 test binaries, exit 0** on the restacked tree (the P-CARDS-1 head
  `92dcb662` alone is 1,419; this slice adds the three teleport-reset tests).
- `cargo clippy --workspace --all-targets --all-features --locked -- -D warnings`: **clean, exit 0**.
- `cargo fmt --all -- --check`: clean. `content_hash` unchanged: `0x9f7a0ff31bf3b6d4`.
- Focused: `cargo test -p rh-sim --all-features --lib` **493 passed, 0 failed, 1 ignored**;
  `cargo test -p rh-parity --all-features --test schedule` **14/14**; the new
  `systems::signatures::teleport_tests` **3/3**.
- `git diff 5ab14916 -- packages` is empty: the legacy source the capture mounts is byte-unchanged from the accepted
  baseline.

## Remaining, explicitly not in this slice

`markTaxSource` (neutral, above). Fire roam, Plague corpses/zombies, Sentenced hunt, bruiser passives, cards/AP/
resistance, abilities, transport and client flows belong to `P-FACTION-2`…`P-FACTION-5`, `P-CARDS-*`, `P-ABIL-1` and
`P-MOBS-*`. A live run may not yet combine the source arena lifecycle with a faction mode
(`systems::arena_rules::validate_config` still refuses it: the world would be the explicit partial faction foundation,
not a production module set); the producer call site itself is ported and pinned by the focused test. The next queue item
for this stack is the P-ABIL-1 remainder.

No `docs/MIGRATION.md`, `docs/CONTRACTS.md` status table or `Cargo.lock` edit; no `DEVIATIONS.md` row; no coordinator
file touched.

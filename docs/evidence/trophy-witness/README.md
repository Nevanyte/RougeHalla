# P-TROPHY-WITNESS-1 — source Trophy lifecycle and wording evidence (evidence only)

Status: **evidence packet delivered on `deepseek/p-trophy-witness`** from base `c863007e` (head in the coordination
report). No native/client/protocol/publication implementation; the existing native `RewardOption::Kill` whole-row
omission guard before bindings is untouched, no wire version was invented. Only NEW `tools/trophy-witness-fixtures/**`,
`parity/trophy-witness/**` and `docs/evidence/trophy-witness/**` were written; everything else is read-only.

## Profile that was captured (recorded and bound in both corpora)

Four-seat **player-only / no-mobs weapons-only** world: `CONFIG` = `minPlayers:4, lobbySeconds:30, fillSeconds:0,
patienceSeconds/patienceMinSeconds/suddenDeathSeconds:3600, mobs:false, signatures:false, quests:false,
training:false, dummies:false, planSeconds:0, pvpRules:false`; `MODULES` = `signatures:false, walkHints:false`; map
`seed 1 attempt 0 decor:false`; players Holy/Fire/Plague/Frost. No regional mobs or dummies (the separate
training-exclusion case is the only dummy world). Kills are genuine: an invested victim is pre-wounded with the real
arena `applyDamage` producer, then killed by an ordinary validated `attack` input; credit is the source ledger's
largest-rival rule (recorded hit + credited `rewardOffered` probe). Setup uses real `grantCard` and `grantMobStat`
producers and labelled gear/placements; no expected Trophy option/gain/takenBy/killStats is installed.

## Lifecycle admission matrix (`parity/trophy-witness/lifecycle.json`, 6 cases)

| Source lifecycle item | Evidence observed (actual source output) | Status |
|---|---|---|
| Credited player kill drops a Trophy | kill tick: `rewardOffered` hook probe, container label `Trophy`, owner p0 at the killer feet, `expiresAt` = kill time + 30000, option `kill:ad:16.5` in source order | PROVEN |
| Birth hold | choose on the birth tick refused `Chest gone`; the next ordinary choose succeeds | PROVEN |
| Owner choose + grant | owner pick sets `takenBy[0]=p0`, `pickers=[p0]`, `killStats.ad = 16.5` (the real `KILL_AUG_SHARE` grant); no re-fold expectations installed | PROVEN |
| Repeated pick / skip after pick | second pick and `pick:-1` both refused `You already picked` | PROVEN |
| Owner vs stranger | non-owner choose refused `Not yours`; owner choose succeeds | PROVEN |
| Out-of-range | owner 400 units away refused `Too far away`; after returning, the same choose succeeds | PROVEN |
| Expiry / boundary | pick one step before expiry succeeds (tick 601); at the expiry tick the container is removed by `chests.expireChests`; an expired choose is refused `Chest gone` | PROVEN (actual boundary behavior) |
| Empty investment | credited kill of a fresh victim drops NO Trophy (no `rewardOffered`) | PROVEN |
| Training exclusion | credited kill in a training world drops NO Trophy | PROVEN |
| MIA exclusion | a real `removePlayer` leave (outcome mia) drops NO Trophy | PROVEN (real leave producer, not an ordinary actor input) |
| Self-kill exclusion | not genuinely reachable in the captured worlds (no shipped self-damage producer); code path is only visible in source | GAP (precise) |
| Human selection / public perception transport | owner-only action vs sight-filtered offer disclosure is NOT proven here: this packet records sim state and hook probes only. Ordinary `choose` input (owner) and stranger refusal are proven; the room/client observation and DOM/scene/reconnect lifecycle are outside this evidence | GAP (precise; no DOM/scene/reconnect claim) |

Frames carry the source's own public player state (hp/status/build/killStats/mobStats/campClears), container state
(id/label/owner/expiresAt/options/takenBy/pickers), hit amounts, toasts and the labelled hook-only probe. The match
never terminates: the four-seat profile leaves three standing.

## Helper/wording corpus (`parity/trophy-witness/helpers.json`, 7 declared-input cases)

Separate pure **declared-input** corpus (`evidence` field: declared-input helper cases calling the actual shared
functions, NOT runtime lifecycle). It calls the ACTUAL `KILL_STAT_KEYS`, `rollKillAugments`, `encodeKillAugment`,
`parseKillAugment`, `killAugmentGrant`, `killAugmentText`, `killStatEffects`, `combatReadability` and the exported
constants — no copied formulas. Coverage:

- all NINE keys' investments → options → parsed gains → actual wording (`ad/ap/armor/mr` flat one-decimal;
  `damage/health/attackSpeed/speed/leech` percentage one-decimal, e.g. `+12.3% damage`);
- positive tiny gains and encode/parse rounding (flat `3.14 → 3.1`, percentage `0.123456 → 0.1235`), malformed ids
  (`kill:`, unknown key, non-positive, NaN/Infinity, no prefix) all refused;
- ranking/ties/truncation: descending score order, three-option truncation, fewer-than-three, nothing, filtered tiny
  scores; tie order is the actual stable source order (`ad` before `armor` at equal score 2);
- `killAugmentGrant` storage mapping for all nine keys (e.g. `health → maxHp`, `mr → shield`);
- `killStatEffects` real fold rows, including flat/stat split and ignored zero/NaN/unknown keys;
- one declared all-nine `combatReadability(lasting:true)` case with its actual `investedStats`/options.

These are helper/wording tables, not gameplay outputs and not a native parity assertion.

## Checks / provenance

- Pinned image `node:22.23.4-bookworm-slim@sha256:aaa4b5…`, linux/amd64, Node v22.23.4; 127 inventoried shared/sim TypeScript source files
  digest `e6efe7f3048659701a589433d1690651e8a43d28aa2610bedad744cc3705e1a1`; package-lock hash
  `991869bdfbbefb6874220500197c61db302a4d2b2603dfc2288fd7032ce1d481`; tool/dependency hashes are recorded inside both corpora and the repair receipt (including `compare.mjs`).
- `lifecycle.json`: 6 cases, 72922 B, SHA256 `b8954e0f2607de038ef7f64cb049b7770f1280d3976299149e8df3f21e05ef80`.
  `helpers.json`: 7 cases, 39067 B, SHA256 `00335b6e14b733e8b1cfbf4158e6fb0f5ce933b204a7c39c8298278aeea9e304`.
  `bash tools/trophy-witness-fixtures/capture.sh --check` re-runs the bounded actual-source capture in the pinned
  container and requires byte-identical output (both files).
- Original whole-file mutant result (withdrawn as semantic evidence; see admission repair below): `01-owner-refusal-removed`,
  `02-birth-hold-removed`, `03-ranking-order-reversed`, `04-grant-arithmetic-doubled` — the original runner compared complete files, including changed source hashes. Its **4/4 claim did not establish
  semantic discrimination**. Repaired semantic results are recorded below.
- No native parity assertion: no native Trophy consumer exists yet; this packet deliberately does not add one and does
  not touch the `RewardOption::Kill` omission guard.

## Remaining (exact, for the lead/next packet)

1. **Self-kill exclusion**: source path is present (`killer.id === victim.id` return) but not reachable through shipped
   producers in this world; must be proven only if a genuine self-damage producer is admitted, or documented as
   untriggerable source code.
2. **Owner-only action vs sight-filtered concession transport**: sim state, ordinary owner `choose` and non-owner
   refusal are proven; the room/client observation/disclosure layer (who is told an offer exists) and any DOM/scene/
   reconnect behavior are NOT claimed.
3. **Native Choose transport**: still lead-owned; this evidence is ready for a future native consumer, but no native
   parity assertion or wire/protocol decision is made here.
4. `rewardOffered`/`rewardChosen` evidence is through a labelled hook-only probe, never counted as a gameplay producer.


## Mutant-evidence admission repair

Repair base: `eb3e4feb0d00d242b93bc1a5933b56ff33fd2961`, isolated branch `codex/trophy-mutant-evidence-repair`.
The repaired comparator excludes provenance and requires each mutant to change its actual named witness path. A
comment-only source/provenance mutation must leave all cases equal and is explicitly not a semantic kill.
Compilation/import/capture failures remain fatal; the final unchanged control requires byte-identical capture `--check`.

The capture tool now records the comparator hash too. Both NEW Trophy corpora were regenerated through the pinned
actual-source tool: only tool provenance changed, and serialized old/new `cases` payloads are byte-identical. Source
and dependency pins are preserved. The [repair receipt](mutant-admission-repair.json) records exact payload/file/tool
hashes and commands; [scoped output](mutant-admission-repair.log) records the final actual semantic controls.

This repair adds no native consumer, wire allocation or gameplay case. Exact C# decimal-midpoint formatting coverage
remains a future formatting gate; owner action vs disclosure, real DOM/reconnect and unreachable self-kill limitations
above remain unchanged.

Actual repaired result: **4/4 named semantic mutations killed; provenance-only mutation not counted; restored control passed.**

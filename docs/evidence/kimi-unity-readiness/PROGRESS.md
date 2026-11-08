# Kimi Unity readiness — progress ledger

Original branch/base: `kimi/unity-readiness` at `856618eb948555adefc6ff0bf4628d879d556250`.  
Integrated readiness records: `2f9d4003`; presentation inventory/checker: `b30ade57`.  
Reviewed native source: `5a42cf59fe9a0b9faab5499540fae8b7cb3321b1` (protocol 11, observation 17).

This is the only shared readiness ledger for this run. Shared migration/contract status records, DeepSeek-owned paths,
protocol fixtures and existing CI workflows are not write scope for this run.

## Original environment and upstream snapshot (historical)

- Disk: 317 GiB available before work, above the 15 GiB minimum.
- Node: v25.8.1; npm: 11.11.0; Python: 3.9.6.
- .NET SDK: 8.0.427 at `$HOME/.dotnet/dotnet` (not initially on `PATH`).
- Rust toolchain: `1.97.0-aarch64-apple-darwin` installed under `$HOME/.rustup/toolchains`; Cargo is not initially on
  `PATH`.
- Unity: pinned `6000.0.85f2` Editor executable is installed at
  `/Applications/Unity/Hub/Editor/6000.0.85f2/Unity.app/Contents/MacOS/Unity`; `-version` returned `6000.0.85f2`.
  Batchmode licensing, EditMode/PlayMode tests and Web builds have not yet been run in this milestone.
- `origin/deepseek/rust-completion:docs/evidence/deepseek-rust/PROGRESS.md` reports P-FACTION-4 DONE-VERIFIED,
  protocol 7, observation 16 and content `63036d344ce05ea0`. The readiness inventory must inspect current upstream
  source and name the actual version; the prompt's protocol-6 labels describe the original base only.

## Workstreams

| Workstream | Status | PR | Evidence / next action |
|---|---|---|---|
| A — presentation contract and generated gaps | Inventory accepted/integrated; cue implementation INCOMPLETE | Integrated at `b30ade57` | 125 cues, 162 legacy modules and 228 current protocol/observation symbols classified; protocol 11/native 17 repin and generated gaps checked below. |
| B — data-driven presentation | INCOMPLETE — inventory available | None | Source availability is not evidence that all Unity cues are implemented. No full inventory rendering proof is recorded here. |
| C — recorded-session playback | INCOMPLETE — inventory available | None | Existing slice playback/performance evidence is separate; no complete 125-cue protocol-11 playback proof is recorded here. |
| D — non-visual Unity flows and Unity CI | INCOMPLETE — existing slice proofs only | None | Existing bootstrap/first-playable evidence does not certify every current account, training, planning and end-to-end browser flow. |
| E — local placement, stale client, prediction parity | INCOMPLETE — partial independent evidence | None | Placement infrastructure and P-NET-1 C# pathfinding parity exist; full prediction/reconciliation and Unity flows require their own evidence. Active input-latency work belongs to its separate chat. |
| Final visuals-stage brief | INCOMPLETE | None | Write only from verified workstream evidence and measured crowded-playback budgets. |

## Commands actually run

| Command | Result |
|---|---|
| `git fetch origin optimization_port` | Passed; base resolved to `856618eb`. |
| `git fetch origin 'refs/heads/deepseek/*:refs/remotes/origin/deepseek/*'` | Passed; DeepSeek remote branches refreshed. |
| `git switch -c kimi/unity-readiness origin/optimization_port` | Passed; pre-existing untracked prompt files preserved. |
| `df -h .` | 317 GiB available. |
| `git show origin/deepseek/rust-completion:docs/evidence/deepseek-rust/PROGRESS.md` | Read; protocol 7 / observation 16 reported. |
| `/Applications/Unity/Hub/Editor/6000.0.85f2/Unity.app/Contents/MacOS/Unity -version` | Passed; `6000.0.85f2`. |
| `$HOME/.dotnet/dotnet --version` | Passed; `8.0.427`. |

The commands above are the original readiness bootstrap, not the current repository-wide test status. This cleanup runs only the focused inventory/checker commands below; it does not claim new Unity builds, browser tests or performance measurements.

## Open questions and blockers

- A's inventory is integrated; implementation work may use its explicit source facts and gaps without treating this inventory as final visuals approval.
- Any cue requiring data absent from current upstream protocol must be generated into `docs/unity/PROTOCOL_GAPS.md`, not
  patched into DeepSeek-owned protocol code here.
- Final readiness remains unclaimed until each checkbox has revision-specific evidence; unavailable or failing Unity,
  browser or gameplay-dependent checks must remain explicitly INCOMPLETE.

## Protocol-11/native-17 reconciliation

- The checked source now includes owner planning and public arena State, Teleport Fx, training flag/Train/Toast,
  typed dummy and zombie actors, eligible Plague corpse props, large potions, wind/cannon transport and 80-card counts.
- The inventory has **68 entries with required source facts**, **47 with protocol/data gaps** and **10 with missing
  mechanics/external flows**. These are source classifications; they are not counts of implemented Unity cues.
- Native camp wards, Fire roam, zombie/corpse lifecycle and Camp-potion recovery are implemented producers. Their missing
  public mirrors remain data gaps. The historical immediate campHeal renderer is dormant in current legacy source and
  does not create an obligation to invent a heal producer.
- Full Wish owner/cast transport remains refused. Quest/trade flows, complete public map/vision/projectile/stat/result
  surfaces and several one-shot cues remain incomplete. Generated [PROTOCOL_GAPS.md](../../unity/PROTOCOL_GAPS.md)
  is the exact per-cue source list.
- The [owner order of operations](../../ORDER_OF_OPERATIONS.md) labels the plan adopted, while its D1–D9 ADR records and
  conflicts remain unresolved there. Accepted ADRs/contracts continue to govern those conflicts. Seeded
  [deviation-ledger](../../DEVIATIONS.md) rows awaiting owner approval remain proposals; merging the documents does not
  approve them. Audio/renderer choices and performance targets are not adopted implementations merely because they are
  inventoried.
- P-NET Phase 0 numbers in PLAYER_PREDICTION are historical `f62d3441`/protocol-6 slice measurements. The all-Full heavy
  total is 3,085 B/s (1,819 snapshots + 1,266 Fx), not a final-union benchmark or input-to-photon measurement.

### Focused reconciliation checks

| Command | Result |
|---|---|
| `node tools/unity-readiness/check-inventory.mjs` | PASS: 125 cues, 162 modules, 228 symbols; 57 source-gap entries. |
| `node tools/unity-readiness/check-inventory.mjs --check` | PASS: generated report byte-current at reviewed source pin. |
| `node --test tools/unity-readiness/check-inventory.test.mjs` | PASS: 10 tests, including fail-closed planning/arena member drift. |

No Unity cue, asset, input path, prediction integration, gameplay rule, deployment or new browser/performance proof is
implemented by this reconciliation. The full readiness milestone remains **INCOMPLETE**.

### November 8 adapter repin

The lead repinned the exact native union after the reward-publication compatibility repair and RTT adapter merge.
Whole unsupported Trophy rows are omitted before offer bindings; native/headless offers remain complete. This changes
no wire member or cue classification: the generated inventory still has125 cues,162 modules,228 symbols and57 gap
entries (47 data/protocol +10 mechanics/flows). Both inventory generation/check and all10 checker tests pass. No new
Unity cue or art-branch completion is claimed.

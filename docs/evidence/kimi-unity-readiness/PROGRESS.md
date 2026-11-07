# Kimi Unity readiness — progress ledger

Branch: `kimi/unity-readiness`  
Base: `856618eb948555adefc6ff0bf4628d879d556250` (`origin/optimization_port`)  
Current head: `856618eb948555adefc6ff0bf4628d879d556250`

This is the only shared readiness ledger for this run. Shared migration/contract status records, DeepSeek-owned paths,
protocol fixtures and existing CI workflows are not write scope for this run.

## Environment and upstream state

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
| A — presentation contract and generated gaps | INCOMPLETE — not started | None | Start inventory/checker against legacy client and current DeepSeek protocol. |
| B — data-driven presentation | INCOMPLETE — waiting for A inventory | None | Start after A's inventory exists. |
| C — recorded-session playback | INCOMPLETE — waiting for A inventory | None | Start after A's inventory exists. |
| D — non-visual Unity flows and Unity CI | INCOMPLETE — waiting for A inventory | None | Pure C# and serialized Unity work after A; actual Editor/browser evidence required. |
| E — local placement, stale client, prediction parity | INCOMPLETE — not started | None | Independent non-gameplay server/C# scope; validate each item separately. |
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

No implementation tests, Unity batchmode checks, browser proofs, builds or performance runs have been completed yet.

## Open questions and blockers

- No owner decision is needed to begin A.
- Any cue requiring data absent from current upstream protocol must be generated into `docs/unity/PROTOCOL_GAPS.md`, not
  patched into DeepSeek-owned protocol code here.
- Final readiness remains unclaimed until each checkbox has revision-specific evidence; unavailable or failing Unity,
  browser or gameplay-dependent checks must remain explicitly INCOMPLETE.

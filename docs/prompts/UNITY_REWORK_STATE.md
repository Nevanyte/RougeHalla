# Unity rework: coordinator state

Read this first after any context reset. Direction: [UNITY_REWORK_FABLE.md](UNITY_REWORK_FABLE.md). Gate reports: `UNITY_REWORK_REPORT.md`.

## Now
- **Phase:** Gate 1 (direction). Started 2026-11-09.
- **Feature branch:** `feature/unity-rework`, cut from `optimization_port` at `61f9f15f`. Never push, never merge.
- **Toolchain PATH:** `export PATH="$HOME/.cargo/bin:$HOME/.dotnet:$PATH"` (neither is on the default shell PATH).
- **Display:** confirmed 2560 x 1440 @ 144 Hz (`system_profiler SPDisplaysDataType`), plus a second 1080p/100 Hz panel.

## Unity processes
- PID 9075: an Editor the owner's earlier Codex lane left open on `/Users/nevinmckinnon/Documents/Projects/RogueHalla-unity-art/...`. Not ours. The handoff says do not save, reset or clean it. Leave it alone; it holds a different project copy.
- Main checkout project copy (`client-unity/UnityProject`): free.

## Worktrees opened by this effort
(none yet)

## Gate 1 work in flight
| Task | Model | Output |
|---|---|---|
| Hitbox / chest-height / protocol design | Opus | `docs/adr/0024-hitbox-archetypes.md` (draft) |
| Controls audit (code) | Sonnet | `docs/rework/CONTROLS_AUDIT.md` |
| Palette research + asset/licence ledger | Sonnet | `docs/art/PALETTE.md`, `docs/art/LICENCE_LEDGER.md` |
| UI branch triage + legacy layout spec | Sonnet | `docs/rework/UI_TRIAGE.md`, `docs/rework/LEGACY_LAYOUT.md` |
| Baseline test run | coordinator | results in Gate 1 report |

## Decisions taken
- 2026-11-09: branch name `feature/unity-rework`.
- 2026-11-09: Gate 1 doc-only tasks share the main checkout (distinct files, no commits by sub-agents); code tasks get worktrees.
- 2026-11-09: the unmerged protocol-15 netcode WIP (`claude/peaceful-babbage-rtsgq6`) is not part of this effort; our bump is taken from 14 on this branch and the number clash is flagged at Gate 1.

## Next
Gate 1 report, then workstream B (Rust) in a worktree with Opus review, A/D/E/G Unity work in parallel worktrees (max 4).

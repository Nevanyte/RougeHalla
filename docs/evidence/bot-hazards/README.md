# Private hazard module / advanced bot continuation

Base `198902f42970bd3d71d431931020819b0e36f008`, isolated branch `codex/bot-fair-observation-completion`.

The standalone `crates/rh-policy/src/bots/hazards.rs` ports original source `brain/modules/hazards.ts`: categorical
public-ground risk, stable tile search/ties, held steps/arrival/expiry/cooldown, light search and movement adjustment.
It uses existing `rh-sim::geometry::{circle_clear,segment_clear}` rather than implementing authoritative collision,
movement or damage. The unchanged adjust path borrows the original slice and clones only on an actual redirect, matching the source
copy-on-change behavior. It emits ordinary policy intents, preserves timing/priority and never submits privately privileged
inputs. Public TileMap metadata and Observation owner/arena are its only world inputs. `Context` additionally takes
remembered policy goal/engagement/stillSince and persona reengage threshold; the adapter must derive stillSince from
observed owner positions at delivered source times. No direct World clock, tick arithmetic, hidden facts or ML.

This is **not seat activation or full bot completion**. Public hazards remain gated Off. The full source memory,
FrameRing/strategy/tactics/hunters are still missing. Native owner attack_target exists but human13 lacks that canonical
lock leaf, so a shared live source-equivalent caller needs a reviewed lock-display/admission decision. Root owns that
lease. The API refuses to guess absent owner/arena facts. Call reset on seat/match/source-clock epoch reset; no policy
checkpoint/state format is introduced here. The source's adjust hook intentionally has its own status guard, independent
of intents' phase/coliseum guard.

[Concrete dependency and shared disclosure decisions](ADVANCED_BOT_DEPENDENCIES.md) cover the whole advanced-bot
remainder, distinguish newly delivered13/19 facts from the stale17/11 proposal and give exact next write leases.
No shared observe/protocol/state/wire, policy ABI, content identity, Cargo.lock, old corpus or status changes.

Evidence scope: the actual original source module is invoked over **declared lawful contexts**. No expected source
outcomes are installed. The 28 FSM steps,20 adjustment cases and75 classification cases are not real-game/headless
outcome captures. All positions are tile centers and HP examples exactly representable in current human owner floats;
future delivery normalization/lock and feature admission remain separate. Other source policies are not replaced by this
single module. No claim of C-OBS paired-world publication proof follows from a direct input-dependency unit test.

Validation and hashes are recorded in `receipt.json`; raw logs and mutant output remain outside the repository under
`return-cleanup-2026-11-08/bot-fair-observation/`. Source mutant comparison excludes provenance: metadata differences
alone cannot kill a mutant. Earlier corpus expected outcomes are unchanged.

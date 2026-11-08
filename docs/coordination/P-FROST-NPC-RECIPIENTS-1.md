# P-FROST-NPC-RECIPIENTS-1: player Frost chills existing basic NPCs

Lead assignment for the completed Frost worker. Continue from reviewed
`6cfb7a413a56883952f6e7a8e7dc42d7fcf6a8df` on a new isolated continuation branch, preserving that delivered ref and
the active G6/networking work. The lead owns composition and content identity/tape registration. This is an entire
bounded recipient port, not permission to remove the full NPC signature prerequisite gate.

## Exact scope

Port Frost PLAYER sources chilling the existing source-born Fire, Holy and Plague basic regional NPC recipients.
Generalize recipient access in `systems/frost.rs::ranged_hits`, `after_damage` and `after_weapons` through the existing
fighter_idx/core/core_mut/standing accessors. Preserve strongest-source, resistance, quantization, exposure/thaw and
cooldown/draw/buffer timing in source order. Reuse FighterCore.signature and actor-reserved scratch.attack_started,
which generic weapons already populate. Do not add serialized fields or duplicate an NPC Frost runtime.

For the lead's later content fold, extract the existing resisted attack result and resisted-then-quantized movement
result into small pub(crate) pure helpers used by the actual runtime. Keep arithmetic/evaluation order identical.
Do not add a dummy revision constant or edit content.rs; report helper names/signatures so the lead can probe the real
formulas when registering the combined identity. Source parity must still detect bypassing those runtime helpers.

KEEP the instant attack_started hook PLAYER-ONLY: the real factions.ts hook explicitly restricts it. NPC timing
correction belongs in afterWeapons. A blanket hook extension is a behavior bug. Verify these source sites before coding.
NPC validate_basic already invokes Frost validation; prove any newly reachable chilled state without weakening basic
NPC gear, Mark, provenance or source-ID checks. Chiller sources remain roster player IDs. No Frost/Sentenced NPC
sources, other camp types, Sentenced mob-target port, public facts, AI policy, new randomness or admission widening.

Write only frost.rs, necessary dedicated Frost/NPC validation tests and the smallest diagnosed NPC validator adaptation,
new tools/frost-npc-fixtures/**, parity/frost-npc/** and docs/evidence/frost-npc/**. State/checkpoint shared schema,
hash-coverage, schedule/content/format/tapes, heal/G6, protocol/server/client, Cargo.lock and shared status records remain
read-only. Report an exact prerequisite before editing outside this scope. Use an own absolute target; no main writes,
merges/pushes to optimization_port or live activation.

## Source and native proof

Capture actual source-born admitted basic NPCs through an explicit correctly bound module/config/map profile. Use real
input, attacks, engagement and movement; trusted initial placement is labelled. Do not install expected chill, cooldown,
draw or movement outputs. Reuse the existing basic-region native constructor/provenance and ordinary validate/submit.
Compare a bounded source/native timeline for melee clock correction, ranged hits/attack boundary, overlap near/ranged,
movement/return behavior and death/reset/thaw. Include a player-source attack-start control proving the NPC hook is not
instant, and a no-Frost/no-card unchanged control. Restore/continue actual chilled NPC cooldown/draw/exposure forms;
malformed tuple/source/clock checks and replay remain strict.

Pinned Linux/amd64 Node22.23.4 image, dependency/tool/source/config hashes, immutable additive corpora and byte-exact
capture --check are required. At least three compiled semantic mutants must distinguish missing NPC recipient handling,
wrong instant-NPC-hook timing and incorrect restore handling by actual output assertions; compiler errors are not kills.
Restore controls. Run focused Frost/basic-NPC/restore/replay/zero-allocation checks and both affected strict lint modes,
not unchanged full map/workspace campaigns. Preserve all earlier source expected bytes.

Success is the full named basic-NPC recipient port with source timeline parity, strict restore/replay, real mutants and
unchanged admission gates. Failure/hold is synthetic outcomes, widened NPC source admission, tick reorder, weaker state
validation, or an unresolved source/native timeline mismatch. Deliver exact base/head/files/hashes/commands and clear
remaining NPC Frost/Sentenced source and five strict Wish-case prerequisites in the existing DeepSeek Rust report.

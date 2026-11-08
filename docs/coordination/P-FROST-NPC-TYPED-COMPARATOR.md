# P-FROST-NPC-TYPED-COMPARATOR

Immediate mechanical follow-up to the delivered repair: start a fresh isolated branch from immutable
`ee07c9d0c42a013788e95f3354cbe3210fa8a8ab`. Preserve that ref and its worktree. The expert lane is separately repairing
only the bounded future Draw-clock admission in mob_checkpoint.rs; do not touch that file or any production code.

Root review found two test-consumer defects in `systems/frost.rs`: landed victims still use `fr_npc_id` contiguous-ID
arithmetic instead of the typed source→native map, and native IDs already used during a frame's new bindings are
snapshotted once before the loop, allowing two fresh source rows to select one native candidate. Audit every actor
reference in the comparator: player labels may use roster indices, NPC labels must resolve a uniquely bound typed
birth/provenance mapping or fail. Unknown IDs cannot silently fall back to contiguous NPC arithmetic. Prevent reuse of
one native identity as each new binding is made, and fail missing, duplicate or ambiguous bindings explicitly.

Write scope: cfg(test)-only Frost source consumer/helpers/tests in `crates/rh-sim/src/systems/frost.rs`, plus
`docs/evidence/frost-npc/**`. No source corpus, recorder, runtime, shared status/schema/content/tape or other edit.
Keep birth/death/respawn and declared pre-world zone-variant limitations explicit: this patch does not invent a source
respawn witness or open Full Frost/Sentenced NPC gates.

Add meaningful mapping controls: consistently non-contiguous NPC source identities must still compare the same
genuine captured frame/event payload through typed bindings; mismapped landed victims must fail, as must duplicate
or unknown native bindings. A provenance-only difference remains a non-kill. Do not mutate expected combat outcomes
or weaken frame/actor/event checks to pass. Run all17 focused Frost consumers plus the new controls, fmt and affected
strict lint modes. No unchanged maps/workspace/hash campaign or full source recapture.

Use a separate checker. Success is typed unique mapping for every consumed NPC reference and passing original
consumer payloads/negative controls. Hold/report if another production mismatch is needed. Deliver exact clean head,
files/results/limits to the existing Rust report; root owns integration and chooses subsequent clock-matrix work.

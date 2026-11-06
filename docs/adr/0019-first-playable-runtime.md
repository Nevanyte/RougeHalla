# 0019 — First playable runtime and public NPC/projectile facts

Status: Accepted for the owner-selected playable-core staging milestone. Validation lives in
[the integration record](../evidence/first-playable-core/INTEGRATION.md), not in this decision status.

The first staging release uses a small admitted, hand-authored map and the supported Holy/Fire/Plague PvE configuration.
It includes normal weapon combat, mobs, Small potions, the Slow Burn/Pocket Sand/Siphon card selection and eight stat
boosts. This is a selected runtime, not equivalence to the complete default legacy installer. Quests, traders, advanced
bots, other consumables, the remaining regional mechanics, visual polish and hosting scale work remain deferred.

Actual initial loot and mobs share the constructor's entity/item allocation order. Private birth serials, item UIDs,
reward rolls and RNG state stay in the authoritative world/checkpoint. All carried stats have one runtime owner;
combat, movement, healing and rewards read it. Client commands retain validation and normal Sim submission.

Public NPC references use a per-observer high-bit namespace, disjoint from human seats. A committed complete scene
reserves a fixed 512-reference block, including scenes with no visible NPCs. This avoids revealing hidden births or
skipped observations through identifiers. Current and recent bindings identify an exact actor; they are never rebound
to a replacement. Current visibility is checked again on targeting. Resume clears bindings while preserving the cursor;
failed delivery commits nothing. The wire's absent-source sentinel `u32::MAX` is reserved. These references currently
renew each delivered tick: stable NPC identity and interpolation are not promised for this milestone.

Projectiles are an ID-free, complete array of current authoritative positions/facings with a currently visible original
owner when permitted. Reflected arrows omit owner. Projection tests the flight point, quantizes before ordering, maps
NPC owner references with the scene, preserves duplicates and refuses overflow rather than truncating. Unity renders
these facts without implementing flight, collision or damage. This initially presents projectile motion at 20 Hz.

Unreleased protocol6 gains commands Choose/UseConsumable/Target/AttackMove, owner-only chest/potion notices, actor
mob type/signature bits, and State keys4–7 for reward chests/build/camps/projectiles. Keys1–3 remain inventory/props/fields.
All seven are complete replacements: missing retains, empty clears, join/resume/resync refreshes all. Reliable enqueue
is atomic before committing observer handles or collection baselines. Rust/C#/JS use the same regenerated v6 vectors.

The selected map's conservative 456-prop bound assumes at most eight seats and a process lifetime of four hours plus
180 seconds of drain grace. The opt-in live profile enforces this lifetime. This is an operational admission limit, not
a new match rule or an infinite-duration loot bound. Production and the full original backlog are unchanged.

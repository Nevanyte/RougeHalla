# Protocol 6 transport checkpoint

The live room now sends reliable self inventory, visible loot/focus and redacted fields through the same prepared
ItemObserver boundary as headless and policies. Pickup input carries a typed observer reference. Atomic reliable
enqueue precedes both handle and collection-baseline commit; rejected batches accept no disposable frames either.
Resume keeps the handle cursor, discards bindings and sends a complete replacement. Resync refreshes all keys under
the existing 20-tick forced-full limit. Unchanged collections emit no incremental State bytes.

Rust/C#/JS share protocol6 vectors, including all five keys, body BOM/UTF-8, duplicate field multiplicity, full clears,
new scalar effects/displacement, malformed keys/order/handles/counts and every truncation. C# retains socket-order
State across newer snapshots and snaps short explicit displacements. It clears old pending inputs on Welcome.

Focused validation passed76 protocol tests,83 server library tests,20 live/publish/ending tests,229 C# tests and3,811
JS checks. Strict all-target/all-feature Clippy for protocol/server and formatting pass. C# steady snapshot decode still
allocates zero with spare reuse. Its actor value grows24→28 bytes for the new status/displacement facts; allocation
limits now use that pinned layout rather than the old size. This is not a full-game performance measurement.

[Browser proof](browser-proof.json) records actual Chromium WSS admission, full/delta frames, all State keys on
join/resume, deferred resync, movement, combat, authoritative results, result resend and wrong-version refusal.
TLS is self-signed localhost, not the AWS public-TLS gate. The room-level pickup regression equips a delivered sword,
rejects stale/reconnected handles and fences the replaced connection. It uses a trusted test rack; no debug pickup
command was exposed. The existing Unity player has not yet been rebuilt for protocol6.

[Independent review](REVIEW.md) accepted this bounded transport slice before nine additional malformed State vectors
were added. Its historical counts220/3,802 are superseded by the final229/3,811 in [integration.json](integration.json).
No duplicate workspace, source recapture or broad mutation campaign was run for this transport change. The preceding
native status checkpoint passed Rust/C#/browser CI42159058642, legacy recapture42159058669 and native determinism42159246989.

Reward/build keys currently contain explicit empty replacements and potion counts are zero pending their actual native
producers. Choose/Use wire inputs, conservative native initial-loot admission, nonprivileged socket/Unity loot selection,
remaining effect announcements, functional HUD and cloud staging are open. This checkpoint does not close
P-NET-ITEMS-1 or the playable-core milestone. No game rules, content identity, core formats or cloud resources changed.

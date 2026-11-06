# First playable core — independent merged review

**Decision: no concrete blocker found in the inspected integration seams.** Read-only static review of the combined uncommitted root. Accepted frozen-package reports supply within-package context; this review does not recertify every subsystem.

Reviewed seams:

- `sim.rs:80–81` retains one initial-loot constructor before mob setup. Real initial allocations establish `initial_birth_serial`; `systems/mob_checkpoint.rs:28–30,90` uses that verified prefix for typed mob provenance. Shared actor/entity headroom includes potential camp births and their next-step work.
- `systems/initial_loot.rs:157–158` now rejects changed constructor birth ticks and depleted initial crates marked unopened. The targeted regression is present in `systems/potions_tests.rs`.
- `sim.rs:122–130` preflights unsupported basic-PvE placements before setup, preventing skipped joins from shifting loadouts. Its default faction selection uses the supported subset, and unsupported ordinary joins are refused before mutation. The mixed-placement regression is present in `systems/signatures/pve_tests.rs`.
- `item_view.rs:321–334` stages reward offers, includes raw earlier filtered events, creates the current projectile view, and performs one shared NPC-reference projection before returning the delivery guard. Projectiles carry no launch IDs or private history; only currently visible original owners survive, reflected ownership is omitted, and `actor_refs.rs:25–28` remaps NPC owners and sorts final public rows. Failed preparation has no issuance commit.
- Target references resolve through immutable observer bindings and current visibility checks; pickup/choice/use commands retain validation and normal Sim submission. Shared `systems/inputs.rs` remains the bounded intake path for players and supported NPC actions. Headless and policy adapters feed pending raw FX into the common preparation boundary.
- The aggregate content fold includes initial-world and potion definitions and basic-faction availability. NPC-reference and projectile representation capacities are explicitly classified as presentation/admission values in the content checks.

Limits: no source edits, builds or tests were performed. Native wrappers/gates are coordinator-owned and were running separately. In-progress private server/wire adapters and final live enqueue acceptance were deliberately excluded. Final transport must preserve the single projection boundary and commit only on accepted delivery. Earlier package limits still apply, including selected gameplay/source projections and unfinished broader consumable/regional domains.

## File identity

The following hashes were read from the root when this report was saved, immediately after the static review. The workspace is concurrently integrating changes; these identify this report's inspected file set, not a repository-wide immutable checkpoint. Review consisted of targeted sections and searches in these files, not full-file certification.

| File | SHA-256 |
| --- | --- |
| `crates/rh-sim/src/sim.rs` | `1c180c825a1c6640f48327d4a5c06c5296e9bb81f07b1e1b7e00eb00bb13baed` |
| `crates/rh-sim/src/systems/initial_loot.rs` | `34c0dbe5539d9336da734ff65e3a28cd27b597401a20952d620c9441a1386149` |
| `crates/rh-sim/src/systems/mobs.rs` | `3f50d899cd09e72f949d3340729931e1d3b58d22c2c23dd0a3a8af0a5200c7b5` |
| `crates/rh-sim/src/systems/mob_checkpoint.rs` | `3794802b08c72bc19cd8d375641b436765e030953d433b583cdb2627f30688e2` |
| `crates/rh-sim/src/checkpoint.rs` | `76b10f3ba3a2a80b7e19cbcfa64bd52daf44b2644f4a55e6f3300d91d1f21640` |
| `crates/rh-sim/src/item_view.rs` | `c45f6509cb3970ac74226b1c1b2d67d102391dc3dfa521108a4af3724b7d28e7` |
| `crates/rh-sim/src/actor_refs.rs` | `4ca1467c6e537991a31b7cefbd0173b14fdecfa0490e09cab9b4247388125dee` |
| `crates/rh-sim/src/projectile_view.rs` | `008debb0693021a4a53721787cb7095f03006cd2dc2d4709fb7a8976a8d9c4db` |
| `crates/rh-sim/src/content.rs` | `8712f3b19c4888984d79a503b1f2f4fbf04f682fdb23ecbfd89f92e159286786` |
| `crates/rh-sim/src/systems/lobby.rs` | `50ec06b7f3a43269540472946e28867a6076da165888ad03dddef28abbac2e65` |
| `crates/rh-sim/src/systems/inputs.rs` | `413c70743041db9ad6158db4f56d6e3be2aaa63b0b4ddd625600692ed354a56a` |
| `crates/rh-sim/src/replay.rs` | `3cd4311744b37dba6460b18fd43f64fdb60eb937d02f30c0d9744561feeefcff` |
| `crates/rh-headless/src/lib.rs` | `53968ce2a35f0ccca14afdb2c3d474e09608d054e52a21d676064a21f0714a31` |
| `crates/rh-policy/src/lib.rs` | `bd1fadc1a18598bbd2f621a4062120942aa2ab98265126854971033a7d0ec7f4` |
| `crates/rh-sim/tests/content.rs` | `28f9ed93c66a58be63f02f8b285230eccfdeefb75428312fa2c5c2fd87da7a13` |
| `crates/rh-sim/src/systems/potions_tests.rs` | `fc683207afceb3f6c19657eb0350b07ac9eb3c9af31a0f20622b1550dacf6167` |
| `crates/rh-sim/src/systems/signatures/pve_tests.rs` | `20cd7955747fa1eff98b83db0fdbdf71a2fe03fee72aef0e95cfbb38b1df09dc` |


---

# First playable transport — focused independent review

**Decision: no current concrete blocker found.** Read-only static review of the integrated transport additions over the previously accepted protocol6 transport. No source edits, builds or tests performed. Main opt-in runtime proposals are excluded.

Verified cross-file seams:

- Commands 9/10/11 consistently mean UseConsumable, nonzero u32 Target reference, and AttackMove with the Move payload/optional sequence. Rust, C# and JS encoding/decoding agree. `wire.rs:15–43` retains public proposals; `room.rs:593–605` resolves through the seat ItemObserver, then records/submits the validated private command. There is no private-ID fallback for Target. Existing command8 choice handling remains connected to the reward observer.
- Potion notices map exhaustively to codes 1–7 at `wire.rs:228–238`; all inspected decoders enforce that range. Counts retain the five-stock/three-active bounds and self-only collection placement.
- Mob type and signature fields agree across Rust Full/delta encode, decode and application; C# and JS mirrors use matching field bits and explicit zero clears. Actor mob type uses zero=none / one-based type; camp base type is direct 0–29 and elite uses zero=none / one-based type. Snapshot actor cache equality includes both additions. C# stable views copy the new fields; its Unity copies are byte-identical for all seven inspected modified delivery files.
- State keys 6 and 7 are complete replacements for camps and projectiles. Publishers emit ascending keys; decoders bound seven keys and 512 rows, reject malformed shapes before client application, preserve absent keys and accept empty-row clears. Duplicate projectile facts remain valid. `wire_state.rs:179–205,230–237` advances baselines only on commit. C# full-state readiness now requires all seven keys, and collection application retains socket order rather than filtering by snapshot tick.
- `wire.rs:424–433` sends raw earlier filtered events through prepare_with_seen once and clears the carry before frame assembly. `room.rs:1047–1058` commits the collection baseline and observer offer only after accepted combined enqueue. Reconnect clears carry and restarts both observers/baselines; client Welcome clears collections, snapshots, unsent commands and interpolation. The existing accepted private Sim command queue is preserved across ordinary Resume.
- Confirmed the current root already reserves `u32::MAX` from NPC issuance (`actor_refs.rs:185–186`), matching Hit/Block's redacted-source sentinel. An initial concern based on the older frozen observer bound was withdrawn after reading this repaired root condition; it is not an outstanding finding.

Scope/evidence limits: this is a focused interaction review, not a fresh certification of the complete protocol, actor projection or gameplay packages. Existing core projection acceptance and earlier transport review remain the basis for their unchanged behavior. Coordinator-supplied results were 266 C# / 15,377 JS plus 61 focused checks, with worker 80 protocol / 21 server checks; these were not rerun here. Existing deliberate omissions of SignatureHit/Heal and ability/cancellation event telegraphs are unchanged scope, not newly added mirror mismatches. Final gameplay runtime activation and its selected map/admission profile were not inspected.

## File identity

Hashes were sampled when saving this report from the concurrently edited root. They identify the targeted sections/files inspected, not an immutable whole-repository checkpoint or full-file certification. Unity mirror equality was checked directly without building.

| Inspected root file | SHA-256 |
| --- | --- |
| `crates/rh-server/src/wire.rs` | `1521148f4f8490e7cbfecc945ea4f390d587e74bc57d45a4d9de5cde9df12faa` |
| `crates/rh-server/src/wire_state.rs` | `e20d5158980a8e400c8b6399dd4b86710e1874f7bec5e29b6d19e15bc66b6475` |
| `crates/rh-server/src/room.rs` | `f9254c34dc8e3ccc3cbf35b79ec73f4703bce8597b5e92eeb2393446d4d802eb` |
| `crates/rh-protocol/src/lib.rs` | `18610f4a89f68ade6472221651f53cff0718de09e673c1860fce2eb97aedac4e` |
| `crates/rh-protocol/src/encode.rs` | `69195011efcbf1939b164587cc3dbd9878d2027b3a2495a05bca0b879fe7e16f` |
| `crates/rh-protocol/src/delta.rs` | `6ac31f873b7ba6302faea573e0142db3504a5fba83400db6bf0815824e26a333` |
| `crates/rh-protocol/src/state.rs` | `0392eff9f98d66b98b9744919d76780bfa3c23709b203f608ff230ac27c93721` |
| `crates/rh-sim/src/actor_refs.rs` | `4ca1467c6e537991a31b7cefbd0173b14fdecfa0490e09cab9b4247388125dee` |
| `crates/rh-sim/src/actor_refs/tests.rs` | `3ff6c22574e2a61b5832beb9740646a71f47d23e3ff4befe3dbe2dfbe0c56522` |
| `client-unity/RoguehallaNet/Protocol/Messages.cs` | `9d8e48cd537dbb27a559c3f9fd65b6713c50745913c3b1f4eb88074914374e9b` |
| `client-unity/RoguehallaNet/Protocol/State.cs` | `0b6db0b46de55acae6ae4b49f400d61f0f2245b3b45a43f13dbf3d03462d3fa7` |
| `client-unity/RoguehallaNet/Protocol/SnapshotTracker.cs` | `25122b4bf32a43912534116d6b29929346e1890cf141f05c7d25c517ffc1b8e2` |
| `client-unity/RoguehallaNet/Net/Collections.cs` | `66ed94bfbf551a1676b027742435bd657eb6ab70cee60b89d871ed28fe58ff2a` |
| `client-unity/RoguehallaNet/Net/InputSender.cs` | `f1aabcf55d11e41f757b6914b6dc94c11e5a9b9fc0353e5de193694cb80561cb` |
| `client-unity/RoguehallaNet/Net/SnapshotBuffer.cs` | `aa1e17af6bbf1854d791320c4e768509b7b6b5ad02e21a842219c827a6b68750` |
| `client-unity/RoguehallaNet/Net/Views.cs` | `38e190aec18cf43644f9fb8004e288d046dce029572f3cf3c49765c341983f04` |
| `client-unity/RoguehallaNet/Net/Session.cs` | `5df8a1abec65709118dfe3fb396291c755da7aca19ef1af3f2f2865150c2d0c2` |
| `crates/rh-server/web/probe.html` | `4b9c14593a76e7a3eb2322b2a313e5fb70a4b8098637f538fb11d536a6730dee` |
| `tools/protocol-js/check-vectors.mjs` | `5b12e80fa158eb44a3cf5c96d86649104758e96f0c998986478b3876461923aa` |
| `tools/protocol-js/check-first-playable.mjs` | `ed05e14b6fee1c9f5c6bd8fe0bdd92797c6c14c89e1290ab538396b238bd033b` |
| `client-unity/UnityProject/Assets/RoguehallaNet/Protocol/Messages.cs` | `9d8e48cd537dbb27a559c3f9fd65b6713c50745913c3b1f4eb88074914374e9b` |
| `client-unity/UnityProject/Assets/RoguehallaNet/Protocol/State.cs` | `0b6db0b46de55acae6ae4b49f400d61f0f2245b3b45a43f13dbf3d03462d3fa7` |
| `client-unity/UnityProject/Assets/RoguehallaNet/Protocol/SnapshotTracker.cs` | `25122b4bf32a43912534116d6b29929346e1890cf141f05c7d25c517ffc1b8e2` |
| `client-unity/UnityProject/Assets/RoguehallaNet/Net/Collections.cs` | `66ed94bfbf551a1676b027742435bd657eb6ab70cee60b89d871ed28fe58ff2a` |
| `client-unity/UnityProject/Assets/RoguehallaNet/Net/InputSender.cs` | `f1aabcf55d11e41f757b6914b6dc94c11e5a9b9fc0353e5de193694cb80561cb` |
| `client-unity/UnityProject/Assets/RoguehallaNet/Net/SnapshotBuffer.cs` | `aa1e17af6bbf1854d791320c4e768509b7b6b5ad02e21a842219c827a6b68750` |
| `client-unity/UnityProject/Assets/RoguehallaNet/Net/Views.cs` | `38e190aec18cf43644f9fb8004e288d046dce029572f3cf3c49765c341983f04` |

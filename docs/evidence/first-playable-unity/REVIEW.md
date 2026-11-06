# First-playable Unity independent static review

Reviewed 2026-11-06, read-only. Scope: the six UI proposal files and three view overlay files, with focused current-root input/session/server-rule seams. No source edits, builds, browser runs, security probes, or repeated corpus tests. Producer reference-compilation evidence was supplied; actual Unity/TMP import and Editor/Web proof remain coordinator work, not asserted by this report.

## Findings

1. **Resolved in root — P2, frozen wand click targeting immediately cancels itself.** `playable-unity-ui/proposal/client-unity/UnityProject/Assets/Scripts/Net/MatchClient.cs:123–125` queues `Target(target)` and then unconditional `Attack(...)`. Current root `client-unity/RoguehallaNet/Net/InputSender.cs:37,76` retains both in order; `crates/rh-sim/src/systems/weapons.rs:30–32` drops the lock on Attack. The targeting handler (`systems/targeting.rs:72–119`) already establishes server pursuit/firing, so the paired attack defeats the new click-target control. Minimal repair: make valid wand Target and manual Attack mutually exclusive; set `_attackHeld` only for manual Attack. Preserve existing release forwarding for an actual manual press.

2. **Resolved in root — P2, cleared inventory leaves old slot/potion labels.** `playable-unity-ui/proposal/client-unity/UnityProject/Assets/Scripts/UI/MatchHud.cs:203–213` updates only when `Inventory.HasValue`, with no null branch. `Bind` clears labels on explicit new sessions, but reconnect retains this HUD binding; current-root `Session.cs:377` resets collections on Welcome without emitting `CollectionsChanged`, and `MatchHud.cs:146` only dirties the HUD on state change. Thus old labels survive the reset window, and an authoritative null inventory cannot clear them. Minimal repair: clear cached inventory and labels when inventory is absent, and refresh collection presentation on the Welcome/reconnect reset (a session reset notification or equivalent state-transition refresh). Do not infer inventory from actor weapons or old labels.

Root follow-up: inspected applied `Net/MatchClient.cs:123–129`; valid wand targeting now sends Target only, and manual Attack plus `_attackHeld` occurs only in the else branch. Finding 1 is resolved by static verification. Finding 2 was subsequently resolved; see final close-out below.

## Accepted within scope

- Input remains server intents: no new client combat, AI, physics, or movement prediction. Current `LocalMotion` remains snapshot-only. Pickup/reward actions use typed current collection handles; wand hit testing uses newest delivered actor references rather than interpolated historical NPC labels.
- Pointer gating separates UI input from world intents. A real held manual attack releases even after pointer entry into UI. Explicit leave/rejoin resets local input state; disconnect/resume server trigger release was checked in `Sim::mark_dropped`. No additional held-input blocker identified.
- View meshes consume delivered sampled actors and delivered collections only. Actor geometry is rebuilt from the sampled set; there is no hidden actor registry or private spawn allocation. Collection geometry follows collection replacement; projectile rows are presentation, not simulated travel/damage. Retained mesh/list storage avoids per-row actor objects; no new pooling/lifetime blocker found.
- The proposed assembly adds the required UI/TMP references. No independent compile failure identified by static reading.

## Optional server adoption spot-check

Read only frozen `first-playable-adoption-work/freeze-v1/files/crates/rh-server/src/main.rs` flag validation, profile configuration, and lifetime/drain paths. The opt-in profile pins the embedded map hash and eight-seat constant, validates min/fill counts and finite nonnegative timing, enables initial loot/PvE/supported faction mode together, requests drain at process-entry + four hours, and independently exits at four hours + 180 seconds. No new blocker found in those paths. This is not a renewed proof of the documented cumulative loot capacity calculation, map source parity, deployment spool behavior, or actual runtime timing.

## Exact inspected bytes

Paths below are absolute; hashes identify pre-repair proposals and current dependencies at this review. UI proposal copies outside the six declared changed files were not reviewed as changes.

- `3996faef02ee8b825d734e7398ced4b3f5cc4198b4a960203369ef099dc0d05d` — `/Users/nevinmckinnon/.codex/tools/rougehalla-stage2/playable-unity-ui/proposal/client-unity/UnityProject/Assets/Scripts/Bootstrap.cs`
- `90603e83196cc772c9b741c46a4876afa6d4759a152408fd7b9cccec31265e22` — `/Users/nevinmckinnon/.codex/tools/rougehalla-stage2/playable-unity-ui/proposal/client-unity/UnityProject/Assets/Scripts/Net/MatchClient.cs`
- `d752171830ce052943b907d34e762e84ff7c9778f3c6d1a2f4d29f9d9f2688d6` — `/Users/nevinmckinnon/.codex/tools/rougehalla-stage2/playable-unity-ui/proposal/client-unity/UnityProject/Assets/Scripts/Roguehalla.Client.asmdef`
- `836efbb179eb324042d1a80f14a36c315ffa0b288805c5b95433384ab4087ad8` — `/Users/nevinmckinnon/.codex/tools/rougehalla-stage2/playable-unity-ui/proposal/client-unity/UnityProject/Assets/Scripts/UI/MatchHud.cs`
- `baa448b1aa9d0b05fcfd930558ddb7a376e91f0128baa7ad7c6c4456947b590e` — `/Users/nevinmckinnon/.codex/tools/rougehalla-stage2/playable-unity-ui/proposal/client-unity/UnityProject/Assets/Scripts/UI/MatchHud.cs.meta`
- `7de34f0768160ab6a274ad591124aed9b6d4990d563d36eb73221e5a14def82c` — `/Users/nevinmckinnon/.codex/tools/rougehalla-stage2/playable-unity-ui/proposal/client-unity/UnityProject/Assets/Scripts/UI.meta`
- `48a21b1dab4f3d7e85e090f5ae80fa53ee3694d9114731ef31747d6647e905f3` — `/Users/nevinmckinnon/.codex/tools/rougehalla-stage2/playable-unity-view/overlay/client-unity/UnityProject/Assets/Scripts/View/ArenaView.cs`
- `7ff6b5a6242d05cce62663026a328e85b859cd76ce4c7b8f874b75a30bd4a830` — `/Users/nevinmckinnon/.codex/tools/rougehalla-stage2/playable-unity-view/overlay/client-unity/UnityProject/Assets/Scripts/View/ActorView.cs`
- `c6e74906c07254f88dc099132e21eee42dd4899b45bc766094051dc84e77a829` — `/Users/nevinmckinnon/.codex/tools/rougehalla-stage2/playable-unity-view/overlay/client-unity/UnityProject/Assets/Scripts/View/MeshUtil.cs`
- `5df8a1abec65709118dfe3fb396291c755da7aca19ef1af3f2f2865150c2d0c2` — `/Users/nevinmckinnon/.codex/worktrees/rougehalla-stage2-managed/RougeHalla/client-unity/RoguehallaNet/Net/Session.cs`
- `f1aabcf55d11e41f757b6914b6dc94c11e5a9b9fc0353e5de193694cb80561cb` — `/Users/nevinmckinnon/.codex/worktrees/rougehalla-stage2-managed/RougeHalla/client-unity/RoguehallaNet/Net/InputSender.cs`
- `30bbacefd4cc8795027caccbd45c0e3d1581b5d607c816e301a4487e803f93a2` — `/Users/nevinmckinnon/.codex/worktrees/rougehalla-stage2-managed/RougeHalla/client-unity/RoguehallaNet/Net/LocalMotion.cs`
- `83edeea57b9a8453cc33072b307cead41bd939f640a6cd46f17ac317a2ba2bd6` — `/Users/nevinmckinnon/.codex/worktrees/rougehalla-stage2-managed/RougeHalla/crates/rh-sim/src/systems/weapons.rs`
- `66cc30e271e65a4e2d29aef887d3d3bd99b8d993f6068cad2cf727370cc7399e` — `/Users/nevinmckinnon/.codex/worktrees/rougehalla-stage2-managed/RougeHalla/crates/rh-sim/src/systems/targeting.rs`
- `1c180c825a1c6640f48327d4a5c06c5296e9bb81f07b1e1b7e00eb00bb13baed` — `/Users/nevinmckinnon/.codex/worktrees/rougehalla-stage2-managed/RougeHalla/crates/rh-sim/src/sim.rs`
- `537abc1bb0c34cdc31953286f295f6a5ca5060d787002322bf29a73ba8d16b7a` — `/Users/nevinmckinnon/.codex/tools/rougehalla-stage2/first-playable-adoption-work/freeze-v1/files/crates/rh-server/src/main.rs`
- `c92c24f31482e8cc6d4c13497faab74f130650816f49c978974f19f01265c83f` — `/Users/nevinmckinnon/.codex/worktrees/rougehalla-stage2-managed/RougeHalla/client-unity/UnityProject/Assets/Scripts/Net/MatchClient.cs` (root follow-up)
- `836efbb179eb324042d1a80f14a36c315ffa0b288805c5b95433384ab4087ad8` — `/Users/nevinmckinnon/.codex/worktrees/rougehalla-stage2-managed/RougeHalla/client-unity/UnityProject/Assets/Scripts/UI/MatchHud.cs` (root follow-up)

## Final focused close-out — 2026-11-06

Both findings are resolved in the inspected root bytes. No additional concrete blocker found in these repairs.

- `MatchHud.cs:145` now refreshes collections on session state changes. `Session.OnWelcome` resets collections before changing to InMatch, so reconnect refresh sees the cleared state. `MatchHud.cs:203–209` clears the cached inventory, both slot labels, and potion label when inventory is absent.
- `MatchClient.cs:123–134` keeps Target exclusive from manual Attack and now handles a press/release occurring in one Unity frame inside the manual branch, sending Attack then Release and clearing `_attackHeld`. Target clicks do not acquire manual held state.
- `Session.cs:148–157` sends Leave once from InMatch or from Ended with an existing Welcome, so server MatchEnded no longer prevents releasing the resolved seat. `_leaveSent` suppresses duplicate sends; Connect resets the latch. The library and synced Unity `Assets/RoguehallaNet/Net/Session.cs` are byte-identical.

This close-out used static reads and byte comparison only, without builds or tests. Coordinator reports actual Unity Web attempt 4 passed choice/build, results, reconnect, leave/fresh rejoin, and zero-error checks; 267 library tests including the leave regression passed. Those are coordinator execution evidence, not independent reruns. Earlier view and optional main-profile scope/limits stand.

Final root SHA-256 values (supersede historical root follow-up hashes above):

- `404178b90503b7d84d8e9545150015a380d33882bc95afae4315abbf89f5e65c` — `/Users/nevinmckinnon/.codex/worktrees/rougehalla-stage2-managed/RougeHalla/client-unity/UnityProject/Assets/Scripts/UI/MatchHud.cs`
- `68d76355a9374284863e638c046faa9a15f5b59a5fadbadbe1ce071d9d79fa95` — `/Users/nevinmckinnon/.codex/worktrees/rougehalla-stage2-managed/RougeHalla/client-unity/UnityProject/Assets/Scripts/Net/MatchClient.cs`
- `4edf96731962e2296a845e4c31f389d3a08b0122da318eaef03e179b644efcef` — `/Users/nevinmckinnon/.codex/worktrees/rougehalla-stage2-managed/RougeHalla/client-unity/RoguehallaNet/Net/Session.cs`

The final Session hash also applies to `client-unity/UnityProject/Assets/RoguehallaNet/Net/Session.cs`.

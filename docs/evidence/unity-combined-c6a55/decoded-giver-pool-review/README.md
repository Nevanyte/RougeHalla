# Decoded neutral giver and pooled actor Unity review

Exact source **`c6a55d3d68d0023e60ace98b55fd23f581217b38`**, Unity **6000.0.85f2**, URP **17.0.4**, sole existing Editor PID **9075**. This is the coordinator-released private protocol-14 composition. No product source or asset import was changed during this gate.

## Results

- Actual project compilation completed with no errors. The single full existing Editor suite passed **85/85**, with no failed, skipped or inconclusive tests.
- An external public-API script completed **53/53 assertions**, using `ServerMsg.Snapshot.Encode → ServerMsg.Decode → SnapshotBuffer.Add/Sample → ArenaView.RetainObservedActors/Present`. Renderer inputs were sampled decoded frames, not hand-constructed `InterpActor` values. Six original encoded frames are retained.
- A Fire/sword fighter visibly selected its catalog attack after a confirmed Swing. Empty delivered membership removed its handle, sound context and confirmed flash and hid its pooled root. The subsequent giver used the **same root instance** with wire **kind 4 / kit FF / mob 0**, nullable faction/weapon/mob, exact neutral silhouette, diamond footprint and generic insignia. Weapon renderer was disabled with null sprite, and `TrySoundContext` returned false.
- A zero-barrier/ring/signature giver first proved those former fighter cues were cleared. A separate explicit synthetic payload with HP 82%, barrier 35%, ring 4 and signature bits 1+2+64 proved the delivered cues remained visible. A deliberately injected giver Swing did not replace its neutral body with a fighter attack. The existing generic confirmed-FX rim is visible in this diagnostic image; it is not a weapon, an autonomous attack or an audio event.
- After a second empty frame, the **same root** became a Frost/bow fighter. Its body was an idle catalog frame, its weapon and sound context matched the new delivered identity, and the previous giver signature bits did not persist. Current barrier/ring values replaced the prior ones.
- Each active stage retained the exact delivered ground anchor **(20, −10.92, 0)** and root scale **(1.2, 1.2, 1)**. Both native screenshots were captured at frame end with matching **Screen, texture and Canvas dimensions of 2560 × 1440** and advancing frames. Original PNGs were neither resized nor edited. The orthographic camera size is 9.

The captures visibly say **STAGED DECODED-WIRE PRESENTATION REVIEW / NO NETWORK**. These are legal synthetic wire payloads presented by the actual Editor. They are not a native server, AI/WSS/network, quest interaction, Web/browser, public hosting or performance proof. In particular, the nonzero giver barrier case verifies the client renderer's handling of delivered facts; it does not claim that current Rust gameplay emits those exact values. The giver body remains the existing neutral placeholder, not newly completed character art.

## Evidence

- `editmode-prefix.json`: complete actual Editor runner results.
- `harness-checks.json`: all public assertions and same-root receipt.
- `decoded-giver-review.cs`: exact external runtime review script; never installed in the Unity project.
- `wire-100.bin` through `wire-105.bin`: ordered fighter, empty, zero giver, synthetic marked giver, empty, recovered fighter frames.
- `fighter-before.json`, `giver-zero-after-fighter.json`: intermediate public renderer receipts.
- `decoded-giver-native.png` / JSON and `reused-fighter-native.png` / JSON: two native screenshots and renderer/bounds receipts.
- `PRESENTER_ASSERTIONS.md` / `PUBLIC_WIRE_HARNESS_NOTES.md`: Luna read-only source audits. The latter describes an additional Session/transport approach and golden vector; that alternate approach was not executed by this harness.
- `VISUAL_QA.md`: independent Luna inspection of the two captured outputs.

No compiler/runtime error was returned in the valid gate. Console evidence retains existing obsolete-API warnings and the intentional missing-point-light warning from its negative test. The final native console counter reports two warnings, so this is not a claim that all project warnings are eliminated. A separate shell status call used unsupported CLI attribution flags and was rejected before contacting the Editor; the ordinary public status command was then used successfully. It did not change project state or tests.

## Source and restoration

All **1,108 tracked Unity project files** were hash-identical from pre-test through post-capture. The sole disk difference against exact source was Unity's known two trailing spaces on blank ShaderGraphSettings keys. That overlay was retained and the exact HEAD bytes restored. Runtime source, scenes, packages and assets remain unchanged.

Public InputSettings snapshots before and after tests and after cleanup preserve the same instance id, `HideAndDontSave`, update mode and background behavior. Final state is Play off, both background flags false, auto-tick off, text scale 1.0 with no stored preference key. Native UI observation confirmed QHD 2560 × 1440 at scale 0.28. No custom resolution preset was added. No second Editor was launched.

No queued art/audio import, new UI leaf, server, Web build, cloud, shared migration status or protocol source change is included. The new larger-minimap/translucency/health-position UI request remains a separate, unreleased candidate. Queued asset preparation and live gameplay integration remain separate milestones.

# Bounded lighting and faction-readability repair

Lead scope, 2026-11-08. The art lane works only in its isolated `RogueHalla-unity-art` checkout and reports immutable
commits for review. Primary `optimization_port`, its detached managed snapshot, shared status records and net sources
remain lead-owned. This packet follows the accepted `a401a510` handoff and the central notice-name fix `717fe5c0`.

## Observed problems

Pinned URP 17 defines `Light2D.NormalMapQuality` as Fast=0, Accurate=1, Disabled=2. The accepted Torch resource has
quality 2 and no production setter enables it. Procedural stone/floor secondary textures exist, but the earlier A/B
experiment forced light settings. It proves texture response only in that altered setup. Record this limit explicitly;
do not relabel the accepted `ebff286b` build as having shipped normal lighting.

Rendered CVD review found that several faction colors converge and the existing insignia are too small for reliable
quick classification. The review is completed with findings, not an accessibility PASS. Hue remains a supporting cue.

## Authorized implementation

Keep independently reviewable commits for the notice formatter, lighting repair and faction-readability repair; then
make one combined Web candidate to avoid repeated unchanged builds.

- The notice formatter displays the ten already-delivered native notices, using native message wording and the named
  view codes. Unknown values get a neutral fallback. It derives no health, eligibility, duration or game outcome.
- Enable Accurate normals on existing point lights at effective High only. Keep Medium/Low normals Disabled and leave
  the global ambient light alone. Cover resource instantiation, already-created map lights after tier changes, and the
  existing local-player accent. Preserve visibility removal and pooled teardown.
- Pinned URP 17 exposes normal quality/distance as read-only at runtime. Retain the Disabled Torch preset and author an
  otherwise matching Accurate preset. A small presentation helper may instantiate both once per existing light anchor
  and enable exactly one according to effective quality and owner visibility. Reuse them through pooling; do not add
  active lights or destroy/recreate components per frame. The local accent remains High-only. No reflection, patched
  package or player-side UnityEditor API is allowed. Avoid briefly enabling both variants during initialization/switches.
  Apply each anchor's runtime color, intensity, radii, falloff and existing shadow policy to both variants before
  switching; never restore prefab defaults when a quality tier changes. Preserve the existing per-tier active budgets.
- Use the existing tracked authoring script to reproduce both presets via serialized enum numeric values, not
  `enumValueIndex` (the enum declaration order differs from its byte values). Test the real deserialized getter. The
  deprecated `m_UseNormalMap` flag only controls an old-version upgrade; writing it alone does not configure this API.
  Missing/misconfigured presets fail asset validation. At runtime, leave a missing optional accent disabled with a
  bounded diagnostic and preserve ambient/essential art; do not silently claim High normal lighting via a Disabled
  `AddComponent` fallback. Do not override the shared lit material with one global floor normal texture: procedural
  stone/floor sprites already bind their own linear `_NormalMap` secondary texture.
- Enlarge the existing five faction insignia with a high-contrast backing and use distinct footprint geometry per
  delivered faction. Keep these essential, unlit cues at every quality tier and in reduced motion. Keep them clear of
  health bars and character silhouettes, with stable pooling and no per-frame texture creation. Unknown faction values
  receive a neutral presentation. The staged five-faction lineup remains a staged study, not live roster evidence.

Writable runtime scope: `ShowcaseSprites.cs`, `SpriteActorPresenter.cs`, `ArenaView.cs`, `MatchHud.cs`, a small
`ShowcasePointLight.cs` helper, the native-notice formatter, the two Torch preset assets and their metadata, and the
existing tracked showcase authoring script. Focused presentation tests and art documents/evidence may change.
Preset components may increase the inactive component count only; record active counts separately. No changes to active light count, radii, shadows or pipeline/render-scale settings,
protocol/codec/prediction/simulation edits, gameplay inference, new purchases or deployment belong to this packet.

## Success and failure lines

1. Focused Editor checks must load the real Torch resource and exercise High→Medium→Low→High on actual created map
   lights and local accents, with exactly one enabled variant per enabled anchor and none for removed actors. Check
   missing-resource handling and actual preset existence/configuration. They must also preserve essential faction cues
   and current actor removal at lower quality/reduced motion. Run the affected presentation suite once after the final code changes.
2. A visual normal-input comparison must use the final candidate's shipped High settings, without forcing light quality
   from the probe. Use independent primary textures for flat/relief controls to avoid the observed Unity cache artifact;
   preserve identical albedo. Record the exact runtime/settings and changed pixels. A resource flag alone is not proof.
3. Review the revised staged five-faction lineup and an actual server-fed scene in grayscale and protan/deutan/tritan
   simulations at game scale. Record remaining ambiguity/occlusion. Do not infer untested faction or full-game coverage.
4. Build once from the final verified runtime, pin its distribution manifest and run the existing required browser
   proof, including readable authoritative potion feedback. Keep the earlier build's evidence separately identified.
5. Repeat three warmed, approximately 15-second native eight-seat combat windows at Manual High, motion on, actual
   2560×1440 backbuffer and render scale 1. Record settings, observer counts, CPU/GPU distributions, errors and memory.
   Compare with retained High evidence, while disclosing workload/host differences. Do not repeat the unchanged full
   nine-window campaign by default. Use the 6.944 ms GPU p99 frame budget as a diagnostic hold: an exceedance, missing or
   disjoint GPU measurements, errors, or an unverified quality/backbuffer setting requires reporting the failure before
   admission. Do not silently disable normals, lower resolution/quality, select only passing windows or relax the goal.

Independent read-only review confirms the preset approach and existing secondary-texture binding; the GPU gate remains
conditional on the new candidate's actual measurements.

The physical display remains 1920×1080/60 Hz. Passing these software checks does not certify displayed 144 FPS, native
1440p/fullscreen, managed allocation throughput, total browser/GPU memory or complete art/gameplay/accessibility.
If the new GPU cost exceeds the diagnostic budget, stop at the verified commit and propose a bounded optimization;
leave that candidate isolated. The original accepted functional build remains available for comparison and rollback.

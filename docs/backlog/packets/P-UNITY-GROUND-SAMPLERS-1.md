# P-UNITY-GROUND-SAMPLERS-1: the ground shader compiles for the Web target, so the Web build script finishes

- **Serves:** the finish steps of the owner's plan (a Web build, the browser proof, the beta host); screenshot round 9
  (2026-11-13, Web build of `1ac2b2a76`), defect 5
- **Implementer tier:** implementer-sonnet (Unity shaders)
- **Reviewer:** reviewer
- **Integration base:** feature/unity-rework
- **D-rules touched:** D1 n/a (presentation) · no wire change

## 1. ID and outcome
`client-unity/UnityProject/Tools/build-web.sh` ended with exit 1 in round 9. Unity reported `Build Finished, Result:
Success` and wrote a player that ran, but the script's check of the build log found:
`Shader error in 'Roguehalla/RegionGround': maximum ps_5_0 sampler register index (16) exceeded at
Assets/Resources/Regions/RhLocalLights.hlsl(23) (on gles3)`. One variant of the ground shader uses more than 16
samplers on the WebGL 2 target and is missing from the player; the ground drew normally in the session, so the variant
that failed is one the session did not hit (the round's guess: the one with the most local lights). The script's later
checks (the licence copy, the audio check) did not run. Round 8's build of `86806e01` finished clean, so a texture
added to the ground since then (ground variants, the Plague texture, the patience or landmark work) took the count
over.

When this lands: every variant of `Roguehalla/RegionGround` (and of the other shaders under `Assets/Resources/Regions/`)
compiles for GLES3 with no error; `build-web.sh` exits 0 on this tree; nothing looks different on the desktop targets.
The usual remedies, in order of preference: share one sampler state among the ground's textures
(`SAMPLER(sampler_linear_repeat)` style inline samplers, or `Texture2D` with a shared `SamplerState`), pack two masks
into one texture's channels, or drop a texture the Web variant does not need. Not acceptable: stripping the failing
variant so the error disappears while the feature it draws silently vanishes on the Web.

## 2. Dependencies
none

## 3. Relevant legacy paths
none

## 5. Exclusive write scope
- `client-unity/UnityProject/Assets/Resources/Regions/RegionGround.shader`, `RhLocalLights.hlsl`, `RhSun.hlsl`
- `client-unity/UnityProject/Assets/Scripts/View/Regions/RegionGround.cs` (only where it binds the ground's textures)
- not `Tools/build-web.sh` (its check is right), not any existing test

## 7. Behaviour to preserve
- The ground looks the same in every zone (the capture tool's zone scenes before and after), local lights still light
  the ground, the ground variants and the Plague texture still draw.

## 8. Acceptance checks
- EditMode: compiling `Roguehalla/RegionGround` for the GLES3 platform yields no error message for any variant the
  build includes (the oracle author finds the editor API that does this without a graphics device, e.g.
  `ShaderUtil` compile-for-platform plus `ShaderUtil.GetShaderMessages`; if no API can, the oracle is a source rule:
  the number of sampler states the fragment stage can reference in one variant is at most 16, counted from the shader
  and its includes, with the count written in the failure message). Red today.
- The coordinator runs `Tools/build-web.sh` on the merged tree: exit 0.
- `scripts/gate.sh --quick --oracle packet/P-UNITY-GROUND-SAMPLERS-1` passes.

## 9. Validation commands
- `bash client-unity/UnityProject/Tools/editmode.sh`; then `git checkout --` any modified font asset under
  `client-unity/UnityProject/Assets/Resources/Showcase/`.
- A Web build needs a running `rh-server` for the content hash (`RH_SERVER_INFO_URL`); the implementer is not asked to
  run one.

## 10. Risk and suggested model tier
Sonnet. Shader work that cannot be seen in EditMode: the coordinator's capture tool and a Web build are the check.

## 11. Known traps
- URP's 2D light textures (`_ShapeLightTexture0..3`) and the lighting includes bring their own samplers: count them.
- `RhLocalLights.hlsl` is included by other shaders (`RegionSpriteLit`, `RegionActorLit`, `RegionLitMesh`): a change
  there must compile in all of them.

## Notes from previous attempts

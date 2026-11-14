# P-UNITY-GROUND-SAMPLERS-1: the ground shader compiles for the Web target, so the Web build script finishes

- **Serves:** the finish steps of the owner's plan (a Web build, the browser proof, the beta host); screenshot round 9
  (2026-11-13, Web build of `1ac2b2a76`), defect 5
- **Implementer tier:** implementer-sonnet (Unity shaders)
- **Reviewer:** reviewer
- **Integration base:** feature/unity-rework
- **D-rules touched:** D1 n/a (presentation) · D2 n/a · D5/D6/D9 none · no wire change
- **Write scope:** section 5 (the three Regions files and `RegionGround.cs` where it binds textures)

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

## Oracle files (read-only for implementers)
- `client-unity/UnityProject/Assets/Tests/Editor/RegionShaderWebCompileEditModeTests.cs` (+ `.meta`)

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

## Established facts (oracle author, 2026-11-13)

**1. The sampler count.** The fragment stage of `Roguehalla/RegionGround` declares, in every variant:
- in `RegionGround.shader:62-70`, nine texture + own-sampler pairs: `_GroundTex`, `_GroundNrm`, `_RegA`, `_RegB`, `_TerA`, `_TerB`,
  `_PlgTex`, `_VariantTex`, `_TempleTex`;
- in `RhSun.hlsl:7-9`, three: `_RhRegA`, `_RhRegB`, `_RhShadowMask` (the fog texture `_RhFogTex`, `RhSun.hlsl:94`, already
  shares `sampler_RhRegA`, the earlier fix `bd4c49cd4`, so it adds none);
- in `RhLocalLights.hlsl:23`, one: `TEXTURE2D(_RhShadowAtlas); SAMPLER(sampler_RhShadowAtlas);` (the line the error names; it is
  the declaration the compiler is on when it runs past register 15, not the cause);
- that is 13 fixed. URP then adds, per enabled `USE_SHAPE_LIGHT_TYPE_n` keyword (`SHAPE_LIGHT(n)`,
  `LightingUtility.hlsl:69-72`, instantiated at `RegionGround.shader:72-83`), `_ShapeLightTextureN` + `sampler_ShapeLightTextureN`.
  The `#pragma multi_compile USE_SHAPE_LIGHT_TYPE_0..3 __` of `ShapeLightShared.hlsl:4-7` makes 16 variants (the build log:
  "Full variant space: 16"). `CombinedShapeLightShared.hlsl` and `Core2D.hlsl` declare nothing more; `_NormalMap` and `_ShadowTex`
  of `LightingUtility.hlsl` are macros this shader does not instantiate.
- Total per variant: 13 + the number of shape light keywords on. **Only the variant with all four on has 17**, one over the limit
  of 16; the variants with three or fewer (16 or less) compile. Measured, not just counted: see fact 4.

**2. What took it over.** Round 8 (`86806e01`) had 12 fixed + 4 = 16, exactly the limit. `6f0915ecb` (P-UNITY-DRESS-1, "ground
variant look") added `_VariantTex` + `sampler_VariantTex` (`RegionGround.shader:69`, sampled at `:565`, bound at
`RegionGround.cs:76-79`): 13 fixed, 17 in the all-lights variant. Nothing else changed in `Resources/Regions/RegionGround.shader`,
`RhSun.hlsl` or `RhLocalLights.hlsl` since `86806e01` (`17017be41` only changed the tint maths).

**3. What the missing variant draws.** Nothing the game reaches today. The 2D renderer data (`Assets/Settings/Roguehalla2DRenderer.asset`)
defines four light blend styles and Unity selects `USE_SHAPE_LIGHT_TYPE_n` for the styles that have a Light2D in view; the game's lights
use style 0 and 2 (`ShowcasePointLight.SetBlendStyle`, comment at `ShowcasePointLight.cs:63-64`), so a frame asks for one or two of the four
keywords, never all four. The all-four variant is a build-time permutation that no frame of the shipped game selects, which is why the
round's browser session drew the ground normally with no console error. Local lights, ground variants and the Plague texture do not
depend on it: they live in the other 15 variants, which compiled (the log: "gles3 (total internal programs: 15, unique: 15)" after
the error). Round 9 `52-sentenced-grounds-lamp-light-tiles-ruin-walls-pardoners.png` is not evidence of its absence: the lamps lighting
the ground there come from the analytic `_RhLP/_RhLC` field in `RhLocalLights.hlsl`, which every variant includes. So the Web player lost
nothing visible, and the defect is the build script's exit code plus a latent hole (a scene that did use four blend styles on the Web would
have no compiled ground variant; not tested). The brief's "stripping the variant is not acceptable" stands: the clean fix
removes a sampler, it does not remove the variant.

**4. The editor API (answers the brief's section 8 question: yes, it works in EditMode, with `-batchmode -nographics`).**
`UnityEditor.ShaderUtil.CompileShaderVariant(shader, subShader, pass, ShaderType, platformKeywords, keywords, ShaderCompilerPlatform.GLES3x,
BuildTarget.WebGL, GraphicsTier, outputForExternalTool)` is internal in Unity 6000.0.85f2, so the test calls it by reflection. It returns
a `VariantCompileInfo` whose `Messages` carry `ShaderMessage` with severity, file, line and text. Findings from throwaway probes (not
committed):
- With `outputForExternalTool = true` it runs the real GLES3x translation: all-four-keywords RegionGround, fragment stage, returns
  `Error Assets/Resources/Regions/RhLocalLights.hlsl:23 maximum ps_5_0 sampler register index (16) exceeded`, the build log's line.
  With `false` it reports `Success = true` with no data and no messages for the same variant: a silent non-compile, so the test uses `true`.
- Compiled for every keyword mask 0..15 of all five shaders, pass 0 (vertex and fragment): the only error anywhere is RegionGround with
  all four on. `ActorLit`, `RegionLitMesh`, `RegionSpriteLit` compile clean at all four on (so a change to `RhLocalLights.hlsl` has
  three other users to keep green, which the oracle covers). Passes 1 and 2 do not exist (success false, no message).
- A synthetic shader (`ShaderUtil.CreateShaderAsset`) with 16 sampler states compiles; with 17 the same call returns the same error. The
  oracle's guard test uses exactly that.
- `ShaderUtil.GetShaderMessages(shader, ShaderCompilerPlatform.GLES3x)` also shows the error, but it only reads messages cached by the
  importer, which vary with what ran earlier in the session; `ShaderUtil.GetShaderMessages(shader)` (no platform) shows only D3D warnings
  and `ShaderUtil.ShaderHasError` was false on a fresh run. Neither is used. The `GetVariantCount` and `CompilePass(Material, ...)` were
  not tried (they do not take a platform).
- Faithfulness: this is the editor's real shader compiler with the Web target's keywords, the same code that produced the build log
  line, so the test is as faithful as the build. Not covered: other passes or subshaders (none exist), and the `Hidden/` or package
  shaders (not in `Resources/Regions/`). The test compiles the worst case only (all four keywords) because each keyword adds
  one texture and one sampler, so every other combination is a subset; this is also why it stays cheap (one compile per shader). A fix that moves a sampler into a keyword-dependent `#if` of its own would break that argument; the
  implementer then adds the keyword to the compiled set.
- Cost: about 1 min 45 s for the whole EditMode suite on this machine (the compile of RegionGround dominates).

## Baseline
`bash client-unity/UnityProject/Tools/editmode.sh` on `packet/P-UNITY-GROUND-SAMPLERS-1`: total 1262, passed 1261, failed 1.
- RED: `RegionShaderWebCompileEditModeTests.EveryRegionShaderCompilesForTheWebWithAllShapeLights("RegionGround")`, with
  "Assets/Resources/Regions/RhLocalLights.hlsl:23 maximum ps_5_0 sampler register index (16) exceeded".
- Green guards: the same test for `RegionActorLit`, `RegionLitMesh`, `RegionSpriteLit`; and
  `TheWebCompileCheckCatchesASeventeenthSamplerAndAcceptsSixteen` (16 compiles, 17 is reported).
- The 1258 other EditMode tests pass. No stub commit is needed (the test reads no new code), so `stub:` is empty.

## Remedies, against what was found
- **Share a sampler state: fits, and is the minimum.** `_VariantTex` is point sampled, clamp (`RegionGround.cs:76`), exactly like
  `_TempleTex` (`RegionGround.cs:72`). Declare `TEXTURE2D(_VariantTex);` without its own `SAMPLER` and sample it with
  `sampler_TempleTex` (the way `_RhFogTex` borrows `sampler_RhRegA`): 12 fixed, 16 with all four. Checked on the oracle: with that two-line
  change in `RegionGround.shader` the oracle goes green (1262 of 1262), then reverted. No visual change (same filter and wrap).
  Note it leaves the all-lights variant at exactly 16 with no headroom; the next texture needs another share. Other candidates for sharing:
  `_RegA`/`_RegB`/`_TerA`/`_TerB`/`_PlgTex` are all bilinear clamp (the texture helper at `RegionGround.cs:128`; `_RhRegA`/`_RhRegB` are set from `regTexA/B`, `:42`, so probably the same state, verify): merging them to one linear-clamp state would buy about five more with no change of look; `_GroundTex`/`_GroundNrm`
  are bilinear repeat with different aniso levels (4 and 2), so keep them separate or share and accept the aniso of one.
- **Channel packing: not needed**, and a larger change (CPU bakes in `RegionGround.cs`, the capture tool). Keep it for later.
- **Dropping a texture the Web variant can drop: not fitting.** Every texture is read by a feature the Web draws (variants, temple,
  Plague), and a per-platform keyword would double the variant count.

## Notes from previous attempts

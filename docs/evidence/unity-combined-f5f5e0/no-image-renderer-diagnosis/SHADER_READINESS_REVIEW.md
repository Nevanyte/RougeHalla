# Cyan fallback and shader-readiness evidence

## Finding

Unity 6.0.85f2's installed URP package is 17.0.4. Its `Shaders/Utils/FallbackLoading.shader` is named `Hidden/Universal Render Pipeline/FallbackLoading` and its fragment shader returns exactly `float4(0,1,1,1)` (opaque cyan). That makes a flat cyan image *consistent with* this loading shader, but color resemblance alone does not identify the material or prove shader-compilation timing.

The local URP source narrows the condition: `UniversalRenderPipelineAsset` provides this shader through `IGPUResidentRenderPipeline.gpuResidentDrawerSettings.loadingShader`; `GPUResidentDrawer` passes it to `InstanceCullingBatcherDesc.brgLoading`; the core `InstanceCullingBatcher` creates a loading material from that shader for the BRG path. The currently active project pipeline is identified by `GraphicsSettings.asset`'s custom-pipeline GUID matching `Assets/Settings/RoguehallaPipeline.asset.meta`; that pipeline asset sets `m_GPUResidentDrawerMode: 0` (`Disabled`). Its GPU Resident Drawer constructor asserts that mode is not disabled. Based on these installed source and project settings, the URP GPU-Resident-Drawer loading material is **not presently an evidenced source** for the captured cyan pixels. This does not rule out an explicit material use, another renderer path, or some independent async condition; the specific rendered object/material has not yet been identified.

Therefore, the existing cyan pixels cannot yet be classified as either an async-readiness gap or a production mask/rendering failure. The capture metadata currently has no renderer/material shader identity, pass readiness, or compilation-state sample.

## Capture order and what it proves

The unmodified external `capture-template.cs.txt` does this after setting text scale:

1. yields one frame;
2. waits a fixed 0.15 seconds of realtime;
3. forces Canvas updates and TMP mesh updates;
4. waits for `WaitForEndOfFrame`;
5. calls `ScreenCapture.CaptureScreenshotAsTexture()`;
6. later inspects terrain textures using a temporary `Graphics.Blit` / `ReadPixels` GPU readback and restores `RenderTexture.active` in `finally`.

This sequence proves the layout updates and the current frame reached end-of-frame capture. It does **not** prove that an asynchronously requested shader variant has compiled. A fixed 0.15-second wait is not a completion signal. The map texture readback happens after the screen-capture texture is obtained, so that readback cannot have changed the already-captured PNG pixels for the current case; it should not be used to explain a cyan area in that screenshot.

## Public, local shader-readiness API

The installed `UnityEditor.CoreModule.xml` documents these public `UnityEditor.ShaderUtil` members; official Unity 6.0 scripting API pages confirm the signatures and semantics:

- `ShaderUtil.anythingCompiling`: a **global, momentary** Boolean for whether the Editor is compiling any shaders asynchronously. `false` alone does not establish that the particular variant/pass needed by a renderer is already compiled. ([Unity API](https://docs.unity3d.com/6000.0/ScriptReference/ShaderUtil-anythingCompiling.html))
- `ShaderUtil.IsPassCompiled(Material material, int pass)`: checks whether the shader variant needed for that material/pass is already compiled. Query the actual material that renders the cyan pixels and every pass used by that renderer. ([Unity API](https://docs.unity3d.com/6000.0/ScriptReference/ShaderUtil.IsPassCompiled.html))
- `ShaderUtil.CompilePass(Material material, int pass, bool forceSync)`: requests compilation of the variant needed for the material/pass. `forceSync=true` makes the call wait for that compilation; this is a deliberate diagnostic action, not a fixed-delay substitute. ([Unity API](https://docs.unity3d.com/6000.0/ScriptReference/ShaderUtil.CompilePass.html))
- `ShaderUtil.ShaderHasError(Shader shader)` and `ShaderUtil.GetShaderMessages(Shader shader)`: report shader compile errors and compiler messages; check separately from asynchronous readiness. ([Unity API](https://docs.unity3d.com/6000.0/ScriptReference/ShaderUtil.ShaderHasError.html), [messages](https://docs.unity3d.com/6000.0/ScriptReference/ShaderUtil.GetShaderMessages.html))

The installed Shader Graph preview code uses `ShaderUtil.IsPassCompiled` over every material pass and keeps waiting until the passes are compiled. This is useful local evidence of the intended pass-specific check; it is not evidence that current-game renderers use Shader Graph.

## Evidence that separates the hypotheses

For any later, root-authorized replay, the minimum useful read-only record should tie the pixels to the actual renderer and its shader state at the capture frame:

- name/path and type of the renderer or `Graphic` covering the cyan region;
- the actual bound shader name and material identity (for uGUI, include `Graphic.materialForRendering`; for sprite/mesh renderers, include their bound shared material), pass count, and active keywords;
- active renderer path/settings relevant to that object, including whether it is actually submitted through the GPU Resident Drawer;
- for each relevant pass, `ShaderUtil.IsPassCompiled(material, pass)` immediately before and at screenshot capture; also record `ShaderUtil.anythingCompiling` at both points;
- `ShaderUtil.ShaderHasError` and relevant compiler messages for the bound shader;
- the native screenshot region and its pixel colors, without resizing or postprocessing.

Interpretation:

- **Async-readiness evidence:** the visible renderer is shown to use a loading fallback; its exact required material/pass is uncompiled at the first relevant sample; compilation is pending or is requested; the same pass becomes compiled; then the cyan region disappears or resolves into the intended output without changing geometry, mask, material assignment, layout, or source state. If testing the URP fallback specifically, also establish the renderer is in the GPU Resident Drawer path; the current project asset says that drawer is disabled.
- **Production mask/material evidence:** the exact renderer and material are identified; all required passes remain compiled, async compilation is inactive around the rendered frame, there are no relevant compile errors, and cyan persists in the native screenshot. Then the investigation should follow the actual material/shader and mask/stencil/texture inputs, not assume the visible cyan is temporary loading.
- **Still inconclusive:** only `ShaderUtil.anythingCompiling=false`, `Shader.isSupported`, a delay, a cyan RGB sample, or Canvas/TMP layout readiness. These facts do not connect a particular compiled variant to the visible renderer.

No Editor API calls, Play session, new image, new test, source change, or sealed-evidence change was made for this review.

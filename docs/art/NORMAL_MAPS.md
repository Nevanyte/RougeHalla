# Normal map A/B evidence

This records controlled rendering response checks for the showcase's 2D normal maps. It is evidence that the normal-map path changes rendered pixels under the captured setups; it is not an art-quality or performance evaluation. The visual judgment is limited to the subtle captured relief; broader art-quality acceptance remains open.

## Setup

- Runtime code was the `ebff286bc68027d4e32eee3607d2ae6807038f9d` snapshot (`ShowcaseSprites.cs`); the art repository was at `a401a51001e403b58ccc71a5f7ddd17ad9461dff` when recorded.
- `ShowcaseSprites.Get` attaches each generated 128×128 floor and stone normal texture as a `SecondarySpriteTexture` named `_NormalMap`. It generates relief normals from the floor grout / stone edge gradients. The presentation uses the URP 2D Sprite-Lit material.
- The baseline had all 303 floor and stone `SpriteRenderer`s and the same frozen staged preview, fixed poses, and `ManualHigh` quality setting. The preview component was disabled for the capture. For this A/B, all 29 `Light2D` instances were explicitly set to `normalMapQuality: Accurate` (enum value `1`).
- The flat-map A/B used the same `.5, .5, 1, 1` tangent-space normal at every texel. The replacement normal was attached to a **cloned primary `Texture2D`**, avoiding Unity's secondary-texture cache for shared primary textures. Unity reported the clone retained `graphicsFormat: 4`, `sRGB: true`, and 128×128 dimensions.
- Unity `AsyncGPUReadback` independently confirmed the original and cloned primary textures had 65,536 albedo bytes each, `error: false`, and zero differing bytes for both floor and stone. Thus the controlled change was the secondary normal map, not primary albedo data.

## Captures and measurements

Raw 2560×1440 RGB PNG captures are retained outside the repository at:
`/Users/nevinmckinnon/.codex/tools/rougehalla-unity-art/evidence/`

| Capture | SHA-256 | Bytes |
| --- | --- | ---: |
| `normals-accurate.png` (relief maps) | `13d77241b4ef31684349c63d3756ce22545bf67cacb7ae7805afaa1ad927c691` | 4,051,047 |
| `normals-flat-unique-primary.png` (flat maps, cloned primary) | `8352691e9c6a917f0145ee3b8a4245f727d1832a11f7d06a9d02bacbe1a26853` | 4,042,374 |

Decoded comparison used Pillow and NumPy on the PNG RGB pixels, with absolute per-channel differences:

- 446,474 / 3,686,400 pixels differ in at least one RGB channel (12.1114%).
- Mean absolute difference: R 0.2151, G 0.1644, B 0.1069; overall RGB MAE 0.1621 and RMSE 0.7544 (8-bit channel units).
- Absolute-difference percentiles across channel samples: median 0, p95 1, p99 3, maximum 25.

The earlier `normals-flat-control.png` reused the primary texture and is byte-for-byte identical to `normals-accurate.png` (same SHA-256). It is not a valid control: Unity reused cached secondary texture state. The cloned-primary capture is the valid flat-map comparison.

## Historical forced-light experiment

This earlier A/B used runtime revision `ebff286bc68027d4e32eee3607d2ae6807038f9d` and explicitly forced all 29 lights to Accurate. The pinned URP enum is `Disabled = 2`, `Fast = 0`, `Accurate = 1`; the then-committed `Torch.prefab` had `m_NormalMapQuality: 2` and `m_UseNormalMap: 0`, which means **Disabled**. The old captures demonstrate response only under the forced-light experiment, not in that shipped configuration. The same-primary flat control was invalid because of secondary-texture cache reuse; the unique-primary capture and its limitations are recorded above.

## Shipped-configuration A/B

A newer A/B was captured at runtime revision `4f37e9f0` using ordinary `ManualHigh` preview settings, motion on, frozen staged poses, and no normal-quality probe override. This capture used the actual staged light setup: 12 enabled lights total, with 11 Accurate point lights and the untouched ambient light still Disabled (`2`). The preview content was frozen; the editor camera capture is cropped around the target aspect and includes the overlay caption. It is evidence of world-render response, not final browser UI framing; browser UI proof is separate.

The control replaced only the flat/relief secondary normals while using unique cloned primary textures, leaving geometry, materials, albedo, and light quality unchanged. The raw CLI control record reports 303 target renderers: 42 floor and 261 stone. Unity `AsyncGPUReadback` reported 65,536 albedo bytes for each primary texture, zero differing bytes, and `error: false` for both floor and stone. The actual raw control record is `repair-normal-control.json` and the pixel comparison is `repair-normal-comparison.json` in `/Users/nevinmckinnon/.codex/tools/rougehalla-unity-art/evidence/`.

The 2560×1440 RGB captures are retained in that evidence directory:

| Capture | SHA-256 | Bytes |
| --- | --- | ---: |
| `repair-normals-relief.png` | `cc1d5b6ff57fa27d0144f8646c35ad342588d0f19db25e8bbedf9a6843852dd9` | 4,049,818 |
| `repair-normals-flat.png` | `1f26d77c3d2bc77ef6cfb01dcf76898be9806d0035f3282950c671b0cbe9d15d` | 4,041,975 |

Pillow/NumPy RGB pixel comparison found 442,688 / 3,686,400 pixels differ (12.0087%). Per-channel mean absolute difference was R 0.2141, G 0.1631, B 0.1060; overall RGB MAE was 0.1611 and RMSE 0.7533 (8-bit channel units). Absolute-difference percentiles across channel samples: median 0, p95 1, p99 3, maximum 25. This is small pixel-level evidence that relief normals affect the world render under the staged shipped light configuration.

The source configuration gap is closed by runtime revision `4f37e9f0`: the shared torch preset remains Disabled, while the dedicated showcase torch setup enables Accurate without changing the ambient light. Editor validation passed 27 checks. The combined Web build passed its 19 browser outcomes and three High-quality GPU diagnostic windows; lead integration admission is separate from these checks. The parent visually inspected the candidate baseline and prior flat comparison and described the relief as subtle; this document does not assert art-quality or performance acceptance.

These measurements establish a render response to the normal input under this setup. The parent has visually inspected the candidate baseline and prior flat comparison and found the relief subtle. This is not an art-quality, perceptual-significance, or performance acceptance; the passed combined Web/GPU checks remain distinct from native 144 Hz and overall milestone acceptance.

The combined browser build and three fixed-High 2560×1440 GPU windows subsequently passed their bounded checks; see [REPAIR_VERIFICATION.md](REPAIR_VERIFICATION.md). This does not close native 144 Hz, allocation, complete art coverage or overall art-quality acceptance.

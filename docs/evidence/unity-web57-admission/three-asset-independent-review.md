# Web6d three-asset drift: targeted semantic source review

**Recommendation: Root may admit exactly these three current serializations as a bounded source canonicalization, then make a new freeze and rebuild. Do not release the first artifact as source-exact.** The postbuild source guard correctly remains HOLD. No unsafe shader/font tuning change was found in the diff, but static source reasoning is not font/pixel acceptance.

Inspected diff `web6d-postbuild-first-diff.patch`, exact SHA256 **36aba7c3a8aa307aa119fdb7d1f3a7007ac3c228f2bfc912d030a9edcc3407b8**, adjacent inventory and current three readonly asset bytes. Inspected actual installed UGUI2.0.0/TMP sources at `Library/PackageCache/com.unity.ugui@cd4936b8279f`; read its shipped Essential Resources archive in memory without extracting/importing. Consulted official Unity6000.0 docs/reference. No Editor/CLI/build/restart/Save/dirty clearing/source mutation occurred.

## Exact candidate bytes

| Asset under client-unity/UnityProject/Assets | Current bytes | SHA256 |
|---|---:|---|
| Settings/RoguehallaPipeline.asset |4413|`ea26d6362d84b96ab37fdbbe03b92f7a723f35e05a5a306b586fc05730e5641c`|
| UniversalRenderPipelineGlobalSettings.asset |21730|`2458dd20ad332a72f08ff4620754d339a4a7bf814f73476332377852479fb014`|
| TextMesh Pro/Resources/Fonts & Materials/LiberationSans SDF - Fallback.asset |9748|`6792385c280302fc148141e7248f57fdab55b01366c31275e035a8fed3a4d850`|

Each current hash matches the preserved drift inventory. Both URP files become byte-identical to frozen6d after stripping trailing whitespace on lines: **only whitespace after empty YAML scalars changes**, no render/quality/stripping/reference value. This does not make their original frozen hashes match; exact new bytes need explicit source admission.

## TMP: actual source explanation

The installed Essential Resources archive ships the same fallback asset as frozen6d modulo trailing whitespace: Material version6, empty0×0 atlas, clearDynamicDataOnBuild1. This is older packaged serialization being loaded by Unity6000.0, not evidence that a project shader/font was redesigned.

The installed `Runtime/TMP/TMP_FontAsset.cs:283–300` declares `m_GetFontFeatures = true`; new explicit YAML1 matches that source initializer. `m_ShouldReimportFontFeatures` at379 is a serialized bool without initializer (false); new0 matches that default. It gates ImportFontFeatures during ReadFontAssetDefinition at853, and ImportFontFeatures clears it tofalse at3099. The first flag affects GSUB/other feature updates when dynamically adding glyphs, also gated by TMP_Settings.getFontFeaturesAtRuntime (defaulttrue in installed TMP_Settings.cs:131). Therefore it is a **real behavior field**, not meaningless text; its observed value matches the installed default rather than a requested new feature toggle. No live RAM getter was invoked to establish the pre-serialization value.

The installed `Editor/TMP/TMP_PreBuildProcessor.cs:12–25` iterates font assets and clears Dynamic/DynamicOS assets with clearDynamicDataOnBuild and a nonzero atlas width. It calls `ClearCharacterAndGlyphTablesInternal`; `TMP_FontAsset.cs:3469–3488` clears character/glyph tables, clears atlases with true, reads the definition and registers a resource update. `ClearAtlasTextures:3556–3620` specifically uses **Texture2D.Reinitialize(1,1,Alpha8,false)** for the Unity2021.2+ branch, then FontEngine.ResetAtlasTexture and Apply. This directly explains the modern **1×1 one-zero-byte blank dynamic atlas** representation instead of the packaged0×0 empty representation. It is not loss of an authored populated atlas: both before and after glyph/character tables are empty.

Later dynamic glyph paths at1898–1907 and2122–2132 recognize width/height<=1 and reinitialize to configured atlas dimensions before packing glyphs. Configured dimensions remain512×512, padding9, renderMode4169 and source LiberationSans font GUID/reference unchanged. Thus dynamic reconstruction is supported by the actual package algorithm; this audit does not prove every requested runtime character is present or rendered successfully.

Important causality limit: these are the installed reachable build/clear paths, not an instrumented stack proving precisely which callback saved every byte during this build. TMP_EditorResourceManager registers updates, but its SetDirty/SaveAssets calls at238/245 are commented out. Do not claim that manager itself executed SaveAssets. Native build serialization/persistence is not fully exposed in public C# reference.

## Material, texture schema and preserved semantics

Material6→8 adds current schema fields: null parent, modified-properties0, empty valid/invalid keyword arrays replacing an empty keyword string, empty locked-properties/int-properties/texture-stacks and allowLocking1. Shader GUID, texture environment references/transforms, all float/color values, queue, instancing/GI flags and disabled passes remain unchanged. No new parent inheritance, keyword or shader-value content is installed. Unity's Material parent/locking APIs concern variant/editor property inheritance; parent is explicitly null here. [Material.parent](https://docs.unity3d.com/6000.0/Documentation/ScriptReference/Material-parent.html), [6000.0 Material bindings](https://github.com/Unity-Technologies/UnityCsReference/blob/6000.0/Runtime/Export/Shaders/Material.bindings.cs).

The font object's former fields are reordered, not removed: legacy fontInfo/glyphInfo/kerning/fallback/atlas entries move to the bottom; FaceInfo, creation settings, material/source refs, population mode1, dynamicOS0, multi-atlas1, feature tables and weight/style values remain. Added source-font path is empty. Texture serialization2→3 adds modern mip/preprocess/mipmap-limit/VT/platform/stream metadata with empty/zero values; Alpha8/readability/mip settings remain and pixel storage changes to the explained blank1×1 reset. Some native serialized schema details are not defined by public C# bodies; their mere names are not a proof of universal semantic equivalence.

Possible font impact remains bounded but real: dynamic fallback must load its source font and regenerate glyphs/features; missing source characters, shaping/kerning, fallback selection or actual glyph upload can still affect labels. No evidence here shows missing source refs or changed font metrics/material styling. Actual browser layout/readability across the finite matrix is still needed. Existing native98 proof remains an exact historical functional proof of6d, not a retest of newly frozen asset bytes.

## Source pins consulted

Actual package directory above, SHA256:

* package.json: `d8df43a06f5c808e1150d40a97ae551d9bc3151c9af36f74d59e8f0bcd7d871b`
* Runtime/TMP/TMP_FontAsset.cs: `ea9a99a164185fdda03b0cea3caeae48a52065da9ad570a7722a51fe7795522c`
* Runtime/TMP/TMP_Settings.cs: `67b815d1e112d4bdad5a7935d8111630320fb180f3804c1298602f8676f2a237`
* Editor/TMP/TMP_PreBuildProcessor.cs: `462778e355246ff3c361fb3e6f057d4306dbbec8cba19becfbf2009b827232ac`
* Editor/TMP/TMP_EditorResourceManager.cs: `c689fde51e395e68e9b52d825bdd3ca09832f5bd8b5e700caa2ba5d9a01634e4`

## Next bounded action for Root

Preserve first build/raw artifact, three first-byte snapshots, exact diff and failed guard unchanged. If Root accepts this source recommendation, commit **only the exact three hashed assets** as a separately reviewable canonicalization; no broad asset allowance or extra reserialization. Freeze all source/package/meta/settings inputs anew with a distinct identity, retaining the startup overlay separately. Then release one new build and require full pre/post exact-source guard, package/settings/scene/Baked checks and new artifact hashes. If drift recurs, preserve it and stop rather than widening the allowance. Do not call the175349ms/0error/17warning first build source-exact or treat compile success as layout/font acceptance. No new action is authorized by this report itself.

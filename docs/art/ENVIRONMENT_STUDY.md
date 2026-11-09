# Staged environment and faction art study

This is an opt-in, no-network Editor play-mode study. It reuses the existing `?preview=1` bootstrap only to obtain the workshop camera, then replaces the original `Presentation study` and `Presentation study arena` roots. It does not construct `MatchClient`, submit input, create map facts, simulate hazards, or infer a biome from position. The display explicitly labels the surface and effect examples as staged review content.

## Entry point and dependencies

After the bounded Flare catalog importer has created `Assets/Art/Derived/FlareExpansion/AssetReadiness.asset`, use **Roguehalla → Art → Play Environment Study**. The menu loads that catalog and calls:

```csharp
new GameObject("Staged Environment Study")
    .AddComponent<ShowcaseEnvironmentStudy>()
    .Initialize(camera, stagedCatalog);
```

`ShowcaseEnvironmentStudy` expects existing presentation APIs: `ShowcaseBiomeArt.Floor`, `ShowcaseTerrainVignette.Configure(ShowcaseTerrainArt, Vector2, bool)`, `ShowcaseIdentityAssets.GetEliteGlyph`, `SpriteActorPresenter`, `ShowcaseSprites`, `ShowcasePalette`, and `ShowcaseSettings`. `ShowcaseTerrainVignette` is a separate staged source dependency and must be copied before this study is integrated.

The actor catalog adapter is a transient, `HideFlags.DontSave` `ShowcaseCatalog` populated from the staged `AssetReadinessCatalog.Actors`. It is destroyed with the study. Five public player faction presentations use the existing `ShowcaseActorLook` key mapping and the SpriteActorPresenter path, facing southeast (`π/4`). Attacks are periodically triggered through the presenter's staged `ConfirmedCue(FxKind.Swing)` artwork method; they are preview cues, not server-confirmed events.

## Layout

- Five 5.4 × 4.4 floor swatches at screen X = −12, −6, 0, 6, 12, using the original Fire, Sentenced, Plague, Frost, and Holy floor generators.
- One staged player actor at each plinth. Actor coordinates convert screen placement through the existing `ArenaView.Scale` and `GroundSquash` constants.
- Four terrain samples beneath: Lava, Bog, Ice, and Healing Light. Only the Lava and Healing Light samples request the optional point light; all vignette particle/light quality and reduced-motion behavior stays in `ShowcaseTerrainVignette`.
- Ten elite emblems and labels are keyed to the explicit `MobTypeId` values handled by `ShowcaseIdentityAssets.GetEliteGlyph`.

`SPACE` pauses new attack samples. `M` calls the existing `ShowcaseSettings.ToggleReducedMotion()` when that component is present. No custom animation or quality state is persisted by this component.

## Ownership and cleanup

The study keeps references to the GameObjects it creates and destroys those children on teardown. Each terrain vignette owns its own child sprites, optional lights and particle objects and performs its own cleanup. The actor presenter roots are parented beneath the study root. The transient catalog is destroyed with that root. The menu destroys only the two specifically named original preview roots before creating the study.

This source has been prepared externally for parent review. It has not been copied into the Unity project, compiled, or run in Unity.

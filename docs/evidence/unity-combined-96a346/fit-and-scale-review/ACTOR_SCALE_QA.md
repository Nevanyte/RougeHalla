# Actor scale capture QA

## Result

The exact source SHA `96a3462eb6f774891e80c6b2e6dde2700eb8fed6` appears in all **12 native screenshot and metadata pairs** under `evidence/layouts/`: HUD, map, and planning at 1440p and 720p, each with text scale 1.0 and 1.5. All cases report matching expected, screen, and PNG dimensions; ready state; frame advancement; snapshot advancement; and the staged watermark. Each records eight actor roots. Across all 96 observations, every root matched exactly one sampled delivered anchor and consistently measured local and lossy scale `(1.2, 1.2, 1.0)`. All 12 report an orthographic camera with size `9.0`. No TMP text entry reports overflow or truncation.

## Renderer and anchor measurements

Each captured root's world anchor equals its corresponding delivered observation anchor. This confirms the presenter placed the scaled visual root at the sampled actor position without changing that anchor. Public source sets scale once when creating an actor root and sets world position from the observation in `Present` ([SpriteActorPresenter.cs:290](/Users/nevinmckinnon/Documents/Projects/RogueHalla-unity-art/client-unity/UnityProject/Assets/Scripts/Presentation/SpriteActorPresenter.cs:290), [SpriteActorPresenter.cs:135](/Users/nevinmckinnon/Documents/Projects/RogueHalla-unity-art/client-unity/UnityProject/Assets/Scripts/Presentation/SpriteActorPresenter.cs:135)). The same root scale appears in all twelve fixture captures. This is consistent with fresh instances; it does not exercise repeated pooling or arbitrary parent transforms.

Renderer bounds below are `SpriteRenderer.bounds` from metadata, aggregated across all 12 cases. They are sprite rectangle bounds, not opaque-pixel bounds.

| Renderer group | Entries | Local position ranges | Local scale ranges | Aggregate world bounds min to max |
| --- | ---: | --- | --- | --- |
| Body | 96 | X 0; Y 0.08; Z 0 | X/Y/Z 0.8944-1.15 | `(13.4480, -18.8129, -0.115)` to `(28.8042, -11.0265, 0.115)` |
| Overhead | 396 | X -0.72-0.1475; Y 1.55-1.8; Z 0 | X 0.4-0.98; Y 0.055-0.46; Z 1 | `(12.9225, -17.1848, -0.1)` to `(28.7130, -10.4490, 0.1)` |

## Light extent

Each case records 16 Light2D components. Every component has local outer radius `2.4` and inherited XY scale `1.2`, yielding transform-derived world outer radius `2.88`. That is a 20% larger transform-derived outer radius than an unscaled 2.4 radius; it is not an empirical measurement of rendered light coverage. The presenter sets root scale and configures local light radius ([SpriteActorPresenter.cs:286](/Users/nevinmckinnon/Documents/Projects/RogueHalla-unity-art/client-unity/UnityProject/Assets/Scripts/Presentation/SpriteActorPresenter.cs:286)); `ShowcasePointLight` applies that radius ([ShowcasePointLight.cs:56](/Users/nevinmckinnon/Documents/Projects/RogueHalla-unity-art/client-unity/UnityProject/Assets/Scripts/Presentation/ShowcasePointLight.cs:56)). This does not establish actual brightness, falloff appearance, or perceived reach. One of 16 lights is enabled in each capture.

## Fixed UI geometry

At each resolution and view mode, recorded control paths and bounds are identical between text scales 1.0 and 1.5; all six pairwise comparisons show zero bounds or raycast-state differences. Some map and planning controls do not receive their own center raycast hit because overlay elements cover them; those same paths fail at both text scales, so the captures show no text-scale change in that behavior.

Capture scripts yield a frame, wait 0.15 seconds, update canvases, and capture at end-of-frame. Actual frame deltas range from 37 to 96, with snapshot timestamp deltas of 150-200 ms. These are not fixed 20-frame captures; the measured deltas are recorded in the JSON.

## Scope

This review parses the 12 JSON receipts and verifies the 12 PNG/JSON pairs, dimensions, actor metadata, bounds, and public presentation source behavior. It does not establish opaque-pixel scaling, image resampling, browser rendering, network behavior, performance, or behavior under repeated pooling. See [`ACTOR_SCALE_QA.json`](ACTOR_SCALE_QA.json) for per-capture hashes and measurements.

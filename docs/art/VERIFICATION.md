# Unity showcase verification

The art branch is `codex/unity-art-direction`, based on coordinator-approved gameplay revision `e90a38f6`.
The latest runtime revision is `c6fe0b18`. Unity remains 6000.0.85f2, URP 17.0.4 and WebGL2.
Rust remains authoritative; this branch does not alter simulation, protocol, prediction or input scheduling.

## Reproduce locally

From the repository root, start the existing first-playable server:

```sh
cargo run -p rh-server -- --first-playable --bind 127.0.0.1:18797 --min-players 1 --fill-bots 4 --lobby-seconds 5 --fill-seconds 3
```

The tested server uses protocol 11 and content hash `801a76cde4cfd305`. Its embedded public map is
48×40 tiles, collision checksum `1c772b5b`, source metadata hash `0252d18b`.

Bake the exact running server identity before building:

```sh
RH_SERVER_INFO_URL=http://127.0.0.1:18797/info client-unity/UnityProject/Tools/build-web.sh --prepare-only
```

With that project open in the pinned Editor, run `Roguehalla.Editor.RhBuild.BuildWeb()` through the Unity CLI
or the Roguehalla build menu. The builder selects the project Web template and includes distribution notices.
When the Editor is closed, `Tools/build-web.sh` can invoke the pinned batch Editor instead.

Serve the resulting directory with ordinary local static hosting:

```sh
python3 -m http.server 18897 --bind 127.0.0.1 -d client-unity/UnityProject/Build/Web
```

Live match: <http://127.0.0.1:18897/?server=ws://127.0.0.1:18797/ws>.
Separate staged art study: <http://127.0.0.1:18897/?preview=1>. The study opens no match socket.

## Checks

| Gate | Evidence / current result |
| --- | --- |
| Networking C# suite | 329 passed; no failures or skips. |
| Source-copy check | `sync-net` check passed. |
| Unity compilation and presentation tests | Eleven real EditMode tests passed: projection round trip, no physics, latest visibility removal, renewed observer handles, light/effect cleanup, essential Low-tier indicators, eight-direction catalog coverage, confirmed ranged/death frame selection, full card index 79 invalidation, pooled voice teardown, and renderer cleanup with audio disabled and a reset observation timeline. |
| Asset/source integrity | Original Flare art/metadata, armor, audio and font hashes pass. No original source pixels/audio were edited. Derived composited atlases retain their art license. |
| Palette | Text/muted text pass 4.5:1 on the three dark UI surfaces. Slider thumb passes 3:1 against track and fill. Grayscale and three CVD simulations flag similar lightness; names and distinct insignia supplement hue. |
| Existing readiness inventory | 125 cues / 162 modules / 228 protocol symbols validated; 57 existing gap entries remain explicit. |
| Browser match | All 19 outcomes passed on `c6fe0b18` in `evidence/final-web4/showcase-web.json`, with no page or observer/decoder errors. A real offered reward choice changed the authoritative build. |
| Performance | Three normal, three native eight-seat and three uncapped diagnostic captures completed. See [PERFORMANCE.md](PERFORMANCE.md). Native display acceptance is unavailable: the only attached main display currently reports 1920×1080 at 60 Hz. |

The browser proof requires all 19 outcomes and fails closed for missing evidence, errors or refused actions.
Its five behavioral contract tests pass. A regular camp clear does not guarantee a reward chest. The proof
must open publicly observed crates through ordinary focus/Pickup and select only actual server-offered options.
Raw State prop/chest positions are quantized wire codes; navigation uses the same `/8` conversion as the C# typed views.

The earlier recorded reward example opened focused public prop handle 7 at world `(432,208)` with the ordinary F input.
The server then supplied reward chest handle 6 with three options and `CanChoose=true`. Clicking option 0 sent
the normal Choose command; the authoritative build's boost slot 2 changed from 0 to 1. No producer was inferred
from a seed, normal camp kill, stale observer ID or local artwork. The browser AudioContext was running at
44.1 kHz stereo and its clock advanced after a real settings gesture; the music-mute preference reached zero.

## Measurement limits

The requested acceptance target is sustained 144 FPS or better at an actual 2560×1440 backbuffer, fixed High quality,
on a confirmed 144 Hz M5 Pro display. A 60 Hz display cannot establish that displayed-frame-rate result.
Browser RAF cadence, callbacks that submit WebGL draws, synchronous callback CPU work, GPU query timing and physical
scan-out are separate measurements. Missing GPU/allocation measurements are reported as unavailable, never zero.
The standalone art study is not a full-game performance proof.

Raw local evidence is kept at `/Users/nevinmckinnon/.codex/tools/rougehalla-unity-art/evidence/`, including build hashes,
test logs, browser reports and captures. Portable [evidence summary](evidence/summary.json), [build hashes](evidence/build-manifest.json), [test results](evidence/editor-tests.xml), [performance measurements](PERFORMANCE.md) and representative screenshots are checked into this branch.

Asset preparation and live acceptance are tracked separately in [COVERAGE.md](COVERAGE.md). Missing authoritative facts
stay in the existing [readiness inventory](../unity/PRESENTATION_CONTRACT.md); this report does not change coordinator status.

Maximum text size (1.50) was exercised through the real slider at a 2560×1440 backbuffer. Visual review of the settings panel and active HUD found no clipped labels or controls; captures are in `evidence/text-150-settings.png` and `evidence/text-150-hud.png`.

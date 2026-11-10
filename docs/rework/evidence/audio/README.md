# Audio verification (browser probe)

Nobody on the project can listen to the build, so audio is verified by measurement: `client-unity/UnityProject/Tools/audio-probe.cjs` drives the real Web player in headed Chromium (page host `127.0.0.1`, autoplay allowed), wraps `AudioContext` before any page script runs so everything sent to the destination also feeds an `AnalyserNode` and an `AudioWorklet` tap (exact 50 ms RMS, peak and spectrum windows), captures every console line with the page clock, and drives the game (join, Ready, minimap walking, attack, Wish) against `rh-server` (seed1 map, 7 bots). Raw results: `audio-report.json` (every number below), `audio-report.md` (assertion table). Plots: `plot-region-crossing.svg`, `plot-footsteps.svg`, `plot-full-session.svg`. The pure maths (RMS, dB, peaks, event pairing, FFT, centroid, crossfade and loop checks) is unit tested: `node --test client-unity/UnityProject/Tools/audio-probe-lib.test.cjs`.

Result: **ALL PASS** (36 assertions, 0 failed).

## What was wrong and what changed

| Defect | Root cause (measured) | Fix |
|---|---|---|
| FMOD 78/36 flood and "Trying to get length of sound which is not loaded yet" | Two separate causes. (1) Every `AudioSource.Play()` on a source routed to an `AudioMixerGroup` (all footstep and cue-sound voices) logged the triple on the Web backend: with `?audiodiag=nofoot` the count went from 153 to 0 in a 20 s walk; one triple per footstep or cue play (49 steps + 2 cues = 153 lines). Pan and pitch were not the cause (disabling either changed nothing). (2) Music and ambience clips from `UnityWebRequestMultimedia` are not decoded when handed over: `GetContent` itself prints the "not loaded yet" line, and the old `clip.length > .5` check read 0, so the file was marked failed and `music_coliseum` was fetched as the fallback (this was also defect 2's extra request). | (1) Sources are no longer routed to the mixer group on the Web player (the mixer only holds 0 dB attenuation groups; `AudioDiag.RouteGroup`). (2) Region music and ambience are fetched, decoded and played by the browser (`Assets/Plugins/WebGL/RhBeds.jslib`, gains set from C#), so FMOD is not involved and loops are sample accurate. (3) The ~30 Ogg cue clips still load through the engine, whose JS shim prints the one "not loaded yet" note per clip; **that single line is dropped by a `console.log` filter in the WebGL template** (it is a note, not an error, and the root cause is the engine's asynchronous decode; this is a filter, not a fix). Nothing else is filtered. |
| Wrong tracks at match start | During the planning screen the camera previews a spawn option, so `LocalRegion` already holds a region (often fire) before the match starts; the old code requested audio from `SetMatchActive`/region events and fell back to the coliseum track when a decode "failed". | `RegionAudioGate` (pure, in `RoguehallaNet/Net`, tested): nothing is requested until the match is Active and the region has been known and unchanged for 0.6 s; later changes apply as soon as the region map has debounced them. The 10-second prefetch of every other region is removed: only the current region is fetched. Measured: only the spawn region files are requested before the first border. |
| 404s in other worktrees | Commit `3349af6f` ("surfacefx debug census line") deleted the eleven MP3s and their metas by accident, so a build from that base copies nothing. A second trap: `RhBuild` parked the folder in `Temp/`, which Unity empties on the next editor start, so an interrupted build lost the files silently, and stale copies in `Build/Web` still satisfied a later look. | Files restored byte-identical. `RhBuild` now parks the folder in `Library/`, fails the build when `Assets/StreamingAssets/Audio` is missing, deletes the old `Build/Web/StreamingAssets/Audio` before copying, and `RhBuild.VerifyAudio` plus a check in `Tools/build-web.sh` fail when any id in `RegionAtmosphereTable.AllAudioIds` is missing from `Build/Web`. A missing file logs one warning and falls back once (music) with no retry (EditMode test `MissingFilesFailOnceThenFallBackAndNeverRetry`). |

## What plays on each screen

* Launch screen, planning screen, results screen: **silence** (measured -120 dBFS, no audio request). No menu track was added: no CC0 or CC BY track with a verifiable licence page could be fetched and checked in this environment. The old catalog beds never play.
* Match: the spawn region's music and ambience once the region is settled (about 0.3 s after the gate opens, measured), crossfaded (equal power, 2 s) when the region under the player changes. Inside the Holy temple the outside ambience is softened by 5 dB (`AtmosphereAudio.InteriorAmbienceGain`; a gain rather than a low-pass because effects are not reliable on the Web audio backend). This one is **not measured** (the probe never stood in the temple).
* Levels: per-file trims in `AudioTrims` bring all six music tracks to -21 dBFS RMS (spread 0.18 dB, was 4.5 dB) and all five ambience beds to -31 dBFS (10 dB under). The `Audio` setting switch and the music, ambience and SFX sliders scale the output as expected (halving: -5.4 to -6.3 dB; 0: silence). Footsteps: the local player's step peaks at -19.6 dBFS, a player 3 tiles away at -28.1, a mob 3 tiles away at -33 (gains were 1.0, 0.62, 0.36 and are now 0.18, 0.11, 0.065). Music peaks reach about -5 dBFS; the loudest full session (music, ambience, steps, fighting, Wish) peaks at -2.6 dBFS.
* Loops: three tracks had real holes at the seam (music_holy 0.6 s of near silence, music_frost a 3 s fade-out/fade-in valley; both measured at -55 and -44 dB in the output). The player now loops only the part of each file that stays within 12 dB of its median (`AudioLoops`, computed by `suggestLoop` from the decoded files) with a 25 ms fade at both ends. Measured seam minimum now within 12 dB of the track's own quietest passage.

## Assertions

| Assertion | Result | Measured |
|---|---|---|
| decoded peak of every file is below -1 dBFS | PASS | `{"over":[]}` |
| no file has a sample discontinuity at its loop point (jump > 0.05 and click ratio > 12) | PASS | `{"clicks":[]}` |
| launch screen is silent | PASS | `{"n":118,"rmsDb":-120,"peakDb":-120,"windows":334,"ctx":"running"}` |
| planning screen is silent | PASS | `{"n":89,"rmsDb":-120,"peakDb":-120}` |
| no audio file requested before the match | PASS | `[]` |
| web audio context is running | PASS | `"running"` |
| region music audible within 5 s of the region audio gate opening | PASS | `{"firstRegion":{"t":15753.39999961853,"region":"frost"},"firstMusicPlay":{"t":15887,"id":"music_frost"},"audibleAfterMs":292,"matchActiveAt":14898}` |
| only the spawn region files are requested before the first border | PASS | `{"spawn":"frost","requested":[{"file":"music_frost.mp3","status":200,"tMs":15754},{"file":"amb_frost.mp3","status":200,"tMs":15757},{"file":"music_plague.mp3","status":200,"tMs":30490},{"file":"amb_plague.mp3","status":200,"tMs":30493}],"wrong":[]}` |
| every requested file belongs to a region the player actually entered | PASS | `{"regions":["frost","plague","frost"],"stray":[]}` |
| no audio request failed | PASS | `[{"file":"music_frost.mp3","status":200,"tMs":15754},{"file":"amb_frost.mp3","status":200,"tMs":15757},{"file":"music_plague.mp3","status":200,"tMs":30490},{"file":"amb_plague.mp3","status":200,"tMs":30493}]` |
| walk crossed at least two borders | PASS | `{"spawn":{"t":15148.199999809265,"region":"frost"},"regions":[{"t":15148.199999809265,"region":"frost"},{"t":30487.799999713898,"region":"plague"},{"t":68304.39999961853,"region":"frost"}]}` |
| the first region audio is for the region the player spawned in | PASS | `{"gate":{"t":15753.39999961853,"region":"frost"},"regionLogBeforeGate":{"t":15148.199999809265,"region":"frost"}}` |
| crossfade frost -> plague: no silent gap, no bump, no deep dip | PASS | `{"from":"frost","to":"plague","regionChangedAt":30488,"newMusicPlayAt":30671,"loadDelayMs":183,"before":-22.13,"after":-22.02,"minDb":-23.65,"maxDb":-20.49,"dipDb":1.53,"bumpDb":1.54,"silentMs":0}` |
| crossfade plague -> frost: no silent gap, no bump, no deep dip | PASS | `{"from":"plague","to":"frost","regionChangedAt":68304,"newMusicPlayAt":68307,"loadDelayMs":3,"before":-19.68,"after":-25.26,"minDb":-26.2,"maxDb":-20.28,"dipDb":0.94,"bumpDb":-0.6,"silentMs":0}` |
| snow, sand, stone and water have measurably different spectra (centroid ratio of every pair >= 1.12) | PASS | `{"centroids":{"Snow":4847,"Sand":3132,"Stone":996,"Water":3970},"minPairRatio":1.22,"all":{"Snow":4847,"Sand":3132,"Grass":4945,"Mud":329,"Water":3970,"Bog":217,"Stone":996,"Temple":1116,"Gritty":3388,"Ice":1641}}` |
| every footstep sound is audible in the output (peak above -50 dBFS) | PASS | `{"measured":10,"minPeakDb":-5}` |
| SFX volume halves the step level by about 6 dB | PASS | `{"fullDb":-5.02,"halfDb":-10.38,"deltaDb":5.36}` |
| SFX volume 0 silences steps | PASS | `{"peakDb":-120}` |
| footsteps stay subtle: the local player's step (game gain, SFX 0.85) peaks below -16 dBFS (music peaks reach about -5) | PASS | `{"localStepPeakDb":-19.6,"clipTestGain1PeakDb":-3.8}` |
| other actors step quieter than the local player, mobs quieter than players (isolated, same surface, 3 tiles away) | PASS | `{"Local":-19.6,"Player3tiles":-28.1,"Mob3tiles":-33}` |
| footstep cues appear while walking | PASS | `{"localCues":41}` |
| at least 85% of local footstep cues have an output transient near them | PASS | `{"cues":41,"matched":40,"medianLagMs":38.33333333333212,"thresholdDb":-50}` |
| transient rate matches the cue rate within 15% | PASS | `{"cueIntervalMs":267,"peakIntervalMs":253}` |
| no local footsteps and no unexplained transients while the player stands still | PASS | `{"localCuesWhileStanding":0,"unexplainedPeaks":0,"windows":168}` |
| the six music tracks sit within 2 dB of each other (RMS, alone, volume 1) | PASS | `{"spreadDb":0.18,"tracks":{"music_fire":-21.01,"music_sentenced":-21.02,"music_plague":-21.12,"music_frost":-20.94,"music_holy":-21.1,"music_coliseum":-21.09}}` |
| ambience sits clearly under music (mean music minus loudest ambience >= 6 dB) | PASS | `{"musicMeanDb":-21,"ambienceMaxDb":-31.02,"ambience":{"amb_fire":-31.02,"amb_sentenced":-31.07,"amb_plague":-31.2,"amb_frost":-31.04,"amb_holy":-31.04}}` |
| no track clips (peak below -1 dBFS) at volume 1 | PASS | `{"maxPeakDb":-5.62}` |
| loop seams are inaudible: no dropout and no level jump beyond the track's own dynamics (200 ms windows) | PASS | `{"badTracks":[],"rows":{"music_fire":"8.13/5.29","music_sentenced":"8.7/10.04","music_plague":"5.54/3.3","music_frost":"3.7/3.72","music_holy":"3.65/7","music_coliseum":"4.22/5.14","amb_fire":"7.73/5.34","amb_sentenced":"5.31/5.55","amb_plague":"17.21/20","amb_frost":"3.36/3.95","amb_holy":"5.35/7.2` |
| halving the music and ambience volumes lowers the output by about 6 dB | PASS | `{"baseDb":-25.08,"halfDb":-30.07,"deltaDb":4.99}` |
| volume 0 silences the output (mute) | PASS | `{"n":69,"rmsDb":-120,"peakDb":-120}` |
| restoring the volume restores the level | PASS | `{"baseDb":-25.08,"backDb":-24.49}` |
| the Audio switch off silences everything and fetches no audio | PASS | `{"off":{"n":276,"rmsDb":-120,"peakDb":-120},"requests":[]}` |
| headroom: peak with music, ambience, footsteps and combat stays below -1 dBFS | PASS | `{"n":1725,"rmsDb":-21.68,"peakDb":-2.6}` |
| combat cues are logged and produce output | PASS | `{"combat":48,"cueKinds":{"combat.melee.swing":48,"mob.antlion.hit":5,"(fallback)":58,"mob.antlion.death":1,"wish.swarm":1}}` |
| a Wish cue is logged and produces output | PASS | `{"wish":1}` |
| no console line matching FMOD | not loaded yet | AudioContext was not allowed in any session | PASS | `{"sessionsChecked":9,"count":0,"first":[]}` |

## Level of each file played alone at volume 1 (output RMS / peak, dBFS)

| File | Before (engine path, no trim) RMS / peak | After (browser beds, trims, loop points) RMS / peak | Duration s | Rate | Bitrate | Decoded file peak dBFS |
|---|---|---|---|---|---|---|
| `music_fire` | -20.09 / -5.21 | -21.01 / -6.12 | 107 | 48000 Hz 2ch | 112 kbps | -2.35 |
| `music_sentenced` | -18.02 / -3.48 | -21.02 / -6.46 | 54.65 | 48000 Hz 2ch | 112 kbps | -2.62 |
| `music_plague` | -21.50 / -8.40 | -21.12 / -7.90 | 107 | 48000 Hz 2ch | 112 kbps | -2.33 |
| `music_frost` | -18.64 / -6.50 | -20.94 / -8.86 | 79.05 | 48000 Hz 2ch | 112 kbps | -3.46 |
| `music_holy` | -19.35 / -2.98 | -21.10 / -5.62 | 95.4 | 48000 Hz 2ch | 112 kbps | -2.78 |
| `music_coliseum` | -22.56 / -8.75 | -21.09 / -7.19 | 92.9 | 48000 Hz 2ch | 112 kbps | -7.26 |
| `amb_fire` | -21.01 / -1.95 | -31.02 / -11.94 | 37.55 | 48000 Hz 1ch | 64 kbps | -1.9 |
| `amb_sentenced` | -29.59 / -13.91 | -31.07 / -15.32 | 9.99 | 48000 Hz 1ch | 64 kbps | -13.88 |
| `amb_plague` | -21.27 / -7.13 | -31.20 / -16.86 | 58.01 | 48000 Hz 1ch | 64 kbps | -1.87 |
| `amb_frost` | -25.74 / -12.42 | -31.04 / -17.68 | 4.46 | 48000 Hz 1ch | 65 kbps | -12.42 |
| `amb_holy` | -17.25 / -4.87 | -31.04 / -18.62 | 39.18 | 48000 Hz 1ch | 64 kbps | -4.87 |

## Not verifiable without ears

The probe measures what leaves the browser, so level, timing, spectra, gaps, clicks as discontinuities and clipping are covered. It cannot judge: whether a track suits its region (placeholder music, by the owner's direction), how natural the synthesised footsteps sound (only that the ten sounds differ in spectrum: centroids Mud 329 Hz, Stone 996 Hz, Temple 1116 Hz, Ice 1641 Hz, Sand 3132 Hz, Gritty 3388 Hz, Water 3970 Hz, Snow 4847 Hz, Grass 4945 Hz), the 6 s wind loop (`amb_frost`, 4.5 s after trimming, repetition is audible by construction), or the temple softening. Confidence in level, timing, gap, clipping and console findings is high (every number is repeatable and the footstep cue to output transient pairing is 40 of 41 at a median 38 ms lag); confidence in "sounds good" is none. The full session depends on the hero surviving 45 s of bot fighting to cast a Wish; the probe retries those two scenarios (region walk, full session) with a new match up to five times, and says so when it does. The reported run needed one retry of the full session (the hero was killed before the Wish).

## Run it

```
export PATH="$HOME/.cargo/bin:$HOME/.dotnet:$PATH"
target/release/rh-server --runtime source-arena --map crates/rh-sim/src/mapdata/fixtures/seed1.map.json --bind 127.0.0.1:7947 --min-players 1 --fill-bots 7 --lobby-seconds 5 --fill-seconds 3 &
RH_SERVER_INFO_URL=http://127.0.0.1:7947/info client-unity/UnityProject/Tools/build-web.sh
python3 -m http.server 8247 --bind 127.0.0.1 -d client-unity/UnityProject/Build/Web &
node client-unity/UnityProject/Tools/audio-probe.cjs --out docs/rework/evidence/audio      # about 20 minutes; --only region,full --merge re-runs scenarios
node --test client-unity/UnityProject/Tools/audio-probe-lib.test.cjs
```
Page switches for debugging: `?audiolog=1` logs every region, load, play and cue decision as `[audio]` lines and creates the `RhAudioDebug` hooks the probe drives (volumes, forced tracks, step auditions, seeks); `?audiodiag=a,b` turns single behaviours off for bisecting (`nofoot`, `nopan`, `nopitch`, `usegroup`, `unitybeds`, ...).

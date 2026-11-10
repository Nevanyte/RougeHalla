| Assertion | Result | Detail |
|---|---|---|
| decoded peak of every file is below -1 dBFS | PASS | `{"over":[]}` |
| no file has a sample discontinuity at its loop point (jump > 0.05 and click ratio > 12) | PASS | `{"clicks":[]}` |
| launch screen is silent | PASS | `{"n":118,"rmsDb":-120,"peakDb":-120,"windows":334,"ctx":"running"}` |
| planning screen is silent | PASS | `{"n":89,"rmsDb":-120,"peakDb":-120}` |
| no audio file requested before the match | PASS | `[]` |
| web audio context is running | PASS | `"running"` |
| region music audible within 5 s of the region audio gate opening | PASS | `{"firstRegion":{"t":15753.39999961853,"region":"frost"},"firstMusicPlay":{"t":15887,"id":"music_frost"},"audibleAfterMs":292,"matchActiveAt":14898}` |
| only the spawn region files are requested before the first border | PASS | `{"spawn":"frost","requested":[{"file":"music_frost.mp3","status":200,"tMs":15754},{"file":"amb_frost.mp3","status":200,"tMs":15757},{"file":"music_plague.mp3","status":200,"tMs":30490},{"file":"amb_plague.mp3","status":2` |
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
| loop seams are inaudible: no dropout and no level jump beyond the track's own dynamics (200 ms windows) | PASS | `{"badTracks":[],"rows":{"music_fire":"8.13/5.29","music_sentenced":"8.7/10.04","music_plague":"5.54/3.3","music_frost":"3.7/3.72","music_holy":"3.65/7","music_coliseum":"4.22/5.14","amb_fire":"7.73/5.34","amb_sentenced":` |
| halving the music and ambience volumes lowers the output by about 6 dB | PASS | `{"baseDb":-25.08,"halfDb":-30.07,"deltaDb":4.99}` |
| volume 0 silences the output (mute) | PASS | `{"n":69,"rmsDb":-120,"peakDb":-120}` |
| restoring the volume restores the level | PASS | `{"baseDb":-25.08,"backDb":-24.49}` |
| the Audio switch off silences everything and fetches no audio | PASS | `{"off":{"n":276,"rmsDb":-120,"peakDb":-120},"requests":[]}` |
| headroom: peak with music, ambience, footsteps and combat stays below -1 dBFS | PASS | `{"n":1725,"rmsDb":-21.68,"peakDb":-2.6}` |
| combat cues are logged and produce output | PASS | `{"combat":48,"cueKinds":{"combat.melee.swing":48,"mob.antlion.hit":5,"(fallback)":58,"mob.antlion.death":1,"wish.swarm":1}}` |
| a Wish cue is logged and produces output | PASS | `{"wish":1}` |
| no console line matching FMOD | not loaded yet | AudioContext was not allowed in any session | PASS | `{"sessionsChecked":9,"count":0,"first":[]}` |

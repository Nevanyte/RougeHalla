| Assertion | Result | Detail |
|---|---|---|
| decoded peak of every file is below -1 dBFS | PASS | `{"over":[]}` |
| no file has a sample discontinuity at its loop point (jump > 0.05 and click ratio > 12) | PASS | `{"clicks":[]}` |
| launch screen is silent | PASS | `{"n":118,"rmsDb":-120,"peakDb":-120,"windows":340,"ctx":"running"}` |
| planning screen is silent | PASS | `{"n":89,"rmsDb":-120,"peakDb":-120}` |
| no audio file requested before the match | PASS | `[]` |
| web audio context is running | PASS | `"running"` |
| region music audible within 5 s of the region audio gate opening | PASS | `{"firstRegion":{"t":17256.900000095367,"region":"plague"},"firstMusicPlay":{"t":17429.799999713898,"id":"music_plague"},"audibleAfterMs":276,"matchActiveAt":16416}` |
| only the spawn region files are requested before the first border | PASS | `{"spawn":"plague","requested":[{"file":"music_plague.mp3","status":200,"tMs":17258},{"file":"amb_plague.mp3","status":200,"tMs":17261},{"file":"music_frost.mp3","status":200,"tMs":30134},{"file":"amb_frost.mp3","status":` |
| every requested file belongs to a region the player actually entered | PASS | `{"regions":["plague","frost","plague"],"stray":[]}` |
| no audio request failed | PASS | `[{"file":"music_plague.mp3","status":200,"tMs":17258},{"file":"amb_plague.mp3","status":200,"tMs":17261},{"file":"music_frost.mp3","status":200,"tMs":30134},{"file":"amb_frost.mp3","status":200,"tMs":30140}]` |
| walk crossed at least two borders | PASS | `{"spawn":{"t":16655,"region":"plague"},"regions":[{"t":16655,"region":"plague"},{"t":30131.699999809265,"region":"frost"},{"t":43189.59999990463,"region":"plague"}]}` |
| the first region audio is for the region the player spawned in | PASS | `{"gate":{"t":17256.900000095367,"region":"plague"},"regionLogBeforeGate":{"t":16655,"region":"plague"}}` |
| crossfade plague -> frost: no silent gap, no bump, no deep dip | PASS | `{"from":"plague","to":"frost","regionChangedAt":30132,"newMusicPlayAt":30274,"loadDelayMs":142,"before":-23.86,"after":-25.2,"minDb":-26.11,"maxDb":-22.69,"dipDb":0.91,"bumpDb":1.17,"silentMs":0}` |
| crossfade frost -> plague: no silent gap, no bump, no deep dip | PASS | `{"from":"frost","to":"plague","regionChangedAt":43190,"newMusicPlayAt":43191,"loadDelayMs":2,"before":-23.76,"after":-23.91,"minDb":-25.27,"maxDb":-22.17,"dipDb":1.36,"bumpDb":1.59,"silentMs":0}` |
| snow, sand, stone and water have measurably different spectra (centroid ratio of every pair >= 1.12) | PASS | `{"centroids":{"Snow":4551,"Sand":3187,"Stone":1188,"Water":3928},"minPairRatio":1.16,"all":{"Snow":4551,"Sand":3187,"Grass":4907,"Mud":299,"Water":3928,"Bog":195,"Stone":1188,"Temple":1055,"Gritty":3301,"Ice":1458}}` |
| every footstep sound is audible in the output (peak above -50 dBFS) | PASS | `{"measured":10,"minPeakDb":-4.9}` |
| footsteps stay subtle: loudest single step (gain 1, SFX 0.85) peak below -12 dBFS | FAIL | `{"maxStepPeakDb":-3.6,"perSound":{"Snow":-4,"Sand":-3.9,"Grass":-3.9,"Mud":-4,"Water":-4.1,"Bog":-3.6,"Stone":-4.4,"Temple":-4.9,"Gritty":-4.2,"Ice":-3.8}}` |
| SFX volume halves the step level by about 6 dB | PASS | `{"fullDb":-4.23,"halfDb":-10.49,"deltaDb":6.26}` |
| SFX volume 0 silences steps | PASS | `{"peakDb":-120}` |
| other actors step quieter than the local player, mobs quieter than players (isolated, same surface, 3 tiles away) | PASS | `{"Local":-18.7,"Player3tiles":-28.1,"Mob3tiles":-32.5}` |
| footstep cues appear while walking | PASS | `{"localCues":29}` |
| at least 85% of local footstep cues have an output transient near them | PASS | `{"cues":29,"matched":29,"medianLagMs":37.733332951858756,"thresholdDb":-50}` |
| transient rate matches the cue rate within 15% | PASS | `{"cueIntervalMs":267,"peakIntervalMs":253}` |
| no local footsteps and no unexplained transients while the player stands still | PASS | `{"localCuesWhileStanding":0,"unexplainedPeaks":0,"windows":168}` |
| the six music tracks sit within 2 dB of each other (RMS, alone, volume 1) | PASS | `{"spreadDb":0.67,"tracks":{"music_fire":-21.6,"music_sentenced":-21.01,"music_plague":-21.09,"music_frost":-20.93,"music_holy":-21.13,"music_coliseum":-21.09}}` |
| ambience sits clearly under music (mean music minus loudest ambience >= 6 dB) | PASS | `{"musicMeanDb":-21.1,"ambienceMaxDb":-31.02,"ambience":{"amb_fire":-31.02,"amb_sentenced":-31.04,"amb_plague":-31.2,"amb_frost":-31.05,"amb_holy":-31.06}}` |
| no track clips (peak below -1 dBFS) at volume 1 | PASS | `{"maxPeakDb":-4.84}` |
| loop seams are inaudible: no dropout and no level jump beyond the track's own dynamics (200 ms windows) | PASS | `{"badTracks":[],"rows":{"music_fire":"8.56/4.89","music_sentenced":"8.37/10.05","music_plague":"5.54/3.25","music_frost":"3.43/3.72","music_holy":"3.56/6.96","music_coliseum":"3.66/5.05","amb_fire":"7.62/5.42","amb_sente` |
| halving the music and ambience volumes lowers the output by about 6 dB | PASS | `{"baseDb":-24,"halfDb":-29.88,"deltaDb":5.88}` |
| volume 0 silences the output (mute) | PASS | `{"n":69,"rmsDb":-120,"peakDb":-120}` |
| restoring the volume restores the level | PASS | `{"baseDb":-24,"backDb":-23.96}` |
| the Audio switch off silences everything and fetches no audio | PASS | `{"off":{"n":276,"rmsDb":-120,"peakDb":-120},"requests":[]}` |
| headroom: peak with music, ambience, footsteps and combat stays below -1 dBFS | PASS | `{"n":1161,"rmsDb":-23.58,"peakDb":-7.53}` |
| combat cues are logged and produce output | PASS | `{"combat":49,"cueKinds":{"combat.melee.swing":49,"(fallback)":43}}` |
| a Wish cue is logged and produces output | FAIL | `{"wish":0}` |
| no console line matching FMOD | not loaded yet | AudioContext was not allowed in any session | PASS | `{"count":0,"first":[]}` |

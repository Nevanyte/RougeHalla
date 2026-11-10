# M5 Pro backend comparison — first bounded run

Both backends completed600 normally delivered simulation steps in30 seconds (20Hz) on the same captured160×160 collision map, with three ordinary Holy players and the same movement commands after a10-second warmup. This is the frozen P14 demo native build, not Claude's newer netcode WIP. No Unity/browser ran.

| Measured process cost | Rust demo | Legacy Node/Colyseus |
|---|---:|---:|
| CPU, % of one core | 6.69% | 5.46% |
| CPU time over inner sampled interval | 1.940s /29.0007s | 1.583704s /29.0234s |
| Sampled RSS | 18.38–18.48MiB | 191.58–191.88MiB |
| Observed steps over30s | 600 | 600 |

Rust used about90.4% less resident memory. These are game-server process RSS figures; PostgreSQL and client/browser processes are excluded, so they are not total backend memory. The CPU point estimate was22.6% higher for Rust; this run demonstrates no CPU speedup. Both owned backend processes and their listeners were independently confirmed closed. Native normal Leave persisted3 results with0failed/refused; all three players were alive at each measured boundary.

This is one sequential run on an actively used M5 Pro with other apps and Rust tests running, not an isolated capacity result or statistically established regression. Native uses900u/LOS interest while legacy publishes global schema/FX; ambient RNG, gameplay coverage, storage and publication differ. CPU samples cover the inner~29seconds and use different precision (macOSps centiseconds vsNode microseconds). Measured server20Hz is configured cadence, not maximum capability. No FPS, game RTT, bandwidth or input-to-visible result is claimed.

Native room-lifetime pre-publication step timings were p50=2559us/p99=3583us/max=4690us, with0lateWakes/0droppedSteps over1152 roomticks. These include room intake/seat/lease work plus Sim, exclude publication, and span setup/warmup/measurement; they are not directly comparable to legacy rolling stepping-wake timings. Legacy measured0reanchors. Do not subtract quantiles or infer a maximum FPS.

Raw source hashes, actual command samples, process intervals, cleanup receipts and limitations are pinned in RESULTS.json; the separate backend-paired-metrics-definitions.md explains timing scopes. Private legacyprofiles.json was never copied/read into reports. No worktree source, Unity asset or userWIP was modified for this run.

## Repository evidence

[RESULTS.json](RESULTS.json) records the arithmetic and limits. [Native raw report](native-report.json), [legacy measured boundaries](legacy-measured.json), [legacy process samples](legacy-process.json), [legacy input events](legacy-events.json) and [shared workload](workload.json) retain the actual inputs. Both independent cleanup receipts confirm owned children/listeners absent. The manifest pins exact bytes. Private profile storage was excluded.

The latest source-affecting normal CI at `02551405894895baa26b3fb91876dd7e153f9155` is now [green](https://github.com/Nevanyte/RougeHalla/actions/runs/42743407229); its latency workflow also passed. See [source-ci.json](source-ci.json). This is a revision-scoped result, not approval of Claude's ongoing Unity/netcode WIP.

## Separate CPU diagnostic

After the original pair, one additional same-workload frozen-native run was sampled for10seconds at1ms using macOS `/usr/bin/sample`. The child ownership was checked before attaching; both controller/sample exit0 and owned process/listener cleanup independently pass. These profiled-run timings do not replace the unprofiled comparison.

The [verbatim trace excerpt](cpu-diagnostic-excerpt.txt) identifies repeated vision-trail/line-of-sight work, plus Frost structural-source and Sentenced mark scans, as candidates for focused investigation. Most samples are idle worker waits. Top-of-stack counts are statistical observations, not exclusive CPU percentages, cycle counts or a demonstrated optimization. Full raw trace is preserved outsideGit at the path/hash in MANIFEST.json. No runtime change or new speedup is claimed by this diagnostic.

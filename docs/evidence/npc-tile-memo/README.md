# NPC remembered-tile observation cache

The M5 CPU trace identified repeated `observe_with`→vision-history/LOS queries. `ItemObserver` now reuses its existing `TileVisionCache` for NPC point visibility as well as props. Table sizing/capacity and history invalidation are unchanged; no additional cache table or canonical/wire field was added. Direct current-point LOS, wards and NPC hidden state are still evaluated fresh. The FX-report path is unchanged.

Cache begin moved from conditional prop candidate generation to every preparation for the actual present viewer after the earlier-tick refusal. This covers repeated same-tick observations and discarded offers. The private raw observation implementation accepts an optional tile memo; a cfg(test) wrapper retains the unchanged uncached path as the oracle. Invalid points delegate to that exact path, avoiding NaN's numeric tile0 alias.

Four new native differential controls compare complete raw observations and unchanged canonical state across trail coalescing/expiry, same-tick movement/hidden/death, discarded history/clone/restore/reconnect, precise same-tile LOS and invalid numeric points. They assert an enabled memo and a meaningful positive tile0 control. The same-tick lifecycle test first commits tick5 and then tick6 to warm the memo before clearing history on a same-tick clone; the first cold-only arrangement was corrected during source review. These are native optimization controls, not newly captured legacy parity.

The first compile caught a test-only `Mob.status` field error (`FighterCore` does not own it). That failed result is retained; Root corrected only the fixture field. All four new tests then passed. Existing vision/ward/gate/lifecycle tests, moving-trail zero-warm-allocation pressure test, unchanged content golden checks, full-faction headless PvE, strict all-feature/all-target rh-sim Clippy and formatting all pass; exact command/results/logs accompany this file. The allocation result covers its existing declared prop workload, not a new blanket NPC allocation claim.

Two focused independent source reviews found no public, canonical, rules, tick-order, actor-reference or hidden-information change. No source fixture, identity, dependency or Unity asset was changed. The original6.76% one-core/18.88MiB measurement remains the baseline; the post-change run is retained below. The technical-demo cloud window is closed; this work uses local backend services only.

## One post-change process measurement

The clean code cut85e2d7c2a80d03792e9c544ae8f708e524e8e9c8 built an optimized PostgreSQL-enabled Mac release, SHA903b701de6530f2aa5a495b9d60b47457814c0c1d61d080bd07c89b3116cf7fd. Compiler/Cargo, feature set, debug level,4jobs and incremental0 match the preceding baseline. The controller changes only its frozen binary path/hash; map, actors, normal Plan/Move/Stop recipe, warmup,30s window, Node/helper/codec, identity and cleanup checks remain unchanged.

| Process observation | Before NPC memo | After NPC memo |
|---|---:|---:|
| CPU time over inner sample span | 1.960s /29.0007s | 1.280s /28.9996s |
| Percent of one CPU | 6.76% | 4.41% |
| Sampled server RSS | 18.78–18.88MiB | 18.48–18.61MiB |
| Delivered ticks / game time | 600 /30s | 600 /30s |

The CPU point estimate is34.7% lower in this run. This is promising evidence, not a statistically established or fully causal gain: private spawn choices/rendezvous/reveal history, ambient events, room lifetime and background workstation load differed. Room-step quantiles also changed even though the new memo is in publication, underscoring that variation. There was one attempt and no favorable retake. These are game-server process figures, excluding PostgreSQL/client processes; they are not maximum throughput, FPS or a complete matched Rust/Unity-versus-legacy result.

All90 measured ordinary command rows, preceding acknowledgements, alive/Source/faction gates,3same-room owners and600tick/30000ms deltas pass. The whole-room report over1204ticks records0lateWakes/0droppedSteps and0frame/snapshot refusals; these are not isolated-window histograms. Normal Leave persists3results with0failed/refused, returns rooms/players to0 and exits the owned native child. Root independently confirms PID96277 and the17937 listener absent. Exact reports and release metadata accompany this file. No existing local service or public artifact was replaced; the cloud demo remains closed. Normal CI for this new code is the next integration gate.

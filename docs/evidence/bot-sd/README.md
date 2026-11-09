# Source and native player sudden-death retreat component

Base: `0489fa9f2e2168857588d0e3bd9548fbcdfe5f52`. Source/tools: `01e480c19c8c5072d1cdab3078602b6053d89a0b`. Native code: `024c052aad702adb756a99181edf6b7ea5e9942a`. Existing normal-fight67-frame, brain-prefix, world, mob-hunt and other corpora remain immutable. The existing actual-source brain-prefix and normal-fight rigs use suddenDeathAt0 and do not capture this branch. The existing pure `mob_hunt::retreat_point` already has source evidence and is reused unchanged; this packet adds the missing stateful Retreat/SD consumer.

## Actual source witness

New `parity/policy/bot-sd/source.json`: **418550 bytes**, SHA256 **55e8565e6a896b91deb49cdd8e290f568dec8013a1af4ac3eb72aec56bb65f7c**. Eight chronological sequences/46 frames invoke real source `createTactics` (its real Fight/Retreat/Reflex dependencies), Memory, Knowledge and PathService. Source returns, public stats, actual memory stimuli, geometry-projected path calls/results/counters/budget, input views and four RNG suffixes are recorded. Real shared circle/LOS/distance validates the placements. Independent real Reflexes confirms null/zero hold/no draws; the real Tactics dependencies still execute. No private SD/knowledge/cache result is forced.

Inputs are declared **method probes**, not earned World outcomes, physics reachability, ordinary rewards, decoded public frames or gameplay producer proof. HP/maxHP, visible opponent bar and arena clock are explicit probe inputs, including f32-representable HP values on each side of the actual binary642% comparisons. Constant health over long SD clocks is a declared method input, not a claim that World burn left health unchanged. Full views use the unchanged normal-rig helper; missing public values are not inferred by a live adapter. Source derive code/tags are read from actual source. Wrapped generators forward each actual draw unchanged; next values come from fresh independent replays, never extra active draws.

The corpus covers:

- The actual one-time knowledge draw versus unknown seed, clock0/future/exact start/exit.
- HP-lead entry/reentry and retained negative-band hysteresis, including nearby public f32 health values.
- Strict340u distance, one Stop while held, inside retreat, ordinary world-goal leave and reissued stand-off.
- Real Retreat reuse, exact48u arrival, changed threat distance,1199/1200ms cache boundary; fresh destination changes make the effects observable.
- Cornered failed retreat falling through to real normal combat; seen→remembered→reentry→actual35s expiry; SD touch postponing the existing progress watch followed by exact10s running/10001ms failure.

`capture.log` captures then byte-checks in pinned Node22.23.4 Linuxamd64. `external-source.log` is another byte-exact check from a clean `git archive` export of frozen source01e480c1, fresh container and tmpfs dependencies. The already-cached image is pinned; no independent third-party execution is claimed. All dependencies/caches and mutation copies use memory mounts, with source mounted read-only.

**12 compiled source semantic mutants killed**: knowledge/time gates, HP band/hysteresis,340 boundary, quiet held,1200/48 cache boundaries, changed threat, progress touch, seen gate and leave/held reset. Pristine/restored and comment-only provenance nonkill pass. `controls.json` pins all15 raw control logs. Mutants edit unique actual TS sites in tmpfs and execute through tsx; compilation/tool failures do not count as kills. Comparison omits only profile/provenance. Source/capture/tools and existing oracle outcomes are never edited to make a candidate pass.

## Native result and validation

The normal component now implements the source SD branch: actual owner HP/maxHP ratio minus the visible/remembered bar, learned knowledge/time/visibility eligibility, strict band hysteresis, cached retreat and cornered fallback, stand-off quieting and progress touch. The existing one-player pure retreat helper supplies candidates; no new geometry/tuning table is introduced. Held state clears on the same real order/leave/new-engagement paths as source. Full reset drops the real reached cache/stand-off state without draws.

`Owner` now requires explicit `hp`/`max_hp`; its missing-owner/inventory/lock and finite-data guards still precede memory/RNG mutation. The source conditional for a **present** nonpositive maxHP remains source behavior, not a substitution for an absent fact. The previous active-SD unsupported refusal is replaced by captured source behavior. Its old atomic arena negative now checks a nonfinite clock; it is not skipped or weakened. New controls start from a reached real method cache/held state, refuse nonfinite health or clock atomically, then verify complete reset.

**8 focused native tests PASS**: two new SD tests plus all six retained normal tests. They consume every new46 and prior47 Tactics/20 OrbWalk frame plus the direct Fight call. Every result field/order/text/status/priority, clock bit, actual four-stream state/next value, source stats boundary, path counters/budget and owner-motion clock is checked. Coordinates use the existing six-decimal comparison; there is no timing/eligibility/HP/RNG tolerance. The captured full source memory-stimulus array and raw diagnostic path-call array are not claimed as complete native memory/call-array parity. No native source mismatch occurred.

Scoped `cargo clippy -p rh-policy --all-targets --all-features -- -D warnings`, `cargo fmt --all -- --check`, script syntax and `git diff --check` pass. Runtime Rust1.97.0, jobs1, dev/test debug0, incremental0; the same exclusively owned prior `bot-fight-native/target` was reused. Initial native log records3.1GiB free. No other target/cache was touched. No full workspace, maps, old source campaign, Editor, cloud or benchmark rerun. Prior connected/delivery controls from0489 remain a separate receipt on byte-identical live code, not additional tests run/counts in this packet.

## Public facts and continued live HOLD

SD reads the owner's already-public current HP/maxHP, complete public arena suddenDeathAt, current visible opponent HP bar/position, public map and previously observed memory. A future accepted-frame adapter must preserve source bar quantization/positive sliver, owner f32 values and absolute clock, and refuse unavailable owner/arena facts; it cannot manufacture clock0, full enemy HP or a private current hidden state. Reentry/expiry uses actual earlier public observations. The current method input has no Frame14 constructor and is not a delivery receipt.

Full remote Bow/Wand/projectile facts, actual reflex/hold and FrameRing consumers, complete pending/event memory and the accepted-frame→HumanBot→humanizer→validate/submit launch/away/relock proof remain required. Source strategy/candidate selection, multi-threat flee/hunters/loot, NPC continuity and tournament outcomes stay separate. No live dispatch, policy/sim/protocol/header/content/tape/lock or shared status is changed. Root owns composition/admission; the worker stops after this component packet.

# Actual NPC runner/Brain callsite evidence

This additive packet closes the omitted live-caller filter/cadence gap in `76ea6b995d3f2d7f844c1ff65f9a0750094a68c7` for one earned living-return history. Source commit `6642449803d0b36c328642cb64be25756c41c94e` adds five new tool files and one new fixture. Old source, corpora and evidence remain unchanged. No policy rule is corrected or admitted here.

Actual `createBotRunner(vision:true)` and actual `createBrain` (normal/farmer, enabled source modules, real path services, NO_BIAS, original derive streams) consume the actual encoded patches from the same 773-step World history. The real runner performs `BotVision.update -> perceive(local canSee, lastMinimap) -> real FrameRing -> vision.filter -> original Brain.tick`. Memory is observed through its existing closure after the entire tick returns. No fake Brain/filter, extra Memory.observe, installed state or changed original return is used.

## Result

| Public-input schedule model | Runner calls / actual Brain ticks | First dead belief | First post-filter living resight | Memory on resight | Filter changed Percepts |
| --- | --- | --- | --- | --- | --- |
| Network-style, every patch, 0/100 ms self/world delay | 773 / 771 | 31,750 ms | 38,050 ms | false | 0 |
| Default manager phase 0, every fourth patch, 30/130 ms | 194 / 193 | 31,650 ms | 38,250 ms | false | 3 |
| Default manager phase 1 | 194 / 193 | 31,800 ms | 38,400 ms | false | 2 |
| Default manager phase 2 | 194 / 192 | 31,750 ms | 38,350 ms | false | 3 |
| Default manager phase 3 | 194 / 192 | 31,700 ms | 38,300 ms | false | 3 |

The caller filter is material to the manager traces: at their first false-belief calls it removes the target dot from a delayed minimap without changing that minimap's timestamp. For phase 0 at 31,650 ms, the preceding delivered map timestamp is 31,250; the current pre-filter map is timestamped 31,450 and contains `mob1`, while the post-filter map keeps 31,450 and omits it. Memory marks it dead. The network-style case has identical pre/post-filter Percepts yet reaches the same stale belief. The filter therefore changes relevant inputs/timing in some tested schedules, but does not prevent the outcome in any of these five models. Actual strategy/think cadence runs after Memory and supplies no repair in this replay.

The World/source mob stays alive throughout the regenerated history. Every later resight listed above is a real post-filter Percept with the actor's source status `alive`, while the actual closed Memory record remains `alive=false`. This settles the narrow caller explanation for this history; it does not establish product intent, label a source bug, or prove all live bot histories.

[CALLSITE.md](CALLSITE.md) gives exact source ordering/configuration and the conditional interpretation. [result.json](result.json) is a compact source-derived result with first-false input pairs and control hashes. [DECISION.md](DECISION.md) gives a minimal candidate semantics and concrete decision for Root/owner review.

## Same earned inputs, actual caller and passive observer

The unchanged old capture re-executes its real World, source human callbacks and original method witness. The entire regenerated old artifact must match `15c3dbc1f5d718859413e8dbb9891602dd49870f10dae4f12dc3152e2c57de96` byte-for-byte. A passive Schema Decoder wrapper copies each actual byte view without changing receiver, arguments or return. All 773 byte lengths/hashes, clocks and FX references match the corresponding source row. Metadata comes from the freshly regenerated result; canonical fixture values are an oracle only, never installed into World/decoder state. The exact source map argument is read with the retained pinned helper, not reconstructed from expected outcomes.

Actual source Brain/ring functions execute unchanged behind identical recording wrappers. All five profiles run observer OFF and ON from identical configuration/seed/modules/map/history. The capture compares the **complete** recorded Frame, pre/post-filter Percept, original tick output, adapter attempts, runner results, logs, goal and stats, preserving undefined/nonfinite values and source ordering. Every control passes byte-for-byte. The canonical artifact retains the ON trace and both equal trace hashes, plus measured OFF and ON inspection lifetimes; no private field normalization is used to make the control pass. Here “public trace” means the observable runner/Brain API trace for noninterference, not permission to publish every audit field to a game client.

The retained `inspectClosure` helper installs `()=>memory.view` at the first original tick **entry**. Its reference is retrieved after that whole tick/runner return; the debugger/session closes before the first ordinary getter read. These are post-whole-tick Memory snapshots, not immediate post-observe/pre-context snapshots. Original Brain context/module/strategy/tactics/humanizer ordering still executes. ON records one actual Session, restored connect method, completed close, real `ERR_INSPECTOR_NOT_CONNECTED` on post-after-close, no helper globals and zero pre-disconnect reads. Getter/helper/session references are nulled in finally and replay state resets. OFF records zero Sessions/getter reads, unchanged global presence/values and released null references. Source-input observation likewise restores Decoder descriptor/function, argv, Math.random and its owned temporary directory; its exact old-artifact match controls input-observer noninterference. No garbage-collection claim is made.

Every actual command proposal is recorded/refused (21 per profile) and no command is applied to World. This is an **open-loop** source caller experiment. Models preserve network-style per-patch or default-manager phase/delay settings; actual BotClient socket behavior, BotManager seat lifecycle/multi-seat startup contention, outgoing command jitter/rate/validation, private vision/reconnect messages, closed-loop actions, survival, match quality and humanizer acceptance are unproved. Actual full-state Schema snapshots are used, not socket/delta frames. Fixed source timestamps and declared delays are not physical network/performance measurements.

## Verification and seal

Canonical [source.json](../../../parity/policy/npc-runner-callsite/source.json) is **30,636,484 bytes**, SHA-256 `0c9344109283d2cf848c83892924071e9277f163d79e69e3c634c3d19c7f4a58`. Full traces are retained for audit; no additional World scenario or broad campaign is implied by their size.

- Final pinned Linux amd64 Node 22.23.4 capture plus **one byte-exact check** pass, including five OFF/ON controls: [raw log](logs/capture-and-bytecheck.log), elapsed 23.543 s. Image/dependency/cache/source-mount pins are in the profile and tool README.
- All **357 pins** match: 333 source, 9 config, 8 frozen support inputs, 2 contracts, 5 new tools. All 352 baseline inputs match exact base Git. The inventory is an explicit superset; not every pinned file is claimed executed.
- Read-only [static audit](logs/static-audit.json) rehashes all five complete public traces, checks all 773 source snapshot references, measured lifetimes and refused commands. It runs no additional gameplay/capture campaign.
- The first passing candidate omitted outer retention of the already-measured OFF lifetime object. Its exact old artifact is preserved losslessly in [attempts](attempts/before-off-lifetime-receipt/README.md). Final JSON differs only by those receipt objects and the capture tool hash; all source/Percept/cue/output/Memory data remain identical. No source or Brain behavior changed for that correction.
- Finite cross-review found no other blocker after the OFF-receipt and callsite-prose corrections. No old mutant campaign, native/Rust/Editor/browser/cloud or hidden replacement pair was run.

[receipt.json](receipt.json) pins the source commit. [manifest.json](manifest.json) seals source, baseline guards and all evidence except itself; the separate evidence commit seals the manifest. Root owns independent review/merge and any intended/fair semantics decision. No source/native/P15/ABI/identity/tag/budget/shared status/lock/main change is made. This packet stops at the actual caller evidence boundary.

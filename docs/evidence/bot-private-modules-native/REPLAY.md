# Frozen source replay — complete private modules

**Gate: `PARITY_TOTAL bot-private-modules : 255 cases / 3259 ops (corpus 3259) / 0 failures`.**

## Authority / input pins

| Fact | Value |
|---|---|
| Corpus | `parity/policy/bot-private-modules/source.json` (`rh-bot-private-modules-source/1`) |
| Bytes / SHA-256 | 12,755,158 B / `645e85f16adbea001f8d0e06a70b6e5d311864ed9691622c06b789c95578b012` |
| Coverage / controls / manifest | `coverage.json` 1,832,252 B `50eaf16f…dea0af`; `controls.json` 1,403,852 B `dcc49cf8…d3980d`; `manifest.json` 5,566,949 B `fe8fe10f…5ab016` |
| Source candidate | `d48b79bf` + independent review `63f6fda8`; record `methodValue` `rh-method-value/1` |
| Corrupt corpus handling | strict raw duplicate-key rejection + atomic typed conversion; no case/op silently skipped |

Per-suite case/operation counts (sum 255 / 3,259):

| Suite | Cases | Operations |
|---|---:|---:|
| choice | 11 | 1,605 |
| hunter | 39 | 113 |
| chests | 34 | 284 |
| planning | 24 | 360 |
| wishes | 95 | 722 |
| hazards | 51 | 154 |
| registry | 1 | 21 |

## What the replay drives and compares (`crates/rh-policy/src/bots/temporal_percept/modules/source_tests.rs`)

Per case, fresh instances of all four modules, the case hunter, and a fresh `Registry::with_defaults()` (the source
`WeakMap`-equivalent is a fresh cfg-object identity per case; per-case `CfgToken`). Per cfg: admitted `Knowledge` is
constructed from its declared full tier with the independent seed+3 knowledge lane and its 70 draws are compared as the
case `setupTranscript`; admitted `Memory` is created through `MemoryConfig`; a real admitted `RoomPathService` is created
on the embedded declared map with the declared budget; the decide/motor/lapse lanes are real mulberry32 streams wrapped in
a recording trace (draw count and binary64 value per draw).

Per operation, in declared order, the harness executes exactly the source method (observe/noteSent/recordChoice/helper/
hunter.decide/markDone/tried/inspect/registry.*/hook) and compares, exact and ordered:

1. **result** — observe stimuli; helper numbers-bit-exact (incl `-Infinity`/`+Infinity`); `enabled` bool; goals list;
   intents list (full object field order, optional fields only when owned); act output `{intents,status,attacking}`;
   adjust intents + source-observable `returnedInputList` identity; hunter decision `{kind|kind,chest,option,why|...walk}`
   or `{target,stats}`; registry lists, policy presence/identity.
2. **contexts after every operation, for every cfg** — the admitted Memory view encoded in the source `memorySnapshot`
   shape (`fighters,mobs,camps,containers,self,stimuli,bounties,choices` with exact own-key order), cumulative per-lane
   draw counts, and the path service `{searches,hits,fallbacks}`.
3. **hunter** after every operation — the source `ChestHunter` own-property capture in source order
   (`cfg,log,stats,done,walking,stalls,walks`; done Set order, stalls/walks Map insertion order, cached `len:null`) plus
   `target` and `stats`, and the initial state.
4. **callbacks, in order** — `{sequence,kind,cfg,name,args,result}` and rng draws
   `{sequence,kind,cfg,stream,index,value}`. Declared source objects (not narrowed native values) are passed as callback
   arguments: `paths.setFrame[now,gatesLocked]`; `paths.walk/los[declared self record, declared chest row]`;
   `paths.clear[declared self record, fresh {x,y}]`; `paths.collisionMap[] -> complete declared map value`;
   `hunter.walk/sight[declared chest row]`; nested `hunter.walk` before `paths.walk`; `learned.bias[key] -> raw declared
   number`; `services.log[message]`; `hunter.log[message]`; `custom.enabled[token, features] -> bool`.
5. Initial setup — the 70×(cfg count) knowledge-lane setup draws and the initial contexts/hunter capture.

Two interleaved cfg tokens continue/isolate module state exactly as the source `WeakMap<object, State>` does
(chests/planning/wishes/hazard two-config cases), and a `goals` call on the chests module uses a fresh temporary hunter so
repeated goals never spend the retained act-hunter stall record.

## Execution receipts (this worktree, Rust 1.97.0, locked/offline/jobs1, incremental0, debug0, worktree-local target)

```
CARGO_TARGET_DIR=$PWD/target-deepseek-private-modules CARGO_INCREMENTAL=0 CARGO_PROFILE_DEV_DEBUG=0 \
  /Users/nevinmckinnon/.cargo/bin/cargo test -p rh-policy --lib --locked --offline -j1 \
  frozen_private_modules_source_replay -- --nocapture
=> exit 0
PARITY_TOTAL bot-private-modules : 255 cases / 3259 ops (corpus 3259) / 0 failures
test result: ok. 1 passed; 0 failed
```

The replay test also verifies the corpus case/operation totals before driving it, so a truncated/filtered run cannot
pass as the packet gate (an `RH_MODULES_SUITES` filter exists only for lane debugging; it asserts selected-case counts
and is never the gate).

## First-failure history (kept, not erased)

The replay initially failed in intake and then in individual comparator channels; each first failure was kept and fixed
without relaxing comparison (full list in RUNS.md):

1. corpus intake: map DTO + `cfg.learned` nonfinite exemption + own-`undefined` mob `type` + per-HelperName self shapes —
   all intake/witness defects fixed in the reader, not in expectations;
2. `contexts` keyed by cfg id instead of the declared cfg token;
3. planning no-deal ready path re-borrowed a nonexistent deal (adapter panic);
4. registry `policyGet` absent/absent identity (`null === null` is source `true`);
5. Send-compat mechanical change (Arc persistent callbacks) — replay re-run green afterwards.

No numeric tolerance was used at any point; no expectation, fixture, source or golden was edited.

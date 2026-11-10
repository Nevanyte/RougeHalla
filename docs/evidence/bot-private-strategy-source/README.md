# Private strategy Phase A source freeze

Prepared in isolated backend-gameplay-quests, with actual legacy implementations unchanged from source base
`4151b3af597cc06d1b3b77f4e3e21cc9906b6a86`. Parent integration commits add backend policy/docs; this source worker writes
only new tools/bot-private-strategy-fixtures, parity/policy/bot-private-strategy and this evidence directory. All Rust
belongs to DeepSeek. No source implementation, existing corpus/expectation, Claude/Unity/networking, shared status,
Cargo.lock, dependency or paid-service change was made. Root owns sealing and transfer; no commit by this worker.

| Frozen payload | Bytes | SHA256 |
|---|---:|---|
| source.json |12,263,237| `3a3ae0d498cc3933b5eee11c5be995f267f4a76530379ad7c73a934082125d8d` |
| coverage.json |1,981,587| `a560ee78a81e9f851933aafda5d42fe566a0e72d346d74f51d15a1a1890d6e12` |
| controls.json |8,143| `ad9b789f8c40c922ac221c6e5eef7a483037383d23b3b8624b6fea774fd4877b` |

FROZEN_MANIFEST.json pins all14 tools and three payloads (17 files):2,862 bytes, SHA256
`8ca988c39466a8536a5e8aba6190619b1fbe7f4c862b0f2822f5093164445e24`.
The source profile pins lock/config/runtime/dependencies, all113 files in the conservative source inventory and82
actual parsed TypeScript imports. The actual generated seed7 map is embedded with map identity and all fields. Tool
pins were independently checked against disk before handoff. A tool README change would require a new provenance
capture, so tools and payloads are frozen now.

## What passed

The final capture writer and a separate Node-process exact bytecheck both pass for source and coverage. Each case
also recreates its real source instances and compares the whole chronological transcript. The tagged-codec/envelope
verifier passes19 synthetic reader controls and the complete valid corpus. Source behavior:98 cases/658 calls,
all nine chosen goal families,16 reached-semantic assertions. Suite counts:12Memory API,35Strategy,1Tracker,24Hunter,
9HuntAdapter,17BuildRoute. Actual method counts include280observe,25noteSent,4recordChoice,15whereabouts,121strategy
choices,124hunter choices,29adapter choices and32route update/plan calls.

Final19 semantic controls all KILL at their intended source selectors after successful source execution: dedup equal
key, hysteresis, exclusions, pursuit progress/hit release, loot budget, appraisal cache expiry/draw count, module order,
catch-up cap, synthetic-near-player release, seeded home, tracker rise, hunter ban expiry, route contest/tie/replan,
Memory walked8 reflection, intentional lock loss and third-party partner death. Comment-only NONKILL passes; restored
representative source cases are byte-identical as values; canonical source and payload stay unchanged. No build/import/
runtime failure is counted as a KILL. Controls mutate only a unique disposable container copy mounted against read-only
canonical source. Final successful controls were not redundantly repeated.

Raw command/cwd/exit output is in logs/capture-final.log, verify-final.log and controls-final.log. The earlier successful
16-control exploratory receipt is separate. One newly added conditional-context assertion failed because callback data
was encoded twice, not because source behavior differed. Its raw first failure is retained; the recorder now clones raw
callback values immediately and encodes them once. The final16 reached assertions include context-dependent module
behavior and pass. Exploratory captures remain historical and are not relabelled as final seals.

## Native handoff requirements

Read the frozen [tool README](../../../tools/bot-private-strategy-fixtures/README.md),
[branch/state ledger](BRANCH_LEDGER.md) and [numeric contract](NUMERIC_CONTRACT.md).

- Replay raw method/context inputs into the real admitted native Memory and real new native stateful classes. Captured
  Memory, candidates, callback answers and own-state outputs are comparisons, never native inputs.
- When declaration.current is `$previous`, use the preceding **native** decision's goal; compare the captured current
  only as a guard. A concrete declared current is separately labelled. Record/source current reuse identity is explicit.
- Streams are declared component inputs: Mulberry seeds seed,+1,+2,+3 for decide/motor/lapse/Knowledge, not createBrain
  derive(). Override arrays replace draws without consuming the fallback stream until exhausted. Preserve transcript.
- Module goals receive a documented consumed-context projection (operation,now,self.id,hp), not a whole serialized
  context. The conditional descriptor changes output across now/HP and detects stale/wrong callback context. Preserve
  all callback names/arguments/order/Undefined and exact source enabled/optional goals semantics.
- HuntAdapter homed/lastAt are closure variables; continuation/home/catch-up/release effects are witnessed without
  pretending direct storage reflection. All real Strategy/Hunter/Tracker/Route own state and relevant getters are
  captured read-only and encoded immediately.
- The JS verifier is finite tagged-codec/envelope validation, not a complete arbitrary public intake validator. The
  native checked reader must validate every consumed shape/enum/field and method/suite compatibility before mutation.
- Root approved unrounded field-scoped inherited numeric bounds. Native exact-path whitelist gets independent review;
  raw values/Memory/order/RNG/discrete outcomes/clocks/pure arithmetic stay exact. Never widen a blanket epsilon.

This is complete Phase A source preparation for the finite private component witness, not native parity/admission or a
full bot release. Explicit coverage gaps remain in the branch ledger; they cannot become native stubs. Fair publication,
real module/tactic/reflex integration, complete Brain scheduling and headless/live outcomes remain later work. Root now
prepares independent fresh-checkout/runtime reproduction for memory_review before native admission; it has not yet
passed merely because these local checks pass. Existing2,112/773 source corpora were not regenerated or reclassified.

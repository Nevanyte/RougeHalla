# Private tactics actual-source witness

This additive method witness invokes unchanged `createTactics()` with its default World/Fight/Orb/Reflex/Retreat closure.
It also invokes the exported real dependency APIs to distinguish closure state by subsequent calls. Real
`createMemory.observe`, `noteSent` and `recordChoice` histories produce memory; no memory, expected private state,
callback answers or native results are installed. Inputs are declared method facts, **not earned World/public facts**.

Run from this isolated checkout:

```sh
bash tools/bot-private-tactics-fixtures/capture.sh capture
bash tools/bot-private-tactics-fixtures/capture.sh --check
node tools/bot-private-tactics-fixtures/verify.mjs
bash tools/bot-private-tactics-fixtures/controls.sh --write
bash tools/bot-private-tactics-fixtures/controls.sh --check
node tools/bot-private-tactics-fixtures/manifest.mjs --write
node tools/bot-private-tactics-fixtures/manifest.mjs --check
```

Both Docker wrappers pin Node22.23.4 Linuxamd64 image
`sha256:aaa4b5baf1ecff3b283486bb1f90405cdda225a3e6f79660d2c559fa510a7292`. Source mounts read-only;
`npm ci --ignore-scripts --no-audit --no-fund` installs only into container tmpfs. No host npm install. Check mode mounts
corpus read-only. Semantic mutations use a unique disposable source copy. Raw receipts stay under the new evidence path.
A failed or surviving control remains evidence and cannot be called a KILL. All declared controls must KILL in the final
candidate; comment-only must NONKILL and restored cases match complete chronological transcripts exactly.

`source.json` is `rh-bot-private-tactics-source/1`; `rh-method-value/1` preserves ordered Object/Array/Map/Set/Uint8Array,
Undefined/Null, Infinity/-Infinity/NaN/signedzero, and callable diagnostics. Input numbers, geometry and clocks must be
finite; internal output sentinels remain tagged. `verify.mjs` decodes every case before returning any inputs, has no source
instance/state/RNG/path effects, rejects unsupported envelopes/tags/enums, duplicate Map/Object keys and missing consumed
facts. It is a private corpus reader; native atomic conversion is a separate gate. Non-native JSON numeric precision is
not a reason to round. Immediate deep owned snapshots capture outputs, both stats aliases, actual Memory outputs,
callback arguments/results, independent seeded streams and cumulative counters. Closure-local Fight/Orb/Retreat/World
state is not reflected or invented; continuation calls distinguish it.

Paths normally use real `createPathService` on fully recorded hand-built and seeded7 maps, with real budget/startTick/
setFrame/cache/gate state. Optional `radius-denial` or `half-plane` service descriptors are deterministic and depend on
actual arguments; they do not replay output tapes. The single explicit empty-path descriptor is a test-service boundary:
unchanged World loot throws TypeError after trying to read the last waypoint. Real RoomPathService normalizes an empty
findPath result to null. The row preserves result Undefined, thrown name/message, callbacks/state reached before throw.
It makes no native-panic or fair-gameplay requirement. Root decides the later native error contract.

Each case recreates from independent real instances and the same independent mulberry32 seeds (+0decide,+1motor,+2lapse,
+3Knowledge); source transcripts must reproduce exactly. This is not a claim to execute createBrain's derivation. Motor
and lapse are recorded with zero draws when tactics does not use them. Knowledge creation and all actual callbacks/draws
are recorded in setup and chronological operation order.

`coverage.json` retains V8 precise blocks and transformed source texts/hashes per case. Counts include two recreations.
Coalesced dynamic coverage ranges are not a blanket line/branch-completeness metric. Executable reached assertions plus
the evidence ledger identify concrete trajectories and remaining finite limits. `manifest.json` pins source/config/tool/
map/runtime/corpus/control identities and is external to source bytes to avoid self-hashing.

No immutable source seal or native admission follows from author checks. Root must obtain independent fresh-worktree
pinned-runtime reproduction and review. Rust/native answers, existing corpora, source implementations, public interfaces,
Unity/networking, shared status records, locks and host installs are outside this tool's write scope.

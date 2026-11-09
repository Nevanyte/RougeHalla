# Private SceneCandidate14 socket prototype: source ready

**UNCOMPILED / TESTS WRITTEN, NOT RUN.** This seal is for code review and an existing-cache build lease.
It is not a passing component, merge, live-binding, browser, throughput, capacity or RSS receipt.
Root authorized code/test source, and separately the narrow borrowed-completion extraction, while both Rust
caches remained leased. No Cargo/build, new target, real socket/test, Docker, Unity, browser or cloud run was made.
Direct rustfmt parsing/formatting and static source/diff checks are recorded separately from compiler/test results.

Based on sealed2397aeab294717b8ec6e6495e985c63186028352 in a separate `codex/scene-candidate14-socket`
worktree. The reviewed2397 and hidden-shot05f4959c worktrees remain immutable. The frozen design is outside Git at
`coordination/proposals/scene-candidate14-socket-adapter-v1/`; Root subsequently approved the parent extraction below.

## Footprint and API

Only one existing file changes: `crates/rh-server/src/outbox/scene_candidate.rs`, with **five added lines**:
the socket child-module declaration and a consuming-completion wrapper/private borrowed-method extraction.
The entire old completion body is preserved byte-for-byte. Existing model callers keep public `complete(mut self)`
and its original consumption/drop/error behavior. No transition, ACK, meter, flag, allocation or public capability changed.

New source is `scene_candidate/socket.rs` plus focused `socket/tests.rs`, `socket/tests/ownership.rs` and
`socket/tests/poll_faults.rs`. No live conn, public router, Room, legacy Outbox, protocol/ABI/golden vector,
identities/defaults, Session/client/policy, workflow, lockfile or shared status change is included.

`channel(generation,epoch,codec,queue,io)` accepts explicit checked caller Limits and returns Ingress + Endpoint.
Only Endpoint's public upgrade helper creates a socket driver, applying read/message/frame/write-buffer limits
before WebSocket message assembly. Quotas and scene/ACK/idle deadlines must be positive and arithmetic must fit.
It allocates no product identities or default capacities. There is no product route or dispatch hook calling it.

Ingress owns producer lifetime; the driver holds only Shared, so dropping the final producer closes/signals the queue.
PendingScene admission stays bound to its original context. Exact `full` alone is retryable; the same charged immutable
Pending/body/meta/cue/publication survives. Other prepare/admit errors close+notify. Successful admission disarms Drop;
dropping untransferred Pending closes. Both work and credit waits register/enable before condition recheck, including
the close-before-first-poll case. Writer release signals progress after ACK alone may have left credit held.

## Actual-I/O boundary implemented in source

The driver owns one unsplit Axum WebSocket; its Drop owner is constructed before returning the unpolled upgrade future.
It moves the existing record Vec into Binary Bytes without a second payload copy, keeping the same charged record guard
through that operation. Each record is flushed before completion; one scene deadline covers all records/control work.
`start` marks the first delegated record Sink poll, conservatively before poll_ready. This is not proof of a syscall,
peer receipt, decode or application. It enables only the existing one exact uncredited deferred ACK slot.

A real poll_flush success token is retained across quota boundaries and never repolled. Completion requires actual Stream
Pending, active context and deadline checks. Close/EOF/error wins; quota exhaustion does not stand in for Pending.
This matters because pinned tokio-tungstenite maps ConnectionClosed during poll_flush to Ok. Control/closing flushes
cannot complete an application record. Duplicate/deferred ACK and Ping/Pong do not renew the ACK-progress deadline.

Only successful actual COMMIT flush followed by model completion advances written. ACK remains an untrusted exact
epoch/scene/cue progress claim. Retention clears only on a valid ACK; bytes/scenes remain charged while Writer/record
owners remain. No completion or successor retry is attempted after an error.

On failure/cancellation the driver terminal-closes the queue, drops the whole socket and any payload-owning transport
error first, then record and Writer guards. The private borrowed completion method keeps the guard inside this owner
if closure/generation changes after flush checks. On successful borrowed completion only, the driver takes/drops it.
The extra parent extraction was explicitly authorized to fix the consuming-method error/drop race; it is not a second
completion implementation. A partial-bookkeeping completion error is terminal, with no retry or rollback assumption.

The current candidate's original payload/lease accounting does not include all WebSocket buffers or allocation slack.
Tungstenite serializes into its own persistent buffer. This code does not convert Queue meters into a total heap/RSS
claim. Receiver `retained_body_bytes` is still cumulative accepted encoded-body allocation per epoch, not resident
history/lifetime capacity; no accepted-body refund/pruning/reset, replay/resume/resync or new disclosure is added.

## Written controls and their boundaries

There are24 declared test functions, **none executed** in this source-ready stage:

- `tests.rs`: nine actual-loopback scenarios plus one unpolled-driver ownership control. Sources cover exact ordered
  Full records/ACK, separate receiver/application atomic Arc replacement, exact Pending retry after ACK+Writer release,
  cached-real-flush ACK race, correct/duplicate/stale/wrong epoch/future/wrong cue ACKs, per-record close fences,
  oversized inbound message rejection, and a deterministic close or test-only stale-generation fault immediately
  before borrowed completion after real flush/read success. The planned loopback uses a test-only bare Axum route;
  it will not prove the default conn/Hello/Room path, production acceptor/TCP_NODELAY or C#/JS/Unity sockets.
- `ownership.rs`: ten unit controls for checked limits, admission disarming/exact refusal, failure notifications,
  close/wait/cancellation ordering, actual driver Writer-release notification, final producer Arc lifetime and unused
  Endpoint drop. Core write/ACK inputs in these controls are explicitly model inputs, not socket-delivery proof.
- `poll_faults.rs`: four INJECTED Pump controls, including three error stages across the seven sealed-case record
  indices, a transport error owning the actual moved Binary, socket-drop charge snapshots, paused-clock fixed scene
  and ACK deadlines, and quota/queued-Close priority with a retained success token. Fake Sink Ready is labelled as
  injected branch evidence, never real flushing, TCP backpressure or delivery.

The real-flush gate delegates to the actual Axum socket and delays only observation of a captured successful flush;
it never manufactures success or polls that operation twice. Its waker is registered before publishing gate state.
The network rig catches post-handshake assertion panics, awaits driver completion, aborts/awaits the listener, and
signals/cleans up a failed upgrade. These are source properties to verify when the lease permits execution.

Fixture inputs are read from sealed full14.json, not regenerated worlds. The nonzero-tail control is explicitly
synthetic: existing spectator Full tick10/time500 plus unchanged golden current14 Fx tick3 twice (four occurrences).
Original ticks/order/duplicates are retained. It does not prove earned gameplay or nonzero Events delivery.

No compiler or runtime pass is inferred from static review or rustfmt. Complete application refusal/ACK-send-error,
raw fault-peer malformed transaction, C#/JS/client handoff and sustained history integration remain separate acceptance
work; pre-existing Receiver model tests are not relabelled as new socket coverage. This prototype is a prerequisite
toward the full transport, not a reduction of Root's remaining completion gates.

## Next authorized gate

Root must release one **existing** cache before compilation or any socket tests. Planned commands under Root's exact
leased environment (jobs1/debug0/incremental0), with no new target:

```
cargo test -p rh-server scene_candidate::socket --lib
cargo test -p rh-protocol scene_candidate --lib
cargo test -p rh-server scene_candidate --lib
cargo clippy -p rh-server --lib --tests -- -D warnings
```

Preserve first compiler/runtime failures and exact commands; do not widen a timeout or call a zero-test run green.
After scoped checks pass, Root owns independent review, merge selection, native Room publication, client/policy/history
integration, generation allocation, operational testing and eventual live/browser acceptance. No binding or product
Limits/capacity is authorized by this source seal.

# Private SceneCandidate14 socket prototype: scoped checks passed

**24 socket tests +9 existing queue tests +6 existing protocol tests passed**, with no ignored tests.
Strict scoped Clippy (`-D warnings`), scoped rustfmt and protected-file/body checks pass. The socket filter
ran the expected24 tests, not zero. `VERIFIED.json` and `logs/` bind commands, environment, exact source cuts,
all24 names, exit codes and raw output hashes.

This is private adapter acceptance for independent review, **not** default/live binding, complete transport,
browser/gameplay acceptance, P15/public-fact authority, throughput, capacity or RSS certification.

## Source and preserved failure

Base is reviewed2397aeab294717b8ec6e6495e985c63186028352. The uncompiled source-ready seal is
`c4738ed08c71cd43d42488df3f9c200450178b23`; its immutable historical `MANIFEST.json` describes that old cut,
not the final source. The original README bytes remain in `SOURCE_READY.md`.

Initial compilation failed E0639: WebSocketConfig is non-exhaustive. The original log/environment and
`FIRST_FAILURE.json` remain. The only post-source-seal Rust change uses the existing builder API instead
of its test-client struct literal, preserving both256-byte limits. No deadline, quota, expectation, coverage
or production behavior was changed to obtain a pass.

The only pre-existing file changed from2397 is `scene_candidate.rs`: five added lines for the child module
and authorized private borrowed-completion extraction. The old completion body is byte-identical (SHA256
`3caf52882aa4390287768912011d9143710ee8c36ea1cc9f10fe19f27ff6e278`). Public consuming completion still delegates
with its original behavior. `parent.diff` is exact. No conn/Room/default router/legacy Outbox/protocol/vector/
identity/Session/client/policy/workflow/lock/shared-status change is included.

## Boundary and controls

The new leaf uses an unavoidable configured upgrade, explicit checked caller Limits, an unsplit socket owner
constructed before its unpolled future, exact retained-Pending/full-only retry, and register-before-recheck waits.
The driver holds Shared rather than the producer Arc. Both ACK and final Writer release signal progress.

One moved record Vec remains charged through actual flush. Start is a conservative first-Sink-poll marker,
not receipt. A cached actual success token cannot complete until terminal drain reaches Stream Pending;
quota exhaustion does not count. Close/errors/deadlines win. COMMIT completion alone advances written;
exact ACK is untrusted progress and cannot return credit held by Writer/record owners. Duplicate/deferred ACK
or controls do not renew ACK progress time. Borrowed completion retains its guard on failure; teardown drops
the socket and payload-owning errors before record/Writer credit. No failed sample is skipped or restamped.

The24 passing functions comprise9 actual-loopback tests,1 unpolled owner test,10 ownership/config/wake units,
and4 explicitly INJECTED Pump fault/deadline/quota controls. The injected matrix covers three error stages
across seven records and an error owning the moved Binary; it does not claim TCP or real flush evidence.
The loopback gate delegates to a real socket and delays only observation of its successful flush.

Loopback tests cover exact Full/FIFO/atomic application Arc replacement, capacity refusal/exact retry,
ACK/completion race and tuple validation, per-record Close with read_quota1, pre-assembly oversized-message
refusal, and deterministic close/test-only stale-generation faults before borrowed completion.
The bare test Axum route does not prove default conn/Hello/Room, production TCP_NODELAY/TLS or C#/JS/Unity transport.
The nonzero tail is synthetic: existing spectator Full tick10/time500 +unchanged golden Fx tick3 twice,
four occurrences retaining bytes/order/ticks; no earned-gameplay or nonzero Events claim.

Receiver history remains cumulative accepted encoded-body allocation per epoch, with no accepted-body refund
or pruning. It is not resident history/lifetime capacity. Queue meters do not measure all socket/decoder/kernel/
TLS/process memory. Small caller test Limits are refusal profiles, not product/fleet capacity.
Application-error/raw-fault-peer/client/history/Room/reconnect/operational/browser gates remain open.
The prototype is a prerequisite toward full transport, not a reduction of completion scope.

## Lease and validation

All Cargo commands were sequential and `--locked`, using Root's final-env.sh and the exclusively loaned existing
`return-cleanup-2026-11-08/final-target`, jobs1/incremental0/dev+test debug0. `run-leased.py` records each cut
and stops only its own process group below1.5GiB free. Minimum monitored free was2,643,410,944 bytes.
No cleanup, new target/dependencies/lock, legacy capture, workspace/PG/client/Editor/browser/cloud build or activation
was performed. Initial formatter PATH/evidence diff-context errors remain historical records, not test passes.
Root owns independent review, merge selection and every later publication/client/policy/history/live gate.

Scoped source whitespace is clean. The global diff check reports only Cargo's original blank EOF lines
in the three passing test logs; raw bytes are preserved and classified in `logs/final-whitespace.json`.

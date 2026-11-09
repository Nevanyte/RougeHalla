# Initial live-seat resume and terminal detach

Software/test packet only, on `codex/initial-seat-resume`, exact public base **8e467beb3ec76d8178927998b62a23cdf7b77a06**. Immutable code commit **82e9aba9aaa27257fd2438e0480aafa75bcff9fd** contains only Session, new SeatResume, new SeatResumeTests, exact Unity net mirrors and the new mirror's metadata. This evidence-only follow-up changes no executed source. No push/merge/dispatch or UI adoption is performed here.

`SessionOptions.InitialResume` captures an immutable seed with defensively copied16-byte bearer capability,16 raw match bytes and positive player ID. A new Session's first Hello uses the existing Resume field. Its expected identity is checked before publishing Welcome/TimelineReset/InMatch or enabling input/retaining a Result from that connection. Every match byte is checked without UUID conversion. Invalid identity fails with a generic non-secret error; NoSuchSession remains a terminal reject. Imported sessions cannot switch to fresh admission. Successful resume still uses the existing backoff, Welcome reset and subsequent received session token; the expected identity remains bound across same-instance reconnects.

`Session.Detach()` is terminal and idempotent for that instance. It sets its cutoff before callbacks, clears pending input/retry state, unsubscribes only its own three transport handlers, raises new `SessionState.Detached` (appended after all existing enum values), and closes transport in finally even if the state subscriber reenters/throws. Late/captured transport callbacks and Connect/Update/Poll/Send/FlushInput/Leave remain inert. An obsolete InMatch state notification cannot reach later subscribers after a subscriber detaches. No wire Leave, MatchEnded or Result is synthesized. Already delivered data/references remain available; existing mutable DTOs have not become immutable. Public Session subscriptions remain owner-managed. Explicit Leave retains its existing separate relinquishment behavior. A separately copied seed must be captured before retiring a connection; the detached instance cannot be reactivated.

## Verification

- Focused normal managed tests with warnings as errors: **115 passed,0 failed,0 skipped**. This ran before the code commit; its source bytes are identical to the frozen six-file manifest. The name filter also includes existing account/Wish Session tests.
- One full, unfiltered managed run at the frozen code commit, with warnings as errors: **861 passed,0 failed,0 skipped**,6s reported test duration. No retry or allocation diagnostic run.
- Exact full Unity net mirror check PASS; `git diff base --check` PASS. All six code/test/mirror files are byte-identical to their frozen Git objects after verification. Existing allocation harness/controls are byte-identical to base; no budgets, selectors, warmups, GC/tiering settings or decoder changes.
- Pinned SDK8.0.427 / installed target runtime8.0.33, macOS26.6 ARM64. Raw environment and bounded command logs are included. Task-owned CARGO_TARGET_DIR and PostgreSQL state were assigned after sourcing the pinned environment and remain nonexistent/unused.

New tests cover shape/null/zero validation, constructor source mutation and later options replacement, a fresh Session after detaching an old one, all16 individual raw-match-byte mismatches, wrong/zero/foreign player IDs, no input or retained Result before expected identity, decoded Result acceptance after confirmation, stale reject and bounded retry without fallback, later same-instance identity checks, explicit Leave, and detach under live/retrying state, captured/queued callbacks, unrelated transport handlers, reentrant throwing subscribers, connecting/Welcome/Ended callbacks and stale InMatch notification delivery. Result payloads in these unit tests are synthetic encoded protocol fixtures; no authoritative server/result producer or browser reload is claimed.

```sh
source /Users/nevinmckinnon/.codex/tools/rougehalla-stage2/return-cleanup-2026-11-08/final-env.sh
export CARGO_TARGET_DIR=/Users/nevinmckinnon/.codex/tools/rougehalla-stage2/return-cleanup-2026-11-08/initial-seat-resume/unused-cargo-target
export RH_PGTEST_STATE=/Users/nevinmckinnon/.codex/tools/rougehalla-stage2/return-cleanup-2026-11-08/initial-seat-resume/unused-pg-state
dotnet test client-unity/RoguehallaNet.Tests --filter 'FullyQualifiedName~SeatResumeTests|FullyQualifiedName~SessionTests' -warnaserror
dotnet test client-unity/RoguehallaNet.Tests -warnaserror
bash client-unity/sync-net.sh --check
git diff 8e467beb3ec76d8178927998b62a23cdf7b77a06 --check
shasum -a 256 -c docs/evidence/initial-seat-resume/SHA256SUMS
```

The commands above reproduce this packet; the full managed command was executed exactly once in this author pass. `frozen-source.json` binds the code head/base and all six payload hashes. `receipt.json` records actual command outcomes; `SHA256SUMS` binds code and evidence payloads, excluding itself. The final evidence commit SHA is reported separately to the lead because a commit cannot contain its own hash.

## Security and integration boundary

The server's existing capability semantics are unchanged: a valid resume bearer resolves a live seat before supplied account authentication. This API does not prove account ownership, select a safe endpoint, persist credentials/checkpoints, validate Arena/Training targets, extend the10s default disconnect grace, restore a dead room/process or confirm banked progression. A matching Welcome establishes only this seed's match/player identity; the UI must still require a current owned account/target generation and a fresh authoritative mode fact before gameplay or settlement access.

MatchClient, Bootstrap, MatchHud, page storage/jslib, server, wire, dependencies and workflows remain untouched. Actual page reload/storage and Arena/Training adoption need the separate UI-owned packet and real browser proof from the accepted outside-Git plan. This normal managed pass makes no claim that historical allocation-counter causes or a reliable measurement fix have been established.

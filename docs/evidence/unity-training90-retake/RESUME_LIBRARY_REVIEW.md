# Initial-seat-resume clock correction: independent finite review

**SOURCE / EVIDENCE RELEASE** for corrected code `6fd7ed46fd4d3880ef9299984d80773fb8a6863b`, evidence seal `5b8e0423c26d5078585d2a9f8565b0862606ad7c`. No blocking defect found within the approved terminal notification/I/O contract. This is not page-reload, Unity adoption or live-server acceptance.

Reviewed immutable Git objects in `return-cleanup-2026-11-08/initial-seat-resume/repo`; no builds, cache use, Editor, browser, network, repo edits or merges. The previous `82e9aba9` review remains applicable; its report independently hashes to `2192580c9cf1e46e076c920816e8b4b169b46c5e4a152dfc630b884b8a1faa7e`.

## Correction and reachable controls

The history is exactly `82e9aba9` → original evidence `98bc727afb1823d394cc30aa96e97d4c31693a97` → correction `6fd7ed46` → evidence `5b8e0423`. The correction changes only the managed Session, its byte-identical Unity mirror, and SeatResumeTests. Production adds exactly `if (_detached) return;` immediately after caller-owned `Now` returns in `Session.cs:457–458`. It precedes snapshot acceptance, ClockSync Pong mutation, result/event handling and their downstream notifications. Existing `Detach` first sets the terminal latch, clears input/retry authority, unsubscribes its three transport callbacks and closes in finally (`Session.cs:219–230`). No initial-seat matching, token handling, UI/store/server/protocol or dependency behavior was rewritten.

The two added tests (`SeatResumeTests.cs:321–355`) reach the real parser via `Received(message.Encode())`, not private acceptance hooks:

- The Pong test first accepts Welcome and calls Update to obtain a real emitted Ping, then echoes its nonce/client timestamp. Its 20 ms sample would pass ClockSync's epoch and nonnegative-RTT guards. A clock callback Detaches; the test requires no sample/RTT callback or new send, one close and zero remaining transport subscriptions.
- The snapshot test first accepts an ordinary Tick1 snapshot, retains actual delivered/prediction/count/epoch/mode fields, then delivers Tick2 with source time25 ms versus the previous50 ms. That is a real source-clock cut under the existing predicate and would start TimelineReset before SnapshotReceived without the guard. It requires unchanged retained fields, no new distinct timeline/snapshot notification, one close and no Leave.

The fixture's new optional OnClock action defaults null, preserving existing test setup. No expected runtime state is installed by these controls. These are synthetic encoded protocol tests, not earned server or browser outcomes. The guard does not promise rollback of decoding performed before the clock callback.

## Evidence integrity

Independently verified current `clock-SHA256SUMS` SHA-256 **`75c944e94215a84311be3d7a8f3fdad878e642b310c4f36223ab0e8a32d20ecf`** and every one of its **12** payload entries against frozen seal Git blobs. All six `clock-frozen-source.json` code/test/mirror pins match both corrected-code and evidence-seal objects. Session mirrors are exactly27061 bytes, SHA-256 `4ce6326df240d08b4877bb026d425221fa87f778d9188365c62206bda275965a`.

Independently verified all **13** original manifest entries against immutable `98bc727a` objects; all eight original evidence-tree files remain byte-identical in the final seal. The old manifest is correctly documented as a point-in-time seal rather than misrepresented as checking corrected source. Code-only diff whitespace check passes. Evidence seal adds only seven clock-specific evidence files.

The raw final logs report **117/117 focused**, **863/863 full managed**, zero failures/skips, VSTest17.11.1 ARM64; the code/environment log binds exact `6fd7ed46` and SDK8.0.427. The receipt records single runs with warnings-as-errors and unchanged frozen sources. These are author-run execution receipts independently inspected here, not independently rerun tests. Original managed environment evidence remains preserved.

## Accepted boundary and integration obligations

An already-started multicast can finish remaining listeners of that same notification. This repair prevents a subsequent distinct parser notification/I/O authority after clock-triggered Detach; it does not cancel an invocation already underway, make caller-owned DTOs immutable or universally freeze retained prediction/diagnostic fields at other deliberately reentrant clock sites. The addendum explicitly preserves those narrower limits rather than claiming a general reentrancy repair.

The UI owner must revoke captured generation/Session ownership **before** Detach, unbind its own public subscriptions and make old callbacks/completions verify current ownership. That adoption is outside this source packet. Actual full-page reload, persistence, Unity and server-host recovery remain unproved. Root owns composition and any subsequent runtime acceptance gate.

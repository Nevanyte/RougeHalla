# Solicited Pong admission repair packet

Status: Ready for mechanical implementation; lead security review required before merge.
Owner: DeepSeek Post Rust lane. Base: immutable `f33bdc94` in a new isolated branch/worktree.

## Problem and fixed boundary

PNET3 adds compulsory500ms server Ping challenges. Charging their matched Pong responses against the existing60frames/s user bucket makes an otherwise lawful60Hz data stream fail after59seconds. A private deterministic test using the actual `conn::Bucket` reproduced this; the same stream without compulsory Pong charges survives65seconds.

Before charging a Pong, validate and consume a currently in-flight, one-shot server challenge. Exempt only that matched response from the user-frame bucket and record at most one RTT sample. Keep malformed, unknown, duplicate, evicted and old-connection responses charged. Preserve the bounded eight in-flight challenges,500ms cadence, client Ping flood limiting and all existing payload bounds.

Do not change RTT constants/formula, wire version, simulation history, tick order or gameplay. The accepted timestamp normalization remains before `validate` + `Sim::submit`; replay records accepted normalized commands.

## Proof and limits

- Use the real bucket and an injected/paused clock to cover at least65seconds of lawful60Hz data plus compulsory2Hz Pong responses without depletion.
- A challenge is consumed once; duplicates and malformed/unmatched/evicted responses still exhaust the normal budget under a flood.
- Cover reconnect/resume and stale prior-connection samples without carrying the old estimator into the new connection.
- Existing rewind and real WebSocket transport tests must pass. Do not label a test with an injected room RTT window as an instrumented150ms network experiment.
- Document that the clamp applies per Attack/Release command. Held attacks retain the legacy press-time lag until another command; changing per-swing rules is outside this packet and requires a separate design decision.
- No source-fixture normalization, shared status/Cargo.lock edits, deployment or unrelated frontend changes.

Success: bounded matched-control exemption with negative flood/reset coverage, existing fairness/transport tests passing, a clean commit and exact evidence. Failure: free arbitrary control frames, repeated RTT samples for one challenge, weakened user limits, new gameplay/history behavior or tests that only exercise a copied bucket implementation.

Report: `~/.codex/tools/rougehalla-stage2/coordination/reports/deepseek-post-rust.md`. The lead owns review and merge.

# Exact-sequence presentation under queued snapshots

Read-only review, 2026-11-08, isolated source `23b2e4cf` plus the input-latency harness followups. No gameplay, protocol,
prediction or scheduling rule was changed by this review.

The current client deliberately presents the latest delivered state once per Unity frame:

1. `client-unity/UnityProject/Assets/Scripts/Net/WebGLTransport.cs`, `Poll`, drains every queued WebSocket frame in a loop.
2. `client-unity/RoguehallaNet/Net/Session.cs`, snapshot handling, copies each accepted snapshot into the same owned
   `Session.Me`. A later snapshot can overwrite its `MoveSeq` before Poll returns.
3. `client-unity/UnityProject/Assets/Scripts/Net/MatchClient.cs`, `Update`, calls Poll and then Present once; the
   `presentSelf` hook reports the current `Session.Me.MoveSeq`.

Thus a browser can observe a snapshot echoing move 1, followed by move 2 before the next Unity frame; Unity can then
present move 2 without ever presenting move 1. Drawing every intermediate 20 Hz state is not required by this client.
This is a permitted explanation for an exact-sequence telemetry gap, rather than evidence by itself of a visible delay.

The harness currently waits for both a wire echo and a post-Present trace with exactly the sampled sequence. It keeps
the key held through those waits, and MatchClient repeats held-key moves every 100 ms. The requirement is intentionally
conservative: an unobserved exact-sequence presentation remains a rejected measurement. No passing criteria were
relaxed, and no failure was relabelled as a successful trial.

`linux-ordered-stalls-missing-presentation.json` records one such missing presentation, but it was saved before the
bounded per-attempt trace existed. Its aggregate frame/snapshot timings cannot establish the cause of that particular
failure. The later 3/3 and 10/10 runs do not establish that the gap is impossible.

Future incomplete attempts save the first second around the sampled input, including up to 200 `frameStart`,
`sampleMove`, `sampleStop` and `presentSelf` events per client, and up to 100 public input/snapshot wire records.
To verify coalescing, locate the sampled-sequence wire snapshot, any newer-sequence snapshot, and the intervening Unity
frame boundaries/presentation. Check that both snapshots arrived before the next frame's Poll/Present and that the
presentation reports the newer sequence. If event ordering cannot prove that, retain the measurement as inconclusive.

The project lead owns any future decision to change the measured endpoint (for example, presentation of an
authoritative state at or after the sampled input's accepted tick). That would need a separately reviewed causal
contract and regression cases; accepting a merely different sequence would be insufficient. The existing verified
same-frame sample-to-send metric is independent of this presentation limitation.

The saved measurement manifest continues to pin the exact harness bytes used for those reports. The additive failure
diagnostic described here was added afterward and does not claim a new runtime measurement.

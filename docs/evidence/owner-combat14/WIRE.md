# Owner-combat protocol14 transport

This packet uses the reserved private protocol14 Full bit20 and Delta bit24. It adds no State key, gameplay rule, actor identity, content identity or policy-delivery activation. The existing ground, giver and quest protocol14 leaves remain composed.

The group is a snapshot footer after all actor records (and the Delta departed list), before the frame ends. A present Full bit carries the group directly. A present Delta bit first carries a strict availability byte:0 means Unavailable and1 means the complete group follows.

| Group field | Bytes |
| --- | --- |
| Lock | u8:0 Clear,1 Held without identity,2 Held with identity |
| Target, only for lock2 | canonical nonzero full-u32 varint |
| DrawStartedAt | u32 little endian |
| ReadyAt | u32 little endian |
| AsMilli | IEEE754 binary64 little endian |
| WindupMilli | IEEE754 binary64 little endian |
| SpeedMilli | IEEE754 binary64 little endian |

The three mirrors must be finite, integral and at least50. Their exact binary64 values are retained;65536,1e303 and the largest finite binary64 value are valid. There is no u16, safe-integer or gameplay-derived upper limit. Clocks are already source-normalized u32 values; clients never reconstruct them from remaining-time displays or the snapshot clock.

A Full with no group is Unavailable. A Delta with no group retains the previous group only while the owner remains. Absence of `DH_PRESENT` still removes the owner and clears its group. A group-only Delta that keeps the owner therefore carries `DH_PRESENT` with an empty SelfDelta. Explicit Delta availability0 on owner loss is accepted, but the encoder canonically omits that redundant clear. Available data without an owner is refused.

Clear, Held without identity and Held with a current identity are distinct from Unavailable. A known identity must name a row in the same fully reconstructed current actor scene, never a roster, history or retired-reference fallback. Full application and retained-Delta validation refuse dangling identities before committing held tick, self, actor or group state. The existing raw Full decode scratch contract is unchanged. Owned client views hold copied values; raw scratch objects cannot mutate them.

The writer compares the exact filtered sequence of current public NPC references (`kind !=0`) with its last actually encoded snapshot. Any difference forces a whole available-group replacement, including Clear, Held without identity and a player target. No transient preparation flag, lossy hash or new epoch field stands in for that comparison. This keeps the requirement intact when accepted intermediate snapshots are coalesced before encoding. An unchanged empty NPC scene does not create a renewal.

Native preparation maps the entitled target through the same current staged actor scene. Only accepted reliable enqueue commits the prepared references and collection baselines. Refused projection, encoding, capacity or closed enqueue must not issue a new binding or advance delivery state. Reconnect/Welcome discards client retained state; a presentation-only source-clock cut does not fabricate a canonical group reset.

Actual policy delivery and UI adoption are separately owned. These codecs and tests do not activate either path or claim hosted quest/trade/training flows.

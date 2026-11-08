# Barrier publication research: decision prerequisites

Read-only lead research, 2026-11-08, from native checkpoint `febf1f3f` and the unchanged legacy source. This is not a
publication packet, identity assignment or activation approval. The private G6 packet remains separate. The next
source-only [witness packet](P-BARRIER-VIEW-WITNESS-1.md) will capture the numerical boundaries below.

## Source facts and proposed narrow unit

Source self/fighter perception explicitly applies Math.fround to HP/maxHP/barrier. Shared `hpView.ts` normalizes the
two continuous player bars by max(maxHP, positive HP + positive barrier); actual bot perception then quantizes both
shares to twentieths with a one-step positive sliver. Current Rust actors use hundredths of HP/maxHP. Changing only
the quantization would therefore be insufficient: source f32 conversion, positive guards and the combined denominator
all matter. Mob perception frounds HP/maxHP and uses barrier0. The source comment implying plain HP/maxHP is stale.

The human ring is a separate eight-step presentation of barrier/(0.3*maxHP), capped at one with a positive sliver.
Overfull normalized bars cannot reconstruct it. An eventual minimal unit needs owner barrier, visible player bar share
and ring information, explicit NPC zero behavior and the privileged PublicSnapshot barrier. It needs no hidden expiry,
decay flag, producer, future value, raw remote vitals, global roster or aggregate exception. Native/headless and all
human codec/pool/reset paths must agree on the admitted facts. Exact bot twentieths versus retaining current hundredths
is still a lead precision decision; neither proves pixel-identical continuous source human bars.

## Numeric admission needs an explicit design

Current player Vitals/checkpoint validation supplies no general f32-safe HP/maxHP/barrier bound; mob validation has
separate finite/bounded/zero-barrier checks. Existing owner wire intentionally preserves nonfinite/signed-zero bits,
and QActor checks already projected values. Those paths do not establish a safe new barrier conversion automatically.

For a finite nonnegative source-f32 barrier leaf, check the actual cast result: some values above mathematical f32::MAX
round to finite max, underflow to zero matches source, and negative zero should retain its owner bits. Widening the
checked f32 to f64 fits observation arithmetic and preserves its decoded value in JSON. However, existing observe APIs
are infallible; the precise checked-observation/publication refusal seam must be designed before implementation.
Do not silently substitute zero/null, tighten unrelated restore validity or weaken existing owner decoding.

Numeric admission must follow visibility selection. A hidden actor's unrepresentable barrier must not fail a viewer's
frame, which would disclose hidden state. A privileged snapshot can check all its own rows. A visible/owner refusal
must leave offered actor bindings and wire baselines uncommitted. No barrier<=25%-of-current-maxHP invariant is valid;
maxHP can decrease later. Independently rounded bar shares can total105%, which is also valid.

## Future implementation gate

A publication packet must name the checked-observation domain and refusal seam, chosen precision and fresh observation/
wire identities. Policy pins must move; the policy interface contract does not automatically need a separate bump.
Private G6 owns its prospective checkpoint25/replay19/content change; these remain candidate reservations. Publication
alone adds no gameplay world state or new content rule. Recheck identities at composition.

Require source-backed projection thresholds, actual G6 grant/decay/absorption-to-zero publication, hidden/timer paired
controls, full/delta change-to-zero and pool/reconnect tests in Rust/C#/JS, offer failure atomicity and warmed allocation
checks. Unity may only present the delivered values; it must not simulate grant, decay, absorption or cap rules.
Broader perception fields, full brain consumers and remote walk-hint/privacy/geometry decisions remain separate work.

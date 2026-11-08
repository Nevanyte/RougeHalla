using System;
using System.Text;
using Roguehalla.Editor.WishProof;
using Roguehalla.Client;
using Roguehalla.Net.Protocol;

static class Program
{
    static void Must(bool value, string label) { if (!value) throw new Exception(label); }
    static LatencyTrace.EditorRecord Sample(uint player, int frame, int seq, float x, float y, double at = 10) => new LatencyTrace.EditorRecord { kind = "sampleWish", player = player, frame = frame, moveSeq = seq, x = x, y = y, at = at };
    static LatencyTrace.EditorRecord Queued(byte[] bytes, int frame, double at = 10) => new LatencyTrace.EditorRecord { kind = "nativeInputQueued", frame = frame, at = at, wireBase64 = Convert.ToBase64String(bytes) };
    static ClientMsg.Input Frame(byte slot, byte? seq, float x, float y, uint actor)
    {
        var frame = new ClientMsg.Input { Seq = 12 };
        frame.Commands.Add(WireCommand.Cast(slot, x, y, actor == 0 ? (uint?)null : actor, 5000.0, seq));
        return frame;
    }
    static byte[] LandedFrame(double eventTime)
    {
        using (var bytes = new System.IO.MemoryStream())
        using (var writer = new System.IO.BinaryWriter(bytes))
        {
            writer.Write((byte)0x85); writer.Write((byte)0x89); writer.Write((byte)0x06); writer.Write((byte)1);
            writer.Write((byte)7); writer.Write(eventTime); writer.Write((byte)3);
            writer.Write((byte)1); writer.Write((byte)42); writer.Write((byte)0); writer.Write((byte)0); writer.Write((byte)0);
            writer.Flush(); return bytes.ToArray();
        }
    }
    static WishProof.ReceivedFxFact LandedFact(double eventTime, int observerTraceCount) => new WishProof.ReceivedFxFact {
        kind = FxKind.WishLanded.ToString(), tick = 777, frame = 905, messageIndex = 0, caster = 42, hasCaster = true,
        ability = 3, eventTime = eventTime, observerTraceCount = observerTraceCount
    };
    static LatencyTrace.EditorRecord Receipt(byte[] frame) => new LatencyTrace.EditorRecord {
        kind = "nativeFxReceived", frame = 905, at = 5000, wireBase64 = Convert.ToBase64String(frame)
    };
    static LatencyTrace.EditorRecord Presented(double eventTime, uint caster = 42) => new LatencyTrace.EditorRecord {
        kind = "presentWishLanded", frame = 905, player = caster, ability = 3,
        sourceTime = eventTime, at = 5000, hasSourceTime = true
    };
    static void Main()
    {
        var sample = Sample(42, 900, 17, 127.25f, 80.5f);
        var valid = Queued(Frame(0, 17, 127.25f, 80.5f, 77).Encode(), 900);
        Must(WishProof.MatchesEncodedInput(sample, 10, valid, 11, 42, 77, out var decoded, out var cast), "ordered encoded input must match");
        Must(WishProof.MatchesEncodedInput(sample, 10, Queued(Frame(0,17,127.25f,80.5f,77).Encode(),900,10.01), 11, 42, 77, out _, out _), "later queue timestamp must match");
        Must(decoded.Commands.Count == 1 && cast.Kind == CommandKind.Cast && cast.ActorRef == 77 && cast.Seq == 17, "decoded cast details");
        Must(!WishProof.MatchesEncodedInput(sample, 10, valid, 10, 42, 77, out _, out _), "same trace index must fail");
        Must(!WishProof.MatchesEncodedInput(sample, 11, valid, 10, 42, 77, out _, out _), "native queue before sample must fail");
        Must(!WishProof.MatchesEncodedInput(sample, 10, Queued(Frame(0,17,127.25f,80.5f,77).Encode(),900,9.99), 11, 42, 77, out _, out _), "native queue timestamp before sample must fail");
        Must(!WishProof.MatchesEncodedInput(Sample(42,900,17,127.25f,80.5f,double.NaN), 10, Queued(Frame(0,17,127.25f,80.5f,77).Encode(),900), 11, 42, 77, out _, out _), "nonfinite trace timestamp must fail");
        Must(!WishProof.MatchesEncodedInput(sample, 10, Queued(Frame(0,17,127.25f,80.5f,77).Encode(),901), 11, 42, 77, out _, out _), "different native frame must fail");
        Must(!WishProof.MatchesEncodedInput(Sample(43,900,17,127.25f,80.5f), 10, valid, 11, 42, 77, out _, out _), "different player must fail");
        Must(!WishProof.MatchesEncodedInput(sample, 10, Queued(Frame(0,16,127.25f,80.5f,77).Encode(),900), 11, 42, 77, out _, out _), "different sequence must fail");
        Must(!WishProof.MatchesEncodedInput(sample, 10, Queued(Frame(1,17,127.25f,80.5f,77).Encode(),900), 11, 42, 77, out _, out _), "nonzero slot must fail");
        Must(!WishProof.MatchesEncodedInput(sample, 10, Queued(Frame(0,17,127.5f,80.5f,77).Encode(),900), 11, 42, 77, out _, out _), "different cursor must fail");
        Must(!WishProof.MatchesEncodedInput(sample, 10, Queued(Frame(0,17,127.25f,80.5f,78).Encode(),900), 11, 42, 77, out _, out _), "different actor ref must fail");
        Must(WishProof.MatchesEncodedInput(sample, 10, Queued(Frame(0,17,127.25f,80.5f,0).Encode(),900), 11, 42, null, out _, out _), "ground input must require no unit ref");
        Must(!WishProof.MatchesEncodedInput(sample, 10, Queued(Encoding.ASCII.GetBytes("not base64"),900), 11, 42, 77, out _, out _), "malformed payload must fail closed");
        byte[] fxFrame = LandedFrame(5042.5);
        var landed = new WishProof.ReceivedFxFact { kind = FxKind.WishLanded.ToString(), tick = 777, messageIndex = 0, frame = 905, caster = 42, hasCaster = true, ability = 3, eventTime = 5042.5, observerTraceCount = 14, observerAt = 5000.0 };
        LatencyTrace.BeginEditor();
        UnityEngine.Time.frameCount = 905; UnityEngine.Time.realtimeSinceStartupAsDouble = 5.0;
        LatencyTrace.NativeFxReceived(new byte[] { 0x81, 0x00 });
        Must(LatencyTrace.ReadEditor().Length == 0, "non-FX transport frame must not enter trace");
        LatencyTrace.NativeFxReceived(fxFrame);
        var nativeReceipt = LatencyTrace.ReadEditor()[0];
        Must(nativeReceipt.kind == "nativeFxReceived" && nativeReceipt.frame == 905 && nativeReceipt.at == 5000.0, "native FX hook stamps bounded dispatch record");
        Must(WishProof.TryMatchNativeFxReceipt(landed, nativeReceipt, 12), "real encoded native FX receipt must decode and match");
        Must(landed.hasNativeReceipt && landed.nativeReceiptFrame == 905 && landed.nativeReceiptIndex == 12, "native receipt boundary copied");
        Must(WishProof.MatchesOwnLanded(landed, 42, 3, 900, 11), "own later landed FX after queued input must match");
        Must(!WishProof.MatchesOwnLanded(landed, 43, 3, 900, 11), "other caster must fail");
        Must(!WishProof.MatchesOwnLanded(landed, 42, 2, 900, 11), "other ability must fail");
        Must(WishProof.MatchesOwnLanded(landed, 42, 3, 905, 11), "same-frame FX after queue can match by trace order");
        Must(!WishProof.MatchesOwnLanded(landed, 42, 3, 905, 12), "same-frame FX before queued input trace index must fail");
        var presented = new LatencyTrace.EditorRecord { kind = "presentWishLanded", frame = 905, player = 42, ability = 3, sourceTime = 5042.5, at = 5000.0, hasSourceTime = true };
        Must(WishProof.MatchesPresentedLanded(presented, landed, 900, 10, 13), "marker before observer but after native dispatch must match");
        Must(!WishProof.MatchesPresentedLanded(presented, landed, 900, 10, 11), "marker before native dispatch must fail");
        presented.sourceTime += 0.001;
        Must(!WishProof.MatchesPresentedLanded(presented, landed, 900, 10, 13), "different original source time must fail");
        presented.sourceTime = landed.eventTime;
        presented.ability++;
        Must(!WishProof.MatchesPresentedLanded(presented, landed, 900, 10, 13), "different presented ability must fail");
        presented.ability = 3;
        presented.frame = 906;
        Must(WishProof.MatchesPresentedLanded(presented, landed, 900, 10, 13), "later frame with equal local time must match");
        presented.frame = 904;
        Must(!WishProof.MatchesPresentedLanded(presented, landed, 900, 10, 13), "earlier-frame presentation must fail");
        presented.frame = 905;
        presented.at = 4999.9;
        Must(!WishProof.MatchesPresentedLanded(presented, landed, 900, 10, 13), "earlier local timestamp must fail");
        var duplicateTrace = new[] {
            new LatencyTrace.EditorRecord { kind = "sampleWish", frame = 900, at = 100 },
            new LatencyTrace.EditorRecord { kind = "nativeInputQueued", frame = 900, at = 100 },
            Receipt(fxFrame), Presented(5042.5), Receipt(fxFrame), Presented(5042.5)
        };
        var duplicateFacts = new System.Collections.Generic.List<WishProof.ReceivedFxFact> {
            LandedFact(5042.5, 4), LandedFact(5042.5, 6)
        };
        WishProof.MatchOwnLandedOccurrences(duplicateTrace, duplicateFacts, 42, 3, 900, 0, 1,
            out var duplicatePrimary, out var bothReceipts, out var bothPresented);
        Must(duplicatePrimary != null && bothReceipts && bothPresented, "two identical FX occurrences require two ordered applied markers");
        Must(duplicateFacts[0].nativeReceiptIndex == 2 && duplicateFacts[1].nativeReceiptIndex == 4,
            "each copied callback binds its latest preceding raw receipt, without reuse");
        var droppedTrace = new[] {
            new LatencyTrace.EditorRecord { kind = "sampleWish", frame = 900, at = 100 },
            new LatencyTrace.EditorRecord { kind = "nativeInputQueued", frame = 900, at = 100 },
            Receipt(fxFrame), Presented(5042.5), Receipt(fxFrame)
        };
        var droppedFacts = new System.Collections.Generic.List<WishProof.ReceivedFxFact> {
            LandedFact(5042.5, 4), LandedFact(5042.5, 5)
        };
        WishProof.MatchOwnLandedOccurrences(droppedTrace, droppedFacts, 42, 3, 900, 0, 1,
            out _, out var droppedReceipts, out var droppedPresented);
        Must(droppedReceipts && !droppedPresented, "two identical FX occurrences with one marker must remain incomplete");
        var reversedTrace = new[] {
            new LatencyTrace.EditorRecord { kind = "sampleWish", frame = 900, at = 100 },
            new LatencyTrace.EditorRecord { kind = "nativeInputQueued", frame = 900, at = 100 },
            Receipt(LandedFrame(5042.5)), Receipt(LandedFrame(5043.5)), Presented(5043.5), Presented(5042.5)
        };
        var reversedFacts = new System.Collections.Generic.List<WishProof.ReceivedFxFact> {
            LandedFact(5042.5, 3), LandedFact(5043.5, 4)
        };
        WishProof.MatchOwnLandedOccurrences(reversedTrace, reversedFacts, 42, 3, 900, 0, 1,
            out _, out var orderedReceipts, out var orderedPresented);
        Must(orderedReceipts && !orderedPresented, "presentation events must pair in received event order");
        var wrongCasterTrace = new[] {
            new LatencyTrace.EditorRecord { kind = "sampleWish", frame = 900, at = 100 },
            new LatencyTrace.EditorRecord { kind = "nativeInputQueued", frame = 900, at = 100 }, Receipt(fxFrame), Presented(5042.5, 43)
        };
        var wrongCasterFacts = new System.Collections.Generic.List<WishProof.ReceivedFxFact> { LandedFact(5042.5, 4) };
        WishProof.MatchOwnLandedOccurrences(wrongCasterTrace, wrongCasterFacts, 42, 3, 900, 0, 1,
            out _, out var casterReceipt, out var casterPresentation);
        Must(casterReceipt && !casterPresentation, "wrong-caster applied marker must not satisfy a landed occurrence");
        var extraMarkerTrace = new[] {
            new LatencyTrace.EditorRecord { kind = "sampleWish", frame = 900, at = 100 },
            new LatencyTrace.EditorRecord { kind = "nativeInputQueued", frame = 900, at = 100 },
            Receipt(fxFrame), Presented(5042.5), Presented(5042.5)
        };
        var oneFact = new System.Collections.Generic.List<WishProof.ReceivedFxFact> { LandedFact(5042.5, 4) };
        WishProof.MatchOwnLandedOccurrences(extraMarkerTrace, oneFact, 42, 3, 900, 0, 1,
            out _, out var extraReceipt, out var extraPresentation);
        Must(extraReceipt && !extraPresentation, "orphan extra own landing marker must fail exact multiplicity");
        var beforeQueueTrace = new[] {
            new LatencyTrace.EditorRecord { kind = "sampleWish", frame = 900, at = 100 },
            Receipt(fxFrame), new LatencyTrace.EditorRecord { kind = "nativeInputQueued", frame = 900, at = 100 }, Presented(5042.5)
        };
        var beforeQueueFacts = new System.Collections.Generic.List<WishProof.ReceivedFxFact> { LandedFact(5042.5, 2) };
        WishProof.MatchOwnLandedOccurrences(beforeQueueTrace, beforeQueueFacts, 42, 3, 900, 0, 2,
            out _, out var beforeQueueReceipt, out var beforeQueuePresentation);
        Must(!beforeQueueReceipt && !beforeQueuePresentation, "FX receipt before actual queued Cast must not count");
        var before = new WishProof.OwnerFact { hasSelf = true, hasWish = true, player = 42, ability = 3, charges = 2, maxCharges = 2, serverMs = 100, readyAt = 100, nextChargeAt = 200 };
        var spent = new WishProof.OwnerFact { hasSelf = true, hasWish = true, player = 42, ability = 3, charges = 1, maxCharges = 2, serverMs = 150, readyAt = 100, nextChargeAt = 200, frame = 902 };
        Must(WishProof.HasAuthoritativeChargeSpend(before, spent, 42, 3, 901), "same-owner charge decrease after encoded queue must pass");
        var unchanged = new WishProof.OwnerFact { hasSelf = true, hasWish = true, player = 42, ability = 3, charges = 2, maxCharges = 2, serverMs = 150, readyAt = 100, frame = 902 };
        Must(!WishProof.HasAuthoritativeChargeSpend(before, unchanged, 42, 3, 901), "unchanged charge count must not count as spend");
        var oneChargeBaseline = new WishProof.OwnerFact { hasSelf = true, hasWish = true, player = 42, ability = 3, charges = 1, maxCharges = 2, serverMs = 100, readyAt = 100 };
        var increased = new WishProof.OwnerFact { hasSelf = true, hasWish = true, player = 42, ability = 3, charges = 2, maxCharges = 2, serverMs = 150, readyAt = 100, frame = 902 };
        Must(!WishProof.HasAuthoritativeChargeSpend(oneChargeBaseline, increased, 42, 3, 901), "increased stock must not count as spend");
        var changedAbility = new WishProof.OwnerFact { hasSelf = true, hasWish = true, player = 42, ability = 4, charges = 1, maxCharges = 2, serverMs = 150, readyAt = 100, frame = 902 };
        Must(!WishProof.HasAuthoritativeChargeSpend(before, changedAbility, 42, 3, 901), "changed ability must not count as spend");
        var changedOwner = new WishProof.OwnerFact { hasSelf = true, hasWish = true, player = 43, ability = 3, charges = 1, maxCharges = 2, serverMs = 150, readyAt = 100, frame = 902 };
        Must(!WishProof.HasAuthoritativeChargeSpend(before, changedOwner, 42, 3, 901), "different owner must not count as spend");
        var maxOnly = new WishProof.OwnerFact { hasSelf = true, hasWish = true, player = 42, ability = 3, charges = 1, maxCharges = 1, serverMs = 150, readyAt = 100, frame = 902 };
        Must(!WishProof.HasAuthoritativeChargeSpend(oneChargeBaseline, maxOnly, 42, 3, 901), "max-charge-only change must not count as spend");
        var rechargeOnly = new WishProof.OwnerFact { hasSelf = true, hasWish = true, player = 42, ability = 3, charges = 2, maxCharges = 2, rechargeMs = 500, serverMs = 150, readyAt = 100, frame = 902 };
        Must(!WishProof.HasAuthoritativeChargeSpend(before, rechargeOnly, 42, 3, 901), "recharge-only change must not count as spend");
        Must(!WishProof.HasAuthoritativeChargeSpend(before, spent, 42, 3, 902), "same-frame post-snapshot cannot prove later-than-queue spend");
        spent.serverMs = before.serverMs;
        Must(!WishProof.HasAuthoritativeChargeSpend(before, spent, 42, 3, 901), "same server time cannot prove a later authoritative spend");
        spent.serverMs = before.serverMs - 1;
        Must(!WishProof.HasAuthoritativeChargeSpend(before, spent, 42, 3, 901), "backward server time cannot prove a later authoritative spend");
        var ready = new WishProof.OwnerFact { hasSelf = true, hasWish = true, player = 42, charges = 1, serverMs = 100, readyAt = 100 };
        Must(WishProof.IsReadyOwner(ready), "charged owner at authoritative ready time must pass");
        ready.charges = 0;
        Must(!WishProof.IsReadyOwner(ready), "zero stock must not start a trial");
        ready.charges = 1; ready.hasCast = true;
        Must(!WishProof.IsReadyOwner(ready), "active cast must not start a trial");
        ready.hasCast = false; ready.serverMs = 99.99;
        Must(!WishProof.IsReadyOwner(ready), "owner before server ready time must not start a trial");
        ready.serverMs = 100; ready.hasSelf = false;
        Must(!WishProof.IsReadyOwner(ready), "missing self must not provide a ready baseline");
        ready.hasSelf = true; ready.player = 0;
        Must(!WishProof.IsReadyOwner(ready), "zero owner identity must not provide a ready baseline");
        ready.player = 42; ready.hasWish = false;
        Must(!WishProof.IsReadyOwner(ready), "missing Wish must not provide a ready baseline");
        var finish = new WishProof.ProofResult();
        WishProof.SetFinishVerdict(finish, "complete", "matched", false, false, true);
        Must(finish.status == "incomplete" && finish.reason == "input_release_overflow" && finish.overflow,
            "failed input release must downgrade completion");
        WishProof.SetFinishVerdict(finish, "complete", "matched", false, true, false);
        Must(finish.status == "incomplete" && finish.reason == "trace_overflow" && finish.overflow,
            "trace overflow must downgrade completion");
        Console.WriteLine("encoded sample/input, landed/presentation, and owner-update matcher contracts passed");
    }
}

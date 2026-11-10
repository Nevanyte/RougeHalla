using NUnit.Framework;
using UnityEngine;

namespace Roguehalla.Client.Tests
{
    /// <summary>Region audio gating, the missing-file path and the crossfade state machine (the browser probe covers the real output).</summary>
    public sealed class AudioEditModeTests
    {
        static CrossfadeChannel Music() { var c = new CrossfadeChannel(); c.Fallback = id => id == "music_coliseum" ? null : id.StartsWith("music_") ? "music_coliseum" : null; return c; }
        static void Run(CrossfadeChannel c, float seconds) { for (float t = 0; t < seconds; t += .05f) c.Tick(.05f); }

        [Test] public void NothingIsRequestedWhileNoRegionIsKnown()
        {
            var c = Music();
            c.Request(null);   // AtmosphereAudio.SetRegion(null): launch, planning, results, unknown region
            for (int i = 0; i < 200; i++) { c.Tick(.05f); Assert.IsFalse(c.TryTakeLoad(out _), "no fetch without a region"); }
            Assert.IsFalse(c.AnyAudible); Assert.AreEqual(-1, c.IncomingDeck);
        }

        [Test] public void RegionRowsAreOnlyAskedForAfterTheGateOpens()
        {
            var gate = new Roguehalla.Net.RegionAudioGate();
            Assert.AreEqual(0, gate.Update(true, (int)RegionId.Fire, 0f), "placeholder first fix");
            Assert.AreEqual(0, gate.Update(true, (int)RegionId.Plague, .2f), "real region restarts the clock");
            Assert.AreEqual((int)RegionId.Plague, gate.Update(true, (int)RegionId.Plague, Roguehalla.Net.RegionAudioGate.SettleSeconds + .3f));
            var c = Music(); c.Request(RegionAtmosphereTable.Get(RegionId.Plague).Music);
            Assert.IsTrue(c.TryTakeLoad(out string id)); Assert.AreEqual("music_plague", id);
        }

        [Test] public void MissingFilesFailOnceThenFallBackAndNeverRetry()
        {
            var c = Music(); c.Request("music_fire");
            Assert.IsTrue(c.TryTakeLoad(out string first)); Assert.AreEqual("music_fire", first);
            c.MarkFailed("music_fire");                                   // 404
            Assert.IsTrue(c.TryTakeLoad(out string second)); Assert.AreEqual("music_coliseum", second);
            c.MarkFailed("music_coliseum");                               // the fallback is missing too
            for (int i = 0; i < 100; i++) { c.Tick(.05f); Assert.IsFalse(c.TryTakeLoad(out _), "no retry storm"); }
            Assert.IsNull(c.Target()); Assert.IsFalse(c.AnyAudible);
        }

        [Test] public void AFailedOrSlowLoadKeepsTheOldTrackPlaying()
        {
            var c = Music(); c.Request("music_a"); c.TryTakeLoad(out _); c.MarkReady("music_a"); Run(c, 2.5f);
            Assert.IsTrue(c.AnyAudible);
            c.Request("music_b"); c.TryTakeLoad(out _);                  // still loading
            Run(c, 5f); int deck = c.IncomingDeck;
            Assert.AreEqual("music_a", c.Track[deck]); Assert.AreEqual(1f, c.Gain[deck], 1e-4f);
            c.MarkReady("music_b"); Run(c, 2.5f);
            Assert.AreEqual("music_b", c.Track[c.IncomingDeck]);
            int audible = 0; for (int i = 0; i < CrossfadeChannel.Decks; i++) if (c.Track[i] != null && c.Gain[i] > .001f) audible++;
            Assert.AreEqual(1, audible, "the old deck is released after the fade");
        }

        [Test] public void CrossfadeKeepsConstantPowerThroughTheFade()
        {
            var c = Music(); c.Request("music_a"); c.TryTakeLoad(out _); c.MarkReady("music_a"); Run(c, 2.5f);
            c.Request("music_b"); c.TryTakeLoad(out _); c.MarkReady("music_b");
            float min = 9f, max = 0f;
            for (float t = 0; t < 2.5f; t += .05f)
            {
                c.Tick(.05f); float p = 0f;
                for (int i = 0; i < CrossfadeChannel.Decks; i++) if (c.Track[i] != null) { float g = CrossfadeChannel.Curve(c.Gain[i]); p += g * g; }
                if (t > .1f) { min = Mathf.Min(min, p); max = Mathf.Max(max, p); }
            }
            Assert.That(min, Is.GreaterThan(.95f)); Assert.That(max, Is.LessThan(1.05f));
        }
    }
}

using Roguehalla.Net;
using NUnit.Framework;

namespace Roguehalla.Net.Tests
{
    public class RegionAudioGateTests
    {
        [Test] public void Silent_until_the_match_is_active()
        {
            var g = new RegionAudioGate();
            Assert.AreEqual(0, g.Update(false, 3, 0f)); Assert.AreEqual(0, g.Update(false, 3, 5f));
        }
        [Test] public void Silent_while_the_region_is_unknown_even_in_a_running_match()
        {
            var g = new RegionAudioGate();
            Assert.AreEqual(0, g.Update(true, 0, 0f)); Assert.AreEqual(0, g.Update(true, 0, 10f));
        }
        [Test] public void First_region_must_hold_before_it_is_released()
        {
            var g = new RegionAudioGate();
            Assert.AreEqual(0, g.Update(true, 1, 0f));
            Assert.AreEqual(0, g.Update(true, 1, RegionAudioGate.SettleSeconds - .1f));
            Assert.AreEqual(1, g.Update(true, 1, RegionAudioGate.SettleSeconds + .01f));
        }
        [Test] public void A_placeholder_first_fix_never_plays()
        {
            var g = new RegionAudioGate();
            Assert.AreEqual(0, g.Update(true, 1, 0f));          // wrong first fix
            Assert.AreEqual(0, g.Update(true, 4, .3f));         // real region arrives: the clock restarts
            Assert.AreEqual(0, g.Update(true, 4, .8f));
            Assert.AreEqual(4, g.Update(true, 4, 1.0f));
        }
        [Test] public void Later_changes_apply_immediately_and_leaving_the_match_silences()
        {
            var g = new RegionAudioGate();
            g.Update(true, 2, 0f); Assert.AreEqual(2, g.Update(true, 2, 1f));
            Assert.AreEqual(5, g.Update(true, 5, 1.1f));
            Assert.AreEqual(0, g.Update(false, 5, 2f));
            Assert.AreEqual(0, g.Update(true, 5, 2.1f));        // restarts the settle clock
        }
        [Test] public void Trims_bring_every_track_to_its_target_and_unknown_ids_stay_untouched()
        {
            foreach (var id in AudioTrims.Ids)
            {
                float target = id.StartsWith("amb_") ? AudioTrims.AmbienceTargetDb : AudioTrims.MusicTargetDb;
                Assert.AreEqual(target, AudioTrims.MeasuredDb(id) + AudioTrims.TrimDb(id), 1e-3f, id);
                Assert.Less(AudioTrims.TrimDb(id), 6f, id + " must not be boosted hard (peaks)");
            }
            Assert.AreEqual(1f, AudioTrims.Gain("unknown"), 1e-6f);
            Assert.Greater(AudioTrims.MusicTargetDb - AudioTrims.AmbienceTargetDb, 6f, "ambience sits clearly under music");
        }

        [Test] public void LoopPointsAreOrderedAndLeaveAtLeastTenSeconds()
        {
            foreach (var id in AudioTrims.Ids)
            {
                AudioLoops.For(id, out float a, out float b);
                Assert.GreaterOrEqual(a, 0f, id);
                if (b > 0f) { Assert.Greater(b - a, 10f, id); Assert.Less(a, 5f, id + " must not cut away real music"); }
            }
            AudioLoops.For("unknown", out float ua, out float ub); Assert.AreEqual(0f, ua); Assert.AreEqual(0f, ub);
        }
    }
}

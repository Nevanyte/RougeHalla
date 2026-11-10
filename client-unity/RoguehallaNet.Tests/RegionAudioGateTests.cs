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
        [Test] public void Trims_default_to_unity_gain() { Assert.AreEqual(1f, AudioTrims.Gain("music_fire"), 1e-3); }
    }
}

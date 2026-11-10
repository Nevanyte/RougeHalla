using NUnit.Framework;
using Roguehalla.Client;

namespace Roguehalla.Net.Tests
{
    public class QualityTests
    {
        [TearDown] public void Reset() { Quality.Reset(); }

        [Test]
        public void PresetsAreMonotonicAndUltraAddsToHigh()
        {
            var low = QualityTable.For(ShowcaseQuality.Low); var med = QualityTable.For(ShowcaseQuality.Medium);
            var high = QualityTable.For(ShowcaseQuality.High); var ultra = QualityTable.For(ShowcaseQuality.Ultra);
            Assert.That(low.Particles, Is.LessThan(med.Particles)); Assert.That(med.Particles, Is.LessThan(high.Particles));
            Assert.That(high.Particles, Is.LessThan(ultra.Particles));
            Assert.That(low.DynamicLights, Is.EqualTo(0)); Assert.That(med.DynamicLights, Is.EqualTo(3));
            Assert.That(high.DynamicLights, Is.EqualTo(6)); Assert.That(ultra.DynamicLights, Is.GreaterThan(6));
            Assert.That(low.Bloom || low.ColorGrading || low.Vignette, Is.False);
            Assert.That(low.AmbientParticles, Is.False);
            Assert.That(high.Shadows && ultra.Shadows, Is.True); Assert.That(med.Shadows, Is.False);
            Assert.That(ultra.Bloom && ultra.ColorGrading && ultra.Vignette && ultra.AmbientParticles, Is.True);
            Assert.That(low.RenderScale, Is.LessThan(1f)); Assert.That(ultra.RenderScale, Is.EqualTo(1f));
        }

        [Test]
        public void ClampKeepsStoredValuesInRange()
        {
            Assert.That(QualityTable.Clamp(-4), Is.EqualTo(ShowcaseQuality.Low));
            Assert.That(QualityTable.Clamp(2), Is.EqualTo(ShowcaseQuality.High));
            Assert.That(QualityTable.Clamp(3), Is.EqualTo(ShowcaseQuality.Ultra));
            Assert.That(QualityTable.Clamp(99), Is.EqualTo(ShowcaseQuality.Ultra));
        }

        [Test]
        public void FlagsPinAPresetAndOverrideSingleEffects()
        {
            ShowcaseQuality? preset; bool adaptive; QualityOverrides o;
            QualityFlags.Parse("?server=ws%3A%2F%2Fx&quality=ULTRA&fx.bloom=0&fx.lights=4&fx.particles=0.5&fx.scale=0.8&fx.ambient=off#frag", out preset, out adaptive, out o);
            Assert.That(preset, Is.EqualTo(ShowcaseQuality.Ultra)); Assert.That(adaptive, Is.False);
            Assert.That(o.Bloom, Is.False); Assert.That(o.DynamicLights, Is.EqualTo(4));
            Assert.That(o.Particles, Is.EqualTo(.5f)); Assert.That(o.RenderScale, Is.EqualTo(.8f)); Assert.That(o.AmbientParticles, Is.False);
            Assert.That(o.Shadows, Is.Null); Assert.That(o.IsEmpty, Is.False);
            var row = o.ApplyTo(QualityTable.For(ShowcaseQuality.Ultra));
            Assert.That(row.Bloom, Is.False); Assert.That(row.ColorGrading, Is.True); Assert.That(row.DynamicLights, Is.EqualTo(4));
        }

        [Test]
        public void FlagsPostCoversAllThreeAndGarbageIsIgnored()
        {
            ShowcaseQuality? preset; bool adaptive; QualityOverrides o;
            QualityFlags.Parse("fx.post=0&fx.lights=lots&fx.particles=NaN&fx.scale=99&quality=bogus&fx.props=-3", out preset, out adaptive, out o);
            Assert.That(preset, Is.Null);
            Assert.That(o.Bloom == false && o.ColorGrading == false && o.Vignette == false, Is.True);
            Assert.That(o.DynamicLights, Is.Null); Assert.That(o.Particles, Is.Null);
            Assert.That(o.RenderScale, Is.EqualTo(2f), "clamped"); Assert.That(o.PropDensity, Is.EqualTo(0f), "clamped");
            QualityFlags.Parse("quality=adaptive", out preset, out adaptive, out o);
            Assert.That(adaptive, Is.True); Assert.That(o.IsEmpty, Is.True);
            QualityFlags.Parse(null, out preset, out adaptive, out o);
            Assert.That(preset, Is.Null); Assert.That(o.IsEmpty, Is.True);
        }

        [Test]
        public void StaticApiReflectsRowAndOverridesAndRaisesChanged()
        {
            int changes = 0; System.Action count = () => changes++;
            Quality.Changed += count;
            try
            {
                Quality.Set(ShowcaseQuality.Ultra, default(QualityOverrides));
                Assert.That(Quality.Preset, Is.EqualTo(ShowcaseQuality.Ultra)); Assert.That(Quality.DynamicLights, Is.EqualTo(12));
                Assert.That(Quality.Particles, Is.EqualTo(1.5f)); Assert.That(Quality.AnyPostProcessing, Is.True);
                Quality.Set(ShowcaseQuality.Ultra, default(QualityOverrides));
                Assert.That(changes, Is.EqualTo(1), "setting the same row again is not a change");
                var o = new QualityOverrides { Bloom = false, ColorGrading = false, Vignette = false };
                Quality.Set(ShowcaseQuality.Ultra, o);
                Assert.That(Quality.AnyPostProcessing, Is.False); Assert.That(Quality.HasOverrides, Is.True);
                Assert.That(changes, Is.EqualTo(2));
            }
            finally { Quality.Changed -= count; }
        }

        // ---- adaptive controller -------------------------------------------------------------------------------

        static AdaptiveQualityController Run(AdaptiveQualityController c, float seconds, float frameMs, float cpuMs, ref int changes)
        {
            float dt = frameMs / 1000f;
            for (float t = 0; t < seconds; t += dt) if (c.Update(dt, frameMs, cpuMs)) changes++;
            return c;
        }

        [Test]
        public void ProbePicksUltraWhenFastAndLowWhenSlow()
        {
            int n = 0;
            var fast = Run(new AdaptiveQualityController(ShowcaseQuality.High), 5f, 6.94f, 2f, ref n);
            Assert.That(fast.Probing, Is.False); Assert.That(fast.Current, Is.EqualTo(ShowcaseQuality.Ultra));
            var slow = Run(new AdaptiveQualityController(ShowcaseQuality.High), 5f, 40f, 12f, ref n);
            Assert.That(slow.Current, Is.EqualTo(ShowcaseQuality.Low));
            var mid = Run(new AdaptiveQualityController(ShowcaseQuality.High), 5f, 16.67f, 11f, ref n);
            Assert.That(mid.Current, Is.EqualTo(ShowcaseQuality.Medium).Or.EqualTo(ShowcaseQuality.Low));
            var busy = Run(new AdaptiveQualityController(ShowcaseQuality.High), 5f, 16.67f, 7f, ref n);
            Assert.That(busy.Current, Is.EqualTo(ShowcaseQuality.High));
        }

        [Test]
        public void ProbeIgnoresTheFirstSecondAndNeverExceedsTheMax()
        {
            int n = 0;
            var c = new AdaptiveQualityController(ShowcaseQuality.High, ShowcaseQuality.High);
            Run(c, .9f, 200f, 0f, ref n); // load hitches inside the skip window are ignored
            Run(c, 5f, 6.94f, 2f, ref n);
            Assert.That(c.Current, Is.EqualTo(ShowcaseQuality.High));
        }

        [Test]
        public void StepsDownOnlyAfterTheHoldAndIgnoresStalls()
        {
            int n = 0;
            var c = new AdaptiveQualityController(ShowcaseQuality.High);
            Run(c, 5f, 6.94f, 2f, ref n); Assert.That(c.Current, Is.EqualTo(ShowcaseQuality.Ultra));
            n = 0;
            c.Update(.3f, 300f, 0f); // a 300 ms stall (hidden tab) is not load
            Run(c, 1.2f, 6.94f, 2f, ref n);
            Assert.That(c.Current, Is.EqualTo(ShowcaseQuality.Ultra));
            Run(c, 1.0f, 13f, 3f, ref n); // missing the refresh, but under the hold + settle
            Assert.That(n, Is.EqualTo(0));
            Run(c, 6f, 13f, 3f, ref n);
            Assert.That(c.Current, Is.LessThan(ShowcaseQuality.Ultra)); Assert.That(n, Is.GreaterThanOrEqualTo(1));
        }

        [Test]
        public void JitteredVsyncCadenceStillStepsUp()
        {
            // 144 Hz with +-1 ms rAF timestamp jitter (mean 6.94 ms): the refresh estimate must stay near the real cadence so the
            // frame-ratio test (< 1.10) can pass; with the raw minimum it sat at about 1.15 and the controller could never step up.
            var c = new AdaptiveQualityController(ShowcaseQuality.High, ShowcaseQuality.Ultra);
            int n = 0;
            float[] jitter = { 6.0f, 7.9f, 6.3f, 7.6f, 6.9f, 7.0f, 6.1f, 7.8f };
            float Next(int i) { return jitter[i % jitter.Length]; }
            int k = 0; float t = 0;
            while (t < 4.5f) { float f = Next(k++); t += f / 1000f; if (c.Update(f / 1000f, f, 3.4f)) n++; }   // cpu 3.4 ms = 0.49 of 6.94: probe picks High
            Assert.That(c.Current, Is.EqualTo(ShowcaseQuality.High));
            Assert.That(c.RefreshMs, Is.EqualTo(6.94f).Within(.4f), "the estimate follows the cadence, not the jitter floor");
            t = 0;
            while (t < 14f) { float f = Next(k++); t += f / 1000f; if (c.Update(f / 1000f, f, 2.0f)) n++; }   // headroom: cpu 2 ms = 0.29
            Assert.That(c.Current, Is.EqualTo(ShowcaseQuality.Ultra), "steps up after the 8 s hold");
        }

        [Test]
        public void DeadZoneDoesNotOscillate()
        {
            int n = 0;
            var c = new AdaptiveQualityController(ShowcaseQuality.High);
            Run(c, 5f, 6.94f, 2f, ref n); n = 0;
            // cpu between the up and down thresholds (0.36..0.55 of the refresh): neither direction triggers
            Run(c, 60f, 6.94f, 3.1f, ref n);
            Assert.That(n, Is.EqualTo(0)); Assert.That(c.Current, Is.EqualTo(ShowcaseQuality.Ultra));
        }

        [Test]
        public void StepsUpSlowlyAndBansAnUpgradeThatImmediatelyFails()
        {
            int n = 0;
            var c = new AdaptiveQualityController(ShowcaseQuality.High, ShowcaseQuality.Ultra);
            Run(c, 4.5f, 16.67f, 11f, ref n); // probe lands below Ultra on a busy 60 Hz machine
            var start = c.Current; Assert.That(start, Is.LessThan(ShowcaseQuality.Ultra));
            n = 0;
            Run(c, 6f, 16.67f, 3f, ref n); // headroom, but not for the full 8 s yet
            Assert.That(c.Current, Is.EqualTo(start));
            Run(c, 6f, 16.67f, 3f, ref n); // now past the up-hold: one step up
            Assert.That(c.Current, Is.EqualTo(start + 1)); Assert.That(n, Is.EqualTo(1));
            var upgraded = c.Current;
            Run(c, 8f, 30f, 14f, ref n); // the new row misses vsync: drops back down soon after upgrading
            Assert.That(c.Current, Is.LessThan(upgraded));
            int before = n;
            Run(c, 40f, 16.67f, 3f, ref n); // healthy again, but the failed upgrade is banned for a minute
            Assert.That(n, Is.EqualTo(before), "no re-upgrade inside the ban window");
            Run(c, 40f, 16.67f, 3f, ref n);
            Assert.That(c.Current, Is.EqualTo(upgraded), "the ban expires and the upgrade is retried");
        }

        [Test]
        public void EstimatesRefreshFromTheFastEndAndCapsAtSixtyHertz()
        {
            int n = 0;
            var c = new AdaptiveQualityController();
            Run(c, 3f, 6.94f, 0f, ref n);
            Assert.That(c.RefreshMs, Is.EqualTo(6.94f).Within(.01f));
            var slow = Run(new AdaptiveQualityController(), 3f, 33f, 0f, ref n);
            Assert.That(slow.RefreshMs, Is.EqualTo(1000f / 60f).Within(.01f));
        }
    }
}

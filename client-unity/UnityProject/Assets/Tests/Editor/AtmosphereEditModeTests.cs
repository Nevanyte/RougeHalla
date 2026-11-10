using System.IO;
using NUnit.Framework;
using Roguehalla.Net.Protocol;
using UnityEngine;

namespace Roguehalla.Client.Tests
{
    /// <summary>Region atmosphere: table, blend maths, spatial field, particle budget, switchboard, audio state machine, light and shadow culling.</summary>
    public sealed class AtmosphereEditModeTests
    {
        [SetUp] public void SetUp() { AtmosphereQuality.SetUrl(""); AtmosphereQuality.ApplyPreset(ShowcaseQuality.High, false); }
        [TearDown] public void TearDown() { AtmosphereQuality.SetUrl(""); AtmosphereQuality.ApplyPreset(ShowcaseQuality.High, false); }

        // ---- table ------------------------------------------------------------------------------------------------------------
        [Test] public void EveryRegionHasARow()
        {
            for (int i = 0; i < 7; i++)
            {
                var row = RegionAtmosphereTable.Get((RegionId)i);
                Assert.NotNull(row, "region " + i); Assert.IsNotEmpty(row.Name);
            }
            for (int i = 1; i <= 6; i++) Assert.AreEqual((RegionId)i, RegionAtmosphereTable.Get((RegionId)i).Region);
            Assert.AreEqual(RegionAtmosphereTable.Get(RegionId.Coliseum).Params.SunStrength, RegionAtmosphereTable.Get(RegionId.None).Params.SunStrength, "none behaves like the coliseum");
        }

        [Test] public void ColoursComeFromThePalette()
        {
            for (int i = 1; i <= 6; i++)
            {
                var id = (RegionId)i; var p = RegionAtmosphereTable.Get(id).Params;
                var fog = RegionAtmosphereTable.Palette(id, RegionPaletteGenerated.Fog);
                Assert.AreEqual(fog.r, p.Haze.r, 1e-4f, id + " haze r"); Assert.AreEqual(fog.g, p.Haze.g, 1e-4f, id + " haze g"); Assert.AreEqual(fog.b, p.Haze.b, 1e-4f, id + " haze b");
                var srgb = RegionPaletteGenerated.Srgb[i][RegionPaletteGenerated.Fog];
                Assert.AreEqual(srgb.r / 255f, p.Haze.r, 1e-4f);
                // the shadow tint is the palette shadow colour darkened toward black
                var sh = RegionAtmosphereTable.Palette(id, RegionPaletteGenerated.Shadow);
                Assert.LessOrEqual(p.ShadowTint.r, sh.r + 1e-4f); Assert.LessOrEqual(p.ShadowTint.g, sh.g + 1e-4f); Assert.LessOrEqual(p.ShadowTint.b, sh.b + 1e-4f);
            }
            // Hue ordering sanity: frost light is cold, fire light is warm.
            var frost = RegionAtmosphereTable.Get(RegionId.Frost).Params; var fire = RegionAtmosphereTable.Get(RegionId.Fire).Params;
            Assert.Greater(frost.AmbientColor.b, frost.AmbientColor.r); Assert.Greater(fire.AmbientColor.r, fire.AmbientColor.b);
        }

        [Test] public void FairnessDarknessNeverHidesActors()
        {
            for (int i = 0; i <= 6; i++)
            {
                var p = RegionAtmosphereTable.Get(i).Params;
                Assert.GreaterOrEqual(p.LightScale, .8f, "light scale region " + i);
                Assert.LessOrEqual(p.VignetteIntensity, .3f, "vignette region " + i);
                Assert.GreaterOrEqual(p.PostExposure, -.1f); Assert.LessOrEqual(p.Contrast, 20f);
                float amb = Mathf.Max(p.AmbientColor.r, Mathf.Max(p.AmbientColor.g, p.AmbientColor.b)); Assert.GreaterOrEqual(amb, .3f, "minimum ambient region " + i);
                Assert.LessOrEqual(p.Haze.a, .16f, "haze must stay faint region " + i);
            }
        }

        [Test] public void SunCharacterMatchesTheBrief()
        {
            float S(RegionId r) { return RegionAtmosphereTable.Get(r).Params.SunStrength; }
            Assert.Greater(S(RegionId.Frost), S(RegionId.Plague)); Assert.Greater(S(RegionId.Holy), S(RegionId.Plague));
            Assert.Greater(S(RegionId.Plague), S(RegionId.Sentenced)); Assert.Less(S(RegionId.Fire), .3f); Assert.Greater(S(RegionId.Fire), .1f, "fire keeps a small real sun");
            Assert.Greater(S(RegionId.Plague), .5f, "sunlight reaches the open marsh"); var ps = RegionAtmosphereTable.Get(RegionId.Plague).Params.SunColor; Assert.Greater(ps.g, ps.b, "green-gold, not blue");
            Assert.Greater(RegionAtmosphereTable.Get(RegionId.Frost).Params.ShadowLength, RegionAtmosphereTable.Get(RegionId.Sentenced).Params.ShadowLength);
        }

        [Test] public void PassiveLightFloorHoldsEverywhereWithoutAnyEmitter()
        {
            // No emissive source, no accent light, any surface orientation: the passive light never drops below the region floor, which is never below the global minimum.
            AtmosphereQuality.Apply(1f, false, 0, false, false, false, false);   // every emitter and effect switched off
            for (int i = 0; i <= 6; i++)
            {
                var p = RegionAtmosphereTable.Get(i).Params;
                foreach (float ndl in new[] { 0f, .3f, .65f, 1f })
                {
                    var m = AtmosphereLighting.Passive(p, ndl);
                    Assert.GreaterOrEqual(m.r, AtmosphereLighting.GlobalMinFloor - 1e-4f, "region " + i + " ndl " + ndl + " r");
                    Assert.GreaterOrEqual(m.g, AtmosphereLighting.GlobalMinFloor - 1e-4f, "region " + i + " ndl " + ndl + " g");
                    Assert.GreaterOrEqual(m.b, AtmosphereLighting.GlobalMinFloor - 1e-4f, "region " + i + " ndl " + ndl + " b");
                    Assert.GreaterOrEqual(m.r, p.PassiveFloor.r - 1e-4f); Assert.GreaterOrEqual(m.g, p.PassiveFloor.g - 1e-4f); Assert.GreaterOrEqual(m.b, p.PassiveFloor.b - 1e-4f);
                }
                Assert.GreaterOrEqual(Mathf.Min(p.PassiveFloor.r, Mathf.Min(p.PassiveFloor.g, p.PassiveFloor.b)), AtmosphereLighting.GlobalMinFloor - 1e-4f, "floor of region " + i);
                Assert.GreaterOrEqual(p.LightScale, .8f, "the global light never dims below .8 of the base");
            }
            // blended mid-border light is also at or above the floor
            var f = new RegionField(); f.Build(TwoRegionPlane(40, 8, (byte)RegionId.Fire, (byte)RegionId.Frost), 40, 8); var w = new float[6];
            for (float x = 2; x < 38; x += 1.5f) { f.Sample(x, 4, w); var m = AtmosphereLighting.Passive(RegionField.Blend(w), 0f); Assert.GreaterOrEqual(Mathf.Min(m.r, Mathf.Min(m.g, m.b)), AtmosphereLighting.GlobalMinFloor - 1e-3f); }
            Assert.IsFalse(AtmosphereQuality.DynamicLights, "emitters were off for this check");
        }

        [Test] public void PassiveLightRankingFollowsTheBrief()
        {
            float L(RegionId r) { return AtmosphereLighting.Level(RegionAtmosphereTable.Get(r).Params); }
            Assert.Greater(L(RegionId.Holy), L(RegionId.Frost), "holy > frost");
            Assert.Greater(L(RegionId.Frost), L(RegionId.Plague), "frost > plague");
            Assert.Greater(L(RegionId.Plague), L(RegionId.Fire), "plague > fire");
            Assert.GreaterOrEqual(L(RegionId.Fire), L(RegionId.Sentenced), "fire >= sentenced");
            for (int i = 0; i <= 6; i++) Assert.GreaterOrEqual(AtmosphereLighting.Level(RegionAtmosphereTable.Get(i).Params), AtmosphereLighting.GlobalMinFloor, "level of region " + i);
            var t = RegionAtmosphereTable.Get(RegionAtmosphereTable.Profile.HolyTempleInterior);
            Assert.NotNull(t); var m = AtmosphereLighting.Passive(t.Params, 0f);
            Assert.GreaterOrEqual(Mathf.Min(m.r, Mathf.Min(m.g, m.b)), .5f, "temple interior is evenly lit even in shade");
            Assert.Greater(AtmosphereLighting.Level(t.Params), L(RegionId.Fire)); Assert.Greater(t.Params.AmbientColor.r, t.Params.AmbientColor.b, "warm");
        }

        [Test] public void RaysAreSwitchableAndOnlyInHolyAndPlague()
        {
            foreach (RegionId r in new[] { RegionId.Holy, RegionId.Plague })
            {
                bool any = false; foreach (var l in ParticlePresets.Get(RegionAtmosphereTable.Get(r).Particles)) any |= l.Texture == "shaft"; Assert.IsTrue(any, r + " has light shafts");
            }
            foreach (RegionId r in new[] { RegionId.Frost, RegionId.Fire, RegionId.Sentenced })
                foreach (var l in ParticlePresets.Get(RegionAtmosphereTable.Get(r).Particles)) Assert.AreNotEqual("shaft", l.Texture);
            int on = ParticlePresets.Budget(ParticlePresetId.Pollen, 1f); AtmosphereQuality.SetUrl("?fx.rays=0");
            Assert.Less(ParticlePresets.Budget(ParticlePresetId.Pollen, 1f), on); AtmosphereQuality.SetUrl("");
            AtmosphereQuality.ApplyPreset(ShowcaseQuality.High, true); Assert.AreEqual(0, ParticlePresets.Budget(ParticlePresetId.Pollen, AtmosphereQuality.ParticleDensity), "reduced motion: no rays");
        }

        [Test] public void OutlineGroundEstimateIsSaneForEveryZonePalette()
        {
            // The light rim is gone (the adaptive outline replaced it); the CPU ground estimate only breaks ties inside the outline's dead zone.
            var saved = AtmosphereShadows.Field; AtmosphereShadows.Field = null;
            try { Assert.AreEqual(.2f, AtmosphereShadows.GroundLumaLinear(1, 1), 1e-5f, "no field: a neutral guess"); }
            finally { AtmosphereShadows.Field = saved; }
            foreach (int r in new[] { 1, 2, 3, 4, 5, 6 })
            {
                var c = RegionPaletteGenerated.Srgb[r][RegionPaletteGenerated.Base];
                float luma = ActorOutlineModel.Luma(Mathf.GammaToLinearSpace(c.r / 255f), Mathf.GammaToLinearSpace(c.g / 255f), Mathf.GammaToLinearSpace(c.b / 255f)) * ActorOutlineModel.LitFactor;
                Assert.That(luma, Is.InRange(0f, 1f), "region " + r);
            }
        }

        [Test] public void LanternsAreCullableLightSites()
        {
            var pl = new AccentLightPlanner(); for (int i = 0; i < 40; i++) pl.AddLantern(10 + (i % 8) * 18, 10 + (i / 8) * 30, 1f);
            Assert.IsTrue(RegionAtmosphereTable.AccentFor(TerrainKind.None).Lantern);
            var pick = new int[AtmosphereQuality.HardMaxLights];
            int n = pl.Select(60, 60, 84, 78, AccentLights.CullMargin, 4, pick); Assert.LessOrEqual(n, 4);
            for (int i = 0; i < n; i++) { var c = pl.Clusters[pick[i]]; Assert.IsTrue(c.Lantern); Assert.That(c.X, Is.InRange(60 - AccentLights.CullMargin, 84 + AccentLights.CullMargin)); Assert.That(c.Y, Is.InRange(60 - AccentLights.CullMargin, 78 + AccentLights.CullMargin)); }
        }

        [Test] public void AudioFilesExistForEveryTableId()
        {
            string dir = Path.Combine(Application.dataPath, "StreamingAssets", AtmosphereAudio.Folder);
            Assume.That(Directory.Exists(dir), "audio folder is moved aside during a build");
            for (int i = 0; i <= 6; i++)
            {
                var row = RegionAtmosphereTable.Get(i);
                if (row.Music != null) Assert.IsTrue(File.Exists(Path.Combine(dir, row.Music + AtmosphereAudio.Extension)), row.Music);
                if (row.Ambience != null) Assert.IsTrue(File.Exists(Path.Combine(dir, row.Ambience + AtmosphereAudio.Extension)), row.Ambience);
            }
        }

        // ---- blend maths ------------------------------------------------------------------------------------------------------
        [Test] public void BlendEndpointsAndMidpoint()
        {
            var a = RegionAtmosphereTable.Get(RegionId.Frost).Params; var b = RegionAtmosphereTable.Get(RegionId.Fire).Params;
            Assert.AreEqual(a.SunStrength, AtmosphereParams.Lerp(a, b, 0f).SunStrength, 1e-6f);
            Assert.AreEqual(b.SunStrength, AtmosphereParams.Lerp(a, b, 1f).SunStrength, 1e-6f);
            Assert.AreEqual((a.PostExposure + b.PostExposure) / 2f, AtmosphereParams.Lerp(a, b, .5f).PostExposure, 1e-5f);
            Assert.AreEqual(b.Haze.a, AtmosphereParams.Lerp(a, b, 2f).Haze.a, 1e-6f, "t is clamped");
        }

        [Test] public void BlenderIsSmoothMonotonicAndTakesAboutTheBlendTime()
        {
            var bl = new AtmosphereBlender(); var a = RegionAtmosphereTable.Get(RegionId.Frost).Params; var b = RegionAtmosphereTable.Get(RegionId.Fire).Params;
            bl.Snap(a); Assert.IsFalse(bl.Blending); bl.BlendTo(b, 1.5f); Assert.IsTrue(bl.Blending);
            float last = a.SunStrength; int steps = 0;
            while (bl.Blending && steps < 1000) { bl.Tick(1f / 60f); Assert.LessOrEqual(bl.Current.SunStrength, last + 1e-6f); last = bl.Current.SunStrength; steps++; }
            Assert.AreEqual(90, steps, 2); Assert.AreEqual(b.SunStrength, bl.Current.SunStrength, 1e-5f);
            Assert.IsFalse(bl.Tick(.1f));
            Assert.AreEqual(0f, AtmosphereBlender.Ease(0f)); Assert.AreEqual(1f, AtmosphereBlender.Ease(1f)); Assert.AreEqual(.5f, AtmosphereBlender.Ease(.5f), 1e-6f);
            Assert.Less(AtmosphereBlender.Ease(.05f), .01f, "zero slope at the start");
        }

        [Test] public void InterruptedBlendRestartsFromTheCurrentValue()
        {
            var bl = new AtmosphereBlender(); var a = RegionAtmosphereTable.Get(RegionId.Frost).Params; var b = RegionAtmosphereTable.Get(RegionId.Fire).Params; var c = RegionAtmosphereTable.Get(RegionId.Holy).Params;
            bl.Snap(a); bl.BlendTo(b, 1f); for (int i = 0; i < 30; i++) bl.Tick(1f / 60f);
            float mid = bl.Current.SunStrength; bl.BlendTo(c, 1f);
            Assert.AreEqual(mid, bl.Current.SunStrength, 1e-6f, "no jump when interrupted"); bl.Tick(1f / 600f);
            Assert.AreEqual(mid, bl.Current.SunStrength, .02f);
        }

        [Test] public void BlendTickDoesNotAllocate()
        {
            var bl = new AtmosphereBlender(); bl.Snap(RegionAtmosphereTable.Get(RegionId.Frost).Params); bl.BlendTo(RegionAtmosphereTable.Get(RegionId.Fire).Params);
            bl.Tick(.01f);
            long before = System.GC.GetAllocatedBytesForCurrentThread();
            for (int i = 0; i < 50; i++) bl.Tick(.01f);
            Assert.AreEqual(0, System.GC.GetAllocatedBytesForCurrentThread() - before);
        }

        // ---- spatial field ----------------------------------------------------------------------------------------------------
        static byte[] TwoRegionPlane(int w, int h, byte left, byte right)
        {
            var r = new byte[w * h]; for (int y = 0; y < h; y++) for (int x = 0; x < w; x++) r[y * w + x] = x < w / 2 ? left : right; return r;
        }

        [Test] public void FieldWeightsGradeContinuouslyAcrossABorder()
        {
            var f = new RegionField(); f.Build(TwoRegionPlane(40, 8, (byte)RegionId.Frost, (byte)RegionId.Fire), 40, 8);
            var w = new float[6]; float prevFrost = 2f; bool graded = false;
            for (float x = 4f; x < 36f; x += .25f)
            {
                f.Sample(x, 4f, w); float sum = 0; foreach (var v in w) sum += v; Assert.AreEqual(1f, sum, 1e-3f);
                Assert.LessOrEqual(w[3], prevFrost + 1e-4f, "frost weight never rises moving into fire"); prevFrost = w[3];
                if (w[3] > .2f && w[3] < .8f) graded = true;
            }
            Assert.IsTrue(graded, "there is a graded band, not a step");
            f.Sample(2f, 4f, w); Assert.AreEqual((int)RegionId.Frost, RegionField.Dominant(w));
            f.Sample(38f, 4f, w); Assert.AreEqual((int)RegionId.Fire, RegionField.Dominant(w));
            var mid = new float[6]; f.Sample(20f, 4f, mid); var blended = RegionField.Blend(mid);
            Assert.Greater(blended.SunStrength, RegionAtmosphereTable.Get(RegionId.Fire).Params.SunStrength);
            Assert.Less(blended.SunStrength, RegionAtmosphereTable.Get(RegionId.Frost).Params.SunStrength);
        }

        // ---- particles --------------------------------------------------------------------------------------------------------
        [Test] public void ParticleBudgetFollowsQuality()
        {
            foreach (ParticlePresetId id in System.Enum.GetValues(typeof(ParticlePresetId)))
            {
                Assert.AreEqual(0, ParticlePresets.Budget(id, 0f));
                int high = ParticlePresets.Budget(id, 1f), med = ParticlePresets.Budget(id, .55f);
                Assert.LessOrEqual(high, ParticlePresets.HardBudget); Assert.LessOrEqual(med, high);
                Assert.LessOrEqual(ParticlePresets.Layers(id), ParticlePresets.MaxLayers);
                if (id != ParticlePresetId.None) { Assert.Greater(high, 0); Assert.Less(med, high); }
            }
            Assert.LessOrEqual(ParticlePresets.Budget(ParticlePresetId.Snow, 99f), Mathf.CeilToInt(ParticlePresets.HardBudget * AtmosphereQuality.MaxParticleDensity), "density is clamped");
            Assert.AreEqual(ParticlePresetId.Snow, RegionAtmosphereTable.Get(RegionId.Frost).Particles);
            Assert.AreEqual(ParticlePresetId.Embers, RegionAtmosphereTable.Get(RegionId.Fire).Particles);
        }

        [Test] public void ParticleLayersKeepActorsVisible()
        {
            foreach (ParticlePresetId id in System.Enum.GetValues(typeof(ParticlePresetId)))
                foreach (var l in ParticlePresets.Get(id))
                {
                    if (!l.AboveActors) continue;
                    Assert.LessOrEqual(l.Tint.a, .8f, id + " above-actor alpha"); Assert.LessOrEqual(l.SizeMax, .5f, id + " above-actor size");
                    Assert.LessOrEqual(l.MaxParticles, 30, id + " above-actor count");
                }
        }

        // ---- switchboard ------------------------------------------------------------------------------------------------------
        [Test] public void PresetsToggleTheSwitchboard()
        {
            AtmosphereQuality.ApplyPreset(ShowcaseQuality.Low, false);
            Assert.AreEqual(0f, AtmosphereQuality.ParticleDensity); Assert.AreEqual(0, AtmosphereQuality.EffectiveMaxLights); Assert.IsFalse(AtmosphereQuality.PostProcessing);
            AtmosphereQuality.ApplyPreset(ShowcaseQuality.High, false);
            Assert.AreEqual(1f, AtmosphereQuality.ParticleDensity); Assert.AreEqual(4, AtmosphereQuality.EffectiveMaxLights); Assert.IsTrue(AtmosphereQuality.Bloom);
            AtmosphereQuality.ApplyPreset(ShowcaseQuality.High, true);
            Assert.AreEqual(0f, AtmosphereQuality.ParticleDensity, "reduced motion turns screen particles off");
            AtmosphereQuality.ApplyPreset(ShowcaseQuality.Medium, false);
            Assert.Less(AtmosphereQuality.ParticleDensity, 1f); Assert.AreEqual(2, AtmosphereQuality.EffectiveMaxLights);
        }

        [Test] public void UrlOverridesWinOverPresets()
        {
            AtmosphereQuality.SetUrl("http://127.0.0.1:8127/?server=ws%3A%2F%2Fx&fx.particles=0&fx.lights=0&fx.post=0&fx.bloom=0&fx.shadows=0&fx.ice=0&fx.shimmer=false#frag");
            AtmosphereQuality.ApplyPreset(ShowcaseQuality.High, false);
            Assert.AreEqual(0f, AtmosphereQuality.ParticleDensity); Assert.AreEqual(0, AtmosphereQuality.EffectiveMaxLights); Assert.IsFalse(AtmosphereQuality.PostProcessing);
            Assert.IsFalse(AtmosphereQuality.Bloom); Assert.IsFalse(AtmosphereQuality.Shadows); Assert.IsFalse(AtmosphereQuality.IceTranslucency); Assert.IsFalse(AtmosphereQuality.HeatShimmer);
            Assert.IsTrue(AtmosphereQuality.Grading, "unmentioned effects follow the preset");
            AtmosphereQuality.SetUrl("http://x/?fx.particles=.5&fx.lights=2");
            Assert.AreEqual(.5f, AtmosphereQuality.ParticleDensity, 1e-4f); Assert.AreEqual(2, AtmosphereQuality.EffectiveMaxLights);
            AtmosphereQuality.SetUrl("http://x/?fx.particles=99"); Assert.AreEqual(AtmosphereQuality.MaxParticleDensity, AtmosphereQuality.ParticleDensity);
        }

        // ---- audio state machine ----------------------------------------------------------------------------------------------
        static void Run(CrossfadeChannel c, float seconds) { for (float t = 0; t < seconds; t += .05f) c.Tick(.05f); }

        [Test] public void NothingPlaysUntilTheFileIsReadyAndTheOldTrackKeepsPlaying()
        {
            var c = new CrossfadeChannel();
            c.Request("a"); Assert.IsTrue(c.TryTakeLoad(out var id)); Assert.AreEqual("a", id); Assert.IsFalse(c.TryTakeLoad(out _), "one load per id");
            Run(c, 1f); Assert.IsFalse(c.AnyAudible);
            c.MarkReady("a"); Run(c, 2.2f);
            Assert.AreEqual("a", c.Track[c.IncomingDeck]); Assert.AreEqual(1f, c.Gain[c.IncomingDeck], 1e-4f);
            c.Request("b"); Run(c, 1f);
            Assert.AreEqual("a", c.Track[c.IncomingDeck], "a keeps playing while b downloads"); Assert.AreEqual(1f, c.Gain[c.IncomingDeck], 1e-4f);
        }

        [Test] public void CrossfadeIsEqualPowerAndEndsWithOneDeck()
        {
            var c = new CrossfadeChannel(); c.Request("a"); c.TryTakeLoad(out _); c.MarkReady("a"); Run(c, 2.5f);
            int deckA = c.IncomingDeck; c.Request("b"); c.TryTakeLoad(out _); c.MarkReady("b");
            float worst = 9f; bool seenBoth = false;
            for (float t = 0; t < 2.5f; t += .05f)
            {
                c.Tick(.05f); int deckB = c.IncomingDeck;
                if (deckB != deckA && c.Track[deckA] != null)
                {
                    seenBoth = true;
                    float power = CrossfadeChannel.Curve(c.Gain[deckA]) * CrossfadeChannel.Curve(c.Gain[deckA]) + CrossfadeChannel.Curve(c.Gain[deckB]) * CrossfadeChannel.Curve(c.Gain[deckB]);
                    worst = Mathf.Min(worst, power);
                    Assert.AreEqual(1f, c.Gain[deckA] + c.Gain[deckB], .06f);
                }
            }
            Assert.IsTrue(seenBoth); Assert.Greater(worst, .95f, "no loudness dip");
            int playing = 0; foreach (var t in c.Track) if (t != null) playing++;
            Assert.AreEqual(1, playing); Assert.AreEqual("b", c.Track[c.IncomingDeck]);
        }

        [Test] public void ReturningToAFadingTrackReusesItsDeck()
        {
            var c = new CrossfadeChannel(); foreach (var id in new[] { "a", "b" }) { c.Request(id); c.TryTakeLoad(out _); c.MarkReady(id); Run(c, 2.5f); }
            c.Request("a"); Run(c, .5f); int mid = c.IncomingDeck;
            Assert.AreEqual("a", c.Track[mid]); c.Request("b"); Run(c, .3f); c.Request("a"); Run(c, 2.5f);
            Assert.AreEqual("a", c.Track[c.IncomingDeck]); int playing = 0; foreach (var t in c.Track) if (t != null) playing++; Assert.AreEqual(1, playing);
        }

        [Test] public void FailedFileFallsBackThenSilenceNeverThrows()
        {
            var c = new CrossfadeChannel { Fallback = id => id == "music_x" ? "music_coliseum" : null };
            c.Request("music_x"); c.TryTakeLoad(out _); c.MarkFailed("music_x");
            Assert.AreEqual("music_coliseum", c.Target()); Assert.IsTrue(c.TryTakeLoad(out var fb)); Assert.AreEqual("music_coliseum", fb);
            c.MarkReady("music_coliseum"); Run(c, 2.5f); Assert.AreEqual("music_coliseum", c.Track[c.IncomingDeck]);
            var d = new CrossfadeChannel(); d.Request("amb_x"); d.TryTakeLoad(out _); d.MarkFailed("amb_x");
            Assert.IsNull(d.Target()); Assert.DoesNotThrow(() => Run(d, 1f)); Assert.IsFalse(d.AnyAudible);
        }

        [Test] public void NullRequestFadesOutAndEvictionRespectsPlayingDecks()
        {
            var c = new CrossfadeChannel(); c.Request("a"); c.TryTakeLoad(out _); c.MarkReady("a"); Run(c, 2.5f);
            Assert.IsFalse(c.Evict("a"), "cannot evict a playing track");
            c.Request(null); Run(c, 2.5f); Assert.IsFalse(c.AnyAudible); Assert.AreEqual(-1, c.IncomingDeck);
            Assert.IsTrue(c.Evict("a")); Assert.AreEqual(CrossfadeChannel.Status.Unknown, c.StatusOf("a"));
        }

        [Test] public void TickDoesNotAllocate()
        {
            var c = new CrossfadeChannel(); c.Request("a"); c.TryTakeLoad(out _); c.MarkReady("a"); c.Tick(.1f);
            long before = System.GC.GetAllocatedBytesForCurrentThread();
            for (int i = 0; i < 100; i++) c.Tick(.02f);
            Assert.AreEqual(0, System.GC.GetAllocatedBytesForCurrentThread() - before);
        }

        // ---- culling: accent lights and shadow chunks -------------------------------------------------------------------------
        static byte[] ClusterTerrain(int w, int h, params int[][] blobs)
        {
            var t = new byte[w * h];
            foreach (var b in blobs) for (int y = b[1]; y < b[1] + 4; y++) for (int x = b[0]; x < b[0] + 4; x++) t[y * w + x] = (byte)b[2];
            return t;
        }

        [Test] public void AccentLightsAreCulledToTheCameraAndCapped()
        {
            var pl = new AccentLightPlanner();
            var blobs = new System.Collections.Generic.List<int[]>();
            for (int i = 0; i < 12; i++) blobs.Add(new[] { 4 + (i % 4) * 36, 4 + (i / 4) * 36, (int)TerrainKind.Lava });   // 12 lava clusters over a 160 map
            pl.Build(ClusterTerrain(160, 160, blobs.ToArray()), 160, 160); Assert.AreEqual(12, pl.Count);
            var pick = new int[AtmosphereQuality.HardMaxLights];
            // a camera at (6,6) sees one cluster; every selected cluster is inside rect + margin
            int n = pl.Select(0, 0, 24, 18, AccentLights.CullMargin, 4, pick); Assert.AreEqual(1, n);
            foreach (int i in new[] { pick[0] }) { var c = pl.Clusters[i]; Assert.LessOrEqual(c.X, 24 + AccentLights.CullMargin); Assert.LessOrEqual(c.Y, 18 + AccentLights.CullMargin); }
            // a camera on the map centre sees more clusters than the cap allows: the cap applies after culling and never exceeds the pool
            n = pl.Select(60, 60, 84, 78, AccentLights.CullMargin, 2, pick); Assert.LessOrEqual(n, 2);
            int all = pl.Select(0, 0, 160, 160, 0, 99, pick); Assert.AreEqual(AtmosphereQuality.HardMaxLights, all, "never above the pool size");
            Assert.AreEqual(0, pl.Select(0, 0, 24, 18, 0, 0, pick), "cap 0 lights nothing");
            // off-screen clusters are never selected
            n = pl.Select(60, 60, 84, 78, AccentLights.CullMargin, 6, pick);
            for (int i = 0; i < n; i++) { var c = pl.Clusters[pick[i]]; Assert.That(c.X, Is.InRange(60 - AccentLights.CullMargin, 84 + AccentLights.CullMargin)); Assert.That(c.Y, Is.InRange(60 - AccentLights.CullMargin, 78 + AccentLights.CullMargin)); }
        }

        [Test] public void NearestClusterWinsTheCap()
        {
            var pl = new AccentLightPlanner(); var w = 80;
            pl.Build(ClusterTerrain(w, w, new[] { 10, 10, (int)TerrainKind.Lava }, new[] { 40, 40, (int)TerrainKind.Lava }, new[] { 70, 70, (int)TerrainKind.Lava }), w, w);
            var pick = new int[4]; int n = pl.Select(30, 30, 54, 48, 40f, 1, pick); Assert.AreEqual(1, n);
            Assert.AreEqual(41.5f, pl.Clusters[pick[0]].X, 1f);
        }

        static MapBlob ShadowMap()
        {
            const int w = 160; var tiles = new byte[w * w]; var regions = new byte[w * w]; var terrain = new byte[w * w];
            for (int i = 0; i < regions.Length; i++) regions[i] = (byte)RegionId.Frost;
            for (int y = 0; y < w; y++) for (int x = 0; x < w; x++) if (x == 0 || y == 0 || x == w - 1 || y == w - 1 || (x % 9 == 0 && y % 7 < 4)) tiles[y * w + x] = MapBlob.Wall;
            return new MapBlob(w, w, tiles, terrain, regions, MapBlob.GroundTerrainMap);
        }

        [Test] public void ShadowChunksAreBoundedByTheCameraNotTheMap()
        {
            var map = ShadowMap(); var field = new RegionField(); field.Build(map.Regions, map.W, map.H);
            var sm = new RegionShadowMap(map, field);
            try
            {
                Assert.Greater(sm.CasterCount, 50); Assert.AreEqual(25, sm.ChunksX * sm.ChunksY);
                sm.UpdateVisible(10, 10, 36, 29, 4);                    // a typical 26 x 19 tile view with a margin
                Assert.LessOrEqual(sm.VisibleChunks, 4); Assert.LessOrEqual(sm.BakedChunks, 4);
                sm.UpdateVisible(10, 10, 36, 29, 4); Assert.LessOrEqual(sm.BakedChunks, 4, "a second call bakes nothing new");
                sm.UpdateVisible(70, 70, 96, 89, 4); Assert.LessOrEqual(sm.VisibleChunks, 9); Assert.Less(sm.BakedChunks, 25, "never the whole map");
                sm.UpdateVisible(-200, -200, -190, -190, 4); Assert.AreEqual(0, sm.VisibleChunks, "a camera outside the map touches no chunk");
            }
            finally { sm.Dispose(); }
        }

        [Test] public void ShadowsFallAlongTheSunAndDarkenOnlyWhereThereIsSun()
        {
            var cover = new float[64 * 64];
            RegionShadowMap.Sweep(cover, 64, 64, 0, 0, 4, 4, 5, 5, RegionShadowMap.TileOffset(.85f, 1f), 1f);
            int Idx(float tx, float ty) { return (int)(ty * RegionShadowMap.TexelsPerTile) * 64 + (int)(tx * RegionShadowMap.TexelsPerTile); }
            Assert.Greater(cover[Idx(4.5f, 4.5f)], .5f, "inside the footprint");
            Assert.Greater(cover[Idx(5.4f, 5.2f)], .3f, "lands down and to the right of a wall from the upper left");
            Assert.AreEqual(0f, cover[Idx(3.2f, 3.2f)], "nothing on the sun side");
            Assert.Greater(AtmosphereShadows.BlobLength(.95f, 1.3f), AtmosphereShadows.BlobLength(.24f, .5f));
            Assert.AreEqual(AtmosphereShadows.BlobLength(0f, 1f), AtmosphereShadows.BlobLength(.07f, 0f), 1e-4f, "no sun, contact shadow only");
        }
    }
}

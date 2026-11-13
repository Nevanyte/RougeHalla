using NUnit.Framework;
using Roguehalla.Net.Ui;
using TMPro;
using UnityEngine;

namespace Roguehalla.Client.Tests
{
    /// <summary>
    /// P-UNITY-NAME-LEGIBLE-1 review notes. The presenter's floor luminance table (SpriteActorPresenter.FloorLuminance) is hard-coded from the oracle's
    /// measurement; these keep it in step with the baked ground texels (through NameLegibleFloors, read-only), make every SurfaceKind explicit, and check
    /// that a faded pack name keeps its fade on the frame its colours flip.
    /// </summary>
    public sealed class NameLegibleTableEditModeTests
    {
        /// <summary>Absolute luminance tolerance between the table and the texel average. The palette switches at .18 / .22 and the nearest measured floor to it (limestone, .29) is .07 above.</summary>
        const double Tolerance = .02;

        static SurfaceKind[] Measured => NameLegibleFloors.Kinds;

        [Test]
        public void ThePresentersFloorTableMatchesTheTexelAverageOfEveryMeasuredSurface([ValueSource(nameof(Measured))] SurfaceKind kind)
        {
            double measured = NameLegibleFloors.Luminance(NameLegibleFloors.Of(kind).Avg);
            Assert.That(SpriteActorPresenter.FloorLuminance(kind), Is.EqualTo(measured).Within(Tolerance), kind + ": the table is stale against the ground texels");
        }

        [Test]
        public void EverySurfaceKindHasAnExplicitEntry([Values] SurfaceKind kind)
        {
            Assert.DoesNotThrow(() => SpriteActorPresenter.FloorLuminance(kind), kind + " has no entry in the floor table");
        }

        [Test]
        public void TheUnmeasuredKindsAreTheDocumentedDecisions()
        {
            foreach (var kind in new[] { SurfaceKind.Ember, SurfaceKind.Lava, SurfaceKind.Bog, SurfaceKind.ShallowWater, SurfaceKind.None })
                Assert.That(SpriteActorPresenter.FloorLuminance(kind), Is.LessThan((float)NamePalette.SwitchToDark), kind + " counts as dark ground");
            Assert.That(SpriteActorPresenter.FloorLuminance(SurfaceKind.Grass), Is.EqualTo(SpriteActorPresenter.FloorLuminance(SurfaceKind.Mud)), "grass patches are part of the Plague sample");
        }

        [Test]
        public void AFadedNameKeepsItsFadeWhenItsColoursFlipAtAZoneEdge()
        {
            ShowcaseSprites.Initialize();
            var go = new GameObject("faded pack name");
            try
            {
                var ind = new OverheadIndicators(go.transform);
                var name = go.transform.Find("Name").GetComponent<TextMeshPro>();
                var f = new OverheadIndicators.Facts { Order = 2000, HeadY = 1.68f, BarY = 1.8f, HpPct = 100f, Mob = true, Name = "Frost Wisp" };
                ind.Update(f);
                ind.NameFullAlpha(.4f);   // the pack's most visible member is faint
                Assert.That(name.color.a, Is.EqualTo(.4f).Within(.01f), "set-up");
                float onDark = name.color.r;
                ind.SetNameGround(.5f);   // snow: the colours flip to the dark face
                Assert.That(name.color.r, Is.LessThan(onDark), "the face turned dark");
                Assert.That(name.color.a, Is.EqualTo(.4f).Within(.01f), "and kept the fade");
                ind.SetNameGround(.02f);  // back onto basalt
                Assert.That(name.color.r, Is.EqualTo(onDark).Within(.01f));
                Assert.That(name.color.a, Is.EqualTo(.4f).Within(.01f), "and kept it flipping back");
            }
            finally { Object.DestroyImmediate(go); }
        }
    }
}

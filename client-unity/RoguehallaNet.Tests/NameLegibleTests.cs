using System.Collections.Generic;
using NUnit.Framework;
using Roguehalla.Net.Ui;

namespace Roguehalla.Net.Tests
{
    /// <summary>
    /// P-UNITY-NAME-LEGIBLE-1: the rule that turns the ground under a name into the name's colours (<see cref="NamePalette"/>).
    /// The three earlier name packets checked a flat theme colour and accepted "face OR outline contrasts with the floor"; here the FACE colour itself must
    /// contrast with the floor at least 4.5:1 (against the average and against the extreme decile on the face's side) and the outline with the face at least 3:1.
    /// The floors are the measurement of NameLegibleEditModeTests (client-unity/UnityProject/Assets/Tests/Editor/NameLegibleFloors.cs): the ground the client draws,
    /// sampled from the baked ground texels through the shader's formula, as sRGB 0xRRGGBB. The EditMode test FloorTableMatchesTheMeasurement fails if these drift.
    /// </summary>
    public sealed class NameLegibleTests
    {
        /// <summary>name, average, darkest decile, brightest decile (sRGB). Region floors are the baked texels through the ground shader scaled by the drawn-light ratio measured on the screenshots (NameLegibleFloors.DrawnLight). NOT modelled: local lights (lit pools), fog, Plague water, garden pockets, lava glow.</summary>
        public static readonly (string Name, uint Avg, uint Dark, uint Bright)[] Floors =
        {
            ("Basalt", 0x46251C, 0x2B140D, 0x64372C),
            ("Flagstone", 0x272223, 0x0E0D12, 0x433937),
            ("Mud", 0x394C23, 0x303423, 0x43681D),
            ("Snow", 0xA1BED0, 0x8CB1C6, 0xB8CBD7),
            ("Sand", 0xCC9F55, 0xAB7A29, 0xEEC378),
            ("Limestone", 0x9C9183, 0x645C54, 0xB9AD9B),
            ("Ice", 0xA6CAE3, 0x3296C9, 0xDFF0FA),
            ("HolyLight", 0xAC8B4B, 0x765417, 0xD2AE65),
            ("TempleFloor", 0xBEAA86, 0xB8A47E, 0xC2B08F),
        };

        static IEnumerable<TestCaseData> KindsOnFloors()
        {
            foreach (var kind in new[] { NameKind.Mob, NameKind.Elite, NameKind.Fighter, NameKind.Local })
                foreach (var floor in Floors)
                    yield return new TestCaseData(kind, floor.Name, floor.Avg, floor.Dark, floor.Bright).SetName("A_" + kind + "_face_reads_on_" + floor.Name);
        }

        static NameColours Chosen(NameKind kind, uint avg)
        {
            bool pale = NamePalette.IsPale(NamePalette.Luminance(avg), false);
            return NamePalette.Colours(kind, pale);
        }

        // ---- the colours follow the floor ----

        [TestCaseSource(nameof(KindsOnFloors))]
        public void TheFaceReadsOnTheFloorAndTheOutlineOnTheFace(NameKind kind, string floor, uint avg, uint dark, uint bright)
        {
            var c = Chosen(kind, avg);
            bool light = NamePalette.Luminance(c.Face) >= NamePalette.Luminance(avg);
            string at = kind + " over " + floor + ": face #" + c.Face.ToString("X6") + ", outline #" + c.Outline.ToString("X6") + ", floor avg #" + avg.ToString("X6");
            Assert.That(NamePalette.Contrast(c.Face, avg), Is.GreaterThanOrEqualTo(4.5), at + ": face against the average floor");
            if (light) Assert.That(NamePalette.Contrast(c.Face, bright), Is.GreaterThanOrEqualTo(4.5), at + ": face against the brightest decile");
            else Assert.That(NamePalette.Contrast(c.Face, dark), Is.GreaterThanOrEqualTo(2.0), at + ": face against the darkest decile");
            Assert.That(NamePalette.Contrast(c.Face, c.Outline), Is.GreaterThanOrEqualTo(3.0), at + ": outline against the face");
        }

        [Test]
        public void PaleGroundTakesADarkFaceWithALightOutlineAndDarkGroundTheOpposite([Values] NameKind kind)
        {
            var pale = NamePalette.Colours(kind, true); var dark = NamePalette.Colours(kind, false);
            Assert.That(NamePalette.Luminance(pale.Face), Is.LessThan(NamePalette.Luminance(pale.Outline)), kind + " over pale ground: dark face #" + pale.Face.ToString("X6") + ", light outline #" + pale.Outline.ToString("X6"));
            Assert.That(NamePalette.Luminance(dark.Face), Is.GreaterThan(NamePalette.Luminance(dark.Outline)), kind + " over dark ground: light face #" + dark.Face.ToString("X6") + ", dark outline #" + dark.Outline.ToString("X6"));
            Assert.That(NamePalette.Contrast(pale.Face, pale.Outline), Is.GreaterThanOrEqualTo(3.0), "pale: outline against face");
            Assert.That(NamePalette.Contrast(dark.Face, dark.Outline), Is.GreaterThanOrEqualTo(3.0), "dark: outline against face");
        }

        [Test]
        public void TheGroundsThatAreObviouslyPaleOrDarkAreTold()
        {
            foreach (var name in new[] { "Snow", "Ice", "Limestone" })
            {
                var f = System.Array.Find(Floors, x => x.Name == name);
                Assert.That(NamePalette.IsPale(NamePalette.Luminance(f.Avg), false), Is.True, name + " is pale ground");
            }
            foreach (var name in new[] { "Basalt", "Flagstone", "Mud" })
            {
                var f = System.Array.Find(Floors, x => x.Name == name);
                Assert.That(NamePalette.IsPale(NamePalette.Luminance(f.Avg), true), Is.False, name + " is dark ground, whatever it was a frame ago");
            }
        }

        [Test]
        public void AnEliteKeepsItsGoldOnDarkGroundAndTakesADarkGoldBrownOnPale()
        {
            Assert.That(NamePalette.Colours(NameKind.Elite, false).Face, Is.EqualTo(0xF4D576u), "the gold of today");
            var pale = NamePalette.Colours(NameKind.Elite, true).Face;
            uint r = (pale >> 16) & 255, b = pale & 255;
            Assert.That(r, Is.GreaterThan(b), "gold-brown, not grey: #" + pale.ToString("X6"));
            Assert.That(NamePalette.Luminance(pale), Is.LessThan(.25), "dark");
        }

        [Test]
        public void TheLocalFightersNameIsGreenOnBothGroundsAndDiffersFromOtherFighters()
        {
            foreach (bool pale in new[] { false, true })
            {
                var c = NamePalette.Colours(NameKind.Local, pale).Face;
                uint r = (c >> 16) & 255, g = (c >> 8) & 255, b = c & 255;
                Assert.That(g, Is.GreaterThan(r).And.GreaterThan(b), "own-name green (pale " + pale + "): #" + c.ToString("X6"));
                Assert.That(c, Is.Not.EqualTo(NamePalette.Colours(NameKind.Fighter, pale).Face), "a fighter's name is not the local green");
            }
        }

        // ---- hysteresis ----

        [Test]
        public void TheSwitchToPaleHasHysteresisAndSwitchesOncePerSweep()
        {
            bool state = false; double up = -1;
            for (double l = 0; l <= 1.0001; l += .002)
            {
                bool next = NamePalette.IsPale(l, state);
                if (next && !state) { Assert.That(up, Is.LessThan(0), "switches to pale only once on the way up"); up = l; }
                if (!next && state) Assert.Fail("flips back to dark while the ground is still getting paler at " + l);
                state = next;
            }
            Assert.That(up, Is.GreaterThan(0), "a white floor is pale");
            double down = -1;
            for (double l = 1.0; l >= -.0001; l -= .002)
            {
                bool next = NamePalette.IsPale(l, state);
                if (!next && state) { Assert.That(down, Is.LessThan(0), "switches to dark only once on the way down"); down = l; }
                if (next && !state) Assert.Fail("flips back to pale while the ground is still getting darker at " + l);
                state = next;
            }
            Assert.That(down, Is.GreaterThanOrEqualTo(0), "a black floor is dark");
            Assert.That(up - down, Is.GreaterThanOrEqualTo(.02), "up at " + up + ", down at " + down + ": a band of at least .02");
            Assert.That(up, Is.InRange(.1, .6), "the switch sits in the middle of the range, not at an end");
        }

        [Test]
        public void AFloorWobblingAcrossTheThresholdDoesNotFlicker()
        {
            double up = -1; bool s = false;
            for (double l = 0; l <= 1.0001 && up < 0; l += .002) { s = NamePalette.IsPale(l, false); if (s) up = l; }
            Assert.That(up, Is.GreaterThan(0), "set-up: a switch point exists");
            bool state = false; int flips = 0;
            for (int i = 0; i < 40; i++)
            {
                double l = up + (i % 2 == 0 ? .01 : -.01);
                bool next = NamePalette.IsPale(l, state);
                if (next != state) flips++;
                state = next;
            }
            Assert.That(flips, Is.LessThanOrEqualTo(1), "a pack walking along a border changes colour at most once");
        }

        // ---- the contrast helper (an implemented helper; these pass on the stub and guard it) ----

        [Test]
        public void ContrastIsWcagTwoPointZero()
        {
            Assert.That(NamePalette.Contrast(0x000000, 0xFFFFFF), Is.EqualTo(21.0).Within(1e-6));
            Assert.That(NamePalette.Contrast(0xFFFFFF, 0x000000), Is.EqualTo(21.0).Within(1e-6));
            Assert.That(NamePalette.Contrast(0x808080, 0x808080), Is.EqualTo(1.0).Within(1e-9));
            Assert.That(NamePalette.Contrast(0x777777, 0xFFFFFF), Is.EqualTo(4.478).Within(.01), "the textbook #777 on white");
            Assert.That(NamePalette.Luminance(0xFF0000), Is.EqualTo(.2126).Within(1e-4));
        }
    }
}

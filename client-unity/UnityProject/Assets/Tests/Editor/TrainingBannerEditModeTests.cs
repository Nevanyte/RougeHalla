using System;
using System.Collections.Generic;
using System.Linq;
using System.Reflection;
using System.Threading.Tasks;
using NUnit.Framework;
using TMPro;
using UnityEngine;

namespace Roguehalla.Client.Tests
{
    /// <summary>
    /// P-UNITY-TRAINING-BANNER-1. Legacy's training room shows, in the first line of the HUD plate where the arena shows its run line, the
    /// banner <c>TRAINING_BANNER</c> (packages/client/src/ui/hud.ts:21, chosen by statusLine at :42), and it has no kills line and no GV line
    /// in that area. Unity's practice plate shows "PRACTICE · No run rewards or banking" (MatchHud.cs:261), then the vitals line, then the
    /// combat-stats line "Kills N · GV N · Alive" (MatchHud.cs:322); a practice mob kill never moves either number, so they read 0 all session.
    /// The real MatchClient and MatchHud are driven through <see cref="TrainingHudRig"/> (P-UNITY-TRAINING-HUD-1). Fit is asserted the way
    /// HudTextScaleEditModeTests asserts it (widest line at most 88 percent of the box, text height inside the box, largest size the label can take).
    /// Labels are found by what the player sees (active labels under the HUD), except the plate panel (<c>_vitalsPanel</c>).
    /// </summary>
    public sealed class TrainingBannerEditModeTests
    {
        // packages/client/src/ui/hud.ts:21, byte for byte (the dash is U+2014).
        const string LegacyBanner = "TRAINING — nothing here is recorded: no GV, no stats";
        const float WidthShare = .88f;

        static readonly Vector2[] Windows = { new Vector2(1280, 720), new Vector2(1920, 1080), new Vector2(1024, 768) };
        static readonly float[] Scales = { 1f, 1.5f };

        public static IEnumerable<TestCaseData> FitMatrix()
        {
            foreach (var window in Windows)
                foreach (float scale in Scales)
                    yield return new TestCaseData(scale, window);
        }

        static List<TMP_Text> ActiveLabels(TrainingHudRig rig) =>
            rig.Hud.GetComponentsInChildren<TMP_Text>(false).Where(t => t != null && t.gameObject.activeInHierarchy).ToList();

        static string Dump(IEnumerable<TMP_Text> labels) =>
            string.Join(" | ", labels.Where(t => !string.IsNullOrEmpty(t.text)).Select(t => t.name + "='" + t.text.Replace("\n", "/") + "'"));

        static void Settle(TrainingHudRig rig) { for (int i = 0; i < 4; i++) rig.Frame(); }

        [Test]
        public async Task InPracticeTheFirstPlateLineIsLegacysTrainingBanner()
        {
            using (var rig = await TrainingHudRig.Start(practice: true))
            {
                Settle(rig);
                var plate = (RectTransform)TrainingHudRig.GetField(rig.Hud, "_vitalsPanel");
                Assert.That(plate.gameObject.activeInHierarchy, Is.True, "set-up: the plate is shown in practice");
                var inPlate = plate.GetComponentsInChildren<TMP_Text>(false).Where(t => t.gameObject.activeInHierarchy).ToList();
                Assert.That(inPlate.Select(t => t.text), Does.Contain(LegacyBanner),
                    "the practice plate carries legacy's banner (hud.ts:21); plate labels: " + Dump(inPlate));
                // It is the first (topmost) line, as legacy's hud-status is the first line of the HUD block.
                var withText = inPlate.Where(t => !string.IsNullOrEmpty(t.text)).ToList();
                var top = withText.OrderByDescending(t => t.rectTransform.TransformPoint(t.rectTransform.rect.center).y).First();
                Assert.That(top.text, Is.EqualTo(LegacyBanner), "the banner is the topmost plate line; plate labels: " + Dump(withText));
            }
        }

        [Test]
        public async Task InPracticeNoActiveLabelShowsKillsOrGv()
        {
            using (var rig = await TrainingHudRig.Start(practice: true))
            {
                Settle(rig);
                // The banner itself says "no GV"; every other shown label must carry neither word.
                var offenders = ActiveLabels(rig).Where(t => t.text != null && t.text != LegacyBanner &&
                    (t.text.Contains("Kills") || t.text.Contains("GV"))).ToList();
                Assert.That(offenders, Is.Empty,
                    "legacy's training HUD has no kills or GV line (hud.ts:42); Unity shows: " + Dump(offenders));
            }
        }

        [Test]
        public async Task InTheArenaTheKillsAndGvLineAndTheRunStatusAreShownAsToday()
        {
            using (var rig = await TrainingHudRig.Start(practice: false))
            {
                Settle(rig);
                // The arena shows the line while the plate is not in its active mode (lobby, planning, ended: MatchHud.Legacy.cs:239-246);
                // the rig's snapshots are Active, so put the plate in that mode the way RefreshLegacyHud does and read what it shows.
                TrainingHudRig.Call(rig.Hud, "SetPlateMode", false);
                var stats = (TMP_Text)TrainingHudRig.GetField(rig.Hud, "_combatStats");
                Assert.That(stats.gameObject.activeInHierarchy, Is.True, "the arena's kills / GV line is shown");
                Assert.That(stats.text, Does.StartWith("Kills ").And.Contain(" · GV "), "the arena's line reads 'Kills N · GV N · status'");
                var status = (TMP_Text)TrainingHudRig.GetField(rig.Hud, "_plateStatus");
                Assert.That(status.text, Is.Not.EqualTo(LegacyBanner), "the arena never shows the training banner");
                Assert.That(ActiveLabels(rig).Select(t => t.text), Has.None.EqualTo(LegacyBanner), "no label in the arena shows the training banner");
            }
        }

        [TestCaseSource(nameof(FitMatrix))]
        public async Task InPracticeTheBannerFitsItsBoxAtEveryWindowAndTextScale(float scale, Vector2 window)
        {
            using (var rig = await TrainingHudRig.Start(practice: true))
            {
                var hud = rig.Hud;
                var settings = (ShowcaseSettings)TrainingHudRig.GetField(hud, "_showcaseSettings");
                var scaleField = typeof(ShowcaseSettings).GetField("_textScale", BindingFlags.Instance | BindingFlags.NonPublic);
                float saved = (float)scaleField.GetValue(settings);
                try
                {
                    ((HudStage)TrainingHudRig.GetField(hud, "_stageScaler")).Apply(window.x, window.y, HudLayout.CanvasScalerFactor(window.x, window.y));
                    scaleField.SetValue(settings, scale);
                    TrainingHudRig.Call(hud, "ApplyTextScale");
                    Settle(rig);
                    var banners = ActiveLabels(rig).Where(t => t.text == LegacyBanner).ToList();
                    Assert.That(banners, Is.Not.Empty, "the practice HUD shows the banner (otherwise there is nothing to fit); labels: " + Dump(ActiveLabels(rig)));
                    var problems = new List<string>();
                    foreach (var label in banners)
                    {
                        var follow = label.GetComponent<MythicTextScale>();
                        if (follow == null) { problems.Add(label.name + " has no MythicTextScale: it ignores the setting"); continue; }
                        if (label.overflowMode == TextOverflowModes.Ellipsis || label.overflowMode == TextOverflowModes.Truncate)
                            problems.Add(label.name + " would cut the banner (overflow " + label.overflowMode + ")");
                        float largest = label.enableAutoSizing ? label.fontSizeMax : label.fontSize;
                        var box = label.rectTransform.rect;
                        var need = Needs(label, LegacyBanner, largest);
                        if (need.x > box.width * WidthShare + .001f || need.y > box.height + .01f)
                            problems.Add(label.name + " CLIPS the banner at size " + largest.ToString("0.##") + ": needs " + need.x.ToString("0.#") + "x" +
                                need.y.ToString("0.#") + " of " + box.width.ToString("0.#") + "x" + box.height.ToString("0.#"));
                    }
                    Assert.That(problems, Is.Empty, "at " + window.x + "x" + window.y + ", text scale " + scale + ": " + string.Join("; ", problems));
                }
                finally
                {
                    scaleField.SetValue(settings, saved);
                    TrainingHudRig.Call(hud, "ApplyTextScale");
                }
            }
        }

        static Vector2 Needs(TMP_Text label, string text, float size)
        {
            bool auto = label.enableAutoSizing; float keep = label.fontSize;
            label.enableAutoSizing = false; label.fontSize = size;
            bool wraps = label.textWrappingMode != TextWrappingModes.NoWrap;
            var need = label.GetPreferredValues(text, wraps ? label.rectTransform.rect.width : 0f, 0f);
            label.fontSize = keep; label.enableAutoSizing = auto;
            return need;
        }
    }
}

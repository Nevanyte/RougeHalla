using NUnit.Framework;
using UnityEngine;

namespace Roguehalla.Client.Tests
{
    /// <summary>Pure legacy viewport maths (docs/rework/LEGACY_LAYOUT.md section 0.1 and 3); no scene objects needed.</summary>
    public sealed class HudLayoutMathEditModeTests
    {
        [TestCase(1280, 800, 1f, 1280f, 800f)]
        [TestCase(1366, 768, .96f, 1423f, 800f)]
        [TestCase(1920, 1080, 1.35f, 1422f, 800f)]
        [TestCase(2560, 1440, 1.5f, 1707f, 960f)]     // 1.8 clamps to 1.5
        [TestCase(3440, 1440, 1.5f, 2240f, 960f)]     // stage clamps to 21:9 (3360 wide)
        [TestCase(640, 400, .8f, 800f, 500f)]         // 0.5 clamps up to 0.8
        public void ViewportMatchesTheLegacyWorkedTable(int w, int h, float scale, float uiW, float uiH)
        {
            var v = HudLayout.Viewport(w, h);
            Assert.That(v.Scale, Is.EqualTo(scale).Within(.005f));
            Assert.That(v.UiWidth, Is.EqualTo(uiW).Within(1f));
            Assert.That(v.UiHeight, Is.EqualTo(uiH).Within(1f));
        }

        [Test]
        public void UltrawideWindowsAreClampedToTwentyOneByNine()
        {
            var v = HudLayout.Viewport(5120, 1440);
            Assert.That(v.StageWidth, Is.EqualTo(Mathf.Floor(1440 * 21f / 9f)));
            Assert.That(v.StageHeight, Is.EqualTo(1440f));
        }

        [Test]
        public void ShortAndNarrowFlagsFollowTheLaidOutSize()
        {
            Assert.That(HudLayout.Viewport(1280, 800).Short, Is.False);
            Assert.That(HudLayout.Viewport(1280, 600).Short, Is.True, "uiH 750 < 760");
            Assert.That(HudLayout.Viewport(1280, 800).Narrow, Is.False);
            Assert.That(HudLayout.Viewport(400, 800).Narrow, Is.True);
        }

        [Test]
        public void CanvasScalerFactorMatchesTheDocumentedUnityValues()
        {
            Assert.That(HudLayout.CanvasScalerFactor(1920, 1080), Is.EqualTo(1f).Within(.001f));
            Assert.That(HudLayout.CanvasScalerFactor(1280, 800), Is.EqualTo(.703f).Within(.002f));
            Assert.That(HudLayout.CanvasScalerFactor(2560, 1440), Is.EqualTo(1.333f).Within(.002f));
        }

        [TestCase(1280f, 800f, 1f, 270f)]
        [TestCase(1422f, 800f, 1f, 270f)]
        [TestCase(1707f, 960f, 1f, 312f)]
        [TestCase(1280f, 800f, 1.25f, 338f)]
        [TestCase(1280f, 800f, .75f, 203f)]
        [TestCase(400f, 800f, 1f, 110f)]   // narrow overlay: floor of 110, never wider than the bar clearance allows
        public void MinimapSizeFollowsTheLegacyFormula(float uiW, float uiH, float userScale, float expected)
        {
            Assert.That(HudLayout.MinimapSize(uiW, uiH, userScale), Is.EqualTo(expected).Within(1f));
        }

        [Test]
        public void StageIsExactlyTheLaidOutSizeAndOneUnitIsOneLegacyPixelOnScreen()
        {
            var root = new GameObject("stage test", typeof(RectTransform));
            try
            {
                var stageObject = new GameObject("Stage", typeof(RectTransform), typeof(HudStage));
                stageObject.transform.SetParent(root.transform, false);
                var stage = stageObject.GetComponent<HudStage>();
                foreach (var size in new[] { new Vector2(1280, 800), new Vector2(1920, 1080), new Vector2(2560, 1440), new Vector2(3440, 1440) })
                {
                    float f = HudLayout.CanvasScalerFactor(size.x, size.y);
                    stage.Apply(size.x, size.y, f);
                    var rect = (RectTransform)stageObject.transform;
                    var v = HudLayout.Viewport(size.x, size.y);
                    Assert.That(rect.sizeDelta.x, Is.EqualTo(v.UiWidth).Within(.01f));
                    Assert.That(rect.sizeDelta.y, Is.EqualTo(v.UiHeight).Within(.01f));
                    Assert.That(rect.localScale.x * f, Is.EqualTo(v.Scale).Within(.0001f), "screen px per HUD unit is the legacy overlay scale at " + size);
                    Assert.That(rect.sizeDelta.x * rect.localScale.x * f, Is.EqualTo(v.StageWidth).Within(.1f), "stage covers its screen width");
                }
            }
            finally { Object.DestroyImmediate(root); }
        }
    }
}

using NUnit.Framework;
using UnityEngine;
using UnityEngine.UI;

namespace Roguehalla.Client.Tests
{
    /// <summary>The hub account panels share one dock (right of the launch panel, under the wordmark) at the three target resolutions, and their pages render.</summary>
    public sealed class HubPanelLayoutEditModeTests
    {
        static readonly Vector3[] Sizes = { new Vector3(1280, 800, 1f), new Vector3(1920, 1080, 1.35f), new Vector3(2560, 1440, 1.5f) };

        [Test]
        public void The_cosmetics_panel_and_the_guide_dock_the_same_way_at_every_resolution()
        {
            var root = new GameObject("dock root", typeof(RectTransform), typeof(Canvas));
            try
            {
                var cosmetics = new GameObject("c").AddComponent<HubCosmeticsView>(); cosmetics.transform.SetParent(root.transform, false);
                cosmetics.Initialize(root.transform, null);
                var guide = new GameObject("g").AddComponent<HubGuideView>(); guide.transform.SetParent(root.transform, false);
                guide.Initialize((RectTransform)root.transform, _ => { });
                var cosmeticsPanel = (RectTransform)root.transform.Find("HubCosmeticsPanel");
                var guidePanel = (RectTransform)root.transform.Find("HubGuideOverlay/HubGuidePanel");
                Assert.IsNotNull(cosmeticsPanel); Assert.IsNotNull(guidePanel);
                foreach (var s in Sizes)
                {
                    var vp = new HudViewport(s.z, s.x, s.y);
                    cosmetics.ApplyViewport(vp); guide.ApplyViewport(vp);
                    Assert.AreEqual(cosmeticsPanel.anchorMin, guidePanel.anchorMin, "same dock at " + s.x);
                    Assert.AreEqual(cosmeticsPanel.anchorMax, guidePanel.anchorMax);
                    Assert.GreaterOrEqual(guidePanel.anchorMin.x * vp.UiWidth, 353.5f);
                }
            }
            finally { Object.DestroyImmediate(root); }
        }

        [Test]
        public void The_guide_scroll_clips_with_a_rect_mask_so_its_pages_are_not_hidden_by_a_transparent_stencil()
        {
            var root = new GameObject("guide root", typeof(RectTransform), typeof(Canvas));
            try
            {
                var guide = new GameObject("g").AddComponent<HubGuideView>(); guide.transform.SetParent(root.transform, false);
                guide.Initialize((RectTransform)root.transform, _ => { });
                guide.ShowTab(HubGuideView.GuideTab.Champions);
                var viewport = root.transform.Find("HubGuideOverlay/HubGuidePanel/GuideScroll/Viewport");
                Assert.IsNotNull(viewport.GetComponent<RectMask2D>());
                Assert.IsNull(viewport.GetComponent<Mask>());
                Assert.Greater(viewport.Find("Content").childCount, 3, "intro, faction row and the five champion cards");
            }
            finally { Object.DestroyImmediate(root); }
        }
    }
}

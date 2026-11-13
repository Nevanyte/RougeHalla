using System.Collections.Generic;
using System.Linq;
using System.Threading.Tasks;
using NUnit.Framework;
using UnityEngine;
using UnityEngine.UI;

namespace Roguehalla.Client.Tests
{
    /// <summary>
    /// P-UNITY-TRAINING-HUD-1, defect 2: the open training console must not cut off its last rows (shot 06: "SET CARD" and what follows).
    /// The console (TrainingConsoleView.cs:70-111) is a fixed fraction of the canvas whose scroll area is a fixed fraction of that, holding
    /// roughly 770 units of rows and showing about half of them, with no scrollbar to say there is more. A row counts as reachable when it
    /// lies inside the scroll viewport, or when the viewport scrolls vertically, shows a scrollbar, and brings the row inside at the end of
    /// its travel. The console itself must lie inside the window. The stage is sized the way the canvas scaler sizes the HUD (window / factor).
    /// </summary>
    public sealed class TrainingConsoleLayoutEditModeTests
    {
        static readonly Vector2[] Windows = { new Vector2(1280, 720), new Vector2(1920, 1080), new Vector2(1024, 768) };
        static readonly float[] Scales = { 1f, 1.5f };

        public static IEnumerable<TestCaseData> Cases()
        {
            foreach (var w in Windows) foreach (var s in Scales)
                yield return new TestCaseData(w, s).SetName("EveryConsoleRowIsReachable_" + (int)w.x + "x" + (int)w.y + "_scale" + s);
        }

        static Rect In(RectTransform rect, RectTransform space)
        {
            var c = new Vector3[4]; rect.GetWorldCorners(c);
            Vector3 min = space.InverseTransformPoint(c[0]), max = space.InverseTransformPoint(c[2]);
            return Rect.MinMaxRect(min.x, min.y, max.x, max.y);
        }

        static bool Inside(Rect inner, Rect outer) =>
            inner.xMin >= outer.xMin - .5f && inner.xMax <= outer.xMax + .5f && inner.yMin >= outer.yMin - .5f && inner.yMax <= outer.yMax + .5f;

        [TestCaseSource(nameof(Cases))]
        public async Task EveryConsoleRowIsReachable(Vector2 window, float textScale)
        {
            using (var rig = await TrainingHudRig.Start(practice: true))
            {
                var console = rig.Hud.TrainingConsole;
                Assert.That(console.SetOpen(true), Is.True, "set-up: the practice console opens");
                var canvas = console.Root.GetComponentInParent<Canvas>().transform;
                var stage = (RectTransform)new GameObject("console test stage", typeof(RectTransform)).transform;
                stage.SetParent(canvas, false);
                float factor = HudLayout.CanvasScalerFactor(window.x, window.y);
                stage.anchorMin = stage.anchorMax = stage.pivot = new Vector2(.5f, .5f);
                stage.anchoredPosition = Vector2.zero; stage.sizeDelta = new Vector2(window.x / factor, window.y / factor);
                console.Root.SetParent(stage, false);
                MythicUi.ApplyTextScale(console.Root, textScale);
                var scroll = console.Panel.GetComponentInChildren<ScrollRect>(true);
                Assert.That(scroll, Is.Not.Null, "set-up: the console has a scroll view");
                var content = scroll.content; var viewport = scroll.viewport;
                void Layout() { Canvas.ForceUpdateCanvases(); LayoutRebuilder.ForceRebuildLayoutImmediate(content); Canvas.ForceUpdateCanvases(); }
                Layout();

                var rows = new List<RectTransform>();
                foreach (RectTransform row in content) if (row.gameObject.activeSelf) rows.Add(row);
                Assert.That(rows.Count, Is.GreaterThanOrEqualTo(10), "set-up: the console's rows (" + string.Join(", ", rows.Select(r => r.name)) + ")");
                var label = $"at {window.x}x{window.y}, text scale {textScale}";

                var panel = In(console.Panel, stage);
                Assert.That(Inside(panel, stage.rect), Is.True, "the console panel lies inside the window " + label + ": " + panel + " in " + stage.rect);
                var status = (RectTransform)console.Panel.Find("Status");
                Assert.That(Inside(In(status, stage), panel), Is.True, "the status line lies inside the panel " + label);

                scroll.verticalNormalizedPosition = 1f; Layout();
                var view = In(viewport, stage);
                var hidden = rows.Where(r => !Inside(In(r, stage), view)).ToList();
                if (hidden.Count == 0) return;   // everything fits: nothing to scroll

                // Some rows sit outside the viewport: they must be scrollable and the scroll must be visible.
                var outside = string.Join(", ", hidden.Select(r => r.name));
                Assert.That(scroll.vertical, Is.True, "rows (" + outside + ") are cut off and the view does not scroll " + label);
                Assert.That(scroll.verticalScrollbar != null && scroll.verticalScrollbar.gameObject.activeInHierarchy, Is.True,
                    "rows (" + outside + ") are cut off at the panel's bottom edge with no visible scrollbar to reach them " + label +
                    " (content " + content.rect.height + " tall, viewport " + viewport.rect.height + ")");
                scroll.verticalNormalizedPosition = 0f; Layout();
                var last = rows[rows.Count - 1];
                Assert.That(Inside(In(last, stage), In(viewport, stage)), Is.True, "scrolled to the end, the last row (" + last.name + ") is inside the viewport " + label);
                scroll.verticalNormalizedPosition = 1f; Layout();
                Assert.That(Inside(In(rows[0], stage), In(viewport, stage)), Is.True, "scrolled to the top, the first row is inside the viewport " + label);
            }
        }
    }
}

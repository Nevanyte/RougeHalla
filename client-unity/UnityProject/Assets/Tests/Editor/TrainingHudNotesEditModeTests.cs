using System.Linq;
using System.Threading.Tasks;
using NUnit.Framework;
using TMPro;
using UnityEngine;
using UnityEngine.EventSystems;
using UnityEngine.UI;

namespace Roguehalla.Client.Tests
{
    /// <summary>P-UNITY-TRAINING-HUD-1 review notes: an open focused console still hides the HUD panels; the scrollbar re-wraps no label.</summary>
    public sealed class TrainingHudNotesEditModeTests
    {
        [Test]
        public async Task OpenConsoleWithFocusHidesTheFourPanelsAndClosingShowsThem()
        {
            using (var rig = await TrainingHudRig.Start(practice: true))
            {
                rig.Settle();
                var before = TrainingHudRig.Describe(rig.Panels());
                Assert.That(rig.Panels().Values, Is.All.True, "set-up: every panel is shown " + before);
                var console = rig.Hud.TrainingConsole;
                Assert.That(console.SetOpen(true), Is.True, "set-up: the console opens");
                var control = console.Panel.GetComponentsInChildren<Button>(true).First(b => b.gameObject.activeInHierarchy && b.interactable);
                EventSystem.current.SetSelectedGameObject(control.gameObject);
                rig.Frame(); rig.Frame();
                Assert.That(console.ContainsFocus, Is.True, "set-up: a console control is focused");
                Assert.That(rig.Panels().Values, Is.All.False, "open and focused: " + TrainingHudRig.Describe(rig.Panels()));
                console.SetOpen(false);
                rig.Frame(); rig.Frame();
                Assert.That(TrainingHudRig.Describe(rig.Panels()), Is.EqualTo(before), "after closing the console");
            }
        }

        [Test]
        public async Task ConsoleLabelsStayOnOneLineWithTheScrollbarAt1024x768Scale1_5()
        {
            using (var rig = await TrainingHudRig.Start(practice: true))
            {
                var console = rig.Hud.TrainingConsole;
                Assert.That(console.SetOpen(true), Is.True, "set-up: the console opens");
                var canvas = console.Root.GetComponentInParent<Canvas>().transform;
                var stage = (RectTransform)new GameObject("notes stage", typeof(RectTransform)).transform;
                stage.SetParent(canvas, false);
                float factor = HudLayout.CanvasScalerFactor(1024, 768);
                stage.anchorMin = stage.anchorMax = stage.pivot = new Vector2(.5f, .5f);
                stage.anchoredPosition = Vector2.zero; stage.sizeDelta = new Vector2(1024 / factor, 768 / factor);
                console.Root.SetParent(stage, false);
                MythicUi.ApplyTextScale(console.Root, 1.5f);
                var scroll = console.Panel.GetComponentInChildren<ScrollRect>(true);
                Assert.That(scroll.verticalScrollbar, Is.Not.Null, "set-up: the scrollbar is present");
                Canvas.ForceUpdateCanvases(); LayoutRebuilder.ForceRebuildLayoutImmediate(scroll.content); Canvas.ForceUpdateCanvases();
                // Flow texts wrap by design; every other label is a single line.
                var wrapped = scroll.content.GetComponentsInChildren<TMP_Text>(false)
                    .Where(t => t.gameObject.name != "CardDescription" && t.gameObject.name != "AuthorityNote" && !string.IsNullOrEmpty(t.text))
                    .Where(t => { t.ForceMeshUpdate(); return t.textInfo.lineCount > 1 || t.preferredWidth > t.rectTransform.rect.width + .5f; })
                    .Select(t => t.gameObject.name + " \"" + t.text + "\" (preferred " + t.preferredWidth + " in " + t.rectTransform.rect.width + ")").ToList();
                Assert.That(wrapped, Is.Empty, "labels that no longer fit on one line");
            }
        }
    }
}

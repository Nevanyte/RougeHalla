using System.Reflection;
using NUnit.Framework;
using UnityEngine;
using UnityEngine.EventSystems;
using UnityEngine.UI;

namespace Roguehalla.Client.Tests
{
    /// <summary>Checks the real settings hierarchy's row sizing and scroll reach without changing preferences.</summary>
    public sealed class ModernSettingsLayoutEditModeTests
    {
        GameObject _canvasObject;
        GameObject _viewObject;
        GameObject _sourceObject;
        ModernSettingsView _view;
        ShowcaseSettings _source;
        EventSystem _priorEventSystem;
        GameObject _priorSelection;

        [SetUp]
        public void SetUp()
        {
            // Capture focus before Initialize: its initial hidden transition can clear the current selection.
            _priorEventSystem = EventSystem.current;
            _priorSelection = _priorEventSystem != null ? _priorEventSystem.currentSelectedGameObject : null;

            _canvasObject = new GameObject("Settings layout test canvas", typeof(RectTransform), typeof(Canvas));
            var canvas = _canvasObject.GetComponent<Canvas>();
            canvas.renderMode = RenderMode.WorldSpace;
            var canvasRect = (RectTransform)_canvasObject.transform;
            canvasRect.sizeDelta = new Vector2(1920, 1080);
            canvasRect.position = Vector3.zero;
            canvasRect.localScale = Vector3.one;

            // Keep Awake inactive so ShowcaseSettings never reads or writes real PlayerPrefs.
            _sourceObject = new GameObject("Inactive settings source");
            _sourceObject.SetActive(false);
            _source = _sourceObject.AddComponent<ShowcaseSettings>();
            typeof(ShowcaseSettings).GetField("_textScale", BindingFlags.Instance | BindingFlags.NonPublic)
                .SetValue(_source, 1f);

            _viewObject = new GameObject("Settings view owner");
            _view = _viewObject.AddComponent<ModernSettingsView>();
            // UiDisplayPreferences constructor reads only its five presentation keys; no control setter is invoked.
            var preferences = new UiDisplayPreferences();
            _view.Initialize(_canvasObject.transform, _source, null, preferences, null);
            _view.SetVisible(true);
        }

        [TearDown]
        public void TearDown()
        {
            if (_viewObject != null) Object.DestroyImmediate(_viewObject);
            if (_canvasObject != null) Object.DestroyImmediate(_canvasObject);
            if (_sourceObject != null) Object.DestroyImmediate(_sourceObject);

            // Restore only the pre-existing EventSystem selection; this fixture creates no EventSystem.
            if (_priorEventSystem != null && EventSystem.current == _priorEventSystem && _priorEventSystem.isActiveAndEnabled)
            {
                var selection = _priorSelection != null && _priorSelection.activeInHierarchy ? _priorSelection : null;
                _priorEventSystem.SetSelectedGameObject(selection);
            }
            _view = null; _source = null; _viewObject = null; _canvasObject = null; _sourceObject = null;
            _priorEventSystem = null; _priorSelection = null;
        }

        [TestCase(1280f, 800f, 320f)]
        [TestCase(1707f, 960f, 320f)]
        [TestCase(300f, 800f, 276f)]   // narrow overlay: min(320, uiW - 24)
        public void CardIsAnchoredTopRightAtLegacyWidthAndCapsItsHeight(float uiW, float uiH, float width)
        {
            var card = _view.Root;
            _view.ApplyViewport(new HudViewport(1f, uiW, uiH));
            Assert.That(card.anchorMin, Is.EqualTo(new Vector2(1, 1)));
            Assert.That(card.anchorMax, Is.EqualTo(new Vector2(1, 1)));
            Assert.That(card.anchoredPosition, Is.EqualTo(new Vector2(-12, -48)), "top 48, right 12");
            Assert.That(card.sizeDelta.x, Is.EqualTo(width).Within(.01f));
            Assert.That(card.sizeDelta.y, Is.LessThanOrEqualTo(uiH - 60f + .01f), "max-height is uiH - 60");
        }

        [Test]
        public void ShortWindowScrollsTheBodyToBothEnds()
        {
            _view.ApplyViewport(new HudViewport(1f, 1280f, 400f));
            var content = (RectTransform)_canvasObject.transform.Find("ModernSettings/SettingsScroll/Viewport/SettingsContent");
            Assert.That(content, Is.Not.Null);
            var scroll = content.GetComponentInParent<UnityEngine.UI.ScrollRect>();
            Assert.That(scroll.content, Is.SameAs(content));
            Assert.That(scroll.viewport.GetComponent<UnityEngine.UI.RectMask2D>(), Is.Not.Null);
            Rebuild(content);
            Assert.That(_view.Root.sizeDelta.y, Is.EqualTo(340f).Within(.01f), "uiH 400 - 60");
            Assert.That(content.rect.height, Is.GreaterThan(scroll.viewport.rect.height), "real scrollable overflow");
            var firstRow = (RectTransform)content.GetChild(0);
            var lastRow = (RectTransform)content.GetChild(content.childCount - 1);

            scroll.verticalNormalizedPosition = 1f; Rebuild(content);
            var viewportBounds = new UnityEngine.Rect(Vector2.zero, scroll.viewport.rect.size); viewportBounds.center = scroll.viewport.rect.center;
            Assert.That(Contains(viewportBounds, BoundsIn(firstRow, scroll.viewport)), Is.True, "first section is reachable at the top");
            Assert.That(Overlaps(viewportBounds, BoundsIn(lastRow, scroll.viewport)), Is.False, "footer is clipped at the top");
            scroll.verticalNormalizedPosition = 0f; Rebuild(content);
            Assert.That(Contains(viewportBounds, BoundsIn(lastRow, scroll.viewport)), Is.True, "footer is reachable at the bottom");
        }

        [Test]
        public void CardHasTheLegacySectionsAndControls()
        {
            string all = string.Join("|", System.Array.ConvertAll(_view.Root.GetComponentsInChildren<TMPro.TMP_Text>(true), t => t.text));
            foreach (string expected in new[] { "DISPLAY", "EFFECTS", "READOUT", "MAP", "Fullscreen", "Alt+Enter does the same.", "Reduced motion",
                "Show FPS", "Show ping", "Show route", "Minimap size", "75", "100", "125", "150", "200", "Saved in this browser.", "Reset to defaults" })
                StringAssert.Contains(expected, all);
        }

        static void Rebuild(RectTransform content)
        {
            Canvas.ForceUpdateCanvases();
            LayoutRebuilder.ForceRebuildLayoutImmediate(content);
            Canvas.ForceUpdateCanvases();
            LayoutRebuilder.ForceRebuildLayoutImmediate(content);
            Canvas.ForceUpdateCanvases();
        }

        static UnityEngine.Rect BoundsIn(RectTransform element, RectTransform relativeTo)
        {
            var corners = new Vector3[4];
            element.GetWorldCorners(corners);
            Vector3 first = relativeTo.InverseTransformPoint(corners[0]);
            float xMin = first.x, xMax = first.x, yMin = first.y, yMax = first.y;
            for (int i = 1; i < corners.Length; i++)
            {
                Vector3 point = relativeTo.InverseTransformPoint(corners[i]);
                xMin = Mathf.Min(xMin, point.x); xMax = Mathf.Max(xMax, point.x);
                yMin = Mathf.Min(yMin, point.y); yMax = Mathf.Max(yMax, point.y);
            }
            return UnityEngine.Rect.MinMaxRect(xMin, yMin, xMax, yMax);
        }

        static bool Contains(UnityEngine.Rect outer, UnityEngine.Rect inner, float tolerance = .2f) =>
            inner.xMin >= outer.xMin - tolerance && inner.xMax <= outer.xMax + tolerance &&
            inner.yMin >= outer.yMin - tolerance && inner.yMax <= outer.yMax + tolerance;

        static bool Overlaps(UnityEngine.Rect a, UnityEngine.Rect b) =>
            a.xMin < b.xMax && a.xMax > b.xMin && a.yMin < b.yMax && a.yMax > b.yMin;
    }
}

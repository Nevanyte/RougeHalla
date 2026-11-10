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

        [TestCase(1f)]
        [TestCase(1.5f)]
        public void SettingsRowsUseDeclaredHeightAndReachBothScrollEnds(float requestedTextScale)
        {
            var content = (RectTransform)_canvasObject.transform.Find("ModernSettings/SettingsScroll/Viewport/SettingsContent");
            Assert.That(content, Is.Not.Null);
            var scroll = content.GetComponentInParent<UnityEngine.UI.ScrollRect>();
            Assert.That(scroll, Is.Not.Null);
            Assert.That(scroll.content, Is.SameAs(content));
            Assert.That(scroll.viewport.GetComponent<UnityEngine.UI.RectMask2D>(), Is.Not.Null);

            Rebuild(content);
            var rows = new RectTransform[content.childCount];
            for (int i = 0; i < content.childCount; i++) rows[i] = (RectTransform)content.GetChild(i);
            Assert.That(rows.Length, Is.EqualTo(12), "all settings controls belong to the scroll content");
            var textScaleSlider = rows[2].Find("Slider").GetComponent<UnityEngine.UI.Slider>();
            var textScaleCaption = rows[2].Find("Value").GetComponent<TMPro.TMP_Text>();
            float originalSourceScale = _source.TextScale;
            float originalSliderValue = textScaleSlider.value;
            string originalCaption = textScaleCaption.text;

            // Exercise user text scaling on actual TMP descendants without calling the persistent settings API.
            MythicUi.ApplyTextScale(_view.Root, requestedTextScale);
            Rebuild(content);
            var firstLabel = rows[0].Find("SettingLabel").GetComponent<TMPro.TMP_Text>();
            Assert.That(firstLabel.fontSizeMax, Is.EqualTo(24f * requestedTextScale).Within(.01f),
                "the real TMP label receives the requested scale without a font/raster assertion");

            for (int i = 0; i < rows.Length; i++)
                Assert.That(rows[i].rect.height, Is.EqualTo(72f).Within(.1f), "each row uses its declared preferred height");

            for (int i = 0; i < rows.Length - 1; i++)
            {
                var current = BoundsIn(rows[i], content);
                var next = BoundsIn(rows[i + 1], content);
                Assert.That(current.yMin - next.yMax, Is.EqualTo(8f).Within(.15f), "rows keep the configured vertical gap without overlap");
            }

            Assert.That(content.rect.height, Is.EqualTo(972f).Within(.25f), "12 rows + 11 gaps + top/bottom padding determine content extent");
            Assert.That(content.rect.height, Is.GreaterThan(scroll.viewport.rect.height), "the viewport must have real scrollable overflow");

            scroll.verticalNormalizedPosition = 1f;
            Rebuild(content);
            var viewportBounds = new UnityEngine.Rect(Vector2.zero, scroll.viewport.rect.size);
            viewportBounds.center = scroll.viewport.rect.center;
            var firstAtTop = BoundsIn(rows[0], scroll.viewport);
            var lastAtTop = BoundsIn(rows[rows.Length - 1], scroll.viewport);
            Assert.That(Contains(viewportBounds, firstAtTop), Is.True, "the first settings row is reachable at the top");
            Assert.That(Overlaps(viewportBounds, lastAtTop), Is.False, "the final row is clipped below the top viewport");

            scroll.verticalNormalizedPosition = 0f;
            Rebuild(content);
            var firstAtBottom = BoundsIn(rows[0], scroll.viewport);
            var lastAtBottom = BoundsIn(rows[rows.Length - 1], scroll.viewport);
            Assert.That(Contains(viewportBounds, lastAtBottom), Is.True, "the final settings row is reachable at the bottom");
            Assert.That(Overlaps(viewportBounds, firstAtBottom), Is.False, "the first row scrolls out above the bottom viewport");
            Assert.That(_source.TextScale, Is.EqualTo(originalSourceScale), "layout stress does not change the in-memory setting");
            Assert.That(textScaleSlider.value, Is.EqualTo(originalSliderValue), "layout and scroll do not move the slider");
            Assert.That(textScaleCaption.text, Is.EqualTo(originalCaption), "layout and scroll preserve the value caption");
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

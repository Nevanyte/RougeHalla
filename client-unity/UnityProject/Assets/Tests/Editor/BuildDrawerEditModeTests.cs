using System;
using System.Collections.Generic;
using System.IO;
using System.Reflection;
using System.Text.RegularExpressions;
using NUnit.Framework;
using Roguehalla.Client;
using Roguehalla.Net;
using TMPro;
using UnityEngine;
using UnityEngine.EventSystems;
using UnityEngine.UI;

namespace Roguehalla.Client.Tests
{
    public sealed class BuildDrawerEditModeTests
    {
        GameObject _canvasObject, _host;
        BuildDrawer _drawer;

        [SetUp]
        public void SetUp()
        {
            _canvasObject = new GameObject("Build drawer test canvas", typeof(RectTransform), typeof(Canvas), typeof(CanvasScaler), typeof(GraphicRaycaster));
            _host = new GameObject("Build drawer host");
            _drawer = _host.AddComponent<BuildDrawer>();
            _drawer.Initialize(_canvasObject.transform);
        }

        [TearDown]
        public void TearDown()
        {
            UnityEngine.Object.DestroyImmediate(_host);
            UnityEngine.Object.DestroyImmediate(_canvasObject);
        }

        [Test]
        public void DisplayCatalogExactlyMirrorsRustCardIdsTitlesDescriptionsAndTags()
        {
            string root = Path.GetFullPath(Path.Combine(Application.dataPath, "../../../"));
            string data = File.ReadAllText(Path.Combine(root, "crates/rh-sim/src/cards/catalog_data.rs"));
            string idsSource = File.ReadAllText(Path.Combine(root, "crates/rh-sim/src/cards/catalog.rs"));
            var orderedIds = Regex.Match(idsSource, @"pub const ALL:\s*\[Self;\s*80\]\s*=\s*\[(.*?)\];", RegexOptions.Singleline);
            Assert.That(orderedIds.Success, Is.True, "Rust CardId::ALL source list exists");
            var stableIds = Regex.Matches(orderedIds.Groups[1].Value, @"Self::(\w+)");
            Assert.That(stableIds.Count, Is.EqualTo(CardDisplayCatalog.Count));
            var rows = Regex.Matches(data, @"CardDef\s*\{\s*id:\s*CardId::(\w+),.*?title:\s*""((?:\\.|[^""\\])*)"",\s*text:\s*""((?:\\.|[^""\\])*)"",\s*tags:\s*&\[(.*?)\]", RegexOptions.Singleline);
            Assert.That(rows.Count, Is.EqualTo(CardDisplayCatalog.Count));
            var tagPattern = new Regex(@"MechanicTag::(\w+)");
            for (int i = 0; i < rows.Count; i++)
            {
                var row = rows[i]; var display = CardDisplayCatalog.Get(i);
                Assert.That(row.Groups[1].Value, Is.EqualTo(stableIds[i].Groups[1].Value), "Rust runtime index at " + i);
                var tags = new List<string>();
                foreach (Match tag in tagPattern.Matches(row.Groups[4].Value)) tags.Add(tag.Groups[1].Value);
                Assert.That(display.Id, Is.EqualTo(row.Groups[1].Value), "card id at index " + i);
                Assert.That(display.Title, Is.EqualTo(row.Groups[2].Value), "title at index " + i);
                Assert.That(display.Description, Is.EqualTo(row.Groups[3].Value), "description at index " + i);
                Assert.That(display.Tags, Is.EqualTo(string.Join(", ", tags)), "tags at index " + i);
            }
        }

        [Test]
        public void CatalogDrawerHasEightyFocusableCardsAndReadOnlyServerFactsSurviveRefresh()
        {
            Assert.That(_drawer.CardCount, Is.EqualTo(80));
            Assert.That(_drawer.IsVisible, Is.False);
            _drawer.SetVisible(true);
            Assert.That(_drawer.BlocksInput, Is.True);
            Canvas.ForceUpdateCanvases();
            LayoutRebuilder.ForceRebuildLayoutImmediate(_drawer.Content);
            Canvas.ForceUpdateCanvases();

            var collections = new CollectionsView();
            var cards = new List<byte>(new byte[80]); cards[3] = 2; cards[79] = 1;
            SetView(collections, "HasBuild", true); SetView(collections, "Cards", cards);
            var boosts = new List<byte>(new byte[] { 1, 0, 2, 0, 0, 3, 0, 1 });
            SetView(collections, "Boosts", boosts);
            var me = new SelfView { Id = 17, Hp = 82, MaxHp = 120, Barrier = 15, Status = ActorStatus.Alive, Weapon = WeaponId.Axe, Kills = 4, Bounty = 2, Gv = 9 };
            _drawer.Refresh(collections, me, 1.5f);

            var buttons = _drawer.Content.GetComponentsInChildren<Button>(true);
            Assert.That(buttons.Length, Is.EqualTo(80));
            Assert.That(buttons[0].navigation.mode, Is.Not.EqualTo(Navigation.Mode.None));
            buttons[79].onClick.Invoke();
            Assert.That(_drawer.SelectedIndex, Is.EqualTo(79));

            _drawer.Scroll.verticalNormalizedPosition = .31f;
            cards[3] = 3; me.Hp = 79;
            _drawer.Refresh(collections, me, 1.5f);
            Assert.That(_drawer.SelectedIndex, Is.EqualTo(79));
            Assert.That(_drawer.Scroll.verticalNormalizedPosition, Is.EqualTo(.31f).Within(.01f));
            var selectedDetail = typeof(BuildDrawer).GetField("_detail", BindingFlags.Instance | BindingFlags.NonPublic).GetValue(_drawer) as TMP_Text;
            Assert.That(selectedDetail.fontSize, Is.GreaterThanOrEqualTo(19f), "150% text setting is applied to drawer content");
        }

        [Test]
        public void HighestCardStackChangeRefreshesWithoutResettingInspectionOrScroll()
        {
            var collections = new CollectionsView();
            var cards = new List<byte>(new byte[80]); cards[79] = 1;
            SetView(collections, "HasBuild", true); SetView(collections, "Cards", cards);
            _drawer.SetVisible(true); _drawer.Refresh(collections, null, 1);
            Canvas.ForceUpdateCanvases(); LayoutRebuilder.ForceRebuildLayoutImmediate(_drawer.Content); Canvas.ForceUpdateCanvases();
            var highest = _drawer.Content.Find("Card79");
            highest.GetComponent<Button>().onClick.Invoke();
            _drawer.Scroll.verticalNormalizedPosition = .31f;
            Assert.That(highest.Find("CardTitle").GetComponent<TMP_Text>().text, Is.EqualTo("Final Verdict"));
            Assert.That(highest.Find("OwnedCount").GetComponent<TMP_Text>().text, Is.EqualTo("×1"));

            cards[79] = 2; // The distinct-card summary stays the same; the full build must still refresh this stack.
            _drawer.Refresh(collections, null, 1);

            Assert.That(highest.Find("OwnedCount").GetComponent<TMP_Text>().text, Is.EqualTo("×2"));
            Assert.That(_drawer.SelectedIndex, Is.EqualTo(79));
            Assert.That(_drawer.Scroll.verticalNormalizedPosition, Is.EqualTo(.31f).Within(.01f));
            var detail = typeof(BuildDrawer).GetField("_detail", BindingFlags.Instance | BindingFlags.NonPublic).GetValue(_drawer) as TMP_Text;
            StringAssert.StartsWith("Final Verdict", detail.text);
        }

        [Test]
        public void DrawerGeometryMaskFiltersAndCallbacksPreserveScrollAndSelection()
        {
            var canvas = _canvasObject.GetComponent<Canvas>();
            canvas.renderMode = RenderMode.ScreenSpaceOverlay;
            var scaler = _canvasObject.GetComponent<UnityEngine.UI.CanvasScaler>();
            scaler.uiScaleMode = UnityEngine.UI.CanvasScaler.ScaleMode.ScaleWithScreenSize;
            scaler.referenceResolution = new Vector2(2560, 1440);
            scaler.matchWidthOrHeight = .5f;
            _drawer.SetVisible(true);

            Canvas.ForceUpdateCanvases();
            UnityEngine.UI.LayoutRebuilder.ForceRebuildLayoutImmediate(_drawer.Content);
            Canvas.ForceUpdateCanvases();
            var viewport = _drawer.Scroll.viewport;
            var firstCard = _drawer.Content.Find("Card00") as RectTransform;
            var viewportBounds = ScreenBounds(viewport);
            var firstBounds = ScreenBounds(firstCard);
            Assert.That(Intersects(viewportBounds, firstBounds), Is.True,
                "Card00 should be visible in the first viewport after initial layout");
            var firstCenter = firstBounds.center;
            Assert.That(RectTransformUtility.RectangleContainsScreenPoint(viewport, firstCenter), Is.True);

            var cardImage = firstCard.GetComponent<UnityEngine.UI.Image>();
            cardImage.Rebuild(UnityEngine.UI.CanvasUpdate.PreRender);
            var cardMesh = cardImage.canvasRenderer.GetMesh();
            Assert.That(cardMesh, Is.Not.Null);
            Assert.That(cardMesh.vertexCount, Is.GreaterThan(0), "the card background builds real UI mesh geometry");
            var glyph = firstCard.Find("CardGlyph").GetComponent<UnityEngine.UI.Image>();
            glyph.Rebuild(UnityEngine.UI.CanvasUpdate.PreRender);
            var glyphMesh = glyph.canvasRenderer.GetMesh();
            Assert.That(glyph.sprite, Is.Not.Null);
            Assert.That(glyphMesh, Is.Not.Null);
            Assert.That(glyphMesh.vertexCount, Is.GreaterThan(0), "the card glyph builds real UI mesh geometry");

            // Synchronous EditMode cannot guarantee a rendered Canvas depth. Exercise the actual
            // parent mask filters here; real GraphicRaycaster hits remain required in the rendered
            // Play proof documented in docs/ui/DRAWER_PROOF_CONTEXT.md.
            var pointer = new PointerEventData(null) { position = firstCenter };
            Assert.That(cardImage.Raycast(firstCenter, null), Is.True,
                "the card's parent mask/filter chain accepts a point inside the viewport");

            _drawer.Scroll.verticalNormalizedPosition = .5f;
            Canvas.ForceUpdateCanvases();
            UnityEngine.UI.LayoutRebuilder.ForceRebuildLayoutImmediate(_drawer.Content);
            Canvas.ForceUpdateCanvases();
            viewportBounds = ScreenBounds(viewport);
            UnityEngine.UI.Button clippedCard = null;
            Rect clippedBounds = default;
            var cards = _drawer.Content.GetComponentsInChildren<UnityEngine.UI.Button>(true);
            foreach (var candidate in cards)
            {
                var bounds = ScreenBounds((RectTransform)candidate.transform);
                if (Intersects(viewportBounds, bounds) &&
                    (bounds.yMin < viewportBounds.yMin || bounds.yMax > viewportBounds.yMax))
                {
                    clippedCard = candidate; clippedBounds = bounds; break;
                }
            }
            Assert.That(clippedCard, Is.Not.Null, "mid-scroll layout includes a partially clipped card row");
            float outsideY = clippedBounds.yMax > viewportBounds.yMax
                ? viewportBounds.yMax + .5f : viewportBounds.yMin - .5f;
            var clippedPoint = new Vector2(Mathf.Clamp(clippedBounds.center.x, viewportBounds.xMin + 1, viewportBounds.xMax - 1), outsideY);
            Assert.That(clippedBounds.Contains(clippedPoint), Is.True, "probe point is inside card geometry but outside the viewport");
            pointer.position = clippedPoint;
            Assert.That(clippedCard.GetComponent<UnityEngine.UI.Image>().Raycast(pointer.position, null), Is.False,
                "the actual parent mask/filter chain rejects a card point outside the viewport");

            var visibleButton = null as UnityEngine.UI.Button;
            foreach (var candidate in cards)
            {
                var bounds = ScreenBounds((RectTransform)candidate.transform);
                if (!RectTransformUtility.RectangleContainsScreenPoint(viewport, bounds.center)) continue;
                pointer.position = bounds.center;
                if (candidate.GetComponent<UnityEngine.UI.Image>().Raycast(pointer.position, null))
                { visibleButton = candidate; break; }
            }
            Assert.That(visibleButton, Is.Not.Null, "a card inside the viewport passes the parent filters after scrolling");

            float beforeWheel = _drawer.Scroll.verticalNormalizedPosition;
            pointer.scrollDelta = new Vector2(0, -1);
            var wheelTarget = ExecuteEvents.ExecuteHierarchy<IScrollHandler>(visibleButton.gameObject, pointer, ExecuteEvents.scrollHandler);
            Assert.That(wheelTarget, Is.SameAs(_drawer.Scroll.gameObject), "wheel dispatch reaches the owning ScrollRect");
            Canvas.ForceUpdateCanvases();
            Assert.That(_drawer.Scroll.verticalNormalizedPosition, Is.Not.EqualTo(beforeWheel), "wheel dispatch moves the real content");

            var selectionBounds = ScreenBounds((RectTransform)visibleButton.transform);
            pointer.position = selectionBounds.center; pointer.button = PointerEventData.InputButton.Left;
            Assert.That(RectTransformUtility.RectangleContainsScreenPoint(viewport, pointer.position), Is.True);
            Assert.That(visibleButton.GetComponent<UnityEngine.UI.Image>().Raycast(pointer.position, null), Is.True,
                "the callback probe stays inside the viewport's parent filters after the wheel event");
            var clickTarget = ExecuteEvents.ExecuteHierarchy<IPointerClickHandler>(visibleButton.gameObject, pointer, ExecuteEvents.pointerClickHandler);
            Assert.That(clickTarget, Is.SameAs(visibleButton.gameObject), "selection uses the normal pointer-click handler path");
            int selected = int.Parse(visibleButton.name.Substring("Card".Length));
            Assert.That(_drawer.SelectedIndex, Is.EqualTo(selected));
            var detail = typeof(BuildDrawer).GetField("_detail", BindingFlags.Instance | BindingFlags.NonPublic).GetValue(_drawer) as TMP_Text;
            StringAssert.StartsWith(CardDisplayCatalog.Get(selected).Title, detail.text);

            var normalized = _drawer.Scroll.verticalNormalizedPosition;
            var collections = new CollectionsView();
            var counts = new List<byte>(new byte[80]); counts[selected] = 1;
            SetView(collections, "HasBuild", true); SetView(collections, "Cards", counts);
            _drawer.Refresh(collections, null, 1f);
            Assert.That(_drawer.SelectedIndex, Is.EqualTo(selected));
            Assert.That(_drawer.Scroll.verticalNormalizedPosition, Is.EqualTo(normalized).Within(.01f));
            _drawer.SetVisible(false); _drawer.SetVisible(true);
            Assert.That(_drawer.SelectedIndex, Is.EqualTo(selected));
            Assert.That(_drawer.Scroll.verticalNormalizedPosition, Is.EqualTo(normalized).Within(.01f));
        }

        [Test]
        public void FactoryButtonsHaveAccessibleMinimumSizeAndGeneratedIcons()
        {
            var button = MythicUi.Button(_canvasObject.transform, "MinimumButton", "Action", new Vector2(.5f, .5f), new Vector2(.5f, .5f), () => { });
            var rect = button.GetComponent<RectTransform>();
            Assert.That(rect.rect.width, Is.GreaterThanOrEqualTo(44));
            Assert.That(rect.rect.height, Is.GreaterThanOrEqualTo(44));
            foreach (MythicGlyph glyph in Enum.GetValues(typeof(MythicGlyph)))
            {
                var image = MythicUi.Icon(_canvasObject.transform, "Glyph" + glyph, glyph, 48);
                Assert.That(image.sprite, Is.Not.Null, "generated glyph " + glyph);
            }
        }

        static void SetView(CollectionsView view, string property, object value)
        {
            var info = typeof(CollectionsView).GetProperty(property, BindingFlags.Instance | BindingFlags.Public);
            info.GetSetMethod(true).Invoke(view, new[] { value });
        }

        static Rect ScreenBounds(RectTransform rect)
        {
            var corners = new Vector3[4]; rect.GetWorldCorners(corners);
            Vector2 min = RectTransformUtility.WorldToScreenPoint(null, corners[0]);
            Vector2 max = RectTransformUtility.WorldToScreenPoint(null, corners[2]);
            return Rect.MinMaxRect(min.x, min.y, max.x, max.y);
        }

        static bool Intersects(Rect a, Rect b) => a.xMin < b.xMax && a.xMax > b.xMin && a.yMin < b.yMax && a.yMax > b.yMin;

    }
}

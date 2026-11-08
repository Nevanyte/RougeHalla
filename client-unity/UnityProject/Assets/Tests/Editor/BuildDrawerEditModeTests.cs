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
    }
}

using System.Collections.Generic;
using System.Linq;
using NUnit.Framework;
using Roguehalla.Client;
using UnityEngine;
using UnityEngine.EventSystems;
using UnityEngine.UI;

namespace Roguehalla.Client.Tests
{
    public sealed class WeaponCounterGuideEditModeTests
    {
        [Test]
        public void FiveWeaponWheelHasTenDirectionalEdgesAndNoFistsNode()
        {
            CollectionAssert.AreEqual(new[] { "sword", "axe", "wand", "shield", "bow" }, WeaponCounterGuide.RingOrder);
            Assert.AreEqual(10, WeaponCounterGuide.Edges.Count);
            Assert.IsFalse(WeaponCounterGuide.IsWheelWeapon("fists"));
            Assert.IsFalse(WeaponCounterGuide.IsWheelWeapon(""));

            WeaponCounterGuide.Matchups("sword", out var swordWins, out var swordLosses);
            CollectionAssert.AreEquivalent(new[] { "axe", "wand" }, swordWins);
            CollectionAssert.AreEquivalent(new[] { "bow", "shield" }, swordLosses);
            Assert.IsTrue(WeaponCounterGuide.Edges.Any(e => e.Winner == "sword" && e.Loser == "axe" && !e.Diagonal));
            Assert.IsTrue(WeaponCounterGuide.Edges.Any(e => e.Winner == "sword" && e.Loser == "wand" && e.Diagonal));
            Assert.IsFalse(WeaponCounterGuide.Edges.Any(e => e.Winner == "fists" || e.Loser == "fists"));
        }

        [Test]
        public void HighlightsUseTextAndSymbolsAlongsideColorAndFistsStayOutsideTheLoop()
        {
            StringAssert.Contains("ACTIVE  Sword", WeaponCounterGuide.Describe("sword"));
            StringAssert.Contains("+ ADVANTAGE", WeaponCounterGuide.Describe("sword"));
            StringAssert.Contains("! WATCH FOR", WeaponCounterGuide.Describe("sword"));
            StringAssert.Contains("outside the five-weapon counter loop", WeaponCounterGuide.Describe("fists"));
            WeaponCounterGuide.Matchups("fists", out var beats, out var losesTo);
            Assert.IsEmpty(beats);
            Assert.IsEmpty(losesTo);
        }

        [Test]
        public void WheelExposesRailLayoutAndReleasesItsGeneratedTexture()
        {
            var host = new GameObject("WheelHost", typeof(RectTransform));
            var guide = new WeaponCounterGuide(host.transform, "bow");
            var texture = guide.Texture;
            Assert.IsNotNull(guide.WheelRoot);
            Assert.IsNotNull(guide.LegendRoot);
            guide.SetLayout(new Vector2(0, .28f), Vector2.one, Vector2.zero, new Vector2(1, .25f));
            Assert.AreEqual(.28f, guide.WheelRoot.anchorMin.y);
            Assert.AreEqual(.25f, guide.LegendRoot.anchorMax.y);

            guide.Destroy();
            Assert.IsTrue(texture == null, "The generated runtime texture must be destroyed immediately in EditMode.");
            Object.DestroyImmediate(host);
        }
    }

    public sealed class HubGuideViewEditModeTests
    {
        readonly List<GameObject> _objects = new List<GameObject>();

        GameObject Create(string name, params System.Type[] components)
        {
            var go = new GameObject(name, components);
            _objects.Add(go);
            return go;
        }

        EventSystem MakeEventSystem()
        {
            var go = Create("EventSystem", typeof(EventSystem), typeof(StandaloneInputModule));
            return go.GetComponent<EventSystem>();
        }

        [TearDown]
        public void TearDown()
        {
            for (int i = _objects.Count - 1; i >= 0; i--) if (_objects[i] != null) Object.DestroyImmediate(_objects[i]);
            _objects.Clear();
        }

        [Test]
        public void GuideTabsOpenDirectlySupportKeyboardFocusAndEscapeRestoresOpener()
        {
            var events = MakeEventSystem();
            var canvas = Create("Canvas", typeof(RectTransform), typeof(Canvas), typeof(GraphicRaycaster));
            var opener = Create("OpenGuide", typeof(RectTransform), typeof(Image), typeof(Button)).GetComponent<Button>();
            events.SetSelectedGameObject(opener.gameObject);
            var guide = canvas.AddComponent<HubGuideView>();
            guide.Initialize((RectTransform)canvas.transform, _ => { });

            guide.ShowTab(HubGuideView.GuideTab.Weapons);
            Assert.IsTrue(guide.IsVisible);
            Assert.AreEqual(HubGuideView.GuideTab.Weapons, guide.CurrentTab);
            Assert.AreSame(guide.GetTabButton(HubGuideView.GuideTab.Weapons).gameObject, events.currentSelectedGameObject);
            Assert.AreSame(guide.GetTabButton(HubGuideView.GuideTab.Counters), guide.GetTabButton(HubGuideView.GuideTab.Weapons).navigation.selectOnRight);
            Assert.IsNull(canvas.transform.Find("HubGuideOverlay").GetComponent<Button>(), "The content overlay itself must not close the guide when clicked.");
            Assert.IsNotNull(canvas.transform.Find("HubGuideOverlay/Backdrop").GetComponent<Button>());

            Assert.IsTrue(guide.HandleEscape());
            Assert.IsFalse(guide.IsVisible);
            Assert.AreSame(opener.gameObject, events.currentSelectedGameObject);
            Assert.IsFalse(guide.HandleEscape());
        }

        [Test]
        public void ChampionGuideListsFiveFactionsAndForwardsTheSelectedFaction()
        {
            MakeEventSystem();
            var canvas = Create("Canvas", typeof(RectTransform), typeof(Canvas), typeof(GraphicRaycaster));
            int selected = -1;
            var guide = canvas.AddComponent<HubGuideView>();
            guide.Initialize((RectTransform)canvas.transform, faction => selected = faction);
            guide.ShowTab(HubGuideView.GuideTab.Champions);

            string[] expected = { "Fire", "Sentenced", "Plague", "Frost", "Holy" };
            foreach (string name in expected)
                Assert.IsNotNull(guide.Content.Find("Card_" + expected.ToList().IndexOf(name)));
            var fire = guide.Content.Find("FactionChoices/Faction_Fire").GetComponent<Button>();
            fire.onClick.Invoke();
            Assert.AreEqual(0, selected);
            Assert.AreEqual(0, guide.SelectedFaction);
        }
    }
}

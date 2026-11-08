using System.Collections.Generic;
using NUnit.Framework;
using Roguehalla.Client;
using UnityEngine;
using UnityEngine.EventSystems;
using UnityEngine.UI;

namespace Roguehalla.Client.Tests
{
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
            for (int i = 0; i < expected.Length; i++)
            {
                var card = guide.Content.Find("Card_" + i);
                Assert.IsNotNull(card, "Expected the guide card for " + expected[i]);
                StringAssert.Contains(expected[i], card.Find("Title").GetComponent<TMPro.TMP_Text>().text);
            }
            var fire = guide.Content.Find("FactionChoices/Faction_Fire").GetComponent<Button>();
            fire.onClick.Invoke();
            Assert.AreEqual(0, selected);
            Assert.AreEqual(0, guide.SelectedFaction);
        }
    }
}

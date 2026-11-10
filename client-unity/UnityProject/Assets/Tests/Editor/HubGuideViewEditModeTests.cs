using System.Collections.Generic;
using NUnit.Framework;
using Roguehalla.Client;
using UnityEngine;
using UnityEngine.EventSystems;
using UnityEngine.UI;

namespace Roguehalla.Client.Tests
{
    [ExecuteAlways]
    public sealed class GuideEditModeEventSystem : EventSystem { }

    public sealed class HubGuideViewEditModeTests
    {
        readonly List<GameObject> _objects = new List<GameObject>();
        EventSystem _previousEvents;
        GameObject _previousSelection;

        GameObject Create(string name, params System.Type[] components)
        {
            var go = new GameObject(name, components);
            _objects.Add(go);
            return go;
        }

        EventSystem MakeEventSystem()
        {
            _previousEvents = EventSystem.current;
            _previousSelection = _previousEvents != null ? _previousEvents.currentSelectedGameObject : null;
            var go = Create("EventSystem", typeof(GuideEditModeEventSystem), typeof(StandaloneInputModule));
            var events = go.GetComponent<GuideEditModeEventSystem>();
            // ExecuteAlways supplies a real edit-mode OnEnable registration; force the cycle before promoting it.
            events.enabled = false;
            events.enabled = true;
            EventSystem.current = events;
            Assert.AreSame(events, EventSystem.current, "The fixture must be registered and current before testing focus.");
            return events;
        }

        [TearDown]
        public void TearDown()
        {
            for (int i = _objects.Count - 1; i >= 0; i--) if (_objects[i] != null) Object.DestroyImmediate(_objects[i]);
            _objects.Clear();
            if (_previousEvents != null && _previousEvents.gameObject.activeInHierarchy)
            {
                if (EventSystem.current != _previousEvents) EventSystem.current = _previousEvents;
                if (_previousSelection != null && _previousSelection.activeInHierarchy)
                    _previousEvents.SetSelectedGameObject(_previousSelection);
            }
            _previousEvents = null; _previousSelection = null;
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
                // A faction card leads with its generated pictogram (no bracket mark): the title sits in the Head row beside the icon.
                var title = card.Find("Head/Title") ?? card.Find("Title");
                StringAssert.Contains(expected[i], title.GetComponent<TMPro.TMP_Text>().text);
                StringAssert.DoesNotContain("[", title.GetComponent<TMPro.TMP_Text>().text);
                Assert.IsNotNull(card.Find("Head/FactionIcon"), "faction pictogram on the card for " + expected[i]);
                Assert.IsNotNull(guide.Content.Find("FactionChoices/Faction_" + expected[i] + "/FactionIcon"), "faction pictogram on the button for " + expected[i]);
            }
            var fire = guide.Content.Find("FactionChoices/Faction_Fire").GetComponent<Button>();
            fire.onClick.Invoke();
            Assert.AreEqual(0, selected);
            Assert.AreEqual(0, guide.SelectedFaction);
        }
    }
}

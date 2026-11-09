using NUnit.Framework;
using Roguehalla.Client;
using Roguehalla.Net.Ui;
using TMPro;
using UnityEngine;
using UnityEngine.UI;

namespace Roguehalla.Client.Tests
{
    public sealed class HubAtriumViewEditModeTests
    {
        GameObject _root;

        [TearDown]
        public void TearDown()
        {
            if (_root != null) Object.DestroyImmediate(_root);
        }

        [Test]
        public void DirectoryOpensAvailableDestinationsAndShowsReasonForFutureStations()
        {
            _root = new GameObject("Canvas", typeof(RectTransform), typeof(Canvas));
            var view = _root.AddComponent<HubAtriumView>();
            int calls = 0;
            HubDestination last = HubDestination.Champions;
            view.Initialize(_root.transform, destination => { calls++; last = destination; });
            view.SetVisible(true);

            _root.transform.Find("HubAtrium/Direct_Weapons").GetComponent<Button>().onClick.Invoke();
            Assert.AreEqual(1, calls);
            Assert.AreEqual(HubDestination.Weapons, last);

            view.SetStationAvailable(HubDestination.Shop, false, "Trading is closed in this build.");
            _root.transform.Find("HubAtrium/Direct_Shop").GetComponent<Button>().onClick.Invoke();
            Assert.AreEqual(1, calls, "Unavailable stations never forward a destination callback.");
            Assert.AreEqual("Trading is closed in this build.", _root.transform.Find("HubAtrium/StationMessage").GetComponent<TMP_Text>().text);

            view.SetStationAvailable(HubDestination.Shop, true, "Shop is open.");
            _root.transform.Find("HubAtrium/Direct_Shop").GetComponent<Button>().onClick.Invoke();
            Assert.AreEqual(2, calls);
            Assert.AreEqual(HubDestination.Shop, last);
        }

        [Test]
        public void StationClickStartsCosmeticWalkAndAvatarSpriteCanBeSuppliedLater()
        {
            _root = new GameObject("Canvas", typeof(RectTransform), typeof(Canvas));
            var view = _root.AddComponent<HubAtriumView>();
            view.Initialize(_root.transform, _ => { });
            view.SetVisible(true);

            _root.transform.Find("HubAtrium/AtriumFloor/Station_Counters").GetComponent<Button>().onClick.Invoke();
            Assert.That(view.Motion.X, Is.EqualTo(.5f).Within(.00001f));
            Assert.That(view.Motion.Y, Is.EqualTo(.48f).Within(.00001f));
            Assert.AreEqual("Walking to Counters…  Press E near a station to activate it.",
                _root.transform.Find("HubAtrium/StationMessage").GetComponent<TMP_Text>().text);

            Assert.IsNull(view.AvatarSprite);
            view.SetFaction(0);
            Assert.AreEqual("[F]", _root.transform.Find("HubAtrium/AtriumFloor/CosmeticAvatar/FactionMark").GetComponent<TMP_Text>().text);
        }
    }
}

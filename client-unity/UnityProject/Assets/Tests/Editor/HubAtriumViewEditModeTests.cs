using System.Collections.Generic;
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
        HubAtriumView _view;
        readonly List<HubDestination> _opened = new List<HubDestination>();

        [SetUp]
        public void SetUp()
        {
            _root = new GameObject("Canvas", typeof(RectTransform), typeof(Canvas));
            _view = _root.AddComponent<HubAtriumView>();
            _view.Initialize(_root.transform, destination => _opened.Add(destination));
            _view.ApplyArea(0, 0, 1000, 700);
            _view.SetVisible(true);
        }

        [TearDown]
        public void TearDown()
        {
            if (_root != null) Object.DestroyImmediate(_root);
            _opened.Clear();
        }

        Button Station(string id) { return _root.transform.Find("HubAtrium/Room/Station_" + id).GetComponent<Button>(); }
        string Message() { return _root.transform.Find("HubAtrium/StationMessageBox/StationMessage").GetComponent<TMP_Text>().text; }

        [Test]
        public void EachStationAppearsOnceAsAControlInTheRoom()
        {
            var names = new List<string>();
            foreach (var button in _view.Room.GetComponentsInChildren<Button>(true)) names.Add(button.name);
            // One counters decal, one arena, one training door, five kiosks, five pedestals; no second directory of the same stations.
            Assert.That(names, Is.Unique);
            Assert.That(names.Count, Is.EqualTo(13), string.Join(", ", names));
            foreach (string id in new[] { "Counters", "Arena", "Training", "Shop", "Wardrobe", "Titles", "Achievements", "Leaderboard",
                "Faction_Fire", "Faction_Sentenced", "Faction_Plague", "Faction_Frost", "Faction_Holy" })
                Assert.That(names, Does.Contain("Station_" + id));
            Assert.That(_root.GetComponentsInChildren<Button>(true).Length, Is.EqualTo(13), "nothing outside the room is a station control");
        }

        [Test]
        public void ClickingAStationInReachOpensItAndAnUnavailableOneExplainsWhy()
        {
            _view.PlaceAvatar(240, 96);
            Station("Shop").onClick.Invoke();
            Assert.That(_opened, Is.EqualTo(new[] { HubDestination.Shop }));

            _view.SetStationAvailable(HubDestination.Shop, false, "Trading is closed in this build.");
            Station("Shop").onClick.Invoke();
            Assert.That(_opened.Count, Is.EqualTo(1), "an unavailable station never forwards a destination");
            Assert.That(Message(), Is.EqualTo("Trading is closed in this build."));

            _view.SetStationAvailable(HubDestination.Shop, true, "");
            Station("Shop").onClick.Invoke();
            Assert.That(_opened.Count, Is.EqualTo(2));
        }

        [Test]
        public void ClickingAFarStationStartsAWalkInsteadOfOpeningIt()
        {
            var before = _view.AvatarPosition;
            Station("Counters").onClick.Invoke();
            Assert.That(_opened, Is.Empty);
            Assert.That(Message(), Does.StartWith("Walking to weapon counters"));
            Assert.That(_view.AvatarPosition, Is.EqualTo(before));
        }

        [Test]
        public void PedestalsPickAFactionAndArenaAndTrainingRaiseTheirOwnRequests()
        {
            int picked = -1, plays = 0, trainings = 0;
            _view.FactionPicked = f => picked = f;
            _view.PlayRequested = () => plays++;
            _view.TrainingRequested = () => trainings++;
            _view.PlaceAvatar(548, 492);
            Station("Faction_Frost").onClick.Invoke();
            Assert.That(picked, Is.EqualTo(3));
            _view.PlaceAvatar(448, 122);
            Station("Arena").onClick.Invoke();
            Assert.That(plays, Is.EqualTo(1));

            _view.SetPlayAvailable(false, "No arena server is set up for this page.", false, "Training isn't offered on this server.");
            Station("Arena").onClick.Invoke(); Station("Training").onClick.Invoke();
            Assert.That(plays, Is.EqualTo(1), "an unavailable arena never raises a request");
            Assert.That(trainings, Is.EqualTo(0));
        }

        [Test]
        public void AvatarStaysOnTheFloorAndOutOfKiosks()
        {
            _view.PlaceAvatar(-50, 900);
            var corner = _view.AvatarPosition;
            Assert.That(corner.x, Is.GreaterThanOrEqualTo(HubAtriumView.Wall));
            Assert.That(corner.y, Is.LessThanOrEqualTo(HubAtriumView.RoomH - HubAtriumView.Wall));
            _view.PlaceAvatar(120, 96);
            var p = _view.AvatarPosition;
            bool insideShop = p.x > 40f && p.x < 216f && p.y > 66f && p.y < 126f;
            Assert.That(insideShop, Is.False, "a solid kiosk pushes the avatar out");
        }

        [Test]
        public void RoomScalesToTheAreaItIsGiven()
        {
            _view.ApplyArea(0, 0, 450, 400);
            Assert.That(_view.RoomScale, Is.EqualTo(Mathf.Min(450f / 896f, 364f / 576f)).Within(.001f));
            _view.ApplyArea(0, 0, 4000, 4000);
            Assert.That(_view.RoomScale, Is.EqualTo(HubAtriumView.MaxScale), "never blown up past the cap");
        }
    }
}

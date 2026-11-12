using System.Reflection;
using NUnit.Framework;
using Roguehalla.Net;
using Roguehalla.Net.Protocol;
using TMPro;
using UnityEngine;
using UnityEngine.UI;

namespace Roguehalla.Client.Tests
{
    /// <summary>
    /// P-UNITY-HUD-VISUAL-FIX-3, item 4: with a weapon highlighted the Weapon Counters footer must end above the "QUESTS &amp; TRADERS"
    /// heading, and a cleared camp's respawn clock must stay clear of the own-position ring when the player stands on the camp.
    /// Real rectangles: the controller is laid out in a stage of the size a 1280x720 and a 1920x1080 window give (HUD units).
    /// </summary>
    public sealed class TabMapVisualFix3EditModeTests
    {
        GameObject _canvas, _stageObject, _clientObject, _controllerObject, _marksObject;
        Fix3Transport _transport;
        Session _session;
        TacticalMapController _controller;
        MatchClient _client;

        [TearDown]
        public void TearDown()
        {
            if (_controller != null) _controller.Bind(null);
            if (_session != null) _session.Leave();
            foreach (var go in new[] { _controllerObject, _clientObject, _marksObject, _stageObject, _canvas })
                if (go != null) Object.DestroyImmediate(go);
        }

        static readonly Vector2[] Windows = { new Vector2(1280, 720), new Vector2(1920, 1080) };

        static Vector2 StageUnits(Vector2 window)
        {
            float scale = Mathf.Clamp(Mathf.Min(window.x / 1280f, window.y / 800f), .8f, 1.5f);   // HudViewport: legacy overlay scale
            return new Vector2(window.x / scale, window.y / scale);
        }

        void Build(Vector2 window)
        {
            _canvas = new GameObject("fix3 map canvas", typeof(RectTransform), typeof(Canvas), typeof(GraphicRaycaster));
            _stageObject = new GameObject("fix3 stage", typeof(RectTransform));
            var stage = (RectTransform)_stageObject.transform; stage.SetParent(_canvas.transform, false);
            stage.anchorMin = stage.anchorMax = stage.pivot = new Vector2(.5f, .5f); stage.sizeDelta = StageUnits(window);
            _transport = new Fix3Transport();
            _session = Fix3Transport.Join(_transport, new MapBlob(4, 4, new byte[16]),
                new WireSelf { Id = 1, Faction = 4, X = 48, Y = 48, Hp = 100, MaxHp = 100, Status = 1, Weapon = (byte)WeaponId.Wand });
            _clientObject = new GameObject("fix3 map client");
            _client = _clientObject.AddComponent<MatchClient>(); _client.enabled = false; _client.Url = "ws://localhost/fix3"; _client.Profile = "fixture";
            _controllerObject = new GameObject("fix3 map controller");
            _controller = _controllerObject.AddComponent<TacticalMapController>();
            _controller.Initialize(_client, _canvas.transform, null, stage);
            _controller.Bind(_session);
            _controller.SetOpen(true);
            _controller.Tick();
            typeof(TacticalMapController).GetMethod("ApplyLayout", BindingFlags.Instance | BindingFlags.NonPublic).Invoke(_controller, new object[] { true });
            Canvas.ForceUpdateCanvases();
        }

        static Rect Local(RectTransform rect, RectTransform space)
        {
            var corners = new Vector3[4]; rect.GetWorldCorners(corners);
            Vector3 min = space.InverseTransformPoint(corners[0]), max = space.InverseTransformPoint(corners[2]);
            return Rect.MinMaxRect(min.x, min.y, max.x, max.y);
        }

        [TestCaseSource(nameof(Windows))]
        public void TheWeaponCountersFooterEndsAboveTheQuestsHeadingWithAWeaponHighlighted(Vector2 window)
        {
            Build(window);
            var guide = (WeaponCounterGuide)typeof(TacticalMapController).GetField("_counterGuide", BindingFlags.Instance | BindingFlags.NonPublic).GetValue(_controller);
            var heading = ((TMP_Text)typeof(TacticalMapController).GetField("_questHeading", BindingFlags.Instance | BindingFlags.NonPublic).GetValue(_controller)).rectTransform;
            var rail = (RectTransform)heading.parent;
            Assert.That(guide.ActiveWeapon, Is.EqualTo("wand"), "the own weapon is highlighted");
            var legend = guide.LegendRoot.GetComponentInChildren<TMP_Text>();
            StringAssert.Contains("ACTIVE", legend.text);

            Rect legendBox = Local(guide.LegendRoot, rail), headingBox = Local(heading, rail);
            float needed = legend.GetPreferredValues(legend.text, legendBox.width, 0f).y;
            float textBottom = legendBox.yMax - needed;
            Assert.That(textBottom, Is.GreaterThanOrEqualTo(headingBox.yMax - .5f),
                "footer text (" + needed + " units tall at size " + legend.fontSize + ") runs into the QUESTS & TRADERS heading");
            Assert.That(headingBox.yMin, Is.GreaterThanOrEqualTo(rail.rect.yMin), "the heading stays inside the rail");
        }

        // The camp sits where the player stands; its seconds were drawn at (0, -16) under the 31 unit ring (shots 13, 15).
        [Test]
        public void AClearedCampsClockIsClearOfTheOwnRingWhenThePlayerStandsOnTheCamp()
        {
            _canvas = new GameObject("fix3 marks canvas", typeof(RectTransform), typeof(Canvas));
            _transport = new Fix3Transport();
            var map = new MapBlob(4, 4, new byte[16]).WithPublic(new[] { new MapCamp(96, 96, 8, 1) }, null, null, null, null);
            _session = Fix3Transport.Join(_transport, map,
                new WireSelf { Id = 1, Faction = 4, X = 96, Y = 96, Hp = 100, MaxHp = 100, Status = 1, Weapon = 2 });
            _marksObject = new GameObject("fix3 marks", typeof(RectTransform));
            var rect = (RectTransform)_marksObject.transform; rect.SetParent(_canvas.transform, false); rect.sizeDelta = new Vector2(400, 400);
            var marks = _marksObject.AddComponent<TacticalMapMarks>(); marks.Large = true; marks.SetMap(map);
            _transport.Deliver(new ServerMsg.State { Tick = 3, Items = new StateItem[] { new CampsState { Rows = new[] {
                new WireCamp { MobType = 0, Elite = 0, Alive = 0, State = 2, ClearedAt = 1000, RespawnAt = 181000 } } } } });
            marks.Present(_session, null);
            Canvas.ForceUpdateCanvases();

            Assert.That(marks.CampClocksShown, Is.EqualTo(1), "the cleared camp shows its clock");
            var ring = marks.SelfMarkerRect;
            Assert.That(ring.HasValue, Is.True, "the own position is drawn");
            var label = (RectTransform)_marksObject.transform.Find("CampClock0");
            Assert.That(label, Is.Not.Null);
            var box = new Rect(label.anchoredPosition - label.sizeDelta * .5f, label.sizeDelta);
            Assert.That(box.Overlaps(ring.Value), Is.False, "clock box " + box + " is under the ring " + ring.Value);
            Assert.That(rect.rect.Contains(box.min) && rect.rect.Contains(box.max), Is.True, "the clock stays on the map");
        }
    }
}

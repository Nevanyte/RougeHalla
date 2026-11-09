using System;
using System.Collections.Generic;
using System.Reflection;
using NUnit.Framework;
using Roguehalla.Net;
using Roguehalla.Net.Protocol;
using Roguehalla.Net.Ui;
using UnityEngine;
using UnityEngine.EventSystems;
using UnityEngine.UI;

namespace Roguehalla.Client.Tests
{
    public sealed class TacticalMapEditModeTests
    {
        GameObject _root;
        Session _session;
        DeliveredTransport _transport;
        GameObject _controllerObject, _clientObject, _uiRoot;
        TacticalMapController _controller;
        MatchClient _client;
        Session _reboundSession;
        [SetUp]
        public void SetUp()
        {
            _root = new GameObject("Map fixture", typeof(RectTransform));
            _transport = new DeliveredTransport();
            _session = new Session(_transport, new SessionOptions { Url = "ws://localhost/ws", Profile = "fixture", Now = () => 1000 });
            _session.Connect(); _transport.Open();
            _transport.Deliver(new ServerMsg.Welcome { Protocol = Wire.ProtocolVersion, MatchId = new byte[16], Session = new byte[16],
                PlayerId = 1, TickRate = 20, Map = new MapBlob(4, 4, new byte[16]) });
        }
        [TearDown]
        public void TearDown()
        {
            if (_controller != null) _controller.Bind(null);
            if (_session != null) _session.Leave();
            if (_reboundSession != null) _reboundSession.Leave();
            if (_controllerObject != null) UnityEngine.Object.DestroyImmediate(_controllerObject);
            if (_uiRoot != null) UnityEngine.Object.DestroyImmediate(_uiRoot);
            if (_clientObject != null) UnityEngine.Object.DestroyImmediate(_clientObject);
            UnityEngine.Object.DestroyImmediate(_root);
        }

        [Test]
        public void NewSnapshotInvalidatesPaintThrottleAndClearsBothObservedMapSurfaces()
        {
            CreateController(_session);
            _transport.Deliver(Snapshot(1, new WireActor { Id = 2, X = 48, Y = 48, HpPct = 100, Status = 1 }));
            _controller.SetOpen(true);
            _controller.Tick();
            Assert.AreEqual(1, LargeMarks().ContactCount);
            Assert.AreEqual(1, MinimapMarks().ContactCount);

            SetNextPaint(Time.realtimeSinceStartupAsDouble + 60);
            _transport.Deliver(Snapshot(2));
            _controller.Tick();

            Assert.AreEqual(0, LargeMarks().ContactCount, "new accepted snapshots must invalidate a far-future paint throttle");
            Assert.AreEqual(0, MinimapMarks().ContactCount, "the minimap must use the same current delivered contact set");
        }

        [Test]
        public void DisconnectAndRebindClearMarksAndRefreshSingleObservedContactRail()
        {
            CreateController(_session);
            _transport.Deliver(Snapshot(1, new WireActor { Id = 2, X = 48, Y = 48, HpPct = 100, Status = 1 }));
            _controller.SetOpen(true);
            _controller.Tick();
            Assert.AreEqual(1, LargeMarks().ContactCount);
            Assert.AreEqual(1, MinimapMarks().ContactCount);
            StringAssert.DoesNotContain("No other contacts", ContactsText());

            SetNextPaint(Time.realtimeSinceStartupAsDouble + 60);
            _transport.Drop();
            _controller.Tick();
            Assert.AreEqual(0, LargeMarks().ContactCount, "disconnect must clear the large map's cached marks");
            Assert.AreEqual(0, MinimapMarks().ContactCount, "disconnect must clear the minimap's cached marks");

            _controller.Bind(null);
            Assert.AreEqual(string.Empty, ContactsText(), "unbinding clears the prior session's contact rail");
            Assert.AreEqual(0, LargeMarks().ContactCount);
            Assert.AreEqual(0, MinimapMarks().ContactCount);

            var nextTransport = new DeliveredTransport();
            _reboundSession = NewSession(nextTransport, 3);
            _controller.Bind(_reboundSession);
            nextTransport.Deliver(Snapshot(1, new WireActor { Id = 3, X = 80, Y = 80, Faction = 2, HpPct = 100, Status = 1 }));
            _controller.SetOpen(true);
            SetNextPaint(Time.realtimeSinceStartupAsDouble + 60);
            _controller.Tick();

            StringAssert.Contains("Plague · Player", ContactsText());
            StringAssert.DoesNotContain("No other contacts", ContactsText(), "one observed enemy is still an observed contact");
            Assert.AreEqual(1, LargeMarks().ContactCount);
            Assert.AreEqual(1, MinimapMarks().ContactCount);
        }

        [Test]
        public void MinimapVisibilityTracksActiveMapSuppressionAndUnbind()
        {
            CreateController(_session);
            _transport.Deliver(Snapshot(1));
            Assert.AreEqual(SessionState.InMatch, _session.State);
            Assert.AreEqual(MatchPhase.Active, _session.Phase);
            Assert.IsTrue(MinimapRoot().activeSelf, "an active bound session should show its minimap");

            _controller.SetOpen(true);
            Assert.IsFalse(MinimapRoot().activeSelf, "the minimap hides while its large map is open");
            _controller.SetOpen(false);
            Assert.IsTrue(MinimapRoot().activeSelf, "closing the large map restores the minimap");

            _controller.SetMinimapSuppressed(true);
            Assert.IsFalse(MinimapRoot().activeSelf, "an explicit suppression hides the minimap");
            _controller.SetMinimapSuppressed(false);
            Assert.IsTrue(MinimapRoot().activeSelf, "clearing suppression restores it for the active session");

            _controller.Bind(null);
            Assert.IsFalse(MinimapRoot().activeSelf, "unbinding the session hides the minimap");
        }

        void CreateController(Session session)
        {
            _uiRoot = new GameObject("Tactical map controller canvas", typeof(RectTransform), typeof(Canvas), typeof(GraphicRaycaster));
            _clientObject = new GameObject("Disabled map test client");
            _client = _clientObject.AddComponent<MatchClient>();
            _client.enabled = false;
            _client.Url = "ws://localhost/map-test"; _client.Profile = "fixture";
            _controllerObject = new GameObject("Tactical map controller");
            _controller = _controllerObject.AddComponent<TacticalMapController>();
            _controller.Initialize(_client, _uiRoot.transform);
            _controller.Bind(session);
        }

        TacticalMapMarks LargeMarks() => _uiRoot.transform.Find("TacticalMap/MapFrame/PublicMap/Delivered contacts and personal route").GetComponent<TacticalMapMarks>();
        GameObject MinimapRoot() => _uiRoot.transform.Find("Minimap").gameObject;
        TacticalMapMarks MinimapMarks() => _uiRoot.transform.Find("Minimap/TerrainFrame/Delivered contacts and personal route").GetComponent<TacticalMapMarks>();
        string ContactsText() => _uiRoot.transform.Find("TacticalMap/TacticalInformation/ContactsPage/DeliveredContacts/Viewport/Content").GetComponent<TMPro.TMP_Text>().text;
        void SetNextPaint(double value) => typeof(TacticalMapController).GetField("_nextPaint", BindingFlags.Instance | BindingFlags.NonPublic).SetValue(_controller, value);

        static ServerMsg.Snapshot Snapshot(uint tick, params WireActor[] actors)
            => new ServerMsg.Snapshot { Tick = tick, Phase = 1, Actors = actors };

        static Session NewSession(DeliveredTransport transport, byte id)
        {
            var session = new Session(transport, new SessionOptions { Url = "ws://localhost/ws", Profile = "fixture", Now = () => 1000 });
            session.Connect(); transport.Open();
            var matchId = new byte[16]; matchId[0] = id;
            transport.Deliver(new ServerMsg.Welcome { Protocol = Wire.ProtocolVersion, MatchId = matchId, Session = new byte[16],
                PlayerId = 1, TickRate = 20, Map = new MapBlob(4, 4, new byte[16]) });
            return session;
        }

        [Test]
        public void ReplacingDeliveredMembershipRemovesHiddenContactsImmediately()
        {
            var marks = _root.AddComponent<TacticalMapMarks>(); marks.SetMap(_session.Map);
            _transport.Deliver(new ServerMsg.Snapshot { Tick = 1, Phase = 1, Actors = new[] { new WireActor { Id = 2, X = 48, Y = 48, HpPct = 100, Status = 1 } } });
            marks.Present(_session, Array.Empty<RoutePoint>()); Assert.AreEqual(1, marks.ContactCount);
            _transport.Deliver(new ServerMsg.Snapshot { Tick = 2, Phase = 1, Actors = Array.Empty<WireActor>() });
            marks.Present(_session, Array.Empty<RoutePoint>()); Assert.AreEqual(0, marks.ContactCount);
        }

        [Test]
        public void DisconnectClearsMapContactsAndCannotRetainAHiddenGhost()
        {
            var marks = _root.AddComponent<TacticalMapMarks>(); marks.SetMap(_session.Map);
            _transport.Deliver(new ServerMsg.Snapshot { Tick = 1, Phase = 1, Actors = new[] { new WireActor { Id = 2, X = 48, Y = 48, HpPct = 100, Status = 1 } } });
            marks.Present(_session, null); Assert.AreEqual(1, marks.ContactCount);
            _transport.Drop(); marks.Present(_session, null); Assert.AreEqual(0, marks.ContactCount);
        }

        [Test]
        public void PointerProjectionUsesPublicMapDimensionsAndDownwardServerY()
        {
            var rect = (RectTransform)_root.transform; rect.sizeDelta = new Vector2(400, 200); rect.position = new Vector3(200, 100, 0);
            var surface = _root.AddComponent<TacticalMapSurface>(); surface.Initialize(); surface.SetMap(new MapBlob(4, 2, new byte[8]));
            var data = new PointerEventData(null) { position = new Vector2(100, 150) };
            Assert.IsTrue(surface.PointerWorld(data, out var point));
            Assert.That(point.x, Is.EqualTo(32).Within(.01)); Assert.That(point.y, Is.EqualTo(16).Within(.01));
        }

        [Test]
        public void MapPhaseIsOwnedAndDoesNotRewindWithStaleSnapshot()
        {
            Assert.IsNull(_session.Phase);
            _transport.Deliver(new ServerMsg.Snapshot { Tick = 2, Phase = 1 }); Assert.AreEqual(MatchPhase.Active, _session.Phase);
            _transport.Deliver(new ServerMsg.Snapshot { Tick = 1, Phase = 0 }); Assert.AreEqual(MatchPhase.Active, _session.Phase);
        }

        sealed class DeliveredTransport : ITransport
        {
            public event Action Opened;
            public event Action<byte[]> Received;
            public event Action<string> Closed;
            public void Open() => Opened?.Invoke();
            public void Deliver(ServerMsg msg) => Received?.Invoke(msg.Encode());
            public void Drop() => Closed?.Invoke("test disconnect");
            public void Connect(string url) { }
            public void Send(byte[] frame) { }
            public void Close() { }
            public void Poll() { }
        }
    }
}

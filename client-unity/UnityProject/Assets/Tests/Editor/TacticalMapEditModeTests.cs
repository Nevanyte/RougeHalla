using System;
using System.Collections.Generic;
using NUnit.Framework;
using Roguehalla.Net;
using Roguehalla.Net.Protocol;
using Roguehalla.Net.Ui;
using UnityEngine;
using UnityEngine.EventSystems;

namespace Roguehalla.Client.Tests
{
    public sealed class TacticalMapEditModeTests
    {
        GameObject _root;
        Session _session;
        DeliveredTransport _transport;
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
        [TearDown] public void TearDown() { _session.Leave(); UnityEngine.Object.DestroyImmediate(_root); }

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

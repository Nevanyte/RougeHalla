using System;
using System.Collections.Generic;
using NUnit.Framework;
using Roguehalla.Net.Protocol;

namespace Roguehalla.Net.Tests
{
    public class SessionTests
    {
        double _now;
        FakeTransport _t;
        Session _s;
        static readonly byte[] Token = Enumerable16(0xAB);
        static byte[] Enumerable16(byte v) { var b = new byte[16]; for (int i = 0; i < 16; i++) b[i] = v; return b; }

        [SetUp]
        public void Setup()
        {
            _now = 1000; _t = new FakeTransport();
            _s = new Session(_t, new SessionOptions { Url = "ws://x/ws", Profile = "p", Token = "tok", Faction = 2, Now = () => _now, ReconnectBaseMs = 500, MaxReconnectAttempts = 3 });
        }

        static ServerMsg.Welcome Welcome()
        {
            var tiles = new byte[16]; // 4x4 floor
            return new ServerMsg.Welcome { Protocol = 1, MatchId = Enumerable16(1), PlayerId = 3, Session = Token, TickRate = 20, Tick = 1, ServerMs = 50, Map = new MapBlob(4, 4, tiles) };
        }

        void ToMatch() { _s.Connect(); _t.Open(); _t.Deliver(Welcome()); }

        [Test]
        public void HandshakeSendsHelloThenWelcomeStartsTheMatch()
        {
            var states = new List<SessionState>();
            _s.StateChanged += st => states.Add(st);
            _s.Connect();
            Assert.AreEqual(SessionState.Connecting, _s.State); Assert.AreEqual("ws://x/ws", _t.Url);
            _t.Open();
            Assert.AreEqual(SessionState.HelloSent, _s.State);
            var h = _t.LastSent<ClientMsg.Hello>();
            Assert.AreEqual(1, h.Protocol); Assert.AreEqual("p", h.Profile); Assert.AreEqual("tok", h.Token); Assert.AreEqual((byte)2, h.Faction); Assert.IsNull(h.Resume);
            _t.Deliver(Welcome());
            CollectionAssert.AreEqual(new[] { SessionState.Connecting, SessionState.HelloSent, SessionState.InMatch }, states);
            Assert.AreEqual(3u, _s.PlayerId); Assert.IsNotNull(_s.Motion); CollectionAssert.AreEqual(Token, _s.SessionToken);
        }

        [Test]
        public void UpdatePingsOncePerIntervalAndPongFeedsTheClockSync()
        {
            ToMatch();
            int sent = _t.Sent.Count;
            _s.Update();
            var ping = _t.LastSent<ClientMsg.Ping>();
            Assert.AreEqual(sent + 1, _t.Sent.Count);
            _s.Update(); Assert.AreEqual(sent + 1, _t.Sent.Count, "not again within the interval");
            _now += 40;
            _t.Deliver(new ServerMsg.Pong { Nonce = ping.Nonce, ClientMs = ping.ClientMs, ServerMs = 5000 });
            Assert.AreEqual(40, _s.Sync.RttMs, 1e-9);
            _now += 1000; _s.Update();
            Assert.AreNotEqual(ping.Nonce, _t.LastSent<ClientMsg.Ping>().Nonce);
        }

        [Test]
        public void RejectEndsTheSessionWithItsCode()
        {
            _s.Connect(); _t.Open();
            _t.Deliver(new ServerMsg.Reject { Code = RejectCode.ContentMismatch, Reason = "server content 99" });
            Assert.AreEqual(SessionState.Rejected, _s.State);
            Assert.AreEqual(RejectCode.ContentMismatch, _s.RejectCode); Assert.AreEqual("server content 99", _s.RejectReason);
            Assert.IsTrue(_t.CloseCalled);
            _t.Drop(); Assert.AreEqual(SessionState.Rejected, _s.State, "a close after a reject does not reconnect");
        }

        [Test]
        public void TooSlowInAMatchResumesTheSeatInsteadOfEnding()
        {
            ToMatch();
            _t.Deliver(new ServerMsg.Reject { Code = RejectCode.TooSlow, Reason = "closed" });
            Assert.AreEqual(SessionState.Reconnecting, _s.State);
            _now += 500; _s.Update(); _t.Open();
            CollectionAssert.AreEqual(Token, _t.LastSent<ClientMsg.Hello>().Resume);
            _t.Deliver(Welcome());
            Assert.AreEqual(SessionState.InMatch, _s.State);
        }

        [Test]
        public void ClosedBeforeWelcomeFails()
        {
            _s.Connect(); _t.Open(); _t.Drop("refused");
            Assert.AreEqual(SessionState.Failed, _s.State); StringAssert.Contains("refused", _s.Error);
        }

        [Test]
        public void DropInMatchReconnectsWithBackoffAndTheResumeToken()
        {
            ToMatch();
            _t.Drop();
            Assert.AreEqual(SessionState.Reconnecting, _s.State);
            int connects = _t.Connects;
            _s.Update(); Assert.AreEqual(connects, _t.Connects, "waits for the backoff");
            _now += 500; _s.Update(); Assert.AreEqual(connects + 1, _t.Connects);
            _t.Open();
            Assert.AreEqual(SessionState.HelloSent, _s.State);
            var h = _t.LastSent<ClientMsg.Hello>();
            CollectionAssert.AreEqual(Token, h.Resume);
            _t.Deliver(Welcome());
            Assert.AreEqual(SessionState.InMatch, _s.State); Assert.AreEqual(0, _s.ReconnectAttempt);
        }

        [Test]
        public void FailedReconnectsBackOffExponentiallyThenGiveUp()
        {
            ToMatch();
            _t.Drop();
            double[] waits = { 500, 1000, 2000 };
            foreach (double w in waits)
            {
                int c = _t.Connects;
                _now += w - 1; _s.Update(); Assert.AreEqual(c, _t.Connects, "too early at " + w);
                _now += 1; _s.Update(); Assert.AreEqual(c + 1, _t.Connects);
                _t.Drop("still down");
            }
            Assert.AreEqual(SessionState.Failed, _s.State);
        }

        [Test]
        public void ReconnectRejectedAsNoSuchSessionIsFinal()
        {
            ToMatch(); _t.Drop(); _now += 500; _s.Update(); _t.Open();
            _t.Deliver(new ServerMsg.Reject { Code = RejectCode.NoSuchSession, Reason = "expired" });
            Assert.AreEqual(SessionState.Rejected, _s.State); Assert.AreEqual(RejectCode.NoSuchSession, _s.RejectCode);
        }

        [Test]
        public void SnapshotsFeedTheBufferClockAndPrediction()
        {
            ToMatch();
            _now = 2000;
            _t.Deliver(new ServerMsg.Snapshot { Tick = 2, ServerMs = 100, Me = new WireSelf { X = 40, Y = 40, Hp = 10 }, Actors = new[] { new WireActor { Id = 9, X = 1, Y = 2 } } });
            Assert.AreEqual(1, _s.Snapshots.Count); Assert.IsTrue(_s.Clock.Ready); Assert.IsTrue(_s.Motion.Initialized);
            Assert.AreEqual(40, _s.Motion.DrawnX, 1e-3);
            _s.OrderMove(100, 40); _s.Update();
            var inp = _t.LastSent<ClientMsg.Input>();
            Assert.AreEqual(CommandKind.Move, inp.Commands[0].Kind); Assert.AreEqual((byte)1, inp.Commands[0].Seq); Assert.IsTrue(_s.Motion.OrderPending);
        }

        [Test]
        public void MatchEndedEventsEndTheSessionAndKeepTheResult()
        {
            ToMatch();
            var e = new ServerMsg.Events { Tick = 9 };
            e.List.Add(new WireEvent { Kind = EventKind.MatchEnded, Winner = 3 });
            e.List.Add(new WireEvent { Kind = EventKind.Result, Result = new WireResult { Place = 1, Players = 2 } });
            ServerMsg.Events seen = null; _s.EventsReceived += x => seen = x;
            _t.Deliver(e);
            Assert.AreEqual(SessionState.Ended, _s.State); Assert.AreEqual(1, _s.LastResult.Place); Assert.IsNotNull(seen);
            _t.Drop(); Assert.AreEqual(SessionState.Ended, _s.State);
        }

        [Test]
        public void GarbageFromTheServerIsCountedNotFatal()
        {
            ToMatch();
            _t.Deliver(Welcome()); // a second Welcome mid-match is ignored
            Assert.AreEqual(SessionState.InMatch, _s.State); Assert.AreEqual(1, _s.Ignored);
            _t.DeliverRaw(new byte[] { 0x99, 1, 2 });
            Assert.AreEqual(1, _s.DecodeErrors); Assert.AreEqual(SessionState.InMatch, _s.State);
        }

        [Test]
        public void LeaveSendsLeaveAndEnds()
        {
            ToMatch(); _s.Leave();
            Assert.IsInstanceOf<ClientMsg.Leave>(ClientMsg.Decode(_t.Sent[_t.Sent.Count - 1]));
            Assert.AreEqual(SessionState.Ended, _s.State); Assert.IsTrue(_t.CloseCalled);
        }
    }
}

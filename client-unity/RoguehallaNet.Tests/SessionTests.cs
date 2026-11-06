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
            _s = new Session(_t, new SessionOptions { Url = "ws://x/ws", Profile = "p", Ticket = System.Text.Encoding.UTF8.GetBytes("tok"), Faction = 2, Now = () => _now, ReconnectBaseMs = 500, MaxReconnectAttempts = 3 });
        }

        static ServerMsg.Welcome Welcome()
        {
            var tiles = new byte[16]; // 4x4 floor
            return new ServerMsg.Welcome { Protocol = Wire.ProtocolVersion, MatchId = Enumerable16(1), PlayerId = 3, Session = Token, TickRate = 20, Tick = 1, ServerMs = 50, Map = new MapBlob(4, 4, tiles) };
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
            Assert.AreEqual(Wire.ProtocolVersion, h.Protocol); Assert.AreEqual("p", h.Profile); CollectionAssert.AreEqual(new byte[] { (byte)'t', (byte)'o', (byte)'k' }, h.Ticket); Assert.AreEqual((byte)2, h.Faction); Assert.IsNull(h.Resume);
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
        public void AnUnknownRejectCodeStillEndsTheSessionWithItsReason()
        {
            _s.Connect(); _t.Open();
            _t.Deliver(new ServerMsg.Reject { Code = (RejectCode)42, Reason = "update required" });
            Assert.AreEqual(SessionState.Rejected, _s.State);
            Assert.AreEqual((ushort)42, (ushort)_s.RejectCode.Value); Assert.AreEqual("update required", _s.RejectReason);
            Assert.AreEqual(0, _s.DecodeErrors);
            _t.Drop(); Assert.AreEqual(SessionState.Rejected, _s.State);
        }

        [Test]
        public void ATicketTooLongForTheWireFailsTheSessionInsteadOfBeingCut()
        {
            var s = new Session(_t, new SessionOptions { Url = "ws://x/ws", Profile = "p", Ticket = new byte[Wire.MaxTicket + 1], Now = () => _now });
            s.Connect(); _t.Open();
            Assert.AreEqual(SessionState.Failed, s.State);
            StringAssert.Contains("Hello", s.Error);
            Assert.AreEqual(0, _t.Sent.Count, "nothing was sent");
            Assert.IsTrue(_t.CloseCalled);
        }

        [Test]
        public void MeIsAnOwnedTypedCopyOfTheNewestAppliedSnapshot()
        {
            ToMatch();
            Assert.IsNull(_s.Me, "no snapshot yet");
            _t.Deliver(new ServerMsg.Snapshot { Tick = 1, Me = new WireSelf { Id = 3, Faction = 4, Weapon = 5, Status = 1, Hp = 50, MaxHp = 200, X = 7 } });
            var me = _s.Me;
            Assert.AreEqual(3u, me.Id); Assert.AreEqual(FactionId.Holy, me.Faction); Assert.AreEqual(WeaponId.Fists, me.Weapon);
            Assert.AreEqual(ActorStatus.Alive, me.Status); Assert.AreEqual(25, me.HpPct); Assert.AreEqual(7f, me.X);
            Assert.AreNotSame(_s.Latest.Me, me, "not the recycled wire object");
            // Run the 40-snapshot buffer over: the wire objects are recycled, the view stays valid and current.
            for (uint k = 2; k < 120; k++) _t.Deliver(new ServerMsg.Snapshot { Tick = k, Me = new WireSelf { Id = 3, X = k, MaxHp = 10, Hp = 10 } });
            Assert.AreSame(me, _s.Me); Assert.AreEqual(119f, _s.Me.X); Assert.AreEqual(100, _s.Me.HpPct);
            _t.Deliver(new ServerMsg.Snapshot { Tick = 120, Me = null });
            Assert.IsNull(_s.Me, "spectating: no self");
            // A stale (reordered) snapshot does not rewind it.
            _t.Deliver(new ServerMsg.Snapshot { Tick = 121, Me = new WireSelf { Id = 3, X = 500 } });
            _t.Deliver(new ServerMsg.Snapshot { Tick = 100, Me = new WireSelf { Id = 3, X = 1 } });
            Assert.AreEqual(500f, _s.Me.X);
            // A fresh Welcome (a resume after a drop) clears it until the next snapshot.
            _t.Drop(); _now += 500; _s.Update(); _t.Open(); _t.Deliver(Welcome());
            Assert.AreEqual(SessionState.InMatch, _s.State);
            Assert.IsNull(_s.Me);
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
        public void AResultResentAfterAResumeWelcomeIsKeptAndTheReservedStateIsHarmless()
        {
            ToMatch();
            _t.Drop(); _now += 500; _s.Update(); _t.Open();
            _t.Deliver(Welcome());
            // The server keeps the resolved run on the seat and queues it behind the resumed Welcome (protocol v4).
            var ev = new ServerMsg.Events { Tick = 9 };
            ev.List.Add(new WireEvent { Kind = EventKind.Result, Result = new WireResult { Outcome = 2, Place = 2, Players = 2 } });
            _t.Deliver(ev);
            Assert.IsNotNull(_s.LastResult); Assert.AreEqual(2, _s.LastResult.Place);
            // A State frame is accepted and changes nothing (no key exists in v4).
            _t.Deliver(new ServerMsg.State { Tick = 9 });
            Assert.AreEqual(SessionState.InMatch, _s.State); Assert.AreEqual(0, _s.DecodeErrors);
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

        // ---- snapshot deltas (protocol v3) ----

        static ServerMsg.Snapshot FullSnap(uint tick, float x, params WireActor[] a)
        {
            return new ServerMsg.Snapshot { Tick = tick, Me = new WireSelf { Id = 3, X = x, Y = 40, Hp = 10, MaxHp = 10 }, Actors = a };
        }

        static WireActor Actor(uint id, float x) { return new WireActor { Id = id, X = x, Y = 8, HpPct = 100, Status = 1 }; }

        /// <summary>A delta of tick+1 against `baseTick` that moves the self's x and actor 9's x (in grid units).</summary>
        static ServerMsg.SnapshotDelta Delta(uint tick, uint baseTick, float selfX, ushort actorX)
        {
            var d = new ServerMsg.SnapshotDelta { Tick = tick, BaseTick = baseTick, HasSelf = true, ChangedCount = 1 };
            d.Me = new SelfDelta { Mask = SelfDelta.FX, X = selfX };
            d.Changed[0] = new ActorDelta { Id = 9, Mask = ActorDelta.MX, X = actorX, Status = 1 };
            return d;
        }

        static ServerMsg.SnapshotDelta DeltaWithoutSelfPositionChange(uint tick, uint baseTick)
        {
            return new ServerMsg.SnapshotDelta { Tick = tick, BaseTick = baseTick, HasSelf = true, Me = new SelfDelta { Mask = 0 } };
        }

        int Resyncs() { int n = 0; foreach (var f in _t.Sent) if (f.Length == 1 && f[0] == 5) n++; return n; }

        [Test]
        public void ADeltaIsAppliedToTheHeldSnapshotAndReachesTheBufferAsAFullOne()
        {
            ToMatch();
            _t.Deliver(FullSnap(2, 40, Actor(9, 1), Actor(11, 2)));
            _t.Deliver(Delta(3, 2, 41, 80)); // actor 9 to x = 10
            Assert.AreEqual(2, _s.Snapshots.Count);
            var s = _s.Latest;
            Assert.AreEqual(3u, s.Tick); Assert.AreEqual(41f, s.Me.X); Assert.AreEqual(40f, s.Me.Y, "unchanged self fields are kept");
            Assert.AreEqual(2, s.Actors.Length); Assert.AreEqual(10f, s.Actors[0].X); Assert.AreEqual(2f, s.Actors[1].X);
            Assert.AreEqual(0, _s.DeltasRefused); Assert.AreEqual(0, Resyncs());
            Assert.AreEqual(2, _s.SnapshotsReceived);
        }

        [Test]
        public void ARefusedDeltaAsksForAFullSnapshotOnceIgnoresDeltasUntilItArrivesAndNeverDisconnects()
        {
            ToMatch();
            _t.Deliver(FullSnap(2, 40, Actor(9, 1)));
            _t.Deliver(Delta(5, 4, 50, 8)); // the base (tick 4) was never received
            Assert.AreEqual(SessionState.InMatch, _s.State); Assert.IsFalse(_t.CloseCalled);
            Assert.AreEqual(1, _s.DeltasRefused); Assert.AreEqual(1, Resyncs()); Assert.IsNotNull(_s.Error);
            Assert.AreEqual(1, _s.Snapshots.Count, "the snapshot held is untouched");
            _t.Deliver(Delta(6, 5, 51, 8));
            _t.Deliver(Delta(7, 6, 52, 8));
            Assert.AreEqual(3, _s.DeltasRefused); Assert.AreEqual(1, Resyncs(), "one request per burst");
            _t.Deliver(FullSnap(8, 60, Actor(9, 3)));
            Assert.AreEqual(2, _s.Snapshots.Count); Assert.AreEqual(8u, _s.Latest.Tick);
            _t.Deliver(Delta(9, 8, 61, 8));
            Assert.AreEqual(3, _s.Snapshots.Count); Assert.AreEqual(61f, _s.Latest.Me.X);
            Assert.AreEqual(3, _s.DeltasRefused); Assert.AreEqual(1, Resyncs());
            // A second burst asks again.
            _t.Deliver(Delta(12, 11, 70, 8));
            Assert.AreEqual(2, Resyncs());
        }

        [Test]
        public void TwoRefusalsCloseTogetherEachAskAndTheFullFrameThatEndsThemRestoresTheTracker()
        {
            // The server answers a Resync with a Full frame, but never earlier than 20 ticks after its previous forced one: the
            // second request waits. The client asks once per burst and must be able to rely on that answer.
            ToMatch();
            _t.Deliver(FullSnap(2, 40, Actor(9, 1)));
            _t.Deliver(Delta(5, 4, 50, 8)); // refusal 1
            Assert.AreEqual(1, Resyncs());
            _t.Deliver(FullSnap(6, 41, Actor(9, 1))); // the answer
            _t.Deliver(Delta(8, 7, 51, 8)); // refusal 2, right after
            Assert.AreEqual(2, _s.DeltasRefused); Assert.AreEqual(2, Resyncs(), "a new burst asks again");
            _t.Deliver(Delta(9, 8, 52, 8)); // deltas the server sends while it defers the request
            _t.Deliver(Delta(10, 9, 53, 8));
            Assert.AreEqual(4, _s.DeltasRefused); Assert.AreEqual(2, Resyncs(), "and only once");
            Assert.AreEqual(2, _s.Snapshots.Count, "nothing applied meanwhile");
            _t.Deliver(FullSnap(26, 60, Actor(9, 3))); // the deferred answer
            _t.Deliver(Delta(27, 26, 61, 8));
            Assert.AreEqual(4, _s.Snapshots.Count); Assert.AreEqual(61f, _s.Latest.Me.X);
            Assert.AreEqual(4, _s.DeltasRefused); Assert.AreEqual(2, Resyncs());
        }

        [Test]
        public void AResyncLeftUnansweredIsSentAgainAfterTheRetryIntervalAndOnlyThen()
        {
            // Defence in depth: the server never drops a Resync, but if the request or its answer is lost the client is not left
            // refusing deltas for good. It asks again with the first refused delta ResyncRetryMs (2 s) after its last request.
            ToMatch();
            _t.Deliver(FullSnap(2, 40, Actor(9, 1)));
            _t.Deliver(Delta(5, 4, 50, 8));
            Assert.AreEqual(1, Resyncs());
            _now += 1999;
            _t.Deliver(Delta(6, 5, 51, 8));
            Assert.AreEqual(1, Resyncs(), "not before the interval");
            _now += 1;
            _t.Deliver(Delta(7, 6, 52, 8));
            Assert.AreEqual(2, Resyncs(), "asked again");
            _t.Deliver(Delta(8, 7, 53, 8));
            Assert.AreEqual(2, Resyncs(), "once per interval");
            _t.Deliver(FullSnap(9, 60, Actor(9, 3)));
            _t.Deliver(Delta(10, 9, 61, 8));
            Assert.AreEqual(61f, _s.Latest.Me.X); Assert.AreEqual(4, _s.DeltasRefused); Assert.AreEqual(2, Resyncs());
        }

        [Test]
        public void AMalformedDeltaIsRefusedNotFatal()
        {
            ToMatch();
            _t.Deliver(FullSnap(2, 40, Actor(9, 1)));
            _t.DeliverRaw(new byte[] { 0x87, 10, 0, 0, 0, 0, 0 }); // base age 0
            Assert.AreEqual(SessionState.InMatch, _s.State); Assert.AreEqual(1, _s.DeltasRefused); Assert.AreEqual(1, Resyncs());
            Assert.AreEqual(0, _s.DecodeErrors, "a delta that cannot be read is a refused delta");
        }

        [Test]
        public void AResumeStartsFromANewWelcomeSoTheFirstSnapshotMustBeFull()
        {
            ToMatch();
            _t.Deliver(FullSnap(2, 40, Actor(9, 1)));
            _t.Drop();
            _now += 600; _s.Update(); _t.Open();
            _t.Deliver(Welcome());
            _t.Deliver(Delta(3, 2, 41, 8)); // the old connection's base: the new decoder holds nothing
            Assert.AreEqual(1, _s.DeltasRefused); Assert.AreEqual(1, Resyncs());
            _t.Deliver(FullSnap(4, 42, Actor(9, 1)));
            _t.Deliver(Delta(5, 4, 43, 8));
            Assert.AreEqual(43f, _s.Latest.Me.X);
        }

        [Test]
        public void SnapshotsFeedTheBufferClockAndPresentConfirmedSelfPosition()
        {
            ToMatch();
            _now = 2000;
            _t.Deliver(new ServerMsg.Snapshot { Tick = 2, Me = new WireSelf { X = 40, Y = 40, Hp = 10 }, Actors = new[] { new WireActor { Id = 9, X = 1, Y = 2 } } });
            Assert.AreEqual(1, _s.Snapshots.Count); Assert.IsTrue(_s.Clock.Ready); Assert.IsTrue(_s.Motion.Initialized);
            Assert.AreEqual(40, _s.Motion.DrawnX, 1e-3);
            _s.OrderMove(100, 40); _s.Update();
            var inp = _t.LastSent<ClientMsg.Input>();
            Assert.AreEqual(CommandKind.Move, inp.Commands[0].Kind); Assert.AreEqual((byte)1, inp.Commands[0].Seq); Assert.IsTrue(_s.Motion.OrderPending);
            Assert.AreEqual(40, _s.Motion.DrawnX, 1e-3, "sending an order and advancing frames do not predict movement");
            _now += 50;
            _t.Deliver(new ServerMsg.Snapshot { Tick = 3, Me = new WireSelf { Id = 3, X = 47, Y = 41, Hp = 10, MoveSeq = 0 } });
            Assert.AreEqual(47, _s.Motion.DrawnX, 1e-3, "new server position is shown even before the order is acknowledged");
            Assert.IsTrue(_s.Motion.OrderPending);
        }

        [Test]
        public void OlderAndDuplicateSnapshotsCannotRewindPresentedSelf()
        {
            ToMatch();
            _t.Deliver(new ServerMsg.Snapshot { Tick = 2, Me = new WireSelf { Id = 3, X = 40, Hp = 10 } });
            _t.Deliver(new ServerMsg.Snapshot { Tick = 3, Me = new WireSelf { Id = 3, X = 55, Hp = 10 } });
            _t.Deliver(new ServerMsg.Snapshot { Tick = 3, Me = new WireSelf { Id = 3, X = 20, Hp = 10 } });
            _t.Deliver(new ServerMsg.Snapshot { Tick = 1, Me = new WireSelf { Id = 3, X = 10, Hp = 10 } });
            Assert.AreEqual(55, _s.Motion.DrawnX, 1e-3);
            Assert.AreEqual(55, _s.Me.X, 1e-3);
        }

        [Test]
        public void StaleFullSnapshotsDoNotPoisonDeltaBaseOrAcceptedSnapshotNotifications()
        {
            ToMatch();
            int notified = 0;
            _s.SnapshotReceived += _ => notified++;
            _t.Deliver(FullSnap(3, 55));
            _t.Deliver(FullSnap(3, 20)); // duplicate tick
            _t.Deliver(DeltaWithoutSelfPositionChange(4, 3));
            Assert.AreEqual(55, _s.Me.X, 1e-3);
            Assert.AreEqual(55, _s.Latest.Me.X, 1e-3);
            Assert.AreEqual(2, notified, "only accepted full and delta snapshots are published");

            _t.Deliver(FullSnap(2, 10)); // older tick must not replace tick 4 as the delta base
            _t.Deliver(DeltaWithoutSelfPositionChange(5, 4));
            Assert.AreEqual(55, _s.Me.X, 1e-3);
            Assert.AreEqual(55, _s.Latest.Me.X, 1e-3);
            Assert.AreEqual(3, notified);
            Assert.AreEqual(5, _s.SnapshotsReceived, "counts all successfully decoded snapshot frames, including stale full frames");
        }

        [Test]
        public void RequestedFullAtCurrentTickRepairsTheBaseWithoutAddingAnInterpolationSample()
        {
            ToMatch();
            int notified = 0;
            _s.SnapshotReceived += _ => notified++;
            _t.Deliver(FullSnap(2, 30));
            _t.Deliver(FullSnap(3, 55));
            _t.Deliver(DeltaWithoutSelfPositionChange(4, 2)); // wrong base, request a full snapshot
            Assert.AreEqual(1, _s.ResyncsSent);

            _t.Deliver(FullSnap(2, 10)); // too old even while waiting
            byte[] damaged = FullSnap(3, 99).Encode();
            Array.Resize(ref damaged, damaged.Length - 1);
            _t.DeliverRaw(damaged);
            Assert.AreEqual(1, _s.DecodeErrors);
            Assert.AreEqual(55, _s.Motion.DrawnX);
            Assert.AreEqual(2, notified);

            _t.Deliver(FullSnap(3, 77, Actor(9, 8))); // corrected self and previously missing actor
            Assert.AreEqual(2, _s.Snapshots.Count);
            Assert.AreEqual(2 * Wire.TickMs, _s.Snapshots.OldestMs);
            Assert.AreSame(_s.Snapshots.Newest, _s.Latest);
            Assert.AreEqual(77, _s.Me.X);
            Assert.AreEqual(77, _s.Motion.DrawnX);
            Assert.AreEqual(3, notified);

            _t.Deliver(FullSnap(3, 22)); // unsolicited equal tick is again a duplicate
            var next = DeltaWithoutSelfPositionChange(4, 3);
            next.ChangedCount = 1;
            next.Changed[0] = new ActorDelta { Id = 9, Mask = ActorDelta.MX, X = 16 };
            _t.Deliver(next);
            _t.Deliver(DeltaWithoutSelfPositionChange(5, 4));
            Assert.AreEqual(5u, _s.Latest.Tick);
            Assert.AreEqual(77, _s.Me.X);
            Assert.AreEqual(2, _s.Latest.Actors[0].X);
            Assert.AreEqual(1, _s.DeltasRefused);
            Assert.AreEqual(5, notified);
            Assert.AreEqual(7, _s.SnapshotsReceived, "includes both discarded full frames, omits malformed frames");
            _t.Deliver(DeltaWithoutSelfPositionChange(7, 6)); // a separate incident can immediately request recovery
            Assert.AreEqual(2, _s.ResyncsSent);
        }

        [Test]
        public void AcceptedSelfAbsenceClearsPresentationAndFreshWelcomeResetsIt()
        {
            ToMatch();
            _t.Deliver(new ServerMsg.Snapshot { Tick = 2, Me = new WireSelf { Id = 3, X = 40, Hp = 10 } });
            _s.OrderMove(100, 40);
            Assert.IsTrue(_s.Motion.OrderPending);
            _t.Deliver(new ServerMsg.Snapshot { Tick = 3, Me = null });
            Assert.IsFalse(_s.Motion.Initialized);
            Assert.IsFalse(_s.Motion.OrderPending);

            _t.Drop(); _now += 500; _s.Update(); _t.Open(); _t.Deliver(Welcome());
            Assert.IsFalse(_s.Motion.Initialized, "a fresh Welcome starts without a presented self position");
            Assert.IsNull(_s.Latest, "a fresh Welcome clears the previously accepted snapshot");
            _t.Deliver(new ServerMsg.Snapshot { Tick = 1, Me = new WireSelf { Id = 3, X = 12, Hp = 10 } });
            Assert.AreEqual(12, _s.Motion.DrawnX, 1e-3);
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

        [Test]
        public void ServerEndedMatchStillSendsLeaveToReleaseItsSeatExactlyOnce()
        {
            ToMatch();
            var ended = new ServerMsg.Events { Tick = 9 };
            ended.List.Add(new WireEvent { Kind = EventKind.MatchEnded, Winner = 3 });
            _t.Deliver(ended);
            Assert.AreEqual(SessionState.Ended, _s.State);
            int before = _t.Sent.Count;
            _s.Leave();
            Assert.AreEqual(before + 1, _t.Sent.Count);
            Assert.IsInstanceOf<ClientMsg.Leave>(ClientMsg.Decode(_t.Sent[_t.Sent.Count - 1]));
            Assert.IsTrue(_t.CloseCalled);
            _s.Leave();
            Assert.AreEqual(before + 1, _t.Sent.Count);
        }
    }
}

using System;
using System.Collections.Generic;
using System.Linq;
using NUnit.Framework;
using Roguehalla.Net.Protocol;

namespace Roguehalla.Net.Tests
{
    public sealed class SeatResumeTests
    {
        // Synthetic protocol fixtures only. No credentials, persistence, endpoint selection or server authority are inferred.
        static byte[] Bytes(byte first) => Enumerable.Range(0, 16).Select(i => (byte)(first + i)).ToArray();
        static byte[] Capability() => Bytes(17);
        static byte[] MatchId() => Bytes(67);
        static SeatResume Seed() => new SeatResume(Capability(), MatchId(), 3);
        static ServerMsg.Welcome Welcome() => new ServerMsg.Welcome {
            Protocol = Wire.ProtocolVersion, MatchId = MatchId(), PlayerId = 3, Session = Capability(),
            TickRate = 20, Tick = 1, ServerMs = 50, Map = new MapBlob(4, 4, new byte[16]) };
        static ServerMsg.Events Result()
        {
            var events = new ServerMsg.Events { Tick = 5 };
            events.List.Add(new WireEvent { Kind = EventKind.Result, Result = new WireResult { Outcome = 2, Place = 2, Players = 2 } });
            return events;
        }

        sealed class Transport : ITransport
        {
            public event Action Opened;
            public event Action<byte[]> Received;
            public event Action<string> Closed;
            public readonly List<byte[]> Sent = new List<byte[]>();
            public readonly Queue<Action> Queue = new Queue<Action>();
            public Action OnClose;
            public int Connects, Closes, Polls;
            public string Url;
            public int Subscribers => (Opened?.GetInvocationList().Length ?? 0) +
                (Received?.GetInvocationList().Length ?? 0) + (Closed?.GetInvocationList().Length ?? 0);
            public void Connect(string url) { Connects++; Url = url; }
            public void Send(byte[] frame) { Sent.Add(frame); }
            public void Close() { Closes++; OnClose?.Invoke(); }
            public void Poll() { Polls++; while (Queue.Count > 0) Queue.Dequeue()(); }
            public void Open() => Opened?.Invoke();
            public void Deliver(ServerMsg message) => Received?.Invoke(message.Encode());
            public void Drop() => Closed?.Invoke("synthetic drop");
            public (Action Open, Action<byte[]> Receive, Action<string> Close) Capture() => (Opened, Received, Closed);
            public ClientMsg[] Messages => Sent.Select(ClientMsg.Decode).ToArray();
        }

        sealed class Fixture
        {
            public readonly Transport Wire = new Transport();
            public readonly Session Client;
            public double Now;
            public Fixture(SeatResume seed = null)
            {
                Client = new Session(Wire, new SessionOptions {
                    Url = "wss://resume.example/arena/ws", Profile = "synthetic-owner", InitialResume = seed,
                    ContentHash = 1, Faction = 2, Now = () => Now, MaxReconnectAttempts = 2,
                    ReconnectBaseMs = 500, ReconnectMaxMs = 1000 });
            }
            public void Hello() { Client.Connect(); Wire.Open(); }
            public void Accept() { Hello(); Wire.Deliver(Welcome()); }
            public void Advance(double ms) { Now += ms; Client.Update(); }
        }

        [TestCase(0)] [TestCase(1)] [TestCase(15)] [TestCase(17)] [TestCase(32)]
        public void SeedRequiresExactlySixteenCapabilityAndRawMatchBytes(int length)
        {
            Assert.Throws<ArgumentException>(() => new SeatResume(new byte[length], MatchId(), 3));
            Assert.Throws<ArgumentException>(() => new SeatResume(Capability(), new byte[length], 3));
        }

        [Test]
        public void SeedRejectsNullArraysAndZeroPlayerBeforeAnyTransportExists()
        {
            Assert.Throws<ArgumentNullException>(() => new SeatResume(null, MatchId(), 3));
            Assert.Throws<ArgumentNullException>(() => new SeatResume(Capability(), null, 3));
            Assert.Throws<ArgumentOutOfRangeException>(() => new SeatResume(Capability(), MatchId(), 0));
        }

        [Test]
        public void SeedCopiesItsSourcesAndSessionCapturesTheImmutableSeedBeforeOptionsChange()
        {
            var capability = Capability(); var match = MatchId();
            var seed = new SeatResume(capability, match, 3);
            var wire = new Transport();
            var options = new SessionOptions { InitialResume = seed, Now = () => 0 };
            var client = new Session(wire, options);
            Array.Clear(capability, 0, capability.Length); Array.Clear(match, 0, match.Length);
            options.InitialResume = new SeatResume(Bytes(91), Bytes(121), 9);
            client.Connect(); wire.Open();
            Assert.That(wire.Messages.OfType<ClientMsg.Hello>().Single().Resume.SequenceEqual(Capability()), Is.True);
            Assert.That(client.Welcome, Is.Null); Assert.That(client.SessionToken, Is.Null);
            wire.Deliver(Welcome());
            Assert.That(client.State, Is.EqualTo(SessionState.InMatch));
            Assert.That(client.PlayerId, Is.EqualTo(3));
        }

        [Test]
        public void FreshInstanceUsesCapturedSeatOnItsFirstHelloAndNeedsNewConfirmedState()
        {
            var old = new Fixture(); old.Accept();
            var seed = new SeatResume(old.Client.SessionToken, old.Client.Welcome.MatchId, old.Client.PlayerId);
            old.Client.Detach();
            var fresh = new Fixture(seed);
            var states = new List<SessionState>(); fresh.Client.StateChanged += states.Add;
            fresh.Client.Input.Move(8, 9);
            fresh.Hello(); fresh.Client.Update();
            Assert.That(fresh.Wire.Url, Is.EqualTo("wss://resume.example/arena/ws"));
            Assert.That(fresh.Wire.Messages.OfType<ClientMsg.Hello>().Single().Resume.SequenceEqual(old.Client.SessionToken), Is.True);
            Assert.That(fresh.Wire.Messages.OfType<ClientMsg.Input>(), Is.Empty);
            Assert.That(fresh.Client.Welcome, Is.Null); Assert.That(fresh.Client.Motion, Is.Null);
            Assert.That(fresh.Client.Latest, Is.Null); Assert.That(fresh.Client.LastResult, Is.Null);
            fresh.Wire.Deliver(Result());
            Assert.That(fresh.Client.LastResult, Is.Null, "pre-Welcome results cannot confirm an imported seat");
            fresh.Wire.Deliver(Welcome()); fresh.Client.FlushInput();
            CollectionAssert.AreEqual(new[] { SessionState.Connecting, SessionState.HelloSent, SessionState.InMatch }, states);
            Assert.That(fresh.Wire.Messages.OfType<ClientMsg.Input>(), Is.Empty, "queued pre-confirmation input was discarded");
            Assert.That(fresh.Client.Latest, Is.Null); Assert.That(fresh.Client.Me, Is.Null);
            Assert.That(fresh.Client.Collections.Arena, Is.Null);
            fresh.Client.Input.Move(11, 12); fresh.Client.FlushInput();
            Assert.That(fresh.Wire.Messages.OfType<ClientMsg.Input>().Count(), Is.EqualTo(1));
        }

        static IEnumerable<int> EveryMatchByte => Enumerable.Range(0, 16);
        [TestCaseSource(nameof(EveryMatchByte))]
        public void EveryRawMatchByteIsCheckedBeforeAnyWelcomeResultOrInputIsPublished(int changedByte)
        {
            var f = new Fixture(Seed()); int welcomes = 0, epochs = 0, events = 0;
            f.Client.StateChanged += state => { if (state == SessionState.InMatch) welcomes++; };
            f.Client.TimelineReset += () => epochs++;
            f.Client.EventsReceived += batch => events++;
            f.Hello(); f.Client.Input.Move(1, 2);
            var wrong = Welcome(); wrong.MatchId[changedByte] ^= 1;
            f.Wire.Deliver(wrong); f.Wire.Deliver(Result()); f.Wire.Deliver(Welcome());
            f.Client.Connect(); f.Client.FlushInput(); f.Advance(100000);
            Assert.That(f.Client.State, Is.EqualTo(SessionState.Failed));
            Assert.That(f.Client.Error, Is.EqualTo("resumed seat identity mismatch"));
            Assert.That(f.Client.Welcome, Is.Null); Assert.That(f.Client.SessionToken, Is.Null);
            Assert.That(f.Client.LastResult, Is.Null); Assert.That(f.Client.TimelineEpoch, Is.Zero);
            Assert.That(welcomes + epochs + events, Is.Zero);
            Assert.That(f.Wire.Connects, Is.EqualTo(1)); Assert.That(f.Wire.Closes, Is.EqualTo(1));
            Assert.That(f.Wire.Messages.Length, Is.EqualTo(1), "no Leave, input or fresh-join fallback");
        }

        [TestCase(0u)] [TestCase(4u)] [TestCase(uint.MaxValue)]
        public void ForeignDeliveredPlayerIsRejectedWithoutPublishingTheSeat(uint player)
        {
            var f = new Fixture(Seed()); f.Hello(); var wrong = Welcome(); wrong.PlayerId = player;
            f.Wire.Deliver(wrong); f.Wire.Deliver(Result()); f.Client.Update();
            Assert.That(f.Client.State, Is.EqualTo(SessionState.Failed));
            Assert.That(f.Client.PlayerId, Is.Zero); Assert.That(f.Client.LastResult, Is.Null);
            Assert.That(f.Wire.Messages.Length, Is.EqualTo(1));
        }

        [Test]
        public void GenuineDecodedResultIsAcceptedOnlyAfterMatchingIdentityAndIsNotReconstructedFromTheSeed()
        {
            var f = new Fixture(Seed()); int batches = 0;
            f.Client.EventsReceived += batch => batches++;
            f.Hello(); f.Wire.Deliver(Result()); Assert.That(f.Client.LastResult, Is.Null);
            f.Wire.Deliver(Welcome()); Assert.That(f.Client.LastResult, Is.Null);
            f.Wire.Deliver(new ServerMsg.State { Tick = 5 }); f.Wire.Deliver(Result());
            Assert.That(f.Client.LastResult, Is.Not.Null); Assert.That(f.Client.LastResult.Place, Is.EqualTo(2));
            Assert.That(f.Client.LastResult.Outcome, Is.EqualTo(2)); Assert.That(batches, Is.EqualTo(1));
            Assert.That(f.Client.DecodeErrors, Is.Zero);
        }

        [Test]
        public void StaleCapabilityRejectIsTerminalEvenWhenItsStateSubscriberTriesToReconnect()
        {
            var f = new Fixture(Seed()); f.Hello();
            f.Client.StateChanged += state => { if (state == SessionState.Rejected) f.Client.Connect(); };
            f.Wire.Deliver(new ServerMsg.Reject { Code = RejectCode.NoSuchSession, Reason = "synthetic expired seat" });
            f.Wire.Drop(); f.Wire.Deliver(Welcome()); f.Wire.Deliver(Result()); f.Advance(100000); f.Client.Connect();
            Assert.That(f.Client.State, Is.EqualTo(SessionState.Rejected));
            Assert.That(f.Client.RejectCode, Is.EqualTo(RejectCode.NoSuchSession));
            Assert.That(f.Client.Welcome, Is.Null); Assert.That(f.Client.LastResult, Is.Null);
            Assert.That(f.Wire.Connects, Is.EqualTo(1)); Assert.That(f.Wire.Messages.Length, Is.EqualTo(1));
        }

        [Test]
        public void InitialNetworkFailureUsesTheSameCapabilityWithExistingBoundedBackoffAndNeverFreshJoins()
        {
            var f = new Fixture(Seed()); f.Hello(); f.Wire.Drop();
            f.Advance(499); Assert.That(f.Wire.Connects, Is.EqualTo(1));
            f.Advance(1); f.Wire.Open(); f.Wire.Drop();
            f.Advance(999); Assert.That(f.Wire.Connects, Is.EqualTo(2));
            f.Advance(1); f.Wire.Open(); f.Wire.Drop();
            Assert.That(f.Client.State, Is.EqualTo(SessionState.Failed));
            f.Advance(100000); f.Client.Connect();
            Assert.That(f.Wire.Connects, Is.EqualTo(3));
            Assert.That(f.Wire.Messages.OfType<ClientMsg.Hello>().All(h => h.Resume.SequenceEqual(Capability())), Is.True);
            Assert.That(f.Wire.Messages.OfType<ClientMsg.Leave>(), Is.Empty);
        }

        [Test]
        public void SuccessfulInitialResumeKeepsExistingSameInstanceReconnectAndRechecksExpectedIdentity()
        {
            var f = new Fixture(Seed()); f.Hello(); var accepted = Welcome(); accepted.Session = Bytes(101);
            f.Wire.Deliver(accepted); f.Client.Input.Move(1, 2); f.Wire.Drop();
            f.Advance(500); f.Wire.Open();
            Assert.That(f.Wire.Messages.OfType<ClientMsg.Hello>().Last().Resume.SequenceEqual(Bytes(101)), Is.True);
            var foreign = Welcome(); foreign.MatchId[15] ^= 1; f.Wire.Deliver(foreign);
            Assert.That(f.Client.State, Is.EqualTo(SessionState.Failed));
            Assert.That(f.Client.Welcome.MatchId.SequenceEqual(MatchId()), Is.True, "foreign Welcome was never published");
            Assert.That(f.Wire.Messages.OfType<ClientMsg.Input>(), Is.Empty);
        }

        [Test]
        public void SeededExplicitLeaveStillSendsOneLeaveAndCannotBecomeAFreshAdmission()
        {
            var f = new Fixture(Seed()); f.Accept(); f.Client.Leave(); f.Client.Leave(); f.Client.Connect();
            Assert.That(f.Client.State, Is.EqualTo(SessionState.Ended));
            Assert.That(f.Wire.Messages.OfType<ClientMsg.Leave>().Count(), Is.EqualTo(1));
            Assert.That(f.Wire.Connects, Is.EqualTo(1));
        }

        [TestCase(false)] [TestCase(true)]
        public void DetachReleasesOnlyItsOwnTransportSubscriptionsAndAllCapturedCallbacksAreInert(bool retrying)
        {
            var f = new Fixture(Seed()); f.Accept();
            f.Wire.Deliver(new ServerMsg.Snapshot { Tick = 1, Me = new WireSelf { Id = 3, Status = 1, Hp = 10, MaxHp = 10 } });
            f.Wire.Deliver(Result());
            if (retrying) f.Wire.Drop();
            var before = (f.Client.Welcome, f.Client.Latest, f.Client.LastResult, f.Client.TimelineEpoch, f.Client.Ignored);
            var captured = f.Wire.Capture(); int foreign = 0, detached = 0, publicEvents = 0;
            f.Wire.Opened += () => foreign++; f.Wire.Received += frame => foreign++; f.Wire.Closed += why => foreign++;
            f.Client.StateChanged += state => { if (state == SessionState.Detached) detached++; };
            f.Client.EventsReceived += batch => publicEvents++;
            f.Client.Input.Move(4, 5); f.Client.Detach();
            Assert.That(f.Wire.Subscribers, Is.EqualTo(3), "only the unrelated transport handlers remain");
            Assert.That(f.Client.Input.Flush(f.Now), Is.Empty, "pending input cleared");
            int sent = f.Wire.Sent.Count, connects = f.Wire.Connects, polls = f.Wire.Polls;
            captured.Open(); captured.Receive(Welcome().Encode()); captured.Receive(Result().Encode()); captured.Close("late");
            f.Wire.Open(); f.Wire.Deliver(Result()); f.Wire.Drop();
            f.Client.Connect(); f.Client.Leave(); f.Client.Update(); f.Client.Poll(); f.Client.FlushInput(); f.Client.Detach();
            Assert.That(f.Client.OrderMove(1, 2), Is.Zero); Assert.That(f.Client.OrderStop(), Is.Zero);
            Assert.That(f.Client.Cast(0, 1, 2), Is.Zero);
            Assert.That(f.Client.State, Is.EqualTo(SessionState.Detached));
            Assert.That(f.Client.ReconnectAttempt, Is.Zero); Assert.That(detached, Is.EqualTo(1));
            Assert.That(f.Wire.Sent.Count, Is.EqualTo(sent)); Assert.That(f.Wire.Connects, Is.EqualTo(connects));
            Assert.That(f.Wire.Polls, Is.EqualTo(polls)); Assert.That(f.Wire.Closes, Is.EqualTo(1));
            Assert.That(f.Wire.Messages.OfType<ClientMsg.Leave>(), Is.Empty);
            Assert.That((f.Client.Welcome, f.Client.Latest, f.Client.LastResult, f.Client.TimelineEpoch, f.Client.Ignored), Is.EqualTo(before));
            Assert.That(publicEvents, Is.Zero); Assert.That(foreign, Is.EqualTo(3));
        }

        [Test]
        public void DetachSubscriberMayReenterAndThrowButTransportStillClosesExactlyOnce()
        {
            var f = new Fixture(Seed()); f.Accept(); var captured = f.Wire.Capture();
            int notifications = 0, sent = f.Wire.Sent.Count;
            var expected = new InvalidOperationException("declared detach subscriber failure");
            f.Client.StateChanged += state => {
                if (state != SessionState.Detached) return;
                notifications++; f.Client.Detach(); f.Client.Connect(); f.Client.Update(); f.Client.Poll();
                f.Client.FlushInput(); f.Client.Leave(); captured.Open(); captured.Receive(Result().Encode()); captured.Close("late");
                throw expected;
            };
            f.Wire.OnClose = () => { captured.Open(); captured.Receive(Welcome().Encode()); captured.Close("close callback"); };
            Assert.That(Assert.Throws<InvalidOperationException>(() => f.Client.Detach()), Is.SameAs(expected));
            f.Client.Detach(); f.Advance(100000);
            Assert.That(f.Client.State, Is.EqualTo(SessionState.Detached)); Assert.That(notifications, Is.EqualTo(1));
            Assert.That(f.Wire.Closes, Is.EqualTo(1)); Assert.That(f.Wire.Connects, Is.EqualTo(1));
            Assert.That(f.Wire.Subscribers, Is.Zero); Assert.That(f.Wire.Sent.Count, Is.EqualTo(sent));
            Assert.That(f.Client.LastResult, Is.Null);
        }

        [Test]
        public void DetachFromConnectingSubscriberPreventsThePendingConnectAfterNotification()
        {
            var f = new Fixture(Seed());
            f.Client.StateChanged += state => { if (state == SessionState.Connecting) f.Client.Detach(); };
            f.Client.Connect();
            Assert.That(f.Client.State, Is.EqualTo(SessionState.Detached));
            Assert.That(f.Wire.Connects, Is.Zero); Assert.That(f.Wire.Closes, Is.EqualTo(1));
            Assert.That(f.Wire.Subscribers, Is.Zero);
        }

        [Test]
        public void DetachDuringWelcomeResetStopsQueuedOldFramesAndPreventsInMatchPublication()
        {
            var f = new Fixture(Seed()); f.Hello(); var captured = f.Wire.Capture();
            var states = new List<SessionState>(); f.Client.StateChanged += states.Add;
            f.Client.TimelineReset += f.Client.Detach;
            f.Wire.Queue.Enqueue(() => captured.Receive(Welcome().Encode()));
            f.Wire.Queue.Enqueue(() => captured.Receive(Result().Encode()));
            f.Wire.Queue.Enqueue(() => captured.Close("queued old disconnect"));
            f.Client.Update();
            CollectionAssert.AreEqual(new[] { SessionState.Detached }, states);
            Assert.That(f.Client.LastResult, Is.Null); Assert.That(f.Wire.Closes, Is.EqualTo(1));
            Assert.That(f.Wire.Messages.Length, Is.EqualTo(1)); Assert.That(f.Wire.Subscribers, Is.Zero);
        }

        [Test]
        public void ReentrantDetachDoesNotDeliverAnObsoleteInMatchNotificationToLaterSubscribers()
        {
            var f = new Fixture(Seed()); var states = new List<SessionState>();
            f.Client.StateChanged += state => { if (state == SessionState.InMatch) f.Client.Detach(); };
            f.Client.StateChanged += states.Add;
            f.Accept();
            CollectionAssert.AreEqual(new[] { SessionState.Connecting, SessionState.HelloSent, SessionState.Detached }, states);
            Assert.That(f.Wire.Closes, Is.EqualTo(1)); Assert.That(f.Client.State, Is.EqualTo(SessionState.Detached));
        }

        [Test]
        public void DetachFromEndedSubscriberStopsLaterResultInThatSameReceivedBatch()
        {
            var f = new Fixture(Seed()); f.Accept(); int published = 0;
            f.Client.EventsReceived += batch => published++;
            f.Client.StateChanged += state => { if (state == SessionState.Ended) f.Client.Detach(); };
            var events = Result(); events.List.Insert(0, new WireEvent { Kind = EventKind.MatchEnded });
            f.Wire.Deliver(events);
            Assert.That(f.Client.State, Is.EqualTo(SessionState.Detached)); Assert.That(f.Client.LastResult, Is.Null);
            Assert.That(published, Is.Zero); Assert.That(f.Wire.Closes, Is.EqualTo(1));
            Assert.That(f.Wire.Messages.OfType<ClientMsg.Leave>(), Is.Empty);
        }
    }
}

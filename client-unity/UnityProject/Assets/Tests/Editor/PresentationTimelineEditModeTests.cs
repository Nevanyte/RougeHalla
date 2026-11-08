using System;
using System.Collections;
using System.Collections.Generic;
using System.Reflection;
using NUnit.Framework;
using Roguehalla.Net;
using Roguehalla.Net.Protocol;
using TMPro;
using UnityEngine;
using UnityEngine.EventSystems;

namespace Roguehalla.Client.Tests
{
    public sealed class PresentationTimelineEditModeTests
    {
        sealed class Transport : ITransport
        {
            public event Action Opened;
            public event Action<byte[]> Received;
            public event Action<string> Closed;
            readonly Queue<byte[]> _incoming = new Queue<byte[]>();
            public readonly List<byte[]> Sent = new List<byte[]>();
            public void Connect(string url) { }
            public void Send(byte[] frame) { Sent.Add(frame); }
            public void Close() { Closed?.Invoke("closed"); }
            public void Poll() { while (_incoming.Count > 0) Received?.Invoke(_incoming.Dequeue()); }
            public void Open() { Opened?.Invoke(); }
            public void Queue(ServerMsg message) { _incoming.Enqueue(message.Encode()); }
            public ClientMsg.Input LastInput()
            {
                for (int i = Sent.Count - 1; i >= 0; i--) if (ClientMsg.Decode(Sent[i]) is ClientMsg.Input input) return input;
                throw new InvalidOperationException("No collected input");
            }
        }
        GameObject _root, _eventSystem;
        MatchClient _client;
        MatchHud _hud;
        ArenaView _arena;
        ShowcaseSoundscape _audio;
        double _now;

        [SetUp]
        public void SetUp()
        {
            _now = 0;
            bool hadEvents = EventSystem.current != null;
            _root = new GameObject("actual presentation lifecycle test");
            _client = _root.AddComponent<MatchClient>();
            _hud = _root.AddComponent<MatchHud>(); _hud.Initialize(_client);
            typeof(MatchClient).GetProperty("Hud").SetValue(_client, _hud);
            if (!hadEvents && EventSystem.current != null) _eventSystem = EventSystem.current.gameObject;
            var arenaObject = new GameObject("lifecycle arena"); arenaObject.transform.SetParent(_root.transform, false);
            _arena = arenaObject.AddComponent<ArenaView>(); Invoke(_arena, "Awake"); _client.Arena = _arena;
            _audio = _root.AddComponent<ShowcaseSoundscape>(); _audio.Initialize(_client);
        }
        [TearDown]
        public void TearDown()
        {
            if (_root != null) UnityEngine.Object.DestroyImmediate(_root);
            if (_eventSystem != null) UnityEngine.Object.DestroyImmediate(_eventSystem);
        }

        Session Create(Transport transport)
        {
            return new Session(transport, new SessionOptions { Url = "ws://fixture/ws", Profile = "fixture", Now = () => _now });
        }
        void Bind(Session session)
        {
            typeof(MatchClient).GetProperty("Session").SetValue(_client, session);
            _hud.Bind(session); // the same ordering as Join: HUD before lifecycle consumers
            Invoke(_client, "BindPresentationSession", session);
            Invoke(_audio, "LateUpdate");
        }
        Session Start(Transport transport)
        {
            var session = Create(transport); Bind(session);
            session.Connect(); transport.Open(); transport.Queue(Welcome());
            transport.Queue(Snapshot(1, 1250, 100, 0, true)); session.Poll(); Render(session);
            return session;
        }
        void Render(Session session)
        {
            var actors = new List<InterpActor>(); session.Snapshots.Sample(session.Clock.RenderMs, actors);
            _arena.RefreshVisibility(session); _arena.Present(actors, session.Me, session.Motion, 0);
            Invoke(_hud, "LateUpdate");
        }
        static ServerMsg.Welcome Welcome()
        {
            return new ServerMsg.Welcome { Protocol = Wire.ProtocolVersion, MatchId = new byte[16], Session = new byte[16],
                PlayerId = 3, TickRate = 20, Tick = 1, ServerMs = 50, Map = new MapBlob(32, 32, new byte[1024]) };
        }
        static ServerMsg.Snapshot Snapshot(uint tick, double time, float x, byte seq, bool wish)
        {
            return new ServerMsg.Snapshot { Tick = tick, ServerTimeOverrideMs = time, Phase = 1,
                Me = new WireSelf { Id = 3, X = x, Y = 100, Hp = 100, MaxHp = 100, Status = 1, MoveSeq = seq,
                    Barrier = wish ? 10 : 0, BarrierRingStep = (byte)(wish ? 3 : 0),
                    Wish = wish ? new WireWishOwner { Ability = 0, ReadyAt = 5000, MaxCharges = 1, Charges = 1, RechargeMs = 1000 } : null } };
        }
        static ServerMsg.Fx Fx(params WireFx[] rows) { return new ServerMsg.Fx { List = new List<WireFx>(rows) }; }
        static WireFx Started() { return new WireFx { Kind = FxKind.WishStarted, Caster = 3, Ability = 0, EventTime = 1250, Duration = 1000, HasAnchor = true, AnchorX = 100, AnchorY = 100 }; }
        ConfirmedWishPresenter Wishes { get { return (ConfirmedWishPresenter)Get(_arena, "_wishes"); } }

        [Test]
        public void RealAcceptedClockCutClearsOldTransientsAfterCanonicalUpdateAndPreservesSameWakeNewCuesAndWalk()
        {
            var transport = new Transport(); var session = Start(transport);
            transport.Queue(new ServerMsg.State { Tick = 1, Items = new StateItem[] {
                new InventoryState { Value = new WireInventory { PotionSmall = 2 } } } });
            transport.Queue(Fx(new WireFx { Kind = FxKind.Hit, By = 3, Victim = 3, Amount = 1 }, Started()));
            session.Poll(); Render(session);
            Assert.That(Wishes.ActiveCount, Is.EqualTo(1));
            Assert.That(((IList)Get(_arena, "_flashes")).Count, Is.GreaterThan(0));
            transport.Queue(Fx(new WireFx { Kind = FxKind.Hit, By = 3, Victim = 999, Amount = 1 })); session.Poll();
            Assert.That(((IList)Get(_arena, "_pendingFx")).Count, Is.EqualTo(1));

            byte move = session.OrderMove(600, 100); session.FlushInput();
            Set(_client, "_steering", true); Set(_client, "_lastDir", Vector2.right);
            bool resetObserved = false;
            session.TimelineReset += () => {
                resetObserved = true;
                Assert.That(session.ServerTimeMs, Is.EqualTo(1250));
                Assert.That(session.Me.X, Is.EqualTo(108.5f), "canonical self is installed before the signal");
                Assert.That(session.Collections.Inventory.Value.PotionSmall, Is.EqualTo(2));
                Assert.That(((IList)Get(_arena, "_pendingFx")).Count, Is.Zero);
                Assert.That(((IList)Get(_arena, "_flashes")).Count, Is.Zero);
                Assert.That(Wishes.ActiveCount, Is.Zero);
                Assert.That((int)Get(_audio, "_pendingFxCount"), Is.Zero);
                Assert.That(_arena.IsObserved(3), Is.True, "a clock cut does not clear membership");
                StringAssert.Contains("None delivered", ((TMP_Text)Get(_hud, "_wishCard")).text);
            };
            var cut = Snapshot(2, 1250, 108.5f, move, false); cut.AckInput = transport.LastInput().Seq;
            _now = 50; transport.Queue(cut);
            transport.Queue(Fx(new WireFx { Kind = FxKind.WishLanded, Ability = 0, EventTime = 1250,
                HasAnchor = true, AnchorX = 200, AnchorY = 200 }, new WireFx { Kind = FxKind.Hit, By = 3, Victim = 3, Amount = 2 }));
            session.Poll(); Render(session);
            Assert.That(resetObserved, Is.True);
            Assert.That(Wishes.ActiveCount, Is.EqualTo(1), "the following new-epoch landing survives");
            Assert.That((int)Get(_audio, "_pendingFxCount"), Is.EqualTo(1), "audio stays subscribed for the following hit");
            Assert.That((bool)Get(_client, "_steering"), Is.True);
            Assert.That((Vector2)Get(_client, "_lastDir"), Is.EqualTo(Vector2.right));
            for (int i = 0; i < 5; i++) { _now += 50; session.Poll(); }
            Assert.That(session.Motion.DrawnX, Is.GreaterThan(108.5f), "accepted movement continues after its correction drains");
            foreach (var bytes in transport.Sent)
                if (ClientMsg.Decode(bytes) is ClientMsg.Input input)
                    foreach (var command in input.Commands) Assert.That(command.Kind, Is.Not.EqualTo(CommandKind.Stop));
        }

        [Test]
        public void RealSessionRebindWelcomeLeaveAndDestroyTearDownOnlyPresentationSubscriptions()
        {
            var firstTransport = new Transport(); var first = Start(firstTransport);
            Bind(first); Bind(first);
            Assert.That(Listeners(first, "TimelineReset"), Is.EqualTo(1));
            Assert.That(Listeners(first, "FxReceived"), Is.EqualTo(2), "one view and one admitted audio subscriber");
            firstTransport.Queue(Fx(Started())); first.Poll(); Assert.That(Wishes.ActiveCount, Is.EqualTo(1));

            var secondTransport = new Transport(); var second = Create(secondTransport); Bind(second);
            Assert.That(Listeners(first, "TimelineReset"), Is.Zero); Assert.That(Listeners(first, "FxReceived"), Is.Zero);
            Assert.That(Wishes.ActiveCount, Is.Zero);
            StringAssert.Contains("Awaiting server", ((TMP_Text)Get(_hud, "_wishCard")).text);
            _arena.ConfirmedFx(Fx(Started()));
            second.Connect(); secondTransport.Open(); secondTransport.Queue(Welcome()); second.Poll();
            Assert.That(Wishes.ActiveCount, Is.Zero, "the actual Welcome reset reaches the presentation binding");
            Assert.That(second.Me, Is.Null);

            _client.Arena = null; // avoid scheduling Unity Destroy from an EditMode test; its clear is exercised above
            _client.Leave();
            Assert.That(Listeners(second, "TimelineReset"), Is.Zero);
            Assert.That((int)Get(_audio, "_pendingFxCount"), Is.Zero);
            _client.Arena = _arena;
            Bind(first);
            // These runtime MonoBehaviours are not engine-ticked in EditMode. Exercise their
            // actual teardown hooks explicitly; the staged Play fixture checks engine dispatch.
            _client.Arena = null; // actual owned-Arena destruction is checked in the staged Play fixture
            Invoke(_client, "OnDestroy");
            Invoke(_audio, "OnDisable");
            Invoke(_hud, "OnDestroy");
            UnityEngine.Object.DestroyImmediate(_root); _root = null;
            Assert.That(Listeners(first, "TimelineReset"), Is.Zero);
            Assert.That(Listeners(first, "FxReceived"), Is.Zero);
        }

        static int Listeners(Session session, string eventName)
        {
            var callback = (Delegate)typeof(Session).GetField(eventName, BindingFlags.Instance | BindingFlags.NonPublic).GetValue(session);
            return callback == null ? 0 : callback.GetInvocationList().Length;
        }
        static object Get(object value, string field) { return value.GetType().GetField(field, BindingFlags.Instance | BindingFlags.NonPublic | BindingFlags.Public).GetValue(value); }
        static void Set(object value, string field, object data) { value.GetType().GetField(field, BindingFlags.Instance | BindingFlags.NonPublic | BindingFlags.Public).SetValue(value, data); }
        static void Invoke(object value, string method, params object[] args) { value.GetType().GetMethod(method, BindingFlags.Instance | BindingFlags.NonPublic | BindingFlags.Public).Invoke(value, args); }
    }
}

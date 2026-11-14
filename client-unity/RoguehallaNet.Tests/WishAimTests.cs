using System;
using System.Collections.Generic;
using NUnit.Framework;
using Roguehalla.Net.Protocol;
using Roguehalla.Net.Ui;

namespace Roguehalla.Net.Tests
{
    /// <summary>
    /// P-UNITY-FROST-WALL-1 oracle: the Wish key, the mouse buttons and Esc while Frost's Wish is a placed wall (legacy 78dd8bd4
    /// RaidScene.ts castSlot :1592-1628, pointerdown :510-525, Escape :1826, updateAimPreview :1032-1052; the brief's F5 table).
    /// Every cast leaves through Session.CollectWishInput; a wall's cast point is the segment centre (legacy :1685-1692).
    /// </summary>
    public class WishAimTests
    {
        sealed class QueuedTransport : ITransport
        {
            public event Action Opened;
            public event Action<byte[]> Received;
            public event Action<string> Closed;
            public readonly List<byte[]> Sent = new List<byte[]>();
            readonly Queue<byte[]> incoming = new Queue<byte[]>();
            public void Connect(string url) { }
            public void Send(byte[] frame) { Sent.Add(frame); }
            public void Close() { Closed?.Invoke("closed"); }
            public void Poll() { while (incoming.Count != 0) Received(incoming.Dequeue()); }
            public void Open() { Opened(); }
            public void Enqueue(ServerMsg msg) { incoming.Enqueue(msg.Encode()); }
            public List<WireCommand> Casts()
            {
                var all = new List<WireCommand>();
                foreach (var frame in Sent)
                    if (ClientMsg.Decode(frame) is ClientMsg.Input input)
                        foreach (var c in input.Commands) if (c.Kind == CommandKind.Cast) all.Add(c);
                return all;
            }
        }

        static WireSelf Self(byte status = 1) { return new WireSelf { Id = 3, X = 100, Y = 100, Hp = 10, MaxHp = 10, Status = status }; }
        static ServerMsg.Snapshot Snapshot(uint tick, WireSelf self, byte phase = 1) { return new ServerMsg.Snapshot { Tick = tick, Phase = phase, Me = self }; }
        static ServerMsg.Welcome Welcome()
        {
            return new ServerMsg.Welcome { Protocol = Wire.ProtocolVersion, MatchId = new byte[16], PlayerId = 3,
                Session = new byte[16], TickRate = 20, Tick = 1, ServerMs = 50, Map = new MapBlob(32, 32, new byte[1024]) };
        }
        static Session Start(QueuedTransport t)
        {
            var s = new Session(t, new SessionOptions { Url = "ws://test/ws", Profile = "p", Now = () => 0 });
            s.Connect(); t.Open(); t.Enqueue(Welcome()); t.Enqueue(Snapshot(1, Self())); s.Poll();
            return s;
        }

        static readonly FrostWallNumbers Numbers = new FrostWallNumbers(450, 64, 224, 4000, 24, 8);
        static WishAimFrame Frame(FrostWishKind wish, float cx, float cy, bool quick = false, uint? actor = null)
        {
            return new WishAimFrame { Wish = wish, QuickCast = quick, UiOwnsInput = false, HasGroundPoint = true, CursorX = cx, CursorY = cy,
                ActorRef = actor, CasterX = 100, CasterY = 100, Facing = 0, Numbers = Numbers };
        }

        [Test]
        public void UnderFreezeTheKeyCastsAtOnceAsTodayWithTheRawCursorAndTheActor()
        {
            var t = new QueuedTransport(); var s = Start(t); var aim = new WishAim();
            byte seq = aim.Key(s, Frame(FrostWishKind.Freeze, 1000, 200, false, 19));
            Assert.AreNotEqual(0, seq); Assert.IsFalse(aim.Aiming);
            s.FlushInput();
            var casts = t.Casts(); Assert.AreEqual(1, casts.Count);
            Assert.AreEqual(1000, casts[0].X); Assert.AreEqual(200, casts[0].Y); Assert.AreEqual(19, casts[0].ActorRef); Assert.AreEqual(seq, casts[0].Seq);
            // A left click under Freeze is never the aim's.
            Assert.AreEqual(0, aim.Click(s, Frame(FrostWishKind.Freeze, 1000, 200), out bool consumed)); Assert.IsFalse(consumed);
        }

        [Test]
        public void WithThePreviewTheKeyShowsItAndSendsNothing()
        {
            var t = new QueuedTransport(); var s = Start(t); var aim = new WishAim();
            Assert.AreEqual(0, aim.Key(s, Frame(FrostWishKind.Wall, 300, 100)));
            Assert.IsTrue(aim.Aiming);
            s.FlushInput();
            Assert.AreEqual(0, t.Casts().Count);
        }

        [Test]
        public void AClickWhileAimingSendsExactlyOneCastAtTheClampedCentreWithNoActorAndPutsThePreviewAway()
        {
            var t = new QueuedTransport(); var s = Start(t); var aim = new WishAim();
            aim.Key(s, Frame(FrostWishKind.Wall, 1000, 100));
            // 900 u from the caster at (100, 100): the wall stands 450 out, at (550, 100).
            byte seq = aim.Click(s, Frame(FrostWishKind.Wall, 1000, 100, false, 19), out bool consumed);
            Assert.IsTrue(consumed, "the click is the aim's, not an attack"); Assert.AreNotEqual(0, seq); Assert.IsFalse(aim.Aiming);
            Assert.AreEqual(0, aim.Click(s, Frame(FrostWishKind.Wall, 1000, 100), out consumed));
            Assert.IsFalse(consumed, "a second click is an attack again");
            s.FlushInput();
            var casts = t.Casts(); Assert.AreEqual(1, casts.Count);
            Assert.AreEqual(550, casts[0].X, 1e-3); Assert.AreEqual(100, casts[0].Y, 1e-3); Assert.AreEqual(0, casts[0].ActorRef); Assert.AreEqual(seq, casts[0].Seq);
        }

        [Test]
        public void AClickInsideTheMinimumRangePlacesTheWallAtIt()
        {
            var t = new QueuedTransport(); var s = Start(t); var aim = new WishAim();
            aim.Key(s, Frame(FrostWishKind.Wall, 110, 100));
            aim.Click(s, Frame(FrostWishKind.Wall, 110, 100), out _);
            s.FlushInput();
            var casts = t.Casts(); Assert.AreEqual(1, casts.Count);
            Assert.AreEqual(164, casts[0].X, 1e-3); Assert.AreEqual(100, casts[0].Y, 1e-3);
        }

        [Test]
        public void TheKeyAgainARightClickAndEscEachPutItAwayAndSendNothing()
        {
            var t = new QueuedTransport(); var s = Start(t); var aim = new WishAim();
            aim.Key(s, Frame(FrostWishKind.Wall, 300, 100)); Assert.IsTrue(aim.Aiming);
            Assert.AreEqual(0, aim.Key(s, Frame(FrostWishKind.Wall, 300, 100))); Assert.IsFalse(aim.Aiming, "the key toggles");

            aim.Key(s, Frame(FrostWishKind.Wall, 300, 100)); Assert.IsTrue(aim.Aiming);
            aim.RightClick(); Assert.IsFalse(aim.Aiming, "a right click puts it away");

            aim.Key(s, Frame(FrostWishKind.Wall, 300, 100)); Assert.IsTrue(aim.Aiming);
            Assert.IsTrue(aim.Escape(), "Esc is consumed while aiming"); Assert.IsFalse(aim.Aiming);
            Assert.IsFalse(aim.Escape(), "Esc is not the aim's otherwise");

            s.FlushInput();
            Assert.AreEqual(0, t.Casts().Count);
        }

        [Test]
        public void DeathOrALeftActivePhasePutsItAwayEachFrameButBeingAliveKeepsIt()
        {
            var t = new QueuedTransport(); var s = Start(t); var aim = new WishAim();
            aim.Key(s, Frame(FrostWishKind.Wall, 300, 100));
            aim.Frame(s, Frame(FrostWishKind.Wall, 300, 100)); Assert.IsTrue(aim.Aiming, "alive and active: it stays up");
            t.Enqueue(Snapshot(2, Self(2))); s.Poll();
            aim.Frame(s, Frame(FrostWishKind.Wall, 300, 100)); Assert.IsFalse(aim.Aiming, "death puts it away");

            t.Enqueue(Snapshot(3, Self())); s.Poll();
            aim.Key(s, Frame(FrostWishKind.Wall, 300, 100)); Assert.IsTrue(aim.Aiming);
            t.Enqueue(Snapshot(4, Self(), 3)); s.Poll();
            aim.Frame(s, Frame(FrostWishKind.Wall, 300, 100)); Assert.IsFalse(aim.Aiming, "planning (phase 3) puts it away");

            t.Enqueue(Snapshot(5, Self())); s.Poll();
            aim.Key(s, Frame(FrostWishKind.Wall, 300, 100)); Assert.IsTrue(aim.Aiming);
            aim.Frame(s, Frame(FrostWishKind.Freeze, 300, 100)); Assert.IsFalse(aim.Aiming, "a Freeze room has no preview");
            s.FlushInput();
            Assert.AreEqual(0, t.Casts().Count);
        }

        [Test]
        public void ThePreviewOpensOnlyWhenACastCouldLeaveButNeedsNoGroundPoint()
        {
            var t = new QueuedTransport(); var s = Start(t); var aim = new WishAim();
            var ui = Frame(FrostWishKind.Wall, 300, 100); ui.UiOwnsInput = true;
            aim.Key(s, ui); Assert.IsFalse(aim.Aiming, "a panel owns the input");
            var off = Frame(FrostWishKind.Wall, 300, 100); off.HasGroundPoint = false;
            aim.Key(s, off); Assert.IsTrue(aim.Aiming, "legacy opens the preview before reading the cursor");
            aim.Escape();
            t.Enqueue(Snapshot(2, Self(2))); s.Poll();
            aim.Key(s, Frame(FrostWishKind.Wall, 300, 100)); Assert.IsFalse(aim.Aiming, "dead");
        }

        [Test]
        public void QuickCastSendsAtOnceAtTheClampedCentreWithNoPreview()
        {
            var t = new QueuedTransport(); var s = Start(t); var aim = new WishAim();
            byte seq = aim.Key(s, Frame(FrostWishKind.Wall, 1000, 100, true, 19));
            Assert.AreNotEqual(0, seq); Assert.IsFalse(aim.Aiming);
            s.FlushInput();
            var casts = t.Casts(); Assert.AreEqual(1, casts.Count);
            Assert.AreEqual(550, casts[0].X, 1e-3); Assert.AreEqual(100, casts[0].Y, 1e-3); Assert.AreEqual(0, casts[0].ActorRef);
        }
    }
}

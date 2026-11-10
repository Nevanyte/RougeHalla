using System;
using System.Collections.Generic;
using NUnit.Framework;
using Roguehalla.Net.Protocol;

namespace Roguehalla.Net.Tests
{
    // Synthetic managed transport/clock receipts, not Rust movement or earned gameplay fixtures.
    public class PredictionEchoOrderTests
    {
        sealed class Transport : ITransport
        {
            public event Action Opened;
            public event Action<byte[]> Received;
            public event Action<string> Closed;
            readonly Queue<byte[]> _incoming = new Queue<byte[]>();
            public readonly List<byte[]> Sent = new List<byte[]>();
            public void Connect(string url) { }
            public void Send(byte[] bytes) { Sent.Add(bytes); }
            public void Close() { Closed?.Invoke("closed"); }
            public void Poll() { while (_incoming.Count != 0) Received?.Invoke(_incoming.Dequeue()); }
            public void Open() { Opened?.Invoke(); }
            public void Enqueue(ServerMsg message) { _incoming.Enqueue(message.Encode()); }
            public uint LastInput()
            {
                for (int i = Sent.Count - 1; i >= 0; i--)
                    if (ClientMsg.Decode(Sent[i]) is ClientMsg.Input frame) return frame.Seq;
                throw new Exception("No sent input frame");
            }
        }

        sealed class Rig
        {
            public double Now;
            public readonly Transport T = new Transport();
            public readonly Session S;
            public Rig(byte heldSeq)
            {
                S = new Session(T, new SessionOptions { Url = "ws://test/ws", Profile = "synthetic", Now = () => Now });
                S.Connect(); T.Open();
                T.Enqueue(new ServerMsg.Welcome
                {
                    Protocol = Wire.ProtocolVersion, MatchId = new byte[16], PlayerId = 3,
                    Session = new byte[16], TickRate = 20, Tick = 20, ServerMs = 1000,
                    Map = new MapBlob(64, 16, new byte[64 * 16]),
                });
                T.Enqueue(Snapshot(20, 100, heldSeq, 0));
                S.Poll();
            }
            public void Poll(double at) { Now = at; S.Poll(); }
        }

        static ServerMsg.Snapshot Snapshot(uint tick, float x, byte heldSeq, uint ack)
        {
            return new ServerMsg.Snapshot
            {
                Tick = tick, Phase = 1, AckInput = ack,
                Me = new WireSelf { Id = 3, X = x, Y = 100, Hp = 10, MaxHp = 10, Status = 1, MoveSeq = heldSeq },
            };
        }

        [TestCase(false)]
        [TestCase(true)]
        public void StaleHeldByteCannotRetireOrRealignTheQueuedMovement(bool sent)
        {
            // A resumed/reused held byte equals the first new local order. Both timelines predict
            // the same new walk; one receives an unchanged snapshot whose input receipt is older.
            var actual = new Rig(1); var control = new Rig(1);
            Assert.AreEqual(1, actual.S.OrderMove(600, 100));
            Assert.AreEqual(1, control.S.OrderMove(600, 100));
            if (sent) { actual.S.FlushInput(); control.S.FlushInput(); }
            actual.T.Enqueue(Snapshot(21, 100, 1, 0));
            actual.Poll(50); control.Poll(50);
            Assert.IsTrue(actual.S.Motion.OrderPending, "the old frame receipt did not acknowledge the new order");
            Assert.IsTrue(control.S.Motion.OrderPending);
            actual.Poll(100); control.Poll(100);
            Assert.AreEqual(control.S.Motion.DrawnX, actual.S.Motion.DrawnX, 1e-6,
                "A stale byte echo must not consume NEW order-alignment state while the sent-frame gate refuses it");
            Assert.AreEqual(control.S.Motion.VisualX, actual.S.Motion.VisualX, 1e-6);
            Assert.AreEqual(0, actual.S.Motion.Snaps);
        }

        [Test]
        public void MatchingByteWithItsFreshSentFrameAcknowledgesAndKeepsTheWalk()
        {
            var r = new Rig(1);
            Assert.AreEqual(1, r.S.OrderMove(600, 100)); r.S.FlushInput();
            r.T.Enqueue(Snapshot(21, 108.5f, 1, r.T.LastInput())); r.Poll(50);
            Assert.IsFalse(r.S.Motion.OrderPending);
            r.Poll(100);
            Assert.AreEqual(117, r.S.Motion.DrawnX, 1e-6);
            Assert.AreEqual(0, r.S.Motion.Snaps);
        }

        [Test]
        public void AValidPriorSentMotionStillReconcilesWhileTheNewerMoveIsPending()
        {
            var actual = new Rig(0); var control = new Rig(0);
            actual.S.OrderMove(600, 100); actual.S.FlushInput(); uint priorFrame = actual.T.LastInput();
            control.S.OrderMove(600, 100); control.S.FlushInput();
            actual.Poll(100); control.Poll(100);
            actual.S.OrderMove(700, 100); actual.S.FlushInput();
            control.S.OrderMove(700, 100); control.S.FlushInput();
            // A delayed first-order receipt says the server did not advance that first tick.
            // It is valid for the PRIOR sent motion, although it cannot acknowledge the new move.
            actual.T.Enqueue(Snapshot(21, 100, 1, priorFrame));
            actual.Poll(150); control.Poll(150);
            Assert.IsTrue(actual.S.Motion.OrderPending, "the newer order remains unacknowledged");
            actual.Poll(200); control.Poll(200);
            Assert.Less(actual.S.Motion.DrawnX, control.S.Motion.DrawnX - .1,
                "Do not fix stale echoes by suppressing valid earlier movement receipts during a held walk");
            Assert.AreEqual(0, actual.S.Motion.Snaps);
        }
    }
}

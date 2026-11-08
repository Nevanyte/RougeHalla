using System;
using System.Collections.Generic;
using NUnit.Framework;
using Roguehalla.Net.Protocol;

namespace Roguehalla.Net.Tests
{
    public class FrameInputTests
    {
        sealed class QueuedTransport : ITransport
        {
            public event Action Opened;
            public event Action<byte[]> Received;
            public event Action<string> Closed;
            public readonly List<ClientMsg> Sent = new List<ClientMsg>();
            public readonly Queue<Action> Pending = new Queue<Action>();
            public int Polls;
            public void Connect(string url) { Pending.Enqueue(() => Opened()); }
            public void Send(byte[] bytes) { Sent.Add(ClientMsg.Decode(bytes)); }
            public void Close() { }
            public void Poll() { Polls++; while (Pending.Count > 0) Pending.Dequeue()(); }
            public void Deliver(ServerMsg message) { Pending.Enqueue(() => Received(message.Encode())); }
            public void Drop() { Pending.Enqueue(() => Closed("closed")); }
        }

        static Session Connected(QueuedTransport transport)
        {
            var session = new Session(transport, new SessionOptions { Now = () => 1000 });
            session.Connect();
            transport.Deliver(new ServerMsg.Welcome
            {
                Protocol = Wire.ProtocolVersion, MatchId = new byte[16], Session = new byte[16],
                PlayerId = 3, TickRate = 20, Map = new MapBlob(4, 4, new byte[16])
            });
            return session;
        }

        [Test]
        public void PollThenCollectThenFlushSendsThisFramesPressWithoutASecondPoll()
        {
            var transport = new QueuedTransport();
            var session = Connected(transport);
            session.Poll(); // applies queued Welcome before controls are sampled
            Assert.AreEqual(SessionState.InMatch, session.State);
            Assert.IsFalse(transport.Sent.Exists(m => m is ClientMsg.Input));
            session.Input.Attack(0.5f, 50);
            session.OrderStop();
            session.FlushInput();
            var frames = transport.Sent.FindAll(m => m is ClientMsg.Input);
            Assert.AreEqual(1, frames.Count, "one outgoing batch for this frame");
            Assert.AreEqual(2, ((ClientMsg.Input)frames[0]).Commands.Count);
            Assert.AreEqual(1, transport.Polls, "sending must not advance clocks or poll again");
            session.FlushInput();
            Assert.AreEqual(1, transport.Sent.FindAll(m => m is ClientMsg.Input).Count, "no duplicate actions");
        }

        [Test]
        public void PolledDisconnectPreventsControlsFromLeavingOnTheOldConnection()
        {
            var transport = new QueuedTransport();
            var session = Connected(transport);
            session.Poll();
            session.Input.Attack(0, 50);
            transport.Drop();
            session.Poll();
            session.FlushInput();
            Assert.AreEqual(SessionState.Reconnecting, session.State);
            Assert.IsFalse(transport.Sent.Exists(m => m is ClientMsg.Input));
        }

        [Test]
        public void ExistingUpdateCallersStillPollAndSendTheirQueuedControls()
        {
            var transport = new QueuedTransport();
            var session = Connected(transport);
            session.Poll();
            session.Input.Attack(0, 50);
            session.Update();
            Assert.AreEqual(1, transport.Sent.FindAll(m => m is ClientMsg.Input).Count);
        }
    }
}

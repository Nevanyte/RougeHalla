using NUnit.Framework;
using Roguehalla.Net;
using Roguehalla.Net.Protocol;

namespace Roguehalla.Net.Tests
{
    /// <summary>The Sentenced hunt picker sends the ordinary hunt-target command; a zero id is dropped before the wire.</summary>
    public sealed class HuntTargetInputTests
    {
        [Test]
        public void HuntTargetIsQueuedAsTheWireCommandAndZeroIsDropped()
        {
            var sender = new InputSender();
            sender.HuntTarget(0);
            Assert.AreEqual(1, sender.Dropped);
            sender.HuntTarget(0x80000001u);
            var frames = sender.Flush(0);
            Assert.AreEqual(1, frames.Count);
            var decoded = (ClientMsg.Input)ClientMsg.Decode(frames[0].Encode());
            Assert.AreEqual(1, decoded.Commands.Count);
            Assert.AreEqual(CommandKind.HuntTarget, decoded.Commands[0].Kind);
            Assert.AreEqual(0x80000001u, decoded.Commands[0].ActorRef);
        }
    }
}

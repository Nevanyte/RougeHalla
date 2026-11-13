using System;
using System.IO;
using System.Reflection;
using System.Text.Json;
using NUnit.Framework;
using Roguehalla.Net;
using Roguehalla.Net.Protocol;

namespace Roguehalla.Net.Tests
{
    /// <summary>P-WIRE17-MAP-2 oracle (C#): State key 10's quest row carries the carrier's public actor id (row flag 0x10, a
    /// varint after the flags byte), present only while the viewer is delivered that fighter. Rows without it keep their
    /// bytes. Refusals: flag 0x10 without a carrier is "quest flags", an actor id of 0 is "quest carrier actor".</summary>
    public sealed class QuestCarrierProtocolTests
    {
        static JsonElement Fixture() => JsonDocument.Parse(File.ReadAllText(Path.Combine(Util.RepoRoot(), "protocol", "fixtures", Util.FixtureName))).RootElement;

        static byte[] Vector(string name)
        {
            foreach (var v in Fixture().GetProperty("server").EnumerateArray())
                if (v.GetProperty("name").GetString() == name) return Util.FromHex(v.GetProperty("hex").GetString());
            throw new AssertionException("missing Rust vector " + name + " (P-WIRE17-MAP-2 adds it)");
        }

        static WireQuestRow FirstRow(ServerMsg msg)
        {
            foreach (var item in ((ServerMsg.State)msg).Items)
                if (item is QuestsState q && q.View != null) return q.View.Rows[0];
            throw new AssertionException("no quest row");
        }

        /// <summary>A State frame, key 10, one row carried by roster 8 (or none), the flags byte <paramref name="flags"/> and,
        /// when given, the bytes after it.</summary>
        static byte[] Raw(uint carrier, byte flags, byte[] actor)
        {
            var w = new Writer();
            w.U8(0x88); w.Varint(5); w.Varint(1); w.Varint((uint)StateKey.Quests);
            w.U8(1); w.Varint(0); w.Varint(0); w.Varint(7);
            w.Varint(2); w.Varint(7); w.Str("owner"); w.Varint(8); w.Str("runner");
            w.Varint(1);
            w.Varint(11); w.Str("fetch"); w.F64(10.0); w.F64(20.0); w.U8(1); w.F64(100.0);
            w.Varint(1); w.Varint(8); w.U8(1); w.Varint(0); w.U8(0);
            w.Varint(carrier); w.U8(0); w.U8(flags);
            if (actor != null) foreach (var b in actor) w.U8(b);
            w.Varint(2); w.U8(1);
            foreach (var s in new[] { "N", "G", "B", "O", "R" }) w.Str(s);
            w.Varint(0);
            return w.Finish();
        }

        [Test]
        public void TheVisibleAndHiddenCarrierVectorsDecodeAndReencode()
        {
            byte[] visible = Vector("state_quests_carrier_visible");
            var v = ServerMsg.Decode(visible);
            Assert.AreEqual(new RosterId(7), FirstRow(v).Carrier);
            Assert.AreEqual(5u, FirstRow(v).CarrierActor, "roster 7 seen as actor 5");
            CollectionAssert.AreEqual(visible, v.Encode());
            byte[] hidden = Vector("state_quests_carrier_hidden");
            var h = ServerMsg.Decode(hidden);
            Assert.AreEqual(new RosterId(7), FirstRow(h).Carrier);
            Assert.IsNull(FirstRow(h).CarrierActor, "unseen");
            CollectionAssert.AreEqual(hidden, h.Encode());
            Assert.IsNull(FirstRow(ServerMsg.Decode(Vector("state_quests_available"))).CarrierActor, "no carrier");
        }

        [Test]
        public void TheActorRidesAfterTheFlagsByte()
        {
            ServerMsg msg = null;
            Assert.DoesNotThrow(() => msg = ServerMsg.Decode(Raw(8, 0x11, new byte[] { 0xac, 0x02 })), "flag 0x10 with actor 300 decodes");
            Assert.AreEqual(300u, FirstRow(msg).CarrierActor);
            Assert.IsTrue(FirstRow(msg).CanAccept);
            CollectionAssert.AreEqual(Raw(8, 0x11, new byte[] { 0xac, 0x02 }), msg.Encode(), "the writer emits flag 0x10 and the varint");
            Assert.IsNull(FirstRow(ServerMsg.Decode(Raw(8, 0x01, null))).CarrierActor, "absent");
        }

        [Test]
        public void TheDecoderRefusesAnActorWithoutACarrierOrAZeroActor()
        {
            var e = Assert.Throws<DecodeException>(() => ServerMsg.Decode(Raw(0, 0x11, new byte[] { 5 })));
            Assert.AreEqual(DecodeError.BadField + ": quest flags", e.Message, "flag 0x10 without a carrier");
            e = Assert.Throws<DecodeException>(() => ServerMsg.Decode(Raw(8, 0x11, new byte[] { 0 })));
            Assert.AreEqual(DecodeError.BadField + ": quest carrier actor", e.Message, "actor 0");
            e = Assert.Throws<DecodeException>(() => ServerMsg.Decode(Raw(8, 0x21, null)));
            Assert.AreEqual(DecodeError.BadField + ": quest flags", e.Message, "bit 0x20 stays unknown");
        }

        static WireQuestView View(RosterId? carrier, uint? actor) => new WireQuestView
        {
            OwnerRoster = new RosterId(7),
            Roster = new[] { new WireQuestRosterEntry { Id = new RosterId(7), Label = "owner" }, new WireQuestRosterEntry { Id = new RosterId(8), Label = "runner" } },
            Rows = new[]
            {
                new WireQuestRow
                {
                    Handle = new QuestHandle(11), Def = "fetch", GiverX = 10, GiverY = 20, State = QuestRowState.Open, ExpiresAt = 100,
                    Participants = new[] { new WireQuestParticipant { Id = new RosterId(8), Accepted = true } },
                    Carrier = carrier, CarrierActor = actor, CanAccept = true, OwnerProgress = 2, OwnerVisited = 1,
                    Name = "N", GiverLabel = "G", Brief = "B", Objective = "O", Reward = "R",
                },
            },
        };

        static ServerMsg.State State(RosterId? carrier, uint? actor) =>
            new ServerMsg.State { Tick = 5, Items = new StateItem[] { new QuestsState { Available = true, View = View(carrier, actor) } } };

        [Test]
        public void TheEncoderRefusesAnActorWithoutACarrierOrAZeroActor()
        {
            Assert.Throws<EncodeException>(() => State(null, 5).Encode(), "actor without a carrier");
            Assert.Throws<EncodeException>(() => State(new RosterId(8), 0).Encode(), "actor 0");
            CollectionAssert.AreEqual(Raw(8, 0x01, null), State(new RosterId(8), null).Encode(), "no actor: the old bytes");
        }

        [Test]
        public void CollectionsExposeTheCarrierActor()
        {
            var view = new CollectionsView();
            typeof(CollectionsView).GetMethod("Apply", BindingFlags.Instance | BindingFlags.NonPublic)
                .Invoke(view, new object[] { State(new RosterId(8), 300) });
            Assert.AreEqual(300u, view.Quests.Rows[0].CarrierActor);
            Assert.AreEqual(new RosterId(8), view.Quests.Rows[0].Carrier);
        }
    }
}

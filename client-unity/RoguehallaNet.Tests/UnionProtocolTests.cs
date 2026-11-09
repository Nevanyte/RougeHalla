using System;
using System.IO;
using System.Linq;
using System.Collections.Generic;
using System.Text.Json;
using NUnit.Framework;
using Roguehalla.Net.Protocol;

namespace Roguehalla.Net.Tests
{
    public class UnionProtocolTests
    {
        static ServerMsg.Welcome Welcome() => new ServerMsg.Welcome { Protocol = Wire.ProtocolVersion, MatchId = new byte[16], Session = new byte[16], PlayerId = 3, TickRate = 20, Map = new MapBlob(4, 4, new byte[16]) };
        static ServerMsg Sample(string name)
        {
            using var doc = JsonDocument.Parse(File.ReadAllText(Path.Combine(Util.RepoRoot(), "protocol", "fixtures", Util.FixtureName)));
            var v = doc.RootElement.GetProperty("server").EnumerateArray().Single(x => x.GetProperty("name").GetString() == name);
            return ServerMsg.Decode(Util.FromHex(v.GetProperty("hex").GetString()));
        }

        [Test]
        public void FullCatalogRewardPositionsRetainTheirBoundary()
        {
            var state = (ServerMsg.State)Sample("state_full_catalog_rewards");
            var chest = ((RewardChestsState)state.Items[0]).Rows[0];
            CollectionAssert.AreEqual(new byte[] { 3, 79, 7 }, chest.Options.Select(o => o.Id));
            Assert.AreEqual(1, chest.Options[1].Kind);
            var option = chest.Options[1]; option.Id = 80; chest.Options[1] = option;
            Assert.Throws<EncodeException>(() => state.Encode());
        }

        [Test]
        public void UnionPropsAndNoticesKeepTheirDistinctPayloads()
        {
            var state = (ServerMsg.State)Sample("state_union_props");
            var rows = ((PropsState)state.Items[0]).Rows;
            Assert.AreEqual(PropKind.Corpse, rows[0].Kind); Assert.AreEqual("fallen", rows[0].CorpseLabel);
            Assert.AreEqual(PropKind.WindEmblem, rows[1].Kind);
            Assert.AreEqual(PropKind.Cannon, rows[2].Kind); Assert.AreEqual(uint.MaxValue, rows[2].ReadyAt);
            var events = ((ServerMsg.Events)Sample("events_union")).List;
            CollectionAssert.AreEqual(new[] { EventKind.WindEmblem, EventKind.CannonNotice, EventKind.Toast, EventKind.PotionNotice }, events.Select(x => x.Kind));
            Assert.AreEqual(75, events[1].CannonSeconds); Assert.AreEqual("Practice ready", events[2].ToastText);
        }

        [Test]
        public void NineKeyReadinessAndOwnedPlanningFactsSurviveReplacementAndResume()
        {
            var transport = new FakeTransport(); double now = 0;
            var session = new Session(transport, new SessionOptions { Url = "ws://x/ws", Profile = "p", Ticket = Array.Empty<byte>(), Now = () => now });
            session.Connect(); transport.Open(); transport.Deliver(Welcome());
            var full = (ServerMsg.State)Sample("state_all");
            full.Items = full.Items.Where(x => x.Key < (uint)StateKey.Plan).ToArray();
            transport.Deliver(full); Assert.IsFalse(session.Collections.HasFullState, "reduced keys omit the plan, arena and quest baseline");
            var plan = new WirePlan { EndsAt = 1000, Spawn0 = 5, Taken1 = true, Pick = 0, Boons = new[] { "first" }, Boon = 0, Ready = true,
                Option0 = new WirePlanOption { Index = 5, X = 80, Y = 160, Zone = 3, WalkSeconds = 2 } };
            transport.Deliver(new ServerMsg.State { Tick = 201, Items = new StateItem[] { new PlanState { Value = plan }, new ArenaState { Value = new WireArena { PlanEndsAt = 1000, PatienceEndsAt = 2000, StartedWith = 8 } }, new QuestsState { Available = false } } });
            Assert.IsTrue(session.Collections.HasFullState);
            var held = session.Collections.Plan;
            Assert.AreEqual(5, held.Spawn0); Assert.IsTrue(held.Taken1); Assert.AreEqual(10, held.Option0.Value.X);
            Assert.AreEqual(20, held.Option0.Value.Y); Assert.AreEqual(3, held.Option0.Value.Zone); Assert.AreEqual(2, held.Option0.Value.WalkSeconds);
            Assert.AreEqual(2000, session.Collections.Arena.Value.PatienceEndsAt);
            Assert.Throws<NotSupportedException>(() => ((IList<string>)held.Boons)[0] = "mutate");
            plan.Boons[0] = "second";
            transport.Deliver(new ServerMsg.State { Tick = 202, Items = new StateItem[] { new PlanState { Value = plan } } });
            Assert.AreEqual("first", held.Boons[0]); Assert.AreEqual("second", session.Collections.Plan.Boons[0]);
            Assert.AreEqual(4, session.Collections.Inventory.Value.PotionLarge); Assert.AreEqual(80, session.Collections.Cards.Count);
            transport.Deliver(Sample("state_union_props"));
            Assert.AreEqual(PropAppearance.Corpse, session.Collections.Props[0].Kind); Assert.AreEqual("fallen", session.Collections.Props[0].CorpseLabel);
            Assert.AreEqual(PropAppearance.Cannon, session.Collections.Props[2].Kind); Assert.AreEqual(uint.MaxValue, session.Collections.Props[2].ReadyAt);
            var errors = session.DecodeErrors;
            transport.DeliverRaw(new byte[] { 0x88, 1, 1, 10 });
            Assert.AreEqual(errors + 1, session.DecodeErrors); Assert.IsTrue(session.Collections.HasFullState);
            transport.Deliver(new ServerMsg.State { Tick = 203, Items = new StateItem[] { new PlanState(), new ArenaState() } });
            Assert.IsNull(session.Collections.Plan); Assert.IsNull(session.Collections.Arena); Assert.IsTrue(session.Collections.HasFullState);
            transport.Drop(); now = 1000; session.Update(); transport.Open(); transport.Deliver(Welcome());
            Assert.IsFalse(session.Collections.HasFullState); Assert.IsNull(session.Collections.Plan); Assert.IsNull(session.Collections.Arena);
        }

        [Test]
        public void OwnedSessionTrainingAndHuntFactsFollowAcceptedSnapshotsAndReset()
        {
            var transport = new FakeTransport(); double now = 0;
            var session = new Session(transport, new SessionOptions { Url = "ws://x/ws", Profile = "p", Ticket = Array.Empty<byte>(), Now = () => now });
            session.Connect(); transport.Open(); transport.Deliver(Welcome());
            transport.Deliver(new ServerMsg.Snapshot { Tick = 1, Training = true, Me = new WireSelf { Id = 3, HuntTarget = 9, HuntStacks = 4 } });
            Assert.IsTrue(session.Training); Assert.AreEqual(9, session.Me.HuntTarget); Assert.AreEqual(4, session.Me.HuntStacks);
            session.Latest.Me.HuntTarget = 17; session.Latest.Me.HuntStacks = 99;
            Assert.AreEqual(9, session.Me.HuntTarget); Assert.AreEqual(4, session.Me.HuntStacks, "owned self does not alias wire facts");
            transport.Deliver(new ServerMsg.Snapshot { Tick = 2, Training = true, Me = new WireSelf { Id = 3 } });
            Assert.IsNull(session.Me.HuntTarget); Assert.AreEqual(0, session.Me.HuntStacks);
            transport.Deliver(new ServerMsg.Snapshot { Tick = 1, Training = false, Me = new WireSelf { Id = 3, HuntTarget = 18 } });
            Assert.IsTrue(session.Training); Assert.IsNull(session.Me.HuntTarget, "stale snapshot does not rewind owned facts");
            transport.Drop(); now = 1000; session.Update(); transport.Open(); transport.Deliver(Welcome());
            Assert.IsFalse(session.Training); Assert.IsNull(session.Me);
        }
    }
}

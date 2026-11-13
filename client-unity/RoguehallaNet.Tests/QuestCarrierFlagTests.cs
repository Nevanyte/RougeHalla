using System;
using System.Collections.Generic;
using NUnit.Framework;
using Roguehalla.Net.Protocol;
using Roguehalla.Net.Ui;

namespace Roguehalla.Net.Tests
{
    /// <summary>P-UNITY-WORLD-MARKS-2 oracle (engine-free): which quest rows get a carrier flag, and its fixed numbers, pinned to legacy
    /// QuestView.ts. Legacy draws a flag for an open, unexpired quest whose carrier it can place (:51-76); the Rust wire now names that fighter
    /// by actor id, only while the viewer is delivered it (P-WIRE17-MAP-2).</summary>
    public sealed class QuestCarrierFlagTests
    {
        static WireQuestRow Row(uint? carrierActor, QuestRowState state = QuestRowState.Open, double expiresAt = 100000, double gx = 10, double gy = 20, uint handle = 7)
        {
            return new WireQuestRow
            {
                Handle = new QuestHandle(handle), Def = "banner-fire", GiverX = gx, GiverY = gy, State = state, ExpiresAt = expiresAt,
                Name = "N", GiverLabel = "G", Brief = "B", Objective = "O", Reward = "R",
                Participants = new[] { new WireQuestParticipant { Id = new RosterId(8), Accepted = true } },
                Carrier = carrierActor.HasValue ? new RosterId(8) : (RosterId?)null, CarrierActor = carrierActor, OwnerAccepted = true,
            };
        }

        static QuestView Quests(params WireQuestRow[] rows)
        {
            var transport = new FakeTransport();
            var session = new Session(transport, new SessionOptions { Url = "ws://x/ws", Profile = "p", Ticket = Array.Empty<byte>(), Now = () => 0 });
            session.Connect(); transport.Open();
            transport.Deliver(new ServerMsg.Welcome { Protocol = Wire.ProtocolVersion, MatchId = new byte[16], Session = new byte[16],
                PlayerId = 1, TickRate = 20, Map = new MapBlob(4, 4, new byte[16]) });
            var view = new WireQuestView
            {
                OwnerRoster = new RosterId(7),
                Roster = new[] { new WireQuestRosterEntry { Id = new RosterId(7), Label = "owner" }, new WireQuestRosterEntry { Id = new RosterId(8), Label = "runner" } },
                Rows = rows, Objectives = new WireQuestObjective[0],
            };
            transport.Deliver(new ServerMsg.State { Tick = 1, Items = new StateItem[] { new QuestsState { Available = true, View = view } } });
            return session.Collections.Quests;
        }

        static List<CarrierFlagRow> Run(QuestView q, double serverMs = 1000)
        {
            var into = new List<CarrierFlagRow> { new CarrierFlagRow { Actor = 99 } };
            QuestCarrierFlag.Rows(q, serverMs, into);
            return into;
        }

        [Test]
        public void AnOpenRowWithACarrierActorGivesOneRowWithTheActorAndTheGiverPoint()
        {
            var rows = Run(Quests(Row(5, gx: 12.5, gy: 33)));
            Assert.AreEqual(1, rows.Count, "one flag row, and the old row was cleared");
            Assert.AreEqual(5u, rows[0].Actor);
            Assert.AreEqual(12.5, rows[0].GiverX); Assert.AreEqual(33.0, rows[0].GiverY);
        }

        [Test]
        public void ARowWithoutACarrierActorGivesNone()
        {
            Assert.AreEqual(0, Run(Quests(Row(null))).Count, "no carrier, or a carrier the viewer is not delivered (the id is absent)");
        }

        [Test]
        public void OnlyOpenUnexpiredRowsCount()
        {
            Assert.AreEqual(0, Run(Quests(Row(5, QuestRowState.Done))).Count, "done");
            Assert.AreEqual(0, Run(Quests(Row(5, QuestRowState.Preview))).Count, "preview");
            Assert.AreEqual(0, Run(Quests(Row(5, QuestRowState.Expired))).Count, "expired state");
            Assert.AreEqual(0, Run(Quests(Row(5, expiresAt: 900)), 1000).Count, "past its deadline (questModel.ts:38-40)");
            Assert.AreEqual(1, Run(Quests(Row(5, expiresAt: 0)), 1000).Count, "expiresAt 0 never expires");
        }

        [Test]
        public void RowsComeInRowOrderAndNullOrUnavailableViewsGiveNone()
        {
            var two = Run(Quests(Row(5, handle: 1), Row(null, handle: 2), Row(6, handle: 3)));
            CollectionAssert.AreEqual(new uint[] { 5, 6 }, two.ConvertAll(r => r.Actor), "the two rows with a carrier, in order");
            Assert.AreEqual(0, Run(null).Count, "no quest view");
        }

        [Test]
        public void TheFlagIs14By12PxWithItsTopAt62PxGoldWithADarkRim()
        {
            Assert.AreEqual(14f, QuestCarrierFlag.WidthPx); Assert.AreEqual(12f, QuestCarrierFlag.HeightPx);
            Assert.AreEqual(62f, QuestCarrierFlag.TopPx, "BODY_LIFT 14 + 48 (QuestView.ts:167)");
            Assert.AreEqual(56f, QuestCarrierFlag.CentrePx, "top 62 less half the 12 px height");
            Assert.AreEqual(0xffd54fu, QuestCarrierFlag.FillRgb, "fetch: the only kind with a carrier");
            Assert.AreEqual(0x101318u, QuestCarrierFlag.OutlineRgb); Assert.AreEqual(2f, QuestCarrierFlag.OutlineWidthPx);
        }
    }
}

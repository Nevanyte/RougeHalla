using System;
using System.Collections.Generic;
using NUnit.Framework;
using Roguehalla.Net;
using Roguehalla.Net.Protocol;
using Roguehalla.Net.Ui;
using UnityEngine;

namespace Roguehalla.Client.Tests
{
    /// <summary>P-UNITY-WORLD-MARKS-2 oracle: the camp patience outline (W11) and the quest carrier flag (W7), as legacy draws them
    /// (CampPatience.ts, QuestView.ts; rules in docs/backlog/packets/P-UNITY-WORLD-MARKS-2.md section 3). The presenters are driven directly with
    /// the model's inputs, as the other world-mark tests do; the engine-free rules are pinned in RoguehallaNet.Tests.</summary>
    public sealed class WorldMarks2EditModeTests
    {
        GameObject _root;

        [SetUp] public void SetUp() { ShowcaseSprites.Initialize(); _root = new GameObject("world marks 2 test"); }
        [TearDown] public void TearDown() { UnityEngine.Object.DestroyImmediate(_root); }

        // ---- camp patience outline -----------------------------------------------------------------------------------------------

        /// <summary>8 x 8, three camps: camp 1 owns tiles (1,1) and (2,1) (6 edges), camp 2 owns (5,5) (4 edges), camp 3 owns no tile.</summary>
        static MapBlob Map(bool withPlane = true)
        {
            var plane = new byte[64];
            plane[1 * 8 + 1] = 1; plane[1 * 8 + 2] = 1; plane[5 * 8 + 5] = 2;
            var camps = new[] { new MapCamp(64, 64, 96, 1), new MapCamp(176, 176, 96, 1), new MapCamp(224, 32, 96, 1) };
            return new MapBlob(8, 8, new byte[64]).WithPublic(camps, null, null, null, null, withPlane ? plane : null);
        }

        static List<CampView> Camps(uint a, uint b, uint c) =>
            new List<CampView> { new CampView { Alive = a }, new CampView { Alive = b }, new CampView { Alive = c } };

        [Test]
        public void A_living_camp_with_tiles_is_outlined_and_labelled_in_an_active_run()
        {
            var o = new CampPatienceOutlines(_root.transform);
            o.Update(Map(), Camps(2, 3, 4), MatchPhase.Active, false);
            Assert.AreEqual(2, o.Shown, "camps 1 and 2 have tiles and living mobs; camp 3 has no tiles (legacy builds no outline for it)");
            Assert.IsTrue(o.IsShown(0)); Assert.IsTrue(o.IsShown(1)); Assert.IsFalse(o.IsShown(2));
            Assert.AreEqual("PATIENCE RANGE", o.LabelAt(0), "static word, no seconds (CampPatience.ts:81)");
            Assert.IsNull(o.LabelAt(2));
            Assert.AreEqual(6, o.EdgeCount(0), "two tiles side by side: six outer edges");
            Assert.AreEqual(4, o.EdgeCount(1));
            Assert.AreEqual(0, o.EdgeCount(2));
        }

        [Test]
        public void A_cleared_camp_loses_its_outline_and_gets_it_back_when_its_mobs_respawn()
        {
            var o = new CampPatienceOutlines(_root.transform);
            o.Update(Map(), Camps(2, 3, 0), MatchPhase.Active, false);
            o.Update(Map(), Camps(0, 3, 0), MatchPhase.Active, false);
            Assert.IsFalse(o.IsShown(0), "alive == 0: no chase range until the mobs respawn (CampPatience.ts:92)");
            Assert.IsNull(o.LabelAt(0));
            Assert.AreEqual(1, o.Shown);
            o.Update(Map(), Camps(1, 3, 0), MatchPhase.Active, false);
            Assert.IsTrue(o.IsShown(0), "alive again");
        }

        [TestCase(MatchPhase.Lobby, false)]
        [TestCase(MatchPhase.Planning, false)]
        [TestCase(MatchPhase.Ended, false)]
        [TestCase(MatchPhase.Active, true)]
        public void Nothing_is_drawn_outside_an_active_non_training_run(MatchPhase phase, bool training)
        {
            var o = new CampPatienceOutlines(_root.transform);
            o.Update(Map(), Camps(2, 3, 4), phase, training);
            Assert.AreEqual(0, o.Shown, "RaidScene.ts:676 passes state.phase === \"active\" && !state.training");
        }

        [Test]
        public void No_phase_yet_draws_nothing()
        {
            var o = new CampPatienceOutlines(_root.transform);
            o.Update(Map(), Camps(2, 3, 4), null, false);
            Assert.AreEqual(0, o.Shown);
        }

        [Test]
        public void Guard_a_map_without_a_patience_plane_draws_nothing_and_throws_nothing()
        {
            var o = new CampPatienceOutlines(_root.transform);
            Assert.DoesNotThrow(() => o.Update(Map(withPlane: false), Camps(2, 3, 4), MatchPhase.Active, false));
            Assert.DoesNotThrow(() => o.Update(null, Camps(2, 3, 4), MatchPhase.Active, false));
            Assert.DoesNotThrow(() => o.Update(Map(), null, MatchPhase.Active, false));
            Assert.DoesNotThrow(() => o.Update(Map(), new List<CampView>(), MatchPhase.Active, false));
            Assert.AreEqual(0, o.Shown);
            Assert.AreEqual(0, o.Builds, "nothing to build from");
            Assert.IsFalse(o.IsShown(-1)); Assert.IsFalse(o.IsShown(99)); Assert.IsNull(o.LabelAt(99)); Assert.AreEqual(0, o.EdgeCount(99));
        }

        [Test]
        public void The_outline_is_built_once_per_map_not_per_frame()
        {
            var o = new CampPatienceOutlines(_root.transform);
            var map = Map();
            o.Update(map, Camps(2, 3, 4), MatchPhase.Active, false);
            Assert.AreEqual(2, o.Builds, "one edge list per camp that has tiles");
            for (int i = 0; i < 30; i++) o.Update(map, Camps((uint)(i % 2), 3, 4), MatchPhase.Active, false);
            Assert.AreEqual(2, o.Builds, "visibility changes rebuild nothing");
            o.Update(Map(), Camps(2, 3, 4), MatchPhase.Active, false);
            Assert.AreEqual(4, o.Builds, "a new map (a new match) is built again");
        }

        [Test]
        public void A_frame_where_nothing_changed_allocates_nothing()
        {
            var o = new CampPatienceOutlines(_root.transform);
            var map = Map(); var camps = Camps(2, 3, 4);
            for (int i = 0; i < 5; i++) o.Update(map, camps, MatchPhase.Active, false);
            long before = GC.GetAllocatedBytesForCurrentThread();
            for (int i = 0; i < 200; i++) o.Update(map, camps, MatchPhase.Active, false);
            long grown = GC.GetAllocatedBytesForCurrentThread() - before;
            Assert.AreEqual(0, grown, "bytes allocated by 200 unchanged frames");
            Assert.AreEqual(2, o.Builds);
        }

        [Test]
        public void The_label_sits_25_px_below_the_camp_centre()
        {
            var o = new CampPatienceOutlines(_root.transform);
            o.Update(Map(), Camps(2, 3, 4), MatchPhase.Active, false);
            var expected = ArenaView.WorldPoint(64, 64) + new Vector3(0, -25f / 32f, 0);
            Assert.That(Vector3.Distance(expected, o.LabelPosition(0)), Is.LessThan(1e-3f), "CampPatience.ts:81 (camp.y + 25 screen px)");
        }

        // ---- quest carrier flag ---------------------------------------------------------------------------------------------------

        const uint Carrier = 5, Local = 1;

        static readonly ActorPoint Both = (uint id, out float x, out float y) =>
        {
            if (id == Carrier) { x = 320f; y = 640f; return true; }
            if (id == Local) { x = 96f; y = 128f; return true; }
            x = y = 0f; return false;
        };
        static readonly ActorPoint Nobody = (uint id, out float x, out float y) => { x = y = 0f; return false; };

        static List<CarrierFlagRow> Rows(params uint[] actors)
        {
            var rows = new List<CarrierFlagRow>();
            foreach (var a in actors) rows.Add(new CarrierFlagRow { Actor = a, GiverX = 500, GiverY = 500 });
            return rows;
        }

        [Test]
        public void The_flag_appears_over_the_carrier_when_the_row_has_the_id_and_the_actor_is_drawn()
        {
            var f = new QuestCarrierFlags(_root.transform);
            f.Update(Rows(Carrier), Both, null);
            Assert.AreEqual(1, f.Shown);
            var expected = ArenaView.WorldPoint(320, 640) + new Vector3(0, 56f / 32f, 0);
            Assert.That(Vector3.Distance(expected, f.PositionAt(0)), Is.LessThan(1e-3f), "centre 56 px above the ground point (top at -62, QuestView.ts:167)");
            Assert.That(Vector2.Distance(new Vector2(14f / 32f, 12f / 32f), f.SizeAt(0)), Is.LessThan(1e-3f), "14 x 12 px");
            Assert.AreEqual(new Color32(0xff, 0xd5, 0x4f, 255), f.ColorAt(0), "fetch gold ffd54f");
        }

        [Test]
        public void The_flag_appears_over_the_local_player_when_they_carry()
        {
            var f = new QuestCarrierFlags(_root.transform);
            f.Update(Rows(Local), Both, null);
            Assert.AreEqual(1, f.Shown, "QuestView.ts:68-76 reads the drawn positions, the local player's included");
            var expected = ArenaView.WorldPoint(96, 128) + new Vector3(0, 56f / 32f, 0);
            Assert.That(Vector3.Distance(expected, f.PositionAt(0)), Is.LessThan(1e-3f));
        }

        [Test]
        public void The_flag_is_gone_when_the_id_is_absent_or_the_actor_is_not_drawn()
        {
            var f = new QuestCarrierFlags(_root.transform);
            f.Update(Rows(Carrier), Both, null);
            Assert.AreEqual(1, f.Shown, "set-up");
            f.Update(Rows(), Both, null);
            Assert.AreEqual(0, f.Shown, "no row carries an actor id");
            f.Update(Rows(Carrier), Both, null);
            Assert.AreEqual(1, f.Shown, "back");
            f.Update(Rows(Carrier), Nobody, null);
            Assert.AreEqual(0, f.Shown, "the delivered id is not a drawn actor (QuestView.ts:70-71: no position, no flag)");
            f.Update(null, Both, null);
            Assert.AreEqual(0, f.Shown, "no rows at all");
        }

        [Test]
        public void Each_row_is_judged_alone()
        {
            var f = new QuestCarrierFlags(_root.transform);
            f.Update(Rows(Carrier, 77, Local), Both, null);
            Assert.AreEqual(2, f.Shown, "77 is not drawn; the other two are");
        }

        [Test]
        public void Legacy_quirk_a_row_whose_giver_is_in_fog_draws_no_flag_even_over_a_drawn_carrier()
        {
            // QuestView.ts:57 returns before the carrier block when canSee(giver) is false. Pinned as legacy; see the brief's LEGACY DOUBTS.
            var f = new QuestCarrierFlags(_root.transform);
            f.Update(Rows(Carrier), Both, (x, y) => false);
            Assert.AreEqual(0, f.Shown, "giver at (500, 500) is fogged");
            f.Update(Rows(Carrier), Both, (x, y) => x == 500f && y == 500f);
            Assert.AreEqual(1, f.Shown, "the giver's own point decides, not the carrier's");
        }

        [Test]
        public void The_flag_follows_the_actor()
        {
            var f = new QuestCarrierFlags(_root.transform);
            float x = 320f;
            ActorPoint moving = (uint id, out float ox, out float oy) => { ox = x; oy = 640f; return true; };
            f.Update(Rows(Carrier), moving, null);
            var first = f.PositionAt(0);
            x = 352f;
            f.Update(Rows(Carrier), moving, null);
            Assert.That(f.PositionAt(0).x - first.x, Is.EqualTo(1f).Within(1e-3f), "32 sim units is one world unit");
        }

        [Test]
        public void A_frame_where_nothing_changed_creates_and_allocates_nothing()
        {
            var f = new QuestCarrierFlags(_root.transform);
            var rows = Rows(Carrier, Local);
            for (int i = 0; i < 5; i++) f.Update(rows, Both, null);
            int created = f.Created;
            Assert.Greater(created, 0, "set-up: flags exist");
            long before = GC.GetAllocatedBytesForCurrentThread();
            for (int i = 0; i < 200; i++) f.Update(rows, Both, null);
            long grown = GC.GetAllocatedBytesForCurrentThread() - before;
            Assert.AreEqual(0, grown, "bytes allocated by 200 unchanged frames");
            Assert.AreEqual(created, f.Created, "no flag was rebuilt");
            Assert.AreEqual(2, f.Shown);
        }
    }
}

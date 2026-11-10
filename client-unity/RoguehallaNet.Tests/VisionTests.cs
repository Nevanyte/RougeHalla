using System;
using NUnit.Framework;
using Roguehalla.Net.Protocol;

namespace Roguehalla.Net.Tests
{
    public class VisionTests
    {
        const int W = 40, H = 30;

        static MapBlob Open()
        {
            var t = new byte[W * H];
            for (int x = 0; x < W; x++) { t[x] = 1; t[(H - 1) * W + x] = 1; }
            for (int y = 0; y < H; y++) { t[y * W] = 1; t[y * W + W - 1] = 1; }
            return new MapBlob(W, H, t);
        }

        // A wall column at x = 20 from y = 3 to y = 26 splits the room; the gap is at the top and bottom.
        static MapBlob Split()
        {
            var m = Open();
            for (int y = 3; y < H - 3; y++) m.Tiles[y * W + 20] = 1;
            return new MapBlob(W, H, m.Tiles);
        }

        static double C(int tile) { return (tile + 0.5) * 32; }

        [Test]
        public void Delivered_values_are_used_and_defaults_apply_without_a_block()
        {
            var d = new VisionRule(Open());
            Assert.AreEqual(VisionRule.DefaultRadius, d.Radius); Assert.AreEqual(VisionRule.DefaultTile, d.Tile);
            Assert.AreEqual(VisionRule.DefaultTrailMs, d.TrailMs); Assert.AreEqual(VisionRule.DefaultUpdateMs, d.UpdateMs);
            Assert.IsTrue(d.Usable);
            var narrow = new VisionRule(Open(), new WireVision { Radius = 300, TrailMs = 5000, UpdateMs = 250 });
            Assert.AreEqual(300, narrow.Radius); Assert.AreEqual(5000, narrow.TrailMs); Assert.AreEqual(250, narrow.UpdateMs);
            Assert.IsTrue(d.RevealsTile(C(10), C(10), 25, 10), "900 sees 15 tiles away");
            Assert.IsFalse(narrow.RevealsTile(C(10), C(10), 25, 10), "300 does not");
            Assert.IsTrue(narrow.RevealsTile(C(10), C(10), 15, 10));
        }

        [Test]
        public void Delivered_sight_mask_and_coliseum_rect_are_used()
        {
            var t = Open();
            t.Tiles[10 * W + 12] = 2; // low cover: does not block with mask 1
            Assert.IsTrue(new VisionRule(t).RevealsTile(C(10), C(10), 14, 10));
            Assert.IsFalse(new VisionRule(t, new WireVision { SightMask = 3 }).RevealsTile(C(10), C(10), 14, 10));
            var regions = new byte[W * H];
            for (int y = 10; y < 20; y++) for (int x = 10; x < 20; x++) regions[y * W + x] = VisionRule.RegionColiseum;
            var map = new MapBlob(W, H, new byte[W * H], null, regions, MapBlob.GroundTerrainOff);
            var rule = new VisionRule(map, new WireVision { HasColiseum = true, ColiseumX = 2, ColiseumY = 3, ColiseumW = 4, ColiseumH = 5 });
            rule.ColiseumRect(out int x0, out int y0, out int w, out int h);
            Assert.AreEqual((2, 3, 4, 5), (x0, y0, w, h));
            new VisionRule(map).ColiseumRect(out x0, out y0, out w, out h);
            Assert.AreEqual((10, 10, 10, 10), (x0, y0, w, h), "no delivered rect: region-6 bounding box");
            Assert.IsTrue(new VisionRule(map, new WireVision()).HasColiseum, "a block without a rect still falls back to the plane");
        }

        [Test]
        public void An_unknown_version_or_bad_numbers_make_the_rule_unusable()
        {
            Assert.IsFalse(new VisionRule(Open(), new WireVision { Version = 2 }).Usable);
            Assert.IsFalse(new VisionRule(Open(), new WireVision { Radius = 0 }).Usable);
            Assert.IsFalse(new VisionRule(Open(), new WireVision { Radius = double.NaN }).Usable);
            Assert.IsFalse(new VisionRule(Open(), new WireVision { Tile = -1 }).Usable);
            Assert.IsFalse(new VisionRule(Open(), new WireVision { UpdateMs = double.PositiveInfinity }).Usable);
            Assert.IsFalse(new VisionRule(Open(), new WireVision { TrailMs = double.NaN }).Usable);
            Assert.IsTrue(new VisionRule(Open(), new WireVision()).Usable);
        }

        [Test]
        public void A_wall_hides_the_far_side_but_its_first_face_is_seen()
        {
            var rule = new VisionRule(Split());
            Assert.IsTrue(rule.RevealsTile(C(15), C(15), 19, 15), "floor in front of the wall");
            Assert.IsTrue(rule.RevealsTile(C(15), C(15), 20, 15), "the wall's first face");
            Assert.IsFalse(rule.RevealsTile(C(15), C(15), 22, 15), "floor behind the wall");
        }

        [Test]
        public void Low_cover_does_not_block_sight()
        {
            var t = new byte[W * H];
            t[15 * W + 20] = 2; // LOW
            var rule = new VisionRule(new MapBlob(W, H, t));
            Assert.IsFalse(rule.LineBlocked(C(15), C(15), C(25), C(15)));
        }

        [Test]
        public void Reach_stops_at_the_radius()
        {
            var t = new byte[100 * 3];
            var rule = new VisionRule(new MapBlob(100, 3, t));
            Assert.IsTrue(rule.RevealsTile(C(5), C(1), 5 + 28, 1)); // 28 tiles = 896 u + centre offset within 900
            Assert.IsFalse(rule.RevealsTile(C(5), C(1), 5 + 30, 1));
        }

        [Test]
        public void Tiles_expire_thirty_seconds_after_the_eyes_last_reached_them_and_not_before()
        {
            var f = new VisionField(new VisionRule(Split()));
            f.Update(C(10), C(15), 1000);
            Assert.IsFalse(f.IsFogged(10, 15));
            Assert.IsTrue(f.IsFogged(25, 15), "behind the wall");
            // Walk away: the old tiles stay seen for the trail, then re-fog.
            f.Update(C(30), C(15), 1100);
            Assert.IsFalse(f.IsFogged(8, 15), "remembered");
            f.Update(C(30), C(15), 1000 + 29900);
            Assert.IsFalse(f.IsFogged(5, 15), "29.9 s later");
            f.Update(C(30), C(15), 1000 + 30000);
            Assert.IsTrue(f.IsFogged(5, 15), "30 s later (exclusive deadline)");
            Assert.IsFalse(f.IsFogged(30, 15), "where the eyes are now");
        }

        [Test]
        public void Standing_still_keeps_the_view_alive_past_thirty_seconds()
        {
            var f = new VisionField(new VisionRule(Split()));
            for (double t = 0; t <= 90000; t += 50) f.Update(C(10), C(15), t);
            Assert.IsFalse(f.IsFogged(10, 15));
            Assert.IsFalse(f.IsFogged(12, 15));
        }

        [Test]
        public void Samples_are_taken_at_the_server_cadence()
        {
            var f = new VisionField(new VisionRule(Split()));
            f.Update(C(5), C(15), 0);
            f.Update(C(14), C(15), 50);   // too soon: ignored
            Assert.IsTrue(f.IsFogged(14 + 12, 15), "beyond the first sample's reach, second sample not taken");
            f.Update(C(14), C(15), 100);
            Assert.IsFalse(f.IsFogged(19, 15), "second sample taken at 100 ms");
        }

        [Test]
        public void The_dirty_rectangle_covers_every_changed_tile_and_clears_when_taken()
        {
            var f = new VisionField(new VisionRule(Open()));
            f.TakeDirty(out _, out _, out _, out _);
            var before = (byte[])f.Fogged.Clone();
            f.Update(C(20), C(15), 0);
            Assert.IsTrue(f.TakeDirty(out int x0, out int y0, out int x1, out int y1));
            for (int i = 0; i < before.Length; i++)
                if (before[i] != f.Fogged[i]) Assert.IsTrue(i % W >= x0 && i % W <= x1 && i / W >= y0 && i / W <= y1, "tile " + i + " changed outside the rectangle");
            Assert.IsFalse(f.TakeDirty(out _, out _, out _, out _));
        }

        [Test]
        public void A_clock_that_runs_backwards_starts_a_fresh_timeline()
        {
            var f = new VisionField(new VisionRule(Open()));
            f.Update(C(2), C(15), 50000);
            Assert.IsFalse(f.IsFogged(5, 15));
            f.Update(C(38), C(15), 100);
            Assert.IsTrue(f.IsFogged(5, 15), "stamps from the later timeline are not kept");
            Assert.IsFalse(f.IsFogged(38, 15));
        }

        [Test]
        public void Standing_in_the_coliseum_reveals_its_whole_rectangle()
        {
            var regions = new byte[W * H];
            for (int y = 10; y < 20; y++) for (int x = 10; x < 20; x++) regions[y * W + x] = VisionRule.RegionColiseum;
            var tiles = Open().Tiles;
            for (int y = 10; y < 20; y++) tiles[y * W + 15] = 1; // an interior wall that would otherwise split it
            var rule = new VisionRule(new MapBlob(W, H, tiles, null, regions, MapBlob.GroundTerrainOff));
            Assert.IsTrue(rule.RevealsTile(C(11), C(11), 18, 18));
            Assert.IsFalse(rule.RevealsTile(C(5), C(5), 18, 18), "outside it the wall blocks as usual");
        }

        // ---- fog mask ----

        static FogMask MaskFor(VisionField f, int soft = 2)
        {
            var m = new FogMask(f.Width, f.Height) { Softness = soft };
            m.RebuildAll(f);
            return m;
        }

        [Test]
        public void The_mask_is_clear_where_seen_full_where_unseen_and_soft_between()
        {
            var f = new VisionField(new VisionRule(Split()));
            f.Update(C(10), C(15), 0);
            var m = MaskFor(f);
            Assert.AreEqual(0, m.Alpha[15 * W + 10]);
            Assert.AreEqual(255, m.Alpha[15 * W + 34], "deep in unseen ground");
            bool soft = false;
            for (int x = 0; x < W; x++) { int a = m.Alpha[15 * W + x]; if (a > 0 && a < 255) soft = true; }
            Assert.IsTrue(soft, "the edge has intermediate values");
        }

        [Test]
        public void Softness_zero_is_a_hard_tile_edge_and_never_turns_the_fog_off()
        {
            var f = new VisionField(new VisionRule(Split()));
            f.Update(C(10), C(15), 0);
            var m = MaskFor(f, 0);
            for (int i = 0; i < m.Alpha.Length; i++) Assert.AreEqual(f.Fogged[i] != 0 ? 255 : 0, m.Alpha[i]);
        }

        [Test]
        public void A_delivered_actor_in_fog_is_always_cleared_around_it()
        {
            var f = new VisionField(new VisionRule(Split()));
            f.Update(C(10), C(15), 0);
            var m = MaskFor(f);
            int tx = 30, ty = 15; // behind the wall: the client's own sight says fog
            Assert.AreEqual(255, m.Alpha[ty * W + tx]);
            var list = new[] { new FogClearing(tx + 0.5f, ty + 0.5f, 1f) };
            m.Compose(list, 1);
            Assert.AreEqual(0, m.Alpha[ty * W + tx], "the actor's own tile");
            Assert.AreEqual(0, m.Alpha[ty * W + tx + 1], "an adjacent tile");
            Assert.Greater(m.Alpha[ty * W + tx + 5], 200, "far from the actor the fog stays");
        }

        [Test]
        public void Clearing_never_adds_fog_and_a_fading_clearing_fades()
        {
            var f = new VisionField(new VisionRule(Split()));
            f.Update(C(10), C(15), 0);
            var m = MaskFor(f);
            var before = (byte[])m.Alpha.Clone();
            m.Compose(new[] { new FogClearing(30.5f, 15.5f, 1f), new FogClearing(10.5f, 15.5f, 1f) }, 2);
            for (int i = 0; i < before.Length; i++) Assert.LessOrEqual(m.Alpha[i], before[i]);
            m.Compose(new[] { new FogClearing(30.5f, 15.5f, 0.5f) }, 1);
            int half = m.Alpha[15 * W + 30];
            Assert.That(half, Is.InRange(100, 160), "half-strength clearing leaves about half the fog");
        }

        [Test]
        public void Compose_restores_the_fog_when_the_actor_has_gone()
        {
            var f = new VisionField(new VisionRule(Split()));
            f.Update(C(10), C(15), 0);
            var m = MaskFor(f);
            var before = (byte[])m.Alpha.Clone();
            m.Compose(new[] { new FogClearing(30.5f, 15.5f, 1f) }, 1);
            m.Compose(new FogClearing[0], 0);
            CollectionAssert.AreEqual(before, m.Alpha);
        }

        [Test]
        public void More_clearings_than_remembered_boxes_still_restore_cleanly()
        {
            var f = new VisionField(new VisionRule(Split()));
            f.Update(C(10), C(15), 0);
            var m = MaskFor(f);
            var before = (byte[])m.Alpha.Clone();
            var many = new FogClearing[300];
            for (int i = 0; i < many.Length; i++) many[i] = new FogClearing(22 + i % 15, 5 + i % 20, 1f);
            m.Compose(many, many.Length);
            m.Compose(new FogClearing[0], 0);
            CollectionAssert.AreEqual(before, m.Alpha);
        }

        [Test]
        public void An_incremental_rebuild_equals_a_full_rebuild()
        {
            var rule = new VisionRule(Split());
            var f = new VisionField(rule);
            var m = new FogMask(W, H);
            m.RebuildAll(f); f.TakeDirty(out _, out _, out _, out _);
            double[][] path = { new[] { C(5), C(10) }, new[] { C(8), C(12) }, new[] { C(14), C(20) }, new[] { C(14), C(24) } };
            double t = 0;
            foreach (var p in path)
            {
                t += 100; f.Update(p[0], p[1], t);
                if (f.TakeDirty(out int a, out int b, out int c, out int d)) m.Rebuild(f, a, b, c, d);
            }
            var full = new FogMask(W, H); full.RebuildAll(f);
            CollectionAssert.AreEqual(full.Base, m.Base);
        }

        // ---- graceful exit ----

        [Test]
        public void Only_a_living_actor_in_a_running_match_fades_out()
        {
            Assert.AreEqual(DepartureCause.LeftSight, VisionFade.Classify(ActorStatus.Alive, false, true, false));
            Assert.AreEqual(DepartureCause.Died, VisionFade.Classify(ActorStatus.Dead, false, true, false));
            Assert.AreEqual(DepartureCause.Died, VisionFade.Classify(ActorStatus.Mia, false, true, false));
            Assert.AreEqual(DepartureCause.Died, VisionFade.Classify(ActorStatus.Alive, true, true, false), "a Death event names it");
            Assert.AreEqual(DepartureCause.LeftMatch, VisionFade.Classify(ActorStatus.Alive, false, false, false), "lobby, planning or ended");
            Assert.AreEqual(DepartureCause.LeftMatch, VisionFade.Classify(ActorStatus.Lobby, false, true, false));
            Assert.AreEqual(DepartureCause.Reset, VisionFade.Classify(ActorStatus.Alive, false, true, true), "welcome, resume or clock cut");
            Assert.AreEqual(DepartureCause.Reset, VisionFade.Classify(ActorStatus.Dead, true, false, true), "a cut beats everything");
        }

        [Test]
        public void Fades_are_monotonic_bounded_and_the_right_length()
        {
            Assert.AreEqual(1f, VisionFade.ExitAlpha(0f));
            Assert.AreEqual(0f, VisionFade.ExitAlpha(VisionFade.ExitSeconds));
            Assert.AreEqual(0f, VisionFade.ExitAlpha(5f));
            Assert.AreEqual(0.5f, VisionFade.ExitAlpha(VisionFade.ExitSeconds / 2), 1e-5);
            float last = 1f;
            for (float t = 0; t <= 0.3f; t += 0.01f) { float a = VisionFade.ExitAlpha(t); Assert.LessOrEqual(a, last + 1e-6f); last = a; }
            Assert.AreEqual(0f, VisionFade.EnterAlpha(0f));
            Assert.AreEqual(1f, VisionFade.EnterAlpha(VisionFade.EnterSeconds));
            Assert.That(VisionFade.ExitSeconds, Is.InRange(0.2f, 0.3f));
            Assert.That(VisionFade.EnterSeconds, Is.InRange(0.1f, 0.15f));
            Assert.AreEqual(0.4f, VisionFade.ExitAlpha(0f, 0.4f), 1e-6, "an exit that began half-faded continues from there");
        }

        [Test]
        public void Re_entering_while_fading_out_continues_from_the_current_opacity()
        {
            float a = VisionFade.ExitAlpha(0.1f);
            float e = VisionFade.EnterElapsedFor(a);
            Assert.AreEqual(a, VisionFade.EnterAlpha(e), 0.02f);
        }

        [Test]
        public void Recent_deaths_are_remembered_for_a_few_seconds()
        {
            var d = new RecentDeaths(4);
            d.Note(7, 10f);
            Assert.IsTrue(d.Contains(7, 12.9f));
            Assert.IsFalse(d.Contains(7, 13.5f));
            Assert.IsFalse(d.Contains(8, 10f));
            for (uint i = 100; i < 110; i++) d.Note(i, 20f); // wraps the ring
            Assert.IsFalse(d.Contains(7, 20.5f));
            Assert.IsTrue(d.Contains(109, 20.5f));
        }
    }
}

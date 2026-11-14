using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using NUnit.Framework;
using Roguehalla.Client;
using Roguehalla.Net.Protocol;
using Roguehalla.Net.Ui;
using UnityEngine;
using MapRect = Roguehalla.Net.Protocol.MapRect;   // Net.Ui has a MapRect of its own (the map screen's)

namespace Roguehalla.Client.Tests
{
    /// <summary>
    /// P-UNITY-LANDMARK-ROOF-RETURN-1 oracle (owner ruling 2026-11-13). A landmark roof or canopy has three states: the local player under it
    /// is the faded alpha (about 10 percent, still faintly there); only another delivered actor under it is the peek alpha (about half);
    /// nobody is opaque; the local player's rule wins. The local player is noted with LandmarkView.NoteActor, any other delivered actor with
    /// LandmarkView.NoteOtherActor. The two rigs are the real cave drawing stamped in a map and a cover handed over by SetCover (the church
    /// and bog canopy use the same framework path; their own tests carry the ruling too). The ArenaView call sites are pinned by a source
    /// check (last test): driving a real ArenaView on a fake transport just to count one note per call site is not practical.
    /// </summary>
    public sealed class LandmarkRoofPeekEditModeTests
    {
        const int N = 48, FootX = 9, FootY = 7, Size = 29;

        [TearDown] public void ClearArtOverrides() { LandmarkArts.ClearOverrides(); }

        static Vector3 TileCentre(int x, int y) { return ArenaView.WorldPoint((x + .5f) * 32f, (y + .5f) * 32f); }

        sealed class Scene : IDisposable
        {
            public readonly GameObject Root = new GameObject("roof peek test root"); public LandmarkView View;
            public Scene(MapBlob map, params MapAnchor[] anchors) { View = LandmarkView.Build(Root.transform, map, anchors); }
            public void Dispose() { if (View != null) View.Dispose(); UnityEngine.Object.DestroyImmediate(Root); }
        }

        /// <summary>A built landmark and three world points: two on tiles that fade it, one outside the cover.</summary>
        sealed class Rig : IDisposable
        {
            public Scene Scene; public Landmark Lm; public LandmarkView View; public Vector3 InsideA, InsideB, Outside;
            public void Dispose() { Scene.Dispose(); }
        }

        static Rig CaveRig()
        {
            string path = Path.GetFullPath(Path.Combine(Application.dataPath, "../../../docs/landmarks/blueprints/cave.txt"));
            Assert.That(File.Exists(path), "blueprint missing: " + path);
            var rows = File.ReadAllLines(path).Where(l => l.Length > 0 && l[0] != ';').ToArray();
            var tiles = new byte[N * N]; var terrain = new byte[N * N]; var regions = new byte[N * N];
            for (int i = 0; i < regions.Length; i++) regions[i] = 4;
            var mouth = new List<(int x, int y)>(); (int x, int y) camp = (0, 0);
            for (int y = 0; y < Size; y++) for (int x = 0; x < Size; x++)
            {
                char c = rows[y][x]; int i = (FootY + y) * N + FootX + x;
                if (c == '#' || c == 'R') tiles[i] = MapBlob.Wall;
                if (c == '=') terrain[i] = (byte)TerrainKind.Ice;
                if (c == 'D') mouth.Add((FootX + x, FootY + y));
                if (c == 'E') camp = (FootX + x, FootY + y);
            }
            var anchor = new MapAnchor(4, MapBlob.AnchorKindCave, new MapTile((ushort)camp.x, (ushort)camp.y), new MapRect(FootX, FootY, Size, Size), 4,
                mouth.Select(m => new MapTile((ushort)m.x, (ushort)m.y)).ToArray());
            var map = new MapBlob(N, N, tiles, terrain, regions, MapBlob.GroundTerrainAll);
            var scene = new Scene(map, anchor);
            Assert.That(scene.View.Count, Is.EqualTo(1), "needs the cave landmark first");
            return new Rig { Scene = scene, View = scene.View, Lm = scene.View.Get(0), InsideA = TileCentre(camp.x, camp.y), InsideB = TileCentre(camp.x + 1, camp.y + 3),
                Outside = TileCentre(mouth[0].x, mouth[0].y + 4) };
        }

        static Rig CoverRig()
        {
            const byte Kind = MapBlob.AnchorKindChurch;
            var cover = new List<(int x, int y)> { (14, 14), (15, 14), (14, 15), (18, 17), (11, 18) };
            LandmarkArts.SetOverride(Kind, lm =>
            {
                lm.SetCover(cover.Select(c => new MapTile((ushort)c.x, (ushort)c.y)));
                var go = new GameObject("roof"); go.transform.SetParent(lm.Root.transform, false);
                lm.AddRoofRenderer(go.AddComponent<SpriteRenderer>());
            });
            var regions = new byte[40 * 40];
            for (int i = 0; i < regions.Length; i++) regions[i] = 2;
            var map = new MapBlob(40, 40, new byte[40 * 40], null, regions);
            var anchor = new MapAnchor(2, Kind, new MapTile(15, 15), new MapRect(10, 10, 10, 10), 4, new MapTile[0]);
            var scene = new Scene(map, anchor);
            Assert.That(scene.View.Count, Is.EqualTo(1), "needs the landmark first");
            return new Rig { Scene = scene, View = scene.View, Lm = scene.View.Get(0), InsideA = TileCentre(14, 14), InsideB = TileCentre(18, 17), Outside = TileCentre(19, 19) };
        }

        static IEnumerable<string> Rigs() { return new[] { "cave", "cover" }; }
        static Rig Make(string which) { return which == "cave" ? CaveRig() : CoverRig(); }

        /// <summary>One frame: the notes of the case (local player first, then the others), then a long Tick so the roof settles.</summary>
        static float Settle(Rig r, Vector3? local, params Vector3[] others)
        {
            if (local.HasValue) r.View.NoteActor(local.Value);
            foreach (var o in others) r.View.NoteOtherActor(o);
            r.View.Tick(10f);
            return r.Lm.RoofAlpha;
        }

        // ---- the constants ---------------------------------------------------------------------------------------------------

        [Test]
        public void TheFadedAlphaIsMostlySeeThroughButStillThereAndThePeekAlphaIsAboutHalf()
        {
            Assert.That(LandmarkView.RoofFadedAlpha, Is.GreaterThan(0f).And.LessThanOrEqualTo(.15f), "owner: about 10 percent, faintly there so the player knows they are under a roof");
            Assert.That(LandmarkView.RoofPeekAlpha, Is.InRange(.4f, .6f), "owner: about one half");
            Assert.That(LandmarkView.RoofFadedAlpha, Is.LessThan(LandmarkView.RoofPeekAlpha));
            Assert.That(LandmarkView.RoofPeekAlpha, Is.LessThan(LandmarkView.RoofOpaqueAlpha));
        }

        // ---- the three states and the precedence ----------------------------------------------------------------------------------

        [TestCaseSource(nameof(Rigs))]
        public void TheLocalPlayerInsideFadesTheRoofToTheFadedAlpha(string which)
        {
            using (var r = Make(which))
                Assert.That(Settle(r, r.InsideA), Is.EqualTo(LandmarkView.RoofFadedAlpha));
        }

        [TestCaseSource(nameof(Rigs))]
        public void OnlyAnotherActorInsideMakesTheRoofPeekAndTheDrawnPiecesCarryIt(string which)
        {
            using (var r = Make(which))
            {
                Assert.That(Settle(r, r.Outside, r.InsideA), Is.EqualTo(LandmarkView.RoofPeekAlpha), "the local player outside, a delivered actor inside");
                foreach (var piece in r.Lm.RoofRenderers) Assert.That(piece.color.a, Is.EqualTo(LandmarkView.RoofPeekAlpha).Within(.001f), "the drawn roof carries the peek alpha");
                Assert.That(Settle(r, null, r.InsideA, r.InsideB), Is.EqualTo(LandmarkView.RoofPeekAlpha), "no local player note at all (dead or unseen), two actors inside");
            }
        }

        [TestCaseSource(nameof(Rigs))]
        public void NobodyDeliveredInsideLeavesTheRoofOpaque(string which)
        {
            using (var r = Make(which))
            {
                Assert.That(Settle(r, null), Is.EqualTo(LandmarkView.RoofOpaqueAlpha), "no notes");
                Assert.That(Settle(r, r.Outside, r.Outside), Is.EqualTo(LandmarkView.RoofOpaqueAlpha), "everyone outside the cover");
            }
        }

        [TestCaseSource(nameof(Rigs))]
        public void WhenTheLocalPlayerAndAnotherActorAreBothInsideTheLocalRuleWinsAndItIsFaded(string which)
        {
            using (var r = Make(which))
            {
                Assert.That(Settle(r, r.InsideA, r.InsideB), Is.EqualTo(LandmarkView.RoofFadedAlpha));
                Assert.That(Settle(r, r.InsideA, r.InsideA), Is.EqualTo(LandmarkView.RoofFadedAlpha), "even on the same tile");
                // The order of the notes inside one frame does not matter.
                r.View.NoteOtherActor(r.InsideB); r.View.NoteActor(r.InsideA); r.View.Tick(10f);
                Assert.That(r.Lm.RoofAlpha, Is.EqualTo(LandmarkView.RoofFadedAlpha), "the other actor noted first, the local player second");
            }
        }

        // ---- leaving and the transitions ------------------------------------------------------------------------------------------

        [TestCaseSource(nameof(Rigs))]
        public void LeavingRestoresOpaqueFromEitherStateAtTheUsualFadeRate(string which)
        {
            using (var r = Make(which))
            {
                Assert.That(Settle(r, r.InsideA), Is.EqualTo(LandmarkView.RoofFadedAlpha));
                Assert.That(Settle(r, null), Is.EqualTo(LandmarkView.RoofOpaqueAlpha), "the local player left, nobody else: opaque");
                Assert.That(Settle(r, null, r.InsideA), Is.EqualTo(LandmarkView.RoofPeekAlpha));
                Assert.That(Settle(r, null), Is.EqualTo(LandmarkView.RoofOpaqueAlpha), "the other actor stopped being delivered: opaque");
                // The rate: one short frame from opaque moves toward peek by FadeRate * dt, not in one step.
                r.View.NoteOtherActor(r.InsideA); r.View.Tick(.01f);
                Assert.That(r.Lm.RoofAlpha, Is.EqualTo(LandmarkView.RoofOpaqueAlpha - PropFade.FadeRate * .01f).Within(.002f), "the same rate as tall props");
                Assert.That(r.Lm.RoofAlpha, Is.GreaterThan(LandmarkView.RoofPeekAlpha));
                foreach (var piece in r.Lm.RoofRenderers) Assert.That(piece.color.a, Is.EqualTo(r.Lm.RoofAlpha).Within(.001f));
            }
        }

        [TestCaseSource(nameof(Rigs))]
        public void ThePlayerWalkingInGoesFromPeekToFadedAndWalkingOutWhileAMobStaysGoesBackToPeek(string which)
        {
            using (var r = Make(which))
            {
                Assert.That(Settle(r, r.Outside, r.InsideB), Is.EqualTo(LandmarkView.RoofPeekAlpha), "player outside, mob inside");
                Assert.That(Settle(r, r.InsideA, r.InsideB), Is.EqualTo(LandmarkView.RoofFadedAlpha), "the player walks in: faded");
                Assert.That(Settle(r, r.Outside, r.InsideB), Is.EqualTo(LandmarkView.RoofPeekAlpha), "the player walks out, the mob stays: back to peek, not opaque");
                Assert.That(Settle(r, r.Outside), Is.EqualTo(LandmarkView.RoofOpaqueAlpha), "the mob is no longer delivered: opaque");
            }
        }

        [TestCaseSource(nameof(Rigs))]
        public void PeekToFadedAndBackMoveAtTheFadeRateAndNeverOvershoot(string which)
        {
            using (var r = Make(which))
            {
                Settle(r, r.Outside, r.InsideB);
                r.View.NoteActor(r.InsideA); r.View.NoteOtherActor(r.InsideB); r.View.Tick(.01f);
                Assert.That(r.Lm.RoofAlpha, Is.EqualTo(LandmarkView.RoofPeekAlpha - PropFade.FadeRate * .01f).Within(.002f), "peek toward faded by the fade rate");
                Settle(r, r.InsideA, r.InsideB);
                r.View.NoteOtherActor(r.InsideB); r.View.Tick(.01f);
                Assert.That(r.Lm.RoofAlpha, Is.EqualTo(LandmarkView.RoofFadedAlpha + PropFade.FadeRate * .01f).Within(.002f), "faded toward peek by the fade rate");
                for (int i = 0; i < 600; i++)
                {
                    r.View.NoteOtherActor(r.InsideB); r.View.Tick(1f / 60f);
                    Assert.That(r.Lm.RoofAlpha, Is.InRange(LandmarkView.RoofFadedAlpha, LandmarkView.RoofPeekAlpha));
                }
                Assert.That(r.Lm.RoofAlpha, Is.EqualTo(LandmarkView.RoofPeekAlpha));
            }
        }

        // ---- the call sites -----------------------------------------------------------------------------------------------------------

        [Test]
        public void ArenaViewNotesTheLocalPlayerWithNoteActorAndTheOtherTwoCallSitesWithNoteOtherActor()
        {
            // Source check, not a driven ArenaView: the local player's call (WorldPoint(mx, my), the drawn self) uses the local form; the remote-player
            // loop and PresentLatestNpcs (WorldPoint(a.X, a.Y)) use the other form. Three call sites, no more.
            string path = Path.Combine(Application.dataPath, "Scripts/View/ArenaView.cs");
            var lines = File.ReadAllLines(path).Where(l => l.Contains("_landmarks.Note")).Select(l => l.Trim()).ToArray();
            Assert.That(lines.Length, Is.EqualTo(3), "exactly three landmark note call sites:\n" + string.Join("\n", lines));
            var local = lines.Where(l => l.Contains("WorldPoint(mx, my)")).ToArray();
            var others = lines.Where(l => l.Contains("WorldPoint(a.X, a.Y)")).ToArray();
            Assert.That(local.Length, Is.EqualTo(1), "one call for the local player");
            Assert.That(others.Length, Is.EqualTo(2), "two calls for other actors (remote players, NPCs)");
            Assert.That(local[0], Does.Contain("_landmarks.NoteActor(").And.Not.Contain("NoteOtherActor"), "the local player's note");
            foreach (var l in others) Assert.That(l, Does.Contain("_landmarks.NoteOtherActor("), "another actor's note: " + l);
        }
    }
}

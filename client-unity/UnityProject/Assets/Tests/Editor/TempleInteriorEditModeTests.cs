using System.Collections.Generic;
using System.IO;
using NUnit.Framework;
using Roguehalla.Client;
using Roguehalla.Net.Protocol;
using UnityEngine;

namespace Roguehalla.Client.Tests
{
    /// <summary>The Holy temple as ONE building: structural grid, piers without domes, open arcade and portals (nothing collision-like), overhead props that fade, the interior hook.</summary>
    public sealed class TempleInteriorEditModeTests
    {
        [System.Serializable] class MapJson { public int w, h; public int[] tiles, terrain, regionGrid; }
        [System.Serializable] class FileJson { public MapJson map; }
        static readonly string[] Seeds = { "seed1.map.json", "seed2.map.json" };

        static MapBlob Load(string name)
        {
            string path = Path.GetFullPath(Path.Combine(Application.dataPath, "../../../crates/rh-sim/src/mapdata/fixtures/" + name));
            Assume.That(File.Exists(path), "fixture missing: " + path);
            var m = JsonUtility.FromJson<FileJson>(File.ReadAllText(path)).map;
            byte[] B(int[] a) { var o = new byte[a.Length]; for (int i = 0; i < a.Length; i++) o[i] = (byte)a[i]; return o; }
            return new MapBlob((ushort)m.w, (ushort)m.h, B(m.tiles), B(m.terrain), B(m.regionGrid), MapBlob.GroundTerrainAll);
        }

        [TestCaseSource(nameof(Seeds))]
        public void PiersSitOnTheStructuralGridAndTheCrossingIsAnAisleIntersection(string seed)
        {
            var t = TempleLayout.Detect(Load(seed)); Assert.That(t.Found, Is.True);
            Assert.That(Mathf.Abs(t.CenterX - t.Center.x), Is.EqualTo(0f));
            foreach (var o in t.Pillars)
            {
                Assert.That(Mathf.Repeat(o.x + 1.5f - t.PierPhaseX, TempleLayout.Pitch), Is.EqualTo(0f).Within(.001f).Or.EqualTo(TempleLayout.Pitch).Within(.001f), "pier x " + o.x);
                Assert.That(Mathf.Repeat(o.y + 1.5f - t.PierPhaseY, TempleLayout.Pitch), Is.EqualTo(0f).Within(.001f).Or.EqualTo(TempleLayout.Pitch).Within(.001f), "pier y " + o.y);
            }
            Assert.That(Mathf.Abs(t.CenterX - (t.X0 + t.Size * .5f)), Is.LessThanOrEqualTo(TempleLayout.Pitch * .5f + .01f), "crossing near the middle");
            Assert.That(Mathf.Abs(t.CenterY - (t.Y0 + t.Size * .5f)), Is.LessThanOrEqualTo(TempleLayout.Pitch * .5f + .01f));
        }

        [TestCaseSource(nameof(Seeds))]
        public void NoDomeRoofOrFinialAnywhereAndNothingStandsOnAPier(string seed)
        {
            var map = Load(seed); var t = TempleLayout.Detect(map);
            foreach (var key in RegionPropArt.Keys) foreach (var bad in new[] { "dome", "roof", "finial", "cupola", "kiosk" }) Assert.That(key.ToLowerInvariant(), Does.Not.Contain(bad), "prop art " + key);
            Assert.That(t.Props.Count, Is.GreaterThan(20));
            foreach (var d in t.Props)
            {
                foreach (var bad in new[] { "dome", "roof", "finial", "cupola", "kiosk" }) Assert.That(d.Art, Does.Not.Contain(bad));
                Assert.That(d.Bias, Is.EqualTo(0), "no prop is raised onto a pier cap: " + d.Art);
                int tx = Mathf.FloorToInt(d.X), ty = Mathf.FloorToInt(d.Y);
                Assert.That(t.TryBlock(tx, ty, out _, out _), Is.False, d.Art + " stands on a pier at " + tx + "," + ty);
                Assert.That(map.Tiles[ty * map.W + tx], Is.EqualTo(MapBlob.Floor), d.Art + " must stand on floor");
            }
        }

        [TestCaseSource(nameof(Seeds))]
        public void EveryOverheadTempleElementIsTallSoItFadesNearActors(string seed)
        {
            var t = TempleLayout.Detect(Load(seed)); var seen = new HashSet<string>();
            foreach (var d in t.Props)
            {
                seen.Add(d.Art);
                Assert.That(RegionPropArt.TryGet(d.Art, out var art), Is.True, d.Art);
                if (TempleLayout.IsOverhead(d.Art)) Assert.That(art.Tall, Is.True, d.Art + " rises above the floor, so it must use the fade rule");
                else Assert.That(art.Height, Is.LessThan(1.2f), d.Art + " is a low floor prop");
            }
            Assert.That(seen, Does.Contain("temple.minaret").And.Contain("temple.column").And.Contain("temple.mihrab"));
        }

        [Test]
        public void OverheadPropsFadeWhenAnActorStandsBehindThemAndNothingHidesAnActor()
        {
            var map = Load("seed1.map.json"); var t = TempleLayout.For(map);
            var root = new GameObject("test root"); RegionProps props = null;
            try
            {
                props = RegionProps.Build(root.transform, map);
                var pl = RegionProps.Scatter(map).Find(p => p.Art == "temple.column");
                Assert.That(pl.Art, Is.EqualTo("temple.column"));
                var feet = ArenaView.WorldPoint(pl.X * 32f, (pl.Y - .6f) * 32f);          // just north of the column: the column draws over it
                SpriteRenderer found = null;
                foreach (var sr in root.GetComponentsInChildren<SpriteRenderer>())
                    if (sr.name == "temple.column" && Mathf.Abs(sr.transform.localPosition.x - ArenaView.WorldPoint(pl.X * 32f, pl.Y * 32f).x) < .001f && Mathf.Abs(sr.transform.localPosition.y - ArenaView.WorldPoint(pl.X * 32f, pl.Y * 32f).y) < .001f) found = sr;
                Assert.That(found, Is.Not.Null);
                Assert.That(found.color.a, Is.EqualTo(1f));
                for (int i = 0; i < 12; i++) { props.NoteActor(feet); props.Tick(.1f); }
                Assert.That(found.color.a, Is.LessThanOrEqualTo(Roguehalla.Net.Ui.PropFade.FadedAlpha + .02f), "a tall temple prop fades to nearly see-through over an actor");
            }
            finally { if (props != null) props.Dispose(); Object.DestroyImmediate(root); }
        }

        [TestCaseSource(nameof(Seeds))]
        public void NothingCollisionLikeStandsOnTheOpenFootprintBoundary(string seed)
        {
            var map = Load(seed); var t = TempleLayout.Detect(map);
            foreach (var d in t.Props)
            {
                float edge = Mathf.Min(Mathf.Min(d.X - t.X0, t.X0 + t.Size - d.X), Mathf.Min(d.Y - t.Y0, t.Y0 + t.Size - d.Y));
                Assert.That(edge, Is.GreaterThanOrEqualTo(1.4f), d.Art + " too close to the footprint edge: the edge is ordinary floor and nothing there may look like a wall");
            }
            // The colonnade is open: slim columns with gaps of at least two tiles between neighbours.
            var cols = t.Props.FindAll(d => d.Art == "temple.column");
            Assert.That(cols.Count, Is.GreaterThan(12));
            foreach (var a in cols) foreach (var b in cols) if (!ReferenceEquals(a, b) && (a.X != b.X || a.Y != b.Y)) Assert.That(Vector2.Distance(new Vector2(a.X, a.Y), new Vector2(b.X, b.Y)), Is.GreaterThanOrEqualTo(2.0f), "open colonnade: gaps between columns " + a.X + "," + a.Y + " vs " + b.X + "," + b.Y);
            // Open portals have a clear three tile wide corridor from the edge inward.
            foreach (var p in t.Portals)
            {
                if (!p.Open) continue;
                for (int d = -1; d <= 1; d++) for (int depth = 1; depth <= 6; depth++)
                {
                    int px = p.Side == TempleLayout.Side.South ? Mathf.FloorToInt(p.Axis) + d : p.Side == TempleLayout.Side.East ? t.X0 + t.Size - depth : t.X0 + depth - 1;
                    int py = p.Side == TempleLayout.Side.South ? t.Y0 + t.Size - depth : Mathf.FloorToInt(p.Axis) + d;
                    Assert.That(map.Tiles[py * map.W + px], Is.EqualTo(MapBlob.Floor), "portal " + p.Side + " corridor blocked at " + px + "," + py);
                }
            }
            Assert.That(t.Portals[(int)TempleLayout.Side.South].Open || t.Portals[(int)TempleLayout.Side.East].Open || t.Portals[(int)TempleLayout.Side.West].Open, Is.True, "at least one grand portal");
        }

        [TestCaseSource(nameof(Seeds))]
        public void TheInteriorHookAnswersInsideAndOutside(string seed)
        {
            var map = Load(seed); var t = TempleLayout.For(map);
            var rm = new RegionMap(); rm.Load(map); var s = new SurfaceMap(rm); s.AddLayer(t);
            var c = t.Center;
            Assert.That(s.InsideTempleTile((int)c.x, (int)c.y), Is.True);
            Assert.That(s.InsideTemple(ArenaView.WorldPoint(c.x * 32f, c.y * 32f)), Is.True);
            Assert.That(t.InsideTemple(ArenaView.WorldPoint(c.x * 32f, c.y * 32f)), Is.True);
            Assert.That(s.InsideTempleTile(t.X0 - 3, (int)c.y), Is.False);
            Assert.That(t.InsideTemple(ArenaView.WorldPoint((t.X0 - 3) * 32f, c.y * 32f)), Is.False);
        }

        [TestCaseSource(nameof(Seeds))]
        public void LampSitesAreDeterministicAndFewEnoughForThePooledLights(string seed)
        {
            var a = TempleLayout.Detect(Load(seed)); var b = TempleLayout.Detect(Load(seed));
            Assert.That(b.Lamps, Is.EqualTo(a.Lamps)); Assert.That(a.Lamps.Count, Is.InRange(3, 10));
            var planner = new AccentLightPlanner(); foreach (var l in a.Lamps) planner.AddTempleLamp(l.x, l.y, .85f);
            var pick = new int[AtmosphereQuality.HardMaxLights];
            int n = planner.Select(a.Center.x - 8, a.Center.y - 5, a.Center.x + 8, a.Center.y + 5, AccentLights.CullMargin, 4, pick);
            Assert.That(n, Is.LessThanOrEqualTo(4), "the quality cap applies to temple lamps too");
            int far = planner.Select(0, 0, 10, 10, AccentLights.CullMargin, 8, pick);
            Assert.That(far, Is.EqualTo(0), "lamps far from the camera are culled");
        }
    }
}

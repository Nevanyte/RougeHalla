using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using NUnit.Framework;
using Roguehalla.Client;
using Roguehalla.Net.Protocol;
using Roguehalla.Net.Ui;
using UnityEngine;

namespace Roguehalla.Client.Tests
{
    /// <summary>
    /// P-UNITY-DRESS-1 oracle, Unity half: a map blob that carries the server's decoration (MapBlob.Props, GroundVariants) is drawn
    /// as sent and the client rolls none of its own; a blob without keeps today's scatter. Props are found the way the existing tests
    /// find them (RegionProps.Build under a parent: one SpriteRenderer per drawn prop, named by its sprite key, at
    /// ArenaView.WorldPoint of the prop's world position). The kind and variant tables are checked in
    /// RoguehallaNet.Tests/DecorationKindsTests.cs.
    /// </summary>
    public sealed class DressedMapEditModeTests
    {
        // ---- maps ---------------------------------------------------------------------------------------------------------------

        [System.Serializable] class MapJson { public int w, h; public int[] tiles, terrain, regionGrid; }
        [System.Serializable] class FileJson { public MapJson map; }

        /// <summary>A checked-in fixture (crates/rh-sim/src/mapdata/fixtures), never a freshly generated map.</summary>
        static MapBlob Seed1()
        {
            string path = Path.GetFullPath(Path.Combine(Application.dataPath, "../../../crates/rh-sim/src/mapdata/fixtures/seed1.map.json"));
            Assume.That(File.Exists(path), "fixture missing: " + path);
            var m = JsonUtility.FromJson<FileJson>(File.ReadAllText(path)).map;
            byte[] B(int[] a) { var o = new byte[a.Length]; for (int i = 0; i < a.Length; i++) o[i] = (byte)a[i]; return o; }
            return new MapBlob((ushort)m.w, (ushort)m.h, B(m.tiles), B(m.terrain), B(m.regionGrid), MapBlob.GroundTerrainAll);
        }

        /// <summary>40 x 40 open floor, left half Plague (3), right half Frost (4): no temple, no coliseum, and a scatter that places props today.</summary>
        static MapBlob Open()
        {
            const int n = 40; var regions = new byte[n * n];
            for (int y = 0; y < n; y++) for (int x = 0; x < n; x++) regions[y * n + x] = (byte)(x < n / 2 ? 3 : 4);
            return new MapBlob(n, n, new byte[n * n], null, regions);
        }

        // rows are (kind, x, y, variant, flags) in world units (32 per tile), sorted by (y, x, kind) as the server sends them
        static readonly MapProp[] Known =
        {
            new MapProp(33, 176, 208, 0, 1),    // frost.pine, tall
            new MapProp(35, 400, 208, 1, 0),    // frost.drift, variant 1 (frost.drift2)
            new MapProp(2, 600, 400, 0, 0),     // fire.crystal
            new MapProp(14, 100, 500, 0, 0),    // sent.deadtree: its art is tall, the row is not
            new MapProp(2, 300, 500, 0, 1),     // fire.crystal: its art is low, the row is tall
        };

        static MapBlob WithProps(MapBlob map, params MapProp[] props) { return map.WithPublic(null, null, null, props, null); }

        // ---- scene helpers -------------------------------------------------------------------------------------------------------

        sealed class Scene : IDisposable
        {
            public readonly GameObject Root = new GameObject("dress test root"); public RegionProps Props;
            public Scene(MapBlob map) { Props = RegionProps.Build(Root.transform, map); }
            public List<SpriteRenderer> Renderers() { return Root.GetComponentsInChildren<SpriteRenderer>().ToList(); }
            public SpriteRenderer At(MapProp p, string art)
            {
                var want = ArenaView.WorldPoint(p.X, p.Y);
                return Renderers().Find(r => r.name == art && Mathf.Abs(r.transform.localPosition.x - want.x) < .001f && Mathf.Abs(r.transform.localPosition.y - want.y) < .001f);
            }
            public void Dispose() { if (Props != null) Props.Dispose(); UnityEngine.Object.DestroyImmediate(Root); }
        }

        sealed class Logs : IDisposable
        {
            public readonly List<(LogType type, string text)> All = new List<(LogType, string)>();
            void On(string text, string stack, LogType type) { All.Add((type, text)); }
            public Logs() { Application.logMessageReceived += On; }
            public int Count(string fragment) { return All.Count(l => l.text.Contains(fragment)); }
            public void Dispose() { Application.logMessageReceived -= On; }
        }

        // ---- props --------------------------------------------------------------------------------------------------------------

        [Test]
        public void ABlobWithPropsDrawsExactlyThosePropsAtTheirPositionsAndRollsNoScatter()
        {
            var open = Open();
            Assert.That(RegionProps.Scatter(open).Count, Is.GreaterThan(20), "guard: this map scatters props today, so zero scatter below proves something");
            var map = WithProps(open, Known);
            using (var scene = new Scene(map))
            {
                Assert.That(scene.Props.Count, Is.EqualTo(Known.Length), "RegionProps.Count is the number of props drawn");
                Assert.That(scene.Renderers().Count, Is.EqualTo(Known.Length), "exactly the blob's props are drawn, and no scatter prop");
                foreach (var p in Known)
                {
                    string art = DecorationKinds.ArtKey(p.Kind, p.Variant, p.Flags);
                    Assert.That(art, Is.Not.Null.And.Not.EqualTo(DecorationKinds.Placeholder), "kind " + p.Kind + " has art");
                    Assert.That(scene.At(p, art), Is.Not.Null, "kind " + p.Kind + " variant " + p.Variant + " is drawn as '" + art + "' at world (" + p.X + ", " + p.Y + ")");
                }
            }
        }

        [Test]
        public void ScatterOfABlobWithPropsIsTheBlobsPropsAndNothingRolled()
        {
            // Scatter stays the one placement list (shadows, lantern lights and the contrast lab read it), so for a dressed blob it
            // returns the server's props as placements: tile units (world / 32), the blob's kind, variant and flags, no roll.
            var map = WithProps(Open(), Known);
            var list = RegionProps.Scatter(map);
            Assert.That(list.Count, Is.EqualTo(Known.Length), "no scatter placement besides the blob's props");
            for (int i = 0; i < Known.Length; i++)
            {
                var pl = list.Find(p => p.Kind == Known[i].Kind && Mathf.Abs(p.X * 32f - Known[i].X) < .01f && Mathf.Abs(p.Y * 32f - Known[i].Y) < .01f);
                Assert.That(pl.Art, Is.EqualTo(DecorationKinds.ArtKey(Known[i].Kind, Known[i].Variant, Known[i].Flags)), "row " + i + " kind " + Known[i].Kind);
                Assert.That((pl.Variant, pl.Flags), Is.EqualTo((Known[i].Variant, Known[i].Flags)), "row " + i);
            }
        }

        [Test]
        public void ADressedMapKeepsRealBushCellsAndOnlyThose()
        {
            // The bush plane is concealment the player can use, not decoration: its bushes are still drawn, one per cell, beside the props.
            var open = Open(); var plane = new byte[open.W * open.H]; plane[10 * open.W + 30] = 1; plane[12 * open.W + 31] = 1;
            var map = open.WithPublic(null, null, plane, Known, null);
            var list = RegionProps.Scatter(map);
            Assert.That(list.Count, Is.EqualTo(Known.Length + 2), "the blob's props plus one bush per real bush cell");
            Assert.That(list.Count(p => p.Kind == 0), Is.EqualTo(2), "the two placements that are not the blob's are the real bushes");
        }

        // Pinned on a checked-in fixture at the base commit (RegionProps.Scatter(seed1.map.json) today, before this packet).
        const int Seed1ScatterToday = 2218;

        [Test]
        public void ABlobWithoutPropsKeepsTodaysScatterUnchanged()
        {
            var map = Seed1();
            Assert.That(map.Props.Length, Is.EqualTo(0));
            Assert.That(RegionProps.Scatter(map).Count, Is.EqualTo(Seed1ScatterToday), "the scatter of seed1.map.json without shipped props");
            Assert.That(RegionProps.Scatter(map.WithPublic(null, null, null, new MapProp[0], null)).Count, Is.EqualTo(Seed1ScatterToday), "an empty prop list is no list");
            Assert.That(RegionProps.Scatter(map).All(p => p.Kind == 0), Is.True, "rolled placements carry no server kind");
            using (var scene = new Scene(map))
                Assert.That(scene.Props.Count, Is.GreaterThan(Seed1ScatterToday / 2), "and they are drawn");
        }

        [Test]
        public void OnARealMapTheShippedPropsReplaceEveryRolledPropExceptTheTempleAndColiseumFurniture()
        {
            // The temple's and the coliseum's own props (temple.*, col.*) are fixed furniture of those buildings, not scatter; whether they
            // stay is outside this oracle (packet section 3, decision 2). Everything else on the map is the blob's.
            var map = WithProps(Seed1(), new MapProp(33, 3200, 3200, 0, 1), new MapProp(2, 3400, 3200, 0, 0), new MapProp(14, 3200, 3400, 0, 0));
            var rest = RegionProps.Scatter(map).Where(p => !p.Art.StartsWith("temple.") && !p.Art.StartsWith("col.")).ToList();
            Assert.That(rest.Count, Is.EqualTo(3), "only the three shipped props: " + string.Join(", ", rest.Select(p => p.Art)));
            Assert.That(rest.All(p => p.Kind != 0), Is.True);
        }

        // ---- fade ---------------------------------------------------------------------------------------------------------------

        [Test]
        public void ThePropFlagDecidesTheFade()
        {
            var map = WithProps(Open(), Known);
            using (var scene = new Scene(map))
            {
                var pine = scene.At(Known[0], "frost.pine");               // tall row
                var deadtree = scene.At(Known[3], "sent.deadtree");        // tall art, row without the flag
                var crystal = scene.At(Known[4], "fire.crystal");          // low art, tall row
                Assert.That(pine != null && deadtree != null && crystal != null, Is.True, "the three props are drawn");
                // an actor just north of each prop (the prop draws over it)
                Vector3 Behind(MapProp p) { return ArenaView.WorldPoint(p.X, p.Y - 19f); }
                for (int i = 0; i < 14; i++)
                {
                    scene.Props.NoteActor(Behind(Known[0])); scene.Props.NoteActor(Behind(Known[3])); scene.Props.NoteActor(Behind(Known[4]));
                    scene.Props.Tick(.1f);
                }
                float faded = PropFade.FadedAlpha + .02f;
                Assert.That(pine.color.a, Is.LessThanOrEqualTo(faded), "a prop with the tall flag fades over an actor");
                Assert.That(crystal.color.a, Is.LessThanOrEqualTo(faded), "the row's tall flag decides, not the art's height");
                Assert.That(deadtree.color.a, Is.EqualTo(1f), "a row without the tall flag never fades, whatever its art");
            }
        }

        // ---- kinds the client does not know -------------------------------------------------------------------------------------

        [Test]
        public void AnUnknownKindDrawsThePlaceholderAndLogsOncePerKind()
        {
            var props = new[] { new MapProp(98, 100, 100, 0, 0), new MapProp(99, 200, 100, 0, 0), new MapProp(99, 300, 100, 0, 0) };
            var map = WithProps(Open(), props);
            using (var logs = new Logs())
            using (var scene = new Scene(map))
            {
                Assert.That(RegionPropArt.TryGet(DecorationKinds.Placeholder, out var art), Is.True, "the placeholder sprite exists in RegionPropArt");
                Assert.That(scene.Renderers().Count(r => r.name == DecorationKinds.Placeholder), Is.EqualTo(3), "every unknown prop is drawn as the placeholder, none skipped");
                foreach (var p in props) Assert.That(scene.At(p, DecorationKinds.Placeholder), Is.Not.Null, "placeholder at kind " + p.Kind + " world x " + p.X);
                Assert.That(logs.Count("kind 99"), Is.EqualTo(1), "two props of an unknown kind log once");
                Assert.That(logs.Count("kind 98"), Is.EqualTo(1), "each unknown kind logs once");
                Assert.That(logs.All.Where(l => l.text.Contains("kind 9")).All(l => l.type == LogType.Warning), Is.True, "logged as a warning (an Error would fail other tests' runs)");
            }
        }

        [Test]
        public void ALegacyPropThatArrivesIsDrawnAsThePlaceholderAndDoesNotThrow()
        {
            // The server runs the generator with decor off, so none are sent today. If one arrives (flag 2: kind is a catalogue index) the client
            // does not know the catalogue and draws the placeholder. Whether it also logs is not pinned.
            var legacy = new MapProp(5, 160, 160, 200, 2);
            var map = WithProps(Open(), legacy);
            using (var scene = new Scene(map))
            {
                Assert.That(scene.Renderers().Count, Is.EqualTo(1));
                Assert.That(scene.At(legacy, DecorationKinds.Placeholder), Is.Not.Null);
            }
        }

        [Test]
        public void EveryKindInTheTableAndTheVariantArtHasASpriteInTheAtlas()
        {
            Assert.That(DecorationKinds.All.Count, Is.GreaterThan(40), "the kind table is filled");
            var missing = DecorationKinds.All.Where(d => !RegionPropArt.TryGet(d.Art, out _)).Select(d => d.Name + " -> " + d.Art).ToList();
            Assert.That(missing, Is.Empty, "kinds whose sprite is not in RegionPropArt (use the nearest existing prop): " + string.Join(", ", missing));
            Assert.That(RegionPropArt.TryGet(DecorationKinds.ArtKey(35, 1, 0), out _), Is.True, "the variant art exists");
            Assert.That(RegionPropArt.TryGet(DecorationKinds.Placeholder, out _), Is.True, "the placeholder exists");
        }

        // ---- no garbage ---------------------------------------------------------------------------------------------------------

        [Test]
        public void GuardAFrameOfADressedMapAllocatesNothingForDecoration()
        {
            var map = WithProps(Open(), Known);
            using (var scene = new Scene(map))
            {
                Vector3 a = ArenaView.WorldPoint(176, 190), b = ArenaView.WorldPoint(300, 480), far = ArenaView.WorldPoint(1000, 1000);
                for (int i = 0; i < 20; i++) { scene.Props.NoteActor(a); scene.Props.NoteActor(b); scene.Props.NoteActor(far); scene.Props.Tick(.05f); }   // warm up
                long before = GC.GetAllocatedBytesForCurrentThread();
                for (int i = 0; i < 120; i++)
                {
                    scene.Props.NoteActor(i % 2 == 0 ? a : far); scene.Props.NoteActor(b); scene.Props.Tick(.05f);
                }
                Assert.That(GC.GetAllocatedBytesForCurrentThread() - before, Is.EqualTo(0), "NoteActor and Tick allocate nothing once the map is built");
            }
        }

        // ---- ground -------------------------------------------------------------------------------------------------------------

        static Color32 Expected(int region, byte variant)
        {
            Assert.That(GroundVariantLook.TryGet(region, variant, out var t), Is.True, "region " + region + " variant " + variant);
            return new Color32(t.R, t.G, t.B, (byte)Mathf.RoundToInt(t.Strength * 255f));
        }

        static void AssertTexel(Color32 got, Color32 want, string what)
        {
            Assert.That((int)got.r, Is.EqualTo((int)want.r).Within(1), what + " r"); Assert.That((int)got.g, Is.EqualTo((int)want.g).Within(1), what + " g");
            Assert.That((int)got.b, Is.EqualTo((int)want.b).Within(1), what + " b"); Assert.That((int)got.a, Is.EqualTo((int)want.a).Within(1), what + " strength");
        }

        [Test]
        public void ATileWithAGroundVariantBakesThatVariantsLookAndVariantZeroBakesTheBaseGround()
        {
            var open = Open(); var plane = new byte[open.W * open.H];
            plane[5 * 40 + 3] = 3; plane[5 * 40 + 4] = 6; plane[6 * 40 + 5] = 7; plane[6 * 40 + 6] = 8;   // left half is Plague
            plane[5 * 40 + 30] = 3; plane[5 * 40 + 31] = 6; plane[7 * 40 + 25] = 1;                        // right half is Frost
            var map = open.WithPublic(null, null, null, null, plane);
            var baked = RegionGround.BakeVariants(map);
            Assert.That(baked.Length, Is.EqualTo(40 * 40), "one texel per tile");
            AssertTexel(baked[5 * 40 + 3], Expected(3, 3), "plague variant 3");
            AssertTexel(baked[5 * 40 + 4], Expected(3, 6), "plague variant 6");
            AssertTexel(baked[6 * 40 + 5], Expected(3, 7), "plague water");
            AssertTexel(baked[6 * 40 + 6], Expected(3, 8), "plague mud");
            AssertTexel(baked[5 * 40 + 30], Expected(4, 3), "frost variant 3");
            AssertTexel(baked[5 * 40 + 31], Expected(4, 6), "frost variant 6");
            AssertTexel(baked[7 * 40 + 25], Expected(4, 1), "frost variant 1");
            for (int i = 0; i < baked.Length; i++)
                if (plane[i] == 0) Assert.That(baked[i].a, Is.EqualTo((byte)0), "tile " + i + " has no variant: the base ground, no tint");
        }

        [Test]
        public void AMapWithoutAGroundVariantPlaneBakesNothingAndAnUnknownVariantDrawsTheBaseGroundAndLogsOnce()
        {
            var open = Open();
            var none = RegionGround.BakeVariants(open);
            Assert.That(none.Length, Is.EqualTo(40 * 40), "one texel per tile even without a plane");
            Assert.That(none.All(c => c.a == 0), Is.True, "a map without variants draws today's ground");

            var plane = new byte[open.W * open.H]; plane[100] = 12; plane[101] = 12; plane[102] = 15; plane[103] = 4;
            using (var logs = new Logs())
            {
                var baked = RegionGround.BakeVariants(open.WithPublic(null, null, null, null, plane));
                Assert.That(baked[100].a, Is.EqualTo((byte)0), "unknown variant 12: base ground");
                Assert.That(baked[101].a, Is.EqualTo((byte)0)); Assert.That(baked[102].a, Is.EqualTo((byte)0), "unknown variant 15: base ground");
                Assert.That(baked[103].a, Is.GreaterThan((byte)0), "a known variant next to them still draws");
                Assert.That(logs.Count("ground variant 12"), Is.EqualTo(1), "an unknown variant logs once however many cells carry it");
                Assert.That(logs.Count("ground variant 15"), Is.EqualTo(1));
            }
        }

        [Test]
        public void TheGroundMaterialReceivesTheVariantTexture()
        {
            var open = Open(); var plane = new byte[open.W * open.H]; plane[5 * 40 + 5] = 3;
            var map = open.WithPublic(null, null, null, null, plane);
            var root = new GameObject("dress ground root");
            try
            {
                var ground = RegionGround.Create(root.transform, map, 1f);
                var tex = ground.Material.GetTexture("_VariantTex");
                Assert.That(tex, Is.Not.Null, "the ground material has a _VariantTex (one texel per tile) for the variant tints");
                Assert.That((tex.width, tex.height), Is.EqualTo((40, 40)));
                ground.Dispose();
            }
            finally { UnityEngine.Object.DestroyImmediate(root); }
        }
    }
}

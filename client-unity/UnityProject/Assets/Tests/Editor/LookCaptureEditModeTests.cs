using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Reflection;
using NUnit.Framework;
using Roguehalla.Client;
using Roguehalla.Editor;
using Roguehalla.Net.Protocol;
using UnityEngine;
using MapRect = Roguehalla.Net.Protocol.MapRect;

namespace Roguehalla.Client.Tests
{
    /// <summary>
    /// P-UNITY-LOOK-TOOLS-1 oracle, EditMode half. Nothing here renders (the gate runs EditMode with -nographics). It pins: the scene
    /// list; that every scene builds a map the client's own validation accepts, in the right zone; that each landmark scene's anchor
    /// (kind, footprint size, centre, entrance, front) is what the landmark art tests stamp from the approved drawing, relative to the
    /// footprint's corner (the capture's maps are 60 x 60, the art tests' are smaller, so absolute tiles differ); that dressed scenes
    /// carry props and a variant plane; that the render target is sRGB; and that the capture cannot reach a player build.
    /// </summary>
    public sealed class LookCaptureEditModeTests
    {
        const int N = 60;

        static readonly string[] ZoneNames = { "fire", "plague", "sentenced", "holy", "frost" };
        static readonly string[] Landmarks = { "cave", "volcano", "church", "bog", "hall" };

        /// <summary>The pinned list, in print order. look-capture.sh --list prints exactly this (the node test pins the same list).</summary>
        public static readonly string[] Pinned = BuildPinned();

        static string[] BuildPinned()
        {
            var l = new List<string>();
            foreach (var z in ZoneNames) { l.Add(z + "-scene"); l.Add(z + "-scene-dressed"); }
            foreach (var k in Landmarks)
            {
                l.Add(k + "-wide"); l.Add(k + "-close");
                if (k == "cave" || k == "church" || k == "hall") l.Add(k + "-inside");
                if (k == "bog") l.Add(k + "-under");
                l.Add(k + "-rot-wide");
            }
            l.Add("volcano-edge-wide"); l.Add("volcano-edge-close"); l.Add("volcano-edge-rot-wide");
            // P-UNITY-LOOK-WALL-1: the Frost Wall scenes, after the rest (what they build is pinned in LookCaptureWallEditModeTests)
            l.Add("frost-wall"); l.Add("frost-wall-vertical"); l.Add("frost-wall-cracking"); l.Add("frost-wall-preview"); l.Add("frost-wall-preview-invalid");
            return l.ToArray();
        }

        static IEnumerable<string> All() { return Pinned; }
        static IEnumerable<string> LandmarkScenes() { return Pinned.Where(s => !s.Contains("-scene") && !s.StartsWith("frost-wall")); }   // the frost-wall scenes carry no landmark
        static IEnumerable<string> ZoneScenes() { return Pinned.Where(s => s.Contains("-scene")); }
        static IEnumerable<string> DressedScenes() { return Pinned.Where(s => s.EndsWith("-scene-dressed")); }

        static string KindOf(string scene) { return scene.Substring(0, scene.IndexOf('-')); }
        static bool IsRot(string scene) { return scene.Contains("-rot-"); }
        static bool IsEdge(string scene) { return scene.StartsWith("volcano-edge-"); }

        // ---- the list -----------------------------------------------------------------------------------------------------

        [Test]
        public void ThePinnedListHasThirtySevenDistinctNames()
        {
            Assert.That(Pinned.Length, Is.EqualTo(37));
            Assert.That(Pinned.Distinct().Count(), Is.EqualTo(37));
        }

        [Test]
        public void TheCaptureListsExactlyThePinnedScenesInOrder()
        {
            Assert.That(LookCapture.SceneNames.ToArray(), Is.EqualTo(Pinned), "LookCapture.SceneNames is the pinned list, in this order");
        }

        [Test]
        public void TheSceneListFileNextToTheCaptureHoldsTheSameNames()
        {
            string path = Path.GetFullPath(Path.Combine(Application.dataPath, "Editor/Look/scenes.txt"));
            Assert.That(File.Exists(path), "Assets/Editor/Look/scenes.txt is what look-capture.sh --list prints: " + path);
            var lines = File.ReadAllLines(path).Select(l => l.Trim()).Where(l => l.Length > 0).ToArray();
            Assert.That(lines, Is.EqualTo(Pinned));
        }

        // ---- maps ---------------------------------------------------------------------------------------------------------

        [TestCaseSource(nameof(All))]
        public void EverySceneBuildsASixtyBySixtyMapTheClientsOwnValidationAccepts(string scene)
        {
            var map = LookCapture.BuildMap(scene);
            Assert.That(map, Is.Not.Null, scene);
            Assert.That(map.W, Is.EqualTo(N)); Assert.That(map.H, Is.EqualTo(N));
            Assert.That(map.Tiles.Length, Is.EqualTo(N * N));
            // WithPublic runs the same CheckPublic the codec uses (props, planes, anchors); it throws on a map the client would refuse.
            Assert.DoesNotThrow(() => map.WithPublic(map.Camps, map.Coliseum, map.Bushes, map.Props, map.GroundVariants, map.Patience, map.Anchors), scene);
            Assert.That(map.TerrainMode, Is.EqualTo(MapBlob.GroundTerrainAll), "ground terrain on, as a match room has it");
        }

        [TestCaseSource(nameof(All))]
        public void EverySceneIsOneZoneEverywhere(string scene)
        {
            var map = LookCapture.BuildMap(scene);
            Assert.That(map, Is.Not.Null, scene);
            byte zone = LookCapture.ZoneOf(scene);
            string kind = KindOf(scene);
            int want = Array.IndexOf(ZoneNames, kind) >= 0
                ? new Dictionary<string, int> { { "fire", 1 }, { "sentenced", 2 }, { "plague", 3 }, { "frost", 4 }, { "holy", 5 } }[kind]
                : new Dictionary<string, int> { { "volcano", 1 }, { "church", 2 }, { "bog", 3 }, { "cave", 4 }, { "hall", 5 } }[kind];
            Assert.That((int)zone, Is.EqualTo(want), scene + ": zone");
            Assert.That(map.Regions.All(r => r == zone), Is.True, scene + ": every tile's region is the scene's zone");
        }

        [TestCaseSource(nameof(ZoneScenes))]
        public void AZoneSceneHasNoAnchorAndItsWallClusterAndFenceOrBog(string scene)
        {
            var map = LookCapture.BuildMap(scene);
            Assert.That(map, Is.Not.Null, scene);
            Assert.That(LookCapture.AnchorOf(scene), Is.Null, scene);
            Assert.That(map.Anchors.Length, Is.EqualTo(0));
            Assert.That(map.At(26, 24), Is.EqualTo(MapBlob.Wall), "the L's vertical arm starts at (26, 24)");
            Assert.That(map.At(34, 31), Is.EqualTo(MapBlob.Wall), "the L's foot ends at (34, 31)");
            if (KindOf(scene) == "plague") Assert.That(map.Terrain[34 * N + 33], Is.EqualTo((byte)TerrainKind.Bog), "the plague scene has its 6 x 4 bog patch");
            else { Assert.That(map.At(33, 34), Is.EqualTo(MapBlob.Low)); Assert.That(map.Terrain[34 * N + 33], Is.EqualTo((byte)TerrainKind.Fence), "the other zones have the fence run"); }
        }

        [TestCaseSource(nameof(DressedScenes))]
        public void ADressedSceneCarriesPropsAndAVariantPlaneAndAPlainOneDoesNot(string scene)
        {
            var dressed = LookCapture.BuildMap(scene);
            var plain = LookCapture.BuildMap(scene.Replace("-dressed", ""));
            Assert.That(dressed, Is.Not.Null, scene); Assert.That(plain, Is.Not.Null);
            Assert.That(dressed.Props.Length, Is.GreaterThan(0), "a non-empty prop list is what makes the client treat the map as dressed");
            Assert.That(dressed.GroundVariants, Is.Not.Null);
            Assert.That(dressed.GroundVariants.Length, Is.EqualTo(N * N));
            Assert.That(dressed.GroundVariants.Any(v => v != 0), Is.True, "the plane is not all zero");
            Assert.That(plain.Props.Length, Is.EqualTo(0)); Assert.That(plain.GroundVariants, Is.Null);
        }

        [TestCaseSource(nameof(LandmarkScenes))]
        public void ALandmarkSceneIsUndressedAndCarriesExactlyOneAnchor(string scene)
        {
            var map = LookCapture.BuildMap(scene);
            Assert.That(map, Is.Not.Null, scene);
            Assert.That(map.Anchors.Length, Is.EqualTo(1));
            Assert.That(LookCapture.AnchorOf(scene), Is.Not.Null);
            Assert.That(map.Props.Length, Is.EqualTo(0), "no props: the landmark and its ground are what is looked at");
        }

        // ---- anchors, re-derived from the approved drawings the way the art tests stamp them -------------------------------------

        static string[] Rows(string name)
        {
            string path = Path.GetFullPath(Path.Combine(Application.dataPath, "../../../docs/landmarks/blueprints/" + name + ".txt"));
            Assert.That(File.Exists(path), "blueprint missing: " + path);
            return File.ReadAllLines(path).Where(l => l.Length > 0 && l[0] != ';').ToArray();
        }

        /// <summary>One of the eight placements, as the art tests do: swap x and y, then flip x, then flip y.</summary>
        static string[] Orient(string[] rows, int k)
        {
            bool swap = (k & 1) != 0, fx = (k & 2) != 0, fy = (k & 4) != 0; int n = rows.Length;
            var o = new string[n];
            for (int y = 0; y < n; y++)
            {
                var r = new char[n];
                for (int x = 0; x < n; x++) { int sx = fx ? n - 1 - x : x, sy = fy ? n - 1 - y : y; r[x] = swap ? rows[sx][sy] : rows[sy][sx]; }
                o[y] = new string(r);
            }
            return o;
        }

        static string[] Mark(string kind, Action<char[][]> marks)
        {
            var raw = Rows(kind).Select(r => r.ToCharArray()).ToArray(); marks(raw);
            return raw.Select(r => new string(r)).ToArray();
        }

        static byte FrontOf(double mx, double my) { return Math.Abs(mx) > Math.Abs(my) ? (byte)(mx > 0 ? 0 : 8) : (byte)(my > 0 ? 4 : 12); }

        /// <summary>Expected anchor parts in footprint-local tiles (x, y from the footprint's corner), orientation k of the drawing.</summary>
        static void Expect(string kind, int k, out int size, out (int x, int y) centre, out List<(int x, int y)> entrance, out byte front)
        {
            string[] rows;
            switch (kind)
            {
                case "bog": rows = Orient(Mark("bog", r => { r[14][14] = 'c'; foreach (var (x, y) in new[] { (12, 0), (13, 0), (0, 11), (0, 12), (13, 28), (14, 28) }) r[y][x] = 'e'; }), k); break;
                case "church": rows = Orient(Mark("church", r => { for (int x = 12; x <= 16; x++) r[28][x] = 'M'; }), k); break;
                case "hall": rows = Orient(Mark("hall", r => { for (int x = 15; x <= 21; x++) r[36][x] = 'M'; }), k); break;
                default: rows = Orient(Rows(kind), k); break;
            }
            size = rows.Length; centre = (0, 0); entrance = new List<(int, int)>(); var lava = new List<(int x, int y)>();
            for (int y = 0; y < size; y++) for (int x = 0; x < size; x++)
            {
                char c = rows[y][x];
                switch (kind)
                {
                    case "cave": if (c == 'D') entrance.Add((x, y)); if (c == 'E') centre = (x, y); break;
                    case "volcano": if (c == '~' || c == 'O') lava.Add((x, y)); if (c == 'O') entrance.Add((x, y)); break;
                    case "church": if (c == 'M') entrance.Add((x, y)); if (c == 'E') centre = (x, y); break;
                    case "bog": if (c == 'e') entrance.Add((x, y)); if (c == 'c') centre = (x, y); break;
                    case "hall": if (c == 'M') entrance.Add((x, y)); break;
                }
            }
            if (kind == "volcano")
            {
                double cx = lava.Average(l => l.x), cy = lava.Average(l => l.y);
                centre = lava.OrderBy(l => (l.x - cx) * (l.x - cx) + (l.y - cy) * (l.y - cy)).First();   // first in row-major order on a tie, as the volcano art test
            }
            if (kind == "hall") centre = (18, 18);
            double mx = entrance.Average(m => m.x) - (size - 1) / 2.0, my = entrance.Average(m => m.y) - (size - 1) / 2.0;
            front = kind == "bog" ? (byte)4 : FrontOf(mx, my);
        }

        static readonly Dictionary<string, byte> KindByte = new Dictionary<string, byte>
        {
            { "volcano", MapBlob.AnchorKindVolcano }, { "church", MapBlob.AnchorKindChurch }, { "bog", MapBlob.AnchorKindBogTree },
            { "cave", MapBlob.AnchorKindCave }, { "hall", MapBlob.AnchorKindHall },
        };

        [TestCaseSource(nameof(LandmarkScenes))]
        public void TheAnchorIsWhatTheLandmarkArtTestsStampFromTheApprovedDrawing(string scene)
        {
            var a = LookCapture.AnchorOf(scene);
            Assert.That(a, Is.Not.Null, scene);
            string kind = KindOf(scene);
            // the unrotated scenes use orientation 0 of the drawing; the rot and edge-rot scenes orientation 1 (x and y swapped)
            int k = IsRot(scene) ? 1 : 0;
            Expect(kind, k, out int size, out var centre, out var entrance, out byte front);
            Assert.That(a.Kind, Is.EqualTo(KindByte[kind]), scene + ": kind");
            Assert.That(a.Zone, Is.EqualTo(LookCapture.ZoneOf(scene)), scene + ": the anchor's zone is the scene's zone");
            Assert.That((int)a.Footprint.W, Is.EqualTo(size), scene + ": footprint width"); Assert.That((int)a.Footprint.H, Is.EqualTo(size), scene + ": footprint height");
            int fx = a.Footprint.X, fy = a.Footprint.Y;
            if (!IsEdge(scene)) { Assert.That(fx, Is.EqualTo((N - size) / 2), scene + ": centred on the map"); Assert.That(fy, Is.EqualTo((N - size) / 2)); }
            else if (k == 0) { Assert.That(fy, Is.EqualTo(2), scene + ": the back row two tiles from the top edge, front south"); Assert.That(fx, Is.EqualTo((N - size) / 2)); }
            else { Assert.That(fx, Is.EqualTo(2), scene + ": the back column two tiles from the left edge, front east"); Assert.That(fy, Is.EqualTo((N - size) / 2)); }
            Assert.That((a.Centre.X - fx, a.Centre.Y - fy), Is.EqualTo(centre), scene + ": centre relative to the footprint");
            var got = a.Entrance.Select(t => ((int)t.X - fx, (int)t.Y - fy)).OrderBy(t => t.Item2).ThenBy(t => t.Item1).ToArray();
            Assert.That(got, Is.EqualTo(entrance.OrderBy(t => t.y).ThenBy(t => t.x).ToArray()), scene + ": entrance tiles relative to the footprint");
            Assert.That(a.Front, Is.EqualTo(front), scene + ": front (DIR16: 0 east, 4 south, 8 west, 12 north)");
        }

        [TestCaseSource(nameof(LandmarkScenes))]
        public void TheSceneMapCarriesThatAnchorAndTheWallsOfTheDrawingInsideTheFootprint(string scene)
        {
            var map = LookCapture.BuildMap(scene); var a = LookCapture.AnchorOf(scene);
            Assert.That(map, Is.Not.Null, scene); Assert.That(a, Is.Not.Null);
            Assert.That(map.Anchors[0].Kind, Is.EqualTo(a.Kind)); Assert.That(map.Anchors[0].Centre.X, Is.EqualTo(a.Centre.X)); Assert.That(map.Anchors[0].Front, Is.EqualTo(a.Front));
            int walls = 0;
            for (int y = a.Footprint.Y; y < a.Footprint.Y + a.Footprint.H; y++) for (int x = a.Footprint.X; x < a.Footprint.X + a.Footprint.W; x++) if (map.At(x, y) == MapBlob.Wall) walls++;
            Assert.That(walls, Is.GreaterThan(50), scene + ": the drawing's walls are stamped");
            for (int y = 0; y < N; y++) for (int x = 0; x < N; x++)
                if (x < a.Footprint.X || y < a.Footprint.Y || x >= a.Footprint.X + a.Footprint.W || y >= a.Footprint.Y + a.Footprint.H)
                    if (map.At(x, y) == MapBlob.Wall) Assert.Fail(scene + ": a wall outside the footprint at " + x + "," + y);
        }

        [Test]
        public void TheEdgeScenesPutTheVolcanoNextToTheMapEdgeAndTheNormalOnesDoNot()
        {
            var edge = LookCapture.AnchorOf("volcano-edge-wide"); var mid = LookCapture.AnchorOf("volcano-wide");
            Assert.That(edge, Is.Not.Null); Assert.That(mid, Is.Not.Null);
            Assert.That((int)edge.Footprint.Y, Is.LessThan(mid.Footprint.Y));
            Assert.That(edge.Front, Is.EqualTo((byte)4), "front south, so the outlet streams run into the map");
            Assert.That(LookCapture.AnchorOf("volcano-edge-rot-wide").Front, Is.EqualTo((byte)0), "front east");
        }

        // ---- render target and editor-only ------------------------------------------------------------------------------------

        [Test]
        public void TheRenderTargetIsSrgbSoAShotIsNotWrittenAsALinearPng()
        {
            var d = LookCapture.TargetDescriptor();
            Assert.That(d.sRGB, Is.True, "ProjectSettings is Linear colour space; a linear target written to PNG came out dark and over-saturated (first version's fault)");
            Assert.That(d.width, Is.EqualTo(1920)); Assert.That(d.height, Is.EqualTo(1080));
            Assert.That(d.colorFormat, Is.EqualTo(RenderTextureFormat.ARGB32), "an 8-bit target, not ARGBHalf");
            Assert.That(d.depthBufferBits, Is.EqualTo(24));
        }

        [Test]
        public void TheCaptureLivesInTheEditorOnlyAssemblyAndNoPlayerAssemblyHasIt()
        {
            var asm = typeof(LookCapture).Assembly;
            Assert.That(asm.GetName().Name, Is.EqualTo("Roguehalla.Editor"));
            var player = UnityEditor.Compilation.CompilationPipeline.GetAssemblies(UnityEditor.Compilation.AssembliesType.Player).Select(x => x.name);
            Assert.That(player, Does.Not.Contain("Roguehalla.Editor"), "the editor assembly is not part of a player build");
            string src = Path.GetFullPath(Path.Combine(Application.dataPath, "Editor/Look/LookCapture.cs"));
            Assert.That(File.Exists(src), "the capture's source sits under Assets/Editor/Look");
            Assert.That(Directory.GetFiles(Path.Combine(Application.dataPath, "Scripts"), "*Look*Capture*.cs", SearchOption.AllDirectories), Is.Empty, "no copy of the capture in the client assembly");
        }

        [Test]
        public void TheCaptureReachesExactlyFourNonPublicClientMembersByReflectionAndAllResolve()
        {
            Assert.That(LookCapture.ReflectionTargets.ToArray(), Is.EqualTo(new[] { "ArenaView.Awake", "ArenaView._landmarks", "Landmark.Fades", "ArenaView._frostWall" }),
                "a fourth non-public member needs the brief amended (the packet forbids widening production visibility silently)");
            Assert.That(LookCapture.MissingReflectionTargets(), Is.Empty);
            // the same lookups, independent of the capture, so a rename in the client fails here with the member's name
            const BindingFlags f = BindingFlags.NonPublic | BindingFlags.Instance;
            Assert.That(typeof(ArenaView).GetMethod("Awake", f), Is.Not.Null, "ArenaView.Awake");
            Assert.That(typeof(ArenaView).GetField("_landmarks", f), Is.Not.Null, "ArenaView._landmarks");
            Assert.That(typeof(Landmark).GetMethod("Fades", f, null, new[] { typeof(int), typeof(int) }, null), Is.Not.Null, "Landmark.Fades(int, int)");
            Assert.That(typeof(ArenaView).GetField("_frostWall", f), Is.Not.Null, "ArenaView._frostWall (P-UNITY-LOOK-WALL-1: how the capture reaches the presenter)");
        }
    }
}

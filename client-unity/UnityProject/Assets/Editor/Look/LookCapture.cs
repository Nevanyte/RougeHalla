// Editor-only look capture (P-UNITY-LOOK-TOOLS-1): builds a small map of one zone, optionally stamps one landmark from its approved
// drawing (docs/landmarks/blueprints/<kind>.txt), builds it through the real ArenaView and renders named shots to sRGB PNG.
//   Unity -batchmode -projectPath <p> -executeMethod Roguehalla.Editor.LookCapture.Run -lookScenes a,b -lookOut <dir>
//         [-lookGroundOnly 1] [-lookQuality low|medium|high|ultra] -logFile <log>
// Run it through client-unity/UnityProject/Tools/look-capture.sh. Needs graphics (no -nographics, no -quit). Lives in the editor
// assembly, so no player build contains it. It reaches three non-public client members by reflection (see ReflectionTargets).
using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Reflection;
using UnityEngine;
using UnityEngine.Rendering.Universal;
using Roguehalla.Client;
using Roguehalla.Net;
using Roguehalla.Net.Protocol;
using MapRect = Roguehalla.Net.Protocol.MapRect;
using ArenaView = Roguehalla.Client.ArenaView;

namespace Roguehalla.Editor
{
    public static class LookCapture
    {
        const int N = 60;
        const int Width = 1920, Height = 1080;

        static readonly string[] Zones = { "fire", "plague", "sentenced", "holy", "frost" };
        static readonly string[] Kinds = { "cave", "volcano", "church", "bog", "hall" };

        /// <summary>Every scene name, in the order look-capture.sh --list prints them (the pinned list).</summary>
        public static readonly IReadOnlyList<string> SceneNames = BuildNames();

        static string[] BuildNames()
        {
            var l = new List<string>();
            foreach (var z in Zones) { l.Add(z + "-scene"); l.Add(z + "-scene-dressed"); }
            foreach (var k in Kinds)
            {
                l.Add(k + "-wide"); l.Add(k + "-close");
                if (k == "cave" || k == "church" || k == "hall") l.Add(k + "-inside");
                if (k == "bog") l.Add(k + "-under");
                l.Add(k + "-rot-wide");
            }
            l.Add("volcano-edge-wide"); l.Add("volcano-edge-close"); l.Add("volcano-edge-rot-wide");
            return l.ToArray();
        }

        // ---- the three non-public client members, reached by reflection ----------------------------------------------------------

        const BindingFlags Inst = BindingFlags.NonPublic | BindingFlags.Instance;
        static MethodInfo AwakeOf() { return typeof(ArenaView).GetMethod("Awake", Inst); }
        static FieldInfo LandmarksOf() { return typeof(ArenaView).GetField("_landmarks", Inst); }
        static MethodInfo FadesOf() { return typeof(Landmark).GetMethod("Fades", Inst, null, new[] { typeof(int), typeof(int) }, null); }

        /// <summary>The non-public members of the client assembly the capture reaches by reflection.</summary>
        public static readonly IReadOnlyList<string> ReflectionTargets = new[] { "ArenaView.Awake", "ArenaView._landmarks", "Landmark.Fades" };

        /// <summary>The reflection targets that cannot be resolved today (empty when all resolve).</summary>
        public static IReadOnlyList<string> MissingReflectionTargets()
        {
            var missing = new List<string>();
            if (AwakeOf() == null) missing.Add("ArenaView.Awake");
            if (LandmarksOf() == null) missing.Add("ArenaView._landmarks");
            if (FadesOf() == null) missing.Add("Landmark.Fades");
            return missing;
        }

        // ---- scene names -----------------------------------------------------------------------------------------------------

        sealed class SceneSpec
        {
            public string Name, Kind, View;   // View: scene | scene-dressed | wide | close | inside | under | rot-wide
            public bool Edge, Dressed;
            public bool IsZone { get { return View == "scene" || View == "scene-dressed"; } }
            public int K { get { return View == "rot-wide" ? 1 : 0; } }
        }

        static SceneSpec Parse(string name)
        {
            if (name == null || !SceneNames.Contains(name)) throw new ArgumentException("unknown scene: " + name);
            string rest = name.Substring(name.IndexOf('-') + 1);
            var s = new SceneSpec { Name = name, Kind = name.Substring(0, name.IndexOf('-')) };
            if (rest.StartsWith("edge-")) { s.Edge = true; rest = rest.Substring(5); }
            s.View = rest; s.Dressed = rest == "scene-dressed";
            return s;
        }

        /// <summary>The zone (RegionId value 1..5) the scene is in.</summary>
        public static byte ZoneOf(string scene)
        {
            switch (Parse(scene).Kind)
            {
                case "fire": case "volcano": return 1;
                case "sentenced": case "church": return 2;
                case "plague": case "bog": return 3;
                case "frost": case "cave": return 4;
                default: return 5;   // holy, hall
            }
        }

        // ---- maps ------------------------------------------------------------------------------------------------------------

        /// <summary>The map a scene renders: built through the client's validation (MapBlob.WithPublic), no rendering.</summary>
        public static MapBlob BuildMap(string scene)
        {
            var s = Parse(scene);
            return s.IsZone ? ZoneMap(ZoneOf(scene), s.Kind == "plague", s.Dressed) : BuildSite(s).Map;
        }

        /// <summary>The landmark anchor stamped into the scene's map; null for a zone scene.</summary>
        public static MapAnchor AnchorOf(string scene)
        {
            var s = Parse(scene);
            return s.IsZone ? null : BuildSite(s).Anchor;
        }

        // ---- the Frost Wall scenes (P-UNITY-LOOK-WALL-1) ---------------------------------------------------------------------------

        /// <summary>What building one of the five frost-wall scenes leaves behind (no camera, no rendering): the arena built through the real ArenaView,
        /// the presenter inside it, and what was injected. Dispose it with <see cref="DisposeWallScene"/>.</summary>
        public sealed class WallScene
        {
            public GameObject Arena; public ArenaView View; public FrostWallPresenter Presenter; public MapBlob Map;
            /// <summary>The standing wall's tiles in map coordinates (empty for the preview scenes).</summary>
            public MapTile[] WallTiles = new MapTile[0];
            /// <summary>Every actor drawn, as tile coordinates (tile centre = integer + 0.5), the self actor first.</summary>
            public IReadOnlyList<Vector2> Actors = new Vector2[0];
            /// <summary>The tile the preview is aimed at (preview scenes only).</summary>
            public MapTile? AimTile;
            /// <summary>The server render time the presenter was driven to, and the standing wall's end time (both server ms).</summary>
            public double RenderMs, EndsAtMs;
        }

        /// <summary>STUB (P-UNITY-LOOK-WALL-1): builds the named frost-wall scene's arena, state and presenter; the implementer replaces this.</summary>
        public static WallScene BuildWallScene(string scene) { return new WallScene(); }

        /// <summary>STUB (P-UNITY-LOOK-WALL-1): destroys everything <see cref="BuildWallScene"/> made, stand-in actors included.</summary>
        public static void DisposeWallScene(WallScene s) { }

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

        static string[] Rows(string name)
        {
            string path = Path.GetFullPath(Path.Combine(Application.dataPath, "../../../docs/landmarks/blueprints/" + name + ".txt"));
            return File.ReadAllLines(path).Where(l => l.Length > 0 && l[0] != ';').ToArray();
        }

        static string[] Marked(string kind, Action<char[][]> marks)
        {
            var raw = Rows(kind).Select(r => r.ToCharArray()).ToArray(); marks(raw);
            return raw.Select(r => new string(r)).ToArray();
        }

        static byte FrontOf(double mx, double my) { return Math.Abs(mx) > Math.Abs(my) ? (byte)(mx > 0 ? 0 : 8) : (byte)(my > 0 ? 4 : 12); }
        static (int dx, int dy) Dir(byte front) { return front == 0 ? (1, 0) : front == 4 ? (0, 1) : front == 8 ? (-1, 0) : (0, -1); }

        sealed class Site
        {
            public MapBlob Map; public MapAnchor Anchor; public string Under;   // Under: "inside" | "under" | null
            public double EntX, EntY, MidX, MidY; public byte Front; public int FootX, FootY, Size;
        }

        static void Lava(byte[] tiles, byte[] terrain, int x, int y) { if (x < 0 || y < 0 || x >= N || y >= N) return; tiles[y * N + x] = MapBlob.Low; terrain[y * N + x] = (byte)TerrainKind.Lava; }
        static void Block(byte[] tiles, byte[] terrain, int x, int y, int w) { for (int j = 0; j < w; j++) for (int i = 0; i < w; i++) Lava(tiles, terrain, x + i, y + j); }

        /// <summary>The three outlets (2 tiles each) become streams 2 tiles wide: the middle one straight for 16 tiles, the sides at 45 degrees
        /// outward for 12, each ending in a 4 x 4 pool. Front south or east only. Returns the middle outlet's far corner.</summary>
        static (double x, double y) EdgeStreams(List<(int x, int y)> ent, byte front, byte[] tiles, byte[] terrain)
        {
            var (dx, dy) = Dir(front); var groups = new List<List<(int x, int y)>>(); (double x, double y) mid = (0, 0);
            foreach (var o in ent.OrderBy(o => o.x).ThenBy(o => o.y))
            {
                var g = groups.FirstOrDefault(gr => gr.Any(p => Math.Abs(p.x - o.x) + Math.Abs(p.y - o.y) == 1));
                if (g == null) groups.Add(new List<(int x, int y)> { o }); else g.Add(o);
            }
            bool south = dy != 0; groups = groups.OrderBy(g => south ? g.Average(t => t.x) : g.Average(t => t.y)).ToList();
            for (int gi = 0; gi < groups.Count; gi++)
            {
                var g = groups[gi]; int ox = g.Min(t => t.x), oy = g.Min(t => t.y);
                int lat = gi == 1 ? 0 : (gi == 0 ? -1 : 1), len = gi == 1 ? 16 : 12;
                int sx = dx + (south ? lat : 0), sy = dy + (south ? 0 : lat);   // step per tile: forward, plus sideways for the side streams
                if (gi == 1) mid = (ox + 1, oy + 1);
                for (int t = 1; t <= len; t++) Block(tiles, terrain, ox + t * sx, oy + t * sy, 2);
                Block(tiles, terrain, ox + (len + 1) * sx - 1, oy + (len + 1) * sy - 1, 4);
            }
            return mid;
        }

        static Site BuildSite(SceneSpec sc)
        {
            string kind = sc.Kind; int k = sc.K;
            string[] rows;
            switch (kind)
            {   // centre and entrance marks go in before orienting, as the art tests do
                case "bog": rows = Orient(Marked("bog", r => { r[14][14] = 'c'; foreach (var (x, y) in new[] { (12, 0), (13, 0), (0, 11), (0, 12), (13, 28), (14, 28) }) r[y][x] = 'e'; }), k); break;
                case "church": rows = Orient(Marked("church", r => { for (int x = 12; x <= 16; x++) r[28][x] = 'M'; }), k); break;
                case "hall": rows = Orient(Marked("hall", r => { for (int x = 15; x <= 21; x++) r[36][x] = 'M'; }), k); break;
                default: rows = Orient(Rows(kind), k); break;
            }
            int size = rows.Length, fx0 = (N - size) / 2, fy0 = (N - size) / 2;
            if (sc.Edge) { if (k == 0) fy0 = 2; else fx0 = 2; }
            var tiles = new byte[N * N]; var terrain = new byte[N * N]; var regions = new byte[N * N];
            byte zone = ZoneOf(sc.Name);
            for (int i = 0; i < regions.Length; i++) regions[i] = zone;
            var ent = new List<(int x, int y)>(); (int x, int y) centre = (0, 0); var lava = new List<(int x, int y)>();
            var s = new Site { FootX = fx0, FootY = fy0, Size = size };
            for (int y = 0; y < size; y++) for (int x = 0; x < size; x++)
            {
                char c = rows[y][x]; int i = (fy0 + y) * N + fx0 + x; var t = (fx0 + x, fy0 + y);
                switch (kind)
                {
                    case "cave":
                        if (c == '#' || c == 'R') tiles[i] = MapBlob.Wall; if (c == '=') terrain[i] = (byte)TerrainKind.Ice; if (c == 'D') ent.Add(t); if (c == 'E') centre = t; break;
                    case "volcano":
                        if (c == '#' || c == 'X' || c == 'H') tiles[i] = MapBlob.Wall;
                        if (c == '~' || c == 'O') { tiles[i] = MapBlob.Low; terrain[i] = (byte)TerrainKind.Lava; lava.Add(t); }
                        if (c == 'O') ent.Add(t); break;
                    case "church":
                        if (c == '#' || c == 'P' || c == 'G') tiles[i] = MapBlob.Wall;
                        if (c == '+') { tiles[i] = MapBlob.Low; terrain[i] = (byte)TerrainKind.Fence; }
                        if (c == 'M') ent.Add(t); if (c == 'E') centre = t; break;
                    case "bog":
                        if (c == 'e') { ent.Add(t); c = ':'; }
                        if (c == 'c') { centre = t; c = 'T'; }
                        if (c == 'T' || c == 'r') tiles[i] = MapBlob.Wall; else if (c == '%') terrain[i] = (byte)TerrainKind.Bog; break;
                    case "hall":
                        if (c == '#') tiles[i] = MapBlob.Wall; if (c == 'L') terrain[i] = (byte)TerrainKind.Light; if (c == 'M') ent.Add(t); break;
                }
            }
            double mx = ent.Average(m => m.x) - (fx0 + (size - 1) / 2.0), my = ent.Average(m => m.y) - (fy0 + (size - 1) / 2.0);
            byte front = kind == "bog" ? (byte)4 : FrontOf(mx, my);
            if (kind == "volcano")
            {
                double cx = lava.Average(l => l.x), cy = lava.Average(l => l.y);
                centre = lava.OrderBy(l => (l.x - cx) * (l.x - cx) + (l.y - cy) * (l.y - cy)).First();
                var (dx, dy) = Dir(front);
                if (sc.Edge) { var mid = EdgeStreams(ent, front, tiles, terrain); s.MidX = mid.x; s.MidY = mid.y; }
                else foreach (var o in ent)
                {   // continue each outlet outward: tiles beyond the footprint edge become Low + Lava for 7 more tiles
                    int x = o.x, y = o.y, run = 0;
                    while (run < 40)
                    {
                        x += dx; y += dy; run++;
                        if (x < 0 || y < 0 || x >= N || y >= N) break;
                        bool inside = x >= fx0 && x < fx0 + size && y >= fy0 && y < fy0 + size;
                        if (inside) continue;
                        int i = y * N + x; tiles[i] = MapBlob.Low; terrain[i] = (byte)TerrainKind.Lava;
                        if (Math.Abs(x - (dx != 0 ? (dx > 0 ? fx0 + size - 1 : fx0) : x)) >= 7 || Math.Abs(y - (dy != 0 ? (dy > 0 ? fy0 + size - 1 : fy0) : y)) >= 7) break;
                    }
                }
            }
            if (kind == "hall") centre = (fx0 + 18, fy0 + 18);
            byte akind = kind == "volcano" ? MapBlob.AnchorKindVolcano : kind == "church" ? MapBlob.AnchorKindChurch : kind == "bog" ? MapBlob.AnchorKindBogTree
                : kind == "cave" ? MapBlob.AnchorKindCave : MapBlob.AnchorKindHall;
            s.Anchor = new MapAnchor(zone, akind, new MapTile((ushort)centre.x, (ushort)centre.y), new MapRect((ushort)fx0, (ushort)fy0, (ushort)size, (ushort)size), front,
                ent.Select(m => new MapTile((ushort)m.x, (ushort)m.y)).ToArray());
            s.Map = new MapBlob(N, N, tiles, terrain, regions, MapBlob.GroundTerrainAll).WithPublic(null, null, null, null, null, null, new[] { s.Anchor });
            s.EntX = ent.Average(m => m.x); s.EntY = ent.Average(m => m.y); s.Front = front;
            s.Under = kind == "cave" || kind == "church" || kind == "hall" ? "inside" : kind == "bog" ? "under" : null;
            return s;
        }

        /// <summary>One 60 x 60 zone with an L-shaped wall cluster and a fence run (Low + Fence) or a 6 x 4 bog patch (plague), no landmark.
        /// Dressed adds a ground-variant plane and one prop (a non-empty prop list is what makes the client treat the map as dressed).</summary>
        static MapBlob ZoneMap(byte zone, bool bog, bool dressed)
        {
            var tiles = new byte[N * N]; var terrain = new byte[N * N]; var regions = new byte[N * N];
            for (int i = 0; i < regions.Length; i++) regions[i] = zone;
            for (int y = 24; y <= 31; y++) for (int x = 26; x <= 27; x++) tiles[y * N + x] = MapBlob.Wall;      // L: vertical arm
            for (int y = 30; y <= 31; y++) for (int x = 28; x <= 34; x++) tiles[y * N + x] = MapBlob.Wall;      // L: foot
            if (bog) { for (int y = 34; y < 38; y++) for (int x = 33; x < 39; x++) terrain[y * N + x] = (byte)TerrainKind.Bog; }
            else for (int x = 33; x <= 41; x++) { tiles[34 * N + x] = MapBlob.Low; terrain[34 * N + x] = (byte)TerrainKind.Fence; }
            var map = new MapBlob(N, N, tiles, terrain, regions, MapBlob.GroundTerrainAll);
            if (!dressed) return map;
            // ground-variant plane: water 7, mud 8, light 2 and dark 1 patches from smooth value noise
            var v = new byte[N * N];
            Func<float, float, float, float> noise = (x, y, f) => { float a = Mathf.Sin(x * f * 1.7f + 1.3f) * Mathf.Cos(y * f * 1.3f + .7f) + Mathf.Sin((x + y) * f * .9f + 2f) * .6f; return .5f + .3f * a; };
            for (int y = 0; y < N; y++) for (int x = 0; x < N; x++)
            {
                if (tiles[y * N + x] != MapBlob.Floor || terrain[y * N + x] != 0) continue;
                float a = noise(x, y, .22f), b = noise(x + 40, y + 17, .31f);
                v[y * N + x] = (byte)(a > .72f ? 7 : b > .74f ? 8 : a < .22f ? 1 : b < .2f ? 2 : 0);
            }
            return map.WithPublic(null, null, null, new[] { new MapProp(1, 64, 64, 0, 0) }, v);
        }

        // ---- the render target ------------------------------------------------------------------------------------------------

        /// <summary>The render target every shot is drawn into: 1920 x 1080, 24-bit depth, ARGB32, sRGB.</summary>
        public static RenderTextureDescriptor TargetDescriptor()
        {
            var d = new RenderTextureDescriptor(Width, Height, RenderTextureFormat.ARGB32, 24);
            d.sRGB = true;   // the project is Linear: a linear target written to PNG comes out dark and over-saturated
            return d;
        }

        // ---- rendering (needs graphics) ---------------------------------------------------------------------------------------

        static string Arg(string name, string fallback)
        {
            var a = Environment.GetCommandLineArgs();
            for (int i = 0; i < a.Length - 1; i++) if (a[i] == name) return a[i + 1];
            return fallback;
        }

        static RenderTexture _rt; static Camera _cam; static bool _groundOnly;
        static readonly List<GameObject> Actors = new List<GameObject>();
        static Sprite _white;

        static void Shot(ArenaView arena, string path, float tx, float ty, float ortho, float meX, float meY)
        {
            arena.Regions.SnapLocal(meX * 32f, meY * 32f);
            var faction = (FactionId)Mathf.Clamp(arena.Regions.LocalRegion == RegionId.Frost ? 3 : (int)arena.Regions.LocalRegion - 1, 0, 4);
            var me = new SelfView { Id = 1, Faction = faction, X = meX * 32f, Y = meY * 32f, Hp = 900, MaxHp = 985, Weapon = WeaponId.Sword, Status = ActorStatus.Alive };
            arena.Present(new List<InterpActor>(), me, null, 0.4f);   // the real self actor, drawn and noted for the landmark fade exactly as in a match
            _cam.orthographicSize = ortho; _cam.aspect = 16f / 9f;
            arena.Follow(_cam, tx * 32f, ty * 32f);
            for (int k = 0; k < 4; k++) arena.Atmosphere.OnFollow(_cam, 1f);   // converge the eased light and fades (no frames run in batch mode)
            var p = ArenaView.WorldPoint(tx * 32f, ty * 32f); _cam.transform.position = new Vector3(p.x, p.y, -30);
            if (_groundOnly)   // only the ground mesh draws (props, actors, particles, walls hidden)
                foreach (var r in UnityEngine.Object.FindObjectsByType<Renderer>(FindObjectsSortMode.None))
                    r.enabled = r is MeshRenderer m && m.sharedMaterial != null && m.sharedMaterial.shader != null && m.sharedMaterial.shader.name == "Roguehalla/RegionGround";
            _cam.targetTexture = _rt;
            for (int k = 0; k < 3; k++) _cam.Render();
            RenderTexture.active = _rt;
            var tex = new Texture2D(Width, Height, TextureFormat.RGBA32, false); tex.ReadPixels(new Rect(0, 0, Width, Height), 0, 0); tex.Apply();
            File.WriteAllBytes(path, tex.EncodeToPNG()); UnityEngine.Object.DestroyImmediate(tex);
            RenderTexture.active = null; _cam.targetTexture = null;
            Debug.Log("LookCapture: wrote " + path);
        }

        static void Actor(Transform parent, float tx, float ty, Color c)
        {   // stand-in: a flat coloured block 1 tile wide, 1.6 units tall, pivot at the feet, sorted like the roof (2000 + 16 * feet row + 8)
            if (_white == null) { var t = new Texture2D(4, 4); for (int i = 0; i < 16; i++) t.SetPixel(i % 4, i / 4, Color.white); t.Apply(); _white = Sprite.Create(t, new Rect(0, 0, 4, 4), new Vector2(.5f, 0f), 4f); }
            var go = new GameObject("stand-in actor"); go.transform.SetParent(parent, false);
            go.transform.position = ArenaView.WorldPoint(tx * 32f, ty * 32f) + new Vector3(0, -.3f * ArenaView.GroundSquash, 0);
            go.transform.localScale = new Vector3(1f, 1.6f, 1f);
            var r = go.AddComponent<SpriteRenderer>(); r.sprite = _white; r.color = c; r.sortingOrder = 2000 + 16 * Mathf.FloorToInt(ty) + 8;
            Actors.Add(go);
        }

        static void ClearActors() { foreach (var g in Actors) if (g != null) UnityEngine.Object.DestroyImmediate(g); Actors.Clear(); }

        static void ApplyQuality()
        {
            string q = Arg("-lookQuality", "ultra");
            var preset = q == "high" ? ShowcaseQuality.High : q == "medium" ? ShowcaseQuality.Medium : q == "low" ? ShowcaseQuality.Low : ShowcaseQuality.Ultra;
            AtmosphereQuality.ApplyPreset(preset, false);
        }

        static ArenaView NewArena(MapBlob map, out GameObject go)
        {
            go = new GameObject("Arena"); var arena = go.AddComponent<ArenaView>();
            AwakeOf().Invoke(arena, null); ApplyQuality();   // Unity does not run Awake for an object made in code in edit mode
            arena.Build(map); return arena;
        }

        static void RenderScene(string name, string outDir)
        {
            var sc = Parse(name); string path = Path.Combine(outDir, name + ".png");
            if (sc.IsZone)
            {
                GameObject go; var arena = NewArena(ZoneMap(ZoneOf(name), sc.Kind == "plague", sc.Dressed), out go);
                Actor(arena.transform, 24.5f, 34f, new Color(.95f, .25f, .25f));    // stand-in blocks
                Actor(arena.transform, 36f, 28.5f, new Color(.25f, .55f, 1f));
                Shot(arena, path, 31f, 31.5f, 9f, 30.5f, 35.5f);
                ClearActors(); UnityEngine.Object.DestroyImmediate(go);
                return;
            }
            var site = BuildSite(sc); GameObject arenaGo; var av = NewArena(site.Map, out arenaGo);
            var (dx, dy) = Dir(site.Front);
            if (sc.Edge)
            {   // the volcano's box two tiles from the map edge; no stand-ins
                float mx = (float)site.MidX, my = (float)site.MidY;
                if (sc.View == "wide") Shot(av, path, 30f, 27f, 22f, mx, my + 22);
                else if (sc.View == "close") Shot(av, path, mx, my + 4f, 9f, mx, my + 7);
                else Shot(av, path, 27f, 30f, 19.5f, mx + 10, my);
                UnityEngine.Object.DestroyImmediate(arenaGo);
                return;
            }
            var lv = (LandmarkView)LandmarksOf().GetValue(av);
            Debug.Log("LookCapture: " + name + " landmarks built = " + (lv == null ? -1 : lv.Count));
            string kind = sc.Kind;
            float box = site.Size + 16, ortho = Mathf.Max(box / 2f / (16f / 9f), box * ArenaView.GroundSquash / 2f);
            float cxm = site.FootX + site.Size / 2f, cym = site.FootY + site.Size / 2f;
            float ex = (float)site.EntX + .5f, ey = (float)site.EntY + .5f;
            if (sc.K == 0)
            {   // stand-ins only on the unrotated map: the doorway, two tiles out, and beside the door (just outside the wall face)
                int lx = dy != 0 ? 1 : 0, ly = dx != 0 ? 1 : 0;
                Actor(av.transform, ex, ey, new Color(.95f, .25f, .25f));
                Actor(av.transform, ex + dx * 3, ey + dy * 3, new Color(.25f, .55f, 1f));
                Actor(av.transform, ex + dx * 1 + lx * 5, ey + dy * 1 + ly * 5, new Color(.95f, .85f, .2f));
                if (kind == "volcano") Actor(av.transform, ex + dx * 10, ey + dy * 10, new Color(.25f, .55f, 1f));
                if (kind == "bog") Actor(av.transform, cxm + .5f, cym + 7.5f, new Color(.95f, .25f, .25f));
            }
            for (int i = 0; i < 2; i++) lv.Tick(1f);
            float meX = kind == "bog" ? cxm : ex + dx * 6, meY = kind == "bog" ? site.FootY + site.Size + 3.5f : ey + dy * 6;
            if (sc.View == "wide" || sc.View == "rot-wide") Shot(av, path, cxm, cym, ortho, meX, meY);
            else if (sc.View == "close")
            {
                float fx = ex - dx * 2.5f, fy = ey - dy * 2.5f;
                if (kind == "bog") { fx = cxm; fy = cym + 3f; }
                if (kind == "volcano") { fx = ex + dx * 3; fy = ey + dy * 3; }
                Shot(av, path, fx, fy, 9f, meX, meY);
            }
            else
            {   // inside | under: the self actor on an interior or cover tile near the centre, the roof faded fully
                var lm = lv.Get(0); var fades = FadesOf(); (int x, int y) best = (-1, -1); double bd = 1e9;
                double oy = site.Under == "under" ? 4 : 0;
                for (int y = site.FootY; y < site.FootY + site.Size; y++) for (int x = site.FootX; x < site.FootX + site.Size; x++)
                    if (site.Map.At(x, y) == MapBlob.Floor && (bool)fades.Invoke(lm, new object[] { x, y }))
                    { double d = (x - cxm) * (x - cxm) + (y - cym - oy) * (y - cym - oy); if (d < bd) { bd = d; best = (x, y); } }
                if (best.x < 0) throw new InvalidOperationException(name + ": no tile whose occupant fades the roof");
                Debug.Log("LookCapture: " + name + " fade tile " + best);
                for (int i = 0; i < 40; i++) { lv.NoteActor(ArenaView.WorldPoint((best.x + .5f) * 32f, (best.y + .5f) * 32f)); lv.Tick(.1f); }
                Debug.Log("LookCapture: " + name + " roofAlpha after fade = " + lm.RoofAlpha);
                bool under = site.Under == "under";
                float ior = under ? 9f : Mathf.Max(box * .45f / (16f / 9f), box * .45f * ArenaView.GroundSquash / 2f);
                Shot(av, path, under ? best.x + .5f : cxm, under ? best.y + .5f : cym, ior, best.x + .5f, best.y + .5f);
            }
            ClearActors(); UnityEngine.Object.DestroyImmediate(arenaGo);
        }

        /// <summary>Renders one caller-built map as one shot (camera centred on tile (tx, ty), orthographic size ortho) to a PNG, through the same ArenaView and Shot as the named scenes
        /// (P-UNITY-GROUND-BANDS-1: BandOutlineCapture). Needs graphics. The scene list is not touched.</summary>
        public static void RenderMap(MapBlob map, string path, float tx, float ty, float ortho, bool groundOnly)
        {
            if (_cam == null)
            {
                var camGo = new GameObject("Camera"); _cam = camGo.AddComponent<Camera>(); _cam.orthographic = true; _cam.clearFlags = CameraClearFlags.SolidColor;
                _cam.backgroundColor = new Color32(0x14, 0x17, 0x1b, 255); _cam.allowHDR = true; camGo.AddComponent<UniversalAdditionalCameraData>().renderPostProcessing = true;
            }
            if (_rt == null) _rt = new RenderTexture(TargetDescriptor());
            _groundOnly = groundOnly;
            GameObject go; var arena = NewArena(map, out go);
            Shot(arena, path, tx, ty, ortho, tx, ty);
            ClearActors(); UnityEngine.Object.DestroyImmediate(go);
        }

        static IEnumerable<object> RunInner()
        {
            var renamed = MissingReflectionTargets();
            if (renamed.Count > 0) throw new InvalidOperationException("LookCapture: client member(s) renamed: " + string.Join(", ", renamed));
            string outDir = Arg("-lookOut", ""); if (outDir.Length == 0) throw new ArgumentException("-lookOut <dir> is required");
            var scenes = Arg("-lookScenes", "").Split(new[] { ',' }, StringSplitOptions.RemoveEmptyEntries);
            if (scenes.Length == 0) throw new ArgumentException("-lookScenes a,b,c is required");
            foreach (var s in scenes) Parse(s);   // refuse an unknown name before rendering anything
            Directory.CreateDirectory(outDir);
            _groundOnly = Arg("-lookGroundOnly", "0") == "1";
            var camGo = new GameObject("Camera"); _cam = camGo.AddComponent<Camera>(); _cam.orthographic = true; _cam.clearFlags = CameraClearFlags.SolidColor;
            _cam.backgroundColor = new Color32(0x14, 0x17, 0x1b, 255); _cam.allowHDR = true; camGo.AddComponent<UniversalAdditionalCameraData>().renderPostProcessing = true;
            _rt = new RenderTexture(TargetDescriptor());
            foreach (var s in scenes) { RenderScene(s, outDir); yield return null; }
        }

        /// <summary>Batch entry: -executeMethod Roguehalla.Editor.LookCapture.Run -lookScenes a,b -lookOut dir [-lookGroundOnly 1] [-lookQuality q].</summary>
        public static void Run()
        {
            var it = RunInner().GetEnumerator(); int idle = 0;
            UnityEditor.EditorApplication.CallbackFunction step = null;
            step = () =>
            {
                if (++idle < 3) return;   // a few editor ticks after load
                try { if (it.MoveNext()) { UnityEditor.EditorApplication.QueuePlayerLoopUpdate(); return; } }
                catch (Exception e) { Debug.LogError("LookCapture failed: " + e); UnityEditor.EditorApplication.update -= step; UnityEditor.EditorApplication.Exit(1); return; }
                UnityEditor.EditorApplication.update -= step; UnityEditor.EditorApplication.Exit(0);
            };
            UnityEditor.EditorApplication.update += step;
        }
    }
}

// Deterministic decorative props. Placement is a pure function of the map (tile coordinates and the map hash): the same map
// puts the same props in the same places on every load. Props are presentation only: no colliders, no gameplay meaning, never
// on walls, low obstacles or terrain surfaces. Sorting matches actors (order = 2000 + serverY / 2), so actors walk in front of
// and behind props correctly. Tall props that would cover an observed actor fade out (fairness: nothing hides an actor that is in
// sight). Everything shares one atlas and one material.
using System.Collections.Generic;
using UnityEngine;
using Roguehalla.Net.Protocol;
using Roguehalla.Net.Ui;

namespace Roguehalla.Client
{
    public sealed class RegionProps : System.IDisposable
    {
        public struct Placement { public string Art; public float X, Y, Scale; public bool Flip; public int Tx, Ty; public int Bias; }

        struct Prop
        {
            public SpriteRenderer Renderer; public float FootX, FootY, HalfW, Height; public bool Tall;
            public float Alpha; public int MarkFrame; public bool InActive; public Color Base;
        }

        readonly List<Prop> _props = new List<Prop>(2048);
        readonly float[] _noteX = new float[1], _noteY = new float[1];
        readonly List<int> _active = new List<int>(64);
        readonly Dictionary<int, List<int>> _tallByCell = new Dictionary<int, List<int>>();
        readonly List<Object> _owned = new List<Object>();
        GameObject _root; Material _material;
        public int Count { get { return _props.Count; } }

        /// <summary>The deterministic placement list, separated from rendering so tests can run it without a GPU.</summary>
        public static List<Placement> Scatter(MapBlob map)
        {
            var list = new List<Placement>(2048);
            if (map.Regions == null) { AddRealBushes(map, list); return list; }
            int w = map.W, h = map.H; var tiles = map.Tiles; var regions = map.Regions; var terrain = map.Terrain;     // props avoid every terrain tile, drawn or not
            int seed = unchecked((int)(map.LayerHash ^ (map.SemanticHash * 2654435761u)));
            var occupied = new bool[w * h]; var tallAt = new bool[w * h];
            var temple = TempleLayout.For(map); var plague = PlagueGround.Build(map);
            for (int y = 2; y < h - 2; y++) for (int x = 2; x < w - 2; x++)
            {
                int i = y * w + x;
                if (tiles[i] != MapBlob.Floor || (terrain != null && terrain[i] != 0)) continue;
                int region = regions[i]; if (region < 1 || region > 5) continue;
                if (temple.Contains(x, y)) continue;                              // the temple replaces the garden props inside its footprint
                if (plague.KindAt(x, y) == PlagueGround.Water) continue;          // nothing stands in the shallow water
                var theme = RegionThemes.Get(region); var rules = theme.Props; if (rules.Length == 0) continue;
                float roll = RegionNoise.Hash01(x, y, seed), cum = 0f; int pick = -1;
                float pocket = theme.GroundParams.w > 0f ? RegionPocket.At(x + .5f, y + .5f) : 0f;
                for (int r = 0; r < rules.Length; r++)
                {
                    var rule = rules[r];
                    if (pocket < rule.PocketMin || pocket > rule.PocketMax) continue;
                    if (rule.NearTerrain != TerrainKind.None && !NearTerrain(terrain, w, h, x, y, (byte)rule.NearTerrain, 2)) continue;
                    cum += rule.PerHundredTiles / 100f;
                    if (roll < cum) { pick = r; break; }
                }
                if (pick < 0) continue;
                var chosen = rules[pick];
                // With the map's bush plane the real concealment cells are drawn below; a decorative bush would only imitate concealment.
                if (map.Bushes != null && (chosen.Art.EndsWith(".bush") || chosen.Art == "holy.shrub")) continue;
                if (occupied[i]) continue;
                if (!Clear(tiles, terrain, w, h, x, y, chosen.WallClearance)) continue;
                // Spacing-only list: it decides which props may not touch. It is NOT the fade rule (that is the art's Tall flag, via PropFade).
                // It stays as it was so placement is unchanged; the dressing bake replaces Scatter later.
                // Keep a couple of tiles between regions' edges and tall props, and never stack tall props next to each other.
                bool tall = chosen.Art.EndsWith("pine") || chosen.Art.EndsWith("pine2") || chosen.Art.EndsWith("tree") || chosen.Art.EndsWith("palm") || chosen.Art.EndsWith("spire")
                            || chosen.Art.EndsWith("stump") || chosen.Art.EndsWith("deadtree") || chosen.Art.EndsWith("scarecrow") || chosen.Art.EndsWith("column") || chosen.Art.EndsWith("pillar");
                if (tall && (tallAt[i] || tallAt[i - 1] || tallAt[i + 1] || tallAt[i - w] || tallAt[i + w] || tallAt[i - w - 1] || tallAt[i - w + 1])) continue;
                occupied[i] = true; if (tall) tallAt[i] = true;
                float jx = (RegionNoise.Hash01(x, y, seed + 1) - .5f) * .62f, jy = (RegionNoise.Hash01(x, y, seed + 2) - .5f) * .50f;
                float scale = Mathf.Lerp(chosen.ScaleMin, chosen.ScaleMax, RegionNoise.Hash01(x, y, seed + 3));
                list.Add(new Placement { Art = chosen.Art, X = x + .5f + jx, Y = y + .5f + jy, Scale = scale, Flip = RegionNoise.Hash01(x, y, seed + 4) < .5f, Tx = x, Ty = y });
            }
            // Temple towers, domes and braziers (deterministic, from the layout), then the coliseum's first prop pass.
            foreach (var d in temple.Props)
                list.Add(new Placement { Art = d.Art, X = d.X, Y = d.Y, Scale = d.Scale, Flip = d.Flip, Tx = Mathf.FloorToInt(d.X), Ty = Mathf.FloorToInt(d.Y + (d.Bias > 0 ? 1.5f : 0f)), Bias = d.Bias });
            ColiseumProps.Add(map, list, seed);
            AddRealBushes(map, list);
            return list;
        }

        /// <summary>One bush per real concealment cell of the map blob's bush plane (protocol 17), in the zone's own bush art.</summary>
        static void AddRealBushes(MapBlob map, List<Placement> list)
        {
            var bushes = map.Bushes; if (bushes == null || bushes.Length != map.W * map.H) return;
            for (int y = 0; y < map.H; y++) for (int x = 0; x < map.W; x++)
            {
                int i = y * map.W + x; if (bushes[i] == 0) continue;
                int region = map.Regions != null && map.Regions.Length == map.W * map.H ? map.Regions[i] : 0;
                string art = region == 4 ? "frost.bush" : region == 5 ? "holy.shrub" : "plague.bush";
                list.Add(new Placement { Art = art, X = x + .5f, Y = y + .5f, Scale = 1f, Flip = ((x * 7 + y * 13) & 1) == 1, Tx = x, Ty = y });
            }
        }

        static bool Clear(byte[] tiles, byte[] terrain, int w, int h, int x, int y, int radius)
        {
            for (int dy = -radius; dy <= radius; dy++) for (int dx = -radius; dx <= radius; dx++)
            {
                int nx = x + dx, ny = y + dy; if (nx < 0 || ny < 0 || nx >= w || ny >= h) return false;
                int j = ny * w + nx;
                if (tiles[j] != MapBlob.Floor) return false;
                if (terrain != null && (terrain[j] == (byte)TerrainKind.Lava || terrain[j] == (byte)TerrainKind.Crevasse)) return false;
            }
            return true;
        }
        static bool NearTerrain(byte[] terrain, int w, int h, int x, int y, byte kind, int radius)
        {
            if (terrain == null) return false;
            for (int dy = -radius; dy <= radius; dy++) for (int dx = -radius; dx <= radius; dx++)
            {
                int nx = x + dx, ny = y + dy; if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
                if (terrain[ny * w + nx] == kind) return true;
            }
            return false;
        }

        public static RegionProps Build(Transform parent, MapBlob map)
        {
            var p = new RegionProps(); p.Create(parent, map); return p;
        }

        void Create(Transform parent, MapBlob map)
        {
            _root = new GameObject("Region props (deterministic, decorative)"); _root.transform.SetParent(parent, false);
            var litShader = Resources.Load<Shader>("Regions/RegionSpriteLit");
            _material = litShader != null ? new Material(litShader) { name = "Roguehalla / region props (sun lit)" } : ShowcaseSprites.Lit;
            if (litShader != null) _owned.Add(_material);
            var placements = Scatter(map);
            foreach (var pl in placements)
            {
                if (!RegionPropArt.TryGet(pl.Art, out var art)) continue;
                var go = new GameObject(pl.Art); go.transform.SetParent(_root.transform, false);
                Vector3 foot = ArenaView.WorldPoint(pl.X * 32f, pl.Y * 32f);
                go.transform.localPosition = foot; go.transform.localScale = new Vector3(pl.Flip ? -pl.Scale : pl.Scale, pl.Scale, 1f);
                var sr = go.AddComponent<SpriteRenderer>(); sr.sprite = art.Sprite; sr.sharedMaterial = _material;
                sr.sortingOrder = 2000 + Mathf.RoundToInt(pl.Y * 32f * .5f) + pl.Bias;
                var prop = new Prop { Renderer = sr, FootX = foot.x, FootY = foot.y, HalfW = art.Width * .5f * pl.Scale * .8f, Height = art.Height * pl.Scale, Tall = art.Tall, Alpha = 1f, MarkFrame = -10, Base = Color.white };
                int index = _props.Count; _props.Add(prop);
                if (art.Tall)
                {
                    int key = Cell(pl.Tx, pl.Ty); if (!_tallByCell.TryGetValue(key, out var cell)) { cell = new List<int>(2); _tallByCell[key] = cell; }
                    cell.Add(index);
                }
            }
        }
        static int Cell(int tx, int ty) { return ty * 4096 + tx; }

        /// <summary>Call once per frame for each actor drawn: marks tall props standing in front of it so they fade.</summary>
        public void NoteActor(Vector3 feet)
        {
            if (_tallByCell.Count == 0) return;
            int tx = Mathf.FloorToInt(feet.x), ty = Mathf.FloorToInt(-feet.y / ArenaView.GroundSquash);
            int frame = Time.frameCount;
            // Props that can cover this actor stand up to ~3 tiles south (in front), or one tile north (actor inside the footprint).
            _noteX[0] = feet.x; _noteY[0] = feet.y;
            for (int dy = -1; dy <= 3; dy++) for (int dx = -2; dx <= 2; dx++)
            {
                if (!_tallByCell.TryGetValue(Cell(tx + dx, ty + dy), out var cell)) continue;
                for (int k = 0; k < cell.Count; k++)
                {
                    var p = _props[cell[k]];
                    if (PropFade.TargetAlpha(p.FootX, p.FootY, p.HalfW, p.Height, PropFade.FootDepth, _noteX, _noteY, 1) >= 1f) continue;
                    p.MarkFrame = frame;
                    if (!p.InActive) { p.InActive = true; _active.Add(cell[k]); }
                    _props[cell[k]] = p;
                }
            }
        }

        /// <summary>Moves fading props toward their target; no allocation.</summary>
        public void Tick(float dt)
        {
            int frame = Time.frameCount;
            for (int i = _active.Count - 1; i >= 0; i--)
            {
                int idx = _active[i]; var p = _props[idx];
                float target = frame - p.MarkFrame <= 1 ? PropFade.FadedAlpha : 1f;
                p.Alpha = Mathf.MoveTowards(p.Alpha, target, PropFade.FadeRate * Mathf.Max(dt, 0f));
                var c = p.Base; c.a = p.Alpha; p.Renderer.color = c;
                if (p.Alpha >= 1f && target >= 1f) { p.InActive = false; _active.RemoveAt(i); }
                _props[idx] = p;
            }
        }

        public void Dispose()
        {
            foreach (var o in _owned) if (o != null) RegionUtil.Kill(o);
            _owned.Clear(); _props.Clear(); _active.Clear(); _tallByCell.Clear();
            if (_root != null) RegionUtil.Kill(_root);
        }
    }
}

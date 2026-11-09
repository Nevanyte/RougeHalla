using System.Collections.Generic;
using UnityEngine;

namespace Roguehalla.Client
{
    public enum ShowcaseBiome { Neutral = -1, Fire, Sentenced, Plague, Frost, Holy }
    public enum ShowcaseTerrainArt { Lava, HealingLight, Ice, Bog }

    /// <summary>
    /// Original, cached 2D surface artwork. Selecting or placing a biome/terrain requires delivered public facts.
    /// A floor/wall-only map may use Neutral; this class never infers zones, hazards or healing from position.
    /// </summary>
    public static class ShowcaseBiomeArt
    {
        public readonly struct Tokens
        {
            public readonly Color Ground, Recess, Edge, Accent;
            public readonly string Name, Pattern;
            public Tokens(string name, string pattern, Color32 ground, Color32 recess, Color32 edge, Color32 accent)
            { Name = name; Pattern = pattern; Ground = ground; Recess = recess; Edge = edge; Accent = accent; }
        }

        const int Resolution = 256;
        static readonly Dictionary<string, Sprite> Cache = new Dictionary<string, Sprite>();
        static readonly List<Object> Owned = new List<Object>();
        static readonly Tokens[] Styles =
        {
            new Tokens("Arena stone", "staggered flagstone", new Color32(87,81,73,255), new Color32(34,32,30,255), new Color32(153,140,117,255), new Color32(205,174,111,255)),
            new Tokens("Obsidian ash", "fractured plates", new Color32(54,47,53,255), new Color32(17,19,25,255), new Color32(104,75,70,255), new Color32(255,126,94,255)),
            new Tokens("Iron precinct", "square chain inlay", new Color32(78,82,100,255), new Color32(33,38,52,255), new Color32(130,135,158,255), new Color32(205,184,255,255)),
            new Tokens("Decayed earth", "moss islands", new Color32(96,116,75,255), new Color32(43,49,34,255), new Color32(145,150,100,255), new Color32(178,220,128,255)),
            new Tokens("Blue slate", "crystalline facets", new Color32(119,160,181,255), new Color32(48,78,105,255), new Color32(192,227,238,255), new Color32(120,210,239,255)),
            new Tokens("Aged ivory", "gold cross inlay", new Color32(197,187,151,255), new Color32(98,87,63,255), new Color32(235,225,192,255), new Color32(255,226,145,255))
        };

        public static Tokens Style(ShowcaseBiome biome)
        {
            int index = (int)biome + 1;
            return Styles[index >= 0 && index < Styles.Length ? index : 0];
        }

        public static Sprite Floor(ShowcaseBiome biome, int variant = 0)
        {
            if ((int)biome < -1 || (int)biome > 4) biome = ShowcaseBiome.Neutral;
            variant = ((variant % 3) + 3) % 3;
            string key = "floor/" + biome + "/" + variant;
            if (Cache.TryGetValue(key, out var ready)) return ready;
            Tokens tokens = Style(biome);
            var colors = new Color32[Resolution * Resolution];
            var heights = new float[colors.Length];
            for (int y = 0; y < Resolution; y++) for (int x = 0; x < Resolution; x++)
            {
                float grain = Noise(x, y, variant + 17) - .5f;
                float low = SmoothNoise(x, y, 17 + variant) - .5f;
                int row = y / 64;
                int shift = biome == ShowcaseBiome.Sentenced ? 0 : (row & 1) * 32;
                int localX = (x + shift) % 64, localY = y % 64;
                float rim = Mathf.Min(Mathf.Min(localX, 63 - localX), Mathf.Min(localY, 63 - localY));
                float face = Mathf.Clamp01(rim / 4f);
                float plate = Noise((x + shift) / 64, row, variant + 31);
                Color color = Color.Lerp(tokens.Recess, tokens.Ground * (.85f + .25f * plate), face);
                color *= .96f + grain * .10f + low * .10f;
                float height = face * .8f + grain * .035f;
                if (rim > 2f && rim < 4f) color = Color.Lerp(color, tokens.Edge, .32f);

                float u = x / (float)Resolution, v = y / (float)Resolution;
                if (biome == ShowcaseBiome.Fire)
                {
                    float crack = Mathf.Abs(localX - 19f - Mathf.Sin((localY + variant * 11) * .13f) * 8f);
                    if (crack < 1.2f && localY > 13 && localY < 55) { color = tokens.Recess; height -= .2f; }
                    // Warm reflected rock edges; actual lava is a separate explicitly placed terrain layer.
                    if (rim > 1 && rim < 3 && plate > .5f) color = Color.Lerp(color, tokens.Edge, .45f);
                }
                else if (biome == ShowcaseBiome.Sentenced)
                {
                    bool iron = localX < 2 || localY < 2;
                    bool rivet = (localX - 8) * (localX - 8) + (localY - 8) * (localY - 8) < 5;
                    if (iron) color = tokens.Recess;
                    if (rivet) { color = tokens.Edge; height += .18f; }
                    if (Mathf.Abs(localX - 32) + Mathf.Abs(localY - 32) < 7 && plate > .65f)
                        color = Color.Lerp(color, tokens.Accent, .25f);
                }
                else if (biome == ShowcaseBiome.Plague)
                {
                    float moss = SmoothNoise(x + 83, y + 127, variant + 113);
                    float clump = Mathf.SmoothStep(0f, 1f, Mathf.InverseLerp(.43f, .76f, moss));
                    color = Color.Lerp(color, new Color(.23f,.32f,.13f,1), clump * .65f);
                    height += clump * .12f;
                    if (Noise(x / 3, y / 3, 719) > .94f) color = Color.Lerp(color, tokens.Edge, .25f);
                }
                else if (biome == ShowcaseBiome.Frost)
                {
                    float diagonal = Mathf.Abs(((x + y * 2 + variant * 16) % 64) - 32f);
                    float facet = Mathf.Abs(((x * 2 - y + 512) % 64) - 32f);
                    if (diagonal < 1.1f || facet < .8f) { color = Color.Lerp(color, tokens.Edge, .7f); height += .12f; }
                    color = Color.Lerp(color, tokens.Edge, Mathf.Clamp01((u - v + .4f) * .3f) * .18f);
                }
                else if (biome == ShowcaseBiome.Holy)
                {
                    bool inlay = (Mathf.Abs(localX - 32) < 1.2f && localY > 21 && localY < 43) ||
                        (Mathf.Abs(localY - 32) < 1.2f && localX > 21 && localX < 43);
                    if (inlay && plate > .35f) { color = new Color32(140,106,48,255); height -= .08f; }
                    if (rim < 1.2f) color = Color.Lerp(tokens.Recess, tokens.Accent, .18f);
                }
                color.a = 1; colors[y * Resolution + x] = color; heights[y * Resolution + x] = height;
            }
            return Create(key, colors, heights);
        }

        public static Sprite Terrain(ShowcaseTerrainArt terrain, bool emission = false)
        {
            if ((uint)terrain > (uint)ShowcaseTerrainArt.Bog) return null;
            string key = "terrain/" + terrain + (emission ? "/emission" : "/surface");
            if (Cache.TryGetValue(key, out var ready)) return ready;
            var colors = new Color32[Resolution * Resolution];
            var heights = new float[colors.Length];
            for (int y = 0; y < Resolution; y++) for (int x = 0; x < Resolution; x++)
            {
                float u = (x + .5f) / Resolution * 2 - 1, v = (y + .5f) / Resolution * 2 - 1;
                float grain = SmoothNoise(x, y, 417), fine = Noise(x, y, 181);
                Color color; float alpha = 1, height = 0;
                switch (terrain)
                {
                    case ShowcaseTerrainArt.Lava:
                        // Domain-warped Voronoi edges form irregular molten channels between dark plates.
                        float hot = LavaHeat(x, y, grain);
                        color = Color.Lerp(new Color32(30,25,33,255), new Color32(238,66,13,255), Mathf.Sqrt(hot));
                        color = Color.Lerp(color, new Color32(255,217,112,255), hot * hot);
                        color *= .9f + fine * .12f;
                        height = (1f-hot) * .22f;
                        if (emission) alpha = hot * (.72f + grain * .25f);
                        break;
                    case ShowcaseTerrainArt.HealingLight:
                        float radius = Mathf.Sqrt(u * u + v * v);
                        float halo = Mathf.Clamp01((.035f - Mathf.Abs(radius - .73f)) * 100);
                        float cross = Mathf.Abs(u) < .024f && Mathf.Abs(v) < .43f || Mathf.Abs(v - .08f) < .024f && Mathf.Abs(u) < .28f ? 1 : 0;
                        color = Color.Lerp(new Color32(190,145,57,255), new Color32(255,238,180,255), Mathf.Max(halo, cross));
                        alpha = Mathf.Clamp01(1 - radius) * .26f + Mathf.Max(halo, cross) * .7f;
                        if (emission) alpha *= .8f;
                        break;
                    case ShowcaseTerrainArt.Ice:
                        float line = Mathf.Abs(((x + y * 2) % 73) - 36f);
                        float shard = Mathf.Abs(((x * 2 - y + 512) % 101) - 50f);
                        float gleam = Mathf.Max(Mathf.Clamp01((1.5f - line) * 1.4f), Mathf.Clamp01((1f - shard) * 2));
                        color = Color.Lerp(new Color32(72,150,189,255), new Color32(225,250,255,255), gleam);
                        alpha = .34f + grain * .13f + gleam * .26f;
                        height = grain * .1f + gleam * .2f;
                        if (emission) alpha = gleam * .65f;
                        break;
                    default:
                        float ripple = Mathf.Abs(Mathf.Sin(Mathf.Sqrt(u*u+v*v) * 29f + grain * 2));
                        color = Color.Lerp(new Color32(42,56,27,255), new Color32(151,183,76,255), ripple * grain);
                        alpha = emission ? Mathf.Clamp01((fine - .96f) * 20f) * .35f : .9f;
                        height = grain * .06f;
                        break;
                }
                if (emission) color = Color.white;
                color.a = alpha; colors[y * Resolution + x] = color; heights[y * Resolution + x] = height;
            }
            return Create(key, colors, emission ? null : heights);
        }

        static float LavaHeat(int x, int y, float grain)
        {
            float px = (x + (grain-.5f)*19f) / 43f;
            float py = (y + (SmoothNoise(x+53,y+87,811)-.5f)*19f) / 43f;
            int gx = Mathf.FloorToInt(px), gy = Mathf.FloorToInt(py);
            float nearest = 100f, second = 100f;
            for(int oy=-1;oy<=1;oy++) for(int ox=-1;ox<=1;ox++)
            {
                int cx=gx+ox, cy=gy+oy;
                float sx=cx+.18f+Noise(cx,cy,83)*.64f;
                float sy=cy+.18f+Noise(cx,cy,917)*.64f;
                float d=(px-sx)*(px-sx)+(py-sy)*(py-sy);
                if(d<nearest) {second=nearest;nearest=d;} else if(d<second) second=d;
            }
            return 1f-Mathf.SmoothStep(0f,1f,Mathf.InverseLerp(.015f,.19f,second-nearest));
        }

        static Sprite Create(string key, Color32[] colors, float[] heights)
        {
            bool periodic = key.StartsWith("floor/", System.StringComparison.Ordinal);
            var texture = new Texture2D(Resolution, Resolution, TextureFormat.RGBA32, false)
            { name = "Original surface / " + key, filterMode = FilterMode.Bilinear, wrapMode = periodic ? TextureWrapMode.Repeat : TextureWrapMode.Clamp };
            texture.SetPixels32(colors); texture.Apply(false, true); Owned.Add(texture);
            SecondarySpriteTexture[] secondary = null;
            if (heights != null)
            {
                var normalPixels = new Color32[colors.Length];
                for (int y = 0; y < Resolution; y++) for (int x = 0; x < Resolution; x++)
                {
                    int left = periodic ? (x + Resolution - 1) % Resolution : Mathf.Max(0,x-1);
                    int right = periodic ? (x + 1) % Resolution : Mathf.Min(Resolution-1,x+1);
                    int down = periodic ? (y + Resolution - 1) % Resolution : Mathf.Max(0,y-1);
                    int up = periodic ? (y + 1) % Resolution : Mathf.Min(Resolution-1,y+1);
                    float dx = heights[y * Resolution + right] - heights[y * Resolution + left];
                    float dy = heights[up * Resolution + x] - heights[down * Resolution + x];
                    var normal = new Vector3(-dx * 1.7f, -dy * 1.7f, 1).normalized;
                    normalPixels[y * Resolution + x] = new Color(normal.x*.5f+.5f, normal.y*.5f+.5f, normal.z*.5f+.5f, 1);
                }
                var normalTexture = new Texture2D(Resolution, Resolution, TextureFormat.RGBA32, false, true)
                { name = key + " / relief normals", filterMode = FilterMode.Bilinear, wrapMode = periodic ? TextureWrapMode.Repeat : TextureWrapMode.Clamp };
                normalTexture.SetPixels32(normalPixels); normalTexture.Apply(false, true); Owned.Add(normalTexture);
                secondary = new[] { new SecondarySpriteTexture { name = "_NormalMap", texture = normalTexture } };
            }
            var sprite = Sprite.Create(texture, new Rect(0,0,Resolution,Resolution), new Vector2(.5f,.5f), Resolution, 0,
                SpriteMeshType.FullRect, Vector4.zero, false, secondary);
            sprite.name = key; Owned.Add(sprite); Cache.Add(key, sprite); return sprite;
        }

        static float SmoothNoise(int x, int y, int seed)
        {
            const int cell = 32, grid = Resolution / cell;
            x = ((x % Resolution) + Resolution) % Resolution;
            y = ((y % Resolution) + Resolution) % Resolution;
            int ix = Mathf.FloorToInt(x / (float)cell), iy = Mathf.FloorToInt(y / (float)cell);
            float fx = Mathf.SmoothStep(0,1,(x-ix*cell)/(float)cell), fy = Mathf.SmoothStep(0,1,(y-iy*cell)/(float)cell);
            return Mathf.Lerp(Mathf.Lerp(Noise(ix,iy,seed),Noise((ix+1)%grid,iy,seed),fx),
                Mathf.Lerp(Noise(ix,(iy+1)%grid,seed),Noise((ix+1)%grid,(iy+1)%grid,seed),fx),fy);
        }

        /// <summary>Release only after all users have released their renderers (application/Editor test teardown).</summary>
        public static void ReleaseCachedAssets()
        {
            for (int i = Owned.Count-1; i >= 0; i--)
                if (Owned[i] != null)
                {
                    if (Application.isPlaying) Object.Destroy(Owned[i]);
                    else Object.DestroyImmediate(Owned[i]);
                }
            Owned.Clear(); Cache.Clear();
        }

        static float Noise(int x, int y, int seed)
        {
            unchecked { uint k = (uint)(x*374761393 + y*668265263 + seed*1442695041); k = (k^(k>>13))*1274126177; return (k&65535)/65535f; }
        }
    }
}

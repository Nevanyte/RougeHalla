// Procedural, tileable ground detail for the five regions plus the coliseum, generated in code (no imported art, no ledger
// entry). Layer order = wire region id minus one: 0 fire, 1 sentenced, 2 plague, 3 frost, 4 holy, 5 coliseum.
// Channels are masks the region shader tints with the palette: r detail (relief already baked in), g secondary mask,
// b accent mask, a height. One texture covers 4x4 tiles.
using UnityEngine;
using static Roguehalla.Client.RegionNoise;

namespace Roguehalla.Client
{
    public static class RegionGroundTextures
    {
        public const int Size = 256, Layers = 6;

        /// <summary>Surface relief strength per layer (fire, sentenced, plague, frost, holy, coliseum): how steeply the baked height tilts the normal.</summary>
        static readonly float[] NormalStrength = { 3.2f, 3.6f, 2.6f, 2.2f, 2.4f, 3.2f };
        /// <summary>How polished each layer's raised parts are (the normal array's blue channel scales the specular response).</summary>
        static readonly float[] Polish = { .25f, .45f, .18f, .35f, .12f, .55f };

        public static Texture2DArray Build() { return Build(out _); }

        /// <summary>Ground detail array plus a matching normal array (rg = surface tilt in tile space from the same height channel, b = gloss) for the local lights.</summary>
        public static Texture2DArray Build(out Texture2DArray normals)
        {
            normals = new Texture2DArray(Size, Size, Layers, TextureFormat.RGBA32, true, true)
            { name = "Region ground normals", wrapMode = TextureWrapMode.Repeat, filterMode = FilterMode.Bilinear, anisoLevel = 2 };
            var npx = new Color32[Size * Size];
            var array = new Texture2DArray(Size, Size, Layers, TextureFormat.RGBA32, true, true)
            { name = "Region ground detail", wrapMode = TextureWrapMode.Repeat, filterMode = FilterMode.Bilinear, anisoLevel = 4 };
            var h = new float[Size * Size]; var r = new float[Size * Size]; var g = new float[Size * Size]; var b = new float[Size * Size];
            var px = new Color32[Size * Size];
            for (int layer = 0; layer < Layers; layer++)
            {
                switch (layer)
                {
                    case 0: Fire(h, r, g, b); break;
                    case 1: Sentenced(h, r, g, b); break;
                    case 2: Plague(h, r, g, b); break;
                    case 3: Frost(h, r, g, b); break;
                    case 4: Holy(h, r, g, b); break;
                    default: Coliseum(h, r, g, b); break;
                }
                float relief = layer == 3 ? 1.1f : layer == 4 ? 1.0f : layer == 0 ? .9f : .8f;
                for (int y = 0; y < Size; y++) for (int x = 0; x < Size; x++)
                {
                    int i = y * Size + x;
                    // Baked relief: light from the top left, height gradient across the wrap-around neighbours.
                    float nx = h[y * Size + (x + 1) % Size] - h[y * Size + (x + Size - 1) % Size];
                    float ny = h[((y + 1) % Size) * Size + x] - h[((y + Size - 1) % Size) * Size + x];
                    float lit = (nx * -.7f + ny * .7f) * 9f * relief;
                    float rr = Mathf.Clamp01(r[i] + lit * .5f);
                    px[i] = new Color32((byte)(rr * 255f), (byte)(Mathf.Clamp01(g[i]) * 255f), (byte)(Mathf.Clamp01(b[i]) * 255f), (byte)(Mathf.Clamp01(h[i]) * 255f));
                    // Normal tilt for the analytic local lights: minus the height gradient (rows grow with tile y, so the tilt is already in tile space).
                    float tx = Mathf.Clamp(-nx * NormalStrength[layer], -1f, 1f), ty = Mathf.Clamp(-ny * NormalStrength[layer], -1f, 1f);
                    npx[i] = new Color32((byte)((tx * .5f + .5f) * 255f), (byte)((ty * .5f + .5f) * 255f), (byte)(Mathf.Clamp01(h[i]) * Polish[layer] * 255f), 255);
                }
                array.SetPixelData(px, 0, layer);
                normals.SetPixelData(npx, 0, layer);
            }
            array.Apply(true, true);
            normals.Apply(true, true);
            return array;
        }

        static float U(int i) { return (i + .5f) / Size; }

        static void Fire(float[] h, float[] r, float[] g, float[] b)
        {
            for (int y = 0; y < Size; y++) for (int x = 0; x < Size; x++)
            {
                float u = U(x), v = U(y);
                // Warp the lookup so plates are not straight-sided.
                float wu = u + (Fbm(u, v, 4, 3, 5) - .5f) * .05f, wv = v + (Fbm(u, v, 4, 3, 9) - .5f) * .05f;
                Worley(wu, wv, 6, 21, out float f1, out float edge, out float id);
                float crack = 1f - SmoothStep(0f, .12f, edge);
                float plate = Mathf.Clamp01(1f - f1 * 1.6f);
                float grain = Fbm(u, v, 32, 3, 3) - .5f;
                float hot = id > .78f ? 1f : 0f;                     // only a few cracks run hot
                float cell = .42f + id * .28f;
                int i = y * Size + x;
                h[i] = plate * .8f - crack * .5f + grain * .1f;
                r[i] = (cell + grain * .30f) * (1f - crack * .55f);
                g[i] = Mathf.Clamp01(crack * .9f + (id > .72f ? .45f : 0f) * (1f - crack) + Mathf.Max(0, grain) * .4f);
                b[i] = crack * hot * SmoothStep(.15f, .65f, Fbm(u, v, 5, 3, 41));
            }
        }

        /// <summary>
        /// Sentenced ground: SQUARE dungeon flagstones (its own pattern, not the cracked cells Fire and Plague use). 4 x 4 one-tile slabs per 4-tile
        /// period in offset courses, dark grout, worn rounded edges, and now and then a cracked, missing or mossy slab. A new region pattern
        /// goes in exactly like this: one static function per region filling height, detail (r), secondary mask (g) and accent (b), added to
        /// the switch in Build above; the ground shader only blends the baked layers.
        /// </summary>
        static void Sentenced(float[] h, float[] r, float[] g, float[] b)
        {
            const int N = 4;
            for (int y = 0; y < Size; y++) for (int x = 0; x < Size; x++)
            {
                float u = U(x), v = U(y);
                float fv = v * N; int row = Mathf.FloorToInt(fv); float cy = fv - row;
                float fu = u * N; int col = Mathf.FloorToInt(fu); float cx = fu - col;   // straight grid of square slabs
                col = ((col % N) + N) % N;
                float edge = Mathf.Min(Mathf.Min(cx, 1f - cx), Mathf.Min(cy, 1f - cy));
                float grout = 1f - SmoothStep(.035f, .085f, edge);                       // dark joints
                float worn = 1f - SmoothStep(.08f, .26f, edge);                          // chamfered, worn edge
                float cellId = RegionNoise.Hash01(col, row, 211);
                float tone = .52f + cellId * .26f;
                float cracked = cellId > .94f ? 1f : 0f, missing = cellId < .05f ? 1f : 0f, mossy = (cellId > .55f && cellId < .66f) ? 1f : 0f;
                float diag = Mathf.Abs((cx - .5f) * .8f + (cy - .5f) * .6f + (RegionNoise.Hash01(col, row, 7) - .5f) * .4f);
                float crack = cracked * (1f - SmoothStep(.0f, .028f, diag)) * (1f - SmoothStep(.34f, .5f, Mathf.Max(Mathf.Abs(cx - .5f), Mathf.Abs(cy - .5f))));
                float grain = Fbm(u, v, 48, 3, 5) - .5f, wearN = Fbm(u, v, 6, 3, 21) - .5f;
                int i = y * Size + x;
                float pit = missing * (1f - grout);
                h[i] = (1f - grout) * .7f - worn * .15f - crack * .35f - pit * .5f;
                r[i] = Mathf.Clamp01((tone + wearN * .18f + grain * .14f) * (1f - grout * .5f - worn * .1f - crack * .5f - pit * .5f));
                g[i] = Mathf.Clamp01(mossy * SmoothStep(.15f, .55f, Fbm(u, v, 12, 3, 33) + worn * .3f) * .3f);
                b[i] = 0f;
            }
        }

        /// <summary>
        /// Plague detail (its own pattern, not the stone cells Fire used to share): r mud clods and cracks, g grass blade density (short
        /// vertical strokes), b wet pits and pebbles, a height. The shader decides where mud, grass and water go (PlagueGround).
        /// </summary>
        static void Plague(float[] h, float[] r, float[] g, float[] b)
        {
            for (int y = 0; y < Size; y++) for (int x = 0; x < Size; x++)
            {
                float u = U(x), v = U(y);
                float clod = Fbm(u, v, 9, 4, 61), fine = Fbm(u, v, 48, 2, 63) - .5f;
                Worley(u + (Fbm(u, v, 4, 3, 64) - .5f) * .05f, v, 7, 65, out float f1, out float edge, out float id);
                float dry = 1f - SmoothStep(0f, .05f, edge);                                   // fine dry-mud cracks
                float blade = PeriodicXY(u * 64f, v * 14f, 64, 14, 67);
                float blade2 = PeriodicXY(u * 40f + 3f, v * 9f, 40, 9, 69);
                float pit = SmoothStep(.62f, .8f, Fbm(u, v, 14, 3, 71));
                float peb = Hash01(x / 2, y / 2, 73) > .985f ? 1f : 0f;
                int i = y * Size + x;
                h[i] = clod * .6f + (1f - dry) * .2f - pit * .25f;
                r[i] = Mathf.Clamp01(.55f + (clod - .5f) * .5f + fine * .22f - dry * .25f);
                g[i] = Mathf.Clamp01(blade * .6f + blade2 * .4f);
                b[i] = Mathf.Clamp01(pit * .9f + peb * .8f);
            }
        }

        static void Frost(float[] h, float[] r, float[] g, float[] b)
        {
            for (int y = 0; y < Size; y++) for (int x = 0; x < Size; x++)
            {
                float u = U(x), v = U(y);
                float drift = Fbm(u, v, 3, 4, 71);
                // Wind-carved ripples: noise stretched along one axis, then thresholded into soft ridges.
                float streak = PeriodicXY(u * 3f, v * 14f + drift * 3f, 3, 14, 83);
                float ripple = Mathf.Abs(streak - .5f) * 2f;
                Worley(u + (drift - .5f) * .06f, v, 4, 91, out float f1, out float edge, out float id);
                float crackLine = 1f - SmoothStep(0f, .04f, edge);                          // faint frozen-ground fractures
                float fine = Fbm(u, v, 48, 2, 7) - .5f;
                int i = y * Size + x;
                h[i] = drift * .72f + (1f - ripple) * .18f - crackLine * .05f;
                r[i] = .60f + (drift - .5f) * .36f + (.5f - ripple) * .05f + fine * .035f - crackLine * .035f;
                g[i] = Mathf.Clamp01(SmoothStep(.52f, .30f, drift) * .85f + crackLine * .12f);   // blue shade in the hollows
                b[i] = Hash01(x / 2, y / 2, 98) > .9993f ? 1f : 0f; // rare glints (2x2 texels)
            }
        }

        static void Holy(float[] h, float[] r, float[] g, float[] b)
        {
            for (int y = 0; y < Size; y++) for (int x = 0; x < Size; x++)
            {
                float u = U(x), v = U(y);
                float dune = Fbm(u, v, 3, 3, 14);
                float rip = .5f + .5f * Mathf.Sin((v + (dune - .5f) * .16f) * Mathf.PI * 2f * 7f + u * Mathf.PI * 2f);
                float speck = Hash01(x, y, 3) - .5f;
                // Lawn blades: short vertical strokes, only visible where the shader opens a garden pocket.
                float blade = PeriodicXY(u * 56f, v * 12f, 56, 12, 29);
                int i = y * Size + x;
                h[i] = rip * .45f + dune * .4f;
                r[i] = .58f + (rip - .5f) * .18f + (dune - .5f) * .26f + speck * .09f;
                g[i] = Mathf.Clamp01(.35f + blade * .65f);
                b[i] = Hash01(x / 2, y / 2, 77) > .9990f ? 1f : 0f;                              // gold flecks
            }
        }

        static void Coliseum(float[] h, float[] r, float[] g, float[] b)
        {
            const int slabs = 4;
            for (int y = 0; y < Size; y++) for (int x = 0; x < Size; x++)
            {
                float u = U(x), v = U(y);
                float sy = v * slabs; int row = Mathf.FloorToInt(sy);
                float su = u * slabs + (row % 2 == 0 ? 0f : .5f);                          // running bond
                int col = Mathf.FloorToInt(su);
                float fx = su - col, fy = sy - row;
                float ex = Mathf.Min(fx, 1f - fx), ey = Mathf.Min(fy, 1f - fy), e = Mathf.Min(ex, ey);
                float joint = 1f - SmoothStep(0f, .035f, e), bevel = SmoothStep(0f, .09f, e);
                float cell = RegionNoise.Hash01(col & 3, row & 3, 12);
                float vein = Fbm(u, v, 5, 3, 23);
                float speck = Hash01(x, y, 5) - .5f;
                int i = y * Size + x;
                h[i] = bevel * .7f;
                r[i] = (.62f + (cell - .5f) * .22f + (vein - .5f) * .12f + speck * .08f) * (1f - joint * .55f);
                g[i] = Mathf.Clamp01(SmoothStep(.55f, .8f, vein) * .6f + joint * .3f);
                b[i] = 0f;
            }
        }
    }
}

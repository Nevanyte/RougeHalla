using System;
using Roguehalla.Net.Ui;
using UnityEngine;

namespace Roguehalla.Client
{
    public enum MapGlyph { Disc, Ring, Diamond, Triangle, Plus, Asterisk, Square, SquareRing, Cross, Trefoil, Line, DiamondRing }

    /// <summary>
    /// One mip-mapped atlas of white, analytically anti-aliased marker shapes (signed-distance evaluated per texel at 64 px per
    /// glyph), shared by the minimap and the Tab map marks and the legend icons. Tinted by vertex or Image colour, so it carries no
    /// colour of its own and stays crisp at any legacy scale and devicePixelRatio.
    /// </summary>
    public static class MapGlyphs
    {
        public const int Cell = 64, Grid = 4, AtlasSize = Cell * Grid;
        const float R = 26f; // glyph radius in texels, leaving a 6 texel margin so mips never bleed a neighbour
        static Texture2D _atlas;
        static readonly Sprite[] Sprites = new Sprite[Enum.GetValues(typeof(MapGlyph)).Length];

        public static Texture2D Texture { get { Ensure(); return _atlas; } }

        /// <summary>The atlas rectangle of a glyph in UV space (x, y, width, height).</summary>
        public static Rect Uv(MapGlyph glyph)
        {
            int i = (int)glyph, cx = i % Grid, cy = i / Grid;
            float s = 1f / Grid;
            return new Rect(cx * s, cy * s, s, s);
        }

        public static Sprite Sprite(MapGlyph glyph)
        {
            Ensure();
            int i = (int)glyph;
            if (Sprites[i] != null) return Sprites[i];
            int cx = i % Grid, cy = i / Grid;
            var sprite = UnityEngine.Sprite.Create(_atlas, new Rect(cx * Cell, cy * Cell, Cell, Cell), new Vector2(.5f, .5f), Cell, 0, SpriteMeshType.FullRect);
            sprite.name = "Map glyph " + glyph; sprite.hideFlags = HideFlags.HideAndDontSave;
            Sprites[i] = sprite;
            return sprite;
        }

        public static MapGlyph ForShape(ZoneShape shape)
        {
            switch (shape)
            {
                case ZoneShape.Triangle: return MapGlyph.Triangle;
                case ZoneShape.Diamond: return MapGlyph.Diamond;
                case ZoneShape.Disc: return MapGlyph.Trefoil;
                case ZoneShape.Asterisk: return MapGlyph.Asterisk;
                case ZoneShape.Ring: return MapGlyph.Ring;
                case ZoneShape.Square: return MapGlyph.SquareRing;
                default: return MapGlyph.Disc;
            }
        }

        static void Ensure()
        {
            if (_atlas != null) return;
            var texture = new Texture2D(AtlasSize, AtlasSize, TextureFormat.RGBA32, true, false)
            {
                name = "Map glyph atlas (generated)", filterMode = FilterMode.Trilinear, wrapMode = TextureWrapMode.Clamp, anisoLevel = 0, hideFlags = HideFlags.HideAndDontSave
            };
            var pixels = new Color32[AtlasSize * AtlasSize];
            foreach (MapGlyph glyph in Enum.GetValues(typeof(MapGlyph)))
            {
                int i = (int)glyph, ox = (i % Grid) * Cell, oy = (i / Grid) * Cell;
                for (int y = 0; y < Cell; y++)
                    for (int x = 0; x < Cell; x++)
                    {
                        float a = Coverage(glyph, x + .5f - Cell / 2f, y + .5f - Cell / 2f, y);
                        pixels[(oy + y) * AtlasSize + ox + x] = new Color32(255, 255, 255, (byte)Mathf.RoundToInt(Mathf.Clamp01(a) * 255f));
                    }
            }
            texture.SetPixels32(pixels); texture.Apply(true, false);
            _atlas = texture;
        }

        static float Coverage(MapGlyph glyph, float x, float y, int row)
        {
            if (glyph == MapGlyph.Line)
            {
                // A line profile across the cell (v): soft quarter ramps either side of a solid half, so a quad twice the line's
                // width draws an anti-aliased stroke of exactly that width.
                float t = (row + .5f) / Cell;
                return Mathf.SmoothStep(0f, 1f, Mathf.Clamp01(t * 4f)) * Mathf.SmoothStep(0f, 1f, Mathf.Clamp01((1f - t) * 4f));
            }
            return Mathf.Clamp01(.5f - Distance(glyph, x, y));
        }

        static float Box(float x, float y, float hx, float hy)
        {
            float dx = Mathf.Abs(x) - hx, dy = Mathf.Abs(y) - hy;
            return Mathf.Sqrt(Mathf.Max(dx, 0f) * Mathf.Max(dx, 0f) + Mathf.Max(dy, 0f) * Mathf.Max(dy, 0f)) + Mathf.Min(Mathf.Max(dx, dy), 0f);
        }

        static void Rotate(ref float x, ref float y, float degrees)
        {
            float a = degrees * Mathf.Deg2Rad, c = Mathf.Cos(a), s = Mathf.Sin(a), nx = x * c - y * s, ny = x * s + y * c;
            x = nx; y = ny;
        }

        /// <summary>Signed distance in texels (negative inside) of a glyph centred in its cell; +y is up in texture rows.</summary>
        static float Distance(MapGlyph glyph, float x, float y)
        {
            float len = Mathf.Sqrt(x * x + y * y);
            switch (glyph)
            {
                case MapGlyph.Disc: return len - R;
                case MapGlyph.Ring: return Mathf.Abs(len - R * .8f) - R * .2f;
                case MapGlyph.Diamond: return (Mathf.Abs(x) + Mathf.Abs(y) - R * 1.1f) * .7071f;
                case MapGlyph.DiamondRing: return Mathf.Abs((Mathf.Abs(x) + Mathf.Abs(y) - R * 1.1f) * .7071f + R * .2f) - R * .18f;
                case MapGlyph.Triangle:
                {
                    // Pointing up on screen: texture rows grow upward, so the apex is at +y.
                    float h = R * 1.05f, d = float.MinValue;
                    for (int k = 0; k < 3; k++)
                    {
                        float a = (90f + k * 120f) * Mathf.Deg2Rad;
                        // Edge plane opposite each vertex: its outward normal points away from the vertex.
                        float nx = -Mathf.Cos(a), ny = -Mathf.Sin(a);
                        d = Mathf.Max(d, x * nx + y * ny - h * .5f);
                    }
                    return d;
                }
                case MapGlyph.Plus: return Mathf.Min(Box(x, y, R, R * .25f), Box(x, y, R * .25f, R));
                case MapGlyph.Cross:
                {
                    Rotate(ref x, ref y, 45f);
                    return Mathf.Min(Box(x, y, R * 1.05f, R * .22f), Box(x, y, R * .22f, R * 1.05f));
                }
                case MapGlyph.Asterisk:
                {
                    float best = float.MaxValue;
                    for (int k = 0; k < 3; k++) { float px = x, py = y; Rotate(ref px, ref py, k * 60f); best = Mathf.Min(best, Box(px, py, R, R * .17f)); }
                    return best;
                }
                case MapGlyph.Square: return Box(x, y, R * .82f, R * .82f);
                case MapGlyph.SquareRing: return Mathf.Abs(Box(x, y, R * .8f, R * .8f) + R * .16f) - R * .16f;
                case MapGlyph.Trefoil:
                {
                    float best = float.MaxValue;
                    for (int k = 0; k < 3; k++)
                    {
                        float a = (90f + k * 120f) * Mathf.Deg2Rad, cx = Mathf.Cos(a) * R * .52f, cy = Mathf.Sin(a) * R * .52f;
                        best = Mathf.Min(best, Mathf.Sqrt((x - cx) * (x - cx) + (y - cy) * (y - cy)) - R * .5f);
                    }
                    return best;
                }
                default: return len - R;
            }
        }
    }
}

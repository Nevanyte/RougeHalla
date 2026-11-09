using System;
using System.Collections.Generic;
using UnityEngine;

namespace Roguehalla.Client
{
    /// <summary>Procedural monochrome icon atlas for presentation UI. No UI hierarchy or gameplay rules.</summary>
    public static class ShowcaseIconArt
    {
        const int CellSize = 128;
        const int GridSize = 8;
        const int AtlasSize = CellSize * GridSize;
        const int Supersample = 2;
        const int HiCell = CellSize * Supersample;
        const int IconInset = 16 * Supersample;
        const float UnitsToPixels = 4f * Supersample;
        static readonly Color32 Ink = new Color32(22, 27, 40, 255);
        static readonly Color32 White = new Color32(255, 255, 255, 255);

        sealed class Shape
        {
            public readonly int[][] Fill;
            public readonly int[][] Lines;
            public Shape(int[][] fill = null, int[][] lines = null) { Fill = fill ?? Array.Empty<int[]>(); Lines = lines ?? Array.Empty<int[]>(); }
        }

        static readonly string[] KeyArray =
        {
            "stat.ad", "stat.ap", "stat.damage", "stat.health", "stat.attackSpeed", "stat.armor", "stat.mr", "stat.speed", "stat.leech",
            "damage.physical", "damage.magic", "damage.true",
            "weapon.sword", "weapon.bow", "weapon.wand", "weapon.shield", "weapon.axe", "weapon.fists",
            "wish.freeze", "wish.swarm", "wish.trial", "wish.blaze", "wish.last-stand",
            "world.chest", "world.potion", "world.trader", "world.quest", "world.elite", "world.coin", "world.results", "world.reconnect", "world.sound", "world.settings", "world.map",
            "fallback.unknown"
        };
        static readonly IReadOnlyList<string> KeyList = Array.AsReadOnly(KeyArray);
        static Dictionary<string, Shape> _shapes;
        static Dictionary<string, Sprite> _sprites;
        static Texture2D _atlas;
        static Sprite _fallback;

        /// <summary>All supported semantic keys in stable atlas order.</summary>
        public static IReadOnlyList<string> Keys { get { return KeyList; } }

        /// <summary>Returns a cached sprite from the shared atlas; an unknown key returns a neutral diamond/question glyph.</summary>
        public static Sprite Get(string key)
        {
            EnsureAtlas();
            Sprite sprite;
            return key != null && _sprites.TryGetValue(key, out sprite) ? sprite : _fallback;
        }

        static void EnsureAtlas()
        {
            if (_atlas != null && _sprites != null) return;
            _shapes = BuildShapes();
            _atlas = new Texture2D(AtlasSize, AtlasSize, TextureFormat.RGBA32, false, false)
            {
                name = "Showcase Icon Atlas (Generated)",
                filterMode = FilterMode.Bilinear,
                wrapMode = TextureWrapMode.Clamp,
                anisoLevel = 0,
                hideFlags = HideFlags.HideAndDontSave
            };
            var atlasPixels = new Color32[AtlasSize * AtlasSize];
            var hires = new Color32[HiCell * HiCell];
            _sprites = new Dictionary<string, Sprite>(KeyArray.Length, StringComparer.Ordinal);
            for (int i = 0; i < KeyArray.Length; i++)
            {
                Array.Clear(hires, 0, hires.Length);
                Shape shape = _shapes[KeyArray[i]];
                DrawShape(hires, shape);
                int cellX = (i % GridSize) * CellSize;
                int cellY = (GridSize - 1 - i / GridSize) * CellSize;
                DownsampleCell(hires, atlasPixels, cellX, cellY);
                var sprite = Sprite.Create(_atlas, new Rect(cellX, cellY, CellSize, CellSize), new Vector2(0.5f, 0.5f), CellSize, 0, SpriteMeshType.FullRect, Vector4.zero, false);
                sprite.name = "Icon " + KeyArray[i];
                sprite.hideFlags = HideFlags.HideAndDontSave;
                _sprites.Add(KeyArray[i], sprite);
            }
            _atlas.SetPixels32(atlasPixels);
            _atlas.Apply(false, false);
            _fallback = _sprites["fallback.unknown"];
        }

        static Dictionary<string, Shape> BuildShapes()
        {
            var s = new Dictionary<string, Shape>(KeyArray.Length, StringComparer.Ordinal);
            int[] sword = P(5,16, 16,3, 21,3, 21,8, 8,19);
            int[] shield = P(12,2, 21,6, 20,15, 16,20, 12,23, 8,20, 4,15, 3,6, 12,2);
            int[] sparkle = P(12,1, 15,9, 23,12, 15,15, 12,23, 9,15, 1,12, 9,9);
            int[] drop = P(12,1, 20,12, 21,17, 18,22, 6,22, 3,17, 4,12);
            int[] boot = P(6,2, 13,2, 13,12, 21,16, 22,21, 3,21, 3,16, 6,13);
            int[] bow = P(6,2, 13,5, 17,12, 13,19, 6,22, 6,2);
            s["stat.ad"] = new Shape(new[] { sword }, new[] { P(4,13, 12,21), P(8,17, 3,22) });
            s["stat.ap"] = new Shape(new[] { sparkle });
            s["stat.damage"] = new Shape(new[] { sword, sparkle }, new[] { P(4,13, 12,21), P(8,17, 3,22) });
            s["stat.health"] = new Shape(lines: new[] { P(12,3, 12,21), P(3,12, 21,12) });
            s["stat.attackSpeed"] = new Shape(new[] { bow }, new[] { P(2,12, 23,12), P(19,8, 23,12, 19,16) });
            s["stat.armor"] = new Shape(lines: new[] { shield, P(12,6, 12,18) });
            s["stat.mr"] = new Shape(lines: new[] { P(12,2, 16,3, 20,6, 22,10, 22,14, 20,18, 16,21, 12,22, 8,21, 4,18, 2,14, 2,10, 4,6, 8,3, 12,2), P(12,6, 19,9, 18,15, 15,18, 12,20, 9,18, 6,15, 5,9, 12,6) });
            s["stat.speed"] = new Shape(new[] { boot });
            s["stat.leech"] = new Shape(new[] { drop });
            s["damage.physical"] = Clone(s["stat.ad"]);
            s["damage.magic"] = Clone(s["stat.ap"]);
            s["damage.true"] = new Shape(lines: new[] { P(12,2, 21,12, 12,22, 3,12, 12,2), P(7,12, 11,16, 17,8) });

            s["weapon.sword"] = Clone(s["stat.ad"]);
            s["weapon.bow"] = Clone(s["stat.attackSpeed"]);
            s["weapon.wand"] = new Shape(new[] { P(16,3, 21,5, 18,9, 14,8) }, new[] { P(17,6, 5,22), P(16,4, 21,9) });
            s["weapon.shield"] = new Shape(new[] { shield }, new[] { P(12,6, 12,18), P(8,12, 12,15, 16,10) });
            s["weapon.axe"] = new Shape(new[] { P(5,3, 13,5, 20,3, 21,8, 18,12, 13,11, 8,21, 4,18, 10,10, 6,8) }, new[] { P(10,10, 8,21) });
            s["weapon.fists"] = new Shape(new[] { P(4,10, 6,7, 8,7, 9,10, 10,6, 13,6, 14,10, 15,7, 18,7, 19,11, 21,10, 22,14, 19,19, 14,21, 8,20, 4,16) }, new[] { P(9,10, 9,14), P(14,10, 14,14), P(18,11, 17,14), P(4,14, 1,15, 4,17) });

            s["wish.freeze"] = new Shape(lines: new[] { P(12,2, 12,22), P(3,7, 21,17), P(3,17, 21,7), P(9,4, 12,7, 15,4), P(9,20, 12,17, 15,20), P(3,11, 7,12, 3,14), P(21,11, 17,12, 21,14), P(5,5, 8,6), P(16,18, 19,19), P(5,19, 8,18), P(16,6, 19,5) });
            s["wish.swarm"] = new Shape(lines: new[] { P(2,5, 11,9, 8,10), P(2,5, 5,8), P(3,12, 13,12, 10,14), P(3,12, 6,15), P(2,19, 11,15, 8,14), P(2,19, 5,16), P(13,5, 22,9, 19,10), P(13,5, 16,8), P(14,12, 23,12, 20,14), P(14,12, 17,15), P(13,19, 22,15, 19,14), P(13,19, 16,16) });
            s["wish.trial"] = new Shape(lines: new[] { P(12,2, 20,6, 18,17, 12,22, 6,17, 4,6, 12,2), P(7,10, 17,10), P(9,10, 12,16, 15,10), P(12,4, 12,7) });
            s["wish.blaze"] = new Shape(new[] { P(12,2, 17,8, 19,12, 18,18, 14,22, 7,21, 4,17, 5,12, 8,8, 9,14, 12,11, 12,2) }, new[] { P(12,15, 10,18, 12,20, 15,18, 14,15) });
            s["wish.last-stand"] = new Shape(new[] { shield }, new[] { P(12,7, 12,17), P(7,12, 17,12) });

            s["world.chest"] = new Shape(new[] { P(3,9, 21,9, 21,20, 3,20), P(3,8, 5,4, 19,4, 21,8) }, new[] { P(3,9, 21,9), P(12,10, 12,15), P(11,12, 13,12) });
            s["world.potion"] = new Shape(new[] { P(9,3, 15,3, 15,7, 18,10, 18,20, 6,20, 6,10, 9,7) }, new[] { P(8,3, 16,3), P(7,13, 17,13), P(10,2, 14,2) });
            s["world.trader"] = new Shape(new[] { P(3,7, 21,7, 21,10, 3,10), P(5,12, 19,12, 19,15, 5,15), P(7,17, 17,17, 17,20, 7,20) }, new[] { P(12,2, 12,5), P(9,4, 12,7, 15,4) });
            s["world.quest"] = new Shape(new[] { P(5,3, 19,3, 19,21, 5,21) }, new[] { P(8,7, 16,7), P(8,11, 16,11), P(8,15, 13,15), P(3,5, 3,19, 5,21) });
            s["world.elite"] = new Shape(new[] { P(3,7, 8,11, 12,4, 16,11, 21,7, 19,19, 5,19) }, new[] { P(5,21, 19,21), P(8,13, 16,13) });
            s["world.coin"] = new Shape(new[] { Circle(12,12,9,12) }, new[] { P(12,5, 12,19), P(15,8, 10,8, 9,11, 15,13, 14,16, 9,16) });
            s["world.results"] = new Shape(new[] { P(7,3, 17,3, 17,12, 12,17, 7,12) }, new[] { P(7,5, 3,5, 3,9, 8,12), P(17,5, 21,5, 21,9, 16,12), P(12,17, 12,20), P(8,21, 16,21), P(10,7, 14,7) });
            s["world.reconnect"] = new Shape(lines: new[] { P(5,8, 7,5, 11,3, 16,4, 19,7, 20,10), P(20,10, 20,5, 16,7), P(19,16, 17,19, 13,21, 8,20, 5,17, 4,14), P(4,14, 4,19, 8,17) });
            s["world.sound"] = new Shape(new[] { P(3,9, 7,9, 13,4, 13,20, 7,15, 3,15) }, new[] { P(16,8, 19,12, 16,16), P(18,5, 22,12, 18,19) });
            s["world.settings"] = new Shape(new[] { Gear(12,12,7,10,4) }, new[] { Circle(12,12,3,10) });
            s["world.map"] = new Shape(new[] { P(3,5, 9,3, 15,5, 21,3, 21,19, 15,21, 9,19, 3,21) }, new[] { P(9,3, 9,19), P(15,5, 15,21), P(5,9, 7,9), P(17,15, 19,15) });
            s["fallback.unknown"] = new Shape(new[] { P(12,2, 21,12, 12,22, 3,12) }, new[] { P(9,9, 10,7, 13,7, 15,9, 15,11, 12,13, 12,15), P(12,18, 12,18) });
            return s;
        }

        static Shape Clone(Shape shape) { return new Shape(shape.Fill, shape.Lines); }
        static int[] P(params int[] xy) { return xy; }

        static int[] Circle(int cx, int cy, int radius, int count)
        {
            var p = new int[count * 2];
            for (int i = 0; i < count; i++)
            {
                double a = (Math.PI * 2.0 * i / count) - Math.PI / 2.0;
                p[i * 2] = cx + Mathf.RoundToInt((float)Math.Cos(a) * radius);
                p[i * 2 + 1] = cy + Mathf.RoundToInt((float)Math.Sin(a) * radius);
            }
            return p;
        }

        static int[] Gear(int cx, int cy, int outer, int inner, int teeth)
        {
            int count = teeth * 4;
            var p = new int[count * 2];
            for (int i = 0; i < count; i++)
            {
                double a = (Math.PI * 2.0 * i / count) - Math.PI / 2.0;
                int r = (i % 4 == 0 || i % 4 == 1) ? outer : inner;
                p[i * 2] = cx + Mathf.RoundToInt((float)Math.Cos(a) * r);
                p[i * 2 + 1] = cy + Mathf.RoundToInt((float)Math.Sin(a) * r);
            }
            return p;
        }

        static void DrawShape(Color32[] pixels, Shape shape)
        {
            for (int i = 0; i < shape.Fill.Length; i++)
            {
                FillPolygon(pixels, shape.Fill[i]);
                Stroke(pixels, shape.Fill[i], 1.6f, Ink, true);
            }
            for (int i = 0; i < shape.Lines.Length; i++)
            {
                Stroke(pixels, shape.Lines[i], 1.8f, Ink, false);
                Stroke(pixels, shape.Lines[i], 0.85f, White, false);
            }
        }

        static void FillPolygon(Color32[] pixels, int[] points)
        {
            Bounds(points, out int minX, out int minY, out int maxX, out int maxY);
            int left = Mathf.Max(0, ToPx(minX) - 1), right = Mathf.Min(HiCell - 1, ToPx(maxX) + 1);
            int top = Mathf.Max(0, ToPy(minY) - 1), bottom = Mathf.Min(HiCell - 1, ToPy(maxY) + 1);
            for (int y = top; y <= bottom; y++)
                for (int x = left; x <= right; x++)
                    if (Inside(points, FromPx(x), FromPy(y))) pixels[y * HiCell + x] = White;
        }

        static void Stroke(Color32[] pixels, int[] points, float width, Color32 color, bool close)
        {
            int segments = points.Length / 2 - 1 + (close ? 1 : 0);
            float radius = width * UnitsToPixels * 0.5f;
            int minX = HiCell, minY = HiCell, maxX = 0, maxY = 0;
            for (int i = 0; i < points.Length; i += 2)
            {
                int x = ToPx(points[i]), y = ToPy(points[i + 1]);
                minX = Math.Min(minX, x); minY = Math.Min(minY, y); maxX = Math.Max(maxX, x); maxY = Math.Max(maxY, y);
            }
            int pad = Mathf.CeilToInt(radius) + 1;
            minX = Mathf.Max(0, minX - pad); minY = Mathf.Max(0, minY - pad);
            maxX = Mathf.Min(HiCell - 1, maxX + pad); maxY = Mathf.Min(HiCell - 1, maxY + pad);
            for (int y = minY; y <= maxY; y++)
            {
                for (int x = minX; x <= maxX; x++)
                {
                    float px = x + 0.5f, py = y + 0.5f;
                    for (int i = 0; i < segments; i++)
                    {
                        int a = (i * 2), b = ((i + 1) * 2) % points.Length;
                        float ax = ToPx(points[a]), ay = ToPy(points[a + 1]);
                        float bx = ToPx(points[b]), by = ToPy(points[b + 1]);
                        float dx = bx - ax, dy = by - ay;
                        float denom = dx * dx + dy * dy;
                        float t = denom > 0 ? Mathf.Clamp01(((px - ax) * dx + (py - ay) * dy) / denom) : 0;
                        float ex = px - (ax + dx * t), ey = py - (ay + dy * t);
                        if (ex * ex + ey * ey <= radius * radius) { pixels[y * HiCell + x] = color; break; }
                    }
                }
            }
        }

        static bool Inside(int[] points, float x, float y)
        {
            bool inside = false;
            int n = points.Length / 2;
            for (int i = 0, j = n - 1; i < n; j = i++)
            {
                float xi = points[i * 2], yi = points[i * 2 + 1];
                float xj = points[j * 2], yj = points[j * 2 + 1];
                if (((yi > y) != (yj > y)) && x < (xj - xi) * (y - yi) / (yj - yi) + xi) inside = !inside;
            }
            return inside;
        }

        static void Bounds(int[] points, out int minX, out int minY, out int maxX, out int maxY)
        {
            minX = minY = int.MaxValue; maxX = maxY = int.MinValue;
            for (int i = 0; i < points.Length; i += 2)
            {
                minX = Math.Min(minX, points[i]); maxX = Math.Max(maxX, points[i]);
                minY = Math.Min(minY, points[i + 1]); maxY = Math.Max(maxY, points[i + 1]);
            }
        }

        static int ToPx(int x) { return IconInset + Mathf.RoundToInt(x * UnitsToPixels); }
        static int ToPy(int y) { return HiCell - IconInset - Mathf.RoundToInt(y * UnitsToPixels); }
        static float FromPx(int x) { return (x + 0.5f - IconInset) / UnitsToPixels; }
        static float FromPy(int y) { return (HiCell - IconInset - (y + 0.5f)) / UnitsToPixels; }

        static void DownsampleCell(Color32[] source, Color32[] destination, int cellX, int cellY)
        {
            for (int y = 0; y < CellSize; y++)
            {
                int sy = (CellSize - 1 - y) * Supersample;
                for (int x = 0; x < CellSize; x++)
                {
                    int sx = x * Supersample;
                    int sumR = 0, sumG = 0, sumB = 0, sumA = 0;
                    for (int oy = 0; oy < Supersample; oy++)
                    for (int ox = 0; ox < Supersample; ox++)
                    {
                        Color32 c = source[(sy + oy) * HiCell + sx + ox];
                        sumR += c.r * c.a; sumG += c.g * c.a; sumB += c.b * c.a; sumA += c.a;
                    }
                    int count = Supersample * Supersample;
                    byte alpha = (byte)(sumA / count);
                    byte red = sumA == 0 ? (byte)0 : (byte)(sumR / sumA);
                    byte green = sumA == 0 ? (byte)0 : (byte)(sumG / sumA);
                    byte blue = sumA == 0 ? (byte)0 : (byte)(sumB / sumA);
                    destination[(cellY + y) * AtlasSize + cellX + x] = new Color32(red, green, blue, alpha);
                }
            }
        }
    }
}

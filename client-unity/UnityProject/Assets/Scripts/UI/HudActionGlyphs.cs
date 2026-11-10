using UnityEngine;

namespace Roguehalla.Client
{
    public enum HudActionGlyph { Help, Settings, Leave, Pickup, Fullscreen }

    /// <summary>Cached, code-drawn neutral glyphs for compact HUD actions.</summary>
    public static class HudActionGlyphs
    {
        // Shapes are authored on a 64 unit grid, drawn at 4x and box-filtered down to 128 px, then mip-mapped (crisp at any HUD scale).
        const int Design = 64, Super = 4, Hi = Design * Super, Resolution = 128;
        static readonly Sprite[] Sprites = new Sprite[5];

        public static UnityEngine.UI.Image Icon(Transform parent, string name, HudActionGlyph glyph, float size = 40f)
        {
            if (parent == null) throw new System.ArgumentNullException(nameof(parent));
            int index = (int)glyph;
            if (index < 0 || index >= Sprites.Length) throw new System.ArgumentOutOfRangeException(nameof(glyph));
            var rect = MythicUi.Rect(parent, name, new Vector2(.5f, .5f), new Vector2(.5f, .5f));
            rect.sizeDelta = new Vector2(Mathf.Max(1f, size), Mathf.Max(1f, size));
            var image = rect.gameObject.AddComponent<UnityEngine.UI.Image>();
            image.sprite = SpriteFor(glyph);
            image.color = Tint(glyph);
            image.preserveAspect = true;
            image.raycastTarget = false;
            return image;
        }

        static Sprite SpriteFor(HudActionGlyph glyph)
        {
            int index = (int)glyph;
            if (Sprites[index] != null) return Sprites[index];
            var pixels = new Color32[Hi * Hi];
            switch (glyph)
            {
                case HudActionGlyph.Help:
                    Polyline(pixels, new[] { new Vector2(18, 43), new Vector2(20, 50), new Vector2(27, 54), new Vector2(37, 52), new Vector2(43, 45), new Vector2(42, 38), new Vector2(36, 33), new Vector2(30, 30), new Vector2(30, 23) }, 5);
                    Line(pixels, new Vector2(30, 23), new Vector2(34, 18), 5);
                    Circle(pixels, 30, 10, 3);
                    break;
                case HudActionGlyph.Settings:
                    Gear(pixels);
                    break;
                case HudActionGlyph.Leave:
                    FillRect(pixels, 12, 11, 16, 44);
                    ClearRect(pixels, 17, 15, 9, 36);
                    FillRect(pixels, 17, 15, 4, 36);
                    Line(pixels, new Vector2(25, 32), new Vector2(51, 32), 6);
                    Line(pixels, new Vector2(41, 21), new Vector2(52, 32), 6);
                    Line(pixels, new Vector2(52, 32), new Vector2(41, 43), 6);
                    break;
                case HudActionGlyph.Fullscreen:
                    // Four corner brackets.
                    Polyline(pixels, new[] { new Vector2(10, 24), new Vector2(10, 10), new Vector2(24, 10) }, 5);
                    Polyline(pixels, new[] { new Vector2(40, 10), new Vector2(54, 10), new Vector2(54, 24) }, 5);
                    Polyline(pixels, new[] { new Vector2(54, 40), new Vector2(54, 54), new Vector2(40, 54) }, 5);
                    Polyline(pixels, new[] { new Vector2(24, 54), new Vector2(10, 54), new Vector2(10, 40) }, 5);
                    break;
                case HudActionGlyph.Pickup:
                    FillRect(pixels, 11, 17, 42, 25);
                    ClearRect(pixels, 16, 22, 32, 15);
                    Line(pixels, new Vector2(11, 29), new Vector2(53, 29), 4);
                    Line(pixels, new Vector2(32, 8), new Vector2(32, 25), 5);
                    Line(pixels, new Vector2(22, 17), new Vector2(32, 7), 5);
                    Line(pixels, new Vector2(32, 7), new Vector2(42, 17), 5);
                    break;
            }
            var small = new Color32[Resolution * Resolution]; int ratio = Hi / Resolution;
            for (int y = 0; y < Resolution; y++)
                for (int x = 0; x < Resolution; x++)
                {
                    int sum = 0;
                    for (int dy = 0; dy < ratio; dy++) for (int dx = 0; dx < ratio; dx++) sum += pixels[(y * ratio + dy) * Hi + x * ratio + dx].a;
                    small[y * Resolution + x] = new Color32(255, 255, 255, (byte)(sum / (ratio * ratio)));
                }
            var texture = new Texture2D(Resolution, Resolution, TextureFormat.RGBA32, true)
            {
                name = "Hud action " + glyph,
                filterMode = FilterMode.Trilinear,
                wrapMode = TextureWrapMode.Clamp
            };
            texture.SetPixels32(small);
            texture.Apply(true, true);
            Sprites[index] = Sprite.Create(texture, new Rect(0, 0, Resolution, Resolution), new Vector2(.5f, .5f), Resolution, 0, SpriteMeshType.FullRect);
            Sprites[index].name = "Hud action " + glyph;
            return Sprites[index];
        }

        static Color Tint(HudActionGlyph glyph)
        {
            switch (glyph)
            {
                case HudActionGlyph.Help: return ShowcasePalette.Gold;
                case HudActionGlyph.Settings: return ShowcasePalette.MutedText;
                case HudActionGlyph.Fullscreen: return ShowcasePalette.Text;
                case HudActionGlyph.Leave: return ShowcasePalette.Warning;
                case HudActionGlyph.Pickup: return ShowcasePalette.Success;
                default: return ShowcasePalette.Text;
            }
        }

        static Color32 Ink => new Color32(255, 255, 255, 255);

        static void Gear(Color32[] pixels)
        {
            var points = new Vector2[24];
            for (int i = 0; i < points.Length; i++)
            {
                float angle = Mathf.PI * 2f * i / points.Length - Mathf.PI / 2f;
                float radius = (i % 3 == 0) ? 25f : 20f;
                points[i] = new Vector2(32 + Mathf.Cos(angle) * radius, 32 + Mathf.Sin(angle) * radius);
            }
            FillPolygon(pixels, points);
            ClearCircle(pixels, 32, 32, 8);
        }

        static void Polyline(Color32[] pixels, Vector2[] points, float width)
        {
            for (int i = 1; i < points.Length; i++) Line(pixels, points[i - 1], points[i], width);
        }

        // Every primitive takes design units (64 grid) and scales them to the hi-res buffer.
        static void Line(Color32[] pixels, Vector2 a, Vector2 b, float width)
        {
            a *= Super; b *= Super;
            float radius = width * Super * .5f;
            int minX = Mathf.Max(0, Mathf.FloorToInt(Mathf.Min(a.x, b.x) - radius));
            int maxX = Mathf.Min(Hi - 1, Mathf.CeilToInt(Mathf.Max(a.x, b.x) + radius));
            int minY = Mathf.Max(0, Mathf.FloorToInt(Mathf.Min(a.y, b.y) - radius));
            int maxY = Mathf.Min(Hi - 1, Mathf.CeilToInt(Mathf.Max(a.y, b.y) + radius));
            Vector2 segment = b - a;
            float lengthSq = segment.sqrMagnitude;
            float radiusSq = radius * radius;
            for (int y = minY; y <= maxY; y++) for (int x = minX; x <= maxX; x++)
            {
                Vector2 point = new Vector2(x + .5f, y + .5f);
                float t = lengthSq > 0 ? Mathf.Clamp01(Vector2.Dot(point - a, segment) / lengthSq) : 0;
                if ((point - (a + segment * t)).sqrMagnitude <= radiusSq) Set(pixels, x, y, Ink);
            }
        }

        static void Circle(Color32[] pixels, int cx, int cy, int radius) { Disc(pixels, cx, cy, radius, Ink); }
        static void ClearCircle(Color32[] pixels, int cx, int cy, int radius) { Disc(pixels, cx, cy, radius, new Color32(255, 255, 255, 0)); }

        static void Disc(Color32[] pixels, int cx, int cy, int radius, Color32 value)
        {
            float px = cx * Super, py = cy * Super, r = radius * Super, r2 = r * r;
            for (int y = Mathf.Max(0, Mathf.FloorToInt(py - r)); y <= Mathf.Min(Hi - 1, Mathf.CeilToInt(py + r)); y++)
                for (int x = Mathf.Max(0, Mathf.FloorToInt(px - r)); x <= Mathf.Min(Hi - 1, Mathf.CeilToInt(px + r)); x++)
                    if ((x + .5f - px) * (x + .5f - px) + (y + .5f - py) * (y + .5f - py) <= r2) Set(pixels, x, y, value);
        }

        static void FillRect(Color32[] pixels, int x, int y, int width, int height) { FillArea(pixels, x, y, width, height, Ink); }
        static void ClearRect(Color32[] pixels, int x, int y, int width, int height) { FillArea(pixels, x, y, width, height, new Color32(255, 255, 255, 0)); }

        static void FillArea(Color32[] pixels, int x, int y, int width, int height, Color32 value)
        {
            for (int py = Mathf.Max(0, y * Super); py < Mathf.Min(Hi, (y + height) * Super); py++)
                for (int px = Mathf.Max(0, x * Super); px < Mathf.Min(Hi, (x + width) * Super); px++) Set(pixels, px, py, value);
        }

        static void FillPolygon(Color32[] pixels, Vector2[] design)
        {
            var points = new Vector2[design.Length];
            for (int i = 0; i < points.Length; i++) points[i] = design[i] * Super;
            int minY = Hi - 1, maxY = 0;
            for (int i = 0; i < points.Length; i++) { minY = Mathf.Min(minY, Mathf.FloorToInt(points[i].y)); maxY = Mathf.Max(maxY, Mathf.CeilToInt(points[i].y)); }
            for (int y = Mathf.Max(0, minY); y <= Mathf.Min(Hi - 1, maxY); y++)
                for (int x = 0; x < Hi; x++)
                {
                    bool inside = false;
                    Vector2 p = new Vector2(x + .5f, y + .5f);
                    for (int i = 0, j = points.Length - 1; i < points.Length; j = i++)
                    {
                        Vector2 a = points[i], b = points[j];
                        if ((a.y > p.y) != (b.y > p.y) && p.x < (b.x - a.x) * (p.y - a.y) / (b.y - a.y) + a.x) inside = !inside;
                    }
                    if (inside) Set(pixels, x, y, Ink);
                }
        }

        static void Set(Color32[] pixels, int x, int y, Color32 value)
        {
            if ((uint)x >= Hi || (uint)y >= Hi) return;
            pixels[y * Hi + x] = value;
        }
    }
}

using UnityEngine;

namespace Roguehalla.Client
{
    /// <summary>Cached, untimed faction marks that remain legible without scene lighting.</summary>
    public static class FactionIndicators
    {
        const int TextureSize = 128;
        const float OuterStroke = .045f;
        const float InnerStroke = .06f;
        static readonly Sprite[] Footprints = new Sprite[6];

        /// <summary>Returns one of five distinct outline-only ground marks, cached for the app lifetime.</summary>
        public static Sprite GetFootprint(int faction)
        {
            int index = faction >= 0 && faction < 5 ? faction : 5;
            if (Footprints[index] == null) Footprints[index] = CreateFootprint(index);
            return Footprints[index];
        }

        static Sprite CreateFootprint(int faction)
        {
            string[] names = { "Fire triangle", "Sentenced square", "Plague trefoil", "Frost hexagon", "Holy circle", "Unknown diamond" };
            var points = faction == 0 ? new[] { new Vector2(0, .72f), new Vector2(.72f, -.62f), new Vector2(-.72f, -.62f) }
                : faction == 1 ? new[] { new Vector2(-.68f, -.68f), new Vector2(.68f, -.68f), new Vector2(.68f, .68f), new Vector2(-.68f, .68f) }
                : faction == 3 ? new[] { new Vector2(0, .72f), new Vector2(.62f, .36f), new Vector2(.62f, -.36f), new Vector2(0, -.72f), new Vector2(-.62f, -.36f), new Vector2(-.62f, .36f) }
                : faction == 5 ? new[] { new Vector2(0, .68f), new Vector2(.68f, 0), new Vector2(0, -.68f), new Vector2(-.68f, 0) }
                : null;

            var texture = new Texture2D(TextureSize, TextureSize, TextureFormat.RGBA32, false)
            {
                name = "Faction footprint / " + names[faction],
                filterMode = FilterMode.Bilinear,
                wrapMode = TextureWrapMode.Clamp
            };
            var pixels = new Color32[TextureSize * TextureSize];
            for (int y = 0; y < TextureSize; y++)
            for (int x = 0; x < TextureSize; x++)
            {
                float u = ((x + .5f) / TextureSize) * 2 - 1;
                float v = ((y + .5f) / TextureSize) * 2 - 1;
                float distance = faction == 2 ? TrefoilDistance(u, v) : faction == 4
                    ? Mathf.Abs(new Vector2(u, v).magnitude - .72f)
                    : PolygonDistance(u, v, points);
                byte alpha = (byte)Mathf.RoundToInt(Mathf.Clamp01((OuterStroke - distance) * TextureSize) * 255);
                if (alpha == 0) continue;
                // One light line (the faction colour tints it); the dark and the light companion lines are the adaptive strokes (SpriteOutline), which pick their tone from the ground.
                pixels[y * TextureSize + x] = new Color32(255, 255, 255, alpha);
            }
            texture.SetPixels32(pixels);
            texture.Apply(false, false);
            var sprite = Sprite.Create(texture, new Rect(0, 0, TextureSize, TextureSize), new Vector2(.5f, .5f), TextureSize);
            sprite.name = "Faction footprint / " + names[faction];
            return sprite;
        }

        static float TrefoilDistance(float x, float y)
        {
            float angle = Mathf.Atan2(y, x);
            float radius = .62f + .1f * Mathf.Cos(3 * angle);
            return Mathf.Abs(new Vector2(x, y).magnitude - radius);
        }

        static float PolygonDistance(float x, float y, Vector2[] points)
        {
            float distance = float.MaxValue;
            var point = new Vector2(x, y);
            for (int i = 0; i < points.Length; i++)
            {
                Vector2 start = points[i], delta = points[(i + 1) % points.Length] - start;
                float t = Mathf.Clamp01(Vector2.Dot(point - start, delta) / delta.sqrMagnitude);
                distance = Mathf.Min(distance, Vector2.Distance(point, start + delta * t));
            }
            return distance;
        }
    }
}

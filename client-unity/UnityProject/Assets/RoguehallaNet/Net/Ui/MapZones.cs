using System;

namespace Roguehalla.Net.Ui
{
    /// <summary>Shape of a zone's icon, so zones stay distinguishable without colour (colour-blind safe). They mirror the faction marks.</summary>
    public enum ZoneShape : byte { None, Triangle, Diamond, Disc, Asterisk, Ring, Square }

    /// <summary>The wire region ids of <c>MapBlob.Regions</c> and the way the maps show them. Pure data; colours come from the theme.</summary>
    public static class MapZones
    {
        public const int None = 0, Fire = 1, Sentenced = 2, Plague = 3, Frost = 4, Holy = 5, Coliseum = 6;
        public const int Count = 6;

        static readonly string[] Names = { "", "Fire", "Sentenced", "Plague", "Frost", "Holy", "Coliseum" };
        static readonly ZoneShape[] Shapes = { ZoneShape.None, ZoneShape.Triangle, ZoneShape.Diamond, ZoneShape.Disc, ZoneShape.Asterisk, ZoneShape.Ring, ZoneShape.Square };

        public static bool IsZone(int region) { return region >= Fire && region <= Coliseum; }
        public static string Name(int region) { return IsZone(region) ? Names[region] : ""; }
        public static ZoneShape Shape(int region) { return IsZone(region) ? Shapes[region] : ZoneShape.None; }

        /// <summary>Index into the five theme faction colours (Fire..Holy), or -1 for the coliseum and for no zone.</summary>
        public static int FactionIndex(int region) { return region >= Fire && region <= Holy ? region - 1 : -1; }

        /// <summary>Fill strength of a zone's tint over the neutral map backing (the minimap keeps it lower so markers stay readable).</summary>
        public static float TintAlpha(int region, bool largeMap)
        {
            if (!IsZone(region)) return 0f;
            float a = region == Coliseum ? .22f : region == Sentenced ? .26f : .20f;
            return largeMap ? a : a * .9f;
        }

        /// <summary>
        /// Where to put each zone's icon and label: the region tile nearest the region's centroid (so it never lands in another zone for
        /// a crescent-shaped region), as a tile-grid position. <c>Found[region]</c> is false when the zone has no tiles. Index 0 is unused.
        /// </summary>
        public static void LabelTiles(byte[] regions, int w, int h, out bool[] found, out double[] tileX, out double[] tileY)
        {
            found = new bool[Count + 1]; tileX = new double[Count + 1]; tileY = new double[Count + 1];
            if (regions == null || w <= 0 || h <= 0 || regions.Length != w * h) return;
            var count = new long[Count + 1]; var sx = new double[Count + 1]; var sy = new double[Count + 1];
            for (int y = 0; y < h; y++)
                for (int x = 0; x < w; x++)
                {
                    int r = regions[y * w + x];
                    if (!IsZone(r)) continue;
                    count[r]++; sx[r] += x + .5; sy[r] += y + .5;
                }
            var best = new double[Count + 1];
            for (int r = Fire; r <= Count; r++) { best[r] = double.MaxValue; if (count[r] > 0) { sx[r] /= count[r]; sy[r] /= count[r]; } }
            for (int y = 0; y < h; y++)
                for (int x = 0; x < w; x++)
                {
                    int r = regions[y * w + x];
                    if (!IsZone(r)) continue;
                    double dx = x + .5 - sx[r], dy = y + .5 - sy[r], d = dx * dx + dy * dy;
                    if (d < best[r]) { best[r] = d; tileX[r] = x + .5; tileY[r] = y + .5; found[r] = true; }
                }
        }
    }

    /// <summary>
    /// Smooth wall/low-obstacle outlines from the one-sample-per-tile grid: a bilinear coverage field sampled at tile centres, so a
    /// 0.5 contour hugs the tiles with rounded corners (the same idea as a signed-distance wall stroke) instead of blocky texels.
    /// </summary>
    public static class MapSmoothing
    {
        /// <summary>Bilinear value of a per-tile 0/1 mask at tile-space position (tx, ty) (tile centres are at .5), clamped at the border.</summary>
        public static float Coverage(Func<int, int, float> tile, int w, int h, double tx, double ty)
        {
            double fx = tx - .5, fy = ty - .5;
            int x0 = (int)Math.Floor(fx), y0 = (int)Math.Floor(fy);
            float ax = (float)(fx - x0), ay = (float)(fy - y0);
            float a = tile(Cl(x0, w), Cl(y0, h)), b = tile(Cl(x0 + 1, w), Cl(y0, h));
            float c = tile(Cl(x0, w), Cl(y0 + 1, h)), d = tile(Cl(x0 + 1, w), Cl(y0 + 1, h));
            return (a + (b - a) * ax) * (1f - ay) + (c + (d - c) * ax) * ay;
        }

        /// <summary>Anti-aliased inside test of a coverage value against the contour: 0 outside, 1 inside, soft over +-<paramref name="edge"/>.</summary>
        public static float Inside(float coverage, float edge, float contour = .5f)
        {
            float t = (coverage - (contour - edge)) / (2f * edge);
            t = t < 0f ? 0f : t > 1f ? 1f : t;
            return t * t * (3f - 2f * t);
        }

        /// <summary>A stroke centred on the contour: 1 on the contour, fading to 0 by <paramref name="halfWidth"/> either side.</summary>
        public static float Stroke(float coverage, float halfWidth, float edge, float contour = .5f)
        {
            float d = Math.Abs(coverage - contour);
            float t = (halfWidth + edge - d) / (2f * edge);
            t = t < 0f ? 0f : t > 1f ? 1f : t;
            return t * t * (3f - 2f * t);
        }

        static int Cl(int v, int n) { return v < 0 ? 0 : v >= n ? n - 1 : v; }
    }
}

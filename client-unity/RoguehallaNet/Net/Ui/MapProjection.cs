using System;

namespace Roguehalla.Net.Ui
{
    /// <summary>
    /// Pure minimap/Tab-map maths: a point on the drawn map rectangle to a server world point, and back. The map shows the whole
    /// level stretched to a rectangle (tile grid W x H, 32 world units per tile, +y down the screen as in snapshots), so this is the
    /// same linear mapping the legacy minimap uses (<c>world = pixel / size * mapSize</c>). Presentation only: no walkability or
    /// pathing decision is made here, the click becomes an ordinary move order and the server resolves it.
    /// </summary>
    public static class MapProjection
    {
        public const double TileUnits = 32d;

        /// <summary>
        /// Converts a pixel inside the map rectangle (origin at its top-left, y down, any consistent unit) to a world point, clamped
        /// to the map. Returns false for an empty rectangle, an empty map or a non-finite input.
        /// </summary>
        public static bool PixelToWorld(double px, double py, double rectWidth, double rectHeight, int mapTilesW, int mapTilesH, out RoutePoint world)
        {
            world = default(RoutePoint);
            if (!Finite(px) || !Finite(py) || !Finite(rectWidth) || !Finite(rectHeight)) return false;
            if (rectWidth <= 0d || rectHeight <= 0d || mapTilesW <= 0 || mapTilesH <= 0) return false;
            double u = Clamp01(px / rectWidth), v = Clamp01(py / rectHeight);
            world = new RoutePoint(u * mapTilesW * TileUnits, v * mapTilesH * TileUnits);
            return true;
        }

        /// <summary>Inverse of <see cref="PixelToWorld"/> (not clamped): the pixel in the map rectangle that shows a world point.</summary>
        public static bool WorldToPixel(double wx, double wy, double rectWidth, double rectHeight, int mapTilesW, int mapTilesH, out double px, out double py)
        {
            px = py = 0d;
            if (!Finite(wx) || !Finite(wy) || !Finite(rectWidth) || !Finite(rectHeight)) return false;
            if (rectWidth <= 0d || rectHeight <= 0d || mapTilesW <= 0 || mapTilesH <= 0) return false;
            px = wx / (mapTilesW * TileUnits) * rectWidth;
            py = wy / (mapTilesH * TileUnits) * rectHeight;
            return true;
        }

        static double Clamp01(double v) { return v < 0d ? 0d : v > 1d ? 1d : v; }
        static bool Finite(double v) { return !double.IsNaN(v) && !double.IsInfinity(v); }
    }

    /// <summary>
    /// The short-lived "walking here" ping marker. Pure timing so it is testable: it lives <see cref="LifetimeMs"/>, expanding
    /// from <see cref="StartScale"/> to full size while it fades out.
    /// </summary>
    public struct MapPing
    {
        public const double LifetimeMs = 900d;
        public const double StartScale = .35d;

        public double WorldX, WorldY;
        public double StartedMs;
        public bool Active;

        public void Start(double worldX, double worldY, double nowMs)
        {
            WorldX = worldX; WorldY = worldY; StartedMs = nowMs; Active = true;
        }

        /// <summary>0 at the start to 1 at the end, or -1 when no ping is showing.</summary>
        public double Progress(double nowMs)
        {
            if (!Active) return -1d;
            double age = nowMs - StartedMs;
            if (age < 0d) age = 0d;
            return age >= LifetimeMs ? -1d : age / LifetimeMs;
        }

        public double Scale(double progress) { return StartScale + (1d - StartScale) * Ease(progress); }
        public double Alpha(double progress) { double f = 1d - progress; return f * f; }
        static double Ease(double t) { double f = 1d - t; return 1d - f * f * f; }
    }
}

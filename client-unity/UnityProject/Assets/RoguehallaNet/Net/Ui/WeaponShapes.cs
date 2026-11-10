using System;
using System.Collections.Generic;

namespace Roguehalla.Net.Ui
{
    /// <summary>
    /// One row of the weapon shape table (reach and arc of a melee weapon). The client keeps no copy of these numbers: the provider
    /// <see cref="WeaponShapes"/> is EMPTY until the coordinator connects the protocol Welcome's weapon table via
    /// <see cref="WeaponShapes.Set"/>. Kind: 0 none, 1 melee arc, 2 projectile. Reach in sim units, HalfArc in radians.
    /// </summary>
    public struct WeaponShape
    {
        public byte Weapon;
        public byte Kind;
        public float Reach;
        public float HalfArc;
    }

    /// <summary>The weapon shape provider. Empty by default: with no row for a weapon no hit zone is drawn (values are never guessed).</summary>
    public static class WeaponShapes
    {
        static readonly Dictionary<byte, WeaponShape> Rows = new Dictionary<byte, WeaponShape>();

        public static int Count { get { return Rows.Count; } }

        /// <summary>Replaces the whole table. Rows that are not usable (unknown kind, non-finite or non-positive numbers) are skipped.</summary>
        public static void Set(IReadOnlyList<WeaponShape> rows)
        {
            Rows.Clear();
            if (rows == null) return;
            for (int i = 0; i < rows.Count; i++)
            {
                var r = rows[i];
                if (r.Kind > 2) continue;
                if (r.Kind == 1 && !(IsFinite(r.Reach) && r.Reach > 0f && IsFinite(r.HalfArc) && r.HalfArc > 0f && r.HalfArc <= (float)Math.PI)) continue;
                Rows[r.Weapon] = r;
            }
        }

        public static void Clear() { Rows.Clear(); }

        /// <summary>True only for a melee arc row (kind 1). Everything else (no row, projectile, none) draws no hit zone.</summary>
        public static bool TryGet(byte weapon, out WeaponShape shape)
        {
            if (Rows.TryGetValue(weapon, out shape) && shape.Kind == 1) return true;
            shape = default(WeaponShape);
            return false;
        }

        static bool IsFinite(float v) { return !float.IsNaN(v) && !float.IsInfinity(v); }
    }

    /// <summary>
    /// Pure maths for the melee hit-zone indicator: the sector the swing can hit and how a brighter band sweeps through it. Legacy timing:
    /// the swing graphic lasts 180 ms (<c>SWING_MS</c>, FxView.ts:29); here the sector then fades over <see cref="FadeMs"/>.
    /// </summary>
    public static class HitZoneModel
    {
        public const float SweepMs = 180f, FadeMs = 140f;
        public const float BaseAlpha = .11f, BandAlpha = .20f, EdgeAlpha = .60f;
        /// <summary>The bright band covers this share of the arc.</summary>
        public const float BandShare = .28f;
        /// <summary>Most hit zones alive at once; extra swings are dropped.</summary>
        public const int MaxZones = 16;

        public static float Life { get { return SweepMs + FadeMs; } }

        /// <summary>The origin raised by the attacker's chest height in archetype mode (hull box), the feet otherwise. Sim +y is south, raised is -y.</summary>
        public static void Origin(float x, float y, byte hull, byte chest, out float ox, out float oy)
        {
            ox = x; oy = hull == 1 ? y - chest : y;
        }

        /// <summary>The point of the arc at fraction <paramref name="k"/> (0..1 across the arc) at radius <paramref name="radius"/>, aim <paramref name="angle"/> (sim radians).</summary>
        public static void ArcPoint(float ox, float oy, float radius, float halfArc, float angle, float k, out float px, out float py)
        {
            float a = angle - halfArc + 2f * halfArc * k;
            px = ox + (float)Math.Cos(a) * radius; py = oy + (float)Math.Sin(a) * radius;
        }

        /// <summary>True when point (px,py) is inside the sector (what the swing can hit, measured from the origin).</summary>
        public static bool Inside(float ox, float oy, float reach, float halfArc, float angle, float px, float py)
        {
            float dx = px - ox, dy = py - oy;
            if (dx * dx + dy * dy > reach * reach * 1.00001f) return false;
            float d = (float)Math.Atan2(dy, dx) - angle;
            while (d > (float)Math.PI) d -= 2f * (float)Math.PI;
            while (d < -(float)Math.PI) d += 2f * (float)Math.PI;
            return Math.Abs(d) <= halfArc + 1e-5f;
        }

        /// <summary>Opacity multiplier of the whole zone at age <paramref name="ageMs"/>: 1 through the sweep, linearly to 0 over the fade; 0 once over.</summary>
        public static float Fade(float ageMs)
        {
            if (ageMs < 0f) return 1f;
            if (ageMs <= SweepMs) return 1f;
            float t = (ageMs - SweepMs) / FadeMs;
            return t >= 1f ? 0f : 1f - t;
        }

        public static bool Alive(float ageMs) { return ageMs < Life; }

        /// <summary>
        /// Where the bright band is across the arc (0 = one edge, 1 = the other, band centre) at <paramref name="ageMs"/>. The band enters at
        /// the first edge and leaves at the other; -1 when there is no sweep (reduced motion, before or after the sweep).
        /// </summary>
        public static float BandCentre(float ageMs, bool reducedMotion)
        {
            if (reducedMotion || ageMs < 0f || ageMs > SweepMs) return -1f;
            float t = ageMs / SweepMs;
            // Ease-out so the weapon seems to whip through and settle.
            float e = 1f - (1f - t) * (1f - t);
            float half = BandShare * .5f;
            return -half + e * (1f + 2f * half);
        }

        /// <summary>Weight (0..1) of the band at arc fraction <paramref name="k"/> for a band centred at <paramref name="centre"/>; triangular, 0 outside.</summary>
        public static float BandWeight(float k, float centre)
        {
            if (centre < -.5f) return 0f;
            float half = BandShare * .5f, d = Math.Abs(k - centre);
            return d >= half ? 0f : 1f - d / half;
        }

        /// <summary>Parses the page query: <c>fx.hitzone=0|1</c> (default on) and <c>hitzone.demo=1</c> (default off, test data only).</summary>
        public static void ParseFlags(string search, out bool enabled, out bool demo)
        {
            enabled = true; demo = false;
            if (string.IsNullOrEmpty(search)) return;
            int q = search.IndexOf('?');
            string query = q >= 0 ? search.Substring(q + 1) : search;
            int hash = query.IndexOf('#'); if (hash >= 0) query = query.Substring(0, hash);
            foreach (var pair in query.Split('&'))
            {
                int eq = pair.IndexOf('='); if (eq <= 0) continue;
                string key = pair.Substring(0, eq).ToLowerInvariant(), value = pair.Substring(eq + 1);
                if (key == "fx.hitzone") enabled = !(value == "0" || value == "false" || value == "off");
                else if (key == "hitzone.demo") demo = value == "1";
            }
        }
    }
}

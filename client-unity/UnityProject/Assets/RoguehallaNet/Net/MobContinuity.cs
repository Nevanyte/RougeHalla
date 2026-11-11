using System;

namespace Roguehalla.Net
{
    /// <summary>
    /// What a creature looks like, as far as the wire tells: kind, mob type, faction and archetype key. Two observations with the same look
    /// can be the same creature under a renewed observer handle.
    /// </summary>
    public readonly struct MobLook : IEquatable<MobLook>
    {
        public readonly byte Kind;
        public readonly int Mob, Faction;
        public readonly string Archetype;

        public MobLook(byte kind, int mob, int faction, string archetype) { Kind = kind; Mob = mob; Faction = faction; Archetype = archetype ?? ""; }
        public bool Equals(MobLook o) { return Kind == o.Kind && Mob == o.Mob && Faction == o.Faction && string.Equals(Archetype ?? "", o.Archetype ?? "", StringComparison.Ordinal); }
        public override bool Equals(object obj) { return obj is MobLook o && Equals(o); }
        public override int GetHashCode() { unchecked { return ((Kind * 31 + Mob) * 31 + Faction) * 31 + (Archetype ?? "").GetHashCode(); } }
    }

    /// <summary>A creature whose observer handle just disappeared: where it was last drawn, when, and what it looked like.</summary>
    public struct MobCandidate
    {
        public int Handle;
        public MobLook Look;
        public float X, Y, SeenAt;
        /// <summary>The body lay dead when last delivered; <see cref="DiedAt"/> is when its death clip started (presenter clock).</summary>
        public bool Dead;
        public float DiedAt;
        /// <summary>Set by <see cref="MobContinuity.Adopt"/> once a successor took the body over; a claimed candidate is not offered again.</summary>
        public bool Claimed;
    }

    /// <summary>
    /// The presentation twin of <see cref="FootTracker"/>'s renewal rule. The server renews creature handles almost every observation, so a
    /// departure cannot be told from a renewal by id. An observation of a creature whose id has no art continues the nearest departed
    /// creature of the same look that was last seen within <see cref="RenewRadius"/> (2 tiles) and under <see cref="StaleSeconds"/> ago;
    /// if there is none it is a real arrival. A departed creature nobody continues is a real departure. Pure, allocation-free, no engine.
    /// Dead creatures are never parked by the caller (they keep their death presentation), and a candidate is claimed once.
    /// </summary>
    public static class MobContinuity
    {
        public const float TileUnits = 32f;
        public const float RenewRadius = 2f * TileUnits;
        public const float StaleSeconds = 0.6f;

        /// <summary>Index of the candidate the observation continues, or -1.</summary>
        public static int Pick(MobCandidate[] pool, int count, in MobLook look, float x, float y, float now)
        {
            int best = -1; float bestD = RenewRadius * RenewRadius;
            if (pool == null) return -1;
            for (int i = 0; i < count && i < pool.Length; i++)
            {
                if (now - pool[i].SeenAt > StaleSeconds || now < pool[i].SeenAt - 1e-3f) continue;
                if (!pool[i].Look.Equals(look)) continue;
                float dx = pool[i].X - x, dy = pool[i].Y - y, d2 = dx * dx + dy * dy;
                if (d2 <= bestD) { bestD = d2; best = i; }
            }
            return best;
        }

        /// <summary>
        /// Pick plus ownership, for living creatures and dead bodies alike (P-UNITY-MOB-DEATH-1). Returns the index of the candidate the
        /// sighting continues (and sets its <see cref="MobCandidate.Claimed"/>), or -1. A dead sighting may continue a living or a dead
        /// candidate; a living sighting never continues a dead one. <paramref name="diedAt"/> is the death start the art must keep: the
        /// candidate's own when it was already dead, otherwise <paramref name="now"/> (also when nothing is adopted).
        /// </summary>
        public static int Adopt(MobCandidate[] pool, int count, in MobLook look, bool dead, float x, float y, float now, out float diedAt)
        {
            // STUB: today's behaviour (no dead bodies are parked, nothing is claimed). The implementer replaces this.
            diedAt = now;
            return Pick(pool, count, look, x, y, now);
        }

        /// <summary>Counts creature art bindings for diagnostics: a create is a binding to fresh art, a continue reuses departed art.</summary>
        public sealed class Counters
        {
            public int Created, Destroyed, Continued;
            public void Reset() { Created = Destroyed = Continued = 0; }
        }
    }
}

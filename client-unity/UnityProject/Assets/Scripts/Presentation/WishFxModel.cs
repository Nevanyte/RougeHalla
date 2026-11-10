using System;
using System.Collections.Generic;
using Roguehalla.Net;

// Pure C# (no UnityEngine): also compiled by RoguehallaNet.Tests. Everything here maps delivered server facts to
// presentation parameters. There is no rule in this file: no area is sized, timed or targeted from a constant; the radius,
// the endpoints and the end time of every area are copied from the delivered row, and an effect's age is measured from the
// server's own event time.
namespace Roguehalla.Client
{
    /// <summary>Public EFFECT_* bits a snapshot publishes for every observed actor (mirrors rh-sim status rules).</summary>
    public static class WishEffectBits
    {
        public const ushort Stunned = 1, Dot = 64, Hidden = 256, Zoned = 512, LastStand = 1024, Haste = 2048, Casting = 4096;
    }

    /// <summary>Server units of one delivered area plus its clock. Positions and sizes are copies of the wire row.</summary>
    public readonly struct WishAreaFacts
    {
        public readonly AreaKind Kind;
        public readonly AbilityId Ability;
        public readonly uint Owner, Subject;
        public readonly float X, Y, X2, Y2, Radius;
        public readonly double StartedAt, EndsAt;

        public WishAreaFacts(in AreaView f)
        {
            Kind = f.Kind; Ability = f.Ability; Owner = f.Owner ?? 0; Subject = f.Subject ?? 0;
            X = f.X; Y = f.Y; X2 = f.X2; Y2 = f.Y2; Radius = f.Radius; StartedAt = f.StartedAt; EndsAt = f.EndsAt;
        }

        /// <summary>Circle radius (zone, cloud) in server units; 0 for a trail.</summary>
        public float CircleRadius { get { return Kind == AreaKind.Trail ? 0f : Radius; } }
        /// <summary>A trail's half-width in server units (the row's radius); 0 otherwise.</summary>
        public float TrailHalfWidth { get { return Kind == AreaKind.Trail ? Radius : 0f; } }
        public float TrailLength
        {
            get { float dx = X2 - X, dy = Y2 - Y; return Kind == AreaKind.Trail ? (float)Math.Sqrt(dx * dx + dy * dy) : 0f; }
        }
        /// <summary>Elapsed share of the delivered lifetime, 0..1 (1 when the row has no duration).</summary>
        public float Elapsed(double nowMs) { return WishFxModel.Phase(nowMs, StartedAt, EndsAt - StartedAt); }
        public float Remaining(double nowMs) { return 1f - Elapsed(nowMs); }
    }

    /// <summary>An area that stopped being delivered, kept briefly so its end can be drawn at the last delivered extent.</summary>
    public struct WishAreaEnded
    {
        public WishAreaFacts Facts;
        /// <summary>Source time the row was last delivered.</summary>
        public double LastSeenMs;
        /// <summary>The row disappeared at or after its delivered end time (expiry) rather than early (the subject left, a caster fell).</summary>
        public bool Natural;
    }

    /// <summary>
    /// Follows delivered area rows across frames by their wire identity (kind, ability, start, position) and reports rows that
    /// stopped arriving. Pure bookkeeping: a row that is delivered is drawn, a row that is not is gone.
    /// </summary>
    public sealed class WishAreaTracker
    {
        public const int Capacity = 32;
        struct Entry { public WishAreaFacts Facts; public double LastSeen; public int Stamp; public bool Used; }
        readonly Entry[] _entries = new Entry[Capacity];
        int _stamp;

        public int LiveCount { get { int n = 0; for (int i = 0; i < _entries.Length; i++) if (_entries[i].Used) n++; return n; } }

        public void BeginFrame() { _stamp++; }

        /// <summary>Records a delivered row. Returns true on the first frame it is seen. Rows beyond the capacity are not tracked.</summary>
        public bool Observe(in WishAreaFacts facts, double nowMs)
        {
            int free = -1;
            for (int i = 0; i < _entries.Length; i++)
            {
                if (!_entries[i].Used) { if (free < 0) free = i; continue; }
                if (Same(_entries[i].Facts, facts))
                {
                    _entries[i].Facts = facts; _entries[i].LastSeen = nowMs; _entries[i].Stamp = _stamp;
                    return false;
                }
            }
            if (free < 0) return false;
            _entries[free] = new Entry { Facts = facts, LastSeen = nowMs, Stamp = _stamp, Used = true };
            return true;
        }

        /// <summary>Appends every tracked row that was not observed this frame to <paramref name="ended"/> and forgets it.</summary>
        public void EndFrame(List<WishAreaEnded> ended)
        {
            for (int i = 0; i < _entries.Length; i++)
            {
                if (!_entries[i].Used || _entries[i].Stamp == _stamp) continue;
                var e = _entries[i];
                if (ended != null)
                    ended.Add(new WishAreaEnded { Facts = e.Facts, LastSeenMs = e.LastSeen, Natural = e.LastSeen >= e.Facts.EndsAt - 120d });
                _entries[i].Used = false;
            }
        }

        public void Clear() { for (int i = 0; i < _entries.Length; i++) _entries[i].Used = false; }

        static bool Same(in WishAreaFacts a, in WishAreaFacts b)
        {
            return a.Kind == b.Kind && a.Ability == b.Ability && a.StartedAt == b.StartedAt && a.X == b.X && a.Y == b.Y;
        }
    }

    /// <summary>Which status bits of a stably identified (player) actor switched on or off since its previous observation.</summary>
    public readonly struct WishStatusEdge
    {
        public readonly uint Id;
        public readonly ushort Started, Ended;
        public WishStatusEdge(uint id, ushort started, ushort ended) { Id = id; Started = started; Ended = ended; }
    }

    /// <summary>
    /// Per-actor status edges. Only players keep their id between snapshots: observer handles of NPCs renew on every
    /// observation, so callers must not note NPCs here (an NPC would "start" its status on every snapshot).
    /// An actor whose first observation already carries bits reports them as already running (no Started edge).
    /// </summary>
    public sealed class WishStatusTracker
    {
        public const int Capacity = 64;
        struct Entry { public uint Id; public ushort Effects; public int Stamp; public bool Used; }
        readonly Entry[] _entries = new Entry[Capacity];
        int _stamp;

        public void BeginFrame() { _stamp++; }

        /// <summary>Notes the actor. A departed or dead actor produces no end edge (nothing is drawn for what left observation).</summary>
        public bool Note(uint id, ushort effects, bool alive, out WishStatusEdge edge)
        {
            edge = default(WishStatusEdge);
            if (id == 0) return false;
            int free = -1;
            for (int i = 0; i < _entries.Length; i++)
            {
                if (!_entries[i].Used) { if (free < 0) free = i; continue; }
                if (_entries[i].Id != id) continue;
                ushort old = _entries[i].Effects;
                _entries[i].Effects = alive ? effects : (ushort)0; _entries[i].Stamp = _stamp;
                if (!alive) return false;
                ushort started = (ushort)(effects & ~old), ended = (ushort)(old & ~effects);
                if (started == 0 && ended == 0) return false;
                edge = new WishStatusEdge(id, started, ended);
                return true;
            }
            if (free >= 0) _entries[free] = new Entry { Id = id, Effects = alive ? effects : (ushort)0, Stamp = _stamp, Used = true };
            return false;
        }

        /// <summary>Forgets every actor not noted this frame.</summary>
        public void EndFrame() { for (int i = 0; i < _entries.Length; i++) if (_entries[i].Used && _entries[i].Stamp != _stamp) _entries[i].Used = false; }
        public void Clear() { for (int i = 0; i < _entries.Length; i++) _entries[i].Used = false; }
    }

    public static class WishFxModel
    {
        /// <summary>Faction palette index of the faction that owns the Wish (Fire 0, Sentenced 1, Plague 2, Frost 3, Holy 4).</summary>
        public static int FactionIndex(AbilityId ability)
        {
            switch (ability)
            {
                case AbilityId.Freeze: return 3;
                case AbilityId.Swarm: return 2;
                case AbilityId.Trial: return 1;
                case AbilityId.Blaze: return 0;
                default: return 4;
            }
        }

        /// <summary>Elapsed share (0..1) of a window that starts at <paramref name="startMs"/>; a non-positive duration is complete.</summary>
        public static float Phase(double nowMs, double startMs, double durationMs)
        {
            if (!(durationMs > 0d)) return 1f;
            double t = (nowMs - startMs) / durationMs;
            return t <= 0d ? 0f : t >= 1d ? 1f : (float)t;
        }

        public static float EaseOut(float t) { t = t < 0f ? 0f : t > 1f ? 1f : t; float u = 1f - t; return 1f - u * u * u; }
        public static float EaseIn(float t) { t = t < 0f ? 0f : t > 1f ? 1f : t; return t * t; }

        /// <summary>Soft 0..1 pulse; a steady 1 when motion is reduced.</summary>
        public static float Pulse(double seconds, float periodSeconds, bool reducedMotion)
        {
            if (reducedMotion || !(periodSeconds > 0f)) return 1f;
            return .5f + .5f * (float)Math.Sin(seconds * 2d * Math.PI / periodSeconds);
        }

        /// <summary>
        /// How many decorative particles/sprites an effect may use: <paramref name="baseCount"/> scaled by the quality multiplier
        /// (Quality.Particles), nothing when motion is reduced or the multiplier is 0, never above <paramref name="cap"/>.
        /// </summary>
        public static int Budget(int baseCount, float qualityParticles, bool reducedMotion, int cap)
        {
            if (reducedMotion || !(qualityParticles > 0f) || baseCount <= 0) return 0;
            int n = (int)Math.Ceiling(baseCount * Math.Min(qualityParticles, 1.5f));
            return Math.Max(0, Math.Min(cap, n));
        }

        /// <summary>Deterministic 0..1 hash so a particle's path is a pure function of (seed, age): no per-frame random calls.</summary>
        public static float Hash01(uint seed)
        {
            unchecked
            {
                uint h = seed * 2654435761u; h ^= h >> 15; h *= 2246822519u; h ^= h >> 13; h *= 3266489917u; h ^= h >> 16;
                return (h & 0xffff) / 65535f;
            }
        }

        /// <summary>A Wish's world-space presentation of its lifetime (the cast window that precedes its landing).</summary>
        public static bool IsAnimationClipAbility(AbilityId a) { return a == AbilityId.Freeze || a == AbilityId.Swarm || a == AbilityId.Trial; }
    }

    /// <summary>
    /// HUD Wish tile motion state: a flash when a cast is accepted (the owner publication shows a cast, or the next-ready
    /// time jumps forward, or stock drops) and a pulse when the Wish becomes available again. Driven only by the owner's
    /// delivered Wish record; it triggers nothing on the first observation or when the ability changes.
    /// </summary>
    public sealed class WishTileMotion
    {
        public const float FlashSeconds = .55f, ReadyPulseSeconds = 1.1f;
        bool _hasPrevious, _previousReady;
        AbilityId _ability;
        double _previousReadyAt;
        byte _previousCharges;
        bool _previousCast;
        float _flashStart = float.NegativeInfinity, _pulseStart = float.NegativeInfinity;

        /// <summary>Feeds one frame. <paramref name="realSeconds"/> is any monotonic clock used only to age the animations.</summary>
        public void Observe(WishView? wish, double serverMs, float realSeconds)
        {
            if (!wish.HasValue) { _hasPrevious = false; _flashStart = _pulseStart = float.NegativeInfinity; return; }
            var w = wish.Value;
            bool ready = w.Charges > 0 && serverMs >= w.ReadyAt;
            bool cast = w.Cast.HasValue;
            if (_hasPrevious && _ability == w.Ability)
            {
                bool accepted = (cast && !_previousCast) || w.Charges < _previousCharges || w.ReadyAt > _previousReadyAt + 500d;
                if (accepted) _flashStart = realSeconds;
                if (ready && !_previousReady) _pulseStart = realSeconds;
            }
            _ability = w.Ability; _previousReady = ready; _previousReadyAt = w.ReadyAt; _previousCharges = w.Charges; _previousCast = cast;
            _hasPrevious = true;
        }

        /// <summary>1 at the moment of acceptance, falling to 0.</summary>
        public float Flash(float realSeconds)
        {
            float a = (realSeconds - _flashStart) / FlashSeconds;
            return a < 0f || a >= 1f ? 0f : (1f - a) * (1f - a);
        }

        /// <summary>0..1 sine bump over the ready pulse window.</summary>
        public float ReadyPulse(float realSeconds)
        {
            float a = (realSeconds - _pulseStart) / ReadyPulseSeconds;
            return a < 0f || a >= 1f ? 0f : (float)Math.Sin(a * Math.PI);
        }

        public void Reset() { _hasPrevious = false; _flashStart = _pulseStart = float.NegativeInfinity; }
    }
}

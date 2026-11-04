using System;
using System.Collections.Generic;
using Roguehalla.Net.Protocol;

namespace Roguehalla.Net
{
    public struct InterpActor
    {
        public uint Id;
        public byte Faction, HpPct, Status, Weapon;
        public float X, Y, Facing;
        public ushort Bounty;
    }

    /// <summary>
    /// Recent server snapshots, sampled at a render time in server milliseconds. Remote actors are drawn in the past so there are
    /// always two snapshots to blend; when starved the newest is held (no extrapolation at this stage).
    /// </summary>
    public sealed class SnapshotBuffer
    {
        /// <summary>A jump longer than this between two snapshots is a teleport or a respawn: show it, do not slide through walls.</summary>
        public const float TeleportDistance = 256f;
        const int Capacity = 40;

        readonly List<ServerMsg.Snapshot> _snaps = new List<ServerMsg.Snapshot>();
        readonly Dictionary<uint, WireActor> _prev = new Dictionary<uint, WireActor>();

        public int Count { get { return _snaps.Count; } }
        public ServerMsg.Snapshot Newest { get { return _snaps.Count == 0 ? null : _snaps[_snaps.Count - 1]; } }
        public double NewestMs { get { return _snaps.Count == 0 ? double.NaN : _snaps[_snaps.Count - 1].ServerMs; } }
        public double OldestMs { get { return _snaps.Count == 0 ? double.NaN : _snaps[0].ServerMs; } }

        public void Clear() { _snaps.Clear(); }

        /// <summary>Adds a snapshot; one that is not newer than the newest (duplicate or reordered) is ignored.</summary>
        public bool Add(ServerMsg.Snapshot s)
        {
            if (_snaps.Count > 0 && s.ServerMs <= NewestMs) return false;
            _snaps.Add(s);
            if (_snaps.Count > Capacity) _snaps.RemoveAt(0);
            return true;
        }

        /// <summary>Fills <paramref name="outActors"/> with the actors as they were at <paramref name="renderMs"/>. False when empty.</summary>
        public bool Sample(double renderMs, List<InterpActor> outActors)
        {
            outActors.Clear();
            int n = _snaps.Count;
            if (n == 0) return false;
            if (renderMs >= _snaps[n - 1].ServerMs || n == 1) { Emit(_snaps[n - 1], null, 1f, outActors); return true; }
            if (renderMs <= _snaps[0].ServerMs) { Emit(_snaps[0], null, 1f, outActors); return true; }
            int i = n - 2;
            while (i > 0 && _snaps[i].ServerMs > renderMs) i--;
            var a = _snaps[i];
            var b = _snaps[i + 1];
            double span = b.ServerMs - a.ServerMs;
            float t = span <= 0 ? 1f : (float)((renderMs - a.ServerMs) / span);
            Emit(b, a, t, outActors);
            return true;
        }

        void Emit(ServerMsg.Snapshot b, ServerMsg.Snapshot a, float t, List<InterpActor> outActors)
        {
            _prev.Clear();
            if (a != null) foreach (var p in a.Actors) _prev[p.Id] = p;
            foreach (var cur in b.Actors)
            {
                var o = new InterpActor { Id = cur.Id, Faction = cur.Faction, HpPct = cur.HpPct, Status = cur.Status, Weapon = cur.Weapon, Bounty = cur.Bounty, X = cur.X, Y = cur.Y, Facing = cur.Facing };
                WireActor p;
                if (a != null && _prev.TryGetValue(cur.Id, out p))
                {
                    float dx = cur.X - p.X, dy = cur.Y - p.Y;
                    if (dx * dx + dy * dy <= TeleportDistance * TeleportDistance)
                    {
                        o.X = p.X + dx * t;
                        o.Y = p.Y + dy * t;
                        o.Facing = LerpAngle(p.Facing, cur.Facing, t);
                    }
                }
                outActors.Add(o);
            }
        }

        public static float LerpAngle(float from, float to, float t)
        {
            const float TwoPi = (float)(Math.PI * 2);
            float d = (to - from) % TwoPi;
            if (d > (float)Math.PI) d -= TwoPi;
            else if (d < -(float)Math.PI) d += TwoPi;
            return from + d * t;
        }
    }
}

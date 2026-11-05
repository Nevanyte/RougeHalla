using System;
using System.Collections.Generic;
using Roguehalla.Net.Protocol;

namespace Roguehalla.Net
{
    /// <summary>A remote actor as drawn at a render time: owned by the caller's list, typed codes.</summary>
    public struct InterpActor
    {
        public uint Id;
        public FactionId Faction;
        public ActorStatus Status;
        public WeaponId Weapon;
        public byte HpPct;
        public float X, Y, Facing;
        public ushort Bounty;
    }

    /// <summary>
    /// Recent server snapshots, sampled at a render time in server milliseconds. Remote actors are drawn in the past so there are
    /// always two snapshots to blend; when starved the newest is held (no extrapolation at this stage).
    /// Sampling makes no garbage: actors are matched across the two snapshots by a merge over their id-sorted arrays (C-OBS lists
    /// them by id). The snapshot that falls out of the buffer is kept as a spare that the next decode can overwrite
    /// (<see cref="TakeSpare"/>, <c>ServerMsg.Decode(frame, length, reuse)</c>), so a steady stream makes no garbage either.
    /// </summary>
    public sealed class SnapshotBuffer
    {
        /// <summary>A jump longer than this between two snapshots is a teleport or a respawn: show it, do not slide through walls.</summary>
        public const float TeleportDistance = 256f;
        const int Capacity = 40;

        readonly List<ServerMsg.Snapshot> _snaps = new List<ServerMsg.Snapshot>(Capacity + 1);
        ServerMsg.Snapshot _spare;

        public int Count { get { return _snaps.Count; } }
        public ServerMsg.Snapshot Newest { get { return _snaps.Count == 0 ? null : _snaps[_snaps.Count - 1]; } }
        public double NewestMs { get { return _snaps.Count == 0 ? double.NaN : _snaps[_snaps.Count - 1].ServerMs; } }
        public double OldestMs { get { return _snaps.Count == 0 ? double.NaN : _snaps[0].ServerMs; } }

        public void Clear() { _snaps.Clear(); }

        /// <summary>Adds a snapshot; one that is not newer than the newest (duplicate or reordered) is ignored.</summary>
        public bool Add(ServerMsg.Snapshot s)
        {
            return Add(s, false);
        }

        internal bool Add(ServerMsg.Snapshot s, bool replaceCurrentTick)
        {
            if (replaceCurrentTick && Newest != null && Newest.Tick == s.Tick)
            {
                _snaps[_snaps.Count - 1] = s;
                return true;
            }
            if (_snaps.Count > 0 && s.ServerMs <= NewestMs) return false;
            _snaps.Add(s);
            if (_snaps.Count > Capacity)
            {
                _spare = _snaps[0];
                _snaps.RemoveAt(0);
            }
            return true;
        }

        /// <summary>
        /// The snapshot that last fell out of the buffer (null if none), for <c>ServerMsg.Decode(frame, length, reuse)</c> to decode
        /// into. It is no longer in the buffer; whoever takes it owns it. Only safe when nothing else still holds that snapshot
        /// (it is <see cref="Capacity"/> snapshots old, two seconds at 20 Hz).
        /// </summary>
        public ServerMsg.Snapshot TakeSpare()
        {
            var s = _spare;
            _spare = null;
            return s;
        }

        /// <summary>Hands back a spare that was taken but not used (the frame was not a snapshot, or failed to decode).</summary>
        internal void Recycle(ServerMsg.Snapshot s) { if (s != null) _spare = s; }

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

        static bool SortedById(WireActor[] a)
        {
            for (int i = 1; i < a.Length; i++) if (a[i - 1].Id >= a[i].Id) return false;
            return true;
        }

        /// <summary>Index of the last actor with <paramref name="id"/> (what a map built in array order would hold), or -1.</summary>
        static int LastIndexOf(WireActor[] a, uint id)
        {
            for (int i = a.Length - 1; i >= 0; i--) if (a[i].Id == id) return i;
            return -1;
        }

        void Emit(ServerMsg.Snapshot b, ServerMsg.Snapshot a, float t, List<InterpActor> outActors)
        {
            WireActor[] cur = b.Actors, prev = a != null ? a.Actors : null;
            // Snapshots list actors by ascending id (C-OBS), so one forward merge pairs them in O(n + m). Anything else (a hand-made
            // snapshot) falls back to a search with the same result; neither allocates.
            bool merge = prev != null && SortedById(prev) && SortedById(cur);
            int j = 0;
            for (int i = 0; i < cur.Length; i++)
            {
                ref readonly WireActor c = ref cur[i];
                var o = new InterpActor { Id = c.Id, Faction = (FactionId)c.Faction, HpPct = c.HpPct, Status = (ActorStatus)c.Status, Weapon = (WeaponId)c.Weapon, Bounty = c.Bounty, X = c.X, Y = c.Y, Facing = c.Facing };
                int k = -1;
                if (merge)
                {
                    while (j < prev.Length && prev[j].Id < c.Id) j++;
                    if (j < prev.Length && prev[j].Id == c.Id) k = j;
                }
                else if (prev != null) k = LastIndexOf(prev, c.Id);
                if (k >= 0)
                {
                    ref readonly WireActor p = ref prev[k];
                    float dx = c.X - p.X, dy = c.Y - p.Y;
                    if (dx * dx + dy * dy <= TeleportDistance * TeleportDistance)
                    {
                        o.X = p.X + dx * t;
                        o.Y = p.Y + dy * t;
                        o.Facing = LerpAngle(p.Facing, c.Facing, t);
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

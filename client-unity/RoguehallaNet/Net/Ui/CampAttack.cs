using System;
using System.Collections.Generic;

namespace Roguehalla.Net.Ui
{
    /// <summary>Which camps the local player is attacking now; the patience outline presenter reads it.</summary>
    public interface ICampAttacked
    {
        bool IsAttacked(int campIndex);
    }

    /// <summary>A regional mob as the camp decision needs it: id and position in sim units.</summary>
    public readonly struct CampAttackMob
    {
        public readonly uint Id; public readonly float X, Y;
        public CampAttackMob(uint id, float x, float y) { Id = id; X = x; Y = y; }
    }

    /// <summary>
    /// P-UNITY-CAMP-PATIENCE-SHOW-1 (owner direction 2026-11-14): a camp counts as attacked for <see cref="LingerMs"/> after damage between the
    /// local player and one of its mobs (either direction). A mob's camp is the patience plane value under its position, remembered across frames so
    /// a killing blow still counts. No seat or a dead local player attacks nothing. Presentation filter over server facts; steady frames allocate nothing.
    /// </summary>
    public sealed class CampAttack : ICampAttacked
    {
        /// <summary>Dial: how long a camp stays "attacked" after the last damage between the local player and one of its mobs (ms).</summary>
        public const double LingerMs = 2500;

        const int MaxCamps = 256, TileSize = 32;

        struct Seen { public int Camp; public long Frame; }

        readonly List<uint> _by = new List<uint>(16), _victim = new List<uint>(16);
        readonly Dictionary<uint, Seen> _camps = new Dictionary<uint, Seen>(64);
        readonly List<uint> _stale = new List<uint>(16);
        readonly double[] _lastHit = new double[MaxCamps];
        readonly bool[] _on = new bool[MaxCamps];
        long _frame;

        public CampAttack() { Clear(); }

        /// <summary>Damage fx (FxKind.Hit or SigHit): <paramref name="by"/> hurt <paramref name="victim"/>. Resolved at the next <see cref="Update"/>.</summary>
        public void NoteHit(uint by, uint victim) { _by.Add(by); _victim.Add(victim); }

        /// <summary>Per frame. <paramref name="localId"/> is 0 for a spectator; <paramref name="mobs"/> every visible regional mob; the plane is the map's patience plane (1-based camp refs).</summary>
        public void Update(double nowMs, uint localId, bool localAlive, IReadOnlyList<CampAttackMob> mobs, byte[] plane, int w, int h)
        {
            _frame++;
            bool planeOk = plane != null && w > 0 && h > 0 && plane.Length == (long)w * h;
            if (mobs != null)
                for (int i = 0; i < mobs.Count; i++)
                {
                    var m = mobs[i];
                    int camp = planeOk ? CampOf(plane, w, h, m.X, m.Y) : -1;
                    Seen prev;
                    if (camp < 0 && _camps.TryGetValue(m.Id, out prev)) camp = prev.Camp;   // a mob that chased off its camp's tiles still belongs to it
                    _camps[m.Id] = new Seen { Camp = camp, Frame = _frame };
                }
            if (localId == 0 || !localAlive)
            {
                for (int i = 0; i < MaxCamps; i++) { _on[i] = false; _lastHit[i] = double.NegativeInfinity; }
            }
            else
            {
                for (int i = 0; i < _by.Count; i++)
                {
                    uint by = _by[i], victim = _victim[i], mob;
                    if (by == localId) mob = victim; else if (victim == localId) mob = by; else continue;
                    if (mob == 0 || mob == uint.MaxValue || mob == localId) continue;
                    Seen s;
                    if (!_camps.TryGetValue(mob, out s) || s.Camp < 0) continue;
                    _lastHit[s.Camp] = nowMs;
                }
                for (int i = 0; i < MaxCamps; i++) _on[i] = nowMs - _lastHit[i] < LingerMs;
            }
            _by.Clear(); _victim.Clear();
            // Forget mobs not seen for a while, once the memory is much bigger than the view.
            int live = mobs != null ? mobs.Count : 0;
            if (_camps.Count > 2 * live + 64)
            {
                _stale.Clear();
                foreach (var kv in _camps) if (kv.Value.Frame != _frame) _stale.Add(kv.Key);
                for (int i = 0; i < _stale.Count; i++) _camps.Remove(_stale[i]);
            }
        }

        /// <summary>Forget everything (a new match).</summary>
        public void Clear()
        {
            _by.Clear(); _victim.Clear(); _camps.Clear();
            for (int i = 0; i < MaxCamps; i++) { _on[i] = false; _lastHit[i] = double.NegativeInfinity; }
        }

        public bool IsAttacked(int campIndex) { return campIndex >= 0 && campIndex < MaxCamps && _on[campIndex]; }

        static int CampOf(byte[] plane, int w, int h, float x, float y)
        {
            if (!(x >= 0 && y >= 0)) return -1;   // also NaN
            double tx = Math.Floor(x / TileSize), ty = Math.Floor(y / TileSize);
            if (tx >= w || ty >= h) return -1;
            int v = plane[(int)ty * w + (int)tx];
            return v == 0 ? -1 : v - 1;
        }
    }
}

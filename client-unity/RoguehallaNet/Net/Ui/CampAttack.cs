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

    /// <summary>STUB (P-UNITY-CAMP-PATIENCE-SHOW-1): the implementer replaces the body; the contract is in docs/backlog/packets/P-UNITY-CAMP-PATIENCE-SHOW-1.md.</summary>
    public sealed class CampAttack : ICampAttacked
    {
        /// <summary>Dial: how long a camp stays "attacked" after the last damage between the local player and one of its mobs (ms).</summary>
        public const double LingerMs = 2500;

        /// <summary>Damage fx (FxKind.Hit or SigHit): <paramref name="by"/> hurt <paramref name="victim"/>. Resolved at the next <see cref="Update"/>.</summary>
        public void NoteHit(uint by, uint victim) { }

        /// <summary>Per frame. <paramref name="localId"/> is 0 for a spectator; <paramref name="mobs"/> every visible regional mob; the plane is the map's patience plane (1-based camp refs).</summary>
        public void Update(double nowMs, uint localId, bool localAlive, IReadOnlyList<CampAttackMob> mobs, byte[] plane, int w, int h) { }

        /// <summary>Forget everything (a new match).</summary>
        public void Clear() { }

        public bool IsAttacked(int campIndex) { return false; }
    }
}

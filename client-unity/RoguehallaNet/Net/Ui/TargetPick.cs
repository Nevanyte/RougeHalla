using System.Collections.Generic;

namespace Roguehalla.Net.Ui
{
    /// <summary>One actor from the client's observation, as the wand click picker sees it. World units, feet position as drawn.</summary>
    public struct PickCandidate
    {
        public uint Id;
        public float X, Y;
        public ActorKind Kind;
        public ActorStatus Status;
        public ushort Effects;
        /// <summary>The local player's own companion (zombie). Legacy never offers it.</summary>
        public bool OwnCompanion;
    }

    /// <summary>What a left click sends.</summary>
    public enum ClickOrderKind : byte { None = 0, Target = 1, DirectionalAttack = 2 }

    public struct ClickOrder
    {
        public ClickOrderKind Kind;
        /// <summary>The locked actor for <see cref="ClickOrderKind.Target"/>, else 0.</summary>
        public uint Target;
    }

    /// <summary>
    /// Wand click picking, ported from packages/client/src/render/targeting.ts. Pure: no engine, no screen units.
    /// </summary>
    public static class TargetPick
    {
        /// <summary>shared/constants.ts:401 TARGET_SNAP_RADIUS, world units.</summary>
        public const float SnapRadius = 64f;

        /// <summary>Whether a candidate may be offered at all (alive, not hidden/untargetable, not self, not own companion, not a quest NPC, gates).</summary>
        public static bool Eligible(in PickCandidate c, uint selfId, bool gatesLocked)
        {
            if (c.Status != ActorStatus.Alive || c.Id == selfId || c.OwnCompanion) return false;
            if ((c.Effects & (Untargetable | Hidden)) != 0) return false;
            if (c.Kind == ActorKind.QuestGiver) return false;
            if (gatesLocked && c.Kind != ActorKind.Player && c.Kind != ActorKind.Zombie) return false;
            return true;
        }

        const ushort Untargetable = 128, Hidden = 256;

        /// <summary>The eligible candidate nearest the cursor's world point within <paramref name="radius"/> (strictly inside), 0 for none; ties go to the lower id.</summary>
        public static uint Pick(float cursorX, float cursorY, IReadOnlyList<PickCandidate> candidates, uint selfId, bool gatesLocked, float radius = SnapRadius)
        {
            uint best = 0; float bestSq = radius * radius;
            for (int i = 0; i < candidates.Count; i++)
            {
                var c = candidates[i];
                if (!Eligible(c, selfId, gatesLocked)) continue;
                float dx = c.X - cursorX, dy = c.Y - cursorY, sq = dx * dx + dy * dy;
                if (sq < bestSq || (sq == bestSq && best != 0 && c.Id < best)) { bestSq = sq; best = c.Id; }
            }
            return best;
        }

        /// <summary>The order a left click sends: a wand locks the pick or sends nothing; every other weapon attacks in the aim direction.</summary>
        public static ClickOrder Decide(WeaponId? weapon, uint picked)
        {
            if (weapon == WeaponId.Wand)
                return picked == 0 ? new ClickOrder { Kind = ClickOrderKind.None, Target = 0 } : new ClickOrder { Kind = ClickOrderKind.Target, Target = picked };
            return new ClickOrder { Kind = ClickOrderKind.DirectionalAttack, Target = 0 };
        }
    }

    /// <summary>
    /// Which actor to draw as locked (legacy LockDisplay, targeting.ts:65).
    /// </summary>
    public sealed class LockDisplay
    {
        /// <summary>targeting.ts:58 OPTIMISTIC_LOCK_MS.</summary>
        public const double OptimisticLockMs = 500;

        /// <summary>An order was just sent: <paramref name="id"/> is the actor being locked, 0 for a move or stop.</summary>
        public void Note(uint id, double nowMs) { _id = id; _until = nowMs + OptimisticLockMs; }

        /// <summary>The id to draw as locked at <paramref name="nowMs"/>, given the synced lock (0 = none).</summary>
        public uint Shown(uint synced, double nowMs) { return nowMs < _until ? _id : synced; }

        public void Reset() { _id = 0; _until = double.NegativeInfinity; }

        uint _id;
        double _until = double.NegativeInfinity;
    }
}

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
    /// Wand click picking, ported from packages/client/src/render/targeting.ts. Pure: no engine, no screen units. STUB: the
    /// implementer replaces every body; the signatures are what the oracle (TargetPickTests) calls.
    /// </summary>
    public static class TargetPick
    {
        /// <summary>shared/constants.ts:401 TARGET_SNAP_RADIUS, world units.</summary>
        public const float SnapRadius = 64f;

        /// <summary>Whether a candidate may be offered at all (alive, not hidden/untargetable, not self, not own companion, not a quest NPC, gates).</summary>
        public static bool Eligible(in PickCandidate c, uint selfId, bool gatesLocked) { return false; }

        /// <summary>The eligible candidate nearest the cursor's world point within <paramref name="radius"/> (strictly inside), 0 for none; ties go to the lower id.</summary>
        public static uint Pick(float cursorX, float cursorY, IReadOnlyList<PickCandidate> candidates, uint selfId, bool gatesLocked, float radius = SnapRadius) { return 0; }

        /// <summary>The order a left click sends: a wand locks the pick or sends nothing; every other weapon attacks in the aim direction.</summary>
        public static ClickOrder Decide(WeaponId? weapon, uint picked)
        {
            return new ClickOrder { Kind = ClickOrderKind.DirectionalAttack, Target = 0 };
        }
    }

    /// <summary>
    /// Which actor to draw as locked (legacy LockDisplay, targeting.ts:65). STUB: today's behaviour, the synced value only.
    /// </summary>
    public sealed class LockDisplay
    {
        /// <summary>targeting.ts:58 OPTIMISTIC_LOCK_MS.</summary>
        public const double OptimisticLockMs = 500;

        /// <summary>An order was just sent: <paramref name="id"/> is the actor being locked, 0 for a move or stop.</summary>
        public void Note(uint id, double nowMs) { }

        /// <summary>The id to draw as locked at <paramref name="nowMs"/>, given the synced lock (0 = none).</summary>
        public uint Shown(uint synced, double nowMs) { return synced; }

        public void Reset() { }
    }
}

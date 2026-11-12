using System;

namespace Roguehalla.Net.Protocol
{
    /// <summary>
    /// The public HUD constant codes a Welcome carries (protocol 17, P-WIRE17-HUD-2b; rh-protocol hud_content.rs
    /// <c>HudTerm</c>). Append-only. Values are the raw legacy constants (ms, world units, multipliers): the client formats
    /// them and never computes a rule from them.
    /// </summary>
    public enum HudTerm : byte
    {
        FreezeStunMs = 0, FreezeRange = 1, SwarmHiddenMs = 2, SwarmCloudRadius = 3, TrialZoneMs = 4, TrialDealtMult = 5,
        TrialMoveMult = 6, TrialTakenMult = 7, TrialExitStunMs = 8, TrialRadius = 9, TrialConvictedRadius = 10,
        BlazeBurnDps = 11, BlazeBurnMs = 12, BlazeMinDist = 13, BlazeMaxDist = 14, LastStandMs = 15,
        LastStandSpeedBonus = 16, LastStandHealShare = 17, LastStandFloorHp = 18,
    }

    /// <summary>One weapon's damage scaling (legacy <c>WeaponSpec.scaling</c> and <c>dominant</c>).</summary>
    public sealed class WireWeaponScaling
    {
        /// <summary>The weapon's wire code, as in the weapon table.</summary>
        public byte Id;
        /// <summary>Raw damage per bonus Offense, SO, max HP and Defense + SD point.</summary>
        public double Ad, Ap, BonusHp, BonusDefense;
        /// <summary>The terms are alternatives (the higher applies; legacy joins them with " or "), else a sum (" + ").</summary>
        public bool Dominant;
    }

    /// <summary>One public HUD constant.</summary>
    public sealed class WireHudTerm
    {
        public byte Code;
        public double Value;
    }

    /// <summary>
    /// The HUD content block a Welcome carries after the weapon table and before the map (protocol 17, P-WIRE17-HUD-2b;
    /// rh-protocol hud_content.rs): <c>scaling count u8</c> (at most <see cref="MaxScalingRows"/>), rows of
    /// <c>id u8, ad f64, ap f64, bonusHp f64, bonusDefense f64, dominant u8</c> (ids strictly ascending, dominant 0 or 1);
    /// then <c>term count u8</c> (at most <see cref="MaxTerms"/>), rows of <c>code u8, value f64</c> (codes below
    /// <see cref="TermCount"/>, strictly ascending). Every double is finite and in 0..1e6. Refusal reasons and their order
    /// are those of the Rust decoder ("scaling count", "scaling dominant", "scaling", "scaling order", "hud term count",
    /// "hud term code", "hud term", "hud term order"); the encoder throws <see cref="ArgumentException"/> with the reason.
    /// </summary>
    public sealed class WireHudContent
    {
        public const int MaxScalingRows = 32, ScalingRowLength = 1 + 8 * 4 + 1, TermRowLength = 1 + 8;
        public const byte TermCount = 19;
        public const int MaxTerms = TermCount;
        public const double MaxValue = 1e6;

        public WireWeaponScaling[] Scaling = Array.Empty<WireWeaponScaling>();
        public WireHudTerm[] Terms = Array.Empty<WireHudTerm>();

        /// <summary>The value of a term, or null when the block does not carry it.</summary>
        public double? Term(HudTerm code)
        {
            if (Terms == null) return null;
            foreach (var t in Terms) if (t != null && t.Code == (byte)code) return t.Value;
            return null;
        }

        /// <summary>The scaling row of a weapon id, or null.</summary>
        public WireWeaponScaling ScalingOf(byte id)
        {
            if (Scaling == null) return null;
            foreach (var s in Scaling) if (s != null && s.Id == id) return s;
            return null;
        }

        // STUB (P-WIRE17-HUD-2b): the implementer writes the codec and wires it into ServerMsg.Welcome.
        internal int Length() { return 0; }
        internal void Write(Writer w) { }
        internal static WireHudContent Read(ref Reader r) { return new WireHudContent(); }
    }
}

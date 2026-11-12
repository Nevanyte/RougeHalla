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

        static bool InRange(double v) { return !double.IsNaN(v) && !double.IsInfinity(v) && v >= 0 && v <= MaxValue; }

        static bool ValuesOk(WireWeaponScaling s)
        {
            return InRange(s.Ad) && InRange(s.Ap) && InRange(s.BonusHp) && InRange(s.BonusDefense);
        }

        /// <summary>The scaling rows' first fault once read (values, then id order), or null.</summary>
        static string ScalingRowsFault(WireWeaponScaling[] rows)
        {
            foreach (var s in rows) if (s == null || !ValuesOk(s)) return "scaling";
            for (int i = 1; i < rows.Length; i++) if (rows[i].Id <= rows[i - 1].Id) return "scaling order";
            return null;
        }

        /// <summary>The term rows' first fault once read (values, then code order), or null.</summary>
        static string TermRowsFault(WireHudTerm[] rows)
        {
            foreach (var t in rows) if (t == null || !InRange(t.Value)) return "hud term";
            for (int i = 1; i < rows.Length; i++) if (rows[i].Code <= rows[i - 1].Code) return "hud term order";
            return null;
        }

        internal int Length()
        {
            return 1 + (Scaling?.Length ?? 0) * ScalingRowLength + 1 + (Terms?.Length ?? 0) * TermRowLength;
        }

        /// <summary>The encoder's checks, in the Rust <c>content_fault</c> order: scaling count, scaling values, scaling order,
        /// term count, term code, term values, term order.</summary>
        internal void Validate()
        {
            var scaling = Scaling ?? Array.Empty<WireWeaponScaling>();
            var terms = Terms ?? Array.Empty<WireHudTerm>();
            if (scaling.Length > MaxScalingRows) throw new ArgumentException("scaling count");
            string why = ScalingRowsFault(scaling);
            if (why != null) throw new ArgumentException(why);
            if (terms.Length > MaxTerms) throw new ArgumentException("hud term count");
            foreach (var t in terms) if (t != null && t.Code >= TermCount) throw new ArgumentException("hud term code");
            why = TermRowsFault(terms);
            if (why != null) throw new ArgumentException(why);
        }

        internal void Write(Writer w)
        {
            Validate();
            var scaling = Scaling ?? Array.Empty<WireWeaponScaling>();
            var terms = Terms ?? Array.Empty<WireHudTerm>();
            w.U8((byte)scaling.Length);
            foreach (var s in scaling)
            {
                w.U8(s.Id); w.F64(s.Ad); w.F64(s.Ap); w.F64(s.BonusHp); w.F64(s.BonusDefense); w.U8(s.Dominant ? (byte)1 : (byte)0);
            }
            w.U8((byte)terms.Length);
            foreach (var t in terms) { w.U8(t.Code); w.F64(t.Value); }
        }

        /// <summary>Reads the block with the Rust decoder's reasons and order: a count over its cap before any row, a dominant
        /// byte above 1 or a code at or above <see cref="TermCount"/> as soon as read, then values, then order.</summary>
        internal static WireHudContent Read(ref Reader r)
        {
            int n = r.U8();
            if (n > MaxScalingRows) throw new DecodeException(DecodeError.BadField, "scaling count");
            var scaling = n == 0 ? Array.Empty<WireWeaponScaling>() : new WireWeaponScaling[n];
            for (int i = 0; i < n; i++)
            {
                var s = new WireWeaponScaling { Id = r.U8() };
                s.Ad = r.F64(); s.Ap = r.F64(); s.BonusHp = r.F64(); s.BonusDefense = r.F64();
                byte dominant = r.U8();
                if (dominant > 1) throw new DecodeException(DecodeError.BadField, "scaling dominant");
                s.Dominant = dominant == 1;
                scaling[i] = s;
            }
            string why = ScalingRowsFault(scaling);
            if (why != null) throw new DecodeException(DecodeError.BadField, why);
            int m = r.U8();
            if (m > MaxTerms) throw new DecodeException(DecodeError.BadField, "hud term count");
            var terms = m == 0 ? Array.Empty<WireHudTerm>() : new WireHudTerm[m];
            for (int i = 0; i < m; i++)
            {
                byte code = r.U8();
                if (code >= TermCount) throw new DecodeException(DecodeError.BadField, "hud term code");
                terms[i] = new WireHudTerm { Code = code, Value = r.F64() };
            }
            why = TermRowsFault(terms);
            if (why != null) throw new DecodeException(DecodeError.BadField, why);
            return new WireHudContent { Scaling = scaling, Terms = terms };
        }
    }
}

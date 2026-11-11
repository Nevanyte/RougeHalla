using System;
using System.Collections.Generic;

namespace Roguehalla.Net.Ui
{
    public enum OverheadActorKind : byte { Player, Mob, Elite, Dummy }

    /// <summary>
    /// What an overhead element is. The first ten are the legacy stack (PlayerView.ts / MobView.ts / MarkPlate.ts). The last four are
    /// today's Unity additions: the implementer deletes them (and every use) so that the layout can no longer emit them.
    /// </summary>
    public enum OverheadKind : byte
    {
        HpBack, HpFill, BarrierFill, Name, WishIcon, MarkPips, BountyCrown, BountyNumber, SecondaryWeapon, StatMark,
        InsigniaPlate, SignatureIcon, NamePlate, StatusBadge,
    }

    /// <summary>Colour state of an element; the real colours come from the theme.</summary>
    public enum OverheadTone : byte { None, Green, Amber, Red, Barrier, NameOwn, NameOther, NameMob, NameElite, WishReady, WishRecharging, Faction, Gold }

    /// <summary>The facts the client already has for one actor (protocol 16). Percent values are 0..100 of max hp.</summary>
    public struct OverheadFacts
    {
        public OverheadActorKind Kind;
        public bool Local, Dead;
        public float HpPct, BarrierPct;
        public string Name; public bool Bot;      // raw roster name; the layout adds the [BOT] prefix
        public float NameWidthPx;                 // measured width of the drawn name text; 0 = not measured (legacy falls back to 6 px per character)
        public int Bounty;
        public int WishState;                     // 0 none, 1 ready, 2 recharging
        public bool HasSecondary; public byte Secondary;
        public byte Stat1, Stat2;                 // StatKey codes 1..9, 0 none
        public int MarkTier;                      // Sentenced mark tier 0..4
    }

    /// <summary>
    /// One drawn piece. Legacy screen px at zoom 1, y UP from the feet. X is the centre; Y is the BOTTOM edge; W/H the size.
    /// </summary>
    public struct OverheadElement
    {
        public OverheadKind Kind; public float X, Y, W, H; public OverheadTone Tone;
        public string Text;   // Name, BountyNumber
        public int Lit;       // MarkPips: pips lit (the tier)
        public byte Variant;  // SecondaryWeapon: WeaponId; StatMark: StatKey
    }

    /// <summary>The overhead stack of one actor as legacy PlayerView/MobView/MarkPlate draw it (docs/backlog/packets/P-UNITY-OVERHEAD-1.md).</summary>
    public static class OverheadStack
    {
        /// <summary>Actor-local units per legacy px (the converter in OverheadIndicators today). Convert once, here.</summary>
        public const float UnitsPerPx = .026f;
        public static float ToUnits(float px) { return px * UnitsPerPx; }

        /// <summary>STUB: today's Unity arrangement, to be replaced. Clears <paramref name="into"/> and fills it bottom to top.</summary>
        public static void Build(in OverheadFacts f, List<OverheadElement> into)
        {
            into.Clear();
            if (f.Dead) return;
            into.Add(new OverheadElement { Kind = OverheadKind.InsigniaPlate, Y = 40, W = 18, H = 18 });
            into.Add(new OverheadElement { Kind = OverheadKind.HpBack, Y = 69, W = 40, H = 5.5f });
            into.Add(new OverheadElement { Kind = OverheadKind.HpFill, Y = 69, W = 40f * f.HpPct / 100f, H = 5.5f, Tone = OverheadTone.Faction });
            if (f.BarrierPct > 0) into.Add(new OverheadElement { Kind = OverheadKind.BarrierFill, Y = 69, W = 40f * f.BarrierPct / 100f, H = 5.5f, Tone = OverheadTone.Gold });
            into.Add(new OverheadElement { Kind = OverheadKind.SignatureIcon, Y = 78, W = 12, H = 12 });
            into.Add(new OverheadElement { Kind = OverheadKind.StatusBadge, Y = 78, W = 12, H = 12 });
            string name = Indicators.DisplayName(f.Name, false);
            if (name != null)
            {
                into.Add(new OverheadElement { Kind = OverheadKind.NamePlate, Y = 90, W = 60, H = 10 });
                into.Add(new OverheadElement { Kind = OverheadKind.Name, Y = 90, W = 60, H = 11, Text = name, Tone = OverheadTone.NameOther });
            }
            if (f.WishState != 0) into.Add(new OverheadElement { Kind = OverheadKind.WishIcon, X = 0, Y = 102, W = 15, H = 15, Tone = OverheadTone.WishReady });
            if (f.Bounty > 0)
            {
                into.Add(new OverheadElement { Kind = OverheadKind.BountyCrown, Y = 120, W = 22, H = 13 });
                into.Add(new OverheadElement { Kind = OverheadKind.BountyNumber, Y = 135, W = 20, H = 11, Text = f.Bounty.ToString() });
            }
            int slots = (f.HasSecondary ? 1 : 0) + (f.Stat1 != 0 ? 1 : 0) + (f.Stat2 != 0 ? 1 : 0);
            float x = -(slots - 1) * 9.5f;
            if (f.HasSecondary) { into.Add(new OverheadElement { Kind = OverheadKind.SecondaryWeapon, X = x, Y = 150, W = 17, H = 17, Variant = f.Secondary }); x += 19; }
            if (f.Stat1 != 0) { into.Add(new OverheadElement { Kind = OverheadKind.StatMark, X = x, Y = 150, W = 17, H = 17, Variant = f.Stat1 }); x += 19; }
            if (f.Stat2 != 0) into.Add(new OverheadElement { Kind = OverheadKind.StatMark, X = x, Y = 150, W = 17, H = 17, Variant = f.Stat2 });
        }
    }
}

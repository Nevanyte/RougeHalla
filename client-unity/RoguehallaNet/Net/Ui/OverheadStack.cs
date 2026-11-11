using System;
using System.Collections.Generic;

namespace Roguehalla.Net.Ui
{
    public enum OverheadActorKind : byte { Player, Mob, Elite, Dummy }

    /// <summary>
    /// What an overhead element is: exactly the legacy stack (PlayerView.ts / MobView.ts / MarkPlate.ts); nothing else can be emitted.
    /// </summary>
    public enum OverheadKind : byte
    {
        HpBack, HpFill, BarrierFill, Name, WishIcon, MarkPips, BountyCrown, BountyNumber, SecondaryWeapon, StatMark,
    }

    /// <summary>Colour state of an element; the real colours come from the theme.</summary>
    public enum OverheadTone : byte { None, Green, Amber, Red, Barrier, NameOwn, NameOther, NameMob, NameElite, WishReady, WishRecharging, Gold }

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

        // Bounty numbers are formatted once per value and reused, so a crowned actor allocates nothing per Build.
        static readonly string[] BountyTexts = new string[1024];
        static string BountyText(int bounty)
        {
            if (bounty < 0 || bounty >= BountyTexts.Length) return bounty.ToString(System.Globalization.CultureInfo.InvariantCulture);
            return BountyTexts[bounty] ?? (BountyTexts[bounty] = bounty.ToString(System.Globalization.CultureInfo.InvariantCulture));
        }

        static float Half(float x) { return (float)Math.Floor(x * 2f + .5f) / 2f; }   // JS Math.round to half a pixel (hpView.ts:20)

        /// <summary>Clears <paramref name="into"/> and fills it bottom to top, as PlayerView/MobView/MarkPlate draw the stack. Dead actors draw nothing.</summary>
        public static void Build(in OverheadFacts f, List<OverheadElement> into)
        {
            into.Clear();
            if (f.Dead) return;
            bool player = f.Kind == OverheadActorKind.Player;
            // Hp bar (FighterArt.ts:354-392, MobView.ts:19-20,173-175): mobs show it only when hurt; elites and dummies always.
            bool bar = player || f.Kind != OverheadActorKind.Mob || f.HpPct < 100f;
            if (bar)
            {
                float w = f.Kind == OverheadActorKind.Elite ? 48f : player ? 28f : 36f;
                const float h = 4f, y = 31.2f;
                float total = Math.Max(100f, f.HpPct + f.BarrierPct);
                float fillW = Half(f.HpPct / total * w), barW = f.BarrierPct > 0 ? Half(f.BarrierPct / total * w) : 0f;
                var tone = f.HpPct > 50f ? OverheadTone.Green : f.HpPct > 25f ? OverheadTone.Amber : OverheadTone.Red;
                into.Add(new OverheadElement { Kind = OverheadKind.HpBack, X = 0, Y = y, W = w, H = h });
                into.Add(new OverheadElement { Kind = OverheadKind.HpFill, X = -w / 2 + fillW / 2, Y = y, W = fillW, H = h, Tone = tone });
                if (barW > 0) into.Add(new OverheadElement { Kind = OverheadKind.BarrierFill, X = -w / 2 + fillW + barW / 2, Y = y, W = barW, H = h, Tone = OverheadTone.Barrier });
            }
            // Name (PlayerView.ts:65,171-174; MobView.ts:23-24): every name shows.
            string name = Indicators.DisplayName(f.Name, f.Bot);
            float nameW = f.NameWidthPx > 0 ? f.NameWidthPx : 6f * (name == null ? 0 : name.Length);
            if (name != null)
            {
                var tone = f.Kind == OverheadActorKind.Elite ? OverheadTone.NameElite : f.Kind == OverheadActorKind.Player
                    ? (f.Local ? OverheadTone.NameOwn : OverheadTone.NameOther) : OverheadTone.NameMob;
                into.Add(new OverheadElement { Kind = OverheadKind.Name, X = 0, Y = 45.2f, W = nameW, H = 11f, Text = name, Tone = tone });
            }
            if (!player) return;
            if (f.WishState != 0)
                into.Add(new OverheadElement { Kind = OverheadKind.WishIcon, X = -nameW / 2 - 3f - 7.5f, Y = 44.2f, W = 15f, H = 15f, Tone = f.WishState == 1 ? OverheadTone.WishReady : OverheadTone.WishRecharging });
            if (f.MarkTier > 0)
                into.Add(new OverheadElement { Kind = OverheadKind.MarkPips, X = 0, Y = 54.2f, W = 32f, H = 3f, Lit = f.MarkTier });
            float rowCentre = 72.2f;
            if (f.Bounty > 0)
            {
                float s = 1f + .5f * Math.Min(1f, f.Bounty / 150f);
                into.Add(new OverheadElement { Kind = OverheadKind.BountyCrown, X = 0, Y = 60.2f, W = 22f * s, H = 13f * s });
                into.Add(new OverheadElement { Kind = OverheadKind.BountyNumber, X = 0, Y = 60.2f + 13f * s + 1f, W = 20f, H = 11f, Text = BountyText(f.Bounty), Tone = OverheadTone.Gold });
                rowCentre = 60.2f + 13f * s + 14f;
            }
            if (f.HasSecondary) into.Add(new OverheadElement { Kind = OverheadKind.SecondaryWeapon, X = -18f, Y = rowCentre - 9f, W = 18f, H = 18f, Variant = f.Secondary });
            if (f.Stat1 != 0) into.Add(new OverheadElement { Kind = OverheadKind.StatMark, X = 0, Y = rowCentre - 9f, W = 18f, H = 18f, Variant = f.Stat1 });
            if (f.Stat2 != 0) into.Add(new OverheadElement { Kind = OverheadKind.StatMark, X = 18f, Y = rowCentre - 9f, W = 18f, H = 18f, Variant = f.Stat2 });
        }
    }
}

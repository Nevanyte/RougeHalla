using System;

namespace Roguehalla.Net.Ui
{
    /// <summary>Hp bar colour class by hp share (legacy FighterArt.ts:383: above 50% green, above 25% amber, else red). Colours come from the theme.</summary>
    public enum HpTone : byte { Green, Amber, Red }

    /// <summary>Pure rules for the legacy hp/name/bounty/secondary-weapon/status/damage-number indicators (docs/rework/LEGACY_INDICATORS.md).</summary>
    public static class Indicators
    {
        public static HpTone Tone(float hpPct)
        {
            if (float.IsNaN(hpPct)) return HpTone.Red;
            return hpPct > 50f ? HpTone.Green : hpPct > 25f ? HpTone.Amber : HpTone.Red;
        }

        /// <summary>MobView.ts:173-177: a regional mob's bar shows only when hurt (the "fighting" case is not delivered); elites and dummies always.</summary>
        public static bool MobBarVisible(bool elite, bool dummy, float hpPct, bool dying)
        {
            if (dying) return false;
            return elite || dummy || hpPct < 100f;
        }

        /// <summary>Legacy idle label alpha: a calm non-elite mob's name is faint (.5), otherwise full (MobView.ts:177).</summary>
        public static float MobLabelAlpha(bool elite, bool dummy, float hpPct) { return elite || dummy || hpPct < 100f ? 1f : .5f; }

        /// <summary>PlayerView.ts:34-38: the crown grows from 1x to 1.5x as the bounty approaches 150.</summary>
        public static float CrownScale(int bounty) { return 1f + .5f * Math.Min(1f, Math.Max(0f, bounty) / 150f); }
        public static bool CrownVisible(int bounty, bool alive) { return alive && bounty > 0; }

        /// <summary>
        /// PlayerView.drawBuildMarks: the weapon in the slot that is NOT in hand; an empty other slot reads as fists. Null when the
        /// inventory is unknown. Only the local player's slots are delivered.
        /// </summary>
        public static WeaponId? SecondaryWeapon(bool hasInventory, byte activeSlot, WeaponId? slot0, WeaponId? slot1)
        {
            if (!hasInventory) return null;
            WeaponId? other = activeSlot == 1 ? slot0 : slot1;
            return other ?? WeaponId.Fists;
        }

        // Effects bits (shared/status.ts:38-50) in legacy StatusArt draw order (StatusArt.ts:36): floor, body, head.
        public const ushort Stunned = 1, Rooted = 2, Silenced = 4, Slowed = 8, AttackSlowed = 16, AntiHeal = 32, Dot = 64, Untargetable = 128,
            Hidden = 256, Zoned = 512, LastStand = 1024, Haste = 2048, Casting = 4096;
        public enum Plane : byte { Ground, Body, Head }
        public struct StatusLayer { public ushort Bit; public Plane Plane; }
        public static readonly StatusLayer[] StatusOrder =
        {
            new StatusLayer { Bit = Rooted, Plane = Plane.Ground }, new StatusLayer { Bit = Zoned, Plane = Plane.Ground },
            new StatusLayer { Bit = Casting, Plane = Plane.Body }, new StatusLayer { Bit = LastStand, Plane = Plane.Body },
            new StatusLayer { Bit = Untargetable, Plane = Plane.Body }, new StatusLayer { Bit = Haste, Plane = Plane.Body },
            new StatusLayer { Bit = Slowed, Plane = Plane.Body }, new StatusLayer { Bit = Dot, Plane = Plane.Body },
            new StatusLayer { Bit = Stunned, Plane = Plane.Head }, new StatusLayer { Bit = Silenced, Plane = Plane.Head },
            new StatusLayer { Bit = AttackSlowed, Plane = Plane.Head }, new StatusLayer { Bit = AntiHeal, Plane = Plane.Head },
        };
        public const ushort DrawnMask = Stunned | Rooted | Silenced | Slowed | AttackSlowed | AntiHeal | Dot | Untargetable | Zoned | LastStand | Haste | Casting;

        /// <summary>Writes the legacy layers an effects word calls for, in draw order, into <paramref name="into"/>; returns the count (hidden and unknown bits draw nothing).</summary>
        public static int StatusLayers(ushort effects, StatusLayer[] into)
        {
            int n = 0;
            for (int i = 0; i < StatusOrder.Length && n < into.Length; i++) if ((effects & StatusOrder[i].Bit) != 0) into[n++] = StatusOrder[i];
            return n;
        }

        /// <summary>Remote hidden fighters (Swarm) are not drawn; the local one is drawn at .45 (PlayerView.ts:58).</summary>
        public static float HiddenAlpha(ushort effects, bool local)
        {
            if ((effects & Hidden) == 0) return 1f;
            return local ? .45f : 0f;
        }

        public enum DamageTone : byte { Others, ByMe, OnMe }
        /// <summary>FxView.ts:104-106: on me red, by me gold, else grey. On me wins when both.</summary>
        public static DamageTone DamageColour(uint victim, uint by, uint me)
        {
            if (me != 0 && victim == me) return DamageTone.OnMe;
            if (me != 0 && by == me) return DamageTone.ByMe;
            return DamageTone.Others;
        }
        /// <summary>FxView.ts:563: 13 + min(7, floor(amount / 40)) px (legacy px; scaled by the caller).</summary>
        public static int DamageSize(float amount) { return 13 + Math.Min(7, (int)Math.Floor(Math.Max(0f, amount) / 40f)); }
        public const int DamageLanes = 5; public const float DamageLanePx = 9f;
        /// <summary>Horizontal lane offset of the n-th simultaneous number (FxView.ts:565).</summary>
        public static float DamageLaneOffset(int counter) { int lane = ((counter % DamageLanes) + DamageLanes) % DamageLanes; return (lane - (DamageLanes - 1) / 2f) * DamageLanePx; }

        /// <summary>Legacy hurt vignette (signatures.ts:160-173): strength 0..1 for taking <paramref name="amount"/> with <paramref name="maxHp"/>.</summary>
        public static float HurtFlash(float amount, float maxHp)
        {
            if (!(amount > 0f) || !(maxHp > 0f)) return 0f;
            float share = amount / maxHp;
            if (share < .02f) return 0f;
            float k = (share - .02f) / (.25f - .02f);
            return Math.Min(1f, .25f + .75f * k);
        }

        /// <summary>Quest giver mark: "!" for an offer not yet accepted, "?" for one held (QuestView.ts:64).</summary>
        public static char QuestMark(bool accepted) { return accepted ? '?' : '!'; }
    }

    /// <summary>
    /// Vertical stacking of the overhead cluster above an actor's head, in legacy px above the head top, from PlayerView.ts / MobView.ts:
    /// hp bar, name, bounty crown (+ number), then the build row. Items that are absent give their room to the ones above, so the cluster stays tidy.
    /// </summary>
    public struct OverheadLayout
    {
        public const float Gap = 3f, BarH = 4f, NameH = 11f, CrownH = 13f, NumberH = 12f, RowH = 18f;
        public float BarY, NameY, CrownY, NumberY, RowY, TopY;

        /// <summary>All values are px above the head top; Y is the item's bottom except RowY which is the row's bottom.</summary>
        public static OverheadLayout Compute(bool name, bool crown, float crownScale, bool buildRow)
        {
            var l = new OverheadLayout();
            l.BarY = 8f;
            float cursor = l.BarY + BarH + Gap;     // legacy: name bottom is 18 above the head, i.e. 10 over the bar's top
            cursor = Math.Max(cursor, 10f);
            if (name) { l.NameY = Math.Max(cursor, 10f); cursor = l.NameY + NameH + Gap; }
            if (crown) { l.CrownY = cursor; l.NumberY = cursor + CrownH * crownScale + 1f; cursor = l.NumberY + NumberH + Gap; }
            if (buildRow) { l.RowY = cursor; cursor = l.RowY + RowH + Gap; }
            l.TopY = cursor;
            return l;
        }
    }
}

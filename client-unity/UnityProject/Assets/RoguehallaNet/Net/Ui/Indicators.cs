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

        // ---- protocol 16 indicator facts (ADR0026): legacy colours and texts, pure ----------------------------------------------------------
        /// <summary>FxView.ts:111-120: colour (0xRRGGBB) of a damage-over-time number by its SigHit kind: burn ffa040, disease b2d96c, mark d1a8ff, backlash ff7043, bleed e53935; an ability kind (16+) gold.</summary>
        public static uint SigColour(byte kind)
        {
            switch (kind) { case 1: return 0xffa040; case 2: return 0xb2d96c; case 3: return 0xff7043; case 4: return 0xd1a8ff; case 5: return 0xe53935; default: return kind >= 16 ? 0xffd36au : 0xcfd8dcu; }
        }
        /// <summary>FxView.ts:563-571: a critical hit shows "N!" and is 5 px bigger.</summary>
        public static string DamageText(float amount, bool crit) { return ((int)Math.Round(amount)).ToString(System.Globalization.CultureInfo.InvariantCulture) + (crit ? "!" : ""); }
        public static int DamageSize(float amount, bool crit) { return DamageSize(amount) + (crit ? 5 : 0); }
        /// <summary>FxView.ts:716: a heal number "+N" in 81f78b; heals under 1 are not shown (null).</summary>
        public static string HealText(float amount) { if (!(amount >= 1f)) return null; return "+" + ((int)Math.Round(amount)).ToString(System.Globalization.CultureInfo.InvariantCulture); }
        public const uint HealColour = 0x81f78b;
        /// <summary>combatIcons.ts STAT_ICON_COLORS (0xRRGGBB) of a build-mark stat.</summary>
        public static uint StatColour(StatKey k)
        {
            switch (k) { case StatKey.Ad: return 0xffb074; case StatKey.Ap: return 0xc4a0ff; case StatKey.Damage: return 0xffd36a; case StatKey.Health: return 0x62d889; case StatKey.AttackSpeed: return 0xffdc78;
                case StatKey.Armor: return 0xd5e0e8; case StatKey.Mr: return 0x75cfff; case StatKey.Speed: return 0x80d6ff; default: return 0xf05260; }
        }
        public static string StatLabel(StatKey k)
        {
            switch (k) { case StatKey.Ad: return "Attack damage"; case StatKey.Ap: return "Ability power"; case StatKey.Damage: return "Damage"; case StatKey.Health: return "Health"; case StatKey.AttackSpeed: return "Attack speed";
                case StatKey.Armor: return "Armor"; case StatKey.Mr: return "Magic resist"; case StatKey.Speed: return "Move speed"; default: return "Life steal"; }
        }
        /// <summary>The Wish a faction's fighter owns (its glyph beside the name).</summary>
        public static AbilityId WishOf(FactionId f)
        {
            switch (f) { case FactionId.Frost: return AbilityId.Freeze; case FactionId.Plague: return AbilityId.Swarm; case FactionId.Sentenced: return AbilityId.Trial; case FactionId.Fire: return AbilityId.Blaze; default: return AbilityId.LastStand; }
        }
        /// <summary>displayName.ts: bots read "[BOT] name".</summary>
        public static string DisplayName(string name, bool bot) { if (string.IsNullOrEmpty(name)) return null; return bot ? "[BOT] " + name : name; }
        /// <summary>MarkPlate.ts:39-44: "AS -N%" (taxed), "DMG -N%" (suppressed), "EXEC BLOCKED"; without the percentage the words TAXED / SUPPRESSED.</summary>
        public static string MarkCue(byte sig, byte taxPct)
        {
            string text = null;
            if ((sig & 16) != 0) text = taxPct > 0 ? "AS -" + taxPct + "%" : "TAXED";
            if ((sig & 32) != 0) { string t = taxPct > 0 ? "DMG -" + taxPct + "%" : "SUPPRESSED"; text = text == null ? t : text + " \u00b7 " + t; }
            if ((sig & 64) != 0) text = text == null ? "EXEC BLOCKED" : text + " \u00b7 EXEC BLOCKED";
            return text;
        }
        /// <summary>markPresentation.ts:2: mark plate pip colours for tiers 1..4.</summary>
        public static readonly uint[] TierColours = { 0x9e9e9eu, 0xffb300u, 0xe53935u, 0x171717u };
        /// <summary>Whether the mark windup telegraph is still live: <paramref name="ageMs"/> since the Windup fx, up to its <paramref name="ms"/>.</summary>
        public static bool WindupLive(float ageMs, float ms) { return ageMs >= 0f && ageMs < ms + 40f; }
        /// <summary>Progress 0..1 of a windup.</summary>
        public static float WindupProgress(float ageMs, float ms) { return ms <= 0f ? 1f : Math.Max(0f, Math.Min(1f, ageMs / ms)); }

        public enum ArenaLineTone : byte { None, Normal, Warn, Danger }
        /// <summary>hud.ts:15-18 fmtSeconds: ceil(ms / 1000) clamped at 0, "m:ss" (minutes unpadded).</summary>
        static string FmtSeconds(double ms)
        {
            int s = (int)Math.Max(0d, Math.Ceiling(ms / 1000d));
            return (s / 60).ToString(System.Globalization.CultureInfo.InvariantCulture) + ":" + (s % 60).ToString("00", System.Globalization.CultureInfo.InvariantCulture);
        }
        /// <summary>hud.ts:259-276 updateArena: locked with a sudden-death time counts to it; otherwise a gate-lock time counts to that; amber, red at sudden death; none without a deadline.</summary>
        public static string ArenaLine(double serverMs, double suddenDeathAt, bool locked, double? patienceEndsAt, out ArenaLineTone tone)
        {
            if (locked && suddenDeathAt > 0d)
            {
                if (serverMs >= suddenDeathAt) { tone = ArenaLineTone.Danger; return "Coliseum \u00b7 sudden death"; }
                tone = ArenaLineTone.Warn; return "Coliseum " + FmtSeconds(suddenDeathAt - serverMs);
            }
            if (patienceEndsAt.HasValue && patienceEndsAt.Value > 0d) { tone = ArenaLineTone.Warn; return "Coliseum " + FmtSeconds(patienceEndsAt.Value - serverMs); }
            tone = ArenaLineTone.None; return null;
        }

        /// <summary>
        /// The top-centre phase strip for <paramref name="phase"/>: hud.ts statusLine (lobby, planning) and the arena line (active).
        /// <paramref name="minPlayers"/> &lt;= 0 (not delivered to the client) drops the "/min" part of the lobby line.
        /// </summary>
        public static string PhaseLine(MatchPhase phase, double serverMs, ArenaView? arena, int playerCount, int minPlayers, out ArenaLineTone tone)
        {
            tone = ArenaLineTone.Normal;
            switch (phase)
            {
                case MatchPhase.Lobby:
                    if (!arena.HasValue) return "FORMING MATCH";
                    return "Waiting for players " + playerCount.ToString(System.Globalization.CultureInfo.InvariantCulture) + (minPlayers > 0 ? "/" + minPlayers.ToString(System.Globalization.CultureInfo.InvariantCulture) : "")
                        + " \u2014 run starts in " + FmtSeconds(arena.Value.LobbyEndsAt - serverMs);
                case MatchPhase.Planning:
                    return arena.HasValue && arena.Value.PlanEndsAt > 0d ? "Planning " + FmtSeconds(arena.Value.PlanEndsAt - serverMs) : "Planning";
                case MatchPhase.Active:
                    if (!arena.HasValue) { tone = ArenaLineTone.None; return null; }
                    return ArenaLine(serverMs, arena.Value.SuddenDeathAt, arena.Value.GatesLocked, arena.Value.PatienceEndsAt, out tone);
                default:
                    return "FORMING MATCH";
            }
        }

        /// <summary>
        /// P-UNITY-HUD-STATUS-1: as the overload above, plus the ended phase. <paramref name="winnerLabel"/> is the winner's display name
        /// ("[BOT] x" for a bot, see <see cref="DisplayName"/>) or null for a draw or an unknown winner.
        /// </summary>
        public static string PhaseLine(MatchPhase phase, double serverMs, ArenaView? arena, int playerCount, int minPlayers, string winnerLabel, out ArenaLineTone tone)
        {
            if (phase == MatchPhase.Ended)
            {
                tone = ArenaLineTone.Normal;
                return string.IsNullOrEmpty(winnerLabel) ? "Run over" : "Run over \u2014 " + winnerLabel + " is victorious";
            }
            return PhaseLine(phase, serverMs, arena, playerCount, minPlayers, out tone);
        }

        /// <summary>
        /// P-UNITY-HUD-STATUS-2: as the overload above, the room's minimum read from <see cref="ArenaView.MinPlayers"/> (legacy hud.ts:44, :193
        /// <c>state.minPlayers</c>; 0 = not delivered, which drops the "/min" part).
        /// </summary>
        public static string PhaseLine(MatchPhase phase, double serverMs, ArenaView? arena, int playerCount, string winnerLabel, out ArenaLineTone tone)
        {
            return PhaseLine(phase, serverMs, arena, playerCount, arena.HasValue ? arena.Value.MinPlayers : 0, winnerLabel, out tone);
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

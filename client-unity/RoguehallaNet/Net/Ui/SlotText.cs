namespace Roguehalla.Net.Ui
{
    /// <summary>
    /// P-UNITY-HUD-STATUS-1: the consumable and ability-slot texts of the legacy HUD (weaponBar.ts, abilitySlot.ts), as pure functions of
    /// delivered state and server time. STUB: every body returns an empty text until the packet lands.
    /// </summary>
    public static class SlotText
    {
        /// <summary>abilitySlot.ts:131 formatCooldown of a remaining time: "" when nothing remains; whole seconds (rounded up) under a minute; "m:ss" from 60.</summary>
        public static string Cooldown(double remainingMs) { return ""; }
        /// <summary>abilitySlot.ts:149 castDenial: "Ready in " + <see cref="Cooldown"/>; "" when nothing remains.</summary>
        public static string ReadyIn(double remainingMs) { return ""; }
        /// <summary>abilitySlot.ts:287-288: the charge count for an ability that stores more than one charge; "" otherwise.</summary>
        public static string ChargeBadge(int charges, int maxCharges) { return ""; }
        /// <summary>weaponBar.ts:145: "{large} large · {small} small"; with no inventory delivered "— large · — small".</summary>
        public static string PotionCounts(int large, int small, bool delivered) { return ""; }
        /// <summary>
        /// weaponBar.ts:147: "Healing" + " xN" when more than one + " Ns" while the end time is in the future. <paramref name="untilMs"/> null means the end time is
        /// not delivered: the count alone ("Healing", "Healing x2") shows while <paramref name="count"/> &gt; 0, as the Unity HUD does today.
        /// </summary>
        public static string HealingStatus(int count, double? untilMs, double serverMs) { return ""; }
        /// <summary>weaponBar.ts:146: "+50% speed" while the boost is live, otherwise "Walk over emblems".</summary>
        public static string SpeedLabel(double untilMs, double serverMs) { return ""; }
        /// <summary>weaponBar.ts:148: "Active Ns" (rounded up) while the boost is live, otherwise "".</summary>
        public static string SpeedStatus(double untilMs, double serverMs) { return ""; }
    }
}

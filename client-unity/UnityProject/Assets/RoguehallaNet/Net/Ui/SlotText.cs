namespace Roguehalla.Net.Ui
{
    /// <summary>
    /// P-UNITY-HUD-STATUS-1: the consumable and ability-slot texts of the legacy HUD (weaponBar.ts, abilitySlot.ts), as pure functions of
    /// delivered state and server time. STUB: every body returns an empty text until the packet lands.
    /// </summary>
    public static class SlotText
    {
        static string Int(int v) { return v.ToString(System.Globalization.CultureInfo.InvariantCulture); }

        /// <summary>abilitySlot.ts:131 formatCooldown of a remaining time: "" when nothing remains; whole seconds (rounded up) under a minute; "m:ss" from 60.</summary>
        public static string Cooldown(double remainingMs)
        {
            if (!(remainingMs > 0d)) return "";
            int s = (int)System.Math.Ceiling(remainingMs / 1000d);
            if (s < 60) return Int(s);
            int sec = s % 60;
            return Int(s / 60) + ":" + (sec < 10 ? "0" : "") + Int(sec);
        }
        /// <summary>abilitySlot.ts:149 castDenial: "Ready in " + <see cref="Cooldown"/>; "" when nothing remains.</summary>
        public static string ReadyIn(double remainingMs)
        {
            var c = Cooldown(remainingMs);
            return c.Length == 0 ? "" : "Ready in " + c;
        }
        /// <summary>abilitySlot.ts:287-288: the charge count for an ability that stores more than one charge; "" otherwise.</summary>
        public static string ChargeBadge(int charges, int maxCharges) { return maxCharges > 1 ? Int(charges) : ""; }
        /// <summary>weaponBar.ts:145: "{large} large · {small} small"; with no inventory delivered "— large · — small".</summary>
        public static string PotionCounts(int large, int small, bool delivered)
        {
            return delivered ? Int(large) + " large \u00b7 " + Int(small) + " small" : "\u2014 large \u00b7 \u2014 small";
        }
        /// <summary>
        /// weaponBar.ts:147: "Healing" + " xN" when more than one + " Ns" while the end time is in the future. <paramref name="untilMs"/> null means the end time is
        /// not delivered: the count alone ("Healing", "Healing x2") shows while <paramref name="count"/> &gt; 0, as the Unity HUD does today.
        /// </summary>
        public static string HealingStatus(int count, double? untilMs, double serverMs)
        {
            if (count <= 0) return "";
            var head = count > 1 ? "Healing x" + Int(count) : "Healing";
            if (!untilMs.HasValue) return head;
            if (!(untilMs.Value > serverMs)) return "";
            return head + " " + Int((int)System.Math.Ceiling((untilMs.Value - serverMs) / 1000d)) + "s";
        }
        /// <summary>weaponBar.ts:146: "+50% speed" while the boost is live, otherwise "Walk over emblems".</summary>
        public static string SpeedLabel(double untilMs, double serverMs) { return untilMs > serverMs ? "+50% speed" : "Walk over emblems"; }
        /// <summary>weaponBar.ts:148: "Active Ns" (rounded up) while the boost is live, otherwise "".</summary>
        public static string SpeedStatus(double untilMs, double serverMs)
        {
            return untilMs > serverMs ? "Active " + Int((int)System.Math.Ceiling((untilMs - serverMs) / 1000d)) + "s" : "";
        }
        /// <summary>
        /// P-UNITY-HUD-STATUS-2: the healing slot's status for the owner's inventory against the server clock (weaponBar.ts:147). With
        /// <see cref="InventoryView.HealingUntil"/> delivered: "Healing" + " xN" when N &gt; 1 + " Ns" (rounded up) while the end is after
        /// <paramref name="serverMs"/>, otherwise "". With no clock delivered: the count-only text of <see cref="HealingStatus"/>.
        /// </summary>
        public static string HealingSlot(InventoryView? inventory, double serverMs)
        {
            return inventory.HasValue ? HealingStatus(inventory.Value.PotionsHealing, inventory.Value.HealingUntil, serverMs) : "";
        }
        /// <summary>
        /// P-UNITY-HUD-STATUS-2: the wind-emblem slot's text (weaponBar.ts:146,148): "+50% speed · Active Ns" (rounded up) while
        /// <see cref="InventoryView.SpeedBoostUntil"/> is after <paramref name="serverMs"/>, otherwise "Walk over emblems".
        /// </summary>
        public static string WindEmblem(InventoryView? inventory, double serverMs)
        {
            if (inventory.HasValue && inventory.Value.SpeedBoostUntil.HasValue && inventory.Value.SpeedBoostUntil.Value > serverMs)
                return "+50% speed \u00b7 " + SpeedStatus(inventory.Value.SpeedBoostUntil.Value, serverMs);
            return "Walk over emblems";
        }
    }
}

using Roguehalla.Net;
using Roguehalla.Net.Ui;
using TMPro;
using UnityEngine;

namespace Roguehalla.Client
{
    public sealed partial class MatchHud
    {
        static readonly string[] StatNames = { "Offense", "Soul", "Defense", "Soul defense", "Health", "Attack speed", "Movement speed", "Life steal" };
        readonly HudIconHint[] _weaponHints = new HudIconHint[2];
        HudIconHint _wishHint, _potionHint, _pickupHint, _buildHint, _damageHint;
        TMP_Text _damageWeapon, _damageHit, _damageRate;
        RectTransform _trainingLauncher;

        void AlignTrainingLauncher()
        {
            if (_trainingConsole?.Root == null) return;
            if (_trainingLauncher == null) _trainingLauncher = _trainingConsole.Root.Find("ConsoleToggle") as RectTransform;
            if (_trainingLauncher == null) return;
            // The closed practice launcher sits just above the Quests launcher (legacy training bar: bottom-left, above nothing else).
            // Keep the expanded console's established layout and input hierarchy intact.
            float bottom = _trainingConsole.IsOpen ? 0f : .045f;
            if (Mathf.Approximately(_trainingLauncher.anchorMin.y, bottom)) return;
            _trainingLauncher.anchorMin = new Vector2(0f, bottom);
            _trainingLauncher.anchorMax = new Vector2(.32f, bottom + .10f);
        }

        void RefreshDamageReadout(SelfView me)
        {
            // The server-owned damage projection is a separate coordinator packet. Never reconstruct
            // combat mirrors, scaling, critical hits or weapon rules from build IDs in the client.
            Set(_damageWeapon, me == null ? "—" : me.Weapon.ToString());
            // The server delivers the owner's combat multipliers in milli (attack speed, windup, move speed); per-hit damage and the passive's
            // numbers are not delivered, so the panel shows only the multipliers and the strongest stats (docs/rework/LEGACY_INDICATORS.md, H3).
            bool mult = me != null && me.OwnerCombat.HasValue;
            if (_championValue[0] != null)
            {
                Set(_championValue[0], mult ? "Atk speed " + Roguehalla.Net.Ui.WorldIndicatorRules.Multiplier(me.OwnerCombat.Value.AsMilli) : "—");
                Set(_championScaling[0], mult ? "Windup " + Roguehalla.Net.Ui.WorldIndicatorRules.Multiplier(me.OwnerCombat.Value.WindupMilli) : "");
            }
            if (_championValue[1] != null)
            {
                Set(_championValue[1], mult ? "Move speed " + Roguehalla.Net.Ui.WorldIndicatorRules.Multiplier(me.OwnerCombat.Value.SpeedMilli) : "—");
                Set(_championScaling[1], TopStatsLine(me));
            }
            if (_championScaling[2] != null && me == null) { Set(_championValue[2], "—"); Set(_championScaling[2], ""); }
            if (_damageHint != null) _damageHint.Text = DamageUnavailable;
        }

        /// <summary>The delivered top two invested stats ("Strongest: Attack damage, Armor"), empty when none.</summary>
        static string TopStatsLine(SelfView me)
        {
            if (me == null || (!me.TopStat1.HasValue && !me.TopStat2.HasValue)) return "";
            string a = me.TopStat1.HasValue ? Roguehalla.Net.Ui.Indicators.StatLabel(me.TopStat1.Value) : null, b = me.TopStat2.HasValue ? Roguehalla.Net.Ui.Indicators.StatLabel(me.TopStat2.Value) : null;
            return "Strongest: " + (a != null && b != null ? a + ", " + b : a ?? b);
        }

        struct PotionKey { public bool Delivered; public int Large, Small, Healing; public bool Equals(PotionKey o) { return Delivered == o.Delivered && Large == o.Large && Small == o.Small && Healing == o.Healing; } }
        PotionKey _potionKey; bool _potionKeyValid;

        static string WishIconText(WishView? wish, double serverTimeMs)
        {
            if (!wish.HasValue) return "—";
            var w = wish.Value;
            var cool = SlotText.Cooldown(w.ReadyAt - serverTimeMs);
            return w.Charges + "/" + w.MaxCharges + (cool.Length > 0 ? " · " + cool : "");
        }

        void UpdateInventoryHints(InventoryView? inventory)
        {
            for (int i = 0; i < 2; i++)
            {
                var weapon = !inventory.HasValue ? null : i == 0 ? inventory.Value.Slot0 : inventory.Value.Slot1;
                Set(_slots[i].GetComponentInChildren<TMP_Text>(true), (i + 1).ToString());
                if (_slotNames[i] != null) Set(_slotNames[i], weapon.HasValue ? weapon.Value.ToString() : "Empty");
                if (_weaponHints[i] != null) _weaponHints[i].Text = (i + 1) + " · " + (weapon.HasValue ? weapon.ToString() : "Empty weapon slot") +
                    (inventory.HasValue && inventory.Value.ActiveSlot == i ? " · equipped" : "\nSelect weapon slot");
            }
            // Cache on the values shown: the texts rebuild only when delivery, a count or the healing count changes.
            var key = new PotionKey { Delivered = inventory.HasValue, Large = inventory.HasValue ? inventory.Value.PotionLarge : 0, Small = inventory.HasValue ? inventory.Value.PotionSmall : 0, Healing = inventory.HasValue ? inventory.Value.PotionsHealing : 0 };
            if (_potionKeyValid && key.Equals(_potionKey)) return;
            _potionKey = key; _potionKeyValid = _healText != null && _potionHint != null;
            if (_healText != null)
            {
                // Healing end time is not on the wire: count-only status (SlotText.HealingStatus with a null end).
                Set(_healText, SlotText.PotionCounts(key.Large, key.Small, key.Delivered));
                Set(_healStatus, SlotText.HealingStatus(key.Healing, null, 0d));
            }
            if (_potionHint != null) _potionHint.Text = key.Delivered ? "E · Drink potion\n" + key.Small + " small / " + key.Large + " camp / " + key.Healing + " healing" : "E · Drink potion\nAwaiting inventory";
        }
    }
}

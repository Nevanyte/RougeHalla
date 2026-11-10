using Roguehalla.Net;
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
            if (_championValue[0] != null) { Set(_championValue[0], "—"); Set(_championScaling[0], "not delivered"); }
            if (_championValue[1] != null) { Set(_championValue[1], "—"); Set(_championScaling[1], "not delivered"); }
            if (_championScaling[2] != null && me == null) { Set(_championValue[2], "—"); Set(_championScaling[2], ""); }
            if (_damageHint != null) _damageHint.Text = DamageUnavailable;
        }

        static string WishIconText(WishView? wish, double serverTimeMs)
        {
            if (!wish.HasValue) return "—";
            var w = wish.Value;
            return w.Charges + "/" + w.MaxCharges + " · " + FormatSeconds(w.ReadyAt - serverTimeMs);
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
            if (_healText != null)
            {
                Set(_healText, inventory.HasValue ? inventory.Value.PotionLarge + " large · " + inventory.Value.PotionSmall + " small" : "— large · — small");
                Set(_healStatus, inventory.HasValue && inventory.Value.PotionsHealing > 0 ? "Healing" + (inventory.Value.PotionsHealing > 1 ? " x" + inventory.Value.PotionsHealing : "") : "");
            }
            if (_potionHint != null) _potionHint.Text = inventory.HasValue ? "E · Drink potion\n" + inventory.Value.PotionSmall + " small / " + inventory.Value.PotionLarge + " camp / " + inventory.Value.PotionsHealing + " healing" : "E · Drink potion\nAwaiting inventory";
        }
    }
}

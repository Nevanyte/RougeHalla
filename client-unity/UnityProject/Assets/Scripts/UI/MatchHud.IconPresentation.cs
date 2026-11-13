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
            Set(_damageWeapon, me == null ? "—" : me.Weapon.ToString());
            ApplyChampionRows(me == null ? null : _session?.Collections?.Summary, me);
            if (_championScaling[2] != null && me == null) { Set(_championValue[2], "—"); Set(_championScaling[2], ""); }
        }

        // The panel is re-sent as often as every tick: rows are rebuilt only when a value they show changes.
        readonly Roguehalla.Net.Protocol.WirePanelValue[] _panelShown = new Roguehalla.Net.Protocol.WirePanelValue[Roguehalla.Net.Protocol.Hud.MaxPanelValues];
        int _panelShownCount = -1; Roguehalla.Net.Protocol.WireHudContent _panelHud; double? _panelAs;
        FactionId _panelFaction; WeaponId _panelWeapon;

        /// <summary>Draws the auto and passive rows from the owner's panel values (legacy championCombatModel). Before the first
        /// summary, or with no owner, the two rows are hidden (legacy hides the panel without data); no placeholder rows.</summary>
        void ApplyChampionRows(Roguehalla.Net.Protocol.WireBuildSummary summary, SelfView me)
        {
            var panel = summary?.Panel;
            bool has = me != null && panel != null && panel.Length > 0 && panel.Length <= _panelShown.Length;
            for (int r = 0; r < 2; r++)
                if (_championRow[r] != null && _championRow[r].gameObject.activeSelf != has) _championRow[r].gameObject.SetActive(has);
            if (!has)
            {
                _panelShownCount = -1;
                Set(_championValue[0], "—"); Set(_championScaling[0], ""); Set(_championValue[1], "—"); Set(_championScaling[1], "");
                if (_damageHint != null) _damageHint.Text = DamageUnavailable;
                return;
            }
            var block = HudContent; double? asMilli = me.OwnerCombat.HasValue ? me.OwnerCombat.Value.AsMilli : (double?)null;
            bool same = _panelShownCount == panel.Length && _panelFaction == me.Faction && _panelWeapon == me.Weapon && ReferenceEquals(_panelHud, block) && _panelAs == asMilli;
            for (int i = 0; same && i < panel.Length; i++)
                same = _panelShown[i].Code == panel[i].Code && _panelShown[i].Value == panel[i].Value;
            if (same) return;
            _panelShownCount = panel.Length; _panelFaction = me.Faction; _panelWeapon = me.Weapon; _panelHud = block; _panelAs = asMilli;
            for (int i = 0; i < panel.Length; i++) _panelShown[i] = panel[i];
            var rows = ChampionPanelText.Rows(summary, me.Faction, me.Weapon);
            Set(_championLabel[0], rows.Auto.Name); Set(_championLabel[1], rows.Passive.Name);
            Set(_championValue[0], rows.Auto.Value); Set(_championScaling[0], block != null ? HudContentText.AutoScaling(block, me.Weapon) : rows.Auto.Scaling);
            Set(_championValue[1], rows.Passive.Value); Set(_championScaling[1], rows.Passive.Scaling);
            if (_damageHint != null && block != null)
                _damageHint.Text = DamageUnavailable + "\n" + HudContentText.AutoTooltip(summary, block, me.Faction, me.Weapon, asMilli);
            else if (_damageHint != null)
                _damageHint.Text = DamageUnavailable + (rows.Auto.Detail.Length > 0 ? "\n" + rows.Auto.Detail : "") + (rows.Roam.Length > 0 ? "\n" + rows.Roam : "");
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
                if (_slotScaling[i] != null) Set(_slotScaling[i], weapon.HasValue ? HudContentText.SlotScaling(HudContent, weapon.Value) : "");
                string tip = weapon.HasValue ? HudContentText.SlotTip(HudContent, weapon.Value) : "";
                if (_weaponHints[i] != null) _weaponHints[i].Text = (i + 1) + " · " + (weapon.HasValue ? (tip.Contains("\n") ? tip : weapon.ToString()) : "Empty weapon slot") +
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

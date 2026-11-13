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

        struct PotionKey { public bool Delivered; public int Large, Small, Healing, HealSec, WindSec; public bool Equals(PotionKey o) { return Delivered == o.Delivered && Large == o.Large && Small == o.Small && Healing == o.Healing && HealSec == o.HealSec && WindSec == o.WindSec; } }
        /// <summary>The whole seconds shown for a delivered end time (rounded up, 0 once it has passed); -1 when no clock is delivered. The texts redraw when this changes.</summary>
        static int ShownSecond(double? until, double now) { return !until.HasValue ? -1 : until.Value > now ? (int)System.Math.Ceiling((until.Value - now) / 1000d) : 0; }
        PotionKey _potionKey; bool _potionKeyValid;

        static string WishIconText(WishView? wish, double serverTimeMs)
        {
            if (!wish.HasValue) return "—";
            var w = wish.Value;
            var cool = SlotText.Cooldown(w.ReadyAt - serverTimeMs);
            return w.Charges + "/" + w.MaxCharges + (cool.Length > 0 ? " · " + cool : "");
        }

        readonly bool[] _slotKeyValid = new bool[2], _slotEquipped = new bool[2];
        readonly Roguehalla.Net.Protocol.WireHudContent[] _slotBlock = new Roguehalla.Net.Protocol.WireHudContent[2];
        readonly WeaponId?[] _slotWeapon = new WeaponId?[2];

        void UpdateInventoryHints(InventoryView? inventory) { ApplyInventoryHints(inventory, _session != null ? _session.ServerTimeMs : 0d); }

        void ApplyInventoryHints(InventoryView? inventory, double now)
        {
            // A session with no snapshot yet (just after a reconnect) has no clock: ServerTimeMs reads 0, which would draw an old end time as a huge "Ns". No clock, no seconds.
            if (_session != null && _session.Latest == null && inventory.HasValue)
            {
                var bare = inventory.Value; bare.HealingUntil = null; bare.SpeedBoostUntil = null; inventory = bare;
            }
            for (int i = 0; i < 2; i++)
            {
                var weapon = !inventory.HasValue ? null : i == 0 ? inventory.Value.Slot0 : inventory.Value.Slot1;
                var block = HudContent;
                bool equipped = inventory.HasValue && inventory.Value.ActiveSlot == i;
                // Rebuilt only when the block, the weapon or the equipped flag changes (this runs every frame).
                if (_slotKeyValid[i] && ReferenceEquals(_slotBlock[i], block) && _slotWeapon[i] == weapon && _slotEquipped[i] == equipped) continue;
                _slotKeyValid[i] = true; _slotBlock[i] = block; _slotWeapon[i] = weapon; _slotEquipped[i] = equipped;
                Set(_slots[i].GetComponentInChildren<TMP_Text>(true), (i + 1).ToString());
                if (_slotNames[i] != null) Set(_slotNames[i], weapon.HasValue ? weapon.Value.ToString() : "Empty");
                string scaling = weapon.HasValue ? HudContentText.SlotScaling(block, weapon.Value) : "";
                if (_slotScaling[i] != null) Set(_slotScaling[i], scaling);
                string title = !weapon.HasValue ? "Empty weapon slot" : scaling.Length > 0 ? HudContentText.SlotTip(block, weapon.Value) : weapon.ToString();
                if (_weaponHints[i] != null) _weaponHints[i].Text = (i + 1) + " \u00b7 " + title + (equipped ? " \u00b7 equipped" : "\nSelect weapon slot");
            }
            // Cache on the values shown: the texts rebuild only when delivery, a count, the healing count or a shown second changes (the per-frame owner refresh re-runs this).
            var key = new PotionKey { Delivered = inventory.HasValue, Large = inventory.HasValue ? inventory.Value.PotionLarge : 0, Small = inventory.HasValue ? inventory.Value.PotionSmall : 0, Healing = inventory.HasValue ? inventory.Value.PotionsHealing : 0,
                HealSec = inventory.HasValue ? ShownSecond(inventory.Value.HealingUntil, now) : -1, WindSec = inventory.HasValue ? ShownSecond(inventory.Value.SpeedBoostUntil, now) : -1 };
            if (_potionKeyValid && key.Equals(_potionKey)) return;
            _potionKey = key; _potionKeyValid = _healText != null && _potionHint != null;
            if (_healText != null)
            {
                Set(_healText, SlotText.PotionCounts(key.Large, key.Small, key.Delivered));
                Set(_healStatus, SlotText.HealingSlot(inventory, now));
                if (_windText != null)
                {
                    Set(_windText, SlotText.WindEmblem(inventory, now));
                    var fit = _windText.GetComponent<MythicTextScale>();
                    if (fit != null) fit.Refit();   // the longer text is fitted when it changes (once a second), not left to the next LateUpdate
                }
            }
            if (_potionHint != null) _potionHint.Text = key.Delivered ? "E · Drink potion\n" + key.Small + " small / " + key.Large + " camp / " + key.Healing + " healing" : "E · Drink potion\nAwaiting inventory";
        }
    }
}

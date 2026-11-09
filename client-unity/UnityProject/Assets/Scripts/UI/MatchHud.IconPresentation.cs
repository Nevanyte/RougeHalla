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
            // The closed practice launcher otherwise occupies the new health panel. Keep the
            // expanded console's established layout and input hierarchy intact.
            float bottom = _trainingConsole.IsOpen ? 0f : .15f;
            if (Mathf.Approximately(_trainingLauncher.anchorMin.y, bottom)) return;
            _trainingLauncher.anchorMin = new Vector2(0f, bottom);
            _trainingLauncher.anchorMax = new Vector2(.32f, bottom + .10f);
        }

        void CreateHeaderIcons()
        {
            var glyphs = new[] { HudActionGlyph.Help, HudActionGlyph.Settings, HudActionGlyph.Leave };
            var hints = new[] { "H · Controls and field guide", "Settings · audio, text size and display", "Leave match / return to menu" };
            for (int i = 0; i < _headerActions.Length; i++)
            {
                var button = _headerActions[i];
                button.GetComponentInChildren<TMP_Text>().text = "";
                // Square controls leave the playfield clear while keeping the existing actions.
                var rect = (RectTransform)button.transform;
                rect.anchorMin = new Vector2(.86f + i * .043f, .93f);
                rect.anchorMax = new Vector2(.895f + i * .043f, .99f);
                HudActionGlyphs.Icon(button.transform, "ActionIcon", glyphs[i], 36);
                HudIconHint.Attach(button, _root, hints[i]);
            }
        }

        void CreateDamageReadout()
        {
            _damagePanel = Panel(_hud, "DamageOutputPanel", .015f, .018f, .285f, .138f);
            _damageWeapon = Text(_damagePanel, "DamageWeapon", "—", .10f, .68f, .96f, .98f, 14);
            SetBaseSize(_damageWeapon, 20);
            _damageWeapon.color = ShowcasePalette.Gold;
            var hitIcon = MythicUi.Icon(_damagePanel, "RawHitIcon", MythicGlyph.Sword, 30);
            hitIcon.rectTransform.anchorMin = hitIcon.rectTransform.anchorMax = new Vector2(.08f, .48f);
            _damageHit = Text(_damagePanel, "RawDamagePerHit", "— /hit", .16f, .31f, .96f, .66f, 14);
            SetBaseSize(_damageHit, 22);
            var rateIcon = MythicUi.Icon(_damagePanel, "AttackRateIcon", MythicGlyph.Speed, 30);
            rateIcon.rectTransform.anchorMin = rateIcon.rectTransform.anchorMax = new Vector2(.08f, .15f);
            _damageRate = Text(_damagePanel, "AttacksPerSecond", "— /s", .16f, .01f, .96f, .33f, 14);
            SetBaseSize(_damageRate, 22);
            var focus = _damagePanel.gameObject.AddComponent<UnityEngine.UI.Button>();
            focus.targetGraphic = _damagePanel.GetComponent<UnityEngine.UI.Image>();
            _damageHint = HudIconHint.Attach(focus, _root, DamageUnavailable);
        }

        const string DamageUnavailable = "Current weapon · raw damage per hit and attacks per second\nAwaiting authoritative combat readout.\nRaw values are before target mitigation; this is not measured DPS.";

        void RefreshDamageReadout(SelfView me)
        {
            // The server-owned damage projection is a separate coordinator packet. Never reconstruct
            // combat mirrors, scaling, critical hits or weapon rules from build IDs in the client.
            Set(_damageWeapon, me == null ? "—" : me.Weapon.ToString());
            Set(_damageHit, "— /hit"); Set(_damageRate, "— /s");
            if (_damageHint != null) _damageHint.Text = DamageUnavailable;
        }

        static string WishIconText(WishView? wish, double serverTimeMs)
        {
            if (!wish.HasValue) return "R · —";
            var w = wish.Value;
            return "R · " + w.Charges + "/" + w.MaxCharges + " · " + FormatSeconds(w.ReadyAt - serverTimeMs);
        }

        void UpdateInventoryHints(InventoryView? inventory)
        {
            for (int i = 0; i < 2; i++)
            {
                var weapon = !inventory.HasValue ? null : i == 0 ? inventory.Value.Slot0 : inventory.Value.Slot1;
                Set(_slots[i].GetComponentInChildren<TMP_Text>(true), (i + 1).ToString());
                if (_weaponHints[i] != null) _weaponHints[i].Text = (i + 1) + " · " + (weapon.HasValue ? weapon.ToString() : "Empty weapon slot") +
                    (inventory.HasValue && inventory.Value.ActiveSlot == i ? " · equipped" : "\nSelect weapon slot");
            }
            if (_potionIcon != null)
            {
                var label = _potionIcon.transform.parent.GetComponentInChildren<TMP_Text>(true);
                Set(label, inventory.HasValue ? "E · " + (inventory.Value.PotionSmall + inventory.Value.PotionLarge + inventory.Value.PotionsHealing) : "E · —");
            }
            if (_potionHint != null) _potionHint.Text = inventory.HasValue ? "E · Drink potion\n" + inventory.Value.PotionSmall + " small / " + inventory.Value.PotionLarge + " camp / " + inventory.Value.PotionsHealing + " healing" : "E · Drink potion\nAwaiting inventory";
            Set(_focusLabel, "");
        }
    }
}

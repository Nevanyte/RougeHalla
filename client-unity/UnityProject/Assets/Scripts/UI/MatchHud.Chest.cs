using System;
using System.Globalization;
using Roguehalla.Net;
using TMPro;
using UnityEngine;

namespace Roguehalla.Client
{
    /// <summary>
    /// The chest choice panel in the legacy arrangement (docs/rework/LEGACY_LAYOUT.md section 10, chestPanel.ts): a head with the title and
    /// a countdown (gold, red under 5 s) over a thin progress bar, three full-width cards (name and tier chip, kind line, text, state line),
    /// a Skip button with its key cap, and the keyboard hint. Only text and eligibility the server delivered are shown; nothing is computed.
    /// </summary>
    public sealed partial class MatchHud
    {
        const float ChestSeconds = 15f;     // legacy CHEST_SECONDS: only the bar's scale, the deadline itself is the server's
        const float UrgentSeconds = 5f;
        readonly TMP_Text[] _optKind = new TMP_Text[3], _optText = new TMP_Text[3], _optState = new TMP_Text[3], _optTier = new TMP_Text[3];
        readonly RectTransform[] _optChip = new RectTransform[3];
        TMP_Text _chestTimer, _chestHint;
        RectTransform _chestBarFill;
        UnityEngine.UI.Button _chestNext;
        UnityEngine.UI.Image _chestFocusRing;

        static readonly string[] BoostNames = { "Offense", "Soul Offence", "Defense", "Soul Defense", "Max health", "Attack speed", "Move speed", "Lifesteal" };

        void CreateChestPanel()
        {
            var theme = UiTheme.Current;
            _rewards = Panel(_stage, "Rewards", .70f, .425f, .985f, .915f);
            _rewardTitle = Text(_rewards, "RewardTitle", "", .045f, .925f, .66f, .995f, 20);
            SetBaseSize(_rewardTitle, 13f); _rewardTitle.color = ShowcasePalette.Gold;
            _chestTimer = Text(_rewards, "ChestTimer", "", .62f, .925f, .955f, .995f, 20);
            _chestTimer.alignment = TextAlignmentOptions.MidlineRight; _chestTimer.color = ShowcasePalette.Gold; SetBaseSize(_chestTimer, 13f);
            // The 3 px progress track under the head; the gold fill is the share of the chest's time left.
            var track = Rect(_rewards, "ChestBar", .045f, .905f, .955f, .915f);
            var trackImage = track.gameObject.AddComponent<UnityEngine.UI.Image>(); trackImage.color = theme.SurfaceSunken; trackImage.raycastTarget = false;
            _chestBarFill = Rect(track, "Fill", 0f, 0f, 1f, 1f);
            var fill = _chestBarFill.gameObject.AddComponent<UnityEngine.UI.Image>(); fill.color = theme.Accent; fill.raycastTarget = false;
            const float top = .885f, gap = .012f, height = .228f;
            for (int i = 0; i < 3; i++)
            {
                sbyte pick = (sbyte)i;
                float y1 = top - i * (height + gap), y0 = y1 - height;
                var option = Button(_rewards, "Option" + i, "", .045f, y0, .955f, y1, () => Choose(pick));
                _options[i] = option;
                var name = option.GetComponentInChildren<TMP_Text>();
                var nameRect = name.rectTransform; nameRect.anchorMin = new Vector2(.05f, .64f); nameRect.anchorMax = new Vector2(.78f, .97f);
                nameRect.offsetMin = nameRect.offsetMax = Vector2.zero;
                name.alignment = TextAlignmentOptions.MidlineLeft; name.fontStyle = FontStyles.Bold; SetBaseSize(name, 12f);
                _optChip[i] = Panel(option.transform, "TierChip", .80f, .70f, .955f, .94f);
                _optTier[i] = Text(_optChip[i], "Tier", "", 0f, 0f, 1f, 1f, 18);
                _optTier[i].alignment = TextAlignmentOptions.Center; _optTier[i].color = theme.Accent; SetBaseSize(_optTier[i], 9f);
                _optKind[i] = Text(option.transform, "Kind", "", .05f, .50f, .95f, .66f, 16);
                _optKind[i].color = ShowcasePalette.MutedText; SetBaseSize(_optKind[i], 8.5f); _optKind[i].characterSpacing = 1f;
                _optText[i] = Text(option.transform, "Text", "", .05f, .18f, .95f, .52f, 16);
                _optText[i].enableWordWrapping = true; _optText[i].alignment = TextAlignmentOptions.TopLeft; SetBaseSize(_optText[i], 10f);
                _optState[i] = Text(option.transform, "State", "", .05f, .02f, .95f, .19f, 16);
                _optState[i].color = theme.Warning; SetBaseSize(_optState[i], 9f);
            }
            float skipTop = top - 3 * (height + gap) + gap * .2f;
            _skip = Button(_rewards, "Skip", "Skip", .045f, skipTop - .085f, .955f, skipTop, () => Choose(-1));
            var skipLabel = _skip.GetComponentInChildren<TMP_Text>(); SetBaseSize(skipLabel, 11f);
            var cap = Panel(_skip.transform, "KeyCap", .04f, .22f, .13f, .78f);
            var capText = Text(cap, "Key", "0", 0f, 0f, 1f, 1f, 18); capText.alignment = TextAlignmentOptions.Center; SetBaseSize(capText, 10f);
            _chestHint = Text(_rewards, "ChestHint", "", .045f, .005f, .70f, skipTop - .09f, 14);
            _chestHint.enableWordWrapping = true; _chestHint.color = ShowcasePalette.MutedText; SetBaseSize(_chestHint, 8.5f);
            _chestNext = Button(_rewards, "Next", "Next chest", .70f, .012f, .955f, skipTop - .1f, () => { _chestIndex++; _dirty = _rewardsDirty = true; });
            SetBaseSize(_chestNext.GetComponentInChildren<TMP_Text>(), 8.5f);
            // Keyboard focus (C) is a gold ring round the panel (legacy: "focused = gold ring").
            var ring = Rect(_rewards, "FocusRing", 0f, 0f, 1f, 1f);
            _chestFocusRing = HudUi.Surface(ring, UiTheme.With(theme.Accent, 0f), theme.CornerRadius, theme.Accent, false, false);
            _chestFocusRing.gameObject.SetActive(false);
            foreach (var label in _rewards.GetComponentsInChildren<TMP_Text>(true)) { label.enableAutoSizing = true; label.fontSizeMin = label.fontSizeMax * .6f; }
        }

        /// <summary>Roman tier of a card title ("Offense II" -> "II"), or empty.</summary>
        internal static string TierOf(string title)
        {
            if (string.IsNullOrEmpty(title)) return "";
            int space = title.LastIndexOf(' ');
            string tail = space >= 0 ? title.Substring(space + 1) : "";
            return tail == "I" || tail == "II" || tail == "III" || tail == "IV" || tail == "V" ? tail : "";
        }

        static string BoostLabel(BoostId id) { int i = (int)id; return i >= 0 && i < BoostNames.Length ? BoostNames[i] : id.ToString(); }

        /// <summary>Per frame: the countdown and its bar follow the server's deadline (the part of the panel that is not cached by signature).</summary>
        void RefreshChestClock(RewardChestView chest)
        {
            if (_chestTimer == null) return;
            double left = Math.Max(0d, chest.ExpiresAt - _session.ServerTimeMs) / 1000d;
            bool active = !chest.Picked && _session.Latest != null && chest.ExpiresAt > 0;
            Set(_chestTimer, active ? Math.Ceiling(left).ToString("0", CultureInfo.InvariantCulture) + "s" : "");
            _chestTimer.color = left <= UrgentSeconds ? UiTheme.Current.Danger : ShowcasePalette.Gold;
            if (_chestBarFill != null)
            {
                float share = active ? Mathf.Clamp01((float)(left / ChestSeconds)) : 0f;
                _chestBarFill.anchorMax = new Vector2(share, 1f);
                _chestBarFill.GetComponent<UnityEngine.UI.Image>().color = left <= UrgentSeconds ? UiTheme.Current.Danger : UiTheme.Current.Accent;
            }
        }

        void FillChestCard(int i, RewardOptionView option, bool interactable)
        {
            if (_optKind[i] == null) return; // a fixture that builds only the name label
            string kind, text, tags = "";
            if (option.KillKey.HasValue) { kind = "TROPHY"; text = TrophyText.Description(option.KillKey.Value, option.KillGain); }
            else if (option.Card.HasValue)
            {
                var entry = CardDisplayCatalog.Get((byte)option.Card.Value);
                kind = "AUGMENT"; text = entry.Description; tags = entry.Tags;
            }
            else { kind = "BOOST"; text = "Permanent bonus for this run."; }
            Set(_optKind[i], string.IsNullOrEmpty(tags) ? kind : kind + "  ·  " + tags.ToUpperInvariant());
            Set(_optText[i], text);
            string title = option.Card.HasValue ? CardDisplayCatalog.Title((byte)option.Card.Value) : "";
            string tier = TierOf(title);
            _optChip[i].gameObject.SetActive(tier.Length > 0);
            Set(_optTier[i], tier);
            Set(_optState[i], option.Taken ? "Taken" : interactable ? "Press " + (i + 1) + " or click to take" : "");
            _optState[i].color = option.Taken ? UiTheme.Current.Success : UiTheme.Current.Warning;
        }

        void RefreshChestHint(bool several)
        {
            if (_chestHint != null) Set(_chestHint, _chestFocus ? "1 2 3 pick   0 skip   C or Esc back" : "Press C to use the keyboard");
            if (_chestNext != null) _chestNext.gameObject.SetActive(several);
            if (_chestFocusRing != null && _chestFocusRing.gameObject.activeSelf != _chestFocus) _chestFocusRing.gameObject.SetActive(_chestFocus);
        }
    }
}

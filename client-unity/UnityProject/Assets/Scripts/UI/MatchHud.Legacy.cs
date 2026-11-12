using System;
using System.Text;
using Roguehalla.Net;
using TMPro;
using UnityEngine;

namespace Roguehalla.Client
{
    /// <summary>
    /// The legacy-anchored in-match HUD (docs/rework/LEGACY_LAYOUT.md sections 2-8 and 12). Everything here is placed in HUD units on
    /// the stages (1 unit = 1 legacy CSS px) and reads its look from <see cref="UiTheme"/>. It shows only facts the server delivered.
    /// </summary>
    public sealed partial class MatchHud
    {
        // Legacy numbers (LEGACY_LAYOUT.md). Kept as constants so tests and layout share one source.
        internal const float ChromeButton = 30f, ChromeGap = 6f, ChromeTop = 10f, ChromeRight = 12f, ChromePerfGap = 8f;
        internal const float PlateLeft = 12f, PlateTop = 10f, PlateInner = 224f;
        internal const float BarBottom = 14f, SlotWidth = 104f, SlotHeight = 76f, SwapWidth = 28f, WishSize = 64f, BarGap = 6f, ConsumablesHeight = 28f;
        internal const float ChampionLeft = 12f, ChampionBottom = 48f, ChampionHeight = 126f;
        internal const float QuestLauncherLeft = 12f, QuestLauncherBottom = 12f;
        internal const float ToastBottom = 124f, BannerTop = 12f;

        HudViewport _viewport;
        // Plate.
        RectTransform _plateBody, _healthRow, _buildBox, _extrasBody;
        TMP_Text _plateStatus, _hpValue, _extrasLabel, _cardsText, _mobText;
        UnityEngine.UI.Image _hpTrough;
        UnityEngine.UI.Button _extrasToggle;
        readonly RectTransform[] _buildCells = new RectTransform[9];
        bool _extrasOpen, _plateActive;
        // Weapon bar.
        readonly TMP_Text[] _slotNames = new TMP_Text[2];
        readonly UnityEngine.UI.Image[] _slotSweeps = new UnityEngine.UI.Image[2];
        readonly CanvasGroup[] _slotGroups = new CanvasGroup[2];
        UnityEngine.UI.Button _swapChip, _potionButton, _windChip;
        RectTransform _weaponBar, _wishTile;
        UnityEngine.UI.Image _wishIcon;
        TMP_Text _wishSeconds, _wishCharges, _healText, _healStatus, _windText, _pickupText;
        UnityEngine.UI.Image _wishSweep, _wishCastBar, _wishGlow;
        readonly WishTileMotion _wishMotion = new WishTileMotion();
        float _attackCooldownTotal = 1f;
        // Champion combat HUD.
        RectTransform _championHud;
        TMP_Text _championName;
        UnityEngine.UI.Image _championIcon;
        readonly TMP_Text[] _championValue = new TMP_Text[3], _championScaling = new TMP_Text[3], _championLabel = new TMP_Text[3];
        readonly RectTransform[] _championRow = new RectTransform[3];
        bool _championWanted, _barWanted;
        // Death line, glows, chrome, top-centre and toast pills.
        TMP_Text _deathLine;
        EdgeThreatView _edgeThreats;
        RectTransform _metricsPill, _bannerPill, _phasePill, _noticePill;

        static Color Tone(Color32 color, float alpha) { return UiTheme.With(color, alpha); }
        static string Hex(Color32 c) { return "#" + c.r.ToString("X2") + c.g.ToString("X2") + c.b.ToString("X2"); }

        // ------------------------------------------------------------------ chrome (section 2)

        void CreateLegacyChrome()
        {
            var theme = UiTheme.Current;
            var glyphs = new[] { HudActionGlyph.Help, HudActionGlyph.Settings, HudActionGlyph.Fullscreen };
            var names = new[] { "Help", "Settings", "Fullscreen" };
            var hints = new[] { "H · Controls and field guide", "Settings · audio, text size and display", "Alt+Enter · Fullscreen" };
            UnityEngine.Events.UnityAction[] actions = { ToggleHelp, ToggleSettings, ToggleFullscreen };
            for (int i = 0; i < 3; i++)
            {
                float right = ChromeRight + i * (ChromeButton + ChromeGap);
                var button = HudUi.Button(_chromeStage, names[i], null, HudAnchor.TopRight, right, ChromeTop, ChromeButton, ChromeButton, actions[i]);
                _headerActions[i] = button;
                var icon = HudActionGlyphs.Icon(button.transform, "ActionIcon", glyphs[i], 16f);
                icon.color = theme.TextPrimary;
                HudIconHint.Attach(button, _root, hints[i]);
            }
            float perfRight = ChromeRight + 3 * ChromeButton + 2 * ChromeGap + ChromePerfGap;
            _metricsPill = HudUi.Box(_chromeStage, "PerformancePill", HudAnchor.TopRight, perfRight, ChromeTop + 3f, 124f, 24f);
            HudUi.Surface(_metricsPill, Tone(theme.SurfaceRaised, .85f), theme.CornerRadius, theme.Border, false);
            _metrics = HudUi.Label(_metricsPill, "PerformanceReadout", "", theme.SizeSmall, theme.TextSecondary, TextAlignmentOptions.MidlineRight);
            _metrics.rectTransform.offsetMin = new Vector2(8, 0); _metrics.rectTransform.offsetMax = new Vector2(-8, 0);
            _metricsPill.gameObject.SetActive(false);
        }

        void ToggleFullscreen() { Screen.fullScreen = !Screen.fullScreen; }

        // ------------------------------------------------------------------ top centre pills and toasts (section 8)

        void CreateTopAndToastPills()
        {
            var theme = UiTheme.Current;
            _bannerPill = HudUi.Box(_stage, "ConnectionBanner", HudAnchor.TopCenter, 0, BannerTop, 380, 28);
            HudUi.Surface(_bannerPill, Tone(theme.Surface, .96f), 14f, theme.BorderStrong, false, true);
            _banner = HudUi.Label(_bannerPill, "Connection", "Choose a faction and join", theme.SizeBody, theme.TextPrimary, TextAlignmentOptions.Center, true);
            _banner.rectTransform.offsetMin = new Vector2(12, 0); _banner.rectTransform.offsetMax = new Vector2(-12, 0);

            _phasePill = HudUi.Box(_stage, "PhaseTimerPill", HudAnchor.TopCenter, 0, BannerTop, 220, 26);
            HudUi.Surface(_phasePill, Tone(theme.Surface, .94f), theme.CornerRadius, theme.Border, false, true);
            _phaseStrip = HudUi.Label(_phasePill, "PhaseTimer", "", theme.SizeBody, theme.TextPrimary, TextAlignmentOptions.Center, true);
            _phasePill.gameObject.SetActive(false);

            _noticePill = HudUi.Box(_stage, "ToastStack", HudAnchor.BottomCenter, 0, ToastBottom, 480, 30);
            HudUi.Surface(_noticePill, Tone(theme.Surface, .97f), theme.CornerRadius, theme.BorderStrong, false, true);
            _notice = HudUi.Label(_noticePill, "Notice", "", theme.SizeBody, theme.Accent, TextAlignmentOptions.Center, true);
            _notice.rectTransform.offsetMin = new Vector2(14, 0); _notice.rectTransform.offsetMax = new Vector2(-14, 0);
            _noticePill.gameObject.SetActive(false);
        }

        /// <summary>Keeps the pills in step with their text: toasts only exist while they have text; the banner yields to nothing.</summary>
        void SyncTopCentre()
        {
            if (_noticePill != null)
            {
                bool toast = _worldHudVisible && !string.IsNullOrEmpty(_notice.text);
                if (_noticePill.gameObject.activeSelf != toast) _noticePill.gameObject.SetActive(toast);
            }
            if (_bannerPill == null) return;
            // Plain phase captions live on the plate (legacy hud-status); the pill is for connection state only.
            bool inMatch = _session != null && _session.State == SessionState.InMatch;
            bool showBanner = !_hud.gameObject.activeSelf ? false : !inMatch || (_client != null && _client.LaunchPending);
            if (_session != null && (_session.State == SessionState.Reconnecting || _session.State == SessionState.Rejected || _session.State == SessionState.Failed)) showBanner = true;
            // While the launch screen is up its own status line carries connection progress and failures.
            if (_menu != null && _menu.gameObject.activeSelf) showBanner = false;
            if (_bannerPill.gameObject.activeSelf != showBanner) _bannerPill.gameObject.SetActive(showBanner);
            bool phase = !showBanner && _hud.gameObject.activeSelf && _phaseStrip != null && !string.IsNullOrEmpty(_phaseStrip.text);
            if (_phasePill.gameObject.activeSelf != phase) _phasePill.gameObject.SetActive(phase);
        }

        // ------------------------------------------------------------------ HUD plate (sections 6 and 7)

        static readonly string[] CellNames = { "Offense", "SO", "Damage gained", "Attack speed", "Life steal", "Health gained", "Defense", "Soul Defense", "Move speed" };
        static readonly int[] CellBoost = { 0, 1, -1, 5, 7, 4, 2, 3, 6 };
        static readonly MythicGlyph[] CellGlyph = { MythicGlyph.Sword, MythicGlyph.Wish, MythicGlyph.Axe, MythicGlyph.Bow, MythicGlyph.Potion, MythicGlyph.Health, MythicGlyph.Armor, MythicGlyph.Shield, MythicGlyph.Speed };
        const float BuildCellWidth = 109f, BuildCellHeight = 14f, BuildRowStep = 17f, BuildColumnStep = 115f, BuildTop = 15f;

        void CreatePlate()
        {
            var theme = UiTheme.Current;
            _vitalsPanel = HudUi.Box(_hud, "VitalsPanel", HudAnchor.TopLeft, PlateLeft, PlateTop, 240f, 60f);
            HudUi.Surface(_vitalsPanel, Tone(theme.Surface, .94f), theme.CornerRadius, theme.Border, false, true);
            _plateBody = HudUi.Inset(_vitalsPanel, "PlateBody", 8, 5, 8, 6);

            // Not active: status line (600) and vitals line, plus the kills / GV line Unity already received.
            _plateStatus = HudUi.Label(HudUi.At(_plateBody, "StatusRow", 0, 0, PlateInner, 15), "HudStatus", "", theme.SizeSmall, theme.TextPrimary, bold: true);
            _vitals = HudUi.Label(HudUi.At(_plateBody, "VitalsRow", 0, 16, PlateInner, 15), "Vitals", "Waiting for player state", theme.SizeSmall, theme.TextSecondary);
            _combatStats = HudUi.Label(HudUi.At(_plateBody, "StatsRow", 0, 32, PlateInner, 15), "CombatStats", "Awaiting player stats", theme.SizeTiny, theme.TextSecondary);

            // Active: HP label, 8 px meter, value and bounty tag.
            _healthRow = HudUi.At(_plateBody, "HealthRow", 0, 0, PlateInner, 15);
            HudUi.Label(HudUi.At(_healthRow, "HpLabel", 0, 0, 16, 15), "Label", "HP", theme.SizeTiny, theme.TextSecondary, bold: true);
            var bar = HudUi.At(_healthRow, "OwnerVitalBar", 20, 3.5f, 76, 8);
            _hpTrough = HudUi.Surface(bar, Tone(theme.SurfaceSunken, 1f), 5f, theme.Border, false);
            var inner = HudUi.Inset(bar, "Meter", 1, 1, 1, 1);
            _healthBarFill = Rect(inner, "HealthFill", 0, 0, 0, 1);
            _healthBarFill.gameObject.AddComponent<UnityEngine.UI.Image>().color = theme.Success;
            _healthBarFill.GetComponent<UnityEngine.UI.Image>().raycastTarget = false;
            _barrierBarFill = Rect(inner, "BarrierFill", 0, 0, 0, 1);
            _barrierBarFill.gameObject.AddComponent<UnityEngine.UI.Image>().color = theme.Info;
            _barrierBarFill.GetComponent<UnityEngine.UI.Image>().raycastTarget = false;
            _hpValue = HudUi.Label(HudUi.At(_healthRow, "HpValue", 102, 0, 122, 15), "Value", "", theme.SizeSmall, theme.TextPrimary, bold: true);
            _hpValue.richText = true;

            CreateBuildHud(theme);
            CreateExtras(theme);
            CreateDamageReadout();
            SetPlateMode(false);
        }

        void CreateBuildHud(UiTheme theme)
        {
            // Legacy "Gained" strip: label + nine fixed cells, left rule in the stat colour, 13 px icon, name left, value right.
            _buildStrip = HudUi.At(_plateBody, "BuildStrip", 0, 18, PlateInner, BuildTop + 5 * BuildRowStep);
            _buildBox = _buildStrip;
            HudUi.Label(HudUi.At(_buildStrip, "GainedLabel", 0, 0, PlateInner, 12), "Label", "GAINED", theme.SizeTiny, theme.TextSecondary).characterSpacing = 3f;
            for (int i = 0; i < 9; i++)
            {
                int boost = CellBoost[i];
                float x = (i % 2) * BuildColumnStep, y = BuildTop + (i / 2) * BuildRowStep;
                var cell = HudUi.At(_buildStrip, "Build" + CellNames[i].Replace(" ", ""), x, y, BuildCellWidth, BuildCellHeight);
                _buildCells[i] = cell;
                HudUi.Surface(cell, Tone(theme.SurfaceSunken, .8f), theme.CornerRadiusSmall, null, true);
                Color32 stat = boost >= 0 ? theme.StatColor(boost) : theme.Danger;
                var rule = HudUi.Box(cell, "Rule", HudAnchor.TopLeft, 0, 0, 3, BuildCellHeight);
                rule.gameObject.AddComponent<UnityEngine.UI.Image>().color = stat;
                rule.GetComponent<UnityEngine.UI.Image>().raycastTarget = false;
                var icon = MythicUi.Icon(cell, "StatIcon", CellGlyph[i], 13f);
                icon.rectTransform.anchorMin = icon.rectTransform.anchorMax = new Vector2(0, .5f);
                icon.rectTransform.pivot = new Vector2(0, .5f); icon.rectTransform.anchoredPosition = new Vector2(7, 0);
                icon.color = stat;
                var name = HudUi.Label(HudUi.At(cell, "Name", 23, 0, 58, BuildCellHeight), "Label", CellNames[i], theme.SizeTiny, theme.TextSecondary);
                name.enableAutoSizing = true; name.fontSizeMin = 8f; name.fontSizeMax = theme.SizeTiny;
                var value = HudUi.Label(HudUi.At(cell, "Value", 80, 0, 26, BuildCellHeight), "Count", "—", theme.SizeTiny, theme.TextPrimary, TextAlignmentOptions.MidlineRight, true);
                _gainValues[i] = value;
                var select = cell.gameObject.AddComponent<UnityEngine.UI.Button>();
                select.targetGraphic = cell.GetComponent<UnityEngine.UI.Image>();
                HudUi.ApplyColors(select, Color.white);
                HudIconHint.Attach(select, _root, CellNames[i] + " · gained from boosts, cards and farmed mobs\nOpen B for the full build ledger.");
            }
        }

        void CreateExtras(UiTheme theme)
        {
            float y = 18 + BuildTop + 5 * BuildRowStep + 3;
            _extrasToggle = HudUi.Button(_plateBody, "BuildDetails", null, HudAnchor.TopLeft, 0, y, PlateInner, 14, ToggleExtras, radius: 3f);
            _extrasToggle.GetComponent<UnityEngine.UI.Image>().enabled = false;
            _extrasToggle.GetComponent<RectTransform>().Find("Frame").gameObject.SetActive(false);
            _extrasLabel = HudUi.Label(_extrasToggle.transform, "Label", "Cards & mob bonuses", theme.SizeTiny, theme.TextSecondary);
            _build = _extrasLabel;
            _buildHint = HudIconHint.Attach(_extrasToggle, _root, "B · Full build details\nClick to show cards and mob bonuses");
            _extrasBody = HudUi.At(_plateBody, "ExtrasBody", 0, y + 16, PlateInner, 62);
            _cardsText = HudUi.Label(HudUi.At(_extrasBody, "Cards", 0, 0, PlateInner, 40), "Label", "Cards: none", theme.SizeSmall, theme.TextPrimary, TextAlignmentOptions.TopLeft, wrap: true);
            _mobText = HudUi.Label(HudUi.At(_extrasBody, "MobBonuses", 0, 42, PlateInner, 18), "Label", "", theme.SizeSmall, theme.TextSecondary, TextAlignmentOptions.TopLeft, wrap: true);
            _mobText.gameObject.SetActive(false); // hidden until a summary arrives
            _extrasBody.gameObject.SetActive(false);
        }

        void RefreshCardsRow(CollectionsView view)
        {
            if (_cardsText == null) return;
            var cards = new StringBuilder();
            for (int i = 0; i < view.Cards.Count; i++)
                if (view.Cards[i] > 0) cards.Append(cards.Length > 0 ? " · " : "").Append(CardDisplayCatalog.Title((byte)i)).Append(" ×").Append(view.Cards[i]);
            Set(_cardsText, cards.Length > 0 ? "Cards: " + cards : view.HasBuild ? "Cards: none" : "Cards: awaiting server");
            // The mob-bonus row is drawn from the build summary in ApplyBuildSummary.
        }

        void ToggleExtras()
        {
            _extrasOpen = !_extrasOpen;
            _extrasBody.gameObject.SetActive(_extrasOpen);
            SetPlateMode(_plateActive);
        }

        /// <summary>Active: health row, build strip and extras. Otherwise: status, vitals and kills lines (legacy hud-status / hud-vitals).</summary>
        void SetPlateMode(bool active)
        {
            _plateActive = active;
            if (_healthRow == null) return;
            _healthRow.gameObject.SetActive(active); _buildBox.gameObject.SetActive(active && _gainsShown); _extrasToggle.gameObject.SetActive(active);
            _extrasBody.gameObject.SetActive(active && _extrasOpen);
            _plateStatus.gameObject.SetActive(!active); _vitals.gameObject.SetActive(!active); _combatStats.gameObject.SetActive(!active);
            float height = active ? 5 + 18 + BuildTop + 5 * BuildRowStep + 3 + 14 + (_extrasOpen ? 66 : 0) + 8 : 5 + 48 + 6;
            _vitalsPanel.sizeDelta = new Vector2(_vitalsPanel.sizeDelta.x, height);
        }

        // ------------------------------------------------------------------ champion combat HUD (section 5)

        void CreateDamageReadout()
        {
            var theme = UiTheme.Current;
            _championHud = _damagePanel = HudUi.Box(_hud, "ChampionCombatHud", HudAnchor.BottomLeft, ChampionLeft, ChampionBottom, 250f, ChampionHeight);
            HudUi.Surface(_championHud, Tone(theme.Surface, .94f), 7f, theme.Border, true, true);
            _championIcon = LaunchUi.FactionShape(_championHud, "FactionIcon", 4, 8f, 7f, 14f, theme.TextPrimary);
            _championName = HudUi.Label(HudUi.At(_championHud, "Head", 26, 6, 130, 16), "Champion", "Champion", 12f, theme.TextPrimary, bold: true);
            _damageWeapon = HudUi.Label(HudUi.At(_championHud, "Weapon", 150, 8, 92, 14), "Weapon", "—", theme.SizeTiny, theme.Accent, TextAlignmentOptions.MidlineRight);
            string[] labels = { "Attack", "Passive", "Wish" };
            for (int i = 0; i < 3; i++)
            {
                var row = HudUi.At(_championHud, "Row" + labels[i], 8, 28 + i * 32, 234, 30);
                row.gameObject.AddComponent<UnityEngine.UI.Image>().color = Tone(theme.SurfaceSunken, .7f);
                row.GetComponent<UnityEngine.UI.Image>().raycastTarget = false;
                var rule = HudUi.Box(row, "Rule", HudAnchor.TopLeft, 0, 0, 2, 30);
                rule.gameObject.AddComponent<UnityEngine.UI.Image>().color = theme.AccentDim; rule.GetComponent<UnityEngine.UI.Image>().raycastTarget = false;
                _championRow[i] = row;
                _championLabel[i] = HudUi.Label(HudUi.At(row, "Name", 6, 2, 100, 14), "Label", labels[i], theme.SizeTiny, theme.TextSecondary, bold: true);
                _championValue[i] = HudUi.Label(HudUi.At(row, "Value", 108, 1, 124, 15), "Value", "—", 12f, theme.TextPrimary, bold: true);
                _championScaling[i] = HudUi.Label(HudUi.At(row, "Scaling", 6, 17, 224, 11), "Scaling", "", theme.SizeMicro, theme.TextSecondary);
            }
            _damageHit = _championValue[0]; _damageRate = _championScaling[0];
            var focus = _championHud.gameObject.AddComponent<UnityEngine.UI.Button>();
            focus.targetGraphic = _championHud.GetComponent<UnityEngine.UI.Image>();
            HudUi.ApplyColors(focus, Color.white);
            _damageHint = HudIconHint.Attach(focus, _root, DamageUnavailable);
        }

        const string DamageUnavailable = "Combat overview\nRaw values are before target mitigation; this is not measured DPS.";

        // ------------------------------------------------------------------ weapon bar (section 4)

        Rect2 RowSlot(int index)
        {
            // Row: slot 1, swap chip, slot 2, Wish tile; 6 apart.
            switch (index)
            {
                case 0: return new Rect2(0f, SlotWidth);
                case 1: return new Rect2(SlotWidth + BarGap, SwapWidth);
                case 2: return new Rect2(SlotWidth + BarGap + SwapWidth + BarGap, SlotWidth);
                default: return new Rect2(2 * SlotWidth + SwapWidth + 3 * BarGap, WishSize);
            }
        }

        struct Rect2 { public float X, W; public Rect2(float x, float w) { X = x; W = w; } }

        internal static float WeaponBarWidth { get { return 2 * SlotWidth + SwapWidth + WishSize + 3 * BarGap; } }

        void CreateWeaponBar()
        {
            var theme = UiTheme.Current;
            float rowBottom = BarGap + ConsumablesHeight;
            _weaponBar = _combatActions = HudUi.Box(_hud, "CombatActions", HudAnchor.BottomCenter, 0, BarBottom, WeaponBarWidth, rowBottom + SlotHeight);

            // Slots.
            for (int i = 0; i < 2; i++)
            {
                byte slot = (byte)i;
                var rect = HudUi.Box(_weaponBar, "Slot" + (i + 1), HudAnchor.BottomLeft, RowSlot(i * 2).X, rowBottom, SlotWidth, SlotHeight);
                var image = HudUi.Surface(rect, Color.white, theme.CornerRadius, theme.Border, true, true);
                var button = _slots[i] = rect.gameObject.AddComponent<UnityEngine.UI.Button>();
                button.targetGraphic = image; button.onClick.AddListener(() => Swap(slot));
                HudUi.ApplyColors(button, theme.SurfaceRaised);
                _slotGroups[i] = rect.gameObject.AddComponent<CanvasGroup>();
                HudUi.Label(HudUi.At(rect, "Key", 5, 4, 20, 12), "Label", (i + 1).ToString(), theme.SizeTiny, theme.TextSecondary);
                _weaponIcons[i] = MythicUi.Icon(rect, "WeaponIcon", MythicGlyph.Sword, 26f);
                _weaponIcons[i].rectTransform.anchorMin = _weaponIcons[i].rectTransform.anchorMax = new Vector2(.5f, 1f);
                _weaponIcons[i].rectTransform.pivot = new Vector2(.5f, 1f); _weaponIcons[i].rectTransform.anchoredPosition = new Vector2(0, -12);
                _slotNames[i] = HudUi.Label(HudUi.At(rect, "Name", 4, 42, SlotWidth - 8, 14), "Label", "Empty", theme.SizeSmall, theme.TextPrimary, TextAlignmentOptions.Center);
                HudUi.Label(HudUi.At(rect, "Scaling", 4, 59, SlotWidth - 8, 11), "Label", "", theme.SizeMicro, theme.TextSecondary, TextAlignmentOptions.Center);
                var sweep = HudUi.Fill(rect, "CooldownSweep", Tone(theme.OutlineDark, .62f));
                sweep.rectTransform.offsetMin = new Vector2(1f, 1f); sweep.rectTransform.offsetMax = new Vector2(-1f, -1f);
                sweep.sprite = UiSprites.Flat(); sweep.type = UnityEngine.UI.Image.Type.Filled;
                sweep.fillMethod = UnityEngine.UI.Image.FillMethod.Radial360; sweep.fillOrigin = 2; sweep.fillClockwise = false; sweep.fillAmount = 0f;
                _slotSweeps[i] = sweep; sweep.enabled = false;
                var active = HudUi.Fill(rect, "ActiveWeapon", theme.BorderStrong);
                active.sprite = UiSprites.Frame(theme, theme.CornerRadius); active.type = UnityEngine.UI.Image.Type.Sliced;
                _weaponActiveBars[i] = active; active.enabled = false;
                _weaponHints[i] = HudIconHint.Attach(button, _root, (i + 1) + " · Empty weapon slot");
            }

            // Q swap chip between the slots.
            var chip = HudUi.Box(_weaponBar, "QSwap", HudAnchor.BottomLeft, RowSlot(1).X, rowBottom + (SlotHeight - 40f) / 2f, SwapWidth, 40f);
            var chipImage = HudUi.Surface(chip, Color.white, theme.CornerRadius, theme.Border, true, true);
            _swapChip = chip.gameObject.AddComponent<UnityEngine.UI.Button>(); _swapChip.targetGraphic = chipImage;
            HudUi.ApplyColors(_swapChip, theme.SurfaceRaised);
            _swapChip.onClick.AddListener(() => { if (_inventoryShown.HasValue) Swap((byte)(_inventoryShown.Value.ActiveSlot == 0 ? 1 : 0)); });
            HudUi.Label(HudUi.At(chip, "Key", 0, 6, SwapWidth, 14), "Label", "Q", theme.SizeSmall, theme.TextPrimary, TextAlignmentOptions.Center, true);
            HudUi.Label(HudUi.At(chip, "Caption", 0, 23, SwapWidth, 11), "Label", "SWAP", 7f, theme.TextSecondary, TextAlignmentOptions.Center);
            HudIconHint.Attach(_swapChip, _root, "Q · Swap weapons");

            CreateWishTile(theme, rowBottom);
            CreateConsumables(theme);
            CreatePickupHint(theme, rowBottom + SlotHeight + BarGap);
            var controls = HudUi.Label(HudUi.Box(_weaponBar, "ControlsLine", HudAnchor.BottomCenter, 0, -14f, 240, 13), "Label", "WASD move · Click attack · R Wish", theme.SizeTiny, theme.TextSecondary, TextAlignmentOptions.Center);
            controls.raycastTarget = false;
        }

        void CreateWishTile(UiTheme theme, float rowBottom)
        {
            _wishTile = HudUi.Box(_weaponBar, "WishTile", HudAnchor.BottomLeft, RowSlot(3).X, rowBottom + (SlotHeight - WishSize) / 2f, WishSize, WishSize);
            var image = HudUi.Surface(_wishTile, Color.white, theme.CornerRadius, theme.Border, true, true);
            var wishInfo = _wishTile.gameObject.AddComponent<UnityEngine.UI.Button>(); wishInfo.targetGraphic = image;
            HudUi.ApplyColors(wishInfo, theme.SurfaceRaised);
            HudUi.Label(HudUi.At(_wishTile, "Key", 5, 4, 14, 12), "Label", "R", theme.SizeTiny, theme.TextSecondary);
            var icon = _wishIcon = MythicUi.Icon(_wishTile, "WishIcon", MythicGlyph.Wish, 24f);
            icon.rectTransform.anchorMin = icon.rectTransform.anchorMax = new Vector2(.5f, 1f);
            icon.rectTransform.pivot = new Vector2(.5f, 1f); icon.rectTransform.anchoredPosition = new Vector2(0, -6);
            _wishSeconds = HudUi.Label(HudUi.At(_wishTile, "Seconds", 0, 6, WishSize, 24), "Label", "", 15f, theme.TextPrimary, TextAlignmentOptions.Center, true);
            _wishSummary = HudUi.Label(HudUi.At(_wishTile, "Name", 2, 36, WishSize - 4, 12), "Label", "—", theme.SizeTiny, theme.TextPrimary, TextAlignmentOptions.Center);
            _wishCharges = HudUi.Label(HudUi.At(_wishTile, "Charges", WishSize - 22, WishSize - 20, 20, 14), "Label", "", theme.SizeSmall, theme.Accent, TextAlignmentOptions.Center, true);
            _wishSweep = HudUi.Fill(_wishTile, "CooldownSweep", Tone(theme.OutlineDark, .62f));
            _wishSweep.rectTransform.offsetMin = new Vector2(1f, 1f); _wishSweep.rectTransform.offsetMax = new Vector2(-1f, -1f);
            _wishSweep.sprite = UiSprites.Flat(); _wishSweep.type = UnityEngine.UI.Image.Type.Filled;
            _wishSweep.fillMethod = UnityEngine.UI.Image.FillMethod.Radial360; _wishSweep.fillOrigin = 2; _wishSweep.fillClockwise = false; _wishSweep.fillAmount = 0f; _wishSweep.enabled = false;
            var cast = HudUi.Box(_wishTile, "CastBar", HudAnchor.BottomLeft, 0, 0, WishSize, 3);
            _wishCastBar = cast.gameObject.AddComponent<UnityEngine.UI.Image>(); _wishCastBar.color = theme.Accent; _wishCastBar.raycastTarget = false;
            _wishCastBar.type = UnityEngine.UI.Image.Type.Filled; _wishCastBar.fillMethod = UnityEngine.UI.Image.FillMethod.Horizontal; _wishCastBar.fillAmount = 0f; _wishCastBar.enabled = false;
            // Cast / ready feedback: a faction-tinted wash over the tile, behind its text (driven by TickWishTileMotion).
            _wishGlow = HudUi.Fill(_wishTile, "WishGlow", new Color(1f, 1f, 1f, 0f));
            _wishGlow.rectTransform.offsetMin = new Vector2(1f, 1f); _wishGlow.rectTransform.offsetMax = new Vector2(-1f, -1f);
            _wishGlow.transform.SetSiblingIndex(Mathf.Min(1, _wishTile.childCount - 1)); _wishGlow.enabled = false;
            _wishSummary.text = "—";
            _wishHint = HudIconHint.Attach(wishInfo, _root, "R · Wish\nAwaiting server");
            // Retain the existing formatted detail model for tests/readers, without a permanent world overlay.
            _wishDetails = Panel(_hud, "WishPanel", .775f, .70f, .985f, .915f);
            _wishCard = Text(_wishDetails, "WishCard", "R · WISH\nAwaiting server", .04f, .04f, .96f, .96f, 14);
            _wishCard.color = ShowcasePalette.Gold;
            _wishDetails.gameObject.SetActive(false);
        }

        void CreateConsumables(UiTheme theme)
        {
            var row = HudUi.Box(_weaponBar, "Consumables", HudAnchor.BottomCenter, 0, 0, 352f, ConsumablesHeight);
            // Heal chip: [E] Heal  N large - M small  Healing xN.
            _potionButton = HudUi.Button(row, "Potion", null, HudAnchor.BottomLeft, 0, 0, 200f, ConsumablesHeight, UsePotion, radius: 5f);
            var heal = _potionButton.transform;
            _potionIcon = MythicUi.Icon(heal, "PotionIcon", MythicGlyph.Potion, 14f);
            _potionIcon.rectTransform.anchorMin = _potionIcon.rectTransform.anchorMax = new Vector2(0, .5f);
            _potionIcon.rectTransform.pivot = new Vector2(0, .5f); _potionIcon.rectTransform.anchoredPosition = new Vector2(8, 0);
            HudUi.Label(HudUi.At(heal, "Key", 26, 8, 12, 12), "Label", "E", theme.SizeTiny, theme.TextSecondary);
            HudUi.Label(HudUi.At(heal, "Name", 42, 7, 28, 14), "Label", "Heal", theme.SizeSmall, theme.Success, bold: true);
            _healText = HudUi.Label(HudUi.At(heal, "Count", 72, 7, 76, 14), "Label", "— large · — small", theme.SizeSmall, theme.TextPrimary);
            _healStatus = HudUi.Label(HudUi.At(heal, "Status", 150, 7, 48, 14), "Label", "", theme.SizeSmall, theme.Accent);
            foreach (var fit in new[] { _healText, _healStatus }) { fit.enableAutoSizing = true; fit.fontSizeMin = 8f; fit.fontSizeMax = theme.SizeSmall; }
            _potionHint = HudIconHint.Attach(_potionButton, _root, "E · Drink potion\nAwaiting inventory");
            // Wind chip: delivered facts do not include the boost timer, so it only names the emblem.
            var wind = HudUi.Box(row, "Wind", HudAnchor.BottomRight, 0, 0, 146f, ConsumablesHeight);
            HudUi.Surface(wind, Tone(theme.SurfaceRaised, .94f), 5f, theme.Border, false, true);
            HudUi.Label(HudUi.At(wind, "Name", 8, 7, 30, 14), "Label", "Wind", theme.SizeSmall, theme.Info, bold: true);
            _windText = HudUi.Label(HudUi.At(wind, "Text", 42, 7, 100, 14), "Label", "Walk over emblems", theme.SizeSmall, theme.TextPrimary);
        }

        void CreatePickupHint(UiTheme theme, float bottom)
        {
            _pickup = HudUi.Button(_weaponBar, "Pickup", "F", HudAnchor.BottomCenter, 0, bottom, 230f, 22f, () => _client.PickupFocus(), theme.SizeTiny, 6f);
            var rect = (RectTransform)_pickup.transform;
            HudUi.SetFrame(rect, theme.BorderStrong);
            // One label carries the F key and the action ("F  take Sword"); it reads just "F" while nothing is in reach.
            _pickupText = _pickup.GetComponentInChildren<TMP_Text>(true);
            _pickupText.alignment = TextAlignmentOptions.MidlineLeft; _pickupText.color = theme.Accent; _pickupText.fontStyle = FontStyles.Bold;
            _pickupText.fontSize = theme.SizeSmall;
            _pickupText.rectTransform.offsetMin = new Vector2(10, 0); _pickupText.rectTransform.offsetMax = new Vector2(-26, 0);
            var icon = HudActionGlyphs.Icon(rect, "PickupIcon", HudActionGlyph.Pickup, 12f);
            icon.rectTransform.anchorMin = icon.rectTransform.anchorMax = new Vector2(1, .5f); icon.rectTransform.anchoredPosition = new Vector2(-12, 0);
            icon.color = theme.Accent;
            _pickupHint = HudIconHint.Attach(_pickup, _root, "F · Pick up\nNo pickup in range");
            _pickup.gameObject.SetActive(false);
        }

        // ------------------------------------------------------------------ death line (section 8)

        void CreateDeathLine()
        {
            var theme = UiTheme.Current;
            var box = HudUi.Box(_hud, "DeathLine", HudAnchor.Center, 0, 0, 380f, 64f);
            // An opaque dark plate: red letters over bright sand or snow read as pale pink without one (marker contrast, 4.5:1 on any ground).
            HudUi.Surface(box, UiTheme.With(theme.OutlineDark, .9f), 10f, theme.Danger, false, false);
            _deathLine = HudUi.Label(box, "Label", "YOU DIED", theme.SizeDisplay, theme.Danger, TextAlignmentOptions.Center, true, UiFontRole.Display);
            _deathLine.characterSpacing = 6f;
            _deathLine.outlineWidth = .22f; _deathLine.outlineColor = theme.OutlineDark; // legible over any ground
            box.gameObject.SetActive(false);
        }

        // ------------------------------------------------------------------ stubs that need data the client does not receive

        // Edge-threat glows toward visible enemies are fed by MatchHud.EdgeThreats.cs (the vision radius is delivered, WireVision.Radius).

        // ------------------------------------------------------------------ per-frame presentation

        void RefreshLegacyHud(SelfView me, double serverTimeMs)
        {
            var theme = UiTheme.Current;
            bool alive = me != null && me.Status == ActorStatus.Alive;
            bool practice = _client != null && _client.ConfirmedPractice;
            bool active = alive && _session != null && _session.Phase == MatchPhase.Active && !practice;
            if (active != _plateActive) SetPlateMode(active);
            _barWanted = alive;
            _championWanted = _session != null && Roguehalla.Net.Ui.ChampionPanelText.Visible(alive, _session.Phase == MatchPhase.Active, practice);
            if (_deathLine != null)
            {
                bool dead = me != null && me.Status == ActorStatus.Dead && _session != null && !_results.gameObject.activeSelf && !practice;
                var box = _deathLine.transform.parent.gameObject;
                if (box.activeSelf != dead) box.SetActive(dead);
            }
            if (me == null) { RefreshHudElementVisibility(); return; }

            // Health row value, tone and bounty tag.
            float hp = me.Hp > 0 ? me.Hp : 0f, max = me.MaxHp > 0 ? me.MaxHp : 0f;
            var fill = _healthBarFill != null ? _healthBarFill.GetComponent<UnityEngine.UI.Image>() : null;
            if (fill != null)
            {
                float share = max > 0 ? hp / max : 1f;
                fill.color = share <= .18f ? theme.Danger : share <= .35f ? theme.Warning : theme.Success;
            }
            if (_hpValue != null)
            {
                var value = new StringBuilder().Append(hp.ToString("0")).Append('/').Append(max.ToString("0"));
                if (me.Barrier > 0) value.Append(" +").Append(me.Barrier.ToString("0"));
                if (me.Bounty > 0) value.Append(" <color=").Append(Hex(theme.Accent)).Append("> · Bounty ").Append(me.Bounty).Append("</color>");
                Set(_hpValue, value.ToString());
            }
            if (_championName != null)
            {
                Set(_championName, ShowcasePalette.GetFactionName((int)me.Faction));
                _championName.color = theme.FactionColor((int)me.Faction);
                if (_championIcon != null) { _championIcon.sprite = MapGlyphs.Sprite(LaunchCopy.Houses[Mathf.Clamp((int)me.Faction, 0, 4)].Shape); _championIcon.color = theme.FactionColor((int)me.Faction); }
            }
            // Wish row of the champion HUD: the ability name and stock the server delivered.
            if (_championValue[2] != null)
                Set(_championValue[2], me.Wish.HasValue ? me.Wish.Value.Ability + " · " + me.Wish.Value.Charges + "/" + me.Wish.Value.MaxCharges : "—");
            RefreshWishTile(me.Wish, serverTimeMs, theme);
            RefreshCooldownSweep(me);
            RefreshHudElementVisibility();
        }

        void RefreshWishTile(WishView? wish, double serverTimeMs, UiTheme theme)
        {
            if (_wishSeconds == null) return;
            if (!wish.HasValue)
            {
                _wishMotion.Observe(null, serverTimeMs, Time.unscaledTime);
                Set(_wishSeconds, ""); Set(_wishCharges, ""); if (_wishSweep != null) _wishSweep.enabled = false;
                if (_wishCastBar != null) _wishCastBar.enabled = false;
                HudUi.SetFrame(_wishTile, theme.Border);
                return;
            }
            var w = wish.Value;
            _wishMotion.Observe(wish, serverTimeMs, Time.unscaledTime);
            double remainingMs = Math.Max(0d, w.ReadyAt - serverTimeMs);
            bool ready = remainingMs <= 0d && w.Charges > 0;
            Set(_wishSeconds, remainingMs > 0d ? Math.Ceiling(remainingMs / 1000d).ToString("0") : "");
            // The seconds sit over the icon (legacy); dim the icon while they show so the number stays legible.
            if (_wishIcon != null) { var tint = MythicUi.GlyphColor(MythicGlyph.Wish); tint.a = remainingMs > 0d ? .3f : 1f; _wishIcon.color = tint; }
            Set(_wishCharges, w.MaxCharges > 1 ? w.Charges.ToString() : "");
            if (_wishSweep != null)
            {
                _wishSweep.enabled = remainingMs > 0d && w.RechargeMs > 0d;
                _wishSweep.fillAmount = w.RechargeMs > 0d ? (float)Math.Min(1d, remainingMs / w.RechargeMs) : 0f;
            }
            if (_wishCastBar != null)
            {
                bool casting = w.Cast.HasValue;
                _wishCastBar.enabled = casting;
                if (casting)
                {
                    var c = w.Cast.Value;
                    double span = Math.Max(1d, c.LandsAt - c.StartedAt);
                    _wishCastBar.fillAmount = (float)Math.Max(0d, Math.Min(1d, (serverTimeMs - c.StartedAt) / span));
                }
            }
            HudUi.SetFrame(_wishTile, w.Cast.HasValue ? theme.BorderStrong : ready ? theme.FactionColor(_faction) : theme.Border);
        }

        /// <summary>
        /// Every frame: the tile flashes when the server accepts a cast (a delivered cast record, a stock spend or a jump in the
        /// next-ready time) and pulses when the Wish is available again. Reduced motion keeps the colour wash and drops the scale.
        /// </summary>
        void TickWishTileMotion()
        {
            if (_wishGlow == null || _wishTile == null) return;
            float now = Time.unscaledTime, flash = _wishMotion.Flash(now), pulse = _wishMotion.ReadyPulse(now);
            bool reduced = ShowcaseSettings.Current != null && ShowcaseSettings.Current.ReducedMotion;
            float alpha = Mathf.Clamp01(.6f * flash + .4f * pulse);
            if (alpha <= .004f) { if (_wishGlow.enabled) { _wishGlow.enabled = false; _wishTile.localScale = Vector3.one; } return; }
            Color color = UiTheme.Current.FactionColor(_faction); color.a = alpha;
            _wishGlow.enabled = true; _wishGlow.color = color;
            _wishTile.localScale = reduced ? Vector3.one : Vector3.one * (1f + .12f * flash + .05f * pulse);
        }

        void RefreshCooldownSweep(SelfView me)
        {
            // One shared attack-cooldown wedge over both slots; the share left shrinks against the longest cooldown seen.
            if (me.ReadyInMs > _attackCooldownTotal) _attackCooldownTotal = me.ReadyInMs;
            if (me.ReadyInMs == 0) _attackCooldownTotal = 1f;
            float share = Mathf.Clamp01(me.ReadyInMs / Mathf.Max(1f, _attackCooldownTotal));
            for (int i = 0; i < 2; i++)
                if (_slotSweeps[i] != null) { _slotSweeps[i].enabled = share > 0f; _slotSweeps[i].fillAmount = share; }
        }

        /// <summary>One place that decides which HUD pieces are on screen: panels follow modals, state pieces follow the owner's state.</summary>
        void RefreshHudElementVisibility()
        {
            bool visible = _worldHudVisible;
            SetActiveIfChanged(_vitalsPanel, visible);
            SetActiveIfChanged(_championHud, visible && _championWanted);
            SetActiveIfChanged(_weaponBar, visible && _barWanted);
        }

        static void SetActiveIfChanged(RectTransform rect, bool active)
        {
            if (rect != null && rect.gameObject.activeSelf != active) rect.gameObject.SetActive(active);
        }

        // ------------------------------------------------------------------ viewport-dependent sizes

        void ApplyLegacyViewport(HudViewport viewport)
        {
            _viewport = viewport;
            if (_vitalsPanel != null) _vitalsPanel.sizeDelta = new Vector2(HudLayout.PlateWidth(viewport.UiWidth), _vitalsPanel.sizeDelta.y);
            if (_championHud != null)
                _championHud.sizeDelta = new Vector2(HudLayout.ChampionWidth(viewport.UiWidth, viewport.Narrow), _championHud.sizeDelta.y);
            if (_weaponBar != null) _weaponBar.localScale = Vector3.one;
            _map?.ApplyViewport(viewport, _uiPrefs != null ? _uiPrefs.MinimapScale : 1f);
            ApplyRewardsAnchor();
            _modernSettings?.ApplyViewport(viewport);
            _helpGuide?.ApplyViewport(viewport);
            _hubCosmetics?.ApplyViewport(viewport); _hubProgress?.ApplyViewport(viewport); _hubGuide?.ApplyViewport(viewport);
        }

        void ApplyRewardsAnchor()
        {
            if (_rewards == null || _stage == null || _viewport.UiWidth <= 0f) return;
            float mm = HudLayout.MinimapSize(_viewport.UiWidth, _viewport.UiHeight, _uiPrefs != null ? _uiPrefs.MinimapScale : 1f);
            // Right 12, top 56, bottom = minimap + 34 (so ~22 above the minimap), width min(248, 0.42 uiW).
            _rewards.anchorMin = new Vector2(1, 0); _rewards.anchorMax = new Vector2(1, 1); _rewards.pivot = new Vector2(1, .5f);
            _rewards.sizeDelta = new Vector2(HudLayout.ChestWidth(_viewport.UiWidth, _viewport.Narrow), -(56f + mm + 34f));
            _rewards.anchoredPosition = new Vector2(-12f, (mm + 34f - 56f) / 2f);
        }
    }
}

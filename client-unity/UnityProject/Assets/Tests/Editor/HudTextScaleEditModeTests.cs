using System;
using System.Collections.Generic;
using System.Reflection;
using NUnit.Framework;
using Roguehalla.Net;
using Roguehalla.Net.Protocol;
using Roguehalla.Net.Ui;
using TMPro;
using UnityEngine;

namespace Roguehalla.Client.Tests
{
    /// <summary>
    /// P-UNITY-HUD-TEXTSCALE-1: the text-size setting (0.85 to 1.5) scales every in-match HUD label, and each label still fits its box at every
    /// scale. The label inventory (box, base size, longest realistic text and where the text comes from) is in the packet brief, section 3.
    /// Scales are applied the way the running client applies them: <c>ShowcaseSettings.Changed</c> is raised and <c>MatchHud.ApplyTextScale</c>
    /// answers it (MatchHud.cs:76, :121-132). A label "fits" when the widest line of its text needs at most 88 percent of the box width
    /// (the 12 percent margin of P-UNITY-HUD-VISUAL-FIX-2: the editor measurement does not hold exactly in the Web build) and the text needs no
    /// more than the box height; a wrapping label fits when its wrapped text stays inside the box. The size a label can end up at is
    /// its largest size: the fixed font size, or the auto-size maximum.
    /// </summary>
    public sealed class HudTextScaleEditModeTests
    {
        static readonly Vector2[] Windows = { new Vector2(1280, 800), new Vector2(1920, 1080) };
        static readonly float[] Scales = { .85f, 1f, 1.25f, 1.5f };
        const float WidthShare = .88f, SmallestLegibleSize = 6f;

        /// <summary>The eight (scale, window) combinations of the acceptance check.</summary>
        public static IEnumerable<TestCaseData> Matrix()
        {
            foreach (var window in Windows)
                foreach (float scale in Scales)
                    yield return new TestCaseData(scale, window);
        }

        sealed class Entry
        {
            public string Id;
            public TMP_Text Label;
            /// <summary>The longest realistic texts; null when the label's own owner writes the text (the inspector card).</summary>
            public string[] Texts;
        }

        GameObject _canvas, _hudOwner, _settingsObject, _inspectorHost;
        MatchHud _hud;
        ShowcaseSettings _settings;
        float _savedScale;
        Action _applyTextScale;
        UiTheme _savedTheme;
        InspectorCardView _inspector;
        List<InterpActor> _inspectorRows;
        readonly List<Entry> _entries = new List<Entry>();

        [SetUp]
        public void SetUp()
        {
            _savedTheme = UiTheme.Current;
            UiTheme.Current = UiTheme.Placeholder();
            _settings = ShowcaseSettings.Current;
            if (_settings == null)
            {
                _settingsObject = new GameObject("text scale settings");
                _settings = _settingsObject.AddComponent<ShowcaseSettings>();
                typeof(ShowcaseSettings).GetMethod("Awake", BindingFlags.Instance | BindingFlags.NonPublic).Invoke(_settings, null);
            }
            _savedScale = (float)typeof(ShowcaseSettings).GetField("_textScale", BindingFlags.Instance | BindingFlags.NonPublic).GetValue(_settings);
            SetSettingsScale(1f);

            _canvas = new GameObject("text scale canvas", typeof(RectTransform), typeof(Canvas));
            _hudOwner = new GameObject("text scale hud owner");
            _hud = _hudOwner.AddComponent<MatchHud>();
            SetField("_root", _canvas.GetComponent<RectTransform>());
            SetField("_showcaseSettings", _settings);
            _applyTextScale = (Action)Delegate.CreateDelegate(typeof(Action), _hud, typeof(MatchHud).GetMethod("ApplyTextScale", BindingFlags.Instance | BindingFlags.NonPublic));
            _settings.Changed += _applyTextScale;   // MatchHud.cs:76
            Invoke("EnsureStage");
            Invoke("CreateTopAndToastPills");
            Invoke("CreateLegacyChrome");
            Invoke("CreateCombatHud");

            // The ground chip, the home-ground note, the quest launcher and the inspector card are built the way the client builds them.
            _hud.ShowTerrain(true, 5, MapBlob.GroundTerrainAll, FactionId.Fire);
            _hud.ShowTerrain(true, 4, MapBlob.GroundTerrainMap, FactionId.Fire);
            HudUi.Button((RectTransform)GetField("_stage"), "Journal", "Quests · J", HudAnchor.BottomLeft, 12f, 12f,   // MatchHud.PlayerFlows.cs:40
                84f, 22f, () => { }, UiTheme.Current.SizeSmall, 5f);
            _inspectorHost = new GameObject("inspector host", typeof(RectTransform));
            _inspectorHost.transform.SetParent(_canvas.transform, false);
            _inspector = new InspectorCardView(_inspectorHost.transform);
            _inspectorRows = new List<InterpActor>
            {
                new InterpActor { Id = 7, Kind = ActorKind.Player, Status = ActorStatus.Alive, Faction = FactionId.Sentenced, Weapon = WeaponId.Shield,
                    HpPct = 100, TopStat1 = StatKey.Ad, TopStat2 = StatKey.Ap },
            };
            _entries.Clear();
            BuildInventory();
        }

        [TearDown]
        public void TearDown()
        {
            if (_settings != null)
            {
                _settings.Changed -= _applyTextScale;
                SetSettingsScale(_savedScale);
            }
            if (_canvas != null) UnityEngine.Object.DestroyImmediate(_canvas);
            if (_hudOwner != null) UnityEngine.Object.DestroyImmediate(_hudOwner);
            if (_settingsObject != null) UnityEngine.Object.DestroyImmediate(_settingsObject);
            UiTheme.Current = _savedTheme;
        }

        // ------------------------------------------------------------------ the inventory (packet brief section 3)

        void Add(string id, TMP_Text label, params string[] texts)
        {
            Assert.That(label, Is.Not.Null, "inventory label '" + id + "' was not built");
            _entries.Add(new Entry { Id = id, Label = label, Texts = texts });
        }

        TMP_Text Find(Transform root, string path)
        {
            var t = root.Find(path);
            Assert.That(t, Is.Not.Null, "no '" + path + "' under " + root.name);
            return t.GetComponent<TMP_Text>();
        }

        void BuildInventory()
        {
            var weaponBar = (RectTransform)GetField("_weaponBar");
            var cells = (RectTransform[])GetField("_buildCells");
            var values = (TMP_Text[])GetField("_gainValues");
            var slotNames = (TMP_Text[])GetField("_slotNames");
            var champLabel = (TMP_Text[])GetField("_championLabel");
            var champValue = (TMP_Text[])GetField("_championValue");
            var champScaling = (TMP_Text[])GetField("_championScaling");
            var terrainRow = (RectTransform)GetField("_terrainRow");
            var wishTile = (RectTransform)GetField("_wishTile");
            var potion = ((UnityEngine.UI.Button)GetField("_potionButton")).transform;
            var stage = (RectTransform)GetField("_stage");
            string[] banner = { "Connection interrupted · resuming seat (attempt 10)", "PRACTICE · No run rewards or banking", "Planning — choose your spawn" };
            string[] cellNames = { "Offense", "SO", "Damage gained", "Attack speed", "Life steal", "Health gained", "Defense", "Soul Defense", "Move speed" };

            // Chrome, top centre and toast.
            Add("PerformanceReadout", (TMP_Text)GetField("_metrics"), "240 fps · 1234 ms", "— ms");
            Add("ConnectionBanner", (TMP_Text)GetField("_banner"), banner);
            Add("PhaseTimer", (TMP_Text)GetField("_phaseStrip"), "Waiting for players 12 — run starts in 1:30", "Run over — [BOT] Wanderer1234 is victorious", "PRACTICE · NO RUN REWARDS");
            Add("Notice", (TMP_Text)GetField("_notice"), "Resume is unavailable while another launch or session is active.");
            Add("QuestLauncher", Find(stage, "Journal/Label"), "Quests · J");

            // Plate.
            Add("PlateStatus", (TMP_Text)GetField("_plateStatus"), banner);
            Add("PlateVitals", (TMP_Text)GetField("_vitals"), "Sentenced · HP 1234.5 / 1234.5 · Barrier 123.4", "Waiting / spectating");
            Add("PlateCombatStats", (TMP_Text)GetField("_combatStats"), "Kills 123 · GV 12345 · Alive", "Awaiting player stats");
            Add("HpLabel", Find((RectTransform)GetField("_healthRow"), "HpLabel/Label"), "HP");
            Add("HpValue", (TMP_Text)GetField("_hpValue"), "1234/1234 +123<color=#E8B84A> · Bounty 12</color>");
            Add("GainedHeading", Find((RectTransform)GetField("_buildBox"), "GainedLabel/Label"), "GAINED");
            for (int i = 0; i < 9; i++)
            {
                Add("GainedName " + cellNames[i], Find(cells[i], "Name/Label"), cellNames[i]);
                Add("GainedValue " + cellNames[i], values[i], "+125.5%", "+1234.5");
            }
            Add("ExtrasToggle", (TMP_Text)GetField("_extrasLabel"), "Cards & mob bonuses · 3");
            Add("CardsRow", (TMP_Text)GetField("_cardsText"),
                "Cards: " + CardDisplayCatalog.Title(0) + " ×12 · " + CardDisplayCatalog.Title(1) + " ×12 · " + CardDisplayCatalog.Title(2) + " ×12");
            Add("MobBonusRow", (TMP_Text)GetField("_mobText"), "Wolf ×12 +12.5% attack speed · Boar ×8 +1.5 armor");

            // Champion panel.
            Add("ChampionName", (TMP_Text)GetField("_championName"), "Sentenced");
            Add("ChampionWeapon", (TMP_Text)GetField("_damageWeapon"), "Shield");
            Add("ChampionRowName Attack", champLabel[0], "Shield hit");
            Add("ChampionRowName Passive", champLabel[1], "Dragonslayer");
            Add("ChampionRowName Wish", champLabel[2], "Wish");
            Add("ChampionRowValue Attack", champValue[0], "49.19 / hit · 1.98/s");
            Add("ChampionRowValue Passive", champValue[1], "32% AS · 30% MS slow", "2.16% target HP / hit", "64.38 magic/s");
            Add("ChampionRowValue Wish", champValue[2], "LastStand · 3/3");
            Add("ChampionScaling Passive", champScaling[1], "SO adds 12.5, Offense 18.75 magic DPS/point · DoT ×2.5", "Zombie 123.45/123.45 HP · 12 bodies",
                "Frozen Justice: +12.5 Defense/SD · elite fights", "12 camps · +12.5% earned leech");

            // Weapon bar.
            for (int i = 0; i < 2; i++)
            {
                Add("SlotKey " + (i + 1), Find(weaponBar, "Slot" + (i + 1) + "/Key/Label"), (i + 1).ToString());
                Add("SlotName " + (i + 1), slotNames[i], "Shield", "Empty");
            }
            Add("SwapKey", Find(weaponBar, "QSwap/Key/Label"), "Q");
            Add("SwapCaption", Find(weaponBar, "QSwap/Caption/Label"), "SWAP");
            Add("ControlsLine", Find(weaponBar, "ControlsLine/Label"), "WASD move · Click attack · R Wish");
            Add("PickupHint", (TMP_Text)GetField("_pickupText"), "F  swap Shield for Fists", "F");
            Add("WishKey", Find(wishTile, "Key/Label"), "R");
            Add("WishSeconds", (TMP_Text)GetField("_wishSeconds"), "125");
            Add("WishSummary", (TMP_Text)GetField("_wishSummary"), "3/3 · 1:25");
            Add("WishCharges", (TMP_Text)GetField("_wishCharges"), "3");
            Add("HealKey", Find(potion, "Key/Label"), "E");
            Add("HealName", Find(potion, "Name/Label"), "Heal");
            Add("HealCounts", (TMP_Text)GetField("_healText"), "99 large · 99 small", "— large · — small");
            Add("HealStatus", (TMP_Text)GetField("_healStatus"), "Healing x5");
            Add("WindName", Find(weaponBar, "Consumables/Wind/Name/Label"), "Wind");
            Add("WindText", (TMP_Text)GetField("_windText"), "Walk over emblems", "+50% speed");
            Add("DeathLine", (TMP_Text)GetField("_deathLine"), "YOU DIED");

            // Ground feedback and the opponent inspector card.
            Add("TerrainChip", Find(terrainRow, "Chip0/Label"), "▼ SLOWED", "▲ BURNING");
            Add("TerrainHomeNote", (TMP_Text)GetField("_terrainNoteText"), "Home ground: embers can't burn you", "Home ground: bog can't slow you");
            Add("InspectorCard", Find(_inspector.Root, "Lines/Text"), (string[])null);
        }

        // ------------------------------------------------------------------ applying a scale and measuring

        void UseWindow(Vector2 window)
        {
            ((HudStage)GetField("_stageScaler")).Apply(window.x, window.y, HudLayout.CanvasScalerFactor(window.x, window.y));
            typeof(MatchHud).GetMethod("SetPlateMode", BindingFlags.Instance | BindingFlags.NonPublic).Invoke(_hud, new object[] { true });
            ((RectTransform)_inspectorHost.transform).sizeDelta = window;
            ShowInspector();
        }

        void ShowInspector() { _inspector.Show(_inspectorRows, 7, 0, 1); }

        void SetSettingsScale(float scale)
        {
            typeof(ShowcaseSettings).GetField("_textScale", BindingFlags.Instance | BindingFlags.NonPublic).SetValue(_settings, scale);
        }

        /// <summary>The setting changes: the settings object raises Changed (as NotifyChanged does), then the next frame's per-frame HUD calls run.</summary>
        void ApplyScale(float scale)
        {
            SetSettingsScale(scale);
            var changed = (Action)typeof(ShowcaseSettings).GetField("Changed", BindingFlags.Instance | BindingFlags.NonPublic).GetValue(_settings);
            changed?.Invoke();
            ShowInspector();   // ArenaView presents the card every frame
        }

        static bool Wraps(TMP_Text t) { return t.textWrappingMode != TextWrappingModes.NoWrap; }
        static float LargestSize(TMP_Text t) { return t.enableAutoSizing ? t.fontSizeMax : t.fontSize; }
        static float SmallestSize(TMP_Text t) { return t.enableAutoSizing ? t.fontSizeMin : t.fontSize; }

        /// <summary>What the text needs at a size: the widest line, and the height of all lines (wrapped to the box width when the label wraps).</summary>
        static Vector2 Needs(TMP_Text label, string text, float size)
        {
            bool auto = label.enableAutoSizing; float keep = label.fontSize;
            label.enableAutoSizing = false; label.fontSize = size;
            var need = label.GetPreferredValues(text, Wraps(label) ? label.rectTransform.rect.width : 0f, 0f);
            label.fontSize = keep; label.enableAutoSizing = auto;
            return need;
        }

        static bool Fits(TMP_Text label, string text, float size)
        {
            var box = label.rectTransform.rect;
            var need = Needs(label, text, size);
            return need.x <= box.width * WidthShare + .001f && need.y <= box.height + .01f;
        }

        string Describe(Entry e, string text, float size)
        {
            var box = e.Label.rectTransform.rect; var need = Needs(e.Label, text, size);
            return e.Id + " '" + text.Replace("\n", "|") + "' at " + size.ToString("0.##") + " needs " + need.x.ToString("0.#") + "x" + need.y.ToString("0.#")
                + " of " + box.width.ToString("0.#") + "x" + box.height.ToString("0.#");
        }

        /// <summary>Everything the setting promises about one label at the scale just applied, with its current text.</summary>
        void Check(Entry e, float scale, List<string> problems)
        {
            var label = e.Label; string text = label.text;
            var follow = label.GetComponent<MythicTextScale>();
            if (follow == null) { problems.Add(e.Id + " has no MythicTextScale: it ignores the setting"); return; }
            if (label.overflowMode == TextOverflowModes.Ellipsis || label.overflowMode == TextOverflowModes.Truncate)
                problems.Add(e.Id + " would cut its text (overflow " + label.overflowMode + ")");
            float largest = LargestSize(label), smallest = SmallestSize(label);
            if (smallest < SmallestLegibleSize - .01f) problems.Add(e.Id + " can shrink to " + smallest + ", below " + SmallestLegibleSize);
            if (largest + .01f < smallest) problems.Add(e.Id + " has a largest size " + largest + " under its smallest " + smallest);
            if (!Fits(label, text, largest)) problems.Add("CLIPS " + Describe(e, text, largest));
            float wanted = follow.BaseSize * Mathf.Clamp(scale, .85f, 1.5f);
            if (Fits(label, text, wanted) && largest < wanted - .05f)
                problems.Add(e.Id + " has room for " + wanted.ToString("0.##") + " but is held to " + largest.ToString("0.##"));
        }

        static int Rounds(List<Entry> entries)
        {
            int rounds = 1;
            foreach (var e in entries) if (e.Texts != null && e.Texts.Length > rounds) rounds = e.Texts.Length;
            return rounds;
        }

        void SetTexts(int round)
        {
            foreach (var e in _entries)
                if (e.Texts != null) e.Label.text = e.Texts[Math.Min(round, e.Texts.Length - 1)];
        }

        // ------------------------------------------------------------------ the checks

        [Test]
        public void TheInventoryCoversTheWholeMatchHud()
        {
            // The packet brief lists these labels; the count guards against a label silently dropping out of the checks.
            Assert.That(_entries.Count, Is.EqualTo(63), "labels in the inventory");
            var ids = new HashSet<string>();
            foreach (var e in _entries) Assert.That(ids.Add(e.Id), Is.True, "duplicate id " + e.Id);
        }

        [TestCaseSource(nameof(Matrix))]
        public void EveryLabelShowsItsLongestTextWithoutTruncationAfterTheScaleIsApplied(float scale, Vector2 window)
        {
            UseWindow(window);
            var problems = new List<string>();
            for (int round = 0; round < Rounds(_entries); round++)
            {
                SetTexts(round);
                ApplyScale(scale);
                foreach (var e in _entries) Check(e, scale, problems);
            }
            Assert.That(problems, Is.Empty, problems.Count + " problems:\n" + string.Join("\n", problems));
        }

        [TestCaseSource(nameof(Matrix))]
        public void ATextThatArrivesAfterTheScaleWasAppliedStillFitsOnceTheLabelRefits(float scale, Vector2 window)
        {
            UseWindow(window);
            ApplyScale(scale);
            var problems = new List<string>();
            for (int round = 0; round < Rounds(_entries); round++)
            {
                SetTexts(round);   // the HUD writes new text every frame; MythicTextScale re-fits on the change (Refit is the explicit form)
                foreach (var e in _entries)
                {
                    var follow = e.Label.GetComponent<MythicTextScale>();
                    if (follow != null) follow.Refit();
                    Check(e, scale, problems);
                }
            }
            Assert.That(problems, Is.Empty, problems.Count + " problems:\n" + string.Join("\n", problems));
        }

        [TestCaseSource(nameof(WindowCases))]
        public void LabelsFollowTheSettingUpwardsAndTheOnesWithRoomAreLargerAtOnePointFiveThanAtOne(Vector2 window)
        {
            UseWindow(window);
            var problems = new List<string>();
            for (int round = 0; round < Rounds(_entries); round++)
            {
                SetTexts(round);
                var largest = new Dictionary<string, float[]>();
                foreach (var e in _entries) largest[e.Id] = new float[Scales.Length];
                for (int s = 0; s < Scales.Length; s++)
                {
                    ApplyScale(Scales[s]);
                    foreach (var e in _entries) largest[e.Id][s] = LargestSize(e.Label);
                }
                foreach (var e in _entries)
                {
                    var sizes = largest[e.Id];
                    for (int s = 1; s < Scales.Length; s++)
                        if (sizes[s] < sizes[s - 1] - .01f) problems.Add(e.Id + " gets smaller as the setting rises: " + string.Join(", ", sizes));
                    var follow = e.Label.GetComponent<MythicTextScale>();
                    if (follow == null) continue;
                    string text = e.Label.text;
                    if (Fits(e.Label, text, follow.BaseSize * 1.5f) && !(sizes[3] > sizes[1] + .05f))
                        problems.Add(e.Id + " has room at 1.5 but is not larger than at 1.0 (" + sizes[1] + " then " + sizes[3] + ")");
                }
            }
            Assert.That(problems, Is.Empty, problems.Count + " problems:\n" + string.Join("\n", problems));
        }

        public static IEnumerable<TestCaseData> WindowCases()
        {
            foreach (var window in Windows) yield return new TestCaseData(window);
        }

        [Test]
        public void NoLabelOfTheMatchHudIsOptedOutOfTheSetting()
        {
            var missing = new List<string>();
            foreach (var root in new[] { (Transform)GetField("_stage"), (Transform)GetField("_chromeStage"), _inspector.Root })
                foreach (var label in root.GetComponentsInChildren<TMP_Text>(true))
                {
                    // The retained Wish detail card is a MatchHud.Text label (hidden); ApplyTextScale scales it through _scaledText.
                    if (label.transform.IsChildOf((Transform)GetField("_wishDetails"))) continue;
                    if (label.GetComponent<MythicTextScale>() == null) missing.Add(Path(label.transform));
                }
            Assert.That(missing, Is.Empty, "labels without MythicTextScale: " + string.Join(", ", missing));
            // The labels that P-UNITY-HUD-VISUAL-FIX-2 took out of the setting are back in it.
            var cells = (RectTransform[])GetField("_buildCells");
            for (int i = 0; i < 9; i++)
            {
                Assert.That(cells[i].Find("Name/Label").GetComponent<MythicTextScale>(), Is.Not.Null, "gained name " + i);
                Assert.That(((TMP_Text[])GetField("_gainValues"))[i].GetComponent<MythicTextScale>(), Is.Not.Null, "gained value " + i);
            }
            for (int i = 0; i < 3; i++)
            {
                Assert.That(((TMP_Text[])GetField("_championLabel"))[i].GetComponent<MythicTextScale>(), Is.Not.Null, "champion label " + i);
                Assert.That(((TMP_Text[])GetField("_championValue"))[i].GetComponent<MythicTextScale>(), Is.Not.Null, "champion value " + i);
            }
        }

        // ---- helpers ----

        static string Path(Transform t) { string path = t.name; for (var p = t.parent; p != null && p.parent != null && path.Length < 80; p = p.parent) path = p.name + "/" + path; return path; }

        object GetField(string name) => typeof(MatchHud).GetField(name, BindingFlags.Instance | BindingFlags.NonPublic).GetValue(_hud);
        void SetField(string name, object value) => typeof(MatchHud).GetField(name, BindingFlags.Instance | BindingFlags.NonPublic).SetValue(_hud, value);
        void Invoke(string name, params object[] args) => typeof(MatchHud).GetMethod(name, BindingFlags.Instance | BindingFlags.NonPublic).Invoke(_hud, args.Length == 0 ? null : args);
    }
}

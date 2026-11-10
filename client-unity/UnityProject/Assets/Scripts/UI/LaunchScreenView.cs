using System;
using Roguehalla.Net.Ui;
using TMPro;
using UnityEngine;
using UnityEngine.UI;

namespace Roguehalla.Client
{
    /// <summary>
    /// The launch screen in the legacy arrangement (docs/rework/LEGACY_LAYOUT.md section 15): a docked menu panel on the left (callsign and
    /// Load, the record, the faction picker, Start Run and Training, the status line) over the walkable hub room, which fills the space to
    /// its right. A wordmark sits above the room. Everything is built in HUD units inside its own <see cref="HudStage"/>, so the numbers
    /// here are legacy CSS px at any window size. This view holds no account or launch logic: it raises events and shows what it is told.
    /// </summary>
    [DisallowMultipleComponent]
    public sealed class LaunchScreenView : MonoBehaviour
    {
        // Panel metrics (HUD units).
        public const float PanelX = 12f, PanelY = 12f, PanelW = 330f, PanelH = 612f, Pad = 14f, Inner = PanelW - 2f * Pad;
        public const float Gutter = 12f, HeroH = 104f;

        public RectTransform Root { get; private set; }
        public RectTransform Stage { get; private set; }
        public RectTransform Panel { get; private set; }
        public HudStage StageScaler { get; private set; }
        public HubAtriumView Atrium { get; private set; }
        public TMP_InputField Callsign { get; private set; }
        public Button Load { get; private set; }
        public Button Profile { get; private set; }
        public Button Resume { get; private set; }
        public Button Guide { get; private set; }
        public Button SignIn { get; private set; }
        public Button Play { get; private set; }
        public Button Training { get; private set; }
        public Button[] Houses { get; private set; }
        public TMP_Text Reason { get; private set; }
        public TMP_Text Status { get; private set; }
        public TMP_Text RecordText { get; private set; }
        public TMP_Text PlayLabel { get; private set; }
        public TMP_Text TrainingLabel { get; private set; }
        public RectTransform HeroBlock { get; private set; }

        public Action LoadRequested, ProfileRequested, ResumeRequested, GuideRequested, SignInRequested, PlayRequested, TrainingRequested, CancelRequested;
        public Action<int> FactionChosen;

        Image _veil, _scrim, _playIcon;
        TMP_Text _recordBig, _recordSmall, _recordCaption;
        Image[] _houseRule, _houseCheck;
        int _house = 4;
        bool _cancelMode;
        HudViewport _viewport;

        /// <summary>The veil fades the vista in: 1 = fully covers the backdrop, 0 = gone. The scrim above it always dims the vista so panels stay readable.</summary>
        public void SetVeil(float amount)
        {
            if (_veil == null) return;
            var c = _veil.color; c.a = Mathf.Clamp01(amount); _veil.color = c;
        }

        public void Build(RectTransform menuRoot)
        {
            var theme = UiTheme.Current;
            Root = menuRoot;
            _veil = Fill(menuRoot, "Veil", UiTheme.With(theme.SurfaceSunken, 1f));
            _scrim = Fill(menuRoot, "Scrim", UiTheme.With(theme.Scrim, .60f));
            TopShade(menuRoot, "TopShade", .62f, UiTheme.With(theme.OutlineDark, .85f));
            var stage = new GameObject("LaunchStage", typeof(RectTransform), typeof(HudStage));
            stage.transform.SetParent(menuRoot, false);
            Stage = (RectTransform)stage.transform;
            StageScaler = stage.GetComponent<HudStage>();
            BuildHero(theme);
            // The panel is built first so keyboard order reads callsign, record, faction, actions, then the room's stations.
            BuildPanel(theme);
            Atrium = gameObject.AddComponent<HubAtriumView>();
            Atrium.Initialize(Stage, null);
            Atrium.SetFaction(_house);
            StageScaler.ViewportChanged += ApplyViewport;
            StageScaler.Relayout();
        }

        static Texture2D _ramp;
        /// <summary>A dark gradient laid over the top of the vista so the wordmark reads on any region: opaque at the top edge, fading to nothing (generated, tinted by the Image colour).</summary>
        static void TopShade(Transform parent, string name, float fromFraction, Color color)
        {
            if (_ramp == null)
            {
                _ramp = new Texture2D(1, 64, TextureFormat.RGBA32, false) { name = "Launch shade ramp", wrapMode = TextureWrapMode.Clamp, filterMode = FilterMode.Bilinear, hideFlags = HideFlags.HideAndDontSave };
                var px = new Color32[64];
                for (int i = 0; i < 64; i++) { float t = i / 63f; px[i] = new Color32(255, 255, 255, (byte)Mathf.RoundToInt(255f * t * t)); }
                _ramp.SetPixels32(px); _ramp.Apply(false, true); // row 0 is the bottom: transparent; the last row is the top: opaque
            }
            var rect = (RectTransform)new GameObject(name, typeof(RectTransform)).transform;
            rect.SetParent(parent, false);
            rect.anchorMin = new Vector2(0, fromFraction); rect.anchorMax = new Vector2(1, 1);
            rect.offsetMin = rect.offsetMax = Vector2.zero;
            var raw = rect.gameObject.AddComponent<RawImage>(); raw.texture = _ramp; raw.color = color; raw.raycastTarget = false;
        }

        static Image Fill(Transform parent, string name, Color color)
        {
            var rect = (RectTransform)new GameObject(name, typeof(RectTransform)).transform;
            rect.SetParent(parent, false);
            rect.anchorMin = Vector2.zero; rect.anchorMax = Vector2.one; rect.offsetMin = rect.offsetMax = Vector2.zero;
            var image = rect.gameObject.AddComponent<Image>(); image.color = color; image.raycastTarget = true;
            return image;
        }

        void BuildHero(UiTheme theme)
        {
            // The wordmark: Cinzel, gold, with a soft dark echo behind it so it reads over any region.
            HeroBlock = HudUi.Box(Stage, "Wordmark", HudAnchor.TopLeft, 0, 0, 600f, HeroH);
            var echo = LaunchUi.Text(HeroBlock, "WordmarkShadow", 2f, 16f, 596f, 62f, "ROGUEHALLA", 54f, UiTheme.With(theme.OutlineDark, .55f), TextAlignmentOptions.Center, true, UiFontRole.Display);
            echo.characterSpacing = 8f;
            var title = LaunchUi.Text(HeroBlock, "WordmarkText", 0f, 14f, 596f, 62f, "ROGUEHALLA", 54f, theme.Accent, TextAlignmentOptions.Center, true, UiFontRole.Display);
            title.characterSpacing = 8f;
            LaunchUi.Bar(HeroBlock, "WordmarkRuleLeft", 150f, 83f, 130f, 2f, UiTheme.With(theme.Accent, .75f));
            LaunchUi.Bar(HeroBlock, "WordmarkRuleRight", 320f, 83f, 130f, 2f, UiTheme.With(theme.Accent, .75f));
            LaunchUi.Shape(HeroBlock, "WordmarkJewel", MapGlyph.Diamond, 292f, 76f, 16f, theme.Accent);
            LaunchUi.Text(HeroBlock, "Tagline", 0f, 86f, 600f, 18f, LaunchCopy.Tagline, 14f, theme.TextPrimary, TextAlignmentOptions.Center);
        }

        void BuildPanel(UiTheme theme)
        {
            Panel = HudUi.Box(Stage, "LaunchPanel", HudAnchor.TopLeft, PanelX, PanelY, PanelW, PanelH);
            HudUi.Surface(Panel, theme.Surface, theme.CornerRadiusLarge, theme.Border, true, true);

            float y = 14f;
            LaunchUi.Text(Panel, "CallsignLabel", Pad, y, Inner, 14f, "CALLSIGN", 11f, theme.TextSecondary, TextAlignmentOptions.MidlineLeft, true).characterSpacing = 1.5f;
            y += 18f;
            Callsign = LaunchUi.Input(Panel, "Nickname", "", "your callsign", Pad, y, 232f, 36f, 16);
            Load = LaunchUi.Button(Panel, "LoadProfile", Pad + 240f, y, Inner - 240f, 36f, LaunchUi.Look.Raised, () => LoadRequested?.Invoke());
            LaunchUi.Text(Load.transform, "Label", 0, 0, Inner - 240f, 36f, "LOAD", 13f, theme.TextPrimary, TextAlignmentOptions.Center, true);
            y += 46f;

            BuildRecord(theme, y);
            y += 64f;

            Profile = Pill(Panel, "OpenProfileRecords", Pad, y, 172f, "PROFILE & RECORDS", LaunchIcon.Profile, () => ProfileRequested?.Invoke());
            Resume = Pill(Panel, "ResumeRun", Pad + 180f, y, Inner - 180f, "RESUME…", LaunchIcon.Resume, () => ResumeRequested?.Invoke());
            y += 42f;

            LaunchUi.Text(Panel, "FactionLabel", Pad, y, Inner, 14f, "CHOOSE YOUR FACTION", 11f, theme.TextSecondary, TextAlignmentOptions.MidlineLeft, true).characterSpacing = 1.5f;
            y += 18f;
            Houses = new Button[5]; _houseRule = new Image[5]; _houseCheck = new Image[5];
            for (int i = 0; i < 5; i++) { BuildHouseCard(theme, i, y + i * 52f); }
            y += 5 * 52f + 4f;

            Play = LaunchUi.Button(Panel, "Join", Pad, y, 190f, 48f, LaunchUi.Look.Primary, () => { if (!_cancelMode) PlayRequested?.Invoke(); });
            _playIcon = LaunchUi.Icon(Play.transform, "PlayIcon", LaunchIcon.Play, 16f, 14f, 20f, theme.OutlineDark);
            PlayLabel = LaunchUi.Text(Play.transform, "Label", 44f, 0f, 140f, 48f, "START RUN", 17f, theme.OutlineDark, TextAlignmentOptions.MidlineLeft, true, UiFontRole.Display);
            PlayLabel.characterSpacing = 1.5f;
            Training = LaunchUi.Button(Panel, "JoinTraining", Pad + 198f, y, Inner - 198f, 48f, LaunchUi.Look.Raised, () => { if (_cancelMode) CancelRequested?.Invoke(); else TrainingRequested?.Invoke(); });
            Training.gameObject.AddComponent<CanvasGroup>().ignoreParentGroups = true;
            TrainingLabel = LaunchUi.Text(Training.transform, "Label", 0, 0, Inner - 198f, 48f, "TRAINING", 13f, theme.TextPrimary, TextAlignmentOptions.Center, true);
            y += 56f;

            Reason = LaunchUi.Text(Panel, "LaunchAvailability", Pad, y, Inner, 34f, "", 12f, theme.TextSecondary, TextAlignmentOptions.TopLeft, false, UiFontRole.Body, true);
            Status = LaunchUi.Text(Panel, "AccountStatus", Pad, y, Inner, 34f, "", 12f, theme.Warning, TextAlignmentOptions.TopLeft, false, UiFontRole.Body, true);
            y += 40f;

            Guide = Pill(Panel, "OpenGuide", Pad, y, 196f, "CHAMPIONS & WEAPONS", LaunchIcon.Guide, () => GuideRequested?.Invoke(), 11.5f);
            SignIn = Pill(Panel, "SignInOptions", Pad + 204f, y, Inner - 204f, "SIGN-IN", LaunchIcon.Key, () => SignInRequested?.Invoke(), 11.5f);
            SetFaction(_house);
        }

        void BuildRecord(UiTheme theme, float y)
        {
            var card = HudUi.At(Panel, "RecordCard", Pad, y, Inner, 56f);
            HudUi.Surface(card, theme.SurfaceSunken, theme.CornerRadius, theme.Border, false, false);
            _recordCaption = LaunchUi.Text(card, "RecordCaption", 10f, 6f, 150f, 14f, "GLORIOUS VICTORY", 10f, theme.TextSecondary, TextAlignmentOptions.MidlineLeft, true);
            _recordCaption.characterSpacing = 1f;
            _recordBig = LaunchUi.Text(card, "RecordBalance", 10f, 18f, 130f, 34f, "", 28f, theme.Accent, TextAlignmentOptions.MidlineLeft, true, UiFontRole.Display);
            _recordSmall = LaunchUi.Text(card, "RecordDetail", 120f, 10f, Inner - 130f, 40f, "", 12f, theme.TextSecondary, TextAlignmentOptions.MidlineRight, false, UiFontRole.Body, true);
            RecordText = LaunchUi.Text(card, "ProfileSummary", 10f, 4f, Inner - 20f, 48f, "", 12.5f, theme.TextSecondary, TextAlignmentOptions.MidlineLeft, false, UiFontRole.Body, true);
        }

        Button Pill(Transform parent, string name, float x, float y, float w, string label, LaunchIcon icon, Action click, float size = 12f)
        {
            var theme = UiTheme.Current;
            var button = LaunchUi.Button(parent, name, x, y, w, 32f, LaunchUi.Look.Raised, () => click());
            LaunchUi.Icon(button.transform, "Icon", icon, 8f, 6f, 20f, theme.Accent);
            LaunchUi.Text(button.transform, "Label", 32f, 0f, w - 36f, 32f, label, size, theme.TextPrimary, TextAlignmentOptions.MidlineLeft, true);
            return button;
        }

        void BuildHouseCard(UiTheme theme, int index, float y)
        {
            var house = LaunchCopy.Houses[index];
            int captured = index;
            var card = LaunchUi.Button(Panel, "Faction" + house.Name, Pad, y, Inner, 48f, LaunchUi.Look.Raised, () => { SetFaction(captured); FactionChosen?.Invoke(captured); });
            Houses[index] = card;
            Color faction = theme.FactionColor(index);
            _houseRule[index] = LaunchUi.Bar(card.transform, "Rule", 7f, 9f, 4f, 30f, faction);
            LaunchUi.Shape(card.transform, "Shape", house.Shape, 18f, 10f, 28f, faction);
            LaunchUi.Text(card.transform, "Name", 56f, 5f, 110f, 22f, house.Name, 15f, theme.TextPrimary, TextAlignmentOptions.MidlineLeft, true);
            LaunchUi.Text(card.transform, "Region", 56f, 25f, 130f, 18f, house.Region, 11.5f, theme.TextSecondary);
            _houseCheck[index] = LaunchUi.Icon(card.transform, "Selected", LaunchIcon.Check, 146f, 7f, 14f, theme.Accent);
            var pill = HudUi.At(card.transform, "WeaponPill", Inner - 104f, 12f, 96f, 24f);
            HudUi.Surface(pill, theme.SurfaceSunken, 12f, theme.Border, false, false);
            LaunchUi.Weapon(pill, "WeaponIcon", house.WeaponGlyph, 8f, 4f, 16f, MythicUi.GlyphColor(house.WeaponGlyph));
            LaunchUi.Text(pill, "Weapon", 28f, 0f, 66f, 24f, house.Weapon, 12f, theme.TextPrimary, TextAlignmentOptions.MidlineLeft);
        }

        // ---------------------------------------------------------------- state

        public int Faction { get { return _house; } }

        public void SetFaction(int faction)
        {
            _house = Mathf.Clamp(faction, 0, 4);
            var theme = UiTheme.Current;
            if (Houses == null) return;
            for (int i = 0; i < Houses.Length; i++)
            {
                bool selected = i == _house;
                var colors = Houses[i].colors; colors.normalColor = selected ? theme.SurfaceSelected : theme.SurfaceRaised; Houses[i].colors = colors;
                HudUi.SetFrame((RectTransform)Houses[i].transform, selected ? theme.BorderStrong : theme.Border);
                _houseCheck[i].enabled = selected;
            }
            Atrium?.SetFaction(_house);
        }

        /// <summary>Shows a loaded profile in the record card.</summary>
        public void SetRecord(string balance, string detail)
        {
            RecordText.text = ""; _recordCaption.gameObject.SetActive(true);
            _recordBig.text = balance; _recordSmall.text = detail;
        }

        /// <summary>No profile: the card explains what to do instead.</summary>
        public void SetRecordEmpty(string hint)
        {
            _recordBig.text = ""; _recordSmall.text = ""; _recordCaption.gameObject.SetActive(false);
            RecordText.text = hint;
        }

        /// <summary>
        /// Start Run's state: a label and whether it is usable. While a launch is connecting the Training slot becomes a Cancel button
        /// (and stays clickable even though the rest of the menu is locked).
        /// </summary>
        public void SetPlay(string label, bool interactable, bool connecting)
        {
            if (PlayLabel.text != label) PlayLabel.text = label;
            Play.interactable = interactable && !connecting;
            var theme = UiTheme.Current;
            // The primary fill carries dark ink; when it is disabled the fill goes slate, so the ink flips to the light secondary tone.
            Color ink = Play.interactable ? (Color)theme.OutlineDark : theme.TextSecondary;
            PlayLabel.color = ink; _playIcon.color = ink;
            _cancelMode = connecting;
            string training = connecting ? "CANCEL" : "TRAINING";
            if (TrainingLabel.text != training) TrainingLabel.text = training;
            TrainingLabel.color = Training.interactable ? (Color)theme.TextPrimary : theme.TextSecondary;
        }

        /// <summary>Shows one explanatory line under the actions: a status (account or launch problem) wins over the availability reason.</summary>
        public void SetMessages(string status, string reason)
        {
            bool hasStatus = !string.IsNullOrEmpty(status);
            if (Status.text != (status ?? "")) Status.text = status ?? "";
            string r = hasStatus ? "" : reason ?? "";
            if (Reason.text != r) Reason.text = r;
        }

        // ---------------------------------------------------------------- layout

        public void ApplyViewport(HudViewport viewport)
        {
            _viewport = viewport;
            float x0 = PanelX + PanelW + Gutter;
            float width = Mathf.Max(300f, viewport.UiWidth - x0 - Gutter);
            HudUi.Place(HeroBlock, HudAnchor.TopLeft, x0 + (width - 600f) * .5f, 14f, 600f, HeroH);
            float top = 14f + HeroH + 2f;
            Atrium.ApplyArea(x0, top, width, Mathf.Max(300f, viewport.UiHeight - top - Gutter));
        }
    }
}

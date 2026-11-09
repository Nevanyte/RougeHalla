using System;
using System.Collections.Generic;
using TMPro;
using UnityEngine;
using UnityEngine.UI;
using Roguehalla.Net;

namespace Roguehalla.Client
{
    /// <summary>Read-only owner build inspector. Every number and card count comes from the server-owned session views.</summary>
    public sealed class BuildDrawer : MonoBehaviour
    {
        const int CardSlots = CardDisplayCatalog.Count;
        RectTransform _root;
        RectTransform _viewport;
        GridLayoutGroup _grid;
        ScrollRect _scroll;
        TMP_Text _vitals, _status, _detail, _countLabel;
        Button[] _cardButtons;
        TMP_Text[] _cardCounts;
        Image[] _cardBorders;
        static readonly string[] BoostNames = { "AD", "AP", "ARM", "SHD", "HP", "AS", "SPD", "LS" };
        readonly byte[] _cards = new byte[CardSlots];
        readonly byte[] _boosts = new byte[8];
        uint _lastSelfId;
        float _lastHp = float.NaN, _lastMaxHp, _lastBarrier;
        ushort _lastKills, _lastBounty, _lastGv;
        byte _lastStatus, _lastWeapon;
        bool _hasSelf;
        bool _hasBuild;
        int _selectedIndex = -1;
        float _textScale = 1f;
        Action _onClose;

        public bool IsVisible { get { return _root != null && _root.gameObject.activeSelf; } }
        public bool BlocksInput { get { return IsVisible; } }
        public int CardCount { get { return _cardButtons == null ? 0 : _cardButtons.Length; } }
        public int SelectedIndex { get { return _selectedIndex; } }
        public ScrollRect Scroll { get { return _scroll; } }
        public RectTransform Content { get; private set; }

        public void Initialize(Transform canvasRoot, Action onClose = null)
        {
            if (canvasRoot == null) throw new ArgumentNullException(nameof(canvasRoot));
            _onClose = onClose;
            _root = MythicUi.Panel(canvasRoot, "BuildDrawer", new Vector2(.57f, .025f), new Vector2(.985f, .975f), ShowcasePalette.Panel);
            var stroke = _root.gameObject.AddComponent<Outline>();
            stroke.effectColor = ShowcasePalette.PanelStroke; stroke.effectDistance = new Vector2(1, 1);

            MythicUi.Text(_root, "DrawerTitle", "FIELD LEDGER", new Vector2(.035f, .92f), new Vector2(.72f, .995f), 25, ShowcasePalette.Gold);
            _countLabel = MythicUi.Text(_root, "CardCount", "80 cards · awaiting build", new Vector2(.73f, .92f), new Vector2(.87f, .995f), 15,
                ShowcasePalette.MutedText, TextAlignmentOptions.MidlineRight);
            var close = MythicUi.Button(_root, "Close", "CLOSE", new Vector2(.875f, .92f), new Vector2(.98f, .995f), Close, MythicUi.ButtonStyle.Quiet);
            close.GetComponentInChildren<TMP_Text>().fontSize = 13;

            var summary = MythicUi.Panel(_root, "OwnerSummary", new Vector2(.025f, .805f), new Vector2(.975f, .91f), ShowcasePalette.PanelRaised);
            MythicUi.Icon(summary, "HealthGlyph", MythicGlyph.Health, new Vector2(.02f, .2f), new Vector2(.10f, .8f));
            _vitals = MythicUi.Text(summary, "Vitals", "Awaiting server build", new Vector2(.11f, .45f), new Vector2(.98f, .98f), 16);
            _status = MythicUi.Text(summary, "OwnerStatus", "Owner facts", new Vector2(.11f, .04f), new Vector2(.98f, .48f), 13, ShowcasePalette.MutedText);

            var boosts = MythicUi.Panel(_root, "BoostStrip", new Vector2(.025f, .728f), new Vector2(.975f, .795f), ShowcasePalette.Background);
            var boostNames = new[] { "AD", "AP", "ARM", "SHD", "HP", "AS", "SPD", "LS" };
            var boostGlyphs = new[] { MythicGlyph.Sword, MythicGlyph.Wand, MythicGlyph.Armor, MythicGlyph.Shield,
                MythicGlyph.Health, MythicGlyph.Speed, MythicGlyph.Speed, MythicGlyph.Health };
            for (int i = 0; i < boostNames.Length; i++)
            {
                float x0 = .008f + i * .124f;
                MythicUi.Icon(boosts, "BoostGlyph" + i, boostGlyphs[i], new Vector2(x0, .20f), new Vector2(x0 + .055f, .80f));
                MythicUi.Text(boosts, "Boost" + i, boostNames[i] + " 0", new Vector2(x0 + .055f, .05f), new Vector2(x0 + .119f, .95f), 12,
                    ShowcasePalette.MutedText, TextAlignmentOptions.Center);
            }

            _scroll = MythicUi.ScrollView(_root, "CardCatalogScroll", new Vector2(.025f, .245f), new Vector2(.975f, .718f), out var content);
            Content = content;
            _cardButtons = new Button[CardSlots]; _cardCounts = new TMP_Text[CardSlots]; _cardBorders = new Image[CardSlots];
            _grid = Content.GetComponent<GridLayoutGroup>();
            _grid.cellSize = new Vector2(210, 220); _grid.spacing = new Vector2(10, 10);
            _viewport = _scroll.viewport;
            for (int i = 0; i < CardSlots; i++) CreateCard(i, content);
            _detail = MythicUi.ScrollText(_root, "SelectionDetail", "Select a card to inspect its server catalog description.",
                new Vector2(.035f, .015f), new Vector2(.97f, .23f), 16);

            _root.gameObject.SetActive(false);
            RefreshVisuals();
        }

        void CreateCard(int index, Transform parent)
        {
            var buttonRect = MythicUi.Rect(parent, "Card" + index.ToString("00"), Vector2.zero, Vector2.one);
            var background = buttonRect.gameObject.AddComponent<Image>(); background.color = ShowcasePalette.PanelRaised;
            background.raycastTarget = true;
            var button = buttonRect.gameObject.AddComponent<Button>(); button.targetGraphic = background;
            var colors = button.colors; colors.normalColor = ShowcasePalette.PanelRaised; colors.highlightedColor = ShowcasePalette.PanelStroke;
            colors.pressedColor = ShowcasePalette.GoldDim; colors.selectedColor = ShowcasePalette.GoldDim;
            colors.disabledColor = new Color32(47, 55, 66, 255); button.colors = colors;
            int captured = index; button.onClick.AddListener(() => Select(captured));
            _cardButtons[index] = button; _cardBorders[index] = background;

            var display = CardDisplayCatalog.Get(index);
            MythicUi.Icon(buttonRect, "CardGlyph", GlyphFor(display.Tags), new Vector2(.02f, .56f), new Vector2(.26f, .98f));
            MythicUi.Text(buttonRect, "CardTitle", display.Title, new Vector2(.27f, .69f), new Vector2(.96f, .97f), 15,
                ShowcasePalette.Text);
            MythicUi.Text(buttonRect, "CardDescription", display.Description, new Vector2(.04f, .22f), new Vector2(.96f, .66f), 12,
                ShowcasePalette.MutedText);
            string tags = string.IsNullOrWhiteSpace(display.Tags) ? "CARD" : display.Tags.Replace("True_", "True").ToUpperInvariant();
            MythicUi.Text(buttonRect, "CardTags", tags, new Vector2(.04f, .05f), new Vector2(.70f, .20f), 10, ShowcasePalette.Gold);
            _cardCounts[index] = MythicUi.Text(buttonRect, "OwnedCount", "×0", new Vector2(.72f, .035f), new Vector2(.97f, .21f), 14,
                ShowcasePalette.Success, TextAlignmentOptions.MidlineRight);
        }

        static MythicGlyph GlyphFor(string tags)
        {
            if (tags == null) return MythicGlyph.Cards;
            if (tags.Contains("Physical")) return MythicGlyph.Sword;
            if (tags.Contains("Magic")) return MythicGlyph.Wand;
            if (tags.Contains("Heal")) return MythicGlyph.Health;
            if (tags.Contains("Block")) return MythicGlyph.Shield;
            if (tags.Contains("Execute") || tags.Contains("True_")) return MythicGlyph.Axe;
            if (tags.Contains("Slow") || tags.Contains("Ramping")) return MythicGlyph.Speed;
            if (tags.Contains("Wish")) return MythicGlyph.Wish;
            return MythicGlyph.Cards;
        }

        public void SetVisible(bool visible)
        {
            if (_root == null) return;
            _root.gameObject.SetActive(visible);
            if (visible && _scroll != null) _scroll.StopMovement();
        }

        public void Refresh(CollectionsView collections, SelfView me, float textScale = 1f)
        {
            if (_root == null) return;
            textScale = Mathf.Clamp(float.IsNaN(textScale) || float.IsInfinity(textScale) ? 1f : textScale, .75f, 1.5f);
            if (!Mathf.Approximately(textScale, _textScale)) { _textScale = textScale; ApplyTextScale(); }

            bool changed = collections != null && (collections.HasBuild != _hasBuild || !SameCards(collections.Cards, collections.HasBuild) || !SameBoosts(collections.Boosts));
            if (changed)
            {
                _hasBuild = collections.HasBuild;
                Array.Clear(_cards, 0, _cards.Length); Array.Clear(_boosts, 0, _boosts.Length);
                for (int i = 0; i < Mathf.Min(_cards.Length, collections.Cards.Count); i++) _cards[i] = collections.Cards[i];
                for (int i = 0; i < Mathf.Min(_boosts.Length, collections.Boosts.Count); i++) _boosts[i] = collections.Boosts[i];
                RefreshCounts();
            }
            if (!SameSelf(me))
            {
                if (me == null)
                {
                    _hasSelf = false;
                    Set(_vitals, "Owner state unavailable"); Set(_status, "Waiting for an authoritative owner snapshot");
                }
                else
                {
                    _hasSelf = true; _lastSelfId = me.Id; _lastHp = me.Hp; _lastMaxHp = me.MaxHp; _lastBarrier = me.Barrier;
                    _lastStatus = (byte)me.Status; _lastWeapon = (byte)me.Weapon; _lastKills = me.Kills; _lastBounty = me.Bounty; _lastGv = me.Gv;
                    Set(_vitals, "HP " + me.Hp.ToString("0.#") + " / " + me.MaxHp.ToString("0.#") + "     Barrier " + me.Barrier.ToString("0.#"));
                    Set(_status, me.Status + "  ·  " + me.Weapon + "  ·  " + me.Kills + " kills  ·  Bounty " + me.Bounty + "  ·  GV " + me.Gv);
                }
            }
        }

        bool SameCards(IReadOnlyList<byte> source, bool hasBuild)
        {
            if (!hasBuild) return source == null || source.Count == 0;
            if (source == null || source.Count != CardSlots) return false;
            for (int i = 0; i < CardSlots; i++) if (_cards[i] != source[i]) return false;
            return true;
        }
        bool SameBoosts(IReadOnlyList<byte> source)
        {
            if (source == null || source.Count == 0) return true;
            if (source.Count != _boosts.Length) return false;
            for (int i = 0; i < _boosts.Length; i++) if (_boosts[i] != source[i]) return false;
            return true;
        }
        bool SameSelf(SelfView b)
        {
            if (b == null) return !_hasSelf;
            return _hasSelf && _lastSelfId == b.Id && _lastHp == b.Hp && _lastMaxHp == b.MaxHp && _lastBarrier == b.Barrier &&
                _lastStatus == (byte)b.Status && _lastWeapon == (byte)b.Weapon && _lastKills == b.Kills && _lastBounty == b.Bounty && _lastGv == b.Gv;
        }

        void RefreshCounts()
        {
            for (int i = 0; i < _cards.Length; i++)
            {
                string value = "×" + _cards[i];
                if (_cardCounts[i] != null && _cardCounts[i].text != value) _cardCounts[i].text = value;
            }
            var boostRow = _root.Find("BoostStrip");
            if (boostRow != null)
                for (int i = 0; i < _boosts.Length; i++)
                {
                    var label = boostRow.Find("Boost" + i)?.GetComponentInChildren<TMP_Text>();
                    if (label != null)
                    {
                        label.text = BoostNames[i] + " " + _boosts[i];
                    }
                }
            if (_countLabel != null) _countLabel.text = _hasBuild ? "80 cards · live build" : "80 cards · awaiting build";
            RefreshVisuals();
        }

        void Select(int index)
        {
            if (index < 0 || index >= CardSlots) return;
            _selectedIndex = index;
            RefreshVisuals();
        }
        void RefreshVisuals()
        {
            if (_cardBorders == null) return;
            for (int i = 0; i < _cardBorders.Length; i++)
            {
                if (_cardBorders[i] != null) _cardBorders[i].color = i == _selectedIndex ? ShowcasePalette.GoldDim : ShowcasePalette.PanelRaised;
            }
            if (_detail != null)
            {
                var display = CardDisplayCatalog.Get(_selectedIndex);
                _detail.text = _selectedIndex < 0 ? "Select a card to inspect its server catalog description." :
                    display.Title + "  ·  " + display.Description + (string.IsNullOrEmpty(display.Tags) ? "" : "  ·  " + display.Tags.Replace("True_", "True"));
            }
        }
        void ApplyTextScale()
        {
            MythicUi.ApplyTextScale(_root, _textScale);
            if (_grid != null) _grid.cellSize = new Vector2(_grid.cellSize.x, 220 * _textScale);
        }
        static void Set(TMP_Text text, string value) { if (text != null && text.text != value) text.text = value; }
        void LateUpdate() { FitGrid(); }
        void FitGrid()
        {
            if (_grid == null || _viewport == null || _viewport.rect.width <= 0) return;
            float cell = Mathf.Max(152, (_viewport.rect.width - _grid.padding.horizontal - _grid.spacing.x - 4) * .5f);
            if (!Mathf.Approximately(_grid.cellSize.x, cell)) _grid.cellSize = new Vector2(cell, _grid.cellSize.y);
        }
        void Close() { SetVisible(false); if (_onClose != null) _onClose(); }
    }

}

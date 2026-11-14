using System;
using UnityEngine.InputSystem;
using UnityEngine;
using UnityEngine.EventSystems;
using UnityEngine.UI;
using TMPro;

namespace Roguehalla.Client
{
    /// <summary>Accessible, read-only hub guide. Faction picks are forwarded to the join menu; the guide owns no game rules.</summary>
    [DisallowMultipleComponent]
    public sealed class HubGuideView : MonoBehaviour
    {
        public enum GuideTab { Champions, Weapons, Counters }

        static readonly string[] Factions = { "Fire", "Sentenced", "Plague", "Frost", "Holy" };
        static readonly string[] Roles = { "Glass-cannon duelist", "Patient executioner", "Attrition swarm", "Control bruiser", "Sustain juggernaut" };
        static readonly string[] Passives = { "Dragonslayer", "Mark", "Rat King", "Wall of Ice", "Radiant" };
        static readonly string[] PassiveSummaries =
        {
            "Burn and retaliate during a trade; roam between fights to charge a faster move and a physical hit burst.",
            "Choose a rival to hunt, then grow stronger when they fall. Every landed hit marks the target for judgment.",
            "Consume a player body to raise a Plague zombie. More bodies strengthen it and grant you both max health; disease wears foes down and execute finishes them.",
            "Frozen Justice grants defenses in elite fights. Slow enemy attacks and briefly chill nearby enemies before they thaw.",
            "Earn lasting lifesteal from eligible camp clears. Heal from damage dealt, with stronger faction lifesteal as your health falls."
        };
        static readonly string[] Wishes = { "Blink · Burning Trail", "Judgment Ring", "Hidden Swarm", "Frost Wall", "Death's Door" };
        static readonly string[] WishSummaries =
        {
            "Blink toward your cursor through walls and leave a burning trail behind you.",
            "Trap an enemy in a judgment ring: weaken their damage, strengthen yours, and stun them if they leave.",
            "Become a hidden swarm to break enemy targeting and reposition.",
            "Raise a wall of ice where you aim to cut off a chaser or split a fight: bodies and swings stop at it, shots fly over.",
            "Survive lethal damage briefly, move faster, then recover a share of the damage the effect held."
        };
        static readonly string[] WeaponIds = { "sword", "bow", "wand", "shield", "axe", "fists" };
        static readonly string[] WeaponNames = { "Sword", "Bow", "Wand", "Shield", "Axe", "Fists" };
        static readonly string[] WeaponRoles =
        {
            "Fast melee · interrupts", "Long range · skillshots", "Longest range · lock-on splash", "Frontal defense · retaliation", "Heavy melee · Defense shred", "Empty hand · fast, short reach"
        };
        static readonly string[] WeaponBuilds =
        {
            "Offense + on-hit effects", "Offense + attack speed", "SO first · Offense secondary", "Defense/SD first · SO secondary", "Offense first · bonus health secondary", "Offense or SO · find a weapon"
        };
        static readonly string[] WeaponPlay =
        {
            "Stay close and time your swings to interrupt slower attacks. Approach archers through cover; avoid a shield's front.",
            "Aim straight-flying arrows while moving; you pause for the final 0.2 s before release. Keep melee fighters at range; watch for wand balls and shields.",
            "The wand has the furthest weapon range and is the only weapon with lock-on. Send balls through incoming arrows and clustered enemies.",
            "Aim toward incoming sword hits and arrows. Your front matters: axe, fists and wand bypass the weapon's block mechanics.",
            "Close the gap, cut through shield blocking and intercept wand balls. Archers can keep you at range.",
            "Fists bypass shield blocking and carry strong on-hit effects, but have the shortest reach and reduced base damage. They sit outside the counter wheel."
        };

        RectTransform _root;
        RectTransform _overlay;
        RectTransform _panel;
        RectTransform _content;
        ScrollRect _scroll;
        Button[] _tabButtons;
        Button[] _factionButtons;
        Button[] _weaponButtons;
        WeaponCounterGuide _counterWheel;
        Action<int> _onFactionPick;
        GameObject _returnFocus;
        GuideTab _currentTab;
        int _selectedFaction = 4;
        string _selectedWeapon = "sword";
        int _cardSequence;
        bool _initialized;
        float _scale = 1;

        public bool IsVisible { get { return _overlay != null && _overlay.gameObject.activeSelf; } }
        public RectTransform FocusRoot => _panel;
        public GuideTab CurrentTab { get { return _currentTab; } }
        public int SelectedFaction { get { return _selectedFaction; } }
        public string SelectedWeapon { get { return _selectedWeapon; } }
        public RectTransform Content { get { return _content; } }
        public Button GetTabButton(GuideTab tab) { return _tabButtons == null ? null : _tabButtons[(int)tab]; }

        public void Initialize(RectTransform root, Action<int> onFactionPick)
        {
            if (_initialized) throw new InvalidOperationException("HubGuideView is already initialized.");
            if (root == null) throw new ArgumentNullException(nameof(root));
            _root = root;
            _onFactionPick = onFactionPick;
            Build();
            _initialized = true;
            SetVisible(false);
            ShowTab(GuideTab.Champions, false);
        }

        public void SetVisible(bool visible)
        {
            if (!_initialized && _overlay == null) return;
            if (_overlay == null) return;
            if (visible == IsVisible) return;
            if (visible)
            {
                _returnFocus = EventSystem.current == null ? null : EventSystem.current.currentSelectedGameObject;
                _overlay.gameObject.SetActive(true);
                Focus(_tabButtons[(int)_currentTab]);
            }
            else
            {
                _overlay.gameObject.SetActive(false);
                if (EventSystem.current != null && _returnFocus != null && _returnFocus.activeInHierarchy)
                    EventSystem.current.SetSelectedGameObject(_returnFocus);
            }
        }

        /// <summary>Shows the guide and switches directly to one of its three primary pages.</summary>
        public void ShowTab(GuideTab tab) { ShowTab(tab, true); }

        public void RefreshScale(float scale)
        {
            _scale = Mathf.Clamp(scale, .85f, 1.5f);
            if (_panel != null) MythicUi.ApplyTextScale(_panel, _scale);
        }

        /// <summary>Docks the panel in the shared hub panel area for the current window (see <see cref="HubPanelDock"/>).</summary>
        public void ApplyViewport(HudViewport viewport) { HubPanelDock.Apply(_panel, viewport); }

        public void SetFaction(int faction)
        {
            _selectedFaction = Mathf.Clamp(faction, 0, Factions.Length - 1);
            UpdateFactionButtons();
        }

        public void SetActiveWeapon(string weapon)
        {
            _selectedWeapon = (weapon ?? "").Trim().ToLowerInvariant();
            if (_counterWheel != null) _counterWheel.SetWeapon(_selectedWeapon);
        }

        /// <summary>Public escape handler keeps the close rule testable and restores focus to the opening control.</summary>
        public bool HandleEscape()
        {
            if (!IsVisible) return false;
            SetVisible(false);
            return true;
        }

        void Update()
        {
            if (IsVisible && Keyboard.current != null && Keyboard.current.escapeKey.wasPressedThisFrame) HandleEscape();
        }

        void ShowTab(GuideTab tab, bool open)
        {
            if (!_initialized && !_overlay) return;
            _currentTab = tab;
            if (open && !IsVisible) SetVisible(true);
            for (int i = 0; i < _tabButtons.Length; i++)
            {
                bool selected = i == (int)tab;
                MythicUi.Select(_tabButtons[i], selected);
                var label = _tabButtons[i].GetComponentInChildren<TMP_Text>();
                if (label != null) label.color = selected ? ShowcasePalette.Text : ShowcasePalette.MutedText;
            }
            BuildPage(tab);
            RefreshScale(_scale);
            if (open) Focus(_tabButtons[(int)tab]);
        }

        void Build()
        {
            _overlay = MythicUi.Rect(_root, "HubGuideOverlay", Vector2.zero, Vector2.one);
            var backdrop = MythicUi.Rect(_overlay, "Backdrop", Vector2.zero, Vector2.one);
            var shade = backdrop.gameObject.AddComponent<Image>();
            shade.color = UiTheme.With(UiTheme.Current.Scrim, 0f); shade.raycastTarget = true; // no dim: the launch panel stays lit
            var backdropButton = backdrop.gameObject.AddComponent<Button>();
            backdropButton.targetGraphic = shade;
            backdropButton.onClick.AddListener(() => SetVisible(false));

            _panel = MythicUi.Panel(_overlay, "HubGuidePanel", new Vector2(.065f, .055f), new Vector2(.935f, .945f), ShowcasePalette.Panel, true);
            var panelSurface = _panel.GetComponent<Image>();
            var panelBlocker = _panel.gameObject.AddComponent<Button>();
            panelBlocker.targetGraphic = panelSurface;
            panelBlocker.onClick.AddListener(() => { });
            _panel.localScale = Vector3.one;
            var head = MythicUi.Text(_panel, "Heading", "THE FIELD GUIDE", new Vector2(.035f, .91f), new Vector2(.72f, .99f), 27, ShowcasePalette.Gold, heading: true);
            head.fontStyle = FontStyles.Bold;
            MythicUi.Text(_panel, "Subheading", "Champions, weapons, and the intended weapon matchups", new Vector2(.035f, .865f), new Vector2(.8f, .92f), 15, ShowcasePalette.MutedText);

            var close = MythicUi.Button(_panel, "CloseGuide", "CLOSE  ×", new Vector2(.84f, .91f), new Vector2(.97f, .99f), () => SetVisible(false), MythicUi.ButtonStyle.Secondary);
            close.navigation = Navigation.defaultNavigation;

            string[] names = { "CHAMPIONS", "WEAPONS", "COUNTERS" };
            _tabButtons = new Button[3];
            for (int i = 0; i < _tabButtons.Length; i++)
            {
                int index = i;
                float left = .035f + i * .315f;
                var button = MythicUi.Button(_panel, names[i] + "Tab", names[i], new Vector2(left, .79f), new Vector2(left + .30f, .855f), () => ShowTab((GuideTab)index), MythicUi.ButtonStyle.Secondary);
                _tabButtons[i] = button;
            }
            for (int i = 0; i < _tabButtons.Length; i++)
            {
                var nav = new Navigation { mode = Navigation.Mode.Explicit };
                nav.selectOnLeft = _tabButtons[(i + _tabButtons.Length - 1) % _tabButtons.Length];
                nav.selectOnRight = _tabButtons[(i + 1) % _tabButtons.Length];
                nav.selectOnDown = close;
                _tabButtons[i].navigation = nav;
            }
            _scroll = CreateTextScroll(_panel, "GuideScroll", new Vector2(.025f, .025f), new Vector2(.975f, .775f), out _content);
            _scroll.scrollSensitivity = 38;
        }

        void BuildPage(GuideTab tab)
        {
            if (_content == null) return;
            if (_counterWheel != null) { _counterWheel.Destroy(); _counterWheel = null; }
            for (int i = _content.childCount - 1; i >= 0; i--) DestroyOwned(_content.GetChild(i).gameObject);
            _cardSequence = 0;
            _factionButtons = null;
            _weaponButtons = null;
            _scroll.verticalNormalizedPosition = 1;
            switch (tab)
            {
                case GuideTab.Champions: BuildChampions(); break;
                case GuideTab.Weapons: BuildWeapons(); break;
                case GuideTab.Counters: BuildCounters(); break;
            }
            Canvas.ForceUpdateCanvases();
        }

        void BuildChampions()
        {
            AddIntro("Choose a faction before a run. Each has a passive signature and one active Wish.");
            var row = CreateLayoutItem(_content, "FactionChoices", 58);
            var fitter = row.GetComponent<LayoutElement>(); fitter.minHeight = 58;
            var layout = row.gameObject.AddComponent<HorizontalLayoutGroup>();
            layout.spacing = 8; layout.padding = new RectOffset(4, 4, 4, 4); layout.childControlWidth = true; layout.childForceExpandWidth = true; layout.childControlHeight = true; layout.childForceExpandHeight = true;
            _factionButtons = new Button[Factions.Length];
            for (int i = 0; i < Factions.Length; i++)
            {
                int index = i;
                _factionButtons[i] = MythicUi.Button(row, "Faction_" + Factions[i], "      " + Factions[i], Vector2.zero, Vector2.one, () => SelectFaction(index));
                // The generated faction pictogram replaces the old bracket mark; it sits left of the name.
                var icon = LaunchUi.FactionShape(_factionButtons[i].transform, "FactionIcon", i, 0f, 0f, 20f, UiTheme.Current.FactionColor(i));
                icon.rectTransform.anchorMin = icon.rectTransform.anchorMax = new Vector2(0f, .5f);
                icon.rectTransform.pivot = new Vector2(.5f, .5f); icon.rectTransform.anchoredPosition = new Vector2(20f, 0f);
            }
            UpdateFactionButtons();
            for (int i = 0; i < Factions.Length; i++)
            {
                string text = Roles[i] + "\nPassive · " + PassiveSummaries[i] + "\nWish · " + Wishes[i] + " — " + WishSummaries[i];
                AddCard(Factions[i] + "   ·   " + Passives[i], text, 184, ShowcasePalette.Faction(i), i);
            }
        }

        void BuildWeapons()
        {
            AddIntro("Weapons add reach, attack rhythm, stat scaling, and counter mechanics. Fists begin every run and sit outside the weapon loop.");
            _weaponButtons = new Button[WeaponNames.Length];
            var row = CreateLayoutItem(_content, "WeaponChoices", 58);
            var fitter = row.GetComponent<LayoutElement>(); fitter.minHeight = 58;
            var layout = row.gameObject.AddComponent<HorizontalLayoutGroup>();
            layout.spacing = 6; layout.padding = new RectOffset(4, 4, 4, 4); layout.childControlWidth = true; layout.childForceExpandWidth = true; layout.childControlHeight = true; layout.childForceExpandHeight = true;
            for (int i = 0; i < WeaponNames.Length; i++)
            {
                int index = i;
                _weaponButtons[i] = MythicUi.Button(row, "Weapon_" + WeaponIds[i], WeaponNames[i].ToUpperInvariant(), Vector2.zero, Vector2.one, () => { _selectedWeapon = WeaponIds[index]; ScrollTo("WeaponCard_" + WeaponIds[index], _weaponButtons[index]); }, MythicUi.ButtonStyle.Secondary);
            }
            for (int i = 0; i < WeaponNames.Length; i++)
                AddCardTo(_content, "WeaponCard_" + WeaponIds[i], WeaponNames[i] + "   ·   " + WeaponRoles[i], "Build around · " + WeaponBuilds[i] + "\n\n" + WeaponPlay[i], 152, ShowcasePalette.Gold);
        }

        void BuildCounters()
        {
            AddIntro("Intended matchups are directional advantages, not guaranteed wins. Positioning, champion, growth, and execution still matter.");
            _counterWheel = new WeaponCounterGuide(_content, _selectedWeapon, weapon => { _selectedWeapon = weapon; });
            var note = MythicUi.Text(_content, "CounterFootnote", "Fists are not an item and never join this wheel. Select a weapon node to highlight its advantages and risks.", Vector2.zero, Vector2.one, 16, ShowcasePalette.MutedText);
            ConfigureLayoutChild(note.GetComponent<RectTransform>(), 54);
        }

        void SelectFaction(int index)
        {
            _selectedFaction = index;
            UpdateFactionButtons();
            _onFactionPick?.Invoke(index);
        }

        void UpdateFactionButtons()
        {
            if (_factionButtons == null) return;
            for (int i = 0; i < _factionButtons.Length; i++)
            {
                bool selected = i == _selectedFaction;
                MythicUi.Select(_factionButtons[i], selected);
                var text = _factionButtons[i].GetComponentInChildren<TMP_Text>();
                if (text != null) text.color = selected ? ShowcasePalette.Text : ShowcasePalette.Faction(i);
            }
        }

        void AddIntro(string text)
        {
            var intro = MythicUi.Text(_content, "PageIntro", text, Vector2.zero, Vector2.one, 16, ShowcasePalette.MutedText);
            intro.enableWordWrapping = true;
            ConfigureLayoutChild(intro.GetComponent<RectTransform>(), 52);
        }

        void AddCard(string title, string body, float height, Color titleColor, int factionIcon = -1)
        { AddCardTo(_content, "Card_" + (_cardSequence++), title, body, height, titleColor, factionIcon); }

        void AddCardTo(Transform parent, string objectName, string title, string body, float height, Color titleColor, int factionIcon = -1)
        {
            var card = MythicUi.Panel(parent, objectName, Vector2.zero, Vector2.one, ShowcasePalette.PanelRaised, true);
            ConfigureLayoutChild(card, height);
            var group = card.gameObject.AddComponent<VerticalLayoutGroup>();
            group.spacing = 4; group.padding = new RectOffset(12, 12, 9, 8); group.childControlWidth = true; group.childForceExpandWidth = true; group.childControlHeight = false; group.childForceExpandHeight = false;
            Transform headingParent = card;
            if (factionIcon >= 0)
            {
                // Faction cards lead with the generated faction pictogram instead of a bracket mark.
                var head = CreateLayoutItem(card, "Head", 28);
                var icon = LaunchUi.FactionShape(head, "FactionIcon", factionIcon, 0f, 4f, 20f, titleColor);
                icon.rectTransform.anchorMin = icon.rectTransform.anchorMax = new Vector2(0f, .5f);
                icon.rectTransform.pivot = new Vector2(0f, .5f); icon.rectTransform.anchoredPosition = new Vector2(0f, 0f);
                var named = MythicUi.Text(head, "Title", title, Vector2.zero, Vector2.one, 19, titleColor);
                named.fontStyle = FontStyles.Bold; named.rectTransform.offsetMin = new Vector2(28f, 0f);
                headingParent = null;
            }
            if (headingParent != null)
            {
            var heading = MythicUi.Text(card, "Title", title, Vector2.zero, Vector2.one, 19, titleColor);
            heading.fontStyle = FontStyles.Bold;
            ConfigureLayoutChild(heading.GetComponent<RectTransform>(), 28);
            }
            var description = MythicUi.Text(card, "Description", body, Vector2.zero, Vector2.one, 15, ShowcasePalette.Text);
            description.enableWordWrapping = true;
            ConfigureLayoutChild(description.GetComponent<RectTransform>(), height - 48);
        }

        static RectTransform CreateLayoutItem(Transform parent, string name, float height)
        {
            var item = MythicUi.Rect(parent, name, Vector2.zero, Vector2.one);
            ConfigureLayoutChild(item, height);
            return item;
        }

        static void ConfigureLayoutChild(RectTransform rect, float height)
        {
            rect.anchorMin = new Vector2(0, 1);
            rect.anchorMax = new Vector2(1, 1);
            rect.pivot = new Vector2(.5f, 1);
            rect.sizeDelta = new Vector2(0, height);
            var layout = rect.GetComponent<LayoutElement>() ?? rect.gameObject.AddComponent<LayoutElement>();
            layout.preferredHeight = height;
        }

        ScrollRect CreateTextScroll(Transform parent, string name, Vector2 min, Vector2 max, out RectTransform content)
        {
            var scrollRoot = MythicUi.Rect(parent, name, min, max);
            var scroll = scrollRoot.gameObject.AddComponent<ScrollRect>();
            scroll.horizontal = false; scroll.vertical = true; scroll.movementType = ScrollRect.MovementType.Clamped; scroll.inertia = true;
            var viewport = MythicUi.Panel(scrollRoot, "Viewport", Vector2.zero, Vector2.one, new Color32(0, 0, 0, 0), true);
            viewport.gameObject.AddComponent<RectMask2D>(); // a stencil Mask over a fully transparent graphic hides everything (the guide pages rendered blank)
            content = MythicUi.Rect(viewport, "Content", new Vector2(0, 1), new Vector2(1, 1), Vector2.zero, Vector2.zero);
            content.pivot = new Vector2(.5f, 1);
            var vertical = content.gameObject.AddComponent<VerticalLayoutGroup>();
            vertical.spacing = 10; vertical.padding = new RectOffset(4, 4, 8, 10); vertical.childControlWidth = true; vertical.childForceExpandWidth = true; vertical.childControlHeight = false; vertical.childForceExpandHeight = false;
            content.gameObject.AddComponent<ContentSizeFitter>().verticalFit = ContentSizeFitter.FitMode.PreferredSize;
            scroll.viewport = viewport; scroll.content = content;
            return scroll;
        }

        void ScrollTo(string objectName, Selectable focus)
        {
            if (_content == null) return;
            for (int i = 0; i < _content.childCount; i++)
                if (_content.GetChild(i).name == objectName)
                {
                    Canvas.ForceUpdateCanvases();
                    var target = _content.GetChild(i).GetComponent<RectTransform>();
                    var viewport = _scroll.viewport;
                    float contentHeight = _content.rect.height, viewHeight = viewport.rect.height;
                    if (contentHeight > viewHeight)
                    {
                        float fromTop = Mathf.Abs(target.anchoredPosition.y);
                        _scroll.verticalNormalizedPosition = Mathf.Clamp01(1 - fromTop / (contentHeight - viewHeight));
                    }
                    Focus(focus);
                    return;
                }
        }

        static void Focus(Selectable selectable)
        {
            if (EventSystem.current == null || selectable == null) return;
            EventSystem.current.SetSelectedGameObject(selectable.gameObject);
        }

        static void DestroyOwned(GameObject obj)
        {
            if (Application.isPlaying) UnityEngine.Object.Destroy(obj);
            else UnityEngine.Object.DestroyImmediate(obj);
        }

        void OnDestroy()
        {
            if (_counterWheel != null) _counterWheel.Destroy();
        }
    }
}

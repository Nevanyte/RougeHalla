using System;
using System.Collections.Generic;
using System.Globalization;
using System.Linq;
using System.Threading.Tasks;
using Roguehalla.Net;
using TMPro;
using UnityEngine;
using UnityEngine.EventSystems;
using UnityEngine.InputSystem;
using UnityEngine.UI;

namespace Roguehalla.Client
{
    public enum HubCosmeticsTab { Shop, Wardrobe, Titles }

    /// <summary>Account backed cosmetics pages. Catalog labels are metadata; ownership and every mutation remain server owned.</summary>
    [DisallowMultipleComponent]
    public sealed class HubCosmeticsView : MonoBehaviour
    {
        sealed class MutationEntry
        {
            public AccountMutation Operation;
            public AccountApiResult Result;
            public bool Submitting;
        }

        readonly List<AccountCosmeticDefinition> _catalog = new List<AccountCosmeticDefinition>();
        readonly Dictionary<string, AccountCosmeticDefinition> _catalogById = new Dictionary<string, AccountCosmeticDefinition>(StringComparer.Ordinal);
        readonly List<MutationEntry> _mutations = new List<MutationEntry>();
        readonly List<string> _wardrobeSlots = new List<string>();
        readonly HashSet<string> _owned = new HashSet<string>(StringComparer.Ordinal);
        readonly Dictionary<string, string> _equipped = new Dictionary<string, string>(StringComparer.Ordinal);
        readonly List<GameObject> _cards = new List<GameObject>();

        AccountCoordinator _owner;
        RectTransform _root, _panel, _content;
        ScrollRect _scroll;
        GridLayoutGroup _grid;
        Button[] _tabButtons;
        Button _close, _refresh, _slotFilter;
        TMP_Text _heading, _wallet, _slotFilterLabel, _status;
        HubCosmeticsTab _tab;
        AccountApiResult _currentRead;
        string _observedName = "";
        string _titleSlot;
        GameObject _returnFocus;
        long _viewGeneration;
        float _textScale = 1f;
        int _slotFilterIndex;
        bool _initialized, _catalogLoaded, _building;

        internal readonly struct FocusKey
        {
            public readonly string CardName;
            public readonly string ChildPath;
            public FocusKey(string cardName, string childPath) { CardName = cardName; ChildPath = childPath; }
            public bool IsValid => !string.IsNullOrEmpty(CardName);
        }

        public bool IsVisible => _panel != null && _panel.gameObject.activeSelf;
        public RectTransform Root => _panel;
        public HubCosmeticsTab CurrentTab => _tab;
        public int CatalogCount => _catalog.Count;
        public IReadOnlyList<string> WardrobeSlots => _wardrobeSlots.AsReadOnly();

        public void Initialize(Transform root, AccountCoordinator owner)
        {
            if (_initialized) throw new InvalidOperationException("HubCosmeticsView is already initialized.");
            if (root == null) throw new ArgumentNullException(nameof(root));
            _root = root as RectTransform;
            if (_root == null) throw new ArgumentException("The cosmetics root must be a RectTransform.", nameof(root));
            _owner = owner;
            _observedName = owner?.Snapshot?.SelectedName ?? "";
            LoadCatalog();
            Build();
            _initialized = true;
            if (_owner?.Flow != null) _owner.Flow.Changed += OnOwnerChanged;
            _tab = HubCosmeticsTab.Shop;
            UpdateTabs();
            UpdateSlotFilterVisibility();
            _panel.gameObject.SetActive(false);
        }

        public void Show(HubCosmeticsTab tab)
        {
            if (!_initialized && _panel == null) return;
            bool changed = _tab != tab;
            _tab = tab;
            UpdateTabs();
            UpdateSlotFilterVisibility();
            if (!IsVisible) SetVisible(true);
            else if (changed) RebuildCards();
        }

        public void SetVisible(bool visible)
        {
            if (_panel == null || _panel.gameObject.activeSelf == visible) return;
            if (visible)
            {
                _returnFocus = EventSystem.current == null ? null : EventSystem.current.currentSelectedGameObject;
                _panel.gameObject.SetActive(true);
                _panel.SetAsLastSibling();
                if (EventSystem.current != null && _tabButtons != null)
                    EventSystem.current.SetSelectedGameObject(_tabButtons[(int)_tab].gameObject);
                RenderProfileGuidance();
            }
            else
            {
                ++_viewGeneration;
                _currentRead = null;
                _panel.gameObject.SetActive(false);
                if (EventSystem.current != null && _returnFocus != null && _returnFocus.activeInHierarchy)
                    EventSystem.current.SetSelectedGameObject(_returnFocus);
            }
        }

        public void RefreshScale(float scale)
        {
            _textScale = Mathf.Clamp(scale, .85f, 1.5f);
            if (_panel != null) MythicUi.ApplyTextScale(_panel, _textScale);
            UpdateGridLayout();
        }

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

        void LoadCatalog()
        {
            TextAsset source = Resources.Load<TextAsset>("Account/cosmetics");
            if (source == null || !AccountFullJson.TryCosmeticCatalog(source.text, out var catalog)) return;
            _catalog.AddRange(catalog);
            _catalogLoaded = _catalog.Count > 0;
            foreach (var item in _catalog)
            {
                _catalogById[item.Id] = item;
                if (_titleSlot == null && item.Text != null) _titleSlot = item.Slot;
            }
            if (_titleSlot != null)
                _wardrobeSlots.AddRange(_catalog.Select(item => item.Slot)
                    .Where(slot => !string.Equals(slot, _titleSlot, StringComparison.Ordinal))
                    .Distinct(StringComparer.Ordinal));
            _wardrobeSlots.Sort(StringComparer.Ordinal);
        }

        void Build()
        {
            _panel = MythicUi.Panel(_root, "HubCosmeticsPanel", new Vector2(.37f, .17f), new Vector2(.98f, .87f), ShowcasePalette.Panel, true);
            _heading = MythicUi.Text(_panel, "CosmeticsHeading", "ACCOUNT COSMETICS", new Vector2(.03f, .91f), new Vector2(.72f, .99f), 27, ShowcasePalette.Gold);
            _wallet = MythicUi.Text(_panel, "Wallet", "PROFILE · refreshing", new Vector2(.035f, .84f), new Vector2(.69f, .91f), 18, ShowcasePalette.Text);
            _close = MythicUi.Button(_panel, "CloseCosmetics", "CLOSE  ×", new Vector2(.84f, .92f), new Vector2(.975f, .99f), () => SetVisible(false), MythicUi.ButtonStyle.Quiet);
            _refresh = MythicUi.Button(_panel, "RefreshProfile", "REFRESH PROFILE", new Vector2(.70f, .84f), new Vector2(.975f, .91f), RefreshProfile, MythicUi.ButtonStyle.Secondary);
            _tabButtons = new Button[3];
            string[] labels = { "SHOP", "WARDROBE", "TITLES" };
            for (int i = 0; i < _tabButtons.Length; i++)
            {
                int index = i;
                float left = .035f + i * .225f;
                _tabButtons[i] = MythicUi.Button(_panel, labels[i] + "Tab", labels[i], new Vector2(left, .755f), new Vector2(left + .21f, .825f), () => Show((HubCosmeticsTab)index), MythicUi.ButtonStyle.Secondary);
            }
            for (int i = 0; i < _tabButtons.Length; i++)
            {
                var navigation = new Navigation { mode = Navigation.Mode.Explicit };
                navigation.selectOnLeft = _tabButtons[(i + _tabButtons.Length - 1) % _tabButtons.Length];
                navigation.selectOnRight = _tabButtons[(i + 1) % _tabButtons.Length];
                navigation.selectOnDown = _refresh;
                _tabButtons[i].navigation = navigation;
            }
            _slotFilter = MythicUi.Button(_panel, "WardrobeSlotFilter", "SLOT · ALL  ›", new Vector2(.035f, .685f), new Vector2(.34f, .745f), CycleSlotFilter);
            _slotFilterLabel = MythicUi.Text(_panel, "WardrobeSlotFilterHelp", "Cycle through catalog slots", new Vector2(.36f, .685f), new Vector2(.96f, .745f), 14, ShowcasePalette.MutedText);
            _scroll = MythicUi.ScrollView(_panel, "CosmeticsScroll", new Vector2(.025f, .09f), new Vector2(.975f, .675f), out _content);
            _grid = _content.GetComponent<GridLayoutGroup>();
            _scroll.scrollSensitivity = 38;
            var readingPane = _scroll.gameObject.AddComponent<KeyboardScrollPane>();
            readingPane.Initialize(_scroll);
            _status = MythicUi.Text(_panel, "CosmeticsStatus", "", new Vector2(.03f, .015f), new Vector2(.97f, .085f), 16, ShowcasePalette.MutedText);
            UpdateGridLayout();
            UpdateTabs();
            UpdateSlotFilterVisibility();
        }

        void RefreshProfile()
        {
            if (!_initialized) return;
            ++_viewGeneration;
            _currentRead = null;
            var snapshot = _owner?.Snapshot;
            var api = _owner?.Api;
            if (api == null || _owner?.Flow == null)
            {
                _status.text = "Account services are unavailable on this page.";
                RebuildCards();
                return;
            }
            if (snapshot == null || snapshot.State != AccountHubState.Owned || snapshot.Profile == null)
            {
                _status.text = "Load an owned profile first, then choose REFRESH PROFILE to view account cosmetics.";
                _wallet.text = "PROFILE · not loaded";
                RebuildCards();
                return;
            }
            _status.text = "Refreshing the saved profile…";
            _wallet.text = "PROFILE · refreshing";
            RebuildCards();
            ReadProfileAsync(api, _viewGeneration);
        }

        async void ReadProfileAsync(AccountApiService api, long generation)
        {
            AccountApiResult result;
            try { result = await api.ReadProfileAsync(); }
            catch
            {
                if (CanApplyView(generation, api))
                {
                    _status.text = "Profile refresh failed. Try again when the account service is available.";
                    RebuildCards();
                }
                return;
            }
            if (!CanApply(generation, api, result)) return;
            _currentRead = result;
            if (result.Failure != AccountApiFailure.None)
            {
                _status.text = AccountFailureText(result.Failure);
                _wallet.text = "PROFILE · unavailable";
            }
            else
            {
                var profile = _owner.Snapshot.FullProfile;
                _status.text = profile == null ? "No complete profile was delivered." : "Choose a cosmetic to save to your profile.";
                _wallet.text = profile == null ? "PROFILE · unavailable" : "GV · " + FormatGv(profile.Gv) + "   ·   LIFETIME " + FormatGv(profile.GvLifetime);
            }
            RebuildCards();
        }

        bool CanApplyView(long generation, AccountApiService api)
        {
            return IsVisible && generation == _viewGeneration && _owner != null && ReferenceEquals(_owner.Api, api);
        }

        bool CanApply(long generation, AccountApiService api, AccountApiResult result)
        {
            return CanApplyView(generation, api) && api.IsCurrent(result);
        }

        void OnOwnerChanged(AccountHubSnapshot snapshot)
        {
            string selected = snapshot?.SelectedName ?? "";
            if (!string.Equals(selected, _observedName, StringComparison.Ordinal))
            {
                _observedName = selected;
                ++_viewGeneration;
                _currentRead = null;
                _status.text = string.IsNullOrEmpty(selected)
                    ? "Open an owned profile, then choose REFRESH PROFILE to see its cosmetics."
                    : "Account changed · choose REFRESH PROFILE after the owned profile is loaded.";
                _wallet.text = "PROFILE · not loaded";
                if (IsVisible) RebuildCards();
                return;
            }
            if (_currentRead != null && (_owner.Api == null || !_owner.Api.IsCurrent(_currentRead))) _currentRead = null;
            if (UsableProfile(snapshot) == null)
            {
                _wallet.text = "PROFILE · not loaded";
                _status.text = "Load an owned profile first, then choose REFRESH PROFILE to view account cosmetics.";
            }
            if (IsVisible) RebuildCards();
        }

        AccountFullProfile CurrentProfile()
        {
            if (!IsVisible || _owner?.Flow == null || _owner.Api == null) return null;
            if (_currentRead != null && !_owner.Api.IsCurrent(_currentRead)) _currentRead = null;
            return UsableProfile(_owner.Snapshot);
        }

        AccountFullProfile UsableProfile(AccountHubSnapshot snapshot)
        {
            if (snapshot == null || snapshot.State != AccountHubState.Owned ||
                !SameOwner(snapshot.SelectedName, _observedName)) return null;
            var profile = snapshot.FullProfile;
            if (profile == null || !SameOwner(profile.Name, snapshot.SelectedName) || snapshot.Profile == null ||
                !SameOwner(snapshot.Profile.Name, profile.Name)) return null;
            return profile;
        }

        void RebuildCards()
        {
            if (_content == null || _building) return;
            _building = true;
            try
            {
                FocusKey focusKey = CaptureCardFocus(_content,
                    EventSystem.current != null ? EventSystem.current.currentSelectedGameObject : null);
                if (focusKey.IsValid && EventSystem.current != null) EventSystem.current.SetSelectedGameObject(null);
                for (int i = _content.childCount - 1; i >= 0; i--)
                {
                    var oldCard = _content.GetChild(i).gameObject;
                    RetireCard(oldCard); DestroyOwned(oldCard);
                }
                _cards.Clear();
                _owned.Clear(); _equipped.Clear();
                var profile = CurrentProfile();
                if (profile != null)
                {
                    foreach (string id in profile.Cosmetics.Owned) _owned.Add(id);
                    foreach (var pair in profile.Cosmetics.Equipped) _equipped[pair.Key] = pair.Value;
                    _wallet.text = "GV · " + FormatGv(profile.Gv) + "   ·   LIFETIME " + FormatGv(profile.GvLifetime);
                }
                if (!_catalogLoaded)
                {
                    AddNoticeCard("Catalog unavailable", "Cosmetics could not be loaded. Try again shortly.");
                }
                else if (profile == null)
                {
                    AddNoticeCard("Profile required", "Load your callsign to buy or equip cosmetics. You can browse the collection here.");
                    foreach (var item in ItemsForTab()) AddCosmeticCard(item, null, false);
                }
                else
                {
                    var items = ItemsForTab().ToList();
                    foreach (var item in items) AddCosmeticCard(item, profile, true);
                    if (_tab == HubCosmeticsTab.Wardrobe && _slotFilterIndex == 0)
                    {
                        var unknown = profile.Cosmetics.Owned.Where(id => !_catalogById.ContainsKey(id)).Distinct(StringComparer.Ordinal).ToArray();
                        foreach (string id in unknown) AddUnknownOwnedCard(id, profile);
                    }
                    if (_cards.Count == 0) AddNoticeCard("No items in this view", _tab == HubCosmeticsTab.Wardrobe ? "Choose another category." : "No cosmetics match this page yet.");
                    _status.text = MutationSummary(profile) ?? "Choose a cosmetic to buy or equip.";
                }
                UpdateGridLayout();
                Canvas.ForceUpdateCanvases();
                var restoredFocus = ResolveCardFocus(_cards, focusKey);
                if (restoredFocus != null && restoredFocus.gameObject.activeInHierarchy && EventSystem.current != null)
                    EventSystem.current.SetSelectedGameObject(restoredFocus.gameObject);
            }
            finally { _building = false; }
        }

        IEnumerable<AccountCosmeticDefinition> ItemsForTab()
        {
            if (_tab == HubCosmeticsTab.Titles)
                return _titleSlot == null ? Enumerable.Empty<AccountCosmeticDefinition>() : _catalog.Where(item => item.Slot == _titleSlot);
            if (_tab == HubCosmeticsTab.Wardrobe)
            {
                IEnumerable<AccountCosmeticDefinition> wardrobe = _catalog.Where(item => item.Slot != _titleSlot);
                string selected = SelectedWardrobeSlot();
                return selected == null ? wardrobe : wardrobe.Where(item => item.Slot == selected);
            }
            return _catalog;
        }

        string SelectedWardrobeSlot()
        {
            if (_tab != HubCosmeticsTab.Wardrobe || _slotFilterIndex <= 0 || _slotFilterIndex > _wardrobeSlots.Count) return null;
            return _wardrobeSlots[_slotFilterIndex - 1];
        }

        void CycleSlotFilter()
        {
            if (_wardrobeSlots.Count == 0) return;
            _slotFilterIndex = (_slotFilterIndex + 1) % (_wardrobeSlots.Count + 1);
            UpdateSlotFilterVisibility();
            RebuildCards();
            if (EventSystem.current != null) EventSystem.current.SetSelectedGameObject(_slotFilter.gameObject);
        }

        void UpdateSlotFilterVisibility()
        {
            if (_slotFilter == null) return;
            bool visible = _tab == HubCosmeticsTab.Wardrobe;
            _slotFilter.gameObject.SetActive(visible);
            _slotFilterLabel.gameObject.SetActive(visible);
            string slot = SelectedWardrobeSlot();
            string label = slot == null ? "ALL CATALOG SLOTS" : SlotLabel(slot);
            _slotFilter.GetComponentInChildren<TMP_Text>().text = "SLOT  ·  " + label + "  ›";
            _slotFilterLabel.text = _wardrobeSlots.Count == 0 ? "No wearable categories are available." :
                (slot == null ? "Choose a category to browse." : "Showing · " + SlotLabel(slot));
        }

        void UpdateTabs()
        {
            if (_tabButtons == null) return;
            for (int i = 0; i < _tabButtons.Length; i++)
            {
                bool selected = i == (int)_tab;
                var image = _tabButtons[i].GetComponent<Image>();
                image.color = selected ? MythicUi.SelectedFill : ShowcasePalette.PanelRaised;
                var text = _tabButtons[i].GetComponentInChildren<TMP_Text>();
                if (text != null) text.color = selected ? ShowcasePalette.Text : ShowcasePalette.MutedText;
            }
        }

        void AddCosmeticCard(AccountCosmeticDefinition item, AccountFullProfile profile, bool allowMutation)
        {
            var card = NewCard("Cosmetic_" + SafeName(item.Id));
            AddAccent(card, item);
            MythicUi.Text(card, "ItemName", item.Name, new Vector2(.045f, .77f), new Vector2(.96f, .96f), 21, ShowcasePalette.Text).fontStyle = FontStyles.Bold;
            string category = SlotLabel(item.Slot);
            MythicUi.Text(card, "ItemCategory", category, new Vector2(.045f, .64f), new Vector2(.96f, .78f), 13, ShowcasePalette.MutedText);
            var info = CatalogDetails(item);
            MythicUi.Text(card, "CatalogDetails", info, new Vector2(.045f, .29f), new Vector2(.96f, .64f), 15, ShowcasePalette.Text);

            bool owned = profile != null && _owned.Contains(item.Id);
            bool equipped = profile != null && _equipped.TryGetValue(item.Slot, out var current) && current == item.Id;
            string state = item.Price.HasValue ? "Price · " + FormatGv(item.Price.Value) + " GV" : "Not for sale.";
            var op = profile == null ? null : FindLatest(item, _tab == HubCosmeticsTab.Shop ? AccountMutationKind.Purchase : AccountMutationKind.Equip);
            bool submitting = op != null && op.Submitting;
            if (op != null) state = MutationText(op.Operation);
            if (submitting) state = "Waiting for confirmation…";
            if (_tab == HubCosmeticsTab.Wardrobe || _tab == HubCosmeticsTab.Titles)
            {
                if (equipped) state = "Equipped · " + item.Slot + (op != null && op.Operation.State != AccountMutationState.Confirmed ? "  ·  " + MutationText(op.Operation) : "");
                else if (owned && op == null) state = "Owned · ready to equip";
                else if (!owned && op == null) state = "Not owned · wardrobe is read only for this item.";
            }
            MythicUi.Text(card, "ItemState", state, new Vector2(.045f, .07f), new Vector2(.66f, .27f), 14,
                op != null && op.Operation.State == AccountMutationState.Refused ? ShowcasePalette.Warning : ShowcasePalette.MutedText);

            if (!allowMutation || profile == null) return;
            Button action = null;
            bool busy = HasCurrentOwnerMutationInFlight(profile.Name) || submitting;
            if (_tab == HubCosmeticsTab.Shop)
            {
                if (op != null && op.Operation.State == AccountMutationState.Unknown)
                    action = ActionButton(card, "RetrySame", "RETRY SAME PURCHASE", () => Retry(op), !busy);
                else if (owned)
                    action = ActionButton(card, "Owned", "OWNED", null, false);
                else if (item.Price.HasValue)
                    action = ActionButton(card, "Purchase", "REQUEST  " + FormatGv(item.Price.Value) + " GV", () => Purchase(item), !busy && op?.Operation.State != AccountMutationState.InFlight);
                else
                    action = ActionButton(card, "NotForSale", "NO LISTED PRICE", null, false);
            }
            else
            {
                if (op != null && op.Operation.State == AccountMutationState.Unknown)
                    action = ActionButton(card, "RetrySame", "RETRY SAME EQUIP", () => Retry(op), !busy);
                else if (equipped)
                    action = ActionButton(card, "Unequip", "UNEQUIP  ·  " + SlotLabel(item.Slot), () => Equip(item.Slot, null), !busy && op?.Operation.State != AccountMutationState.InFlight);
                else if (owned)
                    action = ActionButton(card, "Equip", "EQUIP  ·  " + SlotLabel(item.Slot), () => Equip(item.Slot, item.Id), !busy && op?.Operation.State != AccountMutationState.InFlight);
                else
                    action = ActionButton(card, "NotOwned", "NOT OWNED", null, false);
            }
            if (op != null && (op.Operation.State == AccountMutationState.InFlight || submitting) && action != null)
                action.GetComponentInChildren<TMP_Text>().text = "REQUEST IN FLIGHT";
        }

        void AddUnknownOwnedCard(string id, AccountFullProfile profile)
        {
            var card = NewCard("UnknownOwned_" + SafeName(id));
            AddAccent(card, null);
            MythicUi.Text(card, "UnknownTitle", "Unknown owned cosmetic", new Vector2(.045f, .75f), new Vector2(.96f, .96f), 20, ShowcasePalette.Gold);
            MythicUi.Text(card, "UnknownId", id, new Vector2(.045f, .56f), new Vector2(.96f, .78f), 15, ShowcasePalette.Text);
            bool equipped = profile.Cosmetics.Equipped.Values.Contains(id, StringComparer.Ordinal);
            MythicUi.Text(card, "UnknownStatus", equipped
                ? "Owned and equipped · no matching catalog definition is available here."
                : "Owned · no matching catalog definition is available here. This entry is read only.",
                new Vector2(.045f, .08f), new Vector2(.96f, .52f), 15, ShowcasePalette.MutedText);
        }

        void AddNoticeCard(string title, string message)
        {
            var card = NewCard("Notice_" + SafeName(title));
            MythicUi.Text(card, "NoticeTitle", title, new Vector2(.045f, .68f), new Vector2(.96f, .94f), 22, ShowcasePalette.Gold);
            MythicUi.Text(card, "NoticeMessage", message, new Vector2(.045f, .10f), new Vector2(.96f, .70f), 17, ShowcasePalette.Text);
        }

        RectTransform NewCard(string name)
        {
            var card = MythicUi.Panel(_content, name, Vector2.zero, Vector2.one, ShowcasePalette.PanelRaised, false);
            card.gameObject.AddComponent<LayoutElement>().minHeight = 180;
            var outline = card.gameObject.AddComponent<Outline>();
            outline.effectColor = ShowcasePalette.PanelStroke; outline.effectDistance = new Vector2(1, -1); outline.useGraphicAlpha = true;
            _cards.Add(card.gameObject);
            return card;
        }

        void AddAccent(RectTransform card, AccountCosmeticDefinition item)
        {
            if (item != null && item.Color.HasValue)
            {
                Color32 color = ToColor(item.Color.Value);
                var swatch = MythicUi.Rect(card, "CatalogColorSample", new Vector2(.045f, .80f), new Vector2(.075f, .93f));
                var image = swatch.gameObject.AddComponent<Image>(); image.color = color; image.raycastTarget = false;
                MythicUi.Text(card, "CatalogColorLabel", "COLOR PREVIEW", new Vector2(.08f, .80f), new Vector2(.36f, .93f), 11, ShowcasePalette.MutedText);
            }
            else
            {
                var bar = MythicUi.Rect(card, "GoldAccent", new Vector2(.045f, .925f), new Vector2(.25f, .945f));
                var image = bar.gameObject.AddComponent<Image>(); image.color = ShowcasePalette.GoldDim; image.raycastTarget = false;
            }
        }

        string CatalogDetails(AccountCosmeticDefinition item)
        {
            var parts = new List<string>();
            if (item.Text != null) parts.Add("Title text · " + item.Text);
            if (item.Target != null) parts.Add("For · " + SlotLabel(item.Target));
            if (item.Style != null) parts.Add("Style · " + SlotLabel(item.Style));
            if (item.Width.HasValue) parts.Add("Line width · " + item.Width.Value.ToString("0.##", CultureInfo.InvariantCulture));
            if (parts.Count == 0) parts.Add("Cosmetic appearance preview.");
            return string.Join("\n", parts);
        }

        Button ActionButton(Transform parent, string name, string label, Action onClick, bool interactable = true)
        {
            var button = MythicUi.Button(parent, name, label, new Vector2(.69f, .075f), new Vector2(.96f, .255f), () => onClick?.Invoke(),
                interactable ? MythicUi.ButtonStyle.Primary : MythicUi.ButtonStyle.Secondary);
            button.interactable = interactable;
            button.navigation = Navigation.defaultNavigation;
            return button;
        }

        MutationEntry FindLatest(AccountCosmeticDefinition item, AccountMutationKind kind)
        {
            AccountApiService api = _owner != null ? _owner.Api : null;
            if (api == null) return null;
            string slot = kind == AccountMutationKind.Equip ? item.Slot : null;
            for (int i = _mutations.Count - 1; i >= 0; i--)
            {
                var operation = _mutations[i].Operation;
                bool sameItem = kind == AccountMutationKind.Purchase ? operation.ItemId == item.Id :
                    operation.ItemId == item.Id || (operation.ItemId == null && _equipped.TryGetValue(item.Slot, out var active) && active == item.Id);
                if (operation.Kind == kind && operation.Slot == slot && sameItem &&
                    SameOwner(operation.Name, _observedName) && api.IsCurrentOwner(operation))
                    return _mutations[i];
            }
            return null;
        }

        bool HasCurrentOwnerMutationInFlight(string ownerName)
        {
            AccountApiService api = _owner != null ? _owner.Api : null;
            if (api == null) return false;
            for (int i = 0; i < _mutations.Count; i++)
            {
                AccountMutation operation = _mutations[i].Operation;
                if ((_mutations[i].Submitting || operation.State == AccountMutationState.InFlight) &&
                    SameOwner(operation.Name, ownerName) && api.IsCurrentOwner(operation)) return true;
            }
            return false;
        }

        void Purchase(AccountCosmeticDefinition item)
        {
            var profile = CurrentProfile();
            if (profile == null || _owner.Api == null || _owned.Contains(item.Id) || !item.Price.HasValue || HasCurrentOwnerMutationInFlight(profile.Name)) return;
            var operation = _owner.Api.CreatePurchase(item.Id);
            var entry = new MutationEntry { Operation = operation };
            _mutations.Add(entry);
            SendMutation(entry);
        }

        void Equip(string slot, string itemId)
        {
            var profile = CurrentProfile();
            if (profile == null || _owner.Api == null || !CanSubmitEquip(slot, itemId, _owned, _equipped) || HasCurrentOwnerMutationInFlight(profile.Name)) return;
            var operation = _owner.Api.CreateEquip(slot, itemId);
            var entry = new MutationEntry { Operation = operation };
            _mutations.Add(entry);
            SendMutation(entry);
        }

        internal static bool CanSubmitEquip(string slot, string itemId, ICollection<string> owned, IDictionary<string, string> equipped)
        {
            if (string.IsNullOrEmpty(slot) || owned == null || equipped == null) return false;
            if (itemId == null) return equipped.TryGetValue(slot, out var current) && !string.IsNullOrEmpty(current);
            return owned.Contains(itemId);
        }

        internal static FocusKey CaptureCardFocus(Transform content, GameObject selected)
        {
            if (content == null || selected == null) return default;
            Transform cursor = selected.transform;
            while (cursor != null && cursor.parent != content) cursor = cursor.parent;
            if (cursor == null || cursor.parent != content) return default;
            string path = "";
            Transform node = selected.transform;
            while (node != cursor)
            {
                path = string.IsNullOrEmpty(path) ? node.name : node.name + "/" + path;
                node = node.parent;
            }
            return new FocusKey(cursor.name, path);
        }

        internal static Transform ResolveCardFocus(IReadOnlyList<GameObject> liveCards, FocusKey key)
        {
            if (liveCards == null || !key.IsValid) return null;
            foreach (var live in liveCards)
            {
                if (live == null || live.name != key.CardName) continue;
                return string.IsNullOrEmpty(key.ChildPath) ? live.transform : live.transform.Find(key.ChildPath);
            }
            return null;
        }

        internal static void RetireCard(GameObject card)
        {
            // Destroy is deferred in players. Exclude old rows from rendering, input and layout immediately,
            // while leaving the object active so an in-progress Button.OnSubmit can finish safely.
            var layout = card.GetComponent<UnityEngine.UI.LayoutElement>();
            if (layout == null) layout = card.AddComponent<UnityEngine.UI.LayoutElement>();
            layout.ignoreLayout = true;
            var group = card.GetComponent<UnityEngine.CanvasGroup>();
            if (group == null) group = card.AddComponent<UnityEngine.CanvasGroup>();
            group.alpha = 0; group.interactable = false; group.blocksRaycasts = false;
        }

        void RenderProfileGuidance()
        {
            if (_owner?.Api == null || _owner.Flow == null)
            {
                _status.text = "Account services are unavailable on this page.";
                _wallet.text = "PROFILE · unavailable";
            }
            else if (_owner.Snapshot?.State == AccountHubState.Owned && _owner.Snapshot.Profile != null)
            {
                _status.text = "Choose REFRESH PROFILE to load the saved cosmetics and wallet.";
                _wallet.text = "PROFILE · ready to refresh";
            }
            else
            {
                _status.text = "Load an owned profile first, then choose REFRESH PROFILE to view account cosmetics.";
                _wallet.text = "PROFILE · not loaded";
            }
            RebuildCards();
        }

        void Retry(MutationEntry entry)
        {
            var profile = CurrentProfile();
            AccountApiService api = _owner != null ? _owner.Api : null;
            if (entry == null || profile == null || api == null || entry.Operation.State != AccountMutationState.Unknown ||
                !api.IsCurrentOwner(entry.Operation) ||
                !SameOwner(entry.Operation.Name, profile.Name) || HasCurrentOwnerMutationInFlight(profile.Name)) return;
            SendMutation(entry); // Keep the original AccountMutation reference and purchase UUID.
        }

        async void SendMutation(MutationEntry entry)
        {
            var api = _owner != null ? _owner.Api : null;
            if (api == null || entry == null || !CanMutateCurrentOwner(api)) return;
            long generation = _viewGeneration;
            entry.Submitting = true;
            Task<AccountApiResult> pending;
            try { pending = api.SendAsync(entry.Operation); }
            catch
            {
                entry.Submitting = false;
                if (CanApplyView(generation, api)) RebuildCards();
                return;
            }
            if (CanApplyView(generation, api)) RebuildCards();
            AccountApiResult result;
            try { result = await pending; }
            catch
            {
                entry.Submitting = false;
                if (CanApplyView(generation, api)) RebuildCards();
                return;
            }
            entry.Submitting = false;
            // Keep a current result with its operation for later rendering, but never publish it into a stale/hidden view.
            if (!api.IsCurrent(result))
            {
                if (CanApplyView(generation, api)) RebuildCards();
                return;
            }
            entry.Result = result;
            if (!CanApplyView(generation, api)) return;
            RebuildCards();
        }

        bool CanMutateCurrentOwner(AccountApiService api)
        {
            var profile = CurrentProfile();
            return profile != null && api != null && ReferenceEquals(_owner.Api, api) &&
                (_currentRead == null || api.IsCurrent(_currentRead)) &&
                !HasCurrentOwnerMutationInFlight(profile.Name);
        }

        string MutationSummary(AccountFullProfile profile)
        {
            AccountApiService api = _owner != null ? _owner.Api : null;
            if (api == null) return null;
            for (int i = _mutations.Count - 1; i >= 0; i--)
            {
                var operation = _mutations[i].Operation;
                if (!SameOwner(operation.Name, profile.Name) || !api.IsCurrentOwner(operation)) continue;
                if (_mutations[i].Result != null && !api.IsCurrent(_mutations[i].Result)) continue;
                if (_mutations[i].Submitting) return "Account request queued or in flight · do not submit a duplicate.";
                if (operation.State == AccountMutationState.Unknown)
                    return "Confirmation was interrupted. Retry resubmits this change.";
                if (operation.State == AccountMutationState.Refused) return ErrorText(operation.Error);
                if (operation.State == AccountMutationState.InFlight) return "Waiting for confirmation…";
                if (operation.State == AccountMutationState.Confirmed) return "Saved to your profile.";
            }
            return null;
        }

        static string MutationText(AccountMutation operation)
        {
            switch (operation.State)
            {
                case AccountMutationState.Ready: return "Ready · request has not been sent.";
                case AccountMutationState.InFlight: return "Waiting for confirmation…";
                case AccountMutationState.Confirmed: return "Saved to your profile.";
                case AccountMutationState.Unknown: return "Confirmation interrupted · Retry resubmits this change.";
                case AccountMutationState.Refused: return ErrorText(operation.Error);
                default: return "No request has been sent.";
            }
        }

        static string ErrorText(AccountApiError error)
        {
            if (error == null) return "Request refused by the account service.";
            if (error.Failure == AccountApiFailure.InsufficientGv && error.Need.HasValue && error.Have.HasValue)
                return "Not enough GV · Need " + FormatGv(error.Need.Value) + " GV · Have " + FormatGv(error.Have.Value) + " GV.";
            switch (error.Failure)
            {
                case AccountApiFailure.Forbidden: return "The account service refused this request.";
                case AccountApiFailure.PasscodeRequired: return "Open the profile with its required passcode before retrying.";
                case AccountApiFailure.UnknownCosmetic: return "This item is unavailable.";
                case AccountApiFailure.UnknownSlot: return "This category is unavailable.";
                case AccountApiFailure.NotForSale: return "This cosmetic is not for sale.";
                case AccountApiFailure.AlreadyOwned: return "You already own this cosmetic.";
                case AccountApiFailure.NotOwned: return "You do not own this cosmetic.";
                case AccountApiFailure.SlotMismatch: return "This cosmetic cannot be equipped in that category.";
                case AccountApiFailure.RateLimited: return "Too many requests. Wait a moment and try again.";
                case AccountApiFailure.BadRequest: return "This change could not be submitted. Refresh your profile and try again.";
                case AccountApiFailure.Unreadable: return "The account response could not be read.";
                default: return "The account service did not confirm this request.";
            }
        }

        static string AccountFailureText(AccountApiFailure failure)
        {
            switch (failure)
            {
                case AccountApiFailure.NoOwner: return "Open an owned profile to see account cosmetics.";
                case AccountApiFailure.PasscodeRequired: return "Open the profile with its required passcode.";
                case AccountApiFailure.Forbidden: return "This profile could not be opened.";
                case AccountApiFailure.BadRequest: return "The selected profile details are invalid.";
                case AccountApiFailure.RateLimited: return "Too many requests. Wait a moment and try again.";
                case AccountApiFailure.Unreadable: return "A complete account profile was not available.";
                default: return "Profile refresh failed. Try again when the account service is available.";
            }
        }

        void UpdateGridLayout()
        {
            if (_grid == null) return;
            float available = _panel != null && _panel.rect.width > 0 ? _panel.rect.width - 42 : Screen.width * .61f - 42;
            if (available < 320) available = 560;
            int columns = available >= 940 && _textScale <= 1.15f ? 2 : 1;
            float gap = 12;
            _grid.constraint = GridLayoutGroup.Constraint.FixedColumnCount;
            _grid.constraintCount = columns;
            _grid.cellSize = new Vector2(Mathf.Max(260, (available - gap * (columns - 1) - 16) / columns), (columns == 2 ? 246 : 220) * _textScale);
            _grid.spacing = new Vector2(gap, gap);
            _grid.padding = new RectOffset(8, 8, 8, 12);
        }

        void DestroyOwned(GameObject go)
        {
            if (Application.isPlaying) Destroy(go); else DestroyImmediate(go);
        }

        static bool SameOwner(string left, string right)
        {
            try { return AccountEndpoint.NormalizeName(left) == AccountEndpoint.NormalizeName(right); }
            catch (ArgumentException) { return false; }
        }

        static Color32 ToColor(uint value) => new Color32((byte)(value >> 16), (byte)(value >> 8), (byte)value, 255);
        static string FormatGv(long value) => value.ToString("N0", CultureInfo.InvariantCulture);
        static string SlotLabel(string slot) => string.IsNullOrEmpty(slot) ? "UNKNOWN SLOT" : slot.Replace('-', ' ').Replace('_', ' ').ToUpperInvariant();
        static string SafeName(string value) => string.IsNullOrEmpty(value) ? "Empty" : value.Replace('/', '_').Replace(' ', '_');

        void OnDestroy()
        {
            if (_owner?.Flow != null) _owner.Flow.Changed -= OnOwnerChanged;
            ++_viewGeneration;
        }
    }
}

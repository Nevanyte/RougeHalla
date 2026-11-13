using System;
using TMPro;
using UnityEngine;
using UnityEngine.EventSystems;
using Roguehalla.Net;
using Roguehalla.Net.Protocol;

namespace Roguehalla.Client
{
    /// <summary>
    /// Optional Training controls beneath an existing Canvas. It forwards ordinary server intents;
    /// the owner must explicitly confirm the same Session's accepted Training launch each epoch.
    /// </summary>
    public sealed class TrainingConsoleView : MonoBehaviour
    {
        RectTransform _root, _panel;
        Transform _container;
        TMP_Text _mobLabel, _cardLabel, _copiesLabel, _cardDescription, _status;
        TMP_InputField _stacks;
        UnityEngine.UI.Button _toggle, _close, _mobPrevious, _mobNext, _cardPrevious, _cardNext, _copiesPrevious, _copiesNext;
        UnityEngine.UI.Button _camp, _stat, _card, _chosenChest, _randomChest, _clear;
        UnityEngine.UI.Button[] _interactiveButtons;
        string[] _copyLabels;
        Session _session;
        Action<SessionState> _stateListener;
        Action<ServerMsg.Snapshot> _snapshotListener;
        Action _timelineListener;
        uint _epoch;
        int _subscriptionGeneration, _actionGeneration, _mobIndex, _cardIndex, _copiesIndex;
        bool _initialized, _confirmed, _opened, _destroyed, _listening;
        string _feedback = "";

        public RectTransform Root => OwnerAlive() ? _root : null;
        public RectTransform Panel => OwnerAlive() ? _panel : null;
        /// <summary>The owning HUD can retain input ownership through a same-update open/close.</summary>
        public event Action OpenStateChanged;
        public bool IsOpen => OwnerAlive() && _opened && _panel != null && _panel.gameObject.activeSelf;
        public bool ActionsAvailable => OwnerAlive() && _initialized && _root != null && _panel != null &&
            _container != null && _container.gameObject.activeInHierarchy && isActiveAndEnabled && _confirmed && AcceptedTraining(_session, _epoch);
        public bool ContainsFocus
        {
            get
            {
                if (!OwnerAlive()) return false;
                var selected = EventSystem.current != null ? EventSystem.current.currentSelectedGameObject : null;
                return _root != null && selected != null && selected.activeInHierarchy && selected.transform.IsChildOf(_root);
            }
        }

        public void Initialize(Transform canvasRoot)
        {
            if (_initialized) throw new InvalidOperationException("TrainingConsoleView is already initialized.");
            if (canvasRoot == null) throw new ArgumentNullException(nameof(canvasRoot));
            var canvas = canvasRoot.GetComponentInParent<Canvas>();
            if (canvas == null || canvas.GetComponent<UnityEngine.UI.GraphicRaycaster>() == null)
                throw new ArgumentException("An existing Canvas with a GraphicRaycaster is required.", nameof(canvasRoot));
            _container = canvasRoot;

            // The unfilled root is click-through. The collapsed console has only one interactive button.
            _root = MythicUi.Rect(canvasRoot, "TrainingConsole", new Vector2(.015f, .18f), new Vector2(.48f, .88f));
            _toggle = Button(_root, "ConsoleToggle", "CONSOLE", new Vector2(0, 0), new Vector2(.32f, .10f));
            _panel = MythicUi.Panel(_root, "Panel", new Vector2(0, .12f), Vector2.one, ShowcasePalette.Panel, false);
            MythicUi.Border(_panel, ShowcasePalette.PanelStroke);
            MythicUi.Text(_panel, "Title", "TRAINING CONSOLE", new Vector2(.025f, .89f), new Vector2(.76f, .99f), 20, ShowcasePalette.Gold, heading: true);
            _close = Button(_panel, "Close", "CLOSE", new Vector2(.78f, .90f), new Vector2(.975f, .985f));

            var scrollRoot = MythicUi.Rect(_panel, "Scroll", new Vector2(.02f, .16f), new Vector2(.98f, .885f));
            var scroll = scrollRoot.gameObject.AddComponent<UnityEngine.UI.ScrollRect>();
            scroll.horizontal = false; scroll.vertical = true; scroll.inertia = false;
            scroll.movementType = UnityEngine.UI.ScrollRect.MovementType.Clamped; scroll.scrollSensitivity = 36;
            var viewport = MythicUi.Rect(scrollRoot, "Viewport", Vector2.zero, Vector2.one);
            var viewportImage = viewport.gameObject.AddComponent<UnityEngine.UI.Image>();
            viewportImage.color = Color.white; viewportImage.raycastTarget = true;
            viewport.gameObject.AddComponent<UnityEngine.UI.Mask>().showMaskGraphic = false;
            var content = MythicUi.Rect(viewport, "Content", new Vector2(0, 1), Vector2.one);
            content.pivot = new Vector2(.5f, 1);
            var layout = content.gameObject.AddComponent<UnityEngine.UI.VerticalLayoutGroup>();
            layout.padding = new RectOffset(8, 8, 6, 6); layout.spacing = 8;
            layout.childControlWidth = true; layout.childControlHeight = true;
            layout.childForceExpandWidth = true; layout.childForceExpandHeight = false;
            content.gameObject.AddComponent<UnityEngine.UI.ContentSizeFitter>().verticalFit = UnityEngine.UI.ContentSizeFitter.FitMode.PreferredSize;
            viewport.offsetMax = new Vector2(-14, 0);
            var barRoot = MythicUi.Rect(scrollRoot, "Scrollbar", new Vector2(1, 0), Vector2.one);
            var track = barRoot.gameObject.AddComponent<UnityEngine.UI.Image>(); track.color = ShowcasePalette.PanelRaised;
            barRoot.pivot = new Vector2(1, .5f); barRoot.sizeDelta = new Vector2(12, 0); barRoot.anchoredPosition = Vector2.zero;
            var slide = MythicUi.Rect(barRoot, "Sliding Area", Vector2.zero, Vector2.one);
            var handle = MythicUi.Rect(slide, "Handle", Vector2.zero, Vector2.one);
            var handleImage = handle.gameObject.AddComponent<UnityEngine.UI.Image>(); handleImage.color = ShowcasePalette.Gold;
            handle.offsetMin = handle.offsetMax = Vector2.zero;
            var bar = barRoot.gameObject.AddComponent<UnityEngine.UI.Scrollbar>();
            bar.handleRect = handle; bar.direction = UnityEngine.UI.Scrollbar.Direction.BottomToTop;
            bar.targetGraphic = handleImage;
            scroll.viewport = viewport; scroll.content = content;
            scroll.verticalScrollbar = bar;
            scroll.verticalScrollbarVisibility = UnityEngine.UI.ScrollRect.ScrollbarVisibility.Permanent;
            scrollRoot.gameObject.AddComponent<KeyboardScrollPane>().Initialize(scroll);

            var mobRow = Row(content, "MobChoice", 90);
            Selection(mobRow, "Mob type", "Mob", out _mobPrevious, out _mobLabel, out _mobNext);
            _camp = Button(Row(content, "CampRow", 48), "CampAction", "SPAWN CAMP", Vector2.zero, Vector2.one);
            var statRow = Row(content, "StacksRow", 100);
            MythicUi.Text(statRow, "Label", "Kill stacks · server intent", new Vector2(0, .62f), Vector2.one, 15, ShowcasePalette.MutedText);
            var inputRoot = MythicUi.Panel(statRow, "StackInput", new Vector2(0, .04f), new Vector2(.60f, .60f), ShowcasePalette.PanelRaised);
            var inputViewport = MythicUi.Rect(inputRoot, "Viewport", new Vector2(.03f, .04f), new Vector2(.97f, .96f));
            inputViewport.gameObject.AddComponent<UnityEngine.UI.RectMask2D>();
            var inputText = MythicUi.Text(inputViewport, "Text", "", Vector2.zero, Vector2.one, 17);
            inputText.enableAutoSizing = false;
            _stacks = inputRoot.gameObject.AddComponent<TMP_InputField>();
            _stacks.textViewport = inputViewport; _stacks.textComponent = (TextMeshProUGUI)inputText;
            _stacks.lineType = TMP_InputField.LineType.SingleLine;
            // Keep the complete entered string: character filtering/truncation could turn invalid input into another number.
            _stacks.characterValidation = TMP_InputField.CharacterValidation.None; _stacks.characterLimit = 0;
            _stacks.SetTextWithoutNotify("1");
            _stat = Button(statRow, "StatAction", "SET STACKS", new Vector2(.63f, .04f), new Vector2(1, .60f));

            var cardRow = Row(content, "CardChoice", 90);
            Selection(cardRow, "Interactive augment", "Card", out _cardPrevious, out _cardLabel, out _cardNext);
            var copiesRow = Row(content, "CopiesChoice", 90);
            Selection(copiesRow, "Copies · server intent", "Copies", out _copiesPrevious, out _copiesLabel, out _copiesNext);
            _card = Button(Row(content, "CardRow", 48), "CardAction", "SET CARD", Vector2.zero, Vector2.one);
            _cardDescription = FlowText(content, "CardDescription", "", 14);
            _cardDescription.enableAutoSizing = false;
            var chestRow = Row(content, "ChestRow", 52);
            _chosenChest = Button(chestRow, "ChosenChestAction", "CHEST WITH AUGMENT", Vector2.zero, new Vector2(.60f, 1));
            _randomChest = Button(chestRow, "RandomChestAction", "RANDOM CHEST", new Vector2(.62f, 0), Vector2.one);
            _clear = Button(Row(content, "ClearRow", 48), "ClearAction", "CLEAR ALL", Vector2.zero, Vector2.one);
            FlowText(content, "AuthorityNote", "Requests use the ordinary Training input path. The server decides whether and how they apply. Mob stacks must be a complete nonnegative safe integer.", 13);
            _status = MythicUi.Text(_panel, "Status", "Choose a server intent.", new Vector2(.025f, .015f), new Vector2(.975f, .15f), 14, ShowcasePalette.MutedText);
            _interactiveButtons = new[] { _close, _mobPrevious, _mobNext, _cardPrevious, _cardNext, _copiesPrevious, _copiesNext, _camp, _stat, _card, _chosenChest, _randomChest, _clear };
            _copyLabels = new string[TrainingConsoleSelectors.CardCountChoices.Count];
            for (int i = 0; i < _copyLabels.Length; i++)
            {
                int count = TrainingConsoleSelectors.CardCountChoices[i];
                _copyLabels[i] = count == 0 ? "Remove" : count + (count == 1 ? " copy" : " copies");
            }
            _initialized = true;
            ResetSelections(); WireControls(); Refresh();
        }

        public void Bind(Session session)
        {
            if (!OwnerAlive()) return;
            if (!_initialized) throw new InvalidOperationException("Initialize the view before binding a Session.");
            if (ReferenceEquals(_session, session)) { Refresh(); return; }
            Detach(); _session = session; _epoch = session == null ? 0 : session.TimelineEpoch;
            Revoke();
            if (isActiveAndEnabled) Attach();
            Refresh();
        }

        /// <summary>Called by the launch owner after matching accepted facts, never inferred from URL/default flags.</summary>
        public bool SetLaunchContext(Session session, uint epoch, MatchLaunchMode? confirmedMode)
        {
            if (!OwnerAlive() || !ReferenceEquals(session, _session) || session == null || epoch != session.TimelineEpoch || epoch != _epoch)
                return false;
            if (confirmedMode != MatchLaunchMode.Training || !AcceptedTraining(session, epoch))
            { Revoke(); Refresh(); return false; }
            if (!_confirmed) { _confirmed = true; _actionGeneration++; WireControls(); }
            Refresh(); return ActionsAvailable;
        }

        public bool SetOpen(bool open)
        {
            if (!OwnerAlive()) return false;
            Refresh();
            if (open && !ActionsAvailable) return false;
            if (_opened == open) return true;
            if (!open) ReleaseFocus();
            _opened = open; _actionGeneration++;
            if (_panel != null) _panel.gameObject.SetActive(open && ActionsAvailable);
            WireControls(); UpdateControls(); OpenStateChanged?.Invoke(); return true;
        }

        /// <summary>The owner consumes this Escape only when true; the following Escape remains its ordinary Leave action.</summary>
        public bool HandleEscape() { if (!IsOpen) return false; SetOpen(false); return true; }

        public void Refresh()
        {
            if (!OwnerAlive() || !_initialized || _root == null) return;
            if (_session != null && _epoch != _session.TimelineEpoch) { _epoch = _session.TimelineEpoch; Revoke(); }
            if (_confirmed && !AcceptedTraining(_session, _epoch)) Revoke();
            bool allowed = ActionsAvailable;
            if (!allowed && _opened) { ReleaseFocus(); _opened = false; }
            _root.gameObject.SetActive(allowed);
            _panel.gameObject.SetActive(allowed && _opened);
            UpdateControls();
        }

        public bool SelectMob(int index)
        {
            if (!CanAct() || index < 0 || index >= TrainingConsoleSelectors.MobChoices.Count) return false;
            _mobIndex = index; SelectionChanged(); return true;
        }
        public bool SelectCard(int index)
        {
            if (!CanAct() || index < 0 || index >= TrainingConsoleSelectors.InteractiveCardIndices.Count) return false;
            _cardIndex = index; SelectionChanged(); return true;
        }
        public bool SelectCopies(int index)
        {
            if (!CanAct() || index < 0 || index >= TrainingConsoleSelectors.CardCountChoices.Count) return false;
            _copiesIndex = index; SelectionChanged(); return true;
        }
        public bool SetStatText(string text)
        {
            if (!CanAct() || _stacks == null) return false;
            _stacks.SetTextWithoutNotify(text ?? ""); SelectionChanged(); return true;
        }
        public bool TrySpawnCamp() => QueueCurrent(3, TrainingConsoleSelectors.MobChoices[_mobIndex].Position, 0, null);
        public bool TrySetCard() => QueueCurrent(1, TrainingConsoleSelectors.InteractiveCardIndices[_cardIndex], (ulong)TrainingConsoleSelectors.CardCountChoices[_copiesIndex], null);
        public bool TrySetStacks()
        {
            if (!CanAct()) return false;
            if (!TrainingConsoleSelectors.TryParseNonnegativeSafeInteger(_stacks.text, out ulong value))
            { SetFeedback("Enter a complete nonnegative safe integer; nothing queued."); return false; }
            return QueueCurrent(2, TrainingConsoleSelectors.MobChoices[_mobIndex].Position, value, null);
        }
        public bool TryDropChest(bool chosen) => QueueCurrent(4, 0, 0, chosen ? new[] { TrainingConsoleSelectors.InteractiveCardIndices[_cardIndex] } : null);
        public bool TryClear() => QueueCurrent(5, 0, 0, null);

        bool QueueCurrent(byte command, uint id, ulong count, byte[] options)
        {
            if (!CanAct()) return false;
            var session = _session; uint epoch = _epoch; int generation = _actionGeneration;
            session.Input.Train(command, id, count, options);
            // Ordinary FlushInput also sends any earlier pending commands, in their existing order/batches.
            // No console-owned pending command is carried to a later view rebind.
            try { session.FlushInput(); }
            catch (Exception)
            {
                if (CurrentAction(session, epoch, generation, true)) SetFeedback("Send error; application is unknown.");
                return false;
            }
            if (CurrentAction(session, epoch, generation, true)) SetFeedback("Request sent; server outcome unconfirmed.");
            return true;
        }

        bool CanAct() => IsOpen && ActionsAvailable;
        bool AcceptedTraining(Session session, uint epoch) => session != null && ReferenceEquals(session, _session) &&
            session.TimelineEpoch == epoch && session.State == SessionState.InMatch && session.Phase.HasValue && session.Training && session.LastResult == null;
        bool CurrentAction(Session session, uint epoch, int generation, bool requireOpen) =>
            OwnerAlive() && generation == _actionGeneration && epoch == _epoch && ReferenceEquals(session, _session) &&
            ActionsAvailable && AcceptedTraining(session, epoch) && (!requireOpen || IsOpen);

        void Attach()
        {
            if (!OwnerAlive() || _session == null || _listening) return;
            var session = _session; int generation = ++_subscriptionGeneration;
            Func<bool> current = () => OwnerAlive() && generation == _subscriptionGeneration && ReferenceEquals(session, _session);
            _stateListener = state => { if (!current()) return; if (state != SessionState.InMatch) Revoke(); Refresh(); };
            _snapshotListener = snap => { if (current()) Refresh(); };
            _timelineListener = () => { if (!current()) return; _epoch = session.TimelineEpoch; Revoke(); Refresh(); };
            session.StateChanged += _stateListener; session.SnapshotReceived += _snapshotListener; session.TimelineReset += _timelineListener;
            _listening = true;
        }
        void Detach()
        {
            _subscriptionGeneration++;
            if (_session != null && _listening)
            {
                _session.StateChanged -= _stateListener; _session.SnapshotReceived -= _snapshotListener; _session.TimelineReset -= _timelineListener;
            }
            _stateListener = null; _snapshotListener = null; _timelineListener = null; _listening = false;
        }
        void Revoke()
        {
            ReleaseFocus(); _confirmed = false; _opened = false; _feedback = ""; _actionGeneration++;
            ResetSelections(); WireControls();
            if (_panel != null) _panel.gameObject.SetActive(false);
        }
        void ResetSelections()
        {
            _mobIndex = _cardIndex = _copiesIndex = 0;
            if (_stacks != null) _stacks.SetTextWithoutNotify("1");
        }
        void SelectionChanged() { _feedback = ""; _actionGeneration++; WireControls(); UpdateControls(); }
        void OnStackTextChanged(string value) { if (!_destroyed) SelectionChanged(); }
        void OnStackEndEdit(string value) { if (_stacks != null) _stacks.DeactivateInputField(); ReleaseFocus(); }

        void WireControls()
        {
            if (!OwnerAlive() || !_initialized) return;
            var session = _session; uint epoch = _epoch; int generation = _actionGeneration;
            void Wire(UnityEngine.UI.Button button, Action action, bool requireOpen = true)
            {
                // Retained event objects must keep their retired binding, rather than borrowing new listeners.
                button.onClick = new UnityEngine.UI.Button.ButtonClickedEvent();
                button.onClick.AddListener(() => { if (CurrentAction(session, epoch, generation, requireOpen)) action(); });
            }
            _stacks.onValueChanged = new TMP_InputField.OnChangeEvent();
            _stacks.onEndEdit = new TMP_InputField.SubmitEvent();
            _stacks.onValueChanged.AddListener(value => { if (CurrentAction(session, epoch, generation, true)) OnStackTextChanged(value); });
            _stacks.onEndEdit.AddListener(value => { if (CurrentAction(session, epoch, generation, true)) OnStackEndEdit(value); });
            Wire(_toggle, () => SetOpen(!_opened), false); Wire(_close, () => SetOpen(false));
            Wire(_mobPrevious, () => SelectMob((_mobIndex + TrainingConsoleSelectors.MobChoices.Count - 1) % TrainingConsoleSelectors.MobChoices.Count));
            Wire(_mobNext, () => SelectMob((_mobIndex + 1) % TrainingConsoleSelectors.MobChoices.Count));
            Wire(_cardPrevious, () => SelectCard((_cardIndex + TrainingConsoleSelectors.InteractiveCardIndices.Count - 1) % TrainingConsoleSelectors.InteractiveCardIndices.Count));
            Wire(_cardNext, () => SelectCard((_cardIndex + 1) % TrainingConsoleSelectors.InteractiveCardIndices.Count));
            Wire(_copiesPrevious, () => SelectCopies((_copiesIndex + TrainingConsoleSelectors.CardCountChoices.Count - 1) % TrainingConsoleSelectors.CardCountChoices.Count));
            Wire(_copiesNext, () => SelectCopies((_copiesIndex + 1) % TrainingConsoleSelectors.CardCountChoices.Count));
            Wire(_camp, () => TrySpawnCamp()); Wire(_stat, () => TrySetStacks()); Wire(_card, () => TrySetCard());
            Wire(_chosenChest, () => TryDropChest(true)); Wire(_randomChest, () => TryDropChest(false)); Wire(_clear, () => TryClear());
        }
        void UpdateControls()
        {
            if (!OwnerAlive() || !_initialized || _root == null) return;
            _toggle.interactable = ActionsAvailable;
            foreach (var button in _interactiveButtons)
                button.interactable = ActionsAvailable && _opened;
            _stacks.interactable = ActionsAvailable && _opened;
            _mobLabel.text = TrainingConsoleSelectors.MobChoices[_mobIndex].Name;
            byte card = TrainingConsoleSelectors.InteractiveCardIndices[_cardIndex];
            _cardLabel.text = CardDisplayCatalog.Title(card);
            _copiesLabel.text = _copyLabels[_copiesIndex];
            _cardDescription.text = CardDisplayCatalog.Get(card).Description;
            _status.text = String.IsNullOrEmpty(_feedback) ? "Choose a server intent. The server decides." : _feedback;
        }
        void SetFeedback(string text) { _feedback = text; if (_status != null) _status.text = text; }
        void ReleaseFocus() => ReleaseFocus(_root);
        static void ReleaseFocus(Transform root)
        {
            if (root == null || EventSystem.current == null) return;
            var selected = EventSystem.current.currentSelectedGameObject;
            if (selected == null || !selected.transform.IsChildOf(root)) return;
            selected.GetComponent<TMP_InputField>()?.DeactivateInputField();
            EventSystem.current.SetSelectedGameObject(null);
        }
        void OnEnable() { if (_initialized) { Attach(); Refresh(); } }
        void OnDisable() { if (_initialized && OwnerAlive()) { Detach(); Revoke(); Refresh(); } }
        void OnDestroy() => DisposeOwned();

        bool OwnerAlive()
        {
            if (_destroyed) return false;
            if (this != null) return true;
            // Managed delegates can outlive the native object, including an EditMode
            // host that never received lifecycle messages. Detach only our listeners
            // and retire only our separate Canvas child before touching native state.
            DisposeOwned();
            return false;
        }
        void DisposeOwned()
        {
            if (_destroyed) return;
            _destroyed = true; _confirmed = _opened = false; _actionGeneration++;
            Detach(); _session = null; OpenStateChanged = null;
            var root = _root; _root = _panel = null; _container = null;
            try
            {
                if (_stacks != null)
                {
                    _stacks.onValueChanged = new TMP_InputField.OnChangeEvent();
                    _stacks.onEndEdit = new TMP_InputField.SubmitEvent();
                }
                ReleaseFocus(root);
            }
            finally { RetireRoot(root); }
        }
        static void RetireRoot(RectTransform root)
        {
            if (root == null) return;
            var owned = root.gameObject;
            owned.SetActive(false);
            if (owned == null) return;
#if UNITY_EDITOR
            if (!Application.isPlaying) { UnityEngine.Object.DestroyImmediate(owned); return; }
#endif
            UnityEngine.Object.Destroy(owned);
        }

        static RectTransform Row(Transform content, string name, float height)
        {
            var row = MythicUi.Rect(content, name, Vector2.zero, Vector2.one);
            var size = row.gameObject.AddComponent<UnityEngine.UI.LayoutElement>(); size.minHeight = height; size.preferredHeight = height;
            return row;
        }
        static TMP_Text FlowText(Transform content, string name, string value, float fontSize)
        {
            var text = MythicUi.Text(content, name, value, Vector2.zero, Vector2.one, fontSize, ShowcasePalette.MutedText);
            text.enableAutoSizing = false;
            // TMP supplies preferred height to the parent's layout group after its width is assigned.
            text.gameObject.AddComponent<UnityEngine.UI.LayoutElement>().minHeight = 60;
            return text;
        }
        static UnityEngine.UI.Button Button(Transform parent, string name, string text, Vector2 min, Vector2 max)
        {
            var button = MythicUi.Button(parent, name, text, min, max, () => { }, fontSize: 14);
            button.gameObject.AddComponent<TrainingConsolePointerRelease>(); return button;
        }
        static void Selection(Transform row, string title, string name, out UnityEngine.UI.Button previous, out TMP_Text label, out UnityEngine.UI.Button next)
        {
            MythicUi.Text(row, "Label", title, new Vector2(0, .65f), Vector2.one, 15, ShowcasePalette.MutedText);
            previous = Button(row, name + "Previous", "<", new Vector2(0, .02f), new Vector2(.13f, .62f));
            label = MythicUi.Text(row, "Value", "", new Vector2(.14f, .02f), new Vector2(.86f, .62f), 17, ShowcasePalette.Text, TextAlignmentOptions.Center);
            next = Button(row, name + "Next", ">", new Vector2(.87f, .02f), new Vector2(1, .62f));
        }
    }
}

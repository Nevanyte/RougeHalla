using System;
using System.Globalization;
using System.Collections.Generic;
using TMPro;
using UnityEngine;
using Roguehalla.Net;
using Roguehalla.Net.Protocol;

namespace Roguehalla.Client
{
    /// <summary>Displays only the current Session's delivered trader facts and forwards explicit trade choices.</summary>
    public sealed class TraderDialogView : MonoBehaviour
    {
        const float ChoiceRowHeight = 76f;
        const float MerchantRowHeight = 72f;
        const float AppliedStatRowHeight = 40f;

        RectTransform _root;
        RectTransform _merchantList;
        RectTransform _choiceContent;
        UnityEngine.UI.ScrollRect _choiceScroll;
        TMP_Text _status, _detailHeading, _detailSummary, _empty;
        readonly List<UnityEngine.UI.Button> _merchantButtons = new List<UnityEngine.UI.Button>(2);
        readonly List<UnityEngine.UI.Button> _choiceButtons = new List<UnityEngine.UI.Button>(3);
        readonly List<GameObject> _merchantRows = new List<GameObject>(2);
        readonly List<GameObject> _choiceRows = new List<GameObject>(3);
        sealed class FitCache { public string Text; public float Width, Font; }
        readonly Dictionary<int, FitCache> _fitCache = new Dictionary<int, FitCache>();
        Session _session;
        TradeView _renderedTrade;
        sealed class ViewRef { public TradeView View; }
        ViewRef _viewRef = new ViewRef();
        string _renderedSignature = "";
        Action _onClose;
        uint _boundEpoch;
        int _selectedMerchant = -1;
        int _renderGeneration;
        bool _initialized;
        bool _pending;
        string _pendingText = "";
        double _lastServerTime = double.NaN;
        bool _lastHadServerTime;

        public RectTransform Root { get { return _root; } }
        public bool IsVisible { get { return _root != null && _root.gameObject.activeSelf; } }
        public int SelectedMerchantIndex { get { return _selectedMerchant; } }
        public int MerchantCount { get { return _merchantButtons.Count; } }
        public int ChoiceCount { get { return _choiceButtons.Count; } }

        public void Initialize(Transform canvasRoot, Action onClose = null)
        {
            if (_initialized) throw new InvalidOperationException("TraderDialogView is already initialized.");
            if (canvasRoot == null) throw new ArgumentNullException(nameof(canvasRoot));
            _onClose = onClose;
            _root = MythicUi.Panel(canvasRoot, "TraderDialog", new Vector2(.12f, .12f), new Vector2(.88f, .915f), ShowcasePalette.Panel);
            MythicUi.Border(_root, ShowcasePalette.PanelStroke);
            MythicUi.Text(_root, "Title", "TRADERS", new Vector2(.025f, .915f), new Vector2(.72f, .995f), 26, ShowcasePalette.Gold, heading: true);
            var close = MythicUi.Button(_root, "Close", "CLOSE", new Vector2(.87f, .915f), new Vector2(.975f, .995f), Close, MythicUi.ButtonStyle.Quiet);
            close.GetComponentInChildren<TMP_Text>().fontSize = 13;

            _status = MythicUi.Text(_root, "Status", "Awaiting server trade view", new Vector2(.025f, .735f), new Vector2(.975f, .80f), 16, ShowcasePalette.MutedText);
            var merchantPanel = MythicUi.Panel(_root, "MerchantPanel", new Vector2(.025f, .17f), new Vector2(.29f, .72f), ShowcasePalette.PanelRaised, false);
            MythicUi.Text(merchantPanel, "MerchantHeading", "VISIBLE MERCHANTS", new Vector2(.035f, .84f), new Vector2(.965f, .99f), 14, ShowcasePalette.Gold);
            _merchantList = MythicUi.Rect(merchantPanel, "MerchantList", new Vector2(.02f, .02f), new Vector2(.98f, .82f));

            var detailPanel = MythicUi.Panel(_root, "OfferPanel", new Vector2(.31f, .17f), new Vector2(.975f, .72f), ShowcasePalette.PanelRaised, false);
            _detailHeading = MythicUi.Text(detailPanel, "DetailHeading", "Select a visible merchant", new Vector2(.025f, .83f), new Vector2(.975f, .99f), 19, ShowcasePalette.Text);
            _detailSummary = MythicUi.Text(detailPanel, "DetailSummary", "Offers and choices are supplied by the server.", new Vector2(.025f, .70f), new Vector2(.975f, .83f), 13, ShowcasePalette.MutedText);
            _empty = MythicUi.Text(detailPanel, "Empty", "", new Vector2(.03f, .08f), new Vector2(.97f, .66f), 16, ShowcasePalette.MutedText, TextAlignmentOptions.Center);
            var scrollRoot = MythicUi.Rect(detailPanel, "ChoiceScroll", new Vector2(.02f, .07f), new Vector2(.98f, .68f));
            _choiceScroll = scrollRoot.gameObject.AddComponent<UnityEngine.UI.ScrollRect>();
            _choiceScroll.horizontal = false; _choiceScroll.vertical = true;
            _choiceScroll.movementType = UnityEngine.UI.ScrollRect.MovementType.Clamped;
            _choiceScroll.scrollSensitivity = 36;
            var viewport = MythicUi.Rect(scrollRoot, "Viewport", Vector2.zero, Vector2.one);
            var viewportImage = viewport.gameObject.AddComponent<UnityEngine.UI.Image>();
            viewportImage.color = Color.clear; viewportImage.raycastTarget = true;
            viewport.gameObject.AddComponent<UnityEngine.UI.RectMask2D>();
            _choiceContent = MythicUi.Rect(viewport, "Content", new Vector2(0, 1), new Vector2(1, 1));
            _choiceContent.pivot = new Vector2(.5f, 1f);
            _choiceScroll.viewport = viewport; _choiceScroll.content = _choiceContent;
            scrollRoot.gameObject.AddComponent<KeyboardScrollPane>().Initialize(_choiceScroll);

            MythicUi.Text(_root, "AuthorityNote", "Server decides whether a choice can be completed.", new Vector2(.025f, .035f), new Vector2(.975f, .13f), 13, ShowcasePalette.MutedText);
            _initialized = true;
            _root.gameObject.SetActive(false);
            SetState("Awaiting server trade view");
        }

        public void Bind(Session session)
        {
            if (ReferenceEquals(_session, session))
            {
                Refresh();
                return;
            }
            _session = session;
            _boundEpoch = session == null ? 0 : session.TimelineEpoch;
            _selectedMerchant = -1;
            _pending = false; _pendingText = "";
            _renderGeneration++;
            ClearTradePresentation("Waiting for an authoritative trade view.");
            _renderedTrade = null;
            Refresh();
        }

        public void SetVisible(bool visible)
        {
            if (_root == null) return;
            if (visible) _root.SetAsLastSibling();
            _root.gameObject.SetActive(visible);
            if (visible)
            {
                if (_choiceScroll != null) _choiceScroll.StopMovement();
                Refresh();
            }
        }

        /// <summary>Refreshes from the currently bound Session. The owner controls event subscription and call timing.</summary>
        public void Refresh()
        {
            if (!_initialized || _root == null) return;
            if (_session == null)
            {
                _selectedMerchant = -1;
                _pending = false; _pendingText = "";
                ClearTradePresentation("No active Session");
                _renderedTrade = null;
                return;
            }

            if (_session.TimelineEpoch != _boundEpoch)
            {
                _boundEpoch = _session.TimelineEpoch;
                _selectedMerchant = -1;
                _pending = false; _pendingText = "";
                _renderGeneration++;
                ClearTradePresentation("Waiting for an authoritative trade view.");
                _renderedTrade = null;
            }

            TradeView current = _session.Collections.Trade;
            bool replacement = !ReferenceEquals(current, _renderedTrade);
            if (replacement)
            {
                // The server may deliver the same trade content again and again (every state frame while a merchant is in sight). Rebuilding
                // the rows each time resets hover, keyboard focus and the colour tween (rows read as pale, half-faded greys), so an identical
                // replacement only rebinds the rows to the new view object; the stale-row guard still compares object identity.
                string signature = TradeSignature(current);
                bool identical = current != null && current.Available && _renderedTrade != null && signature == _renderedSignature;
                _renderedTrade = current;
                _pending = false; _pendingText = "";
                if (identical) _viewRef.View = current;
                else
                {
                    _renderedSignature = signature; _viewRef = new ViewRef { View = current };
                    _renderGeneration++;
                    var oldSelection = _selectedMerchant;
                    int count = current != null && current.Available ? current.Merchants.Count : 0;
                    _selectedMerchant = oldSelection >= 0 && oldSelection < count ? oldSelection : count > 0 ? 0 : -1;
                    RebuildMerchants(current);
                    if (current != null && current.Available && _selectedMerchant >= 0)
                        UpdateSelectedDetail(current, _selectedMerchant, true);
                    else RebuildChoices(current);
                }
            }

            string authority = _session.State == SessionState.InMatch ? "Server trade view" : StateCopy(_session.State);
            if (current == null) SetState(authority + " · awaiting trade view");
            else if (!current.Available) SetState(authority + " · trader data unavailable");
            else if (current.Merchants.Count == 0) SetState(authority + " · no visible merchants");
            else if (_pending) SetState(authority + " · " + _pendingText);
            else if (current.TradeUsed && _selectedMerchant >= 0 && _selectedMerchant < current.Merchants.Count &&
                current.Merchants[_selectedMerchant].Kind == TradeKind.Stats)
                SetState(authority + " · stat trade used this run");
            else if (current.TradeUsed) SetState(authority + " · stat trade used · barter remains available");
            else SetState(authority + " · choices are server-authoritative");

            if (!(current != null && current.Available) || _selectedMerchant < 0)
            {
                Set(_detailHeading, "Select a visible merchant");
                Set(_detailSummary, current == null ? "Waiting for an authoritative trade view." :
                    !current.Available ? "Trader data is unavailable." : "No visible merchant is present in the delivered view.");
            }
            UpdateButtonAvailability(current);
            ReflowIfLayoutChanged();
            UpdateDeadlineSummaryIfNeeded();
        }

        /// <summary>Selects a currently delivered merchant row by its current list index.</summary>
        public bool SelectMerchant(int currentRowIndex)
        {
            if (!IsVisible || !IsCurrentView(_session, _boundEpoch, _renderedTrade, _renderGeneration) || _renderedTrade == null ||
                !_renderedTrade.Available || currentRowIndex < 0 || currentRowIndex >= _renderedTrade.Merchants.Count)
                return false;
            _selectedMerchant = currentRowIndex;
            UpdateSelectedDetail(_renderedTrade, currentRowIndex, true);
            UpdateButtonAvailability(_renderedTrade);
            return true;
        }

        /// <summary>Queues the requested choice for the selected delivered merchant; all outcome decisions stay server-side.</summary>
        public bool TryTrade(TradeKind kind, byte pick)
        {
            if (pick > 2 || _selectedMerchant < 0) return false;
            return TryTradeBound(_session, _boundEpoch, _renderedTrade, _renderGeneration, _selectedMerchant, kind, pick);
        }

        bool TryTradeBound(Session session, uint epoch, TradeView view, int generation, int merchantIndex, TradeKind kind, byte pick)
        {
            if (!IsVisible || pick > 2 || kind != TradeKind.Barter && kind != TradeKind.Stats ||
                !IsCurrentView(session, epoch, view, generation) || view == null || !view.Available ||
                session.State != SessionState.InMatch || session.LastResult != null || merchantIndex < 0 || merchantIndex >= view.Merchants.Count ||
                merchantIndex != _selectedMerchant || view.Merchants[merchantIndex].Kind != kind)
                return false;

            // TradeUsed is an authoritative stat-trade fact. It never gates barter choices.
            if (kind == TradeKind.Stats && view.TradeUsed) return false;
            if (kind == TradeKind.Stats && pick >= view.Offers.Count) return false;
            session.Input.Trade(kind, pick);
            _pending = true;
            _pendingText = "choice queued · awaiting server state";
            SetState("Server trade view · " + _pendingText);
            return true;
        }

        static string TradeSignature(TradeView v)
        {
            if (v == null) return "null";
            if (!v.Available) return "unavailable";
            var sb = new System.Text.StringBuilder().Append(v.TradeUsed ? 'u' : 'f').Append('|').Append(v.BarterReadyAt.HasValue ? v.BarterReadyAt.Value.ToString("R", CultureInfo.InvariantCulture) : "-");
            foreach (var m in v.Merchants) sb.Append("|m").Append((int)m.Kind).Append(',').Append(m.X.ToString("R", CultureInfo.InvariantCulture)).Append(',').Append(m.Y.ToString("R", CultureInfo.InvariantCulture)).Append(',').Append(m.Name);
            foreach (var o in v.Offers) sb.Append("|o").Append((int)o.Cost).Append((int)o.Gain).Append(',').Append(o.CostValue.ToString("R", CultureInfo.InvariantCulture)).Append(',').Append(o.GainValue.ToString("R", CultureInfo.InvariantCulture)).Append(',').Append(o.Label);
            foreach (var d in v.Stats) sb.Append("|s").Append((int)d.Stat).Append(',').Append(d.Value.ToString("R", CultureInfo.InvariantCulture));
            foreach (var l in v.BarterLabels) sb.Append("|b").Append(l);
            return sb.ToString();
        }

        bool IsCurrentView(Session session, uint epoch, TradeView view, int generation)
        {
            return session != null && ReferenceEquals(session, _session) && session.TimelineEpoch == epoch &&
                ReferenceEquals(session.Collections.Trade, view) && ReferenceEquals(_renderedTrade, view) && generation == _renderGeneration;
        }

        void RebuildMerchants(TradeView view)
        {
            HideRows(_merchantRows);
            _merchantButtons.Clear();
            if (view == null || !view.Available) return;
            for (int i = 0; i < view.Merchants.Count; i++)
            {
                var row = view.Merchants[i]; int capturedIndex = i;
                var capturedSession = _session; uint capturedEpoch = _boundEpoch; int capturedGeneration = _renderGeneration; var viewRef = _viewRef;
                var button = MythicUi.Button(_merchantList, "Merchant_" + i, "", new Vector2(0, 1), new Vector2(1, 1), () =>
                {
                    if (IsCurrentView(capturedSession, capturedEpoch, viewRef.View, capturedGeneration)) SelectMerchant(capturedIndex);
                }, MythicUi.ButtonStyle.Secondary, 13);
                var rect = (RectTransform)button.transform;
                rect.pivot = new Vector2(.5f, 1f); rect.anchorMin = new Vector2(0, 1); rect.anchorMax = new Vector2(1, 1);
                rect.sizeDelta = new Vector2(0, MerchantRowHeight);
                var label = button.GetComponentInChildren<TMP_Text>();
                label.text = MerchantLabel(row);
                label.enableAutoSizing = false; label.enableWordWrapping = true;
                _merchantRows.Add(button.gameObject); _merchantButtons.Add(button);
            }
            ReflowMerchantRows(); RefreshMerchantSelection();
        }

        void RebuildChoices(TradeView view)
        {
            var viewRef = _viewRef;
            float scroll = _choiceScroll == null ? 1f : _choiceScroll.verticalNormalizedPosition;
            HideRows(_choiceRows); _choiceButtons.Clear();
            _empty.gameObject.SetActive(true);
            if (view == null)
            {
                Set(_empty, "Waiting for an authoritative trade view.");
                SetContentHeight(0);
                return;
            }
            if (!view.Available)
            {
                Set(_empty, "Trader data is unavailable."); SetContentHeight(0); return;
            }
            if (_selectedMerchant < 0 || _selectedMerchant >= view.Merchants.Count)
            {
                Set(_empty, view.Merchants.Count == 0 ? "No visible merchants in the delivered view." : "Select a visible merchant.");
                SetContentHeight(0); return;
            }

            var merchant = view.Merchants[_selectedMerchant];
            if (merchant.Kind == TradeKind.Barter)
            {
                _empty.gameObject.SetActive(false);
                for (byte pick = 0; pick < 3; pick++)
                {
                    byte capturedPick = pick; var capturedSession = _session; uint capturedEpoch = _boundEpoch;
                    int capturedGeneration = _renderGeneration, capturedMerchant = _selectedMerchant;
                    string label = (pick + 1).ToString(CultureInfo.InvariantCulture) + " · " + view.BarterLabels[pick];
                    var button = CreateChoiceButton(pick, label, () => TryTradeBound(capturedSession, capturedEpoch, viewRef.View,
                        capturedGeneration, capturedMerchant, TradeKind.Barter, capturedPick));
                    _choiceButtons.Add(button);
                }
                SetContentHeight(3 * (ChoiceRowHeight + 8));
                UpdateDetailSummary(view, _selectedMerchant);
            }
            else
            {
                var offers = view.Offers;
                float statRowsHeight = 0f;
                for (int i = 0; i < view.Stats.Count; i++)
                {
                    var delta = view.Stats[i];
                    var line = MythicUi.Text(_choiceContent, "AppliedStat_" + i,
                        StatName(delta.Stat) + "  " + FormatDouble(delta.Value), new Vector2(.02f, 1f), new Vector2(.98f, 1f), 13,
                        ShowcasePalette.MutedText);
                    var lineRect = line.rectTransform;
                    lineRect.pivot = new Vector2(.5f, 1f); lineRect.anchorMin = new Vector2(0, 1); lineRect.anchorMax = new Vector2(1, 1);
                    lineRect.sizeDelta = new Vector2(0, AppliedStatRowHeight);
                    line.enableAutoSizing = false;
                    _choiceRows.Add(line.gameObject);
                    statRowsHeight += AppliedStatRowHeight;
                }
                if (offers.Count == 0)
                {
                    if (statRowsHeight == 0) Set(_empty, "No stat offers are present in the delivered view.");
                    else _empty.gameObject.SetActive(false);
                    SetContentHeight(statRowsHeight);
                }
                else
                {
                    _empty.gameObject.SetActive(false);
                    for (byte pick = 0; pick < offers.Count; pick++)
                    {
                        byte capturedPick = pick; var capturedSession = _session; uint capturedEpoch = _boundEpoch;
                        int capturedGeneration = _renderGeneration, capturedMerchant = _selectedMerchant;
                        var offer = offers[pick];
                        // Legacy shows the server's offer label alone ("-12% attack speed -> +13.9 Defense"); the raw cost/gain numbers are
                        // fractions and flat values in different units, so repeating them read as a second, inconsistent quote.
                        string label = (pick + 1).ToString(CultureInfo.InvariantCulture) + " · " + offer.Label;
                        var button = CreateChoiceButton(pick, label, () => TryTradeBound(capturedSession, capturedEpoch, viewRef.View,
                            capturedGeneration, capturedMerchant, TradeKind.Stats, capturedPick));
                        button.interactable = !view.TradeUsed;
                        _choiceButtons.Add(button);
                    }
                    SetContentHeight(statRowsHeight + offers.Count * (ChoiceRowHeight + 8));
                }
                UpdateDetailSummary(view, _selectedMerchant);
            }
            if (_choiceScroll != null) _choiceScroll.verticalNormalizedPosition = scroll;
            ReflowChoiceRows();
        }

        UnityEngine.UI.Button CreateChoiceButton(byte pick, string label, UnityEngine.Events.UnityAction action)
        {
            var button = MythicUi.Button(_choiceContent, "Choice_" + pick, label,
                new Vector2(0, 1), new Vector2(1, 1), action, MythicUi.ButtonStyle.Secondary, 14);
            var rect = (RectTransform)button.transform;
            rect.pivot = new Vector2(.5f, 1f); rect.anchorMin = new Vector2(0, 1); rect.anchorMax = new Vector2(1, 1);
            rect.sizeDelta = new Vector2(0, ChoiceRowHeight);
            var text = button.GetComponentInChildren<TMP_Text>(); text.alignment = TextAlignmentOptions.MidlineLeft;
            text.enableWordWrapping = true; text.enableAutoSizing = false;
            _choiceRows.Add(button.gameObject);
            return button;
        }

        void UpdateSelectedDetail(TradeView view, int index, bool rebuild)
        {
            if (index < 0 || index >= view.Merchants.Count) return;
            var merchant = view.Merchants[index];
            Set(_detailHeading, merchant.Name + " · " + merchant.Kind);
            UpdateDetailSummary(view, index);
            if (rebuild) RebuildChoices(view);
            RefreshMerchantSelection();
        }

        void UpdateButtonAvailability(TradeView view)
        {
            bool available = _session != null && _session.State == SessionState.InMatch && _session.LastResult == null && view != null && view.Available;
            for (int i = 0; i < _merchantButtons.Count; i++)
                if (_merchantButtons[i] != null) _merchantButtons[i].interactable = available;
            for (int i = 0; i < _choiceButtons.Count; i++)
            {
                if (_choiceButtons[i] == null) continue;
                bool statBlocked = view != null && view.TradeUsed && _selectedMerchant >= 0 &&
                    _selectedMerchant < view.Merchants.Count && view.Merchants[_selectedMerchant].Kind == TradeKind.Stats;
                _choiceButtons[i].interactable = available && !statBlocked;
            }
        }

        void RefreshMerchantSelection()
        {
            for (int i = 0; i < _merchantButtons.Count; i++)
            {
                if (_merchantButtons[i] != null) MythicUi.Select(_merchantButtons[i], i == _selectedMerchant);
            }
        }

        void SetContentHeight(float height)
        {
            if (_choiceContent == null) return;
            _choiceContent.sizeDelta = new Vector2(0, height);
        }

        void ClearTradePresentation(string copy)
        {
            HideRows(_merchantRows); _merchantButtons.Clear();
            HideRows(_choiceRows); _choiceButtons.Clear();
            SetContentHeight(0);
            if (_choiceScroll != null) { _choiceScroll.StopMovement(); _choiceScroll.verticalNormalizedPosition = 1; }
            if (_empty != null) { _empty.gameObject.SetActive(true); Set(_empty, copy); }
            Set(_detailHeading, "Select a visible merchant");
            Set(_detailSummary, copy);
            SetState(copy);
        }

        void HideRows(List<GameObject> rows)
        {
            for (int i = 0; i < rows.Count; i++)
            {
                var row = rows[i];
                if (row == null) continue;
                _fitCache.Remove(row.GetInstanceID());
                row.SetActive(false);
                if (Application.isPlaying) UnityEngine.Object.Destroy(row);
                else UnityEngine.Object.DestroyImmediate(row);
            }
            rows.Clear();
            _fitCache.Clear();
        }

        void ReflowIfLayoutChanged()
        {
            bool merchants = NeedsReflow(_merchantRows, false);
            bool choices = NeedsReflow(_choiceRows, true);
            if (merchants) ReflowMerchantRows();
            if (choices)
            {
                float scroll = _choiceScroll.verticalNormalizedPosition;
                ReflowChoiceRows();
                _choiceScroll.verticalNormalizedPosition = scroll;
            }
        }

        bool NeedsReflow(List<GameObject> rows, bool choices)
        {
            for (int i = 0; i < rows.Count; i++)
            {
                GameObject row = rows[i];
                if (row == null || !row.activeSelf) continue;
                TMP_Text text = row.GetComponentInChildren<TMP_Text>();
                if (text == null) continue;
                float width = MeasureWidth((RectTransform)row.transform, choices);
                int id = row.GetInstanceID();
                if (!_fitCache.TryGetValue(id, out FitCache cache) || cache.Text != text.text ||
                    !Mathf.Approximately(cache.Width, width) || !Mathf.Approximately(cache.Font, text.fontSize)) return true;
            }
            return false;
        }

        void ReflowMerchantRows()
        {
            float y = 0;
            for (int i = 0; i < _merchantRows.Count; i++)
            {
                GameObject row = _merchantRows[i]; if (row == null || !row.activeSelf) continue;
                var rect = (RectTransform)row.transform;
                var text = row.GetComponentInChildren<TMP_Text>();
                float height = FitHeight(row, text, rect, MerchantRowHeight, false);
                rect.anchoredPosition = new Vector2(0, -y);
                rect.sizeDelta = new Vector2(0, height);
                y += height + 8f;
            }
        }

        void ReflowChoiceRows()
        {
            float y = 0;
            for (int i = 0; i < _choiceRows.Count; i++)
            {
                GameObject row = _choiceRows[i]; if (row == null || !row.activeSelf) continue;
                var rect = (RectTransform)row.transform;
                bool actionRow = row.GetComponent<UnityEngine.UI.Button>() != null;
                var text = row.GetComponentInChildren<TMP_Text>();
                float height = FitHeight(row, text, rect, actionRow ? ChoiceRowHeight : AppliedStatRowHeight, true);
                rect.anchoredPosition = new Vector2(0, -y);
                rect.sizeDelta = new Vector2(0, height);
                y += height + (actionRow ? 8f : 4f);
            }
            if (_choiceRows.Count > 0) y -= 4f;
            SetContentHeight(Mathf.Max(0, y));
        }

        float FitHeight(GameObject row, TMP_Text text, RectTransform rect, float minimum, bool choices)
        {
            float width = MeasureWidth(rect, choices);
            float fontSize = text == null ? 16f : text.fontSize;
            string value = text == null ? "" : text.text;
            if (text == null) return minimum;
            float available = Mathf.Max(1f, width - 24f);
            float preferred = text.GetPreferredValues(value, available, Mathf.Infinity).y;
            float height = Mathf.Max(minimum, Mathf.Ceil(preferred + 16f));
            _fitCache[row.GetInstanceID()] = new FitCache { Text = value, Width = width, Font = fontSize };
            return height;
        }

        static float MeasureWidth(RectTransform rect, bool choices)
        {
            float width = rect.rect.width;
            if (width <= 1f && rect.parent is RectTransform parent) width = parent.rect.width;
            if (width <= 1f) width = choices ? 760f : 300f;
            return width;
        }

        void LateUpdate()
        {
            if (_initialized)
            {
                ReflowIfLayoutChanged();
                UpdateDeadlineSummaryIfNeeded();
            }
        }

        void UpdateDetailSummary(TradeView view, int index)
        {
            if (view == null || !view.Available || index < 0 || index >= view.Merchants.Count) return;
            var merchant = view.Merchants[index];
            // Legacy wording (traderPanel.ts): what the trader does, no map coordinates.
            string summary = merchant.Kind == TradeKind.Barter
                ? "Trade the weapon in your hand, or exchange a small potion for a weapon. One trade every 5 seconds."
                : view.TradeUsed ? "Your stat trade is complete for this run."
                : "Choose one permanent exchange for this run. These offers reflect your current stats.";
            if (merchant.Kind == TradeKind.Barter && view.BarterReadyAt.HasValue && _session != null && _session.Latest != null)
                summary += " " + DeadlineCopy(view.BarterReadyAt.Value, _session.ServerTimeMs);
            Set(_detailSummary, summary);
            _lastServerTime = _session == null ? 0 : _session.ServerTimeMs;
            _lastHadServerTime = _session != null && _session.Latest != null;
        }

        void UpdateDeadlineSummaryIfNeeded()
        {
            if (_session == null || !IsVisible || _renderedTrade == null || !_renderedTrade.Available ||
                _selectedMerchant < 0 || _selectedMerchant >= _renderedTrade.Merchants.Count ||
                _renderedTrade.Merchants[_selectedMerchant].Kind != TradeKind.Barter || !_renderedTrade.BarterReadyAt.HasValue ||
                _session.Latest == null || _lastHadServerTime && _session.ServerTimeMs == _lastServerTime) return;
            UpdateDetailSummary(_renderedTrade, _selectedMerchant);
        }

        static string DeadlineCopy(double deadline, double serverTime)
        {
            double remaining = Math.Max(0d, deadline - serverTime);
            if (remaining <= 0d) return "Barter ready.";
            double seconds = Math.Ceiling(remaining / 100d) / 10d;
            return "Next barter in " + seconds.ToString("0.0", CultureInfo.InvariantCulture) + "s.";
        }

        void Close()
        {
            SetVisible(false);
            _onClose?.Invoke();
        }

        static string MerchantLabel(MerchantView merchant)
        {
            return merchant.Name + "\n" + (merchant.Kind == TradeKind.Barter ? "Weapon barter" : "Stat trader");
        }

        static string StatName(TradeStat stat)
        {
            switch (stat)
            {
                case TradeStat.MaxHp: return "max HP";
                case TradeStat.Ad: return "AD";
                case TradeStat.Ap: return "AP";
                case TradeStat.AttackSpeed: return "attack speed";
                case TradeStat.MoveSpeed: return "move speed";
                case TradeStat.Armor: return "armor";
                case TradeStat.Shield: return "shield";
                default: return stat.ToString();
            }
        }

        static string FormatDouble(double value) { return Math.Round(value, 2).ToString("0.##", CultureInfo.InvariantCulture); }
        static string StateCopy(SessionState state)
        {
            switch (state)
            {
                case SessionState.Reconnecting: return "Connection interrupted · resuming";
                case SessionState.Failed: return "Connection failed";
                case SessionState.Rejected: return "Connection rejected";
                case SessionState.Ended: return "Session ended";
                default: return state.ToString();
            }
        }
        void SetState(string value) { Set(_status, value); }
        static void Set(TMP_Text target, string value) { if (target != null && target.text != value) target.text = value ?? ""; }
    }
}

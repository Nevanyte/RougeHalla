using System;
using System.Collections.Generic;
using System.Globalization;
using TMPro;
using Roguehalla.Net;
using Roguehalla.Net.Protocol;
using UnityEngine;

namespace Roguehalla.Client
{
    /// <summary>Presentation-only journal for the reliable, owner-scoped quest collection.</summary>
    public sealed class QuestJournalView : MonoBehaviour
    {
        sealed class Row
        {
            public RectTransform Root;
            public UnityEngine.UI.Button Button;
            public TMP_Text Label;
            public QuestHandle Handle;
        }

        RectTransform _root, _card, _content;
        UnityEngine.UI.ScrollRect _scroll, _detailScroll;
        RectTransform _detailContent;
        TMP_Text _state, _detailName, _giver, _brief, _objective, _reward, _participants, _status;
        UnityEngine.UI.Button _close, _accept, _track;
        readonly List<Row> _rows = new List<Row>();
        Session _session;
        Action _onClose;
        Action<QuestHandle?> _onTracked;
        QuestView _view;
        QuestView _participantCacheView;
        QuestRowView _participantCacheRow;
        string _participantCacheText;
        QuestHandle? _selected;
        QuestHandle? _tracked, _acceptPendingFor;
        uint _boundEpoch, _acceptBoundEpoch;
        Session _acceptBoundSession;
        QuestView _acceptBoundView;
        QuestHandle _acceptBoundHandle;
        bool _acceptBindingValid;
        bool _initialized;

        public RectTransform Root => _root;
        public bool IsVisible => _root != null && _root.gameObject.activeSelf;
        public QuestHandle? TrackedQuest => _tracked;

        public void Initialize(Transform canvasRoot, Action onClose = null, Action<QuestHandle?> onTracked = null)
        {
            if (_initialized) throw new InvalidOperationException("QuestJournalView is already initialized.");
            if (canvasRoot == null) throw new ArgumentNullException(nameof(canvasRoot));
            _initialized = true; _onClose = onClose; _onTracked = onTracked;
            _root = MythicUi.Panel(canvasRoot, "QuestJournal", new Vector2(.12f, .12f), new Vector2(.88f, .915f), ShowcasePalette.Panel);
            _card = _root;
            MythicUi.Text(_card, "JournalTitle", "QUEST JOURNAL", new Vector2(.035f, .925f), new Vector2(.66f, .995f), 27, ShowcasePalette.Gold, heading: true);
            _close = MythicUi.Button(_card, "CloseJournal", "CLOSE", new Vector2(.79f, .925f), new Vector2(.965f, .99f), Close, MythicUi.ButtonStyle.Quiet);
            _state = MythicUi.Text(_card, "JournalState", "Waiting for quest data…", new Vector2(.035f, .75f), new Vector2(.965f, .80f), 16, ShowcasePalette.MutedText);
            _scroll = CreateScroll(_card, new Vector2(.035f, .05f), new Vector2(.43f, .73f), out _content);
            var detail = MythicUi.Panel(_card, "QuestDetail", new Vector2(.455f, .05f), new Vector2(.965f, .73f), ShowcasePalette.Background);
            MythicUi.Text(detail, "DetailHeading", "QUEST DETAILS", new Vector2(.025f, .84f), new Vector2(.975f, .99f), 19, ShowcasePalette.Text);
            _detailScroll = CreateReadingScroll(detail, new Vector2(.025f, .20f), new Vector2(.975f, .81f), out _detailContent);
            _detailName = CreateQuestField(_detailContent, "QuestName", "QUEST NAME", 18, ShowcasePalette.Text);
            _giver = CreateQuestField(_detailContent, "QuestGiver", "GIVER", 16, ShowcasePalette.Gold);
            _brief = CreateQuestField(_detailContent, "QuestBrief", "BRIEF", 17, ShowcasePalette.Text);
            _objective = CreateQuestField(_detailContent, "QuestObjective", "OBJECTIVE", 17, ShowcasePalette.MutedText);
            _reward = CreateQuestField(_detailContent, "QuestReward", "REWARD", 16, ShowcasePalette.Text);
            _participants = CreateQuestField(_detailContent, "QuestParticipants", "PARTICIPANTS", 15, ShowcasePalette.Text);
            _status = MythicUi.Text(detail, "QuestStatus", "", new Vector2(.025f, .115f), new Vector2(.975f, .20f), 13, ShowcasePalette.MutedText);
            _track = MythicUi.Button(detail, "TrackQuest", "TRACK OBJECTIVE", new Vector2(.035f, .025f), new Vector2(.48f, .12f), ToggleTrack, MythicUi.ButtonStyle.Secondary);
            _accept = MythicUi.Button(detail, "AcceptQuest", "ACCEPT QUEST", new Vector2(.52f, .025f), new Vector2(.965f, .12f), () => { }, MythicUi.ButtonStyle.Primary);
            _root.gameObject.SetActive(false);
            RenderSelection();
        }

        static UnityEngine.UI.ScrollRect CreateScroll(Transform parent, Vector2 min, Vector2 max, out RectTransform content)
        {
            var frame = MythicUi.Rect(parent, "QuestRows", min, max);
            var scroll = frame.gameObject.AddComponent<UnityEngine.UI.ScrollRect>();
            scroll.horizontal = false; scroll.vertical = true; scroll.movementType = UnityEngine.UI.ScrollRect.MovementType.Clamped;
            scroll.scrollSensitivity = 36; scroll.inertia = true;
            var viewport = MythicUi.Rect(frame, "Viewport", Vector2.zero, Vector2.one);
            var image = viewport.gameObject.AddComponent<UnityEngine.UI.Image>(); image.color = Color.clear; image.raycastTarget = true;
            viewport.gameObject.AddComponent<UnityEngine.UI.RectMask2D>();
            content = MythicUi.Rect(viewport, "Content", new Vector2(0, 1), Vector2.one, Vector2.zero, Vector2.zero);
            content.pivot = new Vector2(.5f, 1);
            var layout = content.gameObject.AddComponent<UnityEngine.UI.VerticalLayoutGroup>();
            layout.padding = new UnityEngine.RectOffset(4, 4, 4, 4); layout.spacing = 8; layout.childAlignment = UnityEngine.TextAnchor.UpperCenter;
            layout.childControlWidth = true; layout.childControlHeight = true; layout.childForceExpandWidth = true; layout.childForceExpandHeight = false;
            content.gameObject.AddComponent<UnityEngine.UI.ContentSizeFitter>().verticalFit = UnityEngine.UI.ContentSizeFitter.FitMode.PreferredSize;
            scroll.viewport = viewport; scroll.content = content;
            frame.gameObject.AddComponent<KeyboardScrollPane>().Initialize(scroll);
            return scroll;
        }

        static UnityEngine.UI.ScrollRect CreateReadingScroll(Transform parent, Vector2 min, Vector2 max, out RectTransform content)
        {
            var frame = MythicUi.Rect(parent, "QuestTextScroll", min, max);
            var scroll = frame.gameObject.AddComponent<UnityEngine.UI.ScrollRect>();
            scroll.horizontal = false; scroll.vertical = true; scroll.movementType = UnityEngine.UI.ScrollRect.MovementType.Clamped;
            scroll.scrollSensitivity = 36; scroll.inertia = true;
            var viewport = MythicUi.Rect(frame, "Viewport", Vector2.zero, Vector2.one);
            var image = viewport.gameObject.AddComponent<UnityEngine.UI.Image>(); image.color = Color.clear; image.raycastTarget = true;
            viewport.gameObject.AddComponent<UnityEngine.UI.RectMask2D>();
            content = MythicUi.Rect(viewport, "Content", new Vector2(0, 1), Vector2.one, Vector2.zero, Vector2.zero);
            content.pivot = new Vector2(.5f, 1f);
            var stack = content.gameObject.AddComponent<UnityEngine.UI.VerticalLayoutGroup>();
            stack.padding = new UnityEngine.RectOffset(8, 8, 6, 8); stack.spacing = 10;
            stack.childAlignment = UnityEngine.TextAnchor.UpperLeft; stack.childControlWidth = true; stack.childControlHeight = true;
            stack.childForceExpandWidth = true; stack.childForceExpandHeight = false;
            content.gameObject.AddComponent<UnityEngine.UI.ContentSizeFitter>().verticalFit = UnityEngine.UI.ContentSizeFitter.FitMode.PreferredSize;
            scroll.viewport = viewport; scroll.content = content;
            frame.gameObject.AddComponent<KeyboardScrollPane>().Initialize(scroll);
            return scroll;
        }

        static TMP_Text CreateQuestField(Transform parent, string name, string labelText, float size, Color color)
        {
            var field = MythicUi.Rect(parent, name, new Vector2(0, 1), Vector2.one, Vector2.zero, Vector2.zero);
            field.pivot = new Vector2(.5f, 1f);
            var stack = field.gameObject.AddComponent<UnityEngine.UI.VerticalLayoutGroup>();
            stack.spacing = 2; stack.childAlignment = UnityEngine.TextAnchor.UpperLeft; stack.childControlWidth = true;
            stack.childControlHeight = true; stack.childForceExpandWidth = true; stack.childForceExpandHeight = false;
            field.gameObject.AddComponent<UnityEngine.UI.ContentSizeFitter>().verticalFit = UnityEngine.UI.ContentSizeFitter.FitMode.PreferredSize;

            var label = MythicUi.Text(field, "FieldLabel", labelText, Vector2.zero, Vector2.one, 12, ShowcasePalette.Gold);
            label.enableAutoSizing = false; label.enableWordWrapping = false; label.fontSizeMin = label.fontSize; label.fontSizeMax = label.fontSize;
            label.rectTransform.anchorMin = new Vector2(0, 1); label.rectTransform.anchorMax = Vector2.one; label.rectTransform.pivot = new Vector2(.5f, 1f);
            var labelHeight = label.gameObject.AddComponent<UnityEngine.UI.LayoutElement>(); labelHeight.minHeight = 22; labelHeight.preferredHeight = 22;

            var value = MythicUi.Text(field, "Value", "", Vector2.zero, Vector2.one, size, color);
            value.enableAutoSizing = false; value.enableWordWrapping = true; value.alignment = TextAlignmentOptions.TopLeft;
            value.fontSizeMin = value.fontSize; value.fontSizeMax = value.fontSize; value.margin = Vector4.zero;
            value.rectTransform.anchorMin = new Vector2(0, 1); value.rectTransform.anchorMax = Vector2.one; value.rectTransform.pivot = new Vector2(.5f, 1f);
            value.gameObject.AddComponent<UnityEngine.UI.ContentSizeFitter>().verticalFit = UnityEngine.UI.ContentSizeFitter.FitMode.PreferredSize;
            return value;
        }

        public void Bind(Session session)
        {
            if (ReferenceEquals(_session, session)) { Refresh(); return; }
            _session = session; _boundEpoch = session != null ? session.TimelineEpoch : 0;
            _selected = null; ClearTracked(); _acceptPendingFor = null;
            Refresh();
        }

        public void Refresh()
        {
            if (_root == null) return;
            if (_session == null || _session.State != SessionState.InMatch)
            {
                if (_view != null) { _view = null; _selected = null; ClearTracked(); SetRows(0); }
                _acceptPendingFor = null;
                _state.text = _session == null ? "Quest data is not connected." : _session.State == SessionState.Reconnecting ? "Reconnecting · quest actions paused" : "Quest journal unavailable while disconnected.";
                RenderSelection(); return;
            }
            if (_boundEpoch != _session.TimelineEpoch)
            {
                _boundEpoch = _session.TimelineEpoch; _view = null; _selected = null;
                ClearTracked(); _acceptPendingFor = null; SetRows(0);
            }
            QuestView next = _session.Collections.Quests;
            if (next == null)
            {
                if (_view != null) { _view = null; _selected = null; ClearTracked(); SetRows(0); }
                _acceptPendingFor = null;
                _state.text = "Waiting for quest data…"; RenderSelection(); return;
            }
            if (!next.Available)
            {
                if (!ReferenceEquals(next, _view))
                {
                    _view = next; _selected = null; ClearTracked(); _acceptPendingFor = null; SetRows(0);
                }
                _state.text = "Quest journal unavailable."; RenderSelection(); return;
            }
            bool collectionChanged = !ReferenceEquals(next, _view);
            if (collectionChanged)
            {
                float scrollPosition = _scroll.verticalNormalizedPosition;
                QuestHandle? selected = _selected;
                _view = next;
                _acceptPendingFor = null;
                if (selected.HasValue && Find(selected.Value) == null) selected = null;
                _selected = selected;
                if (_tracked.HasValue && Find(_tracked.Value) == null) ClearTracked();
                for (int i = 0; i < next.Rows.Count; i++)
                {
                    QuestRowView quest = next.Rows[i]; Row row = GetRow(i); row.Handle = quest.Handle;
                    row.Label.text = QuestRowLabel(quest);
                    QuestHandle capturedHandle = quest.Handle; Session capturedSession = _session; uint capturedEpoch = _boundEpoch;
                    row.Button.onClick.RemoveAllListeners(); row.Button.onClick.AddListener(() => SelectCurrent(capturedSession, capturedEpoch, next, capturedHandle));
                    row.Root.gameObject.SetActive(true);
                }
                SetRows(next.Rows.Count);
                _scroll.verticalNormalizedPosition = scrollPosition;
            }
            _state.text = next.Rows.Count == 0 ? "No quests are currently available." : next.Rows.Count + " quest" + (next.Rows.Count == 1 ? "" : "s");
            RenderSelection();
        }

        static string QuestRowLabel(QuestRowView q)
        {
            string state = q.OwnerCompleted ? "COMPLETE" : q.OwnerAccepted ? "ACCEPTED" : q.CanAccept ? "OFFER" : q.State.ToString().ToUpperInvariant();
            return (q.Name ?? string.Empty) + "\n" + state + "  ·  " + (q.GiverLabel ?? string.Empty);
        }

        Row GetRow(int index)
        {
            while (_rows.Count <= index)
            {
                int rowIndex = _rows.Count;
                var root = MythicUi.Panel(_content, "QuestRow" + rowIndex, Vector2.zero, Vector2.one,
                    rowIndex % 2 == 0 ? new Color32(22, 28, 37, 255) : new Color32(28, 35, 45, 255));
                var le = root.gameObject.AddComponent<UnityEngine.UI.LayoutElement>(); le.minHeight = 62; le.preferredHeight = 70;
                var button = root.gameObject.AddComponent<UnityEngine.UI.Button>(); button.targetGraphic = root.GetComponent<UnityEngine.UI.Image>();
                var colors = button.colors; colors.normalColor = new Color32(22, 28, 37, 255); colors.highlightedColor = MythicUi.HoverFill;
                colors.selectedColor = MythicUi.SelectedFill; button.colors = colors;
                var label = MythicUi.Text(root, "QuestRowLabel", "", Vector2.zero, Vector2.one, 14, ShowcasePalette.Text);
                label.margin = new Vector4(12, 5, 8, 5); label.alignment = TextAlignmentOptions.MidlineLeft;
                _rows.Add(new Row { Root = root, Button = button, Label = label });
            }
            return _rows[index];
        }

        void SetRows(int count)
        {
            for (int i = count; i < _rows.Count; i++) { _rows[i].Button.onClick.RemoveAllListeners(); _rows[i].Root.gameObject.SetActive(false); }
        }

        QuestRowView Find(QuestHandle handle)
        {
            if (_view == null || !_view.Available) return null;
            for (int i = 0; i < _view.Rows.Count; i++) if (_view.Rows[i].Handle.Equals(handle)) return _view.Rows[i];
            return null;
        }

        public void SelectQuest(QuestHandle handle)
        {
            if (!IsCurrentView(_session, _boundEpoch, _view) || Find(handle) == null) return;
            _selected = handle; RenderSelection();
        }

        bool IsCurrentView(Session session, uint epoch, QuestView view)
        {
            return IsVisible && session != null && ReferenceEquals(_session, session) && session.State == SessionState.InMatch &&
                session.TimelineEpoch == epoch && epoch == _boundEpoch && view != null &&
                ReferenceEquals(session.Collections.Quests, view) && ReferenceEquals(_view, view);
        }

        void SelectCurrent(Session session, uint epoch, QuestView view, QuestHandle handle)
        {
            if (!IsCurrentView(session, epoch, view) || Find(handle) == null) return;
            SelectQuest(handle);
        }

        void RenderSelection()
        {
            QuestRowView q = _selected.HasValue ? Find(_selected.Value) : null;
            bool has = q != null;
            _detailName.text = has ? q.Name : "Select a quest";
            _giver.text = has ? q.GiverLabel : "";
            _brief.text = has ? q.Brief : "";
            _objective.text = has ? q.Objective : "";
            _reward.text = has ? q.Reward : "";
            _participants.text = has ? ParticipantCopyCached(_view, q) : "";
            if (!has)
            {
                _participantCacheView = null; _participantCacheRow = null; _participantCacheText = null;
            }
            if (has)
            {
                string deadline = DeadlineCopy(q);
                string readiness = q.OwnerReady ? " · Ready" : "";
                _status.text = _acceptPendingFor.HasValue && _acceptPendingFor.Value.Equals(q.Handle)
                    ? "Acceptance queued · waiting for server update · " + deadline
                    : q.OwnerCompleted ? "Completed" + readiness + " · " + deadline
                    : q.OwnerAccepted ? "Accepted · " + q.OwnerProgress + " progress" + readiness + " · " + deadline
                    : q.CanAccept ? "Available · " + deadline : q.State.ToString() + readiness + " · " + deadline;
            }
            else _status.text = "";
            _track.interactable = has && IsCurrentView(_session, _boundEpoch, _view);
            _track.GetComponentInChildren<TMP_Text>().text = _tracked.HasValue && has && _tracked.Value.Equals(q.Handle) ? "STOP TRACKING" : "TRACK OBJECTIVE";
            _accept.gameObject.SetActive(has && q.CanAccept);
            _accept.interactable = has && q.CanAccept && _session != null && _session.State == SessionState.InMatch && _session.LastResult == null && ReferenceEquals(_session.Collections.Quests, _view);
            if (!has)
            {
                if (_acceptBindingValid) _accept.onClick.RemoveAllListeners();
                _acceptBindingValid = false; _acceptBoundSession = null; _acceptBoundView = null;
            }
            else if (!_acceptBindingValid || !ReferenceEquals(_acceptBoundSession, _session) || !ReferenceEquals(_acceptBoundView, _view) ||
                _acceptBoundEpoch != _boundEpoch || !_acceptBoundHandle.Equals(q.Handle))
            {
                _accept.onClick.RemoveAllListeners();
                Session capturedSession = _session; uint capturedEpoch = _boundEpoch; QuestView capturedView = _view; QuestHandle capturedHandle = q.Handle;
                _accept.onClick.AddListener(() => TryAcceptFrom(capturedSession, capturedEpoch, capturedView, capturedHandle));
                _acceptBoundSession = capturedSession; _acceptBoundEpoch = capturedEpoch; _acceptBoundView = capturedView;
                _acceptBoundHandle = capturedHandle; _acceptBindingValid = true;
            }
        }

        static string ParticipantCopy(QuestView view, QuestRowView quest)
        {
            if (view == null || quest == null || quest.Participants == null || quest.Participants.Count == 0) return "";
            var lines = new List<string>(quest.Participants.Count);
            for (int i = 0; i < quest.Participants.Count; i++)
            {
                QuestParticipantView participant = quest.Participants[i];
                string label = "Participant";
                for (int r = 0; r < view.Roster.Count; r++)
                {
                    QuestRosterEntryView entry = view.Roster[r];
                    if (entry.Id.Equals(participant.Id))
                    {
                        label = entry.Label ?? string.Empty;
                        break;
                    }
                }

                bool isOwner = view.OwnerRoster.HasValue && view.OwnerRoster.Value.Equals(participant.Id);
                string accepted = participant.Accepted ? "Accepted" : "Not accepted";
                lines.Add(label + (isOwner ? " · You" : "") + " · " + accepted + " · Progress " + participant.Progress.ToString(CultureInfo.InvariantCulture));
            }
            return string.Join("\n", lines);
        }

        string ParticipantCopyCached(QuestView view, QuestRowView quest)
        {
            if (!ReferenceEquals(_participantCacheView, view) || !ReferenceEquals(_participantCacheRow, quest))
            {
                _participantCacheView = view; _participantCacheRow = quest;
                _participantCacheText = ParticipantCopy(view, quest);
            }
            return _participantCacheText ?? string.Empty;
        }


        string DeadlineCopy(QuestRowView quest)
        {
            if (_session == null || _session.Latest == null) return "Awaiting server deadline update";
            double remainingMs = quest.ExpiresAt - _session.ServerTimeMs;
            if (double.IsNaN(remainingMs) || double.IsInfinity(remainingMs) || remainingMs <= 0)
                return "Awaiting server deadline update";
            double seconds = Math.Ceiling(remainingMs / 1000.0);
            return "Server deadline in " + seconds.ToString("0", CultureInfo.InvariantCulture) + "s";
        }

        public bool TryAccept(QuestHandle handle) => TryAcceptFrom(_session, _boundEpoch, _view, handle);

        bool TryAcceptFrom(Session session, uint epoch, QuestView view, QuestHandle handle)
        {
            if (!IsCurrentView(session, epoch, view) || session.LastResult != null) return false;
            QuestRowView current = Find(handle);
            if (current == null || !current.CanAccept) return false;
            session.Input.QuestAccept(handle);
            _acceptPendingFor = handle;
            RenderSelection();
            return true;
        }


        void ToggleTrack()
        {
            if (!IsCurrentView(_session, _boundEpoch, _view)) return;
            QuestRowView q = _selected.HasValue ? Find(_selected.Value) : null;
            if (q == null) return;
            _tracked = _tracked.HasValue && _tracked.Value.Equals(q.Handle) ? (QuestHandle?)null : q.Handle;
            if (_onTracked != null) _onTracked(_tracked);
            RenderSelection();
        }

        public void SetVisible(bool visible)
        {
            if (_root == null) return;
            _root.gameObject.SetActive(visible);
            if (visible) { _root.SetAsLastSibling(); _scroll.StopMovement(); }
        }

        void ClearTracked()
        {
            if (!_tracked.HasValue) return;
            _tracked = null; if (_onTracked != null) _onTracked(null);
        }

        void Close() { SetVisible(false); if (_onClose != null) _onClose(); }
    }
}

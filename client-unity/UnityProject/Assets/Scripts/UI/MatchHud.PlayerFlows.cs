using Roguehalla.Net;
using Roguehalla.Net.Protocol;
using TMPro;
using UnityEngine;
using UnityEngine.EventSystems;

namespace Roguehalla.Client
{
    public sealed partial class MatchHud
    {
        QuestJournalView _questJournal;
        TraderDialogView _traderDialog;
        OrderedNoticeFeed _orderedNotices;
        UnityEngine.UI.Button _journalButton;
        uint _playerFlowEpoch;
        bool _returnToResults;
        readonly System.Collections.Generic.List<UnityEngine.UI.Button> _planningBlockedTabs = new System.Collections.Generic.List<UnityEngine.UI.Button>();
        UnityEngine.CanvasGroup _planningMapInput;
        bool _planningMapBlocked, _mapWasInteractable, _mapBlockedRaycasts;
        GameObject _planningReturnFocus;
        Session _planningReviewSession;
        uint _planningReviewEpoch;
        public QuestJournalView QuestJournal => _questJournal;
        public TraderDialogView TraderDialog => _traderDialog;
        public OrderedNoticeFeed ServerNotices => _orderedNotices;
        bool PlayerFlowVisible => (_questJournal?.IsVisible ?? false) || (_traderDialog?.IsVisible ?? false) || (_orderedNotices?.IsVisible ?? false);
        Transform PlayerFlowFocus => _questJournal?.IsVisible == true ? _questJournal.Root :
            _traderDialog?.IsVisible == true ? _traderDialog.Root : _orderedNotices?.IsVisible == true ? _orderedNotices.Root : null;

        void InitializePlayerFlows()
        {
            _questJournal = gameObject.AddComponent<QuestJournalView>();
            _questJournal.Initialize(_root, ClosePlayerFlows, handle => _map?.SetTrackedQuest(handle));
            _traderDialog = gameObject.AddComponent<TraderDialogView>();
            _traderDialog.Initialize(_root, ClosePlayerFlows);
            _orderedNotices = gameObject.AddComponent<OrderedNoticeFeed>();
            _orderedNotices.Initialize(_root, ClosePlayerFlows);
            AddPlayerFlowTabs(_questJournal.Root); AddPlayerFlowTabs(_traderDialog.Root); AddPlayerFlowTabs(_orderedNotices.Root);
            _journalButton = MythicUi.Button(_root, "Journal", "J · JOURNAL", new Vector2(.315f, .855f), new Vector2(.395f, .915f),
                () => ShowPlayerFlow(DefaultPlayerFlowPage), fontSize: 14);
            _journalButton.gameObject.SetActive(false);
        }
        void AddPlayerFlowTabs(Transform root)
        {
            string[] names = { "Quests", "Traders", "Notices" };
            for (int i = 0; i < names.Length; i++)
            {
                int page = i;
                var button = MythicUi.Button(root, names[i] + "Tab", names[i].ToUpperInvariant(), new Vector2(.025f + i * .32f, .825f),
                    new Vector2(.335f + i * .32f, .90f), () => ShowPlayerFlow(page));
                if (page != 0) _planningBlockedTabs.Add(button);
            }
        }
        int DefaultPlayerFlowPage => (_map?.IsPlanning ?? false) || _session?.State == SessionState.InMatch ? 0 : 2;
        bool PlayerFlowLauncherAllowed => _session?.Welcome != null && _menu != null && !_menu.gameObject.activeSelf &&
            !_settings.gameObject.activeSelf && !AnyHubPanelVisible && !(_signIn?.gameObject.activeSelf ?? false) &&
            !(_drawer?.IsVisible ?? false) && !(_help?.gameObject.activeSelf ?? false) && !Typing;
        bool PlayerFlowPageAllowed(int page) => page >= 0 && page <= 2 && PlayerFlowLauncherAllowed &&
            (!(_map?.IsPlanning ?? false) || page == 0);
        public void ShowPlayerFlow(int page)
        {
            if (!PlayerFlowPageAllowed(page)) return;
            _returnToResults |= _results.gameObject.activeSelf;
            _results.gameObject.SetActive(false);
            CloseHubPanels();
            if (_map?.IsPlanning == true) BlockPlanningMapInput(); else _map?.SetOpen(false);
            ReleaseChestFocus();
            _orderedNotices.SetRecentVisible(false);
            _questJournal.SetVisible(page == 0); _traderDialog.SetVisible(page == 1); _orderedNotices.SetVisible(page == 2);
            RefreshPlanningJournalAccess();
            RefreshWorldHudVisibility();
            var root = PlayerFlowFocus;
            if (root != null) UiFocusNavigation.Cycle(root, false);
        }
        void ClosePlayerFlows()
        {
            _questJournal?.SetVisible(false); _traderDialog?.SetVisible(false); _orderedNotices?.SetVisible(false);
            RestorePlanningMapInput();
            if (_returnToResults && _session != null) _results.gameObject.SetActive(true);
            _returnToResults = false;
            RefreshWorldHudVisibility();
        }
        void BindPlayerFlows(Session session)
        {
            ClosePlayerFlows(); _returnToResults = false;
            _questJournal?.Bind(session); _traderDialog?.Bind(session); _orderedNotices?.Clear();
            _playerFlowEpoch = session?.TimelineEpoch ?? 0;
            _map?.SetTrackedQuest(null);
            RefreshJournalLauncher();
        }
        void RefreshPlayerFlows()
        {
            RefreshPlanningJournalAccess();
            _questJournal?.Refresh(); _traderDialog?.Refresh();
            _map?.SetTrackedQuest(_questJournal?.TrackedQuest);
            RefreshJournalLauncher();
        }
        void RefreshPlanningJournalAccess()
        {
            bool planning = _map?.IsPlanning == true;
            foreach (var button in _planningBlockedTabs) button.interactable = !planning;
            if (!planning) return;
            if (_traderDialog?.IsVisible == true || _orderedNotices?.IsVisible == true) ClosePlayerFlows();
            if (_questJournal?.IsVisible == true) BlockPlanningMapInput();
        }
        void BlockPlanningMapInput()
        {
            if (_planningMapBlocked) return;
            var map = _root.Find("TacticalMap");
            if (map == null) return;
            _planningMapInput = map.GetComponent<UnityEngine.CanvasGroup>();
            if (_planningMapInput == null) _planningMapInput = map.gameObject.AddComponent<UnityEngine.CanvasGroup>();
            _mapWasInteractable = _planningMapInput.interactable;
            _mapBlockedRaycasts = _planningMapInput.blocksRaycasts;
            _planningReviewSession = _session; _planningReviewEpoch = _session.TimelineEpoch;
            var selected = EventSystem.current?.currentSelectedGameObject;
            _planningReturnFocus = selected != null && selected.transform.IsChildOf(map) ? selected : null;
            _planningMapInput.interactable = false; _planningMapInput.blocksRaycasts = false;
            _planningMapBlocked = true;
        }
        void RestorePlanningMapInput()
        {
            if (!_planningMapBlocked) return;
            if (_planningMapInput != null)
            {
                _planningMapInput.interactable = _mapWasInteractable;
                _planningMapInput.blocksRaycasts = _mapBlockedRaycasts;
            }
            var focus = _planningReturnFocus;
            bool current = ReferenceEquals(_session, _planningReviewSession) && _session != null &&
                _session.TimelineEpoch == _planningReviewEpoch && _map?.IsPlanning == true;
            _planningMapBlocked = false; _planningReturnFocus = null; _planningReviewSession = null;
            if (!current || EventSystem.current == null) return;
            var control = focus != null ? focus.GetComponent<UnityEngine.UI.Selectable>() : null;
            if (focus != null && focus.activeInHierarchy && control != null && control.IsInteractable())
                EventSystem.current.SetSelectedGameObject(focus);
        }
        void ResetPlayerFlowTimeline()
        {
            uint epoch = _session?.TimelineEpoch ?? 0;
            if (_playerFlowEpoch == epoch) return;
            RotateNoticeEvents();
            _orderedNotices?.Clear(); ClosePlayerFlows();
            // A source-clock cut retains canonical collections; Welcome clears them in Session first.
            _questJournal?.Bind(_session); _traderDialog?.Bind(_session);
            _playerFlowEpoch = epoch;
            _map?.SetTrackedQuest(null);
        }
        void TickPlayerFlows()
        {
            if (_session != null && _playerFlowEpoch != _session.TimelineEpoch) ResetPlayerFlowTimeline();
            RefreshPlayerFlows();
            _orderedNotices?.SetRecentVisible(_session != null && WorldHudVisible);
            _orderedNotices?.Refresh();
        }
        void RefreshJournalLauncher()
        {
            if (_journalButton == null) return;
            _journalButton.gameObject.SetActive(PlayerFlowLauncherAllowed && !PlayerFlowVisible);
            var label = _journalButton.GetComponentInChildren<TMP_Text>(true);
            string value = _map?.IsPlanning == true ? "J · QUESTS" : "J · JOURNAL";
            if (label.text != value) label.text = value;
        }
    }
}

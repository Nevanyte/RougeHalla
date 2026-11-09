using Roguehalla.Net;
using Roguehalla.Net.Protocol;
using TMPro;
using UnityEngine;

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
                () => ShowPlayerFlow(_session?.State == SessionState.InMatch ? 0 : 2), fontSize: 14);
            _journalButton.gameObject.SetActive(false);
        }
        void AddPlayerFlowTabs(Transform root)
        {
            string[] names = { "Quests", "Traders", "Notices" };
            for (int i = 0; i < names.Length; i++)
            {
                int page = i;
                MythicUi.Button(root, names[i] + "Tab", names[i].ToUpperInvariant(), new Vector2(.025f + i * .32f, .825f),
                    new Vector2(.335f + i * .32f, .90f), () => ShowPlayerFlow(page));
            }
        }
        bool PlayerFlowLauncherAllowed => _session?.Welcome != null && _menu != null && !_menu.gameObject.activeSelf &&
            !_settings.gameObject.activeSelf && !AnyHubPanelVisible && !(_signIn?.gameObject.activeSelf ?? false) &&
            !(_drawer?.IsVisible ?? false) && !(_help?.gameObject.activeSelf ?? false) && !(_map?.IsPlanning ?? false);
        public void ShowPlayerFlow(int page)
        {
            if (page < 0 || page > 2 || !PlayerFlowLauncherAllowed) return;
            _returnToResults |= _results.gameObject.activeSelf;
            _results.gameObject.SetActive(false);
            CloseHubPanels(); _map?.SetOpen(false); ReleaseChestFocus();
            _orderedNotices.SetRecentVisible(false);
            _questJournal.SetVisible(page == 0); _traderDialog.SetVisible(page == 1); _orderedNotices.SetVisible(page == 2);
            RefreshWorldHudVisibility();
            var root = PlayerFlowFocus;
            if (root != null) UiFocusNavigation.Cycle(root, false);
        }
        void ClosePlayerFlows()
        {
            _questJournal?.SetVisible(false); _traderDialog?.SetVisible(false); _orderedNotices?.SetVisible(false);
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
            _questJournal?.Refresh(); _traderDialog?.Refresh();
            _map?.SetTrackedQuest(_questJournal?.TrackedQuest);
            RefreshJournalLauncher();
        }
        void ResetPlayerFlowTimeline()
        {
            uint epoch = _session?.TimelineEpoch ?? 0;
            if (_playerFlowEpoch == epoch) return;
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
            string value = "J · JOURNAL";
            if (label.text != value) label.text = value;
        }
    }
}

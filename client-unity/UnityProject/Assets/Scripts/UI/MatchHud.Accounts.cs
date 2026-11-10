using Roguehalla.Net;
using Roguehalla.Net.Ui;
using TMPro;
using UnityEngine;

namespace Roguehalla.Client
{
    public sealed partial class MatchHud
    {
        RectTransform _signIn, _signInBackdrop;
        TMP_InputField _ownershipKey, _passcode;
        TMP_Text _accountStatus, _profileSummary, _launchInfo;
        UnityEngine.UI.Button _loadProfile, _joinMatch, _joinTraining;
        CanvasGroup _launchMenuInput;
        AccountHubSnapshot _accountShown;
        HubGuideView _hubGuide;
        LaunchScreenView _launch;
        LaunchBackdrop _backdrop;
        HubProgressView _hubProgress;
        AccountRecoveryView _recovery;
        HubCosmeticsView _hubCosmetics;
        bool AnyHubPanelVisible => (_recovery != null && _recovery.IsVisible) || (_hubGuide != null && _hubGuide.IsVisible) || (_hubProgress != null && _hubProgress.IsVisible) || (_hubCosmetics != null && _hubCosmetics.IsVisible);
        public string OwnershipKey => _ownershipKey != null ? _ownershipKey.text : "";
        public string PlaytestPasscode => _passcode != null ? _passcode.text : "";

        void CreateJoinMenu()
        {
            // The launch screen (legacy menu panel + hub room, see LaunchScreenView) lives in its own legacy-unit stage under JoinMenu.
            _menu = Rect(_root, "JoinMenu", 0, 0, 1, 1);
            _launchMenuInput = _menu.gameObject.AddComponent<CanvasGroup>();
            _launch = gameObject.AddComponent<LaunchScreenView>();
            _launch.Build(_menu);
            _backdrop = gameObject.AddComponent<LaunchBackdrop>();
            _backdrop.Initialize(_client.Cam, _client);
            _nickname = _launch.Callsign; _nickname.text = _client.Profile;
            _loadProfile = _launch.Load; _joinMatch = _launch.Play; _joinTraining = _launch.Training;
            _profileSummary = _launch.RecordText; _launchInfo = _launch.Reason; _accountStatus = _launch.Status;
            _launch.LoadRequested = () => _client.OpenProfile(_nickname.text, OwnershipKey, PlaytestPasscode);
            _launch.ProfileRequested = () => OpenProgress(HubProgressTab.Profile);
            _launch.SignInRequested = () => SetSignInVisible(true);
            _launch.GuideRequested = () => { CloseHubPanels(); _hubGuide.ShowTab(HubGuideView.GuideTab.Champions); };
            _launch.PlayRequested = StartRun;
            _launch.TrainingRequested = StartTraining;
            _launch.CancelRequested = () => _client.Leave();
            _launch.FactionChosen = SetFaction;
            _launch.Atrium.PlayRequested = StartRun;
            _launch.Atrium.TrainingRequested = StartTraining;
            _launch.Atrium.FactionPicked = SetFaction;
            InitializeResumeMenu();
            _signInBackdrop = Panel(_root, "SignInModal", 0, 0, 1, 1);
            _signInBackdrop.GetComponent<UnityEngine.UI.Image>().color = UiTheme.Current.Scrim;
            _signInBackdrop.gameObject.AddComponent<ModalDismissSurface>().Dismiss = () => SetSignInVisible(false);
            _signIn = Panel(_signInBackdrop, "SignInOptions", .26f, .27f, .74f, .80f);
            Text(_signIn, "SignInTitle", "SIGN-IN & ACCESS", .06f, .80f, .94f, .97f, 26).color = ShowcasePalette.Gold;
            Text(_signIn, "KeyHint", "Existing callsign? Use its sign-in link or enter your ownership key.\nNew callsigns do not need an ownership key.", .06f, .62f, .94f, .79f, 16);
            _ownershipKey = Input(_signIn, _client.PendingSignInKey, .06f, .47f, .94f, .60f);
            _ownershipKey.name = "OwnershipKey"; _ownershipKey.characterLimit = 512; _ownershipKey.contentType = TMP_InputField.ContentType.Password;
            Text(_signIn, "PasscodeHint", "Playtest access code, if required", .06f, .33f, .94f, .44f, 16);
            _passcode = Input(_signIn, "", .06f, .20f, .94f, .32f);
            _passcode.name = "PlaytestAccessCode"; _passcode.characterLimit = 256; _passcode.contentType = TMP_InputField.ContentType.Password;
            Button(_signIn, "SignInDone", "DONE", .06f, .035f, .48f, .16f, () => SetSignInVisible(false));
            Button(_signIn, "OpenRecovery", "RECOVERY KEY", .52f, .035f, .94f, .16f, OpenRecovery);
            SetSignInVisible(false);
            _nickname.onValueChanged.AddListener(name => { _client.SelectProfile(name); _ownershipKey.text = ""; });
        }
        void StartRun()
        {
            if (_joinMatch == null || !_joinMatch.interactable) return;
            _showcaseAudio?.UnlockFromUserGesture(); _client.Join(_nickname.text, _faction, MatchLaunchMode.Arena);
        }
        void StartTraining()
        {
            if (_joinTraining == null || !_joinTraining.interactable) return;
            _showcaseAudio?.UnlockFromUserGesture(); _client.Join(_nickname.text, _faction, MatchLaunchMode.Training);
        }
        // The pending menu keeps Leave available in the global header while preventing
        // controls from reaching a destination that has not delivered its mode fact.
        public void RefreshLaunchConfirmation(Session session)
        {
            if (!ReferenceEquals(_session, session)) return;
            bool pending = _client != null && _client.LaunchPending;
            bool confirmed = _client == null || _client.LaunchVerified;
            _menu.gameObject.SetActive(!confirmed);
            _launchMenuInput.interactable = !pending;
            _map?.Bind(confirmed ? session : null);
            BindPlayerFlows(confirmed ? session : null);
            RefreshWorldHudVisibility();
            _dirty = _rewardsDirty = true;
        }
        void SetSignInVisible(bool visible)
        {
            _signIn.gameObject.SetActive(visible); _signInBackdrop.gameObject.SetActive(visible);
            if (visible) { _recovery?.SetVisible(false); _signInBackdrop.SetAsLastSibling(); }
        }
        void InitializeHubGuides()
        {
            _hubGuide = gameObject.AddComponent<HubGuideView>(); _hubGuide.Initialize(_root, SetFaction);
            _hubGuide.RefreshScale(_showcaseSettings.TextScale);
            _recovery = gameObject.AddComponent<AccountRecoveryView>(); _recovery.Initialize(_root, _client.AccountFlow, ReadRecoveryKey);
            _hubProgress = gameObject.AddComponent<HubProgressView>(); _hubProgress.Initialize(_root, _client.AccountOwner);
            _hubCosmetics = gameObject.AddComponent<HubCosmeticsView>(); _hubCosmetics.Initialize(_root, _client.AccountOwner);
            _launch.Atrium.SetStationHandler(destination =>
            {
                if (!_menu.gameObject.activeSelf || _signIn.gameObject.activeSelf || _settings.gameObject.activeSelf) return;
                CloseHubPanels();
                if (destination == HubDestination.Champions) _hubGuide.ShowTab(HubGuideView.GuideTab.Champions);
                else if (destination == HubDestination.Weapons) _hubGuide.ShowTab(HubGuideView.GuideTab.Weapons);
                else if (destination == HubDestination.Counters) _hubGuide.ShowTab(HubGuideView.GuideTab.Counters);
                else if (destination == HubDestination.Achievements) OpenProgress(HubProgressTab.Achievements);
                else if (destination == HubDestination.Leaderboard) OpenProgress(HubProgressTab.Leaderboard);
                else if (destination == HubDestination.Shop) OpenCosmetics(HubCosmeticsTab.Shop);
                else if (destination == HubDestination.Wardrobe) OpenCosmetics(HubCosmeticsTab.Wardrobe);
                else if (destination == HubDestination.Titles) OpenCosmetics(HubCosmeticsTab.Titles);
            });
            _launch.Atrium.SetFaction(_faction);
            bool services = _client.AccountOwner?.Api != null;
            foreach (var destination in new[] { HubDestination.Shop, HubDestination.Wardrobe, HubDestination.Titles, HubDestination.Achievements, HubDestination.Leaderboard })
                _launch.Atrium.SetStationAvailable(destination, services, services ? "" : "This needs your account, which isn't available from this page.");
        }
        void TickHubAtrium()
        {
            if (_launch == null) return;
            bool menu = _menu.gameObject.activeSelf;
            _launch.Atrium.SetVisible(menu);
            _backdrop?.SetVisible(menu);
            if (!menu) return;
            _launch.SetVeil(_backdrop == null ? 0f : 1f - _backdrop.Reveal);
            _launch.Atrium.ReadInput(!Typing && !_signIn.gameObject.activeSelf && !_settings.gameObject.activeSelf && !AnyHubPanelVisible &&
                !_help.gameObject.activeSelf && !ResumeChooserVisible);
        }

        void CloseHubPanels()
        {
            _recovery?.SetVisible(false); _hubGuide?.SetVisible(false); _hubProgress?.SetVisible(false); _hubCosmetics?.SetVisible(false);
        }
        bool ReadRecoveryKey(out string name, out string key)
        {
            name = key = "";
            return _client?.AccountOwner != null && _client.AccountOwner.TryGetRecoveryKey(out name, out key);
        }
        void OpenRecovery()
        {
            if (_recovery == null) return;
            SetSignInVisible(false); CloseHubPanels(); _recovery.SetVisible(true);
            MythicUi.ApplyTextScale(_recovery.Root, _showcaseSettings.TextScale);
        }
        void OpenProgress(HubProgressTab tab)
        {
            if (_hubProgress == null) return;
            CloseHubPanels(); _hubProgress.Show(tab); _hubProgress.SetVisible(true);
            MythicUi.ApplyTextScale(_hubProgress.Root, _showcaseSettings.TextScale);
        }
        void OpenCosmetics(HubCosmeticsTab tab)
        {
            if (_hubCosmetics == null) return;
            CloseHubPanels(); _hubCosmetics.Show(tab); _hubCosmetics.SetVisible(true);
            _hubCosmetics.RefreshScale(_showcaseSettings.TextScale);
        }

        void RefreshAccountMenu()
        {
            if (_client == null || _launch == null) return;
            var state = _client.AccountFlow?.Snapshot;
            if (!ReferenceEquals(state, _accountShown))
            {
                _accountShown = state;
                if (state?.Profile != null)
                {
                    var p = state.Profile;
                    _launch.SetRecord(p.Gv.ToString("N0"), "Lifetime " + p.GvLifetime.ToString("N0") + "\nRuns " + p.Runs + " · Wins " + p.Wins + " · Kills " + p.Kills);
                }
                else _launch.SetRecordEmpty("Load a callsign to see its record, or just play to claim it.");
            }
            bool busy = (state != null && state.Busy) || _client.ResumeBusy;
            bool pending = _client.LaunchPending;
            _loadProfile.interactable = !busy && !_client.IsDiagnostic;
            var arena = _client.LaunchTarget(MatchLaunchMode.Arena);
            var training = _client.LaunchTarget(MatchLaunchMode.Training);
            bool account = _client.IsDiagnostic || _client.AccountFlow != null;
            string callsignProblem = _client.IsDiagnostic ? null : LaunchCopy.CallsignProblem(_nickname.text);
            bool ready = !busy && !pending && account && arena.Available && callsignProblem == null;
            bool trainingReady = !busy && !pending && !_client.IsDiagnostic && account && training.Available && callsignProblem == null;
            _joinMatch.interactable = ready;
            _joinTraining.interactable = pending || trainingReady;
            RefreshResumeMenu(state, busy, arena, training);
            _launch.SetPlay(pending ? "CONNECTING…" : "START RUN", ready, pending);
            _launch.Atrium.SetPlayAvailable(ready, WhyNotPlay(account, callsignProblem, arena), trainingReady, WhyNotTraining(account, callsignProblem, training));

            string reason = "";
            if (!pending && !busy)
            {
                reason = WhyNotPlay(account, callsignProblem, arena);
                if (reason.Length == 0 && !training.Available) reason = LaunchCopy.UnavailableText(MatchLaunchMode.Training, training);
                if (reason.Length == 0 && !_client.IsDiagnostic) reason = "Training is a private practice room. Nothing is recorded.";
            }
            string status = _client.AccountUiError;
            string resumeStatus = _client.ResumeStatus ?? "";
            if (!string.IsNullOrEmpty(resumeStatus)) status = resumeStatus;
            if (string.IsNullOrEmpty(status) && pending) status = LaunchCopy.PendingText(_client.SelectedLaunchMode);
            if (string.IsNullOrEmpty(status) && _session != null && !pending)
                status = LaunchCopy.SessionFailureText(_session.State, _session.RejectReason);
            if (string.IsNullOrEmpty(status) && state != null)
            {
                if (busy) status = state.State == AccountHubState.PreparingJoin ? "Checking your profile and joining…" : state.State == AccountHubState.Refreshing ? "Refreshing your profile…" : "Loading your profile…";
                else if (state.ConnectionFailure != AccountConnectionFailure.None) status = "The account service and the game server aren't on the same site. Open the game from its main address.";
                else if (state.Failure != AccountFailure.None && state.Failure != AccountFailure.Cancelled) status = AccountFailureText(state.Failure);
                else if (state.Recovery == AccountCredentialRecovery.PageLifetimeOnly) status = "This browser couldn't save your ownership. Open Sign-in → Recovery key and save it before closing this page.";
                else if (state.Profile != null) status = "Profile loaded. Pick a faction and start your run.";
            }
            _launch.SetMessages(status, reason);
            if (_launch.Status.color != StatusTone(status, pending, busy)) _launch.Status.color = StatusTone(status, pending, busy);
        }
        Color StatusTone(string status, bool pending, bool busy)
        {
            var theme = UiTheme.Current;
            if (pending || busy) return theme.TextPrimary;
            if (status != null && status.StartsWith("Profile loaded")) return theme.Success;
            return theme.Warning;
        }
        static string WhyNotPlay(bool account, string callsignProblem, MatchLaunchTarget arena)
        {
            if (!account) return "Accounts aren't reachable from this page. Reload, or open the game from its main address.";
            if (callsignProblem != null) return callsignProblem;
            return arena.Available ? "" : LaunchCopy.UnavailableText(MatchLaunchMode.Arena, arena);
        }
        static string WhyNotTraining(bool account, string callsignProblem, MatchLaunchTarget training)
        {
            if (!account) return "Accounts aren't reachable from this page. Reload, or open the game from its main address.";
            if (callsignProblem != null) return callsignProblem;
            return training.Available ? "" : LaunchCopy.UnavailableText(MatchLaunchMode.Training, training);
        }
        static string AccountFailureText(AccountFailure failure)
        {
            switch (failure)
            {
                case AccountFailure.InvalidName: return "Use 2–16 letters, numbers, underscores or hyphens for your callsign.";
                case AccountFailure.Taken: return "This callsign belongs to someone else. Sign in with its key, or pick another name.";
                case AccountFailure.PasscodeRequired: return "A playtest access code is required. Open Sign-in and enter it.";
                case AccountFailure.RateLimited: return "Too many attempts. Wait a moment, then try again.";
                case AccountFailure.Unreadable: return "The account service sent something unreadable. Please try again.";
                default: return "Couldn't reach the account service. Check your connection and try again.";
            }
        }
    }
}

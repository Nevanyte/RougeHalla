using System;
using Roguehalla.Net;
using Roguehalla.Net.Ui;
using TMPro;
using UnityEngine;
using UnityEngine.EventSystems;

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
        bool _focusCallsignPending = true;
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
            _launch.SetRecordEmpty(_client.IsDiagnostic ? "Diagnostic session: accounts are off for this loopback test." : "Load a callsign to see its record, or just play to claim it.");
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
            _signInBackdrop = ModalBackdrop("SignInModal");
            _signInBackdrop.gameObject.AddComponent<ModalDismissSurface>().Dismiss = () => SetSignInVisible(false);
            var theme = UiTheme.Current;
            _signIn = ModalCard(_signInBackdrop, "SignInOptions", 440f, 300f, "SIGN-IN & ACCESS", () => SetSignInVisible(false));
            LaunchUi.Text(_signIn, "KeyHint", 16f, 48f, 408f, 38f, "Already have a callsign? Open its sign-in link, or paste its ownership key below. A new callsign doesn't need a key.", 12.5f, theme.TextSecondary, TextAlignmentOptions.TopLeft, false, UiFontRole.Body, true);
            LaunchUi.Text(_signIn, "OwnershipLabel", 16f, 94f, 408f, 14f, "OWNERSHIP KEY", 11f, theme.TextSecondary, TextAlignmentOptions.MidlineLeft, true).characterSpacing = 1.5f;
            _ownershipKey = LaunchUi.Input(_signIn, "OwnershipKey", _client.PendingSignInKey, "paste your key", 16f, 112f, 408f, 36f, 512);
            _ownershipKey.contentType = TMP_InputField.ContentType.Password;
            LaunchUi.Text(_signIn, "PasscodeHint", 16f, 158f, 408f, 14f, "PLAYTEST ACCESS CODE, IF REQUIRED", 11f, theme.TextSecondary, TextAlignmentOptions.MidlineLeft, true).characterSpacing = 1.5f;
            _passcode = LaunchUi.Input(_signIn, "PlaytestAccessCode", "", "access code", 16f, 176f, 408f, 36f, 256);
            _passcode.contentType = TMP_InputField.ContentType.Password;
            var recovery = LaunchUi.Button(_signIn, "OpenRecovery", 16f, 236f, 200f, 44f, LaunchUi.Look.Raised, OpenRecovery);
            LaunchUi.Text(recovery.transform, "Label", 0, 0, 200f, 44f, "RECOVERY KEY", 13f, theme.TextPrimary, TextAlignmentOptions.Center, true);
            var done = LaunchUi.Button(_signIn, "SignInDone", 224f, 236f, 200f, 44f, LaunchUi.Look.Primary, () => SetSignInVisible(false));
            LaunchUi.Text(done.transform, "Label", 0, 0, 200f, 44f, "DONE", 14f, theme.OutlineDark, TextAlignmentOptions.Center, true);
            SetSignInVisible(false);
            _nickname.onValueChanged.AddListener(name => { _client.SelectProfile(name); _ownershipKey.text = ""; });
        }
        /// <summary>A full-window scrim for a modal card; clicking it outside the card dismisses (the owner adds <see cref="ModalDismissSurface"/>).</summary>
        RectTransform ModalBackdrop(string name)
        {
            var rect = Rect(_root, name, 0, 0, 1, 1);
            var image = rect.gameObject.AddComponent<UnityEngine.UI.Image>(); image.color = UiTheme.Current.Scrim; image.raycastTarget = true;
            return rect;
        }

        /// <summary>
        /// A centred card in legacy HUD units (its own stage inside the backdrop): slate fill, gold Cinzel title, a close button top right.
        /// The returned rect is the card; children are placed from its top-left in HUD units.
        /// </summary>
        RectTransform ModalCard(RectTransform backdrop, string name, float width, float height, string title, Action close, bool closeButton = true)
        {
            var theme = UiTheme.Current;
            var stageGo = new GameObject("ModalStage", typeof(RectTransform), typeof(HudStage));
            stageGo.transform.SetParent(backdrop, false);
            stageGo.GetComponent<HudStage>().Relayout();
            var card = HudUi.Box(stageGo.transform, name, HudAnchor.Center, 0, 0, width, height);
            HudUi.Surface(card, UiTheme.With(theme.Surface, 1f), theme.CornerRadiusLarge, theme.BorderStrong, true, true);
            LaunchUi.Text(card, name + "Title", 16f, 12f, width - 64f, 30f, title, 20f, theme.Accent, TextAlignmentOptions.MidlineLeft, true, UiFontRole.Display).characterSpacing = 1.5f;
            LaunchUi.Bar(card, name + "TitleRule", 16f, 44f, width - 32f, 2f, theme.AccentDim);
            if (!closeButton) return card;
            var x = LaunchUi.Button(card, name + "Close", width - 42f, 12f, 28f, 28f, LaunchUi.Look.Raised, () => close());
            LaunchUi.Text(x.transform, "Label", 0, 0, 28f, 28f, "x", 15f, theme.TextPrimary, TextAlignmentOptions.Center, true);
            return card;
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
            _launch.Atrium.SetVisible(menu && !AnyHubPanelVisible); // hub panels get the vista to themselves
            _backdrop?.SetVisible(menu);
            if (!menu) return;
            if (_focusCallsignPending && !AnyHubPanelVisible && !ResumeChooserVisible && !_signIn.gameObject.activeSelf && _nickname != null &&
                string.IsNullOrEmpty(_nickname.text) && EventSystem.current != null && !(_client != null && _client.LaunchPending))
            {
                // A first visit with no callsign: put the cursor in the name field, the one thing needed before playing.
                _focusCallsignPending = false;
                EventSystem.current.SetSelectedGameObject(_nickname.gameObject);
                _nickname.ActivateInputField();
            }
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
            _launch.SetPlay(pending ? "JOINING" : "START RUN", ready, pending);
            _launch.Atrium.SetPlayAvailable(ready, WhyNotPlay(account, callsignProblem, arena), callsignProblem != null && arena.Available ? "Type a callsign first" : "Unavailable",
                trainingReady, WhyNotTraining(account, callsignProblem, training), "Unavailable");

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
            if (!arena.Available) return LaunchCopy.UnavailableText(MatchLaunchMode.Arena, arena);
            return callsignProblem ?? "";
        }
        static string WhyNotTraining(bool account, string callsignProblem, MatchLaunchTarget training)
        {
            if (!account) return "Accounts aren't reachable from this page. Reload, or open the game from its main address.";
            if (!training.Available) return LaunchCopy.UnavailableText(MatchLaunchMode.Training, training);
            return callsignProblem ?? "";
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

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
        TMP_Text _accountStatus, _profileSummary;
        UnityEngine.UI.Button _loadProfile, _joinMatch;
        AccountHubSnapshot _accountShown;
        HubGuideView _hubGuide;
        HubAtriumView _atrium;
        HubProgressView _hubProgress;
        AccountRecoveryView _recovery;
        HubCosmeticsView _hubCosmetics;
        bool AnyHubPanelVisible => (_recovery != null && _recovery.IsVisible) || (_hubGuide != null && _hubGuide.IsVisible) || (_hubProgress != null && _hubProgress.IsVisible) || (_hubCosmetics != null && _hubCosmetics.IsVisible);
        public string OwnershipKey => _ownershipKey != null ? _ownershipKey.text : "";
        public string PlaytestPasscode => _passcode != null ? _passcode.text : "";

        void CreateJoinMenu()
        {
            _menu = Panel(_root, "JoinMenu", .015f, .17f, .35f, .91f);
            Text(_menu, "Title", "ROGUEHALLA", .06f, .90f, .94f, .99f, 28).color = ShowcasePalette.Gold;
            Button(_menu, "OpenProfileRecords", "PROFILE & RECORDS", .06f, .82f, .94f, .90f, () => OpenProgress(HubProgressTab.Profile));
            _nickname = Input(_menu, _client.Profile, .06f, .72f, .68f, .81f);
            _loadProfile = Button(_menu, "LoadProfile", "LOAD", .71f, .72f, .94f, .81f,
                () => _client.OpenProfile(_nickname.text, OwnershipKey, PlaytestPasscode));
            _profileSummary = Text(_menu, "ProfileSummary", "Enter a callsign to load or claim it.\nYour saved ownership stays on this device.", .06f, .54f, .94f, .71f, 16);
            _factionLabel = Text(_menu, "Faction", "", .06f, .46f, .94f, .53f, 17);
            for (int i = 0; i < Factions.Length; i++)
            {
                int selected = i;
                float x = .06f + i % 2 * .46f, y = .37f - i / 2 * .09f;
                var button = Button(_menu, "Faction" + Factions[i], ShowcasePalette.GetFactionMark(i) + " " + Factions[i], x, y, x + .42f, y + .08f, () => SetFaction(selected));
                button.GetComponentInChildren<TMP_Text>().color = ShowcasePalette.Faction(i);
            }
            Button(_menu, "SignInOptions", "SIGN-IN OPTIONS", .52f, .19f, .94f, .27f, () => SetSignInVisible(true));
            _joinMatch = Button(_menu, "Join", "START RUN", .06f, .065f, .94f, .16f, () =>
            {
                _showcaseAudio?.UnlockFromUserGesture(); _client.Join(_nickname.text, _faction);
            });
            _accountStatus = Text(_root, "AccountStatus", "", .025f, .09f, .95f, .16f, 17);
            _signInBackdrop = Panel(_root, "SignInModal", 0, 0, 1, 1);
            _signInBackdrop.GetComponent<UnityEngine.UI.Image>().color = new Color32(3, 7, 12, 220);
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
            _atrium = gameObject.AddComponent<HubAtriumView>(); _atrium.Initialize(_root, destination =>
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
            _atrium.SetFaction(_faction);
            bool services = _client.AccountOwner?.Api != null;
            foreach (var destination in new[] { HubDestination.Shop, HubDestination.Wardrobe, HubDestination.Titles, HubDestination.Achievements, HubDestination.Leaderboard })
                _atrium.SetStationAvailable(destination, services, services ? "Open " + destination + "." : "Account services are unavailable for this connection.");
            var close = _root.Find("HubAtrium/CloseAtrium"); if (close != null) close.gameObject.SetActive(false);
        }
        void TickHubAtrium()
        {
            if (_atrium == null) return;
            bool menu = _menu.gameObject.activeSelf;
            _atrium.SetVisible(menu);
            if (!menu) return;
            _atrium.ReadInput(!Typing && !_signIn.gameObject.activeSelf && !_settings.gameObject.activeSelf && !AnyHubPanelVisible && !_help.gameObject.activeSelf);
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
            if (_client == null || _profileSummary == null) return;
            var state = _client.AccountFlow?.Snapshot;
            if (!ReferenceEquals(state, _accountShown))
            {
                _accountShown = state;
                if (state?.Profile != null)
                {
                    var p = state.Profile;
                    _profileSummary.text = p.Name + "\nGV " + p.Gv.ToString("N0") + " · Lifetime " + p.GvLifetime.ToString("N0") +
                        "\nRuns " + p.Runs + " · Wins " + p.Wins + " · Draws " + p.Draws + "\nDeaths " + p.Deaths + " · Kills " + p.Kills;
                }
                else _profileSummary.text = "Enter a callsign to load or claim it.\nYour saved ownership stays on this device.";
            }
            bool busy = state != null && state.Busy;
            _loadProfile.interactable = !busy && !_client.IsDiagnostic;
            _joinMatch.interactable = !busy && (_client.IsDiagnostic || _client.AccountFlow != null);
            string status = _client.AccountUiError;
            if (string.IsNullOrEmpty(status) && state != null)
            {
                if (busy) status = state.State == AccountHubState.PreparingJoin ? "Checking your profile and joining…" : state.State == AccountHubState.Refreshing ? "Refreshing your profile…" : "Loading your profile…";
                else if (state.ConnectionFailure != AccountConnectionFailure.None) status = "The account and match server addresses do not match. Check the connection settings.";
                else if (state.Failure != AccountFailure.None && state.Failure != AccountFailure.Cancelled) status = AccountFailureText(state.Failure);
                else if (state.Recovery == AccountCredentialRecovery.PageLifetimeOnly) status = "This browser could not save your ownership. Open Sign-in options → Recovery key and save it before closing this page.";
                else if (state.Profile != null) status = "Profile loaded. Choose a faction and start your run.";
            }
            if (_accountStatus.text != status) _accountStatus.text = status;
            _accountStatus.gameObject.SetActive(_menu.gameObject.activeSelf);
        }
        static string AccountFailureText(AccountFailure failure)
        {
            switch (failure)
            {
                case AccountFailure.InvalidName: return "Use 2–16 letters, numbers, underscores or hyphens for your callsign.";
                case AccountFailure.Taken: return "This callsign needs its owner's sign-in key. Sign in or choose another name.";
                case AccountFailure.PasscodeRequired: return "A playtest access code is required. Open Sign-in options.";
                case AccountFailure.RateLimited: return "Too many attempts. Wait a moment, then try again.";
                case AccountFailure.Unreadable: return "The profile response could not be read. Please try again.";
                default: return "The profile service is unavailable. Please try again.";
            }
        }
    }
}

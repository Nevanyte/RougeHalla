using System;
using System.Threading.Tasks;
using Roguehalla.Net;
using UnityEngine;

namespace Roguehalla.Client
{
    public sealed partial class MatchClient
    {
        public string PageUrl = "", AccountApi = "", PendingSignInKey = "";
        public string TrainingUrl = "";
        public bool DiagnosticRequested;
        /// <summary>Loopback diagnostics only (<c>?pausepredict=0</c>): the walk does not mirror the server attack pause.</summary>
        public bool PausePredictionOff;
        public AccountCoordinator AccountOwner { get; private set; }
        public AccountHubFlow AccountFlow => AccountOwner != null ? AccountOwner.Flow : null;
        public string AccountUiError { get; private set; } = "";
        long _joinGeneration;
        bool _destroying;
        AccountEndpoint _launchEndpoint;
        MatchLaunchConfig _launchConfig;
        AccountEndpoint _configuredEndpoint;
        string _configuredArena, _configuredTraining;
        public MatchLaunchMode SelectedLaunchMode { get; private set; } = MatchLaunchMode.Arena;
        public bool IsDiagnostic => AccountConnectionPolicy.AllowsDiagnostic(PageUrl, Url, DiagnosticRequested, Application.isEditor);

        public MatchLaunchTarget LaunchTarget(MatchLaunchMode mode)
        {
            if (_launchEndpoint == null)
            {
                try { _launchEndpoint = AccountEndpoint.FromPage(PageUrl, string.IsNullOrEmpty(AccountApi) ? null : AccountApi); }
                catch (ArgumentException) { }
            }
            if (_launchConfig == null || !ReferenceEquals(_configuredEndpoint, _launchEndpoint) || _configuredArena != Url || _configuredTraining != TrainingUrl)
            {
                _configuredEndpoint = _launchEndpoint; _configuredArena = Url; _configuredTraining = TrainingUrl;
                _launchConfig = new MatchLaunchConfig(_launchEndpoint, Url, TrainingUrl);
            }
            // The existing explicit loopback diagnostic path remains Arena-only; the menu
            // cannot turn diagnostic credentials into ordinary Training ownership.
            if (IsDiagnostic && mode == MatchLaunchMode.Arena)
                return new MatchLaunchTarget(mode, Url, true, "");
            return _launchConfig.Target(mode);
        }

        public bool SelectLaunchMode(MatchLaunchMode mode)
        {
            if (_destroying) return false;
            var target = LaunchTarget(mode);
            if (!target.Available) { AccountUiError = target.UnavailableReason; return false; }
            if (SelectedLaunchMode == mode) return true;
            if (Session != null) { AccountUiError = "Use Leave / menu before changing destination."; return false; }
            SelectedLaunchMode = mode;
            long generation = ++_joinGeneration;
            CancelSeatPreparation(true);
            if (generation != _joinGeneration || _destroying) return false;
            if (AccountFlow?.Snapshot.Busy == true) AccountFlow.Cancel();
            if (generation != _joinGeneration || SelectedLaunchMode != mode) return false;
            AccountUiError = "";
            return true;
        }

        void InitializeAccounts()
        {
            if (IsDiagnostic) return;
            try
            {
                _launchEndpoint = AccountEndpoint.FromPage(PageUrl, string.IsNullOrEmpty(AccountApi) ? null : AccountApi);
                AccountOwner = gameObject.AddComponent<AccountCoordinator>();
                AccountOwner.Initialize(PageUrl, string.IsNullOrEmpty(AccountApi) ? null : AccountApi);
                AccountFlow.SelectName(Profile);
            }
            catch (ArgumentException) { AccountUiError = "The account service address is not configured correctly."; }
        }
        public void SelectProfile(string name)
        {
            if (_destroying) return;
            long generation = ++_joinGeneration; PendingSignInKey = ""; AccountUiError = "";
            CancelSeatPreparation(true);
            if (generation != _joinGeneration || _destroying) return;
            CloseCurrentSession();
            if (generation != _joinGeneration || _destroying) return;
            AccountFlow?.SelectName(name);
        }
        public void SelectFaction(int faction)
        { TrySelectFaction(faction); }
        bool TrySelectFaction(int faction)
        {
            if (Faction == faction) return true;
            if (_destroying || Session != null) { AccountUiError = "Use Leave / menu before changing faction."; return false; }
            Faction = faction; long generation = ++_joinGeneration;
            CancelSeatPreparation(true);
            if (generation != _joinGeneration || _destroying) return false;
            if (AccountFlow?.Snapshot.Busy == true)
            {
                AccountFlow.Cancel();
                if (generation != _joinGeneration) return false;
                AccountUiError = "Faction changed. Start your run again when ready.";
            }
            return generation == _joinGeneration;
        }
        public async void OpenProfile(string name, string key, string passcode)
        {
            if (_destroying || AccountFlow == null) return;
            // Re-verifying the same inactive owner must not discard a kept resume record.
            bool keepCheckpoint = Session == null && _seatRecord != null && _seatRecord.Callsign == SeatName(name);
            long generation = ++_joinGeneration; AccountUiError = "";
            CancelSeatPreparation(true);
            if (generation != _joinGeneration || _destroying) return;
            _resumeStatus = "";
            CloseCurrentSession(keepCheckpoint: keepCheckpoint);
            if (generation != _joinGeneration || _destroying) return;
            try { await AccountFlow.OpenProfileAsync(name, string.IsNullOrEmpty(key) ? null : key, string.IsNullOrEmpty(passcode) ? null : passcode); }
            catch { if (this != null && generation == _joinGeneration) AccountUiError = "The account service is unavailable. Please try again."; }
        }
        public void Join(string nickname, int faction)
        {
            if (_destroying) return;
            if (Session != null && Session.State != SessionState.Ended && Session.State != SessionState.Failed && Session.State != SessionState.Rejected && Session.State != SessionState.Idle)
            { AccountUiError = "A session is already open. Leave before starting another."; return; }
            var mode = SelectedLaunchMode;
            if (!TrySelectFaction(faction) || SelectedLaunchMode != mode) return;
            var target = LaunchTarget(mode);
            if (!target.Available) { AccountUiError = target.UnavailableReason; return; }
            if (IsDiagnostic && target.Mode == MatchLaunchMode.Arena) { JoinCore(nickname, faction, target, Token, ++_joinGeneration); return; }
            _ = JoinOwned(nickname, faction, target);
        }
        public void Join(string nickname, int faction, MatchLaunchMode mode)
        {
            if (SelectLaunchMode(mode)) Join(nickname, faction);
        }
        async Task JoinOwned(string nickname, int faction, MatchLaunchTarget target)
        {
            if (AccountFlow == null) { AccountUiError = "The account service is unavailable."; return; }
            long generation = ++_joinGeneration;
            CancelSeatPreparation(true);
            if (generation != _joinGeneration || _destroying) return;
            string key = Hud != null ? Hud.OwnershipKey : PendingSignInKey;
            string passcode = Hud != null ? Hud.PlaytestPasscode : null;
            AccountUiError = "";
            try
            {
                var intent = await AccountFlow.PrepareJoinAsync(nickname, target.Url, string.IsNullOrEmpty(key) ? null : key, string.IsNullOrEmpty(passcode) ? null : passcode);
                if (this == null || _destroying || generation != _joinGeneration || intent == null) return;
                if (!CurrentLaunchTarget(target, faction) || !string.Equals(target.Url, intent.MatchUrl, StringComparison.Ordinal)) { AccountUiError = "The connection changed. Start your run again."; return; }
                if (!AccountFlow.CanJoin(intent)) return;
                var settlementAccess = target.Mode == MatchLaunchMode.Arena ? AccountOwner.Api?.CaptureSettlementAccess(intent) : null;
                JoinCore(intent.Account.CanonicalName, faction, target, intent.Account.Token, generation, settlementAccess, intent);
                if (this == null || generation != _joinGeneration) return;
                try { PlayerPrefs.SetString("rh.ui.profile", intent.Account.CanonicalName); PlayerPrefs.Save(); } catch { }
            }
            catch
            {
                if (this != null && !_destroying && generation == _joinGeneration)
                { AccountUiError = "Could not join. Please try again."; CancelOwnedJoin(); }
            }
        }
        bool CurrentLaunchTarget(MatchLaunchTarget target, int faction)
        {
            var configured = LaunchTarget(target.Mode);
            return SelectedLaunchMode == target.Mode && Faction == faction && configured.Available &&
                string.Equals(configured.Url, target.Url, StringComparison.Ordinal);
        }
        long CancelOwnedJoin()
        {
            long generation = ++_joinGeneration;
            CancelSeatPreparation(true);
            if (generation != _joinGeneration) return generation;
            CloseCurrentSession();
            if (generation == _joinGeneration) AccountFlow?.Cancel();
            return generation;
        }
        public async void RefreshAccountAfterResult()
        {
            if (_destroying || AccountFlow == null || IsDiagnostic || AccountFlow.Snapshot.Busy) return;
            long generation = _joinGeneration;
            try { await AccountFlow.RefreshAfterResultAsync(); }
            catch { if (this != null && generation == _joinGeneration) AccountUiError = "Profile refresh is unavailable. Your match result remains visible."; }
        }
    }
}

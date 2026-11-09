using System;
using System.Threading.Tasks;
using Roguehalla.Net;
using UnityEngine;

namespace Roguehalla.Client
{
    public sealed partial class MatchClient
    {
        public string PageUrl = "", AccountApi = "", PendingSignInKey = "";
        public bool DiagnosticRequested;
        public AccountCoordinator AccountOwner { get; private set; }
        public AccountHubFlow AccountFlow => AccountOwner != null ? AccountOwner.Flow : null;
        public string AccountUiError { get; private set; } = "";
        long _joinGeneration;
        public bool IsDiagnostic => AccountConnectionPolicy.AllowsDiagnostic(PageUrl, Url, DiagnosticRequested, Application.isEditor);

        void InitializeAccounts()
        {
            if (IsDiagnostic) return;
            try
            {
                AccountOwner = gameObject.AddComponent<AccountCoordinator>();
                AccountOwner.Initialize(PageUrl, string.IsNullOrEmpty(AccountApi) ? null : AccountApi);
                AccountFlow.SelectName(Profile);
            }
            catch (ArgumentException) { AccountUiError = "The account service address is not configured correctly."; }
        }
        public void SelectProfile(string name)
        {
            ++_joinGeneration; PendingSignInKey = ""; AccountUiError = "";
            AccountFlow?.SelectName(name);
        }
        public void SelectFaction(int faction)
        {
            if (Faction == faction) return;
            Faction = faction; ++_joinGeneration;
            if (AccountFlow?.Snapshot.Busy == true)
            {
                AccountFlow.Cancel(); AccountUiError = "Faction changed. Start your run again when ready.";
            }
        }
        public async void OpenProfile(string name, string key, string passcode)
        {
            if (AccountFlow == null) return;
            long generation = ++_joinGeneration; AccountUiError = "";
            try { await AccountFlow.OpenProfileAsync(name, string.IsNullOrEmpty(key) ? null : key, string.IsNullOrEmpty(passcode) ? null : passcode); }
            catch { if (this != null && generation == _joinGeneration) AccountUiError = "The account service is unavailable. Please try again."; }
        }
        public void Join(string nickname, int faction)
        {
            SelectFaction(faction);
            if (IsDiagnostic) { JoinCore(nickname, faction, Url, Token); return; }
            _ = JoinOwned(nickname, faction);
        }
        async Task JoinOwned(string nickname, int faction)
        {
            if (AccountFlow == null) { AccountUiError = "The account service is unavailable."; return; }
            long generation = ++_joinGeneration;
            string key = Hud != null ? Hud.OwnershipKey : PendingSignInKey;
            string passcode = Hud != null ? Hud.PlaytestPasscode : null;
            AccountUiError = "";
            try
            {
                var intent = await AccountFlow.PrepareJoinAsync(nickname, Url, string.IsNullOrEmpty(key) ? null : key, string.IsNullOrEmpty(passcode) ? null : passcode);
                if (this == null || generation != _joinGeneration || intent == null) return;
                if (!string.Equals(Url, intent.MatchUrl, StringComparison.Ordinal)) { AccountUiError = "The connection changed. Start your run again."; return; }
                if (!AccountFlow.CanJoin(intent)) return;
                JoinCore(intent.Account.CanonicalName, faction, intent.MatchUrl, intent.Account.Token);
                try { PlayerPrefs.SetString("rh.ui.profile", intent.Account.CanonicalName); PlayerPrefs.Save(); } catch { }
            }
            catch { if (this != null && generation == _joinGeneration) AccountUiError = "Could not join. Please try again."; }
        }
        void CancelOwnedJoin() { ++_joinGeneration; AccountFlow?.Cancel(); }
        public async void RefreshAccountAfterResult()
        {
            if (AccountFlow == null || IsDiagnostic || AccountFlow.Snapshot.Busy) return;
            long generation = _joinGeneration;
            try { await AccountFlow.RefreshAfterResultAsync(); }
            catch { if (this != null && generation == _joinGeneration) AccountUiError = "Profile refresh is unavailable. Your match result remains visible."; }
        }
    }
}

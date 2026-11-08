using System;
using System.Threading;
using System.Threading.Tasks;

namespace Roguehalla.Net
{
    public enum AccountHubState { Idle, Opening, Owned, PreparingJoin, Refreshing, Failed }
    public enum AccountRefreshReason { None, User, Join, Result }

    /// <summary>Immutable, non-secret projection of the delivered owner summary. The full profile remains unsupported.</summary>
    public sealed class AccountHubProfile
    {
        public string Name { get; }
        public long Gv { get; }
        public long GvLifetime { get; }
        public long Runs { get; }
        public long Wins { get; }
        public long Draws { get; }
        public long Deaths { get; }
        public long Kills { get; }
        public bool HasFullProfile => false;
        internal AccountHubProfile(OwnedAccount owned)
        {
            Name = owned.CanonicalName;
            AccountProfile p = owned.Profile;
            Gv = p.gv; GvLifetime = p.gvLifetime;
            Runs = p.stats.runs; Wins = p.stats.wins; Draws = p.stats.draws; Deaths = p.stats.deaths; Kills = p.stats.kills;
        }
    }

    public sealed class AccountHubSnapshot
    {
        public string SelectedName { get; }
        public AccountHubState State { get; }
        public AccountFailure Failure { get; }
        public AccountConnectionFailure ConnectionFailure { get; }
        public AccountCredentialRecovery Recovery { get; }
        public AccountHubProfile Profile { get; }
        public AccountRefreshReason RefreshReason { get; }
        public bool Busy => State == AccountHubState.Opening || State == AccountHubState.PreparingJoin || State == AccountHubState.Refreshing;
        /// <summary>A result-triggered read cannot identify a committed match: no bank-complete inference is available.</summary>
        public bool ResultBankConfirmed => false;
        internal AccountHubSnapshot(string name, AccountHubState state, AccountFailure failure,
            AccountConnectionFailure connectionFailure, AccountCredentialRecovery recovery, AccountHubProfile profile, AccountRefreshReason reason)
        { SelectedName = name; State = state; Failure = failure; ConnectionFailure = connectionFailure; Recovery = recovery; Profile = profile; RefreshReason = reason; }
    }

    /// <summary>Contains a bearer credential; never log/serialize this intent. Check CanJoin immediately before synchronous Join.</summary>
    public sealed class AccountJoinIntent
    {
        public OwnedAccount Account { get; }
        public string MatchUrl { get; }
        internal AccountHubFlow Owner { get; }
        internal long Generation { get; }
        internal AccountJoinIntent(AccountHubFlow owner, long generation, OwnedAccount account, string matchUrl)
        { Owner = owner; Generation = generation; Account = account; MatchUrl = matchUrl; }
    }

    /// <summary>One main-thread page coordinator. Owns no UI hierarchy, gameplay, socket, placement or operator API.</summary>
    public sealed class AccountHubFlow
    {
        readonly AccountSession _accounts;
        long _generation;
        string _selected = "";
        AccountHubProfile _profile;
        public AccountHubSnapshot Snapshot { get; private set; }
        public event Action<AccountHubSnapshot> Changed;

        public AccountHubFlow(AccountSession accounts)
        {
            _accounts = accounts ?? throw new ArgumentNullException(nameof(accounts));
            Set(AccountHubState.Idle, AccountFailure.None, AccountConnectionFailure.None, AccountRefreshReason.None);
        }

        public void SelectName(string name)
        {
            name = name ?? "";
            if (string.Equals(_selected, name, StringComparison.Ordinal)) return;
            ++_generation; _selected = name; _profile = null; _accounts.ClearSelection();
            Set(AccountHubState.Idle, AccountFailure.None, AccountConnectionFailure.None, AccountRefreshReason.None);
        }

        public void Cancel()
        {
            ++_generation; _accounts.ClearSelection();
            Set(AccountHubState.Idle, AccountFailure.Cancelled, AccountConnectionFailure.None, AccountRefreshReason.None);
        }

        /// <summary>Call when showing a menu after a detached cancellation; it updates recovery metadata without selecting/joining.</summary>
        public void RefreshRecovery()
        {
            if (Snapshot.Recovery != ReadRecovery())
                Set(Snapshot.State, Snapshot.Failure, Snapshot.ConnectionFailure, Snapshot.RefreshReason);
        }

        public async Task<bool> OpenProfileAsync(string name, string pendingKey = null, string passcode = null, CancellationToken cancellation = default)
        { return await Open(name, pendingKey, passcode, cancellation, AccountRefreshReason.User) != null; }

        public async Task<AccountJoinIntent> PrepareJoinAsync(string name, string matchUrl, string pendingKey = null,
            string passcode = null, CancellationToken cancellation = default)
        {
            SelectName(name);
            var failure = AccountConnectionPolicy.CheckOwnedTarget(_accounts.Endpoint, matchUrl);
            if (failure != AccountConnectionFailure.None)
            {
                ++_generation; _accounts.ClearSelection();
                Set(AccountHubState.Failed, AccountFailure.None, failure, AccountRefreshReason.Join);
                return null;
            }
            OwnedAccount owned = await Open(name, pendingKey, passcode, cancellation, AccountRefreshReason.Join);
            if (owned == null || !_accounts.CanJoin(owned)) return null;
            return new AccountJoinIntent(this, _generation, owned, matchUrl);
        }

        /// <summary>No await may intervene between this check and actual synchronous session creation.</summary>
        public bool CanJoin(AccountJoinIntent intent) => intent != null && ReferenceEquals(intent.Owner, this) &&
            intent.Generation == _generation && Snapshot.State == AccountHubState.Owned && _accounts.CanJoin(intent.Account) &&
            AccountConnectionPolicy.CheckOwnedTarget(_accounts.Endpoint, intent.MatchUrl) == AccountConnectionFailure.None;

        /// <summary>Reads the saved profile only. Its counters remain authoritative and may still precede result banking.</summary>
        public async Task<bool> RefreshAfterResultAsync(CancellationToken cancellation = default)
        { return await Open(_selected, null, null, cancellation, AccountRefreshReason.Result) != null; }

        async Task<OwnedAccount> Open(string name, string pendingKey, string passcode, CancellationToken cancellation, AccountRefreshReason reason)
        {
            SelectName(name);
            long generation = ++_generation;
            Set(reason == AccountRefreshReason.Join ? AccountHubState.PreparingJoin : reason == AccountRefreshReason.Result ?
                AccountHubState.Refreshing : AccountHubState.Opening, AccountFailure.None, AccountConnectionFailure.None, reason);
            AccountOpenResult result = await _accounts.OpenAsync(name, pendingKey, passcode, cancellation);
            if (generation != _generation) { RefreshRecovery(); return null; }
            if (result.Account == null || !_accounts.CanJoin(result.Account))
            {
                Set(result.Failure == AccountFailure.Cancelled ? AccountHubState.Idle : AccountHubState.Failed,
                    result.Failure, AccountConnectionFailure.None, reason);
                return null;
            }
            _profile = new AccountHubProfile(result.Account);
            Set(AccountHubState.Owned, AccountFailure.None, AccountConnectionFailure.None, reason);
            return generation == _generation && _accounts.CanJoin(result.Account) ? result.Account : null;
        }

        AccountCredentialRecovery ReadRecovery()
        {
            AccountCredentialRecovery recovery = AccountCredentialRecovery.None;
            try { recovery = _accounts.CredentialRecoveryFor(_selected); } catch (ArgumentException) { }
            return recovery;
        }

        void Set(AccountHubState state, AccountFailure failure, AccountConnectionFailure connectionFailure, AccountRefreshReason reason)
        {
            Snapshot = new AccountHubSnapshot(_selected, state, failure, connectionFailure, ReadRecovery(), _profile, reason);
            Changed?.Invoke(Snapshot);
        }
    }
}

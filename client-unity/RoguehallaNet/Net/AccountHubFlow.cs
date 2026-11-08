using System;
using System.Threading;
using System.Threading.Tasks;

namespace Roguehalla.Net
{
    public enum AccountHubState { Idle, Opening, Owned, PreparingJoin, Refreshing, Failed }
    public enum AccountRefreshReason { None, User, Join, Result }

    /// <summary>Immutable, non-secret projection of the delivered owner summary.</summary>
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
        public bool HasFullProfile { get; }
        internal AccountHubProfile(OwnedAccount owned)
        {
            Name = owned.CanonicalName;
            AccountProfile p = owned.Profile;
            Gv = p.gv; GvLifetime = p.gvLifetime;
            Runs = p.stats.runs; Wins = p.stats.wins; Draws = p.stats.draws; Deaths = p.stats.deaths; Kills = p.stats.kills;
            HasFullProfile = owned.FullProfile != null;
        }
        internal AccountHubProfile(AccountFullProfile profile)
        { Name = profile.Name; Gv = profile.Gv; GvLifetime = profile.GvLifetime; Runs = profile.Stats.Runs; Wins = profile.Stats.Wins; Draws = profile.Stats.Draws; Deaths = profile.Stats.Deaths; Kills = profile.Stats.Kills; HasFullProfile = true; }
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
        public AccountFullProfile FullProfile { get; }
        public AccountFailure FullProfileFailure { get; }
        public bool Busy => State == AccountHubState.Opening || State == AccountHubState.PreparingJoin || State == AccountHubState.Refreshing;
        /// <summary>A result-triggered read cannot identify a committed match: no bank-complete inference is available.</summary>
        public bool ResultBankConfirmed => false;
        internal AccountHubSnapshot(string name, AccountHubState state, AccountFailure failure,
            AccountConnectionFailure connectionFailure, AccountCredentialRecovery recovery, AccountHubProfile profile, AccountRefreshReason reason,
            AccountFullProfile fullProfile, AccountFailure fullProfileFailure)
        { SelectedName = name; State = state; Failure = failure; ConnectionFailure = connectionFailure; Recovery = recovery; Profile = profile; RefreshReason = reason; FullProfile = fullProfile; FullProfileFailure = fullProfileFailure; }
    }

    /// <summary>Contains a bearer credential; never log/serialize this intent. Check CanJoin immediately before synchronous Join.</summary>
    public sealed class AccountJoinIntent
    {
        public OwnedAccount Account { get; }
        public string MatchUrl { get; }
        internal AccountHubFlow Owner { get; }
        internal long Generation { get; }
        internal string ExpectedSelection { get; }
        internal AccountJoinIntent(AccountHubFlow owner, long generation, string expectedSelection, OwnedAccount account, string matchUrl)
        { Owner = owner; Generation = generation; ExpectedSelection = expectedSelection; Account = account; MatchUrl = matchUrl; }
    }

    /// <summary>One main-thread page coordinator. Owns no UI hierarchy, gameplay, socket, placement or operator API.</summary>
    public sealed class AccountHubFlow
    {
        readonly AccountSession _accounts;
        long _generation;
        string _selected = "";
        string _normalizedSelection;
        AccountHubProfile _profile;
        AccountFullProfile _fullProfile;
        AccountFailure _fullProfileFailure;
        AccountApiService _api;
        IAccountApiTransport _apiTransport;
        sealed class Operation
        {
            public long Generation;
            public string Name, ExpectedSelection;
        }
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
            ++_generation; _selected = name; _normalizedSelection = NormalizeOrNull(name); _profile = null; _fullProfile = null; _fullProfileFailure = AccountFailure.None; _accounts.ClearSelection();
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
        { return await Open(Begin(name), pendingKey, passcode, cancellation, AccountRefreshReason.User) != null; }

        public async Task<AccountJoinIntent> PrepareJoinAsync(string name, string matchUrl, string pendingKey = null,
            string passcode = null, CancellationToken cancellation = default)
        {
            Operation operation = Begin(name);
            if (!Current(operation)) return null;
            var failure = AccountConnectionPolicy.CheckOwnedTarget(_accounts.Endpoint, matchUrl);
            if (failure != AccountConnectionFailure.None)
            {
                Set(AccountHubState.Failed, AccountFailure.None, failure, AccountRefreshReason.Join);
                return null;
            }
            OwnedAccount owned = await Open(operation, pendingKey, passcode, cancellation, AccountRefreshReason.Join);
            if (!Current(operation) || !Matches(owned, operation.ExpectedSelection)) return null;
            return new AccountJoinIntent(this, operation.Generation, operation.ExpectedSelection, owned, matchUrl);
        }

        /// <summary>No await may intervene between this check and actual synchronous session creation.</summary>
        public bool CanJoin(AccountJoinIntent intent) => intent != null && ReferenceEquals(intent.Owner, this) &&
            intent.Generation == _generation && Snapshot.State == AccountHubState.Owned && _accounts.CanJoin(intent.Account) &&
            intent.ExpectedSelection == _normalizedSelection && Matches(intent.Account, intent.ExpectedSelection) &&
            AccountConnectionPolicy.CheckOwnedTarget(_accounts.Endpoint, intent.MatchUrl) == AccountConnectionFailure.None;

        /// <summary>Reads the saved profile only. Its counters remain authoritative and may still precede result banking.</summary>
        public async Task<bool> RefreshAfterResultAsync(CancellationToken cancellation = default)
        { return await Open(Begin(_selected), null, null, cancellation, AccountRefreshReason.Result) != null; }

        static string NormalizeOrNull(string name)
        {
            try { return AccountEndpoint.NormalizeName(name); } catch (ArgumentException) { return null; }
        }

        Operation Begin(string name)
        {
            name = name ?? "";
            bool changed = !string.Equals(_selected, name, StringComparison.Ordinal);
            // Bind both identity and generation before the first event. A callback may select/cancel/start another open.
            var operation = new Operation { Generation = ++_generation, Name = name, ExpectedSelection = NormalizeOrNull(name) };
            _selected = name; _normalizedSelection = operation.ExpectedSelection;
            if (changed) { _profile = null; _fullProfile = null; _fullProfileFailure = AccountFailure.None; }
            _accounts.ClearSelection();
            if (changed) Set(AccountHubState.Idle, AccountFailure.None, AccountConnectionFailure.None, AccountRefreshReason.None);
            return operation;
        }

        bool Current(Operation operation) => operation.Generation == _generation &&
            string.Equals(operation.Name, _selected, StringComparison.Ordinal) && operation.ExpectedSelection == _normalizedSelection;

        bool Matches(OwnedAccount account, string expected) => account != null && expected != null &&
            NormalizeOrNull(account.CanonicalName) == expected && _accounts.CanJoin(account);

        async Task<OwnedAccount> Open(Operation operation, string pendingKey, string passcode, CancellationToken cancellation, AccountRefreshReason reason)
        {
            if (!Current(operation)) return null;
            if (cancellation.IsCancellationRequested) { Cancel(); return null; }
            if (operation.ExpectedSelection == null)
            {
                Set(AccountHubState.Failed, AccountFailure.InvalidName, AccountConnectionFailure.None, reason);
                return null;
            }
            Set(reason == AccountRefreshReason.Join ? AccountHubState.PreparingJoin : reason == AccountRefreshReason.Result ?
                AccountHubState.Refreshing : AccountHubState.Opening, AccountFailure.None, AccountConnectionFailure.None, reason);
            // Opening-state subscribers run synchronously. Never start a now-stale claim after those callbacks.
            if (!Current(operation)) return null;
            if (cancellation.IsCancellationRequested) { Cancel(); return null; }
            AccountOpenResult result = await _accounts.OpenAsync(operation.Name, pendingKey, passcode, cancellation);
            if (!Current(operation)) { RefreshRecovery(); return null; }
            if (!Matches(result.Account, operation.ExpectedSelection))
            {
                Set(result.Failure == AccountFailure.Cancelled ? AccountHubState.Idle : AccountHubState.Failed,
                    result.Failure, AccountConnectionFailure.None, reason);
                return null;
            }
            _profile = new AccountHubProfile(result.Account);
            _fullProfile = result.Account.FullProfile;
            _fullProfileFailure = _fullProfile == null ? AccountFailure.Unreadable : AccountFailure.None;
            Set(AccountHubState.Owned, AccountFailure.None, AccountConnectionFailure.None, reason);
            return Current(operation) && Matches(result.Account, operation.ExpectedSelection) ? result.Account : null;
        }

        AccountCredentialRecovery ReadRecovery()
        {
            AccountCredentialRecovery recovery = AccountCredentialRecovery.None;
            try { recovery = _accounts.CredentialRecoveryFor(_selected); } catch (ArgumentException) { }
            return recovery;
        }

        void Set(AccountHubState state, AccountFailure failure, AccountConnectionFailure connectionFailure, AccountRefreshReason reason)
        {
            Snapshot = new AccountHubSnapshot(_selected, state, failure, connectionFailure, ReadRecovery(), _profile, reason, _fullProfile, _fullProfileFailure);
            var published = Snapshot;
            var subscribers = Changed;
            if (subscribers == null) return;
            foreach (Action<AccountHubSnapshot> subscriber in subscribers.GetInvocationList())
            {
                if (!ReferenceEquals(Snapshot, published)) break;
                subscriber(published);
            }
        }

        public AccountApiService CreateApiService(IAccountApiTransport transport)
        {
            if (transport == null) throw new ArgumentNullException(nameof(transport));
            if (_api != null && !ReferenceEquals(_apiTransport, transport)) throw new InvalidOperationException("This page already has an API transport.");
            if (_api == null) { _apiTransport = transport; _api = new AccountApiService(this, transport); }
            return _api;
        }
        internal AccountEndpoint ApiEndpoint => _accounts.Endpoint;
        internal long ApiGeneration => _generation;
        internal sealed class ApiRead
        {
            internal OwnedAccount Account;
            internal AccountFailure Failure;
            internal bool Current;
        }
        internal async Task<ApiRead> OpenApiProfileAsync(CancellationToken cancellation)
        {
            Operation operation = Begin(_selected);
            OwnedAccount account = await Open(operation, null, null, cancellation, AccountRefreshReason.User);
            return new ApiRead { Account = account, Failure = Snapshot.Failure, Current = Current(operation) };
        }
        internal sealed class ApiOwner
        {
            internal long Generation;
            internal string ExpectedSelection;
            internal OwnedAccount Account;
        }
        internal ApiOwner CaptureApiOwner()
        {
            OwnedAccount owned = _accounts.Current;
            return Snapshot.State == AccountHubState.Owned && Matches(owned, _normalizedSelection)
                ? new ApiOwner { Generation = _generation, ExpectedSelection = _normalizedSelection, Account = owned } : null;
        }
        internal bool CurrentApiOwner(ApiOwner owner) => owner != null && owner.Generation == _generation &&
            owner.ExpectedSelection == _normalizedSelection && Matches(owner.Account, owner.ExpectedSelection);
        internal bool PublishApiProfile(ApiOwner owner, AccountFullProfile profile)
        {
            if (!CurrentApiOwner(owner) || profile == null || NormalizeOrNull(profile.Name) != owner.ExpectedSelection) return false;
            _fullProfile = profile; _fullProfileFailure = AccountFailure.None; _profile = new AccountHubProfile(profile);
            Set(AccountHubState.Owned, AccountFailure.None, AccountConnectionFailure.None, AccountRefreshReason.User);
            return CurrentApiOwner(owner);
        }
    }
}

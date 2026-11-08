using System;
using System.Collections.Generic;
using System.Threading;
using System.Threading.Tasks;

namespace Roguehalla.Net
{
    /// <summary>
    /// Account ownership only; it never opens a match, calls operator APIs or chooses a gameplay mode.
    /// Started HTTP claims finish independently of selection cancellation so a confirmed sole token is not orphaned.
    /// </summary>
    public sealed class AccountSession
    {
        readonly AccountEndpoint _endpoint;
        readonly IAccountTransport _transport;
        readonly IAccountCredentialStore _credentials;
        readonly object _lock = new object();
        readonly Dictionary<string, SemaphoreSlim> _gates = new Dictionary<string, SemaphoreSlim>();
        readonly HashSet<string> _rejected = new HashSet<string>();
        sealed class ConfirmedCredential
        {
            public string Token;
            public bool Persistent;
        }
        readonly Dictionary<string, ConfirmedCredential> _confirmed = new Dictionary<string, ConfirmedCredential>();
        long _generation;
        AccountState _state;
        AccountFailure _failure;
        OwnedAccount _current;

        public AccountState State { get { lock (_lock) return _state; } }
        public AccountFailure Failure { get { lock (_lock) return _failure; } }
        public OwnedAccount Current { get { lock (_lock) return _current; } }
        public AccountEndpoint Endpoint => _endpoint;

        string CredentialKey(string normalizedName) => _endpoint.StorageScope + "\0" + normalizedName;

        /// <summary>Non-secret recovery status independent of the current menu selection. Page-only ownership cannot survive a reload.</summary>
        public AccountCredentialRecovery CredentialRecoveryFor(string name)
        {
            string key = CredentialKey(AccountEndpoint.NormalizeName(name));
            lock (_lock) return !_confirmed.TryGetValue(key, out var credential) ? AccountCredentialRecovery.None :
                credential.Persistent ? AccountCredentialRecovery.Persistent : AccountCredentialRecovery.PageLifetimeOnly;
        }

        public AccountSession(AccountEndpoint endpoint, IAccountTransport transport, IAccountCredentialStore credentials)
        {
            _endpoint = endpoint ?? throw new ArgumentNullException(nameof(endpoint));
            _transport = transport ?? throw new ArgumentNullException(nameof(transport));
            _credentials = credentials ?? throw new ArgumentNullException(nameof(credentials));
        }

        /// <summary>Invalidate selection/publication only. Proven credentials, including a late confirmed claim, survive.</summary>
        public void ClearSelection()
        {
            lock (_lock) { ++_generation; _current = null; _state = AccountState.Idle; _failure = AccountFailure.None; }
        }

        /// <summary>Call immediately before ordinary Join; a result retained by a stale caller is never current.</summary>
        public bool CanJoin(OwnedAccount account)
        { lock (_lock) return account != null && ReferenceEquals(_current, account) && _state == AccountState.Owned; }

        public async Task<AccountOpenResult> OpenAsync(string name, string pendingSignInToken = null, string passcode = null,
            CancellationToken cancellation = default)
        {
            long generation;
            lock (_lock) { generation = ++_generation; _current = null; _state = AccountState.Opening; _failure = AccountFailure.None; }
            string normalized;
            try { normalized = AccountEndpoint.NormalizeName(name); }
            catch (ArgumentException) { return Publish(generation, null, AccountFailure.InvalidName); }
            if (cancellation.IsCancellationRequested) return Cancel(generation);

            var cancelled = new TaskCompletionSource<bool>(TaskCreationOptions.RunContinuationsAsynchronously);
            using (cancellation.Register(() => cancelled.TrySetResult(true)))
            {
                Task<AccountOpenResult> fetch = Fetch(generation, normalized, name, pendingSignInToken, passcode, cancellation);
                if (await Task.WhenAny(fetch, cancelled.Task) != fetch || cancellation.IsCancellationRequested)
                    return Cancel(generation);
                AccountOpenResult result = await fetch;
                return Publish(generation, result.Account, result.Failure);
            }
        }

        AccountOpenResult Cancel(long generation)
        {
            lock (_lock)
            {
                if (generation == _generation) { ++_generation; _current = null; _state = AccountState.Idle; _failure = AccountFailure.Cancelled; }
            }
            return new AccountOpenResult(null, AccountFailure.Cancelled);
        }

        AccountOpenResult Publish(long generation, OwnedAccount owned, AccountFailure failure)
        {
            lock (_lock)
            {
                if (generation != _generation) return new AccountOpenResult(null, AccountFailure.Cancelled);
                _current = owned; _failure = failure; _state = owned != null ? AccountState.Owned : AccountState.Failed;
                return new AccountOpenResult(owned, failure);
            }
        }

        async Task<AccountOpenResult> Fetch(long generation, string name, string requestedSpelling, string pendingToken, string passcode, CancellationToken cancellation)
        {
            SemaphoreSlim gate;
            lock (_lock)
            {
                if (!_gates.TryGetValue(name, out gate)) _gates.Add(name, gate = new SemaphoreSlim(1, 1));
            }
            try { await gate.WaitAsync(cancellation); }
            catch (OperationCanceledException) { return new AccountOpenResult(null, AccountFailure.Cancelled); }
            try
            {
                cancellation.ThrowIfCancellationRequested();
                lock (_lock) if (generation != _generation) return new AccountOpenResult(null, AccountFailure.Cancelled);
                string stored = null;
                lock (_lock) if (_confirmed.TryGetValue(CredentialKey(name), out var recovered)) stored = recovered.Token;
                if (stored == null)
                    try { stored = _credentials.Read(_endpoint.StorageScope, name); } catch { /* Storage may be blocked. */ }
                if (!ValidToken(stored)) stored = null;
                bool rejected;
                lock (_lock) rejected = _rejected.Contains(name);
                string token = stored != null && !rejected ? stored : ValidToken(pendingToken) ? pendingToken : stored;
                // Do not bind the caller token to an HTTP request once started: a late200 can hold the only new token.
                AccountHttpResponse response = await _transport.GetProfileAsync(_endpoint.ProfileUrl(requestedSpelling), token, passcode, CancellationToken.None);
                if (response == null) return new AccountOpenResult(null, AccountFailure.Unavailable);
                if (response.Status != 200)
                {
                    if (response.Status == 403 && stored != null && token == stored) lock (_lock) _rejected.Add(name);
                    return new AccountOpenResult(null, FailureFor(response.Status));
                }
                AccountReply reply = response.Reply;
                if (!ValidReply(reply, name, token)) return new AccountOpenResult(null, AccountFailure.Unreadable);
                // Retain before persistent I/O: a late cancelled claim may otherwise lose its sole token when storage fails.
                string key = CredentialKey(AccountEndpoint.NormalizeName(reply.profile.name));
                var confirmed = new ConfirmedCredential { Token = reply.token };
                lock (_lock) _confirmed[key] = confirmed;
                bool saved = false;
                try { saved = _credentials.WriteConfirmed(_endpoint.StorageScope, name, reply.token); } catch { /* Keep usable session ownership. */ }
                lock (_lock) { confirmed.Persistent = saved; _rejected.Remove(name); }
                return new AccountOpenResult(new OwnedAccount(reply, saved), AccountFailure.None);
            }
            catch (OperationCanceledException) { return new AccountOpenResult(null, AccountFailure.Cancelled); }
            catch { return new AccountOpenResult(null, AccountFailure.Unavailable); }
            finally { gate.Release(); }
        }

        static AccountFailure FailureFor(int status) => status == 400 ? AccountFailure.InvalidName : status == 401 ? AccountFailure.PasscodeRequired :
            status == 403 ? AccountFailure.Taken : status == 429 ? AccountFailure.RateLimited : AccountFailure.Unavailable;

        public static bool ValidToken(string token)
        {
            if (string.IsNullOrEmpty(token) || token.Length > 512) return false;
            foreach (char c in token) if (c < 0x21 || c > 0x7e) return false;
            return true;
        }

        static bool ValidReply(AccountReply reply, string name, string presented)
        {
            if (reply?.profile == null || !ValidToken(reply.token)) return false;
            string canonical;
            try { canonical = AccountEndpoint.NormalizeName(reply.profile.name); } catch (ArgumentException) { return false; }
            if (canonical != name) return false;
            if (reply.created)
            {
                if (reply.token.Length != 64) return false;
                foreach (char c in reply.token) if (!(c >= '0' && c <= '9' || c >= 'a' && c <= 'f')) return false;
            }
            else if (presented == null || !string.Equals(presented, reply.token, StringComparison.Ordinal)) return false;
            AccountProfile p = reply.profile;
            return p.gv >= 0 && p.gvLifetime >= 0 && p.stats != null && p.stats.runs >= 0 && p.stats.wins >= 0 &&
                p.stats.draws >= 0 && p.stats.deaths >= 0 && p.stats.kills >= 0;
        }
    }
}

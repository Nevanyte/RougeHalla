using System;
using System.Collections.Generic;
using System.Threading;
using System.Threading.Tasks;

namespace Roguehalla.Net
{
    public enum AccountApiFailure { None, NoOwner, Stale, Cancelled, BadRequest, Forbidden, PasscodeRequired, UnknownCosmetic, UnknownSlot, NotForSale, AlreadyOwned, InsufficientGv, NotOwned, SlotMismatch, RateLimited, Unavailable, Unreadable }
    public enum AccountMutationKind { Purchase, Equip }
    public enum AccountMutationState { Ready, InFlight, Confirmed, Refused, Unknown }
    public sealed class AccountApiError
    {
        public AccountApiFailure Failure { get; }
        public long? Need { get; }
        public long? Have { get; }
        public AccountApiError(AccountApiFailure failure, long? need = null, long? have = null) { Failure = failure; Need = need; Have = have; }
    }
    public sealed class AccountApiRequest
    {
        public AccountEndpoint Endpoint { get; }
        public string Url { get; }
        public string Method { get; }
        public string OwnerToken { get; }
        public string ItemId { get; }
        public string Slot { get; }
        public Guid? PurchaseId { get; }
        public IEnumerable<KeyValuePair<string, string>> Headers
        {
            get
            {
                yield return new KeyValuePair<string, string>("Accept", "application/json");
                if (OwnerToken != null) yield return new KeyValuePair<string, string>("x-profile-token", OwnerToken);
                if (Method == "POST") yield return new KeyValuePair<string, string>("Content-Type", "application/json");
                if (PurchaseId.HasValue) yield return new KeyValuePair<string, string>("Idempotency-Key", PurchaseId.Value.ToString("D"));
            }
        }
        internal AccountApiRequest(AccountEndpoint endpoint, string url, string method, string token, string item = null, string slot = null, Guid? purchaseId = null)
        { Endpoint = endpoint; Url = url; Method = method; OwnerToken = token; ItemId = item; Slot = slot; PurchaseId = purchaseId; }
        public bool HasAllowedTarget()
        {
            if (!Uri.TryCreate(Url, UriKind.Absolute, out var uri)) return false;
            Uri api = Endpoint.ApiBase;
            return uri.Scheme == api.Scheme && uri.Port == api.Port && string.Equals(uri.IdnHost, api.IdnHost, StringComparison.OrdinalIgnoreCase) &&
                uri.UserInfo.Length == 0 && uri.Fragment.Length == 0 && uri.AbsolutePath.StartsWith(api.AbsolutePath, StringComparison.Ordinal);
        }
    }
    public sealed class AccountApiResponse
    {
        public int Status { get; }
        public AccountFullProfile Profile { get; }
        public AccountLeaderboard Leaderboard { get; }
        public AccountApiError Error { get; }
        public AccountApiResponse(int status, AccountFullProfile profile = null, AccountLeaderboard leaderboard = null, AccountApiError error = null)
        { Status = status; Profile = profile; Leaderboard = leaderboard; Error = error; }
    }
    public interface IAccountApiTransport { Task<AccountApiResponse> SendAsync(AccountApiRequest request, CancellationToken cancellation); }
    public sealed class AccountMutation
    {
        public Guid Id { get; } = Guid.NewGuid();
        public string Name { get; }
        public AccountMutationKind Kind { get; }
        public string ItemId { get; }
        public string Slot { get; }
        public AccountMutationState State { get; internal set; }
        public AccountApiError Error { get; internal set; }
        internal string Scope { get; }
        internal string Token { get; }
        internal AccountMutation(string scope, OwnedAccount owner, AccountMutationKind kind, string item, string slot)
        { Scope = scope; Name = owner.CanonicalName; Token = owner.Token; Kind = kind; ItemId = item; Slot = slot; }
    }
    /// <summary>Secret-free pending metadata; selection changes do not erase an uncertain server transaction.</summary>
    public sealed class AccountMutationInfo
    {
        public Guid Id { get; }
        public string Name { get; }
        public AccountMutationKind Kind { get; }
        public string ItemId { get; }
        public string Slot { get; }
        public AccountMutationState State { get; }
        public AccountApiError Error { get; }
        internal AccountMutationInfo(AccountMutation operation)
        { Id = operation.Id; Name = operation.Name; Kind = operation.Kind; ItemId = operation.ItemId; Slot = operation.Slot; State = operation.State; Error = operation.Error; }
    }
    public sealed class AccountApiResult
    {
        public AccountApiFailure Failure { get; }
        public bool PublishedCurrent { get; }
        public AccountLeaderboard Leaderboard { get; }
        internal AccountApiService Service;
        internal AccountHubFlow.ApiOwner Owner;
        internal long BoardGeneration;
        internal AccountApiResult(AccountApiFailure failure, bool published = false, AccountLeaderboard leaderboard = null)
        { Failure = failure; PublishedCurrent = published; Leaderboard = leaderboard; }
    }

    /// <summary>Off-tick account reads/mutations. No speculative money, item grants, bank receipts or automatic retries.</summary>
    public sealed class AccountApiService
    {
        readonly AccountHubFlow _flow;
        readonly IAccountApiTransport _transport;
        readonly Dictionary<Guid, AccountMutation> _operations = new Dictionary<Guid, AccountMutation>();
        readonly Dictionary<string, SemaphoreSlim> _gates = new Dictionary<string, SemaphoreSlim>();
        long _boardGeneration;
        internal AccountApiService(AccountHubFlow flow, IAccountApiTransport transport)
        { _flow = flow; _transport = transport ?? throw new ArgumentNullException(nameof(transport)); }

        public IReadOnlyList<AccountMutationInfo> PendingOperations
        {
            get
            {
                var result = new List<AccountMutationInfo>();
                foreach (var operation in _operations.Values)
                    if (operation.State == AccountMutationState.Ready || operation.State == AccountMutationState.InFlight || operation.State == AccountMutationState.Unknown)
                        result.Add(new AccountMutationInfo(operation));
                return result.AsReadOnly();
            }
        }

        /// <summary>Reuse the ordinary claim/open path, including confirmed-token recovery. Never perform an independent claim GET.</summary>
        public async Task<AccountApiResult> ReadProfileAsync(CancellationToken cancellation = default)
        {
            var read = await _flow.OpenApiProfileAsync(cancellation);
            if (cancellation.IsCancellationRequested) return new AccountApiResult(AccountApiFailure.Cancelled);
            if (!read.Current) return new AccountApiResult(AccountApiFailure.Stale);
            OwnedAccount opened = read.Account;
            if (opened == null) return new AccountApiResult(read.Failure == AccountFailure.InvalidName ? AccountApiFailure.BadRequest :
                read.Failure == AccountFailure.Taken ? AccountApiFailure.Forbidden : read.Failure == AccountFailure.PasscodeRequired ? AccountApiFailure.PasscodeRequired :
                read.Failure == AccountFailure.RateLimited ? AccountApiFailure.RateLimited : read.Failure == AccountFailure.Unreadable ? AccountApiFailure.Unreadable :
                read.Failure == AccountFailure.Cancelled ? AccountApiFailure.Cancelled : AccountApiFailure.Unavailable);
            var owner = _flow.CaptureApiOwner();
            if (owner == null || !ReferenceEquals(owner.Account, opened)) return new AccountApiResult(AccountApiFailure.Stale);
            return Bound(new AccountApiResult(opened.FullProfile == null ? AccountApiFailure.Unreadable : AccountApiFailure.None,
                opened.FullProfile != null), owner);
        }

        AccountApiResult Bound(AccountApiResult result, AccountHubFlow.ApiOwner owner = null, long board = 0)
        { result.Service = this; result.Owner = owner; result.BoardGeneration = board; return result; }
        /// <summary>Check immediately before applying a returned owner/month-specific view; stale results are never current.</summary>
        public bool IsCurrent(AccountApiResult result) => result != null && ReferenceEquals(result.Service, this) &&
            (result.Owner == null || _flow.CurrentApiOwner(result.Owner)) && (result.BoardGeneration == 0 || result.BoardGeneration == _boardGeneration);

        public AccountMutation CreatePurchase(string itemId) => Create(AccountMutationKind.Purchase, itemId, null);
        public AccountMutation CreateEquip(string slot, string itemId) => Create(AccountMutationKind.Equip, itemId, slot);
        AccountMutation Create(AccountMutationKind kind, string item, string slot)
        {
            var owner = _flow.CaptureApiOwner();
            if (owner == null) throw new InvalidOperationException("Confirmed current ownership is required.");
            if (kind == AccountMutationKind.Purchase && item == null || kind == AccountMutationKind.Equip && slot == null) throw new ArgumentException("A mutation payload is required.");
            var operation = new AccountMutation(_flow.ApiEndpoint.StorageScope, owner.Account, kind, item, slot);
            _operations.Add(operation.Id, operation); return operation;
        }

        bool Owns(AccountMutation operation, AccountHubFlow.ApiOwner owner) => owner != null &&
            operation.Scope == _flow.ApiEndpoint.StorageScope && AccountEndpoint.NormalizeName(operation.Name) == owner.ExpectedSelection &&
            string.Equals(operation.Token, owner.Account.Token, StringComparison.Ordinal);

        public async Task<AccountApiResult> SendAsync(AccountMutation operation, CancellationToken cancellation = default)
        {
            if (operation == null || !_operations.TryGetValue(operation.Id, out var registered) || !ReferenceEquals(operation, registered))
                return new AccountApiResult(AccountApiFailure.BadRequest);
            var owner = _flow.CaptureApiOwner();
            if (!Owns(operation, owner)) return new AccountApiResult(AccountApiFailure.NoOwner);
            string key = operation.Scope + "\0" + owner.ExpectedSelection;
            if (!_gates.TryGetValue(key, out var gate)) _gates.Add(key, gate = new SemaphoreSlim(1, 1));
            try { await gate.WaitAsync(cancellation); } catch (OperationCanceledException) { return new AccountApiResult(AccountApiFailure.Cancelled); }
            try
            {
                if (!_flow.CurrentApiOwner(owner)) return new AccountApiResult(AccountApiFailure.Stale);
                if (cancellation.IsCancellationRequested) return new AccountApiResult(AccountApiFailure.Cancelled);
                string suffix = operation.Kind == AccountMutationKind.Purchase ? "/purchase" : "/equip";
                var request = new AccountApiRequest(_flow.ApiEndpoint, _flow.ApiEndpoint.ProfileUrl(owner.Account.CanonicalName) + suffix,
                    "POST", owner.Account.Token, operation.ItemId, operation.Slot, operation.Kind == AccountMutationKind.Purchase ? operation.Id : (Guid?)null);
                if (!request.HasAllowedTarget()) return new AccountApiResult(AccountApiFailure.BadRequest);
                operation.State = AccountMutationState.InFlight; operation.Error = null;
                AccountApiResponse response;
                // Once sent, preserve the actual acknowledgement/unknown outcome even if the caller changes selection or cancels.
                try { response = await _transport.SendAsync(request, CancellationToken.None); }
                catch { response = new AccountApiResponse(0); }
                if (response == null) response = new AccountApiResponse(0);
                if (response.Status == 200 && response.Profile != null && AccountEndpoint.NormalizeName(response.Profile.Name) == owner.ExpectedSelection)
                {
                    operation.State = AccountMutationState.Confirmed;
                    bool published = !cancellation.IsCancellationRequested && _flow.PublishApiProfile(owner, response.Profile);
                    return Bound(new AccountApiResult(published ? AccountApiFailure.None : AccountApiFailure.Stale, published), owner);
                }
                AccountApiFailure failure = response.Status == 200 ? AccountApiFailure.Unreadable : response.Error?.Failure ?? AccountApiFailure.Unavailable;
                operation.State = response.Status >= 400 && response.Status < 500 && response.Status != 408 && response.Status != 429
                    ? AccountMutationState.Refused : AccountMutationState.Unknown;
                operation.Error = response.Error ?? new AccountApiError(failure);
                return Bound(new AccountApiResult(!_flow.CurrentApiOwner(owner) ? AccountApiFailure.Stale :
                    cancellation.IsCancellationRequested ? AccountApiFailure.Cancelled : failure), owner);
            }
            finally { gate.Release(); }
        }

        public async Task<AccountApiResult> ReadLeaderboardAsync(string month = null, int limit = 20, bool includeOwner = false, CancellationToken cancellation = default)
        {
            long board = ++_boardGeneration;
            if (limit < 1 || limit > 100 || month != null && !ValidMonth(month)) return new AccountApiResult(AccountApiFailure.BadRequest);
            var owner = includeOwner ? _flow.CaptureApiOwner() : null;
            if (includeOwner && owner == null) return new AccountApiResult(AccountApiFailure.NoOwner);
            string query = "limit=" + limit.ToString(System.Globalization.CultureInfo.InvariantCulture);
            if (month != null) query += "&month=" + Uri.EscapeDataString(month);
            if (includeOwner) query += "&name=" + Uri.EscapeDataString(owner.Account.CanonicalName);
            var request = new AccountApiRequest(_flow.ApiEndpoint, new Uri(_flow.ApiEndpoint.ApiBase, "leaderboard?" + query).AbsoluteUri, "GET", owner?.Account.Token);
            if (!request.HasAllowedTarget() || includeOwner && !_flow.CurrentApiOwner(owner)) return new AccountApiResult(AccountApiFailure.Stale);
            AccountApiResponse response;
            try { response = await _transport.SendAsync(request, cancellation); }
            catch (OperationCanceledException) { return new AccountApiResult(AccountApiFailure.Cancelled); }
            catch { return new AccountApiResult(AccountApiFailure.Unavailable); }
            if (board != _boardGeneration || includeOwner && !_flow.CurrentApiOwner(owner) || cancellation.IsCancellationRequested) return new AccountApiResult(AccountApiFailure.Stale);
            if (response?.Status != 200) return new AccountApiResult(response?.Error?.Failure ?? AccountApiFailure.Unavailable);
            if (response.Leaderboard == null || !includeOwner && response.Leaderboard.You != null ||
                month != null && response.Leaderboard.Month != month || response.Leaderboard.Entries.Count > limit)
                return new AccountApiResult(AccountApiFailure.Unreadable);
            return Bound(new AccountApiResult(AccountApiFailure.None, leaderboard: response.Leaderboard), owner, board);
        }
        static bool ValidMonth(string month)
        {
            if (month.Length != 7 || month[4] != '-') return false;
            for (int i = 0; i < 7; i++) if (i != 4 && (month[i] < '0' || month[i] > '9')) return false;
            int m = (month[5] - '0') * 10 + month[6] - '0'; return m >= 1 && m <= 12;
        }
    }
}

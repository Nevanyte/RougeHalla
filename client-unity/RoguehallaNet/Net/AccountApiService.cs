using System;
using System.Collections.Generic;
using System.Threading;
using System.Threading.Tasks;

namespace Roguehalla.Net
{
    public enum AccountApiFailure { None, NoOwner, Stale, Cancelled, BadRequest, Forbidden, PasscodeRequired, UnknownCosmetic, UnknownSlot, NotForSale, AlreadyOwned, InsufficientGv, NotOwned, SlotMismatch, RateLimited, Unavailable, Unreadable }
    public enum AccountApiReadKind { Leaderboard, Settlement }
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
        public AccountApiReadKind ReadKind { get; }
        public string MatchId { get; }
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
        internal AccountApiRequest(AccountEndpoint endpoint, string url, string method, string token, string item = null, string slot = null,
            Guid? purchaseId = null, AccountApiReadKind readKind = AccountApiReadKind.Leaderboard, string matchId = null)
        { Endpoint = endpoint; Url = url; Method = method; OwnerToken = token; ItemId = item; Slot = slot; PurchaseId = purchaseId; ReadKind = readKind; MatchId = matchId; }
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
        public AccountSettlement Settlement { get; }
        public AccountApiResponse(int status, AccountFullProfile profile = null, AccountLeaderboard leaderboard = null,
            AccountApiError error = null, AccountSettlement settlement = null)
        { Status = status; Profile = profile; Leaderboard = leaderboard; Error = error; Settlement = settlement; }
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

    /// <summary>Opaque access to receipts for one successfully accepted owned join intent.</summary>
    public sealed class AccountSettlementAccess
    {
        internal AccountApiService Service { get; }
        internal AccountHubFlow.ApiOwner Owner { get; }
        internal AccountSettlementAccess(AccountApiService service, AccountHubFlow.ApiOwner owner)
        { Service = service; Owner = owner; }
    }

    public sealed class AccountApiResult
    {
        public AccountApiFailure Failure { get; }
        public bool PublishedCurrent { get; }
        public AccountLeaderboard Leaderboard { get; }
        public AccountSettlement Settlement { get; }
        internal AccountApiService Service;
        internal AccountHubFlow.ApiOwner Owner;
        internal AccountSettlementAccess SettlementAccess;
        internal long BoardGeneration;
        internal long? OwnerGeneration;
        internal bool RequiresNoOwner;
        internal AccountApiResult(AccountApiFailure failure, bool published = false, AccountLeaderboard leaderboard = null, AccountSettlement settlement = null)
        { Failure = failure; PublishedCurrent = published; Leaderboard = leaderboard; Settlement = settlement; }
    }

    /// <summary>Off-tick account reads/mutations. No speculative money, item grants, settlement claims or automatic retries.</summary>
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

        AccountApiResult Bound(AccountApiResult result, AccountHubFlow.ApiOwner owner = null, long board = 0, long? ownerGeneration = null, bool requiresNoOwner = false)
        { result.Service = this; result.Owner = owner; result.BoardGeneration = board; result.OwnerGeneration = ownerGeneration; result.RequiresNoOwner = requiresNoOwner; return result; }
        /// <summary>Check immediately before applying a returned owner/month-specific view; stale results are never current.</summary>
        public bool IsCurrent(AccountApiResult result) => result != null && ReferenceEquals(result.Service, this) &&
            (result.SettlementAccess == null || IsCurrent(result.SettlementAccess)) &&
            (result.Owner == null || _flow.CurrentApiOwner(result.Owner)) && (result.BoardGeneration == 0 || result.BoardGeneration == _boardGeneration) &&
            (!result.OwnerGeneration.HasValue || result.OwnerGeneration.Value == _flow.ApiGeneration) && (!result.RequiresNoOwner || _flow.CaptureApiOwner() == null);

        /// <summary>Captures access only for a current owned intent. The handle exposes no name, token or API request.</summary>
        public AccountSettlementAccess CaptureSettlementAccess(AccountJoinIntent intent)
        {
            if (intent == null || !_flow.CanJoin(intent)) return null;
            var owner = _flow.CaptureApiOwner();
            return owner != null && ReferenceEquals(owner.Account, intent.Account)
                ? new AccountSettlementAccess(this, owner) : null;
        }

        /// <summary>Read only the authenticated owner's committed receipt for these exact Welcome network bytes.</summary>
        public Task<AccountApiResult> ReadSettlementAsync(AccountSettlementAccess access, byte[] networkMatchId,
            CancellationToken cancellation = default)
        {
            if (!AccountSettlementId.TryFormatNetworkBytes(networkMatchId, out var canonical))
            {
                if (access != null && !IsCurrent(access)) return Task.FromResult(BoundSettlement(AccountApiFailure.Stale, access));
                return Task.FromResult(access == null ? BoundNoOwner(AccountApiFailure.BadRequest) : BoundSettlement(AccountApiFailure.BadRequest, access));
            }
            return ReadSettlementAsync(access, canonical, cancellation);
        }

        /// <summary>Read only the authenticated owner's committed receipt for a canonical lowercase UUID.</summary>
        public async Task<AccountApiResult> ReadSettlementAsync(AccountSettlementAccess access, string canonicalMatchId,
            CancellationToken cancellation = default)
        {
            if (access == null) return BoundNoOwner(AccountApiFailure.NoOwner);
            if (!IsCurrent(access)) return BoundSettlement(AccountApiFailure.Stale, access);
            if (!AccountSettlementId.IsCanonicalLower(canonicalMatchId)) return BoundSettlement(AccountApiFailure.BadRequest, access);
            if (cancellation.IsCancellationRequested) return BoundSettlement(AccountApiFailure.Cancelled, access);

            string url = _flow.ApiEndpoint.ProfileUrl(access.Owner.Account.CanonicalName) + "/matches/" + canonicalMatchId + "/settlement";
            var request = new AccountApiRequest(_flow.ApiEndpoint, url, "GET", access.Owner.Account.Token,
                readKind: AccountApiReadKind.Settlement, matchId: canonicalMatchId);
            if (!request.HasAllowedTarget()) return BoundSettlement(AccountApiFailure.BadRequest, access);

            AccountApiResponse response;
            AccountApiFailure transportFailure = AccountApiFailure.None;
            try { response = await _transport.SendAsync(request, cancellation); }
            catch (OperationCanceledException) { response = null; transportFailure = AccountApiFailure.Cancelled; }
            catch { response = null; transportFailure = AccountApiFailure.Unavailable; }
            if (!IsCurrent(access)) return BoundSettlement(AccountApiFailure.Stale, access);
            if (cancellation.IsCancellationRequested) return BoundSettlement(AccountApiFailure.Cancelled, access);
            if (transportFailure != AccountApiFailure.None) return BoundSettlement(transportFailure, access);
            if (response?.Status != 200) return BoundSettlement(response?.Error?.Failure ?? AccountApiFailure.Unavailable, access);
            if (response.Settlement == null || !string.Equals(response.Settlement.MatchId, canonicalMatchId, StringComparison.Ordinal))
                return BoundSettlement(AccountApiFailure.Unreadable, access);
            return BoundSettlement(AccountApiFailure.None, access, response.Settlement);
        }

        public bool IsCurrent(AccountSettlementAccess access) => access != null && ReferenceEquals(access.Service, this) &&
            _flow.CurrentApiOwner(access.Owner);

        AccountApiResult BoundSettlement(AccountApiFailure failure, AccountSettlementAccess access, AccountSettlement settlement = null)
        {
            var result = new AccountApiResult(failure, settlement: settlement) { Service = this, SettlementAccess = access };
            if (access != null) result.Owner = access.Owner;
            else { result.OwnerGeneration = _flow.ApiGeneration; result.RequiresNoOwner = true; }
            return result;
        }

        AccountApiResult BoundNoOwner(AccountApiFailure failure) =>
            new AccountApiResult(failure) { Service = this, OwnerGeneration = _flow.ApiGeneration, RequiresNoOwner = true };

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

        /// <summary>Read-only ownership of this service's registered operation. Does not send, retry or resolve an unknown outcome.</summary>
        public bool IsCurrentOwner(AccountMutation operation) => operation != null &&
            _operations.TryGetValue(operation.Id, out var registered) && ReferenceEquals(operation, registered) &&
            Owns(operation, _flow.CaptureApiOwner());

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
            long? ownerGeneration = includeOwner ? _flow.ApiGeneration : (long?)null;
            var owner = includeOwner ? _flow.CaptureApiOwner() : null;
            AccountApiResult CurrentResult(AccountApiFailure failure, AccountLeaderboard leaderboard = null) =>
                Bound(new AccountApiResult(failure, leaderboard: leaderboard), owner, board, ownerGeneration, includeOwner && owner == null);
            bool CurrentQuery() => board == _boardGeneration && (owner == null || _flow.CurrentApiOwner(owner)) &&
                (!ownerGeneration.HasValue || ownerGeneration.Value == _flow.ApiGeneration);
            if (limit < 1 || limit > 100 || month != null && !ValidMonth(month)) return CurrentResult(AccountApiFailure.BadRequest);
            if (includeOwner && owner == null) return CurrentResult(AccountApiFailure.NoOwner);
            string query = "limit=" + limit.ToString(System.Globalization.CultureInfo.InvariantCulture);
            if (month != null) query += "&month=" + Uri.EscapeDataString(month);
            if (includeOwner) query += "&name=" + Uri.EscapeDataString(owner.Account.CanonicalName);
            var request = new AccountApiRequest(_flow.ApiEndpoint, new Uri(_flow.ApiEndpoint.ApiBase, "leaderboard?" + query).AbsoluteUri, "GET", owner?.Account.Token);
            if (!request.HasAllowedTarget() || includeOwner && !_flow.CurrentApiOwner(owner)) return new AccountApiResult(AccountApiFailure.Stale);
            AccountApiResponse response;
            AccountApiFailure transportFailure = AccountApiFailure.None;
            try { response = await _transport.SendAsync(request, cancellation); }
            catch (OperationCanceledException) { response = null; transportFailure = AccountApiFailure.Cancelled; }
            catch { response = null; transportFailure = AccountApiFailure.Unavailable; }
            // Errors are views too: retain the same owner/query binding as success, after rejecting stale completions.
            if (!CurrentQuery()) return new AccountApiResult(AccountApiFailure.Stale);
            if (cancellation.IsCancellationRequested) return CurrentResult(AccountApiFailure.Cancelled);
            if (transportFailure != AccountApiFailure.None) return CurrentResult(transportFailure);
            if (response?.Status != 200) return CurrentResult(response?.Error?.Failure ?? AccountApiFailure.Unavailable);
            if (response.Leaderboard == null || !includeOwner && response.Leaderboard.You != null ||
                month != null && response.Leaderboard.Month != month || response.Leaderboard.Entries.Count > limit)
                return CurrentResult(AccountApiFailure.Unreadable);
            return CurrentResult(AccountApiFailure.None, response.Leaderboard);
        }
        static bool ValidMonth(string month)
        {
            if (month.Length != 7 || month[4] != '-') return false;
            for (int i = 0; i < 7; i++) if (i != 4 && (month[i] < '0' || month[i] > '9')) return false;
            int m = (month[5] - '0') * 10 + month[6] - '0'; return m >= 1 && m <= 12;
        }
    }
}

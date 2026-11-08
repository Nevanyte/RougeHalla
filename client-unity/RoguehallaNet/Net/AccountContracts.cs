using System;
using System.Threading;
using System.Threading.Tasks;

namespace Roguehalla.Net
{
    /// <summary>The account summary needed by the hub. Cosmetic/progress maps are not represented by this slice.</summary>
    [Serializable]
    public sealed class AccountProfile
    {
        public string name;
        public long gv = -1, gvLifetime = -1;
        public AccountStats stats;
    }

    [Serializable]
    public sealed class AccountStats
    {
        public long runs = -1, wins = -1, draws = -1, deaths = -1, kills = -1;
    }

    [Serializable]
    public sealed class AccountReply
    {
        public AccountProfile profile;
        public string token;
        public bool created;
    }

    public sealed class AccountHttpResponse
    {
        public int Status { get; }
        public AccountReply Reply { get; }
        public AccountHttpResponse(int status, AccountReply reply = null) { Status = status; Reply = reply; }
    }

    public interface IAccountTransport
    {
        /// <summary>GET only. Credentials belong in x-profile-token / x-playtest-passcode headers, never URL/logs.</summary>
        Task<AccountHttpResponse> GetProfileAsync(string url, string ownerToken, string passcode, CancellationToken cancellation);
    }

    public interface IAccountCredentialStore
    {
        string Read(string endpointScope, string normalizedName);
        /// <summary>Persist only a token proven by an owned successful response; return false when storage is unavailable.</summary>
        bool WriteConfirmed(string endpointScope, string normalizedName, string token);
    }

    public enum AccountState { Idle, Opening, Owned, Failed }
    public enum AccountFailure { None, InvalidName, Taken, PasscodeRequired, RateLimited, Unavailable, Unreadable, Cancelled }

    /// <summary>Ownership data is explicit: consumers must not stringify/log this token or place it in navigation URLs.</summary>
    public sealed class OwnedAccount
    {
        public AccountProfile Profile { get; }
        public string CanonicalName { get; }
        public bool HasFullProfile => false;
        public string Token { get; }
        public bool Created { get; }
        public bool CredentialSaved { get; }
        internal OwnedAccount(AccountReply reply, bool saved)
        { Profile = reply.profile; CanonicalName = reply.profile.name; Token = reply.token; Created = reply.created; CredentialSaved = saved; }
    }

    public sealed class AccountOpenResult
    {
        public OwnedAccount Account { get; }
        public AccountFailure Failure { get; }
        internal AccountOpenResult(OwnedAccount account, AccountFailure failure) { Account = account; Failure = failure; }
    }
}

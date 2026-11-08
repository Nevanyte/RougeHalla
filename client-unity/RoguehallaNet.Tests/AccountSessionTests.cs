using System;
using System.Collections.Generic;
using System.Threading;
using System.Threading.Tasks;
using NUnit.Framework;

namespace Roguehalla.Net.Tests
{
    public sealed class AccountSessionTests
    {
        sealed class Request
        {
            public string Url, Token, Passcode;
            public CancellationToken Cancellation;
            public TaskCompletionSource<AccountHttpResponse> Completion = new TaskCompletionSource<AccountHttpResponse>();
        }
        sealed class Transport : IAccountTransport
        {
            public List<Request> Requests = new List<Request>();
            public Task<AccountHttpResponse> GetProfileAsync(string url, string token, string passcode, CancellationToken cancellation)
            {
                var request = new Request { Url = url, Token = token, Passcode = passcode, Cancellation = cancellation };
                Requests.Add(request); return request.Completion.Task;
            }
        }
        sealed class Credentials : IAccountCredentialStore
        {
            public readonly Dictionary<string, string> Tokens = new Dictionary<string, string>();
            public int Writes;
            public bool Throw;
            static string Key(string scope, string name) => scope + "|" + name;
            public string Read(string scope, string name)
            { if (Throw) throw new InvalidOperationException(); return Tokens.TryGetValue(Key(scope, name), out var token) ? token : null; }
            public bool WriteConfirmed(string scope, string name, string token)
            { if (Throw) throw new InvalidOperationException(); Tokens[Key(scope, name)] = token; ++Writes; return true; }
        }
        static AccountEndpoint Endpoint() => AccountEndpoint.FromPage("https://game.example/play/index.html?token=not-forwarded#key=not-forwarded");
        static AccountReply Reply(string name = "Alice", string token = null, bool created = true) => new AccountReply
        {
            token = token ?? new string('a', 64), created = created,
            profile = new AccountProfile { name = name, gv = 0, gvLifetime = 0,
                stats = new AccountStats { runs = 0, wins = 0, draws = 0, deaths = 0, kills = 0 } },
        };

        [Test]
        public void EndpointUsesPageOriginAndPreservesExplicitApiPrefixWithoutCredentialUrls()
        {
            var endpoint = Endpoint();
            Assert.AreEqual("https://game.example/api/profile/ALIce", endpoint.ProfileUrl("ALIce"));
            var a = AccountEndpoint.FromPage("https://game.example/", "https://API.EXAMPLE:443/one/api");
            var b = AccountEndpoint.FromPage("https://game.example/", "https://api.example/two/api/");
            Assert.AreEqual("https://api.example/one/api/", a.StorageScope);
            Assert.AreNotEqual(a.StorageScope, b.StorageScope);
            Assert.AreEqual("https://api.example/one/api/profile/Alice", a.ProfileUrl("Alice"));
            Assert.AreEqual("http://127.0.0.1:7777/api/", AccountEndpoint.FromPage(null, "http://127.0.0.1:7777/api").StorageScope);
        }

        [TestCase("wss://game.example/ws")]
        [TestCase("https://owner:secret@game.example/api")]
        [TestCase("https://game.example/api?token=private")]
        [TestCase("https://game.example/api#key=private")]
        [TestCase("https://game.example/control")]
        [TestCase("http://game.example/api")]
        public void UnsafeOrMixedContentOverrideIsRefused(string endpoint)
        { Assert.Throws<ArgumentException>(() => AccountEndpoint.FromPage("https://game.example/", endpoint)); }

        [TestCase(" alice")]
        [TestCase("alice ")]
        [TestCase("éé")]
        [TestCase("İd")]
        [TestCase("a/b")]
        [TestCase("a")]
        [TestCase("abcdefghijklmnopq")]
        public void NameValidationMatchesRustAsciiWithoutImplicitTrim(string name)
        { Assert.Throws<ArgumentException>(() => AccountEndpoint.NormalizeName(name)); }

        [Test]
        public async Task FirstClaimOnlyPersistsAfterMatchingConfirmedResponseAndCanJoinThen()
        {
            var transport = new Transport(); var store = new Credentials(); var endpoint = Endpoint();
            var session = new AccountSession(endpoint, transport, store);
            var open = session.OpenAsync("ALIce", passcode: "local-passcode");
            Assert.AreEqual(AccountState.Opening, session.State); Assert.AreEqual(0, store.Writes);
            Assert.IsFalse(session.CanJoin(null)); Assert.IsNull(transport.Requests[0].Token);
            Assert.AreEqual("https://game.example/api/profile/ALIce", transport.Requests[0].Url);
            Assert.IsTrue(transport.Requests[0].Passcode == "local-passcode");
            transport.Requests[0].Completion.SetResult(new AccountHttpResponse(200, Reply("ALIce")));
            var result = await open;
            Assert.AreEqual(AccountFailure.None, result.Failure); Assert.AreEqual(1, store.Writes);
            Assert.AreEqual("ALIce", result.Account.CanonicalName); Assert.IsTrue(result.Account.CredentialSaved);
            Assert.IsFalse(result.Account.HasFullProfile); Assert.IsTrue(session.CanJoin(result.Account));
            session.ClearSelection(); Assert.IsFalse(session.CanJoin(result.Account));
            Assert.IsTrue(store.Read(endpoint.StorageScope, "alice") == result.Account.Token);
        }

        [Test]
        public async Task SameNameClaimsAreSerializedAndSecondRequestUsesFirstConfirmedToken()
        {
            var transport = new Transport(); var store = new Credentials(); var session = new AccountSession(Endpoint(), transport, store);
            var first = session.OpenAsync("Alice"); var second = session.OpenAsync("aLICE");
            Assert.AreEqual(1, transport.Requests.Count);
            transport.Requests[0].Completion.SetResult(new AccountHttpResponse(200, Reply()));
            Assert.AreEqual(AccountFailure.Cancelled, (await first).Failure);
            await Until(() => transport.Requests.Count == 2);
            Assert.IsTrue(transport.Requests[1].Token == new string('a', 64));
            transport.Requests[1].Completion.SetResult(new AccountHttpResponse(200, Reply(created: false)));
            Assert.IsTrue(session.CanJoin((await second).Account));
        }

        [Test]
        public async Task SwitchedSelectionLate200RecoversOriginalCredentialWithoutPublishingOrJoiningIt()
        {
            var transport = new Transport(); var store = new Credentials(); var session = new AccountSession(Endpoint(), transport, store);
            var alice = session.OpenAsync("Alice"); var bob = session.OpenAsync("Bob");
            transport.Requests[1].Completion.SetResult(new AccountHttpResponse(200, Reply("Bob", new string('b', 64))));
            var current = (await bob).Account;
            transport.Requests[0].Completion.SetResult(new AccountHttpResponse(200, Reply()));
            Assert.AreEqual(AccountFailure.Cancelled, (await alice).Failure);
            Assert.IsTrue(session.CanJoin(current)); Assert.AreEqual("Bob", session.Current.CanonicalName);
            Assert.IsTrue(store.Read(Endpoint().StorageScope, "alice") == new string('a', 64));
            Assert.IsTrue(store.Read(Endpoint().StorageScope, "bob") == new string('b', 64));
        }

        [Test]
        public async Task CancellationDetachesSelectionButLateConfirmedClaimIsStillRecovered()
        {
            var transport = new Transport(); var store = new Credentials(); var session = new AccountSession(Endpoint(), transport, store);
            var cancellation = new CancellationTokenSource();
            var open = session.OpenAsync("Alice", cancellation: cancellation.Token);
            cancellation.Cancel();
            Assert.AreEqual(AccountFailure.Cancelled, (await open).Failure); Assert.IsNull(session.Current);
            Assert.IsFalse(transport.Requests[0].Cancellation.CanBeCanceled);
            transport.Requests[0].Completion.SetResult(new AccountHttpResponse(200, Reply()));
            await Until(() => store.Writes == 1);
            Assert.IsNull(session.Current); Assert.AreEqual(AccountState.Idle, session.State);
        }

        [Test]
        public async Task CancellationBeforeStartMakesNoRequestOrCredentialWrite()
        {
            var transport = new Transport(); var store = new Credentials(); var session = new AccountSession(Endpoint(), transport, store);
            var result = await session.OpenAsync("Alice", cancellation: new CancellationToken(true));
            Assert.AreEqual(AccountFailure.Cancelled, result.Failure); Assert.AreEqual(0, transport.Requests.Count); Assert.AreEqual(0, store.Writes);
        }

        [Test]
        public async Task ClearedQueuedSelectionNeverStartsAnotherClaimAfterFirstFinishes()
        {
            var transport = new Transport(); var store = new Credentials(); var session = new AccountSession(Endpoint(), transport, store);
            var first = session.OpenAsync("Alice"); var queued = session.OpenAsync("Alice");
            session.ClearSelection();
            transport.Requests[0].Completion.SetResult(new AccountHttpResponse(200, Reply()));
            Assert.AreEqual(AccountFailure.Cancelled, (await first).Failure);
            Assert.AreEqual(AccountFailure.Cancelled, (await queued).Failure);
            Assert.AreEqual(1, transport.Requests.Count); Assert.AreEqual(1, store.Writes); Assert.IsNull(session.Current);
        }

        [Test]
        public async Task TransportFailureAndUnreadable200KeepConfirmedCredentialAndNeverJoin()
        {
            var transport = new Transport(); var store = new Credentials(); var endpoint = Endpoint();
            store.WriteConfirmed(endpoint.StorageScope, "alice", "confirmed-owner");
            var session = new AccountSession(endpoint, transport, store);
            var failed = session.OpenAsync("Alice");
            transport.Requests[0].Completion.SetException(new InvalidOperationException("do not expose raw transport details"));
            Assert.AreEqual(AccountFailure.Unavailable, (await failed).Failure);
            var unreadable = session.OpenAsync("Alice");
            transport.Requests[1].Completion.SetResult(new AccountHttpResponse(200));
            Assert.AreEqual(AccountFailure.Unreadable, (await unreadable).Failure);
            Assert.AreEqual(1, store.Writes); Assert.IsTrue(store.Read(endpoint.StorageScope, "alice") == "confirmed-owner");
            Assert.IsNull(session.Current);
        }

        [TestCase(400, AccountFailure.InvalidName)]
        [TestCase(401, AccountFailure.PasscodeRequired)]
        [TestCase(403, AccountFailure.Taken)]
        [TestCase(429, AccountFailure.RateLimited)]
        [TestCase(503, AccountFailure.Unavailable)]
        public async Task FailedResponsesNeverPersistAndPreservePriorProvenCredential(int status, AccountFailure failure)
        {
            var transport = new Transport(); var store = new Credentials(); var endpoint = Endpoint();
            store.WriteConfirmed(endpoint.StorageScope, "alice", "already-confirmed");
            var session = new AccountSession(endpoint, transport, store);
            var open = session.OpenAsync("Alice", "unproven-link");
            Assert.IsTrue(transport.Requests[0].Token == "already-confirmed");
            transport.Requests[0].Completion.SetResult(new AccountHttpResponse(status, Reply()));
            Assert.AreEqual(failure, (await open).Failure); Assert.AreEqual(1, store.Writes);
            Assert.IsTrue(store.Read(endpoint.StorageScope, "alice") == "already-confirmed"); Assert.IsNull(session.Current);
        }

        [Test]
        public async Task RefusedStoredTokenAllowsSeparatelyValidatedSignInWithoutDiscardingOldKeyOnFailure()
        {
            var transport = new Transport(); var store = new Credentials(); var endpoint = Endpoint();
            store.WriteConfirmed(endpoint.StorageScope, "alice", "old-confirmed");
            var session = new AccountSession(endpoint, transport, store);
            var first = session.OpenAsync("Alice"); transport.Requests[0].Completion.SetResult(new AccountHttpResponse(403)); await first;
            var bad = session.OpenAsync("Alice", "bad-link"); transport.Requests[1].Completion.SetResult(new AccountHttpResponse(403)); await bad;
            Assert.IsTrue(store.Read(endpoint.StorageScope, "alice") == "old-confirmed");
            var good = session.OpenAsync("Alice", "valid-link");
            Assert.IsTrue(transport.Requests[2].Token == "valid-link");
            transport.Requests[2].Completion.SetResult(new AccountHttpResponse(200, Reply(token: "valid-link", created: false)));
            Assert.IsTrue(session.CanJoin((await good).Account));
            Assert.IsTrue(store.Read(endpoint.StorageScope, "alice") == "valid-link");
        }

        [TestCase("wrong-name")]
        [TestCase("missing-stats")]
        [TestCase("missing-gv")]
        [TestCase("bad-token")]
        [TestCase("unproven-open")]
        public async Task MalformedOrUncorrelatedSuccessCannotPersistOrBecomeJoinable(string mutation)
        {
            var transport = new Transport(); var store = new Credentials(); var session = new AccountSession(Endpoint(), transport, store);
            var reply = Reply();
            if (mutation == "wrong-name") reply.profile.name = "Bob";
            if (mutation == "missing-stats") reply.profile.stats = null;
            if (mutation == "missing-gv") reply.profile.gv = -1;
            if (mutation == "bad-token") reply.token = "bad\r\nheader";
            if (mutation == "unproven-open") reply.created = false;
            var open = session.OpenAsync("Alice"); transport.Requests[0].Completion.SetResult(new AccountHttpResponse(200, reply));
            Assert.AreEqual(AccountFailure.Unreadable, (await open).Failure); Assert.AreEqual(0, store.Writes); Assert.IsNull(session.Current);
        }

        [Test]
        public async Task BlockedCredentialStorageKeepsConfirmedSessionButReportsItWasNotSaved()
        {
            var transport = new Transport(); var store = new Credentials { Throw = true }; var session = new AccountSession(Endpoint(), transport, store);
            var open = session.OpenAsync("Alice"); transport.Requests[0].Completion.SetResult(new AccountHttpResponse(200, Reply()));
            var result = await open; Assert.IsTrue(session.CanJoin(result.Account)); Assert.IsFalse(result.Account.CredentialSaved);
        }

        static async Task Until(Func<bool> ready)
        {
            for (int i = 0; i < 1000 && !ready(); i++) await Task.Delay(1);
            Assert.IsTrue(ready(), "bounded asynchronous operation completed");
        }
    }
}

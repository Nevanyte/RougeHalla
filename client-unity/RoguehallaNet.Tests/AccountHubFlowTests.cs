using System;
using System.Collections.Generic;
using System.Threading;
using System.Threading.Tasks;
using NUnit.Framework;

namespace Roguehalla.Net.Tests
{
    public sealed class AccountHubFlowTests
    {
        sealed class Request
        {
            public string Url, Token;
            public TaskCompletionSource<AccountHttpResponse> Reply = new TaskCompletionSource<AccountHttpResponse>();
        }
        sealed class Transport : IAccountTransport
        {
            public readonly List<Request> Requests = new List<Request>();
            public Task<AccountHttpResponse> GetProfileAsync(string url, string ownerToken, string passcode, CancellationToken cancellation)
            { var r = new Request { Url = url, Token = ownerToken }; Requests.Add(r); return r.Reply.Task; }
        }
        sealed class Store : IAccountCredentialStore
        {
            readonly Dictionary<string, string> _tokens = new Dictionary<string, string>();
            public bool Blocked;
            public int Reads, Writes;
            public string Read(string scope, string name) { ++Reads; return Blocked ? null : _tokens.TryGetValue(scope + name, out var t) ? t : null; }
            public bool WriteConfirmed(string scope, string name, string token)
            { ++Writes; if (Blocked) return false; _tokens[scope + name] = token; return true; }
        }
        static AccountEndpoint Endpoint() => AccountEndpoint.FromPage("https://game.example/play?token=ignored");
        static AccountReply Owned(string name = "Alice", bool created = true) => new AccountReply
        {
            profile = new AccountProfile { name = name, gv = 10, gvLifetime = 20,
                stats = new AccountStats { runs = 2, wins = 1, draws = 0, deaths = 1, kills = 1 } },
            token = new string(name == "Bob" ? 'b' : 'a', 64), created = created,
        };
        static AccountHubFlow Flow(Transport transport, Store store = null) => new AccountHubFlow(new AccountSession(Endpoint(), transport, store ?? new Store()));

        [Test]
        public void PageDefaultAndExplicitRemoteApiRequireAnExplicitMatchingMatchTarget()
        {
            Assert.AreEqual("wss://game.example/ws", AccountConnectionPolicy.DefaultMatchUrl("https://game.example/play?token=not-forwarded"));
            Assert.AreEqual("ws://localhost:7777/ws", AccountConnectionPolicy.DefaultMatchUrl("http://localhost:7777/play"));
            var api = AccountEndpoint.FromPage("https://game.example/", "https://remote.example/prefix/api");
            Assert.AreEqual(AccountConnectionFailure.OriginMismatch, AccountConnectionPolicy.CheckOwnedTarget(api, AccountConnectionPolicy.DefaultMatchUrl("https://game.example/")));
            Assert.AreEqual(AccountConnectionFailure.None, AccountConnectionPolicy.CheckOwnedTarget(api, "wss://REMOTE.example:443/prefix/ws"));
            Assert.AreEqual(AccountConnectionFailure.OriginMismatch, AccountConnectionPolicy.CheckOwnedTarget(api, "ws://remote.example:443/ws"));
            Assert.AreEqual(AccountConnectionFailure.OriginMismatch, AccountConnectionPolicy.CheckOwnedTarget(api, "wss://remote.example:444/ws"));
        }

        [TestCase("https://game.example/ws")]
        [TestCase("wss://owner:private@game.example/ws")]
        [TestCase("wss://game.example/ws?token=private")]
        [TestCase("wss://game.example/ws#key=private")]
        [TestCase("wss://game.example/control")]
        public void InvalidMatchTargetsCannotReceiveOwnedCredentials(string target)
        { Assert.AreEqual(AccountConnectionFailure.InvalidMatchUrl, AccountConnectionPolicy.CheckOwnedTarget(Endpoint(), target)); }

        [TestCase("http://localhost/play", "ws://127.0.0.1:7777/ws", true, false, true)]
        [TestCase("http://localhost/play", "ws://127.0.0.1:7777/ws", false, false, false)]
        [TestCase("https://remote.example/play", "ws://localhost/ws", true, false, false)]
        [TestCase("http://localhost/play", "wss://remote.example/ws", true, false, false)]
        [TestCase(null, "ws://localhost/ws", true, true, true)]
        [TestCase(null, "wss://remote.example/ws", true, true, false)]
        [TestCase(null, "ws://localhost/ws", true, false, false)]
        [TestCase("https://remote.example/", "ws://localhost/ws", true, true, false)]
        [TestCase("http://[::1]/play", "ws://[::1]:7777/ws", true, false, true)]
        [TestCase("http://localhost.attacker.invalid/", "ws://localhost/ws", true, false, false)]
        public void DiagnosticsRequireExplicitLocalPageAndLocalWsIncludingInEditor(string page, string ws, bool requested, bool editor, bool allowed)
        { Assert.AreEqual(allowed, AccountConnectionPolicy.AllowsDiagnostic(page, ws, requested, editor)); }

        [Test]
        public async Task OriginMismatchFailsWithTypedStateBeforeAnyAccountOrSocketWork()
        {
            var transport = new Transport(); var flow = Flow(transport);
            Assert.IsNull(await flow.PrepareJoinAsync("Alice", "wss://foreign.example/ws"));
            Assert.AreEqual(0, transport.Requests.Count);
            Assert.AreEqual(AccountHubState.Failed, flow.Snapshot.State);
            Assert.AreEqual(AccountConnectionFailure.OriginMismatch, flow.Snapshot.ConnectionFailure);
            Assert.IsNull(flow.Snapshot.Profile);
        }

        [Test]
        public async Task OnlyConfirmedCurrentGenerationIntentCanJoinAndSummaryIsImmutable()
        {
            var transport = new Transport(); var flow = Flow(transport);
            var preparing = flow.PrepareJoinAsync("Alice", "wss://game.example/ws");
            Assert.IsTrue(flow.Snapshot.Busy); Assert.AreEqual(AccountHubState.PreparingJoin, flow.Snapshot.State);
            var reply = Owned(); transport.Requests[0].Reply.SetResult(new AccountHttpResponse(200, reply));
            var intent = await preparing;
            Assert.IsTrue(flow.CanJoin(intent)); Assert.AreEqual("Alice", intent.Account.CanonicalName);
            Assert.AreEqual(AccountCredentialRecovery.Persistent, flow.Snapshot.Recovery);
            var summary = flow.Snapshot.Profile;
            reply.profile.name = "Mallory"; reply.profile.gv = 999999;
            Assert.AreEqual("Alice", summary.Name); Assert.AreEqual(10, summary.Gv);
            Assert.AreEqual("Alice", intent.Account.CanonicalName); // Join identity is never the mutable DTO's name.
            flow.SelectName("Bob"); Assert.IsFalse(flow.CanJoin(intent)); Assert.IsNull(flow.Snapshot.Profile);
        }

        [Test]
        public async Task TwoJoinClicksSerializeTheClaimAndOnlyNewestIntentCanJoin()
        {
            var transport = new Transport(); var flow = Flow(transport);
            var old = flow.PrepareJoinAsync("Alice", "wss://game.example/ws");
            var latest = flow.PrepareJoinAsync("Alice", "wss://game.example/ws");
            Assert.AreEqual(1, transport.Requests.Count);
            transport.Requests[0].Reply.SetResult(new AccountHttpResponse(200, Owned()));
            Assert.IsNull(await old); await Until(() => transport.Requests.Count == 2);
            Assert.IsTrue(transport.Requests[1].Token == new string('a', 64));
            transport.Requests[1].Reply.SetResult(new AccountHttpResponse(200, Owned(created: false)));
            Assert.IsTrue(flow.CanJoin(await latest));
        }

        [Test]
        public async Task SwitchedSelectionLateClaimCannotPublishOldProfileOrJoin()
        {
            var transport = new Transport(); var flow = Flow(transport);
            var alice = flow.PrepareJoinAsync("Alice", "wss://game.example/ws");
            var bob = flow.OpenProfileAsync("Bob");
            transport.Requests[1].Reply.SetResult(new AccountHttpResponse(200, Owned("Bob")));
            Assert.IsTrue(await bob);
            transport.Requests[0].Reply.SetResult(new AccountHttpResponse(200, Owned()));
            Assert.IsNull(await alice); Assert.AreEqual("Bob", flow.Snapshot.Profile.Name);
            Assert.IsFalse(flow.CanJoin(null));
        }

        [Test]
        public async Task CancelledJoinRetainsLatePageOnlyCredentialAndSupportsAuthenticatedRejoin()
        {
            var transport = new Transport(); var flow = Flow(transport, new Store { Blocked = true });
            var old = flow.PrepareJoinAsync("Alice", "wss://game.example/ws"); flow.Cancel();
            transport.Requests[0].Reply.SetResult(new AccountHttpResponse(200, Owned()));
            Assert.IsNull(await old); Assert.AreEqual(AccountHubState.Idle, flow.Snapshot.State);
            Assert.AreEqual(AccountCredentialRecovery.PageLifetimeOnly, flow.Snapshot.Recovery);
            var rejoin = flow.PrepareJoinAsync("Alice", "wss://game.example/ws");
            await Until(() => transport.Requests.Count == 2);
            Assert.IsTrue(transport.Requests[1].Token == new string('a', 64));
            transport.Requests[1].Reply.SetResult(new AccountHttpResponse(200, Owned(created: false)));
            var intent = await rejoin;
            Assert.IsTrue(flow.CanJoin(intent)); Assert.AreEqual(AccountCredentialRecovery.PageLifetimeOnly, flow.Snapshot.Recovery);
            Assert.IsFalse(intent.Account.CredentialSaved);
        }

        [Test]
        public async Task ResultRefreshUsesSavedCountersAndDoesNotClaimBankCompletionOrKeepOldJoinIntent()
        {
            var transport = new Transport(); var flow = Flow(transport);
            var first = flow.PrepareJoinAsync("Alice", "wss://game.example/ws");
            transport.Requests[0].Reply.SetResult(new AccountHttpResponse(200, Owned())); var old = await first;
            var refresh = flow.RefreshAfterResultAsync();
            Assert.AreEqual(AccountRefreshReason.Result, flow.Snapshot.RefreshReason); Assert.IsFalse(flow.CanJoin(old));
            transport.Requests[1].Reply.SetResult(new AccountHttpResponse(200, Owned(created: false)));
            Assert.IsTrue(await refresh); Assert.AreEqual(2, flow.Snapshot.Profile.Runs);
            Assert.IsFalse(flow.Snapshot.ResultBankConfirmed); Assert.IsFalse(flow.CanJoin(old));
            var again = flow.PrepareJoinAsync("Alice", "wss://game.example/ws");
            transport.Requests[2].Reply.SetResult(new AccountHttpResponse(200, Owned(created: false)));
            Assert.IsTrue(flow.CanJoin(await again));
        }

        [Test]
        public async Task DetachedCallerCancellationCanRefreshOnlyRecoveryMetadataAfterLateConfirmation()
        {
            var transport = new Transport(); var accounts = new AccountSession(Endpoint(), transport, new Store { Blocked = true });
            var flow = new AccountHubFlow(accounts); var cancellation = new CancellationTokenSource();
            var pending = flow.PrepareJoinAsync("Alice", "wss://game.example/ws", cancellation: cancellation.Token);
            cancellation.Cancel(); Assert.IsNull(await pending);
            transport.Requests[0].Reply.SetResult(new AccountHttpResponse(200, Owned()));
            await Until(() => accounts.CredentialRecoveryFor("alice") == AccountCredentialRecovery.PageLifetimeOnly);
            flow.RefreshRecovery();
            Assert.AreEqual(AccountCredentialRecovery.PageLifetimeOnly, flow.Snapshot.Recovery);
            Assert.AreEqual(AccountHubState.Idle, flow.Snapshot.State); Assert.IsNull(flow.Snapshot.Profile);
            Assert.IsFalse(flow.CanJoin(null));
        }

        [Test]
        public async Task AnotherFlowCannotAcceptAnOtherwiseValidJoinIntent()
        {
            var transport = new Transport(); var accounts = new AccountSession(Endpoint(), transport, new Store());
            var owner = new AccountHubFlow(accounts); var other = new AccountHubFlow(accounts);
            var preparing = owner.PrepareJoinAsync("Alice", "wss://game.example/ws");
            transport.Requests[0].Reply.SetResult(new AccountHttpResponse(200, Owned()));
            var intent = await preparing;
            Assert.IsTrue(owner.CanJoin(intent)); Assert.IsFalse(other.CanJoin(intent));
        }

        [Test]
        public async Task ReentrantIdleSelectionSwitchNeverClaimsAliceOrProducesHerIntentWhileBobIsSelected()
        {
            var transport = new Transport(); var flow = Flow(transport);
            flow.Changed += snapshot =>
            {
                if (snapshot.State == AccountHubState.Idle && snapshot.SelectedName == "Alice") flow.SelectName("Bob");
            };
            var preparing = flow.PrepareJoinAsync("Alice", "wss://game.example/ws");
            // Complete any erroneous request so the old implementation produces the reported wrong, joinable intent.
            foreach (var request in transport.Requests) request.Reply.TrySetResult(new AccountHttpResponse(200, Owned()));
            var intent = await preparing;
            Assert.AreEqual("Bob", flow.Snapshot.SelectedName);
            Assert.AreEqual(0, transport.Requests.Count, "selection changed before HTTP: Alice must not be claimed");
            Assert.IsNull(intent); Assert.IsFalse(flow.CanJoin(intent)); Assert.IsNull(flow.Snapshot.Profile);
        }

        [TestCase(false)]
        [TestCase(true)]
        public async Task ReentrantCancellationDuringOpeningOrPreparingStateStartsNoHttp(bool join)
        {
            var transport = new Transport(); var flow = Flow(transport);
            flow.Changed += snapshot =>
            {
                if (snapshot.State == AccountHubState.Opening || snapshot.State == AccountHubState.PreparingJoin) flow.Cancel();
            };
            Task<AccountJoinIntent> preparing = join ? flow.PrepareJoinAsync("Alice", "wss://game.example/ws") : null;
            Task<bool> opening = join ? null : flow.OpenProfileAsync("Alice");
            foreach (var request in transport.Requests) request.Reply.TrySetResult(new AccountHttpResponse(200, Owned()));
            if (join) Assert.IsNull(await preparing); else Assert.IsFalse(await opening);
            Assert.AreEqual(0, transport.Requests.Count, "the opening callback cancelled before a claim could start");
            Assert.AreEqual(AccountHubState.Idle, flow.Snapshot.State); Assert.IsNull(flow.Snapshot.Profile);
        }

        [TestCase(false)]
        [TestCase(true)]
        public async Task ReentrantNewOpenDuringAliceSelectionOwnsOnlyBobsRequestAndPublication(bool openingCallback)
        {
            var transport = new Transport(); var flow = Flow(transport); Task<bool> bob = null;
            flow.Changed += snapshot =>
            {
                if (snapshot.State == (openingCallback ? AccountHubState.PreparingJoin : AccountHubState.Idle) && snapshot.SelectedName == "Alice" && bob == null)
                    bob = flow.OpenProfileAsync("Bob");
            };
            var preparing = flow.PrepareJoinAsync("Alice", "wss://game.example/ws");
            foreach (var request in transport.Requests)
                request.Reply.TrySetResult(new AccountHttpResponse(200, Owned(request.Url.EndsWith("/Bob") ? "Bob" : "Alice")));
            Assert.IsNull(await preparing); Assert.IsTrue(await bob);
            Assert.AreEqual(1, transport.Requests.Count); Assert.IsTrue(transport.Requests[0].Url.EndsWith("/Bob"));
            Assert.AreEqual("Bob", flow.Snapshot.SelectedName); Assert.AreEqual("Bob", flow.Snapshot.Profile.Name);
        }

        [Test]
        public async Task ReentrantNewOpenKeepsAnAlreadyStartedLateClaimRecoverableWithoutOldJoinPublication()
        {
            var transport = new Transport(); var flow = Flow(transport, new Store { Blocked = true });
            var alice = flow.PrepareJoinAsync("Alice", "wss://game.example/ws");
            Task<bool> bob = null;
            flow.Changed += snapshot =>
            {
                if (snapshot.State == AccountHubState.Idle && snapshot.SelectedName == "Bob" && bob == null)
                    bob = flow.OpenProfileAsync("Bob");
            };
            flow.SelectName("Bob");
            transport.Requests[1].Reply.SetResult(new AccountHttpResponse(200, Owned("Bob")));
            Assert.IsTrue(await bob);
            transport.Requests[0].Reply.SetResult(new AccountHttpResponse(200, Owned()));
            Assert.IsNull(await alice); Assert.AreEqual("Bob", flow.Snapshot.Profile.Name);
            var revisit = flow.PrepareJoinAsync("Alice", "wss://game.example/ws");
            await Until(() => transport.Requests.Count == 3);
            Assert.IsTrue(transport.Requests[2].Token == new string('a', 64));
            transport.Requests[2].Reply.SetResult(new AccountHttpResponse(200, Owned(created: false)));
            Assert.IsTrue(flow.CanJoin(await revisit)); Assert.AreEqual(AccountCredentialRecovery.PageLifetimeOnly, flow.Snapshot.Recovery);
        }

        [Test]
        public async Task ReentrantOwnedCallbackSwitchInvalidatesIntentButPreservesAlreadyConfirmedPageCredential()
        {
            var transport = new Transport(); var flow = Flow(transport, new Store { Blocked = true }); bool switchOnce = true;
            flow.Changed += snapshot =>
            {
                if (switchOnce && snapshot.State == AccountHubState.Owned && snapshot.SelectedName == "Alice")
                { switchOnce = false; flow.SelectName("Bob"); }
            };
            var preparing = flow.PrepareJoinAsync("Alice", "wss://game.example/ws");
            transport.Requests[0].Reply.SetResult(new AccountHttpResponse(200, Owned()));
            Assert.IsNull(await preparing); Assert.AreEqual("Bob", flow.Snapshot.SelectedName); Assert.IsNull(flow.Snapshot.Profile);
            var revisit = flow.PrepareJoinAsync("Alice", "wss://game.example/ws");
            Assert.IsTrue(transport.Requests[1].Token == new string('a', 64));
            transport.Requests[1].Reply.SetResult(new AccountHttpResponse(200, Owned(created: false)));
            Assert.IsTrue(flow.CanJoin(await revisit));
        }

        [Test]
        public async Task ReentrantSelectionStopsDeliveringAnObsoleteSnapshotToLaterSubscribers()
        {
            var transport = new Transport(); var flow = Flow(transport); bool staleDelivered = false, bobDelivered = false;
            flow.Changed += snapshot =>
            {
                if (snapshot.State == AccountHubState.Idle && snapshot.SelectedName == "Alice") flow.SelectName("Bob");
            };
            flow.Changed += snapshot =>
            {
                if (snapshot.SelectedName == "Alice") staleDelivered = true;
                if (snapshot.SelectedName == "Bob") bobDelivered = true;
            };
            Assert.IsNull(await flow.PrepareJoinAsync("Alice", "wss://game.example/ws"));
            Assert.IsFalse(staleDelivered); Assert.IsTrue(bobDelivered); Assert.AreEqual(0, transport.Requests.Count);
        }

        [TestCase(401, AccountFailure.PasscodeRequired)]
        [TestCase(403, AccountFailure.Taken)]
        [TestCase(503, AccountFailure.Unavailable)]
        public async Task AccountFailuresRemainTypedAndCannotProduceJoinIntent(int status, AccountFailure failure)
        {
            var transport = new Transport(); var flow = Flow(transport);
            var join = flow.PrepareJoinAsync("Alice", "wss://game.example/ws");
            transport.Requests[0].Reply.SetResult(new AccountHttpResponse(status));
            Assert.IsNull(await join); Assert.AreEqual(AccountHubState.Failed, flow.Snapshot.State);
            Assert.AreEqual(failure, flow.Snapshot.Failure); Assert.IsFalse(flow.Snapshot.Busy);
        }

        static void NoRecoveryKey(AccountHubFlow flow)
        {
            Assert.IsFalse(flow.TryGetRecoveryKey(out var name, out var key));
            Assert.IsTrue(name == string.Empty); Assert.IsTrue(key == string.Empty);
        }

        [Test]
        public async Task RecoveryKeyRequiresConfirmedOwnershipAndReadsWithoutStateEventsStorageOrHttp()
        {
            var transport = new Transport(); var store = new Store { Blocked = true }; var flow = Flow(transport, store);
            NoRecoveryKey(flow); flow.SelectName("Alice"); NoRecoveryKey(flow);
            var opening = flow.OpenProfileAsync("Alice"); NoRecoveryKey(flow);
            var reply = Owned();
            Roguehalla.Client.AccountFullJson.AttachProfile(reply, "{\"profile\":{\"name\":\"Alice\",\"gvByMonth\":[]}}");
            transport.Requests[0].Reply.SetResult(new AccountHttpResponse(200, reply)); Assert.IsTrue(await opening);
            Assert.AreEqual(AccountCredentialRecovery.PageLifetimeOnly, flow.Snapshot.Recovery);
            Assert.AreEqual(AccountFailure.Unreadable, flow.Snapshot.FullProfileFailure);
            var snapshot = flow.Snapshot; int reads = store.Reads, writes = store.Writes, requests = transport.Requests.Count, events = 0;
            flow.Changed += _ => ++events;
            reply.profile.name = "Mallory"; reply.token = "unconfirmed caller mutation";
            Assert.IsTrue(flow.TryGetRecoveryKey(out var name, out var key));
            Assert.IsTrue(name == "Alice"); Assert.IsTrue(key == new string('a', 64));
            Assert.AreSame(snapshot, flow.Snapshot); Assert.AreEqual(0, events);
            Assert.AreEqual(reads, store.Reads); Assert.AreEqual(writes, store.Writes); Assert.AreEqual(requests, transport.Requests.Count);
            flow.Cancel(); NoRecoveryKey(flow);
        }

        [TestCase("open")] [TestCase("join")] [TestCase("refresh")]
        public async Task RecoveryKeyIsUnavailableDuringBusyOperationsEvenForThePreviouslyOwnedName(string action)
        {
            var transport = new Transport(); var flow = Flow(transport);
            var opening = flow.OpenProfileAsync("Alice"); transport.Requests[0].Reply.SetResult(new AccountHttpResponse(200, Owned())); await opening;
            Assert.IsTrue(flow.TryGetRecoveryKey(out _, out _));
            Task busy = action == "join" ? (Task)flow.PrepareJoinAsync("Alice", "wss://game.example/ws") :
                action == "refresh" ? flow.RefreshAfterResultAsync() : flow.OpenProfileAsync("Alice");
            Assert.IsTrue(flow.Snapshot.Busy); NoRecoveryKey(flow); Assert.AreEqual(2, transport.Requests.Count);
            transport.Requests[1].Reply.SetResult(new AccountHttpResponse(200, Owned(created: false))); await busy;
            Assert.IsTrue(flow.TryGetRecoveryKey(out var name, out var key)); Assert.IsTrue(name == "Alice" && key == new string('a', 64));
        }

        [Test]
        public async Task LateConfirmedClaimAfterSelectionSwitchNeedsExplicitReopenBeforeKeyRecovery()
        {
            var transport = new Transport(); var flow = Flow(transport, new Store { Blocked = true });
            var opening = flow.OpenProfileAsync("Alice"); flow.SelectName("Bob"); NoRecoveryKey(flow);
            transport.Requests[0].Reply.SetResult(new AccountHttpResponse(200, Owned())); Assert.IsFalse(await opening); NoRecoveryKey(flow);
            flow.SelectName("Alice"); NoRecoveryKey(flow);
            var reopen = flow.OpenProfileAsync("Alice"); Assert.IsTrue(transport.Requests[1].Token == new string('a', 64)); NoRecoveryKey(flow);
            transport.Requests[1].Reply.SetResult(new AccountHttpResponse(200, Owned(created: false))); Assert.IsTrue(await reopen);
            Assert.IsTrue(flow.TryGetRecoveryKey(out var name, out var key)); Assert.IsTrue(name == "Alice" && key == new string('a', 64));
            flow.SelectName("Bob"); NoRecoveryKey(flow);
        }

        [TestCase("https://game.example/other/api")] [TestCase("https://other.example/api")]
        public async Task RecoveryKeyCannotCrossFullApiBaseOrOriginWithTheSameNameAndCredentialStore(string otherApi)
        {
            var store = new Store(); var first = new Transport(); var second = new Transport();
            var a = Flow(first, store); var b = new AccountHubFlow(new AccountSession(AccountEndpoint.FromPage("https://game.example/", otherApi), second, store));
            var opening = a.OpenProfileAsync("Alice"); first.Requests[0].Reply.SetResult(new AccountHttpResponse(200, Owned())); await opening;
            b.SelectName("Alice"); NoRecoveryKey(b); Assert.AreEqual(0, second.Requests.Count);
            var other = b.OpenProfileAsync("Alice"); Assert.IsNull(second.Requests[0].Token); NoRecoveryKey(b);
            var reply = Owned(); reply.token = new string('c', 64); second.Requests[0].Reply.SetResult(new AccountHttpResponse(200, reply)); await other;
            Assert.IsTrue(a.TryGetRecoveryKey(out var nameA, out var keyA)); Assert.IsTrue(nameA == "Alice" && keyA == new string('a', 64));
            Assert.IsTrue(b.TryGetRecoveryKey(out var nameB, out var keyB)); Assert.IsTrue(nameB == "Alice" && keyB == new string('c', 64));
        }

        [Test]
        public async Task RecoveryKeyRejectsMismatchedReplyAndReentrantOwnerSelectionChange()
        {
            var transport = new Transport(); var flow = Flow(transport);
            var mismatched = flow.OpenProfileAsync("Alice"); transport.Requests[0].Reply.SetResult(new AccountHttpResponse(200, Owned("Bob")));
            Assert.IsFalse(await mismatched); NoRecoveryKey(flow);
            flow.Changed += snapshot => { if (snapshot.State == AccountHubState.Owned) flow.SelectName("Bob"); };
            var opening = flow.OpenProfileAsync("Alice"); transport.Requests[1].Reply.SetResult(new AccountHttpResponse(200, Owned()));
            Assert.IsFalse(await opening); NoRecoveryKey(flow); Assert.AreEqual("Bob", flow.Snapshot.SelectedName);
        }

        [Test]
        public async Task RecoveryKeyRejectsReplacedSessionOwnershipEvenIfTheOldSnapshotStillSaysOwned()
        {
            var transport = new Transport(); var session = new AccountSession(Endpoint(), transport, new Store()); var flow = new AccountHubFlow(session);
            var opening = flow.OpenProfileAsync("Alice"); transport.Requests[0].Reply.SetResult(new AccountHttpResponse(200, Owned())); await opening;
            var outsideFlow = session.OpenAsync("Alice"); Assert.AreEqual(AccountHubState.Owned, flow.Snapshot.State); NoRecoveryKey(flow);
            transport.Requests[1].Reply.SetResult(new AccountHttpResponse(200, Owned(created: false))); await outsideFlow;
            Assert.AreEqual(AccountHubState.Owned, flow.Snapshot.State); NoRecoveryKey(flow);
        }

        static async Task Until(Func<bool> ready)
        { for (int i = 0; i < 1000 && !ready(); i++) await Task.Delay(1); Assert.IsTrue(ready()); }
    }
}

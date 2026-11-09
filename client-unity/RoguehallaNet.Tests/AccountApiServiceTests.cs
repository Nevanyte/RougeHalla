using System;
using System.Collections.Generic;
using System.Linq;
using System.Threading;
using System.Threading.Tasks;
using Newtonsoft.Json.Linq;
using NUnit.Framework;
using Roguehalla.Client;

namespace Roguehalla.Net.Tests
{
    public sealed class AccountApiServiceTests
    {
        sealed class Claim { public string Name, Token; public TaskCompletionSource<AccountHttpResponse> Reply = new TaskCompletionSource<AccountHttpResponse>(); }
        sealed class Sent { public AccountApiRequest Request; public CancellationToken Cancellation; public TaskCompletionSource<AccountApiResponse> Reply = new TaskCompletionSource<AccountApiResponse>(); }
        sealed class Transport : IAccountTransport, IAccountApiTransport
        {
            public readonly List<Claim> Claims = new List<Claim>(); public readonly List<Sent> Requests = new List<Sent>();
            public TaskCompletionSource<AccountApiRequest> NextRequest = new TaskCompletionSource<AccountApiRequest>();
            public Task<AccountHttpResponse> GetProfileAsync(string url, string token, string passcode, CancellationToken ct)
            { var request = new Claim { Name = Uri.UnescapeDataString(new Uri(url).Segments.Last()), Token = token }; Claims.Add(request); return request.Reply.Task; }
            public Task<AccountApiResponse> SendAsync(AccountApiRequest request, CancellationToken ct)
            { var sent = new Sent { Request = request, Cancellation = ct }; Requests.Add(sent); var signal = NextRequest; NextRequest = new TaskCompletionSource<AccountApiRequest>(); signal.SetResult(request); return sent.Reply.Task; }
        }
        sealed class Credentials : IAccountCredentialStore
        {
            readonly Dictionary<string, string> _values = new Dictionary<string, string>();
            public bool Blocked;
            public string Read(string scope, string name) => _values.TryGetValue(scope + name, out var value) ? value : null;
            public bool WriteConfirmed(string scope, string name, string token) { if (Blocked) return false; _values[scope + name] = token; return true; }
        }
        sealed class Rig
        {
            public readonly Transport Transport = new Transport(); public readonly Credentials Credentials = new Credentials();
            public readonly AccountHubFlow Flow; public readonly AccountApiService Api;
            public Rig() { Flow = new AccountHubFlow(new AccountSession(AccountEndpoint.FromPage("https://game.example/", "https://game.example/prefix/api"), Transport, Credentials)); Api = Flow.CreateApiService(Transport); }
            public async Task Open(string name = "Alice", bool full = true)
            {
                var open = Flow.OpenProfileAsync(name); var request = Transport.Claims.Last();
                request.Reply.SetResult(new AccountHttpResponse(200, Reply(name, request.Token == null, full)));
                Assert.IsTrue(await open);
            }
        }
        static AccountFullProfile Profile(string name = "Alice", long gv = 100) => new AccountFullProfile(name, gv, 100,
            new Dictionary<string, long> { ["2026-11"] = 100 }, new AccountFullStats(1, 0, 0, 1, 0),
            new AccountFullCosmetics(new[] { "skin-crimson" }, new Dictionary<string, string>()), new Dictionary<string, long>(),
            new AccountFullProgress(0, 0, 0, new Dictionary<string, long>(), new Dictionary<string, long>()));
        static AccountReply Reply(string name, bool created, bool full) => new AccountReply
        {
            profile = new AccountProfile { name = name, gv = 100, gvLifetime = 100, stats = new AccountStats { runs = 1, wins = 0, draws = 0, deaths = 1, kills = 0 } },
            token = new string(name == "Bob" ? 'b' : 'a', 64), created = created, FullProfile = full ? Profile(name) : null,
        };
        static AccountLeaderboard Board(string month, bool you = false) => new AccountLeaderboard(month,
            new[] { new AccountLeaderboardEntry("Alice", 100, null) }, new[] { month }, you ? new AccountLeaderboardRank(1, 100) : null);

        [Test]
        public async Task OperationOwnershipIsReadOnlyAndBoundToTheRegisteringService()
        {
            var rig = new Rig(); var peer = new Rig(); await rig.Open(); await peer.Open();
            var operation = rig.Api.CreatePurchase("skin-bone"); var id = operation.Id;
            var snapshot = rig.Flow.Snapshot; int changed = 0; rig.Flow.Changed += _ => ++changed;
            for (int i = 0; i < 3; ++i)
            {
                Assert.IsTrue(rig.Api.IsCurrentOwner(operation));
                Assert.IsFalse(peer.Api.IsCurrentOwner(operation), "matching name, scope and credential do not register another service's object");
                Assert.IsFalse(rig.Api.IsCurrentOwner(null));
            }
            Assert.AreSame(snapshot, rig.Flow.Snapshot); Assert.AreEqual(0, changed);
            Assert.AreEqual(id, operation.Id); Assert.AreEqual(AccountMutationState.Ready, operation.State); Assert.IsNull(operation.Error);
            Assert.AreEqual(0, rig.Transport.Requests.Count); Assert.AreEqual(0, peer.Transport.Requests.Count);
            Assert.AreEqual(1, rig.Transport.Claims.Count); Assert.AreEqual(1, peer.Transport.Claims.Count);
        }

        [Test]
        public async Task OperationOwnershipTracksAdmittedOwnershipWithoutRetryingUnknown()
        {
            var rig = new Rig(); await rig.Open(); var operation = rig.Api.CreatePurchase("skin-bone"); var id = operation.Id;
            var send = rig.Api.SendAsync(operation); rig.Transport.Requests[0].Reply.SetResult(new AccountApiResponse(0)); await send;
            Assert.IsTrue(rig.Api.IsCurrentOwner(operation)); Assert.AreEqual(AccountMutationState.Unknown, operation.State);
            var reopening = rig.Flow.OpenProfileAsync("Alice"); var pending = rig.Transport.Claims.Last();
            Assert.IsFalse(rig.Api.IsCurrentOwner(operation), "opening is not admitted ownership");
            rig.Flow.Cancel(); Assert.IsFalse(rig.Api.IsCurrentOwner(operation));
            pending.Reply.SetResult(new AccountHttpResponse(200, Reply("Alice", false, true)));
            Assert.IsFalse(await reopening); Assert.IsFalse(rig.Api.IsCurrentOwner(operation));
            await rig.Open(); Assert.IsTrue(rig.Api.IsCurrentOwner(operation), "same confirmed credential can explicitly retry its original operation");
            Assert.AreEqual(AccountMutationState.Unknown, operation.State); Assert.AreEqual(id, operation.Id);
            Assert.AreEqual(1, rig.Api.PendingOperations.Count); Assert.AreEqual(1, rig.Transport.Requests.Count);
        }

        [Test]
        public async Task SameNameReplacementCredentialDoesNotOwnOrDiscardOldUnknown()
        {
            var rig = new Rig(); await rig.Open(); var operation = rig.Api.CreatePurchase("skin-bone"); var id = operation.Id;
            var send = rig.Api.SendAsync(operation); rig.Transport.Requests[0].Reply.SetResult(new AccountApiResponse(0)); await send;
            var rejected = rig.Flow.OpenProfileAsync("Alice");
            rig.Transport.Claims.Last().Reply.SetResult(new AccountHttpResponse(403)); Assert.IsFalse(await rejected);
            var replacement = new string('c', 64);
            var recovering = rig.Flow.OpenProfileAsync("Alice", pendingKey: replacement);
            Assert.AreEqual(replacement, rig.Transport.Claims.Last().Token);
            var reply = Reply("Alice", false, true); reply.token = replacement;
            rig.Transport.Claims.Last().Reply.SetResult(new AccountHttpResponse(200, reply)); Assert.IsTrue(await recovering);
            Assert.AreEqual(operation.Name, rig.Flow.Snapshot.Profile.Name);
            Assert.IsFalse(rig.Api.IsCurrentOwner(operation));
            Assert.AreEqual(AccountApiFailure.NoOwner, (await rig.Api.SendAsync(operation)).Failure);
            Assert.AreEqual(AccountMutationState.Unknown, operation.State); Assert.AreEqual(id, operation.Id);
            Assert.AreEqual(id, rig.Api.PendingOperations.Single().Id); Assert.AreEqual(1, rig.Transport.Requests.Count);
            Assert.IsTrue(rig.Api.IsCurrentOwner(rig.Api.CreatePurchase("skin-bone")));
        }

        [Test]
        public async Task FullReadUsesOwnershipPathAndMalformedRichMapsDoNotLoseCreatedPageOnlyCredential()
        {
            var rig = new Rig(); rig.Credentials.Blocked = true; rig.Flow.SelectName("Alice");
            var reading = rig.Api.ReadProfileAsync(); var reply = Reply("Alice", true, false);
            AccountFullJson.AttachProfile(reply, "{\"profile\":{\"name\":\"Alice\",\"gv\":100,\"gvLifetime\":100,\"gvByMonth\":[]}}");
            rig.Transport.Claims[0].Reply.SetResult(new AccountHttpResponse(200, reply));
            Assert.AreEqual(AccountApiFailure.Unreadable, (await reading).Failure);
            Assert.AreEqual(AccountCredentialRecovery.PageLifetimeOnly, rig.Flow.Snapshot.Recovery);
            Assert.AreEqual(AccountFailure.Unreadable, rig.Flow.Snapshot.FullProfileFailure); Assert.IsNull(rig.Flow.Snapshot.FullProfile);
            Assert.IsFalse(rig.Flow.Snapshot.Profile.HasFullProfile);
            Assert.AreEqual(0, rig.Transport.Requests.Count, "no standalone claim GET outside AccountSession");
            var retry = rig.Api.ReadProfileAsync();
            Assert.IsTrue(rig.Transport.Claims[1].Token == new string('a', 64));
            rig.Transport.Claims[1].Reply.SetResult(new AccountHttpResponse(200, Reply("Alice", false, true)));
            var result = await retry; Assert.AreEqual(AccountApiFailure.None, result.Failure); Assert.IsTrue(rig.Api.IsCurrent(result));
            Assert.AreEqual(100, rig.Flow.Snapshot.FullProfile.Gv);
            Assert.IsTrue(rig.Flow.Snapshot.Profile.HasFullProfile);
        }

        [Test]
        public async Task OneServicePerFlowKeepsMutationSerializationAcrossFactoryConsumers()
        {
            var rig = new Rig(); await rig.Open(); Assert.AreSame(rig.Api, rig.Flow.CreateApiService(rig.Transport));
            Assert.Throws<InvalidOperationException>(() => rig.Flow.CreateApiService(new Transport()));
            var first = rig.Api.CreatePurchase("skin-bone"); var next = rig.Api.CreateEquip("skin", null);
            var a = rig.Api.SendAsync(first); var b = rig.Flow.CreateApiService(rig.Transport).SendAsync(next);
            Assert.AreEqual(1, rig.Transport.Requests.Count);
            var nextRequest = rig.Transport.NextRequest.Task;
            rig.Transport.Requests[0].Reply.SetResult(new AccountApiResponse(0)); await a;
            await nextRequest;
            Assert.AreEqual(2, rig.Transport.Requests.Count); rig.Transport.Requests[1].Reply.SetResult(new AccountApiResponse(0)); await b;
        }

        [TestCase(401, AccountApiFailure.PasscodeRequired)]
        [TestCase(403, AccountApiFailure.Forbidden)]
        [TestCase(429, AccountApiFailure.RateLimited)]
        [TestCase(503, AccountApiFailure.Unavailable)]
        public async Task FullReadKeepsCurrentOwnershipErrorsHonest(int status, AccountApiFailure failure)
        {
            var rig = new Rig(); rig.Flow.SelectName("Alice"); var reading = rig.Api.ReadProfileAsync();
            rig.Transport.Claims[0].Reply.SetResult(new AccountHttpResponse(status)); Assert.AreEqual(failure, (await reading).Failure);
            Assert.IsNull(rig.Flow.Snapshot.FullProfile); Assert.AreEqual(0, rig.Transport.Requests.Count);
        }

        [Test]
        public async Task PurchaseWaitsForAckAndUnknownOutcomeRetriesTheSameDurableUuid()
        {
            var rig = new Rig(); await rig.Open(); var operation = rig.Api.CreatePurchase("skin-bone");
            var send = rig.Api.SendAsync(operation); var request = rig.Transport.Requests[0].Request;
            Assert.IsTrue(request.HasAllowedTarget()); Assert.AreEqual("https://game.example/prefix/api/profile/Alice/purchase", request.Url);
            Assert.AreEqual("POST", request.Method); Assert.AreEqual(operation.Id, request.PurchaseId);
            CollectionAssert.AreEqual(new[] { "Accept", "x-profile-token", "Content-Type", "Idempotency-Key" }, request.Headers.Select(h => h.Key));
            Assert.AreEqual("skin-bone", (string)JObject.Parse(AccountFullJson.EncodeMutation(request))["id"]);
            Assert.AreEqual(100, rig.Flow.Snapshot.FullProfile.Gv); Assert.AreEqual(AccountMutationState.InFlight, operation.State);
            rig.Transport.Requests[0].Reply.SetResult(new AccountApiResponse(0)); await send;
            Assert.AreEqual(AccountMutationState.Unknown, operation.State); Assert.AreEqual(1, rig.Api.PendingOperations.Count);
            var retry = rig.Api.SendAsync(operation); Assert.AreEqual(operation.Id, rig.Transport.Requests[1].Request.PurchaseId);
            rig.Transport.Requests[1].Reply.SetResult(new AccountApiResponse(200, Profile(gv: 60)));
            Assert.IsTrue((await retry).PublishedCurrent); Assert.AreEqual(60, rig.Flow.Snapshot.FullProfile.Gv);
            Assert.AreEqual(AccountMutationState.Confirmed, operation.State); Assert.AreEqual(0, rig.Api.PendingOperations.Count);
        }

        [Test]
        public async Task QueuedMutationsAreSerializedAndCannotStartAfterSelectionChanges()
        {
            var rig = new Rig(); await rig.Open(); var first = rig.Api.CreatePurchase("skin-bone"); var second = rig.Api.CreateEquip("skin", "skin-crimson");
            var sending = rig.Api.SendAsync(first); var queued = rig.Api.SendAsync(second); Assert.AreEqual(1, rig.Transport.Requests.Count);
            await rig.Open("Bob");
            rig.Transport.Requests[0].Reply.SetResult(new AccountApiResponse(200, Profile(gv: 60)));
            Assert.AreEqual(AccountApiFailure.Stale, (await sending).Failure); Assert.AreEqual(AccountApiFailure.Stale, (await queued).Failure);
            Assert.AreEqual(1, rig.Transport.Requests.Count); Assert.AreEqual(AccountMutationState.Confirmed, first.State);
            Assert.AreEqual("Bob", rig.Flow.Snapshot.FullProfile.Name); Assert.AreEqual(100, rig.Flow.Snapshot.FullProfile.Gv);
            Assert.AreEqual("Alice", rig.Api.PendingOperations[0].Name);
            await rig.Open("Alice"); var retry = rig.Api.SendAsync(second);
            Assert.AreEqual("POST", rig.Transport.Requests[1].Request.Method); Assert.IsNull(rig.Transport.Requests[1].Request.PurchaseId);
            var json = JObject.Parse(AccountFullJson.EncodeMutation(rig.Transport.Requests[1].Request));
            Assert.AreEqual("skin", (string)json["slot"]); Assert.AreEqual("skin-crimson", (string)json["id"]);
            rig.Transport.Requests[1].Reply.SetResult(new AccountApiResponse(200, Profile())); Assert.IsTrue((await retry).PublishedCurrent);
        }

        [Test]
        public async Task CancelledAlreadySentEquipKeepsUnknownMetadataAndNeverPretendsRollbackOrGrant()
        {
            var rig = new Rig(); await rig.Open(); var operation = rig.Api.CreateEquip("skin", null); var cancel = new CancellationTokenSource();
            var sending = rig.Api.SendAsync(operation, cancel.Token); cancel.Cancel();
            Assert.IsFalse(rig.Transport.Requests[0].Cancellation.CanBeCanceled);
            Assert.AreEqual(JTokenType.Null, JObject.Parse(AccountFullJson.EncodeMutation(rig.Transport.Requests[0].Request))["id"].Type);
            rig.Transport.Requests[0].Reply.SetResult(new AccountApiResponse(408)); await sending;
            Assert.AreEqual(AccountMutationState.Unknown, operation.State); Assert.AreEqual(1, rig.Api.PendingOperations.Count);
            Assert.AreEqual(100, rig.Flow.Snapshot.FullProfile.Gv); Assert.AreEqual(0, rig.Flow.Snapshot.FullProfile.Cosmetics.Equipped.Count);
        }

        [Test]
        public async Task ReentrantMutationAckSelectionChangeCannotPublishUnderTheNewOwner()
        {
            var rig = new Rig(); await rig.Open(); var operation = rig.Api.CreatePurchase("skin-bone");
            rig.Flow.Changed += snapshot => { if (snapshot.FullProfile?.Gv == 60) rig.Flow.SelectName("Bob"); };
            var sending = rig.Api.SendAsync(operation); rig.Transport.Requests[0].Reply.SetResult(new AccountApiResponse(200, Profile(gv: 60)));
            var result = await sending; Assert.AreEqual(AccountApiFailure.Stale, result.Failure); Assert.IsFalse(rig.Api.IsCurrent(result));
            Assert.AreEqual(AccountMutationState.Confirmed, operation.State); Assert.AreEqual("Bob", rig.Flow.Snapshot.SelectedName); Assert.IsNull(rig.Flow.Snapshot.FullProfile);
        }

        [Test]
        public async Task DefinitiveShopRefusalKeepsAuthoritativeProfileAndTypedNeedHave()
        {
            var rig = new Rig(); await rig.Open(); var operation = rig.Api.CreatePurchase("skin-bone");
            var sending = rig.Api.SendAsync(operation);
            rig.Transport.Requests[0].Reply.SetResult(new AccountApiResponse(402, error: AccountFullJson.DecodeError(402, "{\"error\":\"not enough GV\",\"code\":\"insufficient_gv\",\"need\":150,\"have\":100}")));
            Assert.AreEqual(AccountApiFailure.InsufficientGv, (await sending).Failure); Assert.AreEqual(AccountMutationState.Refused, operation.State);
            Assert.AreEqual(150, operation.Error.Need); Assert.AreEqual(100, operation.Error.Have); Assert.AreEqual(100, rig.Flow.Snapshot.FullProfile.Gv);
        }

        [Test]
        public async Task LateRefusalRetainsOriginalOperationMetadataWithoutPublishingAnErrorForNewSelection()
        {
            var rig = new Rig(); await rig.Open(); var operation = rig.Api.CreatePurchase("skin-bone");
            var sending = rig.Api.SendAsync(operation); await rig.Open("Bob");
            rig.Transport.Requests[0].Reply.SetResult(new AccountApiResponse(402, error: new AccountApiError(AccountApiFailure.InsufficientGv, 150, 100)));
            var result = await sending; Assert.AreEqual(AccountApiFailure.Stale, result.Failure); Assert.IsFalse(rig.Api.IsCurrent(result));
            Assert.AreEqual(AccountMutationState.Refused, operation.State); Assert.AreEqual(AccountApiFailure.InsufficientGv, operation.Error.Failure);
            Assert.AreEqual("Bob", rig.Flow.Snapshot.FullProfile.Name); Assert.AreEqual(100, rig.Flow.Snapshot.FullProfile.Gv);
        }

        [Test]
        public async Task LeaderboardOwnerRankAndMonthResponsesStayBoundToCurrentSelectionAndQuery()
        {
            var rig = new Rig(); await rig.Open(); var privateBoard = rig.Api.ReadLeaderboardAsync("2026-11", includeOwner: true);
            Assert.IsTrue(rig.Transport.Requests[0].Request.OwnerToken == new string('a', 64)); Assert.IsTrue(rig.Transport.Requests[0].Request.Url.Contains("name=Alice"));
            rig.Flow.SelectName("Bob"); rig.Transport.Requests[0].Reply.SetResult(new AccountApiResponse(200, leaderboard: Board("2026-11", true)));
            var stale = await privateBoard; Assert.AreEqual(AccountApiFailure.Stale, stale.Failure); Assert.IsNull(stale.Leaderboard);
            var old = rig.Api.ReadLeaderboardAsync("2026-10"); var current = rig.Api.ReadLeaderboardAsync("2026-11");
            Assert.IsNull(rig.Transport.Requests[1].Request.OwnerToken);
            rig.Transport.Requests[2].Reply.SetResult(new AccountApiResponse(200, leaderboard: Board("2026-11"))); var result = await current;
            rig.Transport.Requests[1].Reply.SetResult(new AccountApiResponse(200, leaderboard: Board("2026-10")));
            Assert.AreEqual(AccountApiFailure.Stale, (await old).Failure); Assert.IsTrue(rig.Api.IsCurrent(result));
            var wrong = rig.Api.ReadLeaderboardAsync("2026-10"); rig.Transport.Requests[3].Reply.SetResult(new AccountApiResponse(200, leaderboard: Board("2026-11")));
            Assert.AreEqual(AccountApiFailure.Unreadable, (await wrong).Failure); Assert.IsFalse(rig.Api.IsCurrent(result));
        }

        static void FailBoard(Sent sent, string outcome)
        {
            if (outcome == "exception") sent.Reply.SetException(new InvalidOperationException("disposable transport failure"));
            else if (outcome == "malformed")
            {
                Assert.IsFalse(AccountFullJson.TryLeaderboard("{\"month\":\"2026-11\",\"entries\":{}}", out var invalid));
                sent.Reply.SetResult(new AccountApiResponse(200, leaderboard: invalid));
            }
            else sent.Reply.SetResult(new AccountApiResponse(503, error: new AccountApiError(AccountApiFailure.Unavailable)));
        }

        [TestCase("503", false)] [TestCase("malformed", false)] [TestCase("exception", false)]
        [TestCase("503", true)] [TestCase("malformed", true)] [TestCase("exception", true)]
        public async Task CurrentLeaderboardErrorsAreConsumableThenExpireOnNextQueryOrOwnerChange(string outcome, bool owned)
        {
            var rig = new Rig(); if (owned) await rig.Open();
            var reading = rig.Api.ReadLeaderboardAsync("2026-11", includeOwner: owned);
            FailBoard(rig.Transport.Requests[0], outcome); var result = await reading;
            Assert.AreEqual(outcome == "malformed" ? AccountApiFailure.Unreadable : AccountApiFailure.Unavailable, result.Failure);
            Assert.IsTrue(rig.Api.IsCurrent(result)); Assert.IsNull(result.Leaderboard);
            if (owned) rig.Flow.SelectName("Bob");
            else
            {
                var next = rig.Api.ReadLeaderboardAsync("2026-10"); Assert.IsFalse(rig.Api.IsCurrent(result));
                rig.Transport.Requests[1].Reply.SetResult(new AccountApiResponse(200, leaderboard: Board("2026-10")));
                Assert.IsTrue(rig.Api.IsCurrent(await next));
            }
            Assert.IsFalse(rig.Api.IsCurrent(result));
        }

        [TestCase("503", false)] [TestCase("malformed", false)] [TestCase("exception", false)]
        [TestCase("503", true)] [TestCase("malformed", true)] [TestCase("exception", true)]
        public async Task LateLeaderboardErrorsAreRejectedAfterNewQueryOrOwnerChange(string outcome, bool owned)
        {
            var rig = new Rig(); if (owned) await rig.Open();
            var reading = rig.Api.ReadLeaderboardAsync("2026-11", includeOwner: owned);
            if (owned) rig.Flow.SelectName("Bob");
            else
            {
                var next = rig.Api.ReadLeaderboardAsync("2026-10");
                rig.Transport.Requests[1].Reply.SetResult(new AccountApiResponse(200, leaderboard: Board("2026-10"))); await next;
            }
            FailBoard(rig.Transport.Requests[0], outcome); var result = await reading;
            Assert.AreEqual(AccountApiFailure.Stale, result.Failure); Assert.IsFalse(rig.Api.IsCurrent(result)); Assert.IsNull(result.Leaderboard);
        }

        [Test]
        public async Task CurrentLeaderboardValidationAndCancellationOutcomesKeepQueryBinding()
        {
            var rig = new Rig(); var invalid = await rig.Api.ReadLeaderboardAsync("invalid");
            Assert.AreEqual(AccountApiFailure.BadRequest, invalid.Failure); Assert.IsTrue(rig.Api.IsCurrent(invalid));
            var noOwner = await rig.Api.ReadLeaderboardAsync(includeOwner: true);
            Assert.AreEqual(AccountApiFailure.NoOwner, noOwner.Failure); Assert.IsTrue(rig.Api.IsCurrent(noOwner)); Assert.IsFalse(rig.Api.IsCurrent(invalid));
            var cancel = new CancellationTokenSource(); var reading = rig.Api.ReadLeaderboardAsync(cancellation: cancel.Token);
            cancel.Cancel(); rig.Transport.Requests[0].Reply.SetException(new OperationCanceledException());
            var cancelled = await reading; Assert.AreEqual(AccountApiFailure.Cancelled, cancelled.Failure); Assert.IsTrue(rig.Api.IsCurrent(cancelled));
            Assert.IsFalse(rig.Api.IsCurrent(noOwner)); Assert.AreEqual(1, rig.Transport.Requests.Count);
        }

        [Test]
        public async Task OwnerRequiredValidationWithoutConfirmedOwnerExpiresWhenOwnershipArrives()
        {
            var rig = new Rig(); var opening = rig.Flow.OpenProfileAsync("Alice");
            var noOwner = await rig.Api.ReadLeaderboardAsync(includeOwner: true);
            Assert.AreEqual(AccountApiFailure.NoOwner, noOwner.Failure); Assert.IsTrue(rig.Api.IsCurrent(noOwner));
            rig.Transport.Claims[0].Reply.SetResult(new AccountHttpResponse(200, Reply("Alice", true, true))); await opening;
            Assert.IsFalse(rig.Api.IsCurrent(noOwner)); Assert.AreEqual(0, rig.Transport.Requests.Count);
            var invalid = await rig.Api.ReadLeaderboardAsync("invalid", includeOwner: true); Assert.IsTrue(rig.Api.IsCurrent(invalid));
            rig.Flow.SelectName("Bob"); Assert.IsFalse(rig.Api.IsCurrent(invalid));
        }

        [Test]
        public async Task ActualPurchaseIdempotencyConflictIsTypedRefusalWithoutRekeyOrProfileChange()
        {
            const string body = "{\"error\":\"idempotency key was used for a different purchase\",\"code\":\"bad_request\"}";
            var rig = new Rig(); await rig.Open(); var operation = rig.Api.CreatePurchase("skin-bone"); var id = operation.Id;
            var sending = rig.Api.SendAsync(operation);
            rig.Transport.Requests[0].Reply.SetResult(new AccountApiResponse(409, error: AccountFullJson.DecodeError(409, body)));
            var result = await sending; Assert.AreEqual(AccountApiFailure.BadRequest, result.Failure); Assert.IsTrue(rig.Api.IsCurrent(result));
            Assert.AreEqual(AccountMutationState.Refused, operation.State); Assert.AreEqual(AccountApiFailure.BadRequest, operation.Error.Failure);
            Assert.AreEqual(id, operation.Id); Assert.AreEqual(id, rig.Transport.Requests[0].Request.PurchaseId);
            Assert.AreEqual(100, rig.Flow.Snapshot.FullProfile.Gv); Assert.AreEqual(1, rig.Transport.Requests.Count);
        }
    }
}

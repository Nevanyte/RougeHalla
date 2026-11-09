using System;
using System.Collections.Generic;
using System.Linq;
using System.Threading;
using System.Threading.Tasks;
using NUnit.Framework;

namespace Roguehalla.Net.Tests
{
    public sealed class AccountSettlementApiTests
    {
        sealed class Claim
        {
            public string Url, Token;
            public readonly TaskCompletionSource<AccountHttpResponse> Reply = new TaskCompletionSource<AccountHttpResponse>();
        }
        sealed class Request
        {
            public AccountApiRequest Value;
            public CancellationToken Cancellation;
            public readonly TaskCompletionSource<AccountApiResponse> Reply = new TaskCompletionSource<AccountApiResponse>();
        }
        sealed class Transport : IAccountTransport, IAccountApiTransport
        {
            public readonly List<Claim> Claims = new List<Claim>();
            public readonly List<Request> Requests = new List<Request>();
            public Task<AccountHttpResponse> GetProfileAsync(string url, string ownerToken, string passcode, CancellationToken cancellation)
            {
                var claim = new Claim { Url = url, Token = ownerToken }; Claims.Add(claim); return claim.Reply.Task;
            }
            public Task<AccountApiResponse> SendAsync(AccountApiRequest request, CancellationToken cancellation)
            {
                var send = new Request { Value = request, Cancellation = cancellation }; Requests.Add(send); return send.Reply.Task;
            }
        }
        sealed class Credentials : IAccountCredentialStore
        {
            public string Read(string scope, string name) => null;
            public bool WriteConfirmed(string scope, string name, string token) => false;
        }
        sealed class Rig
        {
            public readonly Transport Transport = new Transport();
            public readonly AccountHubFlow Flow;
            public readonly AccountApiService Api;
            public Rig()
            {
                var endpoint = AccountEndpoint.FromPage("https://game.example/page", "https://game.example/prefix/api");
                Flow = new AccountHubFlow(new AccountSession(endpoint, Transport, new Credentials()));
                Api = Flow.CreateApiService(Transport);
            }
            public async Task<AccountJoinIntent> JoinIntent(string name = "Alice")
            {
                var opening = Flow.PrepareJoinAsync(name, "wss://game.example/prefix/ws");
                Claim request = Transport.Claims.Last();
                request.Reply.SetResult(new AccountHttpResponse(200, Owned(name, request.Token == null)));
                var intent = await opening;
                Assert.IsNotNull(intent);
                Assert.IsTrue(Flow.CanJoin(intent));
                return intent;
            }
        }

        const string MatchId = "00010203-0405-0607-0809-0a0b0c0d0e0f";
        static readonly byte[] MatchBytes = Enumerable.Range(0, 16).Select(i => (byte)i).ToArray();

        static AccountReply Owned(string name, bool created) => new AccountReply
        {
            profile = new AccountProfile { name = name, gv = 3, gvLifetime = 5,
                stats = new AccountStats { runs = 1, wins = 0, draws = 0, deaths = 1, kills = 0 } },
            token = new string(name == "Bob" ? 'b' : 'c', 64), created = created,
        };

        [Test]
        public async Task ReceiptAccessIsOpaqueServiceBoundAndRequiresTheCurrentAcceptedIntent()
        {
            var rig = new Rig(); var peer = new Rig();
            var intent = await rig.JoinIntent();
            var access = rig.Api.CaptureSettlementAccess(intent);
            Assert.IsNotNull(access);
            Assert.IsTrue(rig.Api.IsCurrent(access));
            Assert.IsFalse(peer.Api.IsCurrent(access));
            Assert.IsNull(rig.Api.CaptureSettlementAccess(null));
            rig.Flow.Cancel();
            Assert.IsFalse(rig.Api.IsCurrent(access));
            Assert.IsNull(rig.Api.CaptureSettlementAccess(intent));
        }

        [Test]
        public async Task ReadUsesExactOwnedGetAndReturnsTheMatchingTypedReceiptWithoutClaiming()
        {
            var rig = new Rig(); var intent = await rig.JoinIntent();
            var access = rig.Api.CaptureSettlementAccess(intent);
            int claims = rig.Transport.Claims.Count;
            var reading = rig.Api.ReadSettlementAsync(access, MatchBytes);
            Assert.AreEqual(1, rig.Transport.Requests.Count);
            var request = rig.Transport.Requests[0].Value;
            Assert.AreEqual("GET", request.Method);
            Assert.AreEqual(AccountApiReadKind.Settlement, request.ReadKind);
            Assert.AreEqual(MatchId, request.MatchId);
            Assert.AreEqual("https://game.example/prefix/api/profile/Alice/matches/" + MatchId + "/settlement", request.Url);
            Assert.IsTrue(request.HasAllowedTarget());
            Assert.AreEqual(new string('c', 64), request.OwnerToken);
            Assert.AreEqual(new string('c', 64), request.Headers.Single(h => h.Key == "x-profile-token").Value);
            Assert.AreEqual(claims, rig.Transport.Claims.Count, "receipt reads must not reopen or claim the profile");

            var receipt = new AccountSettlement(MatchId, AccountSettlementStatus.Committed, AccountSettlementOutcome.Won, 0);
            rig.Transport.Requests[0].Reply.SetResult(new AccountApiResponse(200, settlement: receipt));
            var result = await reading;
            Assert.AreEqual(AccountApiFailure.None, result.Failure);
            Assert.AreSame(receipt, result.Settlement);
            Assert.IsTrue(rig.Api.IsCurrent(result));
            Assert.AreEqual(claims, rig.Transport.Claims.Count);
        }

        [Test]
        public async Task UnknownReceiptRemainsUnknownAndInvalidInputsNeverSend()
        {
            var rig = new Rig();
            var noOwner = await rig.Api.ReadSettlementAsync(null, MatchBytes);
            Assert.AreEqual(AccountApiFailure.NoOwner, noOwner.Failure);
            Assert.IsTrue(rig.Api.IsCurrent(noOwner));
            Assert.AreEqual(0, rig.Transport.Claims.Count);
            Assert.AreEqual(0, rig.Transport.Requests.Count);

            var access = rig.Api.CaptureSettlementAccess(await rig.JoinIntent());
            Assert.AreEqual(AccountApiFailure.BadRequest, (await rig.Api.ReadSettlementAsync(access, new byte[15])).Failure);
            Assert.AreEqual(AccountApiFailure.BadRequest, (await rig.Api.ReadSettlementAsync(access, MatchId.ToUpperInvariant())).Failure);
            Assert.AreEqual(0, rig.Transport.Requests.Count);

            var unknown = new AccountSettlement(MatchId, AccountSettlementStatus.Unknown);
            var reading = rig.Api.ReadSettlementAsync(access, MatchBytes);
            rig.Transport.Requests[0].Reply.SetResult(new AccountApiResponse(200, settlement: unknown));
            var result = await reading;
            Assert.AreEqual(AccountApiFailure.None, result.Failure);
            Assert.AreEqual(AccountSettlementStatus.Unknown, result.Settlement.Status);
            Assert.IsNull(result.Settlement.GvCredited);
            Assert.IsNull(result.Settlement.Outcome);
            Assert.IsTrue(rig.Api.IsCurrent(result));
            Assert.AreEqual(1, rig.Transport.Requests.Count);
        }

        [Test]
        public async Task WrongReceiptIdIsUnreadableNotUnknown()
        {
            var rig = new Rig(); var access = rig.Api.CaptureSettlementAccess(await rig.JoinIntent());
            var reading = rig.Api.ReadSettlementAsync(access, MatchBytes);
            var other = new AccountSettlement("10010203-0405-0607-0809-0a0b0c0d0e0f", AccountSettlementStatus.Unknown);
            rig.Transport.Requests[0].Reply.SetResult(new AccountApiResponse(200, settlement: other));
            var result = await reading;
            Assert.AreEqual(AccountApiFailure.Unreadable, result.Failure);
            Assert.IsNull(result.Settlement);
            Assert.IsTrue(rig.Api.IsCurrent(result));
        }

        [Test]
        public async Task AlreadyCancelledReadAndForeignServiceAccessNeverSend()
        {
            var rig = new Rig(); var peer = new Rig();
            var access = rig.Api.CaptureSettlementAccess(await rig.JoinIntent());
            using (var cancellation = new CancellationTokenSource())
            {
                cancellation.Cancel();
                var cancelled = await rig.Api.ReadSettlementAsync(access, MatchBytes, cancellation.Token);
                Assert.AreEqual(AccountApiFailure.Cancelled, cancelled.Failure);
                Assert.IsTrue(rig.Api.IsCurrent(cancelled));
            }

            var foreign = await peer.Api.ReadSettlementAsync(access, MatchBytes);
            Assert.AreEqual(AccountApiFailure.Stale, foreign.Failure);
            Assert.IsFalse(peer.Api.IsCurrent(foreign));
            Assert.AreEqual(0, rig.Transport.Requests.Count);
            Assert.AreEqual(0, peer.Transport.Requests.Count);
        }

        [Test]
        public async Task CancellationAfterDispatchCannotPublishAReceipt()
        {
            var rig = new Rig(); var access = rig.Api.CaptureSettlementAccess(await rig.JoinIntent());
            using (var cancellation = new CancellationTokenSource())
            {
                var reading = rig.Api.ReadSettlementAsync(access, MatchBytes, cancellation.Token);
                Assert.AreEqual(1, rig.Transport.Requests.Count);
                cancellation.Cancel();
                rig.Transport.Requests[0].Reply.SetResult(new AccountApiResponse(200,
                    settlement: new AccountSettlement(MatchId, AccountSettlementStatus.Committed, AccountSettlementOutcome.Won, 12)));
                var result = await reading;
                Assert.AreEqual(AccountApiFailure.Cancelled, result.Failure);
                Assert.IsNull(result.Settlement);
                Assert.IsTrue(rig.Api.IsCurrent(result));
            }
        }

        [Test]
        public async Task TransportFailureDoesNotTurnIntoUnknownReceipt()
        {
            var rig = new Rig(); var access = rig.Api.CaptureSettlementAccess(await rig.JoinIntent());
            var reading = rig.Api.ReadSettlementAsync(access, MatchBytes);
            rig.Transport.Requests[0].Reply.SetException(new InvalidOperationException("transport failed"));
            var result = await reading;
            Assert.AreEqual(AccountApiFailure.Unavailable, result.Failure);
            Assert.IsNull(result.Settlement);
            Assert.IsTrue(rig.Api.IsCurrent(result));
        }

        [Test]
        public async Task StaleNetworkErrorsAreOwnerFencedToo()
        {
            var rig = new Rig(); var access = rig.Api.CaptureSettlementAccess(await rig.JoinIntent());
            var reading = rig.Api.ReadSettlementAsync(access, MatchBytes);
            rig.Flow.SelectName("Bob");
            rig.Transport.Requests[0].Reply.SetResult(new AccountApiResponse(503, error: new AccountApiError(AccountApiFailure.Unavailable)));
            var result = await reading;
            Assert.AreEqual(AccountApiFailure.Stale, result.Failure);
            Assert.IsNull(result.Settlement);
            Assert.IsFalse(rig.Api.IsCurrent(result));
        }

        [Test]
        public async Task SameNameReopenInvalidatesOldAccessAndResponse()
        {
            var rig = new Rig(); var oldAccess = rig.Api.CaptureSettlementAccess(await rig.JoinIntent());
            var reading = rig.Api.ReadSettlementAsync(oldAccess, MatchBytes);
            rig.Flow.Cancel();
            var replacementIntent = await rig.JoinIntent();
            Assert.IsTrue(rig.Api.IsCurrent(rig.Api.CaptureSettlementAccess(replacementIntent)));
            Assert.IsFalse(rig.Api.IsCurrent(oldAccess), "same name and confirmed credential do not reuse the old owner generation");
            rig.Transport.Requests[0].Reply.SetResult(new AccountApiResponse(200,
                settlement: new AccountSettlement(MatchId, AccountSettlementStatus.Committed, AccountSettlementOutcome.Draw, 8)));
            var result = await reading;
            Assert.AreEqual(AccountApiFailure.Stale, result.Failure);
            Assert.IsNull(result.Settlement);
            Assert.IsFalse(rig.Api.IsCurrent(result));
        }

        [Test]
        public async Task OwnerGenerationChangeFencesLateSuccessAsWellAsLateError()
        {
            var rig = new Rig(); var access = rig.Api.CaptureSettlementAccess(await rig.JoinIntent());
            var reading = rig.Api.ReadSettlementAsync(access, MatchBytes);
            rig.Flow.SelectName("Bob");
            rig.Transport.Requests[0].Reply.SetResult(new AccountApiResponse(200,
                settlement: new AccountSettlement(MatchId, AccountSettlementStatus.Committed, AccountSettlementOutcome.Draw, 8)));
            var result = await reading;
            Assert.AreEqual(AccountApiFailure.Stale, result.Failure);
            Assert.IsNull(result.Settlement);
            Assert.IsFalse(rig.Api.IsCurrent(result));
        }
    }
}

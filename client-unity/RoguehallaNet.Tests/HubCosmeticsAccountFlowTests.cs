using System;
using System.Collections.Generic;
using System.Linq;
using System.Threading;
using System.Threading.Tasks;
using NUnit.Framework;
using Roguehalla.Client;

namespace Roguehalla.Net.Tests
{
    /// <summary>Regression seams used by the hub cosmetics UI: current-owner publication and explicit same-operation retry.</summary>
    public sealed class HubCosmeticsAccountFlowTests
    {
        sealed class Claim
        {
            public string Token;
            public readonly TaskCompletionSource<AccountHttpResponse> Reply = new TaskCompletionSource<AccountHttpResponse>();
        }

        sealed class Sent
        {
            public AccountApiRequest Request;
            public readonly TaskCompletionSource<AccountApiResponse> Reply = new TaskCompletionSource<AccountApiResponse>();
        }

        sealed class Transport : IAccountTransport, IAccountApiTransport
        {
            public readonly List<Claim> Claims = new List<Claim>();
            public readonly List<Sent> Requests = new List<Sent>();
            public Task<AccountHttpResponse> GetProfileAsync(string url, string token, string passcode, CancellationToken cancellation)
            {
                var claim = new Claim { Token = token };
                Claims.Add(claim);
                return claim.Reply.Task;
            }
            public Task<AccountApiResponse> SendAsync(AccountApiRequest request, CancellationToken cancellation)
            {
                var sent = new Sent { Request = request };
                Requests.Add(sent);
                return sent.Reply.Task;
            }
        }

        sealed class CredentialStore : IAccountCredentialStore
        {
            readonly Dictionary<string, string> _tokens = new Dictionary<string, string>();
            public string Read(string scope, string name) => _tokens.TryGetValue(scope + name, out string token) ? token : null;
            public bool WriteConfirmed(string scope, string name, string token) { _tokens[scope + name] = token; return true; }
        }

        sealed class Rig
        {
            public readonly Transport Transport = new Transport();
            public readonly AccountHubFlow Flow;
            public readonly AccountApiService Api;
            public Rig()
            {
                var endpoint = AccountEndpoint.FromPage("https://game.example/", "https://game.example/api");
                Flow = new AccountHubFlow(new AccountSession(endpoint, Transport, new CredentialStore()));
                Api = Flow.CreateApiService(Transport);
            }

            public async Task Read(string name)
            {
                Flow.SelectName(name);
                var read = Api.ReadProfileAsync();
                var claim = Transport.Claims.Last();
                claim.Reply.SetResult(new AccountHttpResponse(200, Reply(name, claim.Token == null, Profile(name))));
                Assert.AreEqual(AccountApiFailure.None, (await read).Failure);
            }
        }

        static AccountFullProfile Profile(string name, long gv = 100, IEnumerable<string> owned = null)
            => new AccountFullProfile(name, gv, 100, new Dictionary<string, long>(),
                new AccountFullStats(0, 0, 0, 0, 0), new AccountFullCosmetics(owned ?? Array.Empty<string>(), new Dictionary<string, string>()),
                new Dictionary<string, long>(), new AccountFullProgress(0, 0, 0, new Dictionary<string, long>(), new Dictionary<string, long>()));

        static AccountReply Reply(string name, bool created, AccountFullProfile profile)
            => new AccountReply
            {
                profile = new AccountProfile
                {
                    name = name, gv = profile.Gv, gvLifetime = profile.GvLifetime,
                    stats = new AccountStats { runs = 0, wins = 0, draws = 0, deaths = 0, kills = 0 },
                },
                token = new string(name == "Bob" ? 'b' : 'a', 64), created = created, FullProfile = profile,
            };

        [Test]
        public async Task ShopRetryIsExplicitAndReusesTheExactUnknownPurchaseOperation()
        {
            var rig = new Rig();
            await rig.Read("Alice");
            var operation = rig.Api.CreatePurchase("skin-bone");
            Guid requestId = operation.Id;

            var firstSend = rig.Api.SendAsync(operation);
            Assert.AreEqual(AccountMutationState.InFlight, operation.State);
            Assert.AreEqual(100, rig.Flow.Snapshot.FullProfile.Gv, "the view must not optimistically subtract catalog cost");
            rig.Transport.Requests[0].Reply.SetResult(new AccountApiResponse(0));
            Assert.AreEqual(AccountApiFailure.Unavailable, (await firstSend).Failure);
            Assert.AreEqual(AccountMutationState.Unknown, operation.State);
            Assert.AreEqual(100, rig.Flow.Snapshot.FullProfile.Gv);
            Assert.IsFalse(rig.Flow.Snapshot.FullProfile.Cosmetics.Owned.Contains("skin-bone"));

            // The user must explicitly invoke retry on this same retained mutation.
            var retry = rig.Api.SendAsync(operation);
            Assert.AreEqual(requestId, rig.Transport.Requests[1].Request.PurchaseId);
            rig.Transport.Requests[1].Reply.SetResult(new AccountApiResponse(200, Profile("Alice", 60, new[] { "skin-bone" })));
            var result = await retry;
            Assert.IsTrue(rig.Api.IsCurrent(result));
            Assert.IsTrue(result.PublishedCurrent);
            Assert.AreEqual(AccountMutationState.Confirmed, operation.State);
            Assert.AreEqual(60, rig.Flow.Snapshot.FullProfile.Gv);
            CollectionAssert.Contains(rig.Flow.Snapshot.FullProfile.Cosmetics.Owned, "skin-bone");
            Assert.AreEqual(requestId, operation.Id);
            Assert.AreEqual(2, rig.Transport.Requests.Count, "no hidden retries are sent by the facade");
        }

        [Test]
        public async Task LateCosmeticMutationResultCannotPublishIntoTheNextSelectedOwner()
        {
            var rig = new Rig();
            await rig.Read("Alice");
            var operation = rig.Api.CreateEquip("skin", "skin-bone");
            var sending = rig.Api.SendAsync(operation);
            var request = rig.Transport.Requests.Single().Request;
            Assert.IsNull(request.PurchaseId);
            Assert.AreEqual("skin", request.Slot);

            rig.Flow.SelectName("Bob");
            rig.Transport.Requests[0].Reply.SetResult(new AccountApiResponse(200, Profile("Alice", 0, new[] { "skin-bone" })));
            var result = await sending;
            Assert.AreEqual(AccountApiFailure.Stale, result.Failure);
            Assert.IsFalse(rig.Api.IsCurrent(result));
            Assert.AreEqual("Bob", rig.Flow.Snapshot.SelectedName);
            Assert.IsNull(rig.Flow.Snapshot.FullProfile);
            Assert.AreEqual(AccountMutationState.Confirmed, operation.State, "stale view results retain operation outcome without publishing it to the new owner");
        }
    }
}

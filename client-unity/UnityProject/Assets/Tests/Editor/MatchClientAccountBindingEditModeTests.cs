using System;
using System.Collections.Generic;
using System.Reflection;
using System.Threading;
using System.Threading.Tasks;
using NUnit.Framework;
using Roguehalla.Client;
using Roguehalla.Net;
using Roguehalla.Net.Protocol;
using UnityEngine;

public sealed class MatchClientAccountBindingEditModeTests
{
    sealed class AccountRequest
    {
        public string Url, Token, Passcode;
        public readonly TaskCompletionSource<AccountHttpResponse> Reply = new TaskCompletionSource<AccountHttpResponse>();
    }

    sealed class AccountTransport : IAccountTransport
    {
        public readonly List<AccountRequest> Requests = new List<AccountRequest>();
        public AccountHttpResponse Immediate;
        public Task<AccountHttpResponse> GetProfileAsync(string url, string ownerToken, string passcode, CancellationToken cancellation)
        {
            var request = new AccountRequest { Url = url, Token = ownerToken, Passcode = passcode };
            Requests.Add(request);
            if (Immediate != null) return Task.FromResult(Immediate);
            return request.Reply.Task;
        }
    }

    sealed class Credentials : IAccountCredentialStore
    {
        public string Read(string endpointScope, string normalizedName) => null;
        public bool WriteConfirmed(string endpointScope, string normalizedName, string token) => false;
    }

    sealed class MatchTransport : ITransport
    {
        public event Action Opened;
        public event Action<byte[]> Received;
        public event Action<string> Closed;
        public readonly List<byte[]> Sent = new List<byte[]>();
        public string Url;
        public void Connect(string url) { Url = url; }
        public void Send(byte[] frame) { Sent.Add(frame); }
        public void Close() { }
        public void Poll() { }
        public void Open() { Opened?.Invoke(); }
        public void Deliver(ServerMsg message) { Received?.Invoke(message.Encode()); }
        public void Drop(string reason = "test") { Closed?.Invoke(reason); }
    }

    sealed class Fixture : IDisposable
    {
        public readonly GameObject Object = new GameObject("MatchClient account binding test");
        public readonly MatchClient Client;
        public readonly AccountCoordinator Owner;
        public readonly AccountTransport Accounts = new AccountTransport();
        public readonly List<MatchTransport> Matches = new List<MatchTransport>();
        public MatchHud Hud;

        public Fixture()
        {
            Client = Object.AddComponent<MatchClient>();
            Client.enabled = false; // Keep Start from constructing production transports or starting a join.
            Client.PageUrl = "https://game.example/play";
            Client.Url = "wss://game.example/ws";
            Client.Profile = "Alice";
            Client.Token = "diagnostic-only-token";
            Owner = Object.AddComponent<AccountCoordinator>();
            Owner.Initialize(AccountEndpoint.FromPage(Client.PageUrl), Accounts, new Credentials());
            typeof(MatchClient).GetField("<AccountOwner>k__BackingField", BindingFlags.Instance | BindingFlags.NonPublic)
                .SetValue(Client, Owner);
            typeof(MatchClient).GetField("_transportFactory", BindingFlags.Instance | BindingFlags.NonPublic)
                .SetValue(Client, new Func<ITransport>(() =>
                {
                    // JoinCore has created the real view here. EditMode does not supply the
                    // normal Play Awake lifecycle; initialize it exactly as the arena fixtures do.
                    var arena = Client.Arena;
                    Assert.That(arena != null, Is.True, "JoinCore creates its ArenaView before the transport");
                    var actors = typeof(Roguehalla.Client.ArenaView).GetField("_actors", BindingFlags.Instance | BindingFlags.NonPublic);
                    var wishes = typeof(Roguehalla.Client.ArenaView).GetField("_wishes", BindingFlags.Instance | BindingFlags.NonPublic);
                    if (actors.GetValue(arena) == null && wishes.GetValue(arena) == null)
                        typeof(Roguehalla.Client.ArenaView).GetMethod("Awake", BindingFlags.Instance | BindingFlags.NonPublic).Invoke(arena, null);
                    Assert.That(actors.GetValue(arena), Is.Not.Null);
                    Assert.That(wishes.GetValue(arena), Is.Not.Null);
                    var t = new MatchTransport(); Matches.Add(t); return t;
                }));
        }

        public void InitializeHud()
        {
            Hud = Object.AddComponent<MatchHud>();
            Hud.Initialize(Client);
            typeof(MatchClient).GetField("<Hud>k__BackingField", BindingFlags.Instance | BindingFlags.NonPublic).SetValue(Client, Hud);
        }

        public void Dispose() { UnityEngine.Object.DestroyImmediate(Object); }
    }

    static AccountHttpResponse Owned(string canonicalName = "Alice")
    {
        return new AccountHttpResponse(200, new AccountReply
        {
            profile = new AccountProfile { name = canonicalName, gv = 5, gvLifetime = 8,
                stats = new AccountStats { runs = 2, wins = 1, draws = 0, deaths = 1, kills = 3 } },
            token = new string('c', 64), created = true,
        });
    }

    static async Task WaitUntil(Func<bool> condition)
    {
        for (int i = 0; i < 100; i++)
        {
            if (condition()) return;
            await Task.Delay(1);
        }
        Assert.Fail("Timed out waiting for account operation continuation.");
    }

    [Test]
    public async Task SelectingFactionDuringDeferredJoinInvalidatesIntentAndCreatesNoSocket()
    {
        using (var f = new Fixture())
        {
            f.Client.Join("Alice", 2);
            Assert.That(f.Owner.Flow.Snapshot.Busy, Is.True);
            Assert.That(f.Accounts.Requests, Has.Count.EqualTo(1));
            f.Client.SelectFaction(3);
            Assert.That(f.Owner.Flow.Snapshot.Busy, Is.False);
            f.Accounts.Requests[0].Reply.SetResult(Owned());
            await Task.Delay(10);
            Assert.That(f.Matches, Is.Empty);
            Assert.That(f.Client.Session, Is.Null);
            Assert.That(f.Client.AccountUiError, Does.Contain("Faction changed"));
        }
    }

    [Test]
    public async Task StaleJoinFailureCannotOverwriteProfileSelectedBySynchronousFlowCallback()
    {
        using (var f = new Fixture())
        {
            bool changed = false;
            Action<AccountHubSnapshot> callback = state =>
            {
                if (!changed && state.State == AccountHubState.PreparingJoin)
                {
                    changed = true;
                    f.Client.SelectProfile("Bob");
                    throw new InvalidOperationException("simulated stale observer failure");
                }
            };
            f.Owner.Flow.Changed += callback;
            f.Client.Join("Alice", 2);
            await Task.Delay(10);
            f.Owner.Flow.Changed -= callback;
            Assert.That(changed, Is.True);
            Assert.That(f.Owner.Flow.Snapshot.SelectedName, Is.EqualTo("Bob"));
            Assert.That(f.Client.AccountUiError, Is.Empty);
            Assert.That(f.Accounts.Requests, Is.Empty);
            Assert.That(f.Matches, Is.Empty);
        }
    }

    [Test]
    public async Task MutatingMatchUrlWhileOwnershipRequestIsPendingCannotUseCapturedIntentOrConnect()
    {
        using (var f = new Fixture())
        {
            f.Client.Join("Alice", 2);
            Assert.That(f.Accounts.Requests, Has.Count.EqualTo(1));
            f.Client.Url = "wss://game.example/changed/ws";
            f.Accounts.Requests[0].Reply.SetResult(Owned());
            await WaitUntil(() => !f.Owner.Flow.Snapshot.Busy);
            await Task.Delay(2);
            Assert.That(f.Matches, Is.Empty);
            Assert.That(f.Client.Session, Is.Null);
            Assert.That(f.Client.AccountUiError, Is.EqualTo("The connection changed. Start your run again."));
        }
    }

    [Test]
    public async Task SuccessfulOrdinaryJoinUsesOwnedCanonicalIdentityTokenAndValidatedUrl()
    {
        using (var f = new Fixture())
        {
            f.InitializeHud();
            // Advance the existing menu visibility policy before binding. The combat controls
            // legitimately stay inactive until a later HUD tick, but their labels still exist.
            typeof(MatchHud).GetMethod("RefreshWorldHudVisibility", BindingFlags.Instance | BindingFlags.NonPublic).Invoke(f.Hud, null);
            var pickup = (UnityEngine.UI.Button)typeof(MatchHud).GetField("_pickup", BindingFlags.Instance | BindingFlags.NonPublic).GetValue(f.Hud);
            Assert.That(pickup.gameObject.activeInHierarchy, Is.False);
            Assert.That(pickup.GetComponentInChildren<TMPro.TMP_Text>() == null, Is.True);
            Assert.That(pickup.GetComponentInChildren<TMPro.TMP_Text>(true), Is.Not.Null);
            f.Client.Url = "wss://game.example/arena/ws";
            f.Accounts.Immediate = Owned("Alice");
            Assert.That(f.Client.IsDiagnostic, Is.False);
            f.Client.Join("alice", 2);
            await WaitUntil(() => f.Matches.Count == 1 && f.Matches[0].Url != null || !string.IsNullOrEmpty(f.Client.AccountUiError));
            Assert.That(f.Client.AccountUiError, Is.Empty, "ordinary Join must finish HUD binding and reach transport.Connect");
            Assert.That(f.Matches.Count, Is.EqualTo(1));
            Assert.That(f.Client.Session, Is.Not.Null);
            Assert.That(f.Matches[0].Url, Is.EqualTo("wss://game.example/arena/ws"));
            f.Matches[0].Open();
            var hello = (ClientMsg.Hello)ClientMsg.Decode(f.Matches[0].Sent[0]);
            Assert.That(hello.Profile, Is.EqualTo("Alice"));
            Assert.That(hello.Faction, Is.EqualTo((byte)2));
            CollectionAssert.AreEqual(System.Text.Encoding.UTF8.GetBytes(new string('c', 64)), hello.Ticket);
            Assert.That(hello.Ticket, Is.Not.EqualTo(System.Text.Encoding.UTF8.GetBytes("diagnostic-only-token")));
        }
    }
}

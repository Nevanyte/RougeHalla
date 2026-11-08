using System;
using System.Collections.Generic;
using System.Threading;
using System.Threading.Tasks;
using NUnit.Framework;
using Roguehalla.Client;
using Roguehalla.Net;
using UnityEngine;

public sealed class AccountCoordinatorEditModeTests
{
    sealed class Transport : IAccountTransport
    {
        public readonly TaskCompletionSource<AccountHttpResponse> Reply = new TaskCompletionSource<AccountHttpResponse>();
        public Task<AccountHttpResponse> GetProfileAsync(string url, string token, string code, CancellationToken cancellation) => Reply.Task;
    }
    sealed class Credentials : IAccountCredentialStore
    {
        public string Read(string scope, string name) => null;
        public bool WriteConfirmed(string scope, string name, string token) => false;
    }

    [Test]
    public async Task HidingAMenuObjectDoesNotDisableTheSeparateAccountOwnerOrDiscardItsClaim()
    {
        var owner = new GameObject("AccountOwnerTest"); var menu = new GameObject("MenuTest");
        try
        {
            var coordinator = owner.AddComponent<AccountCoordinator>(); var transport = new Transport();
            coordinator.Initialize(AccountEndpoint.FromPage("https://local-test.invalid/"), transport, new Credentials());
            var opening = coordinator.Flow.OpenProfileAsync("Alice");
            menu.SetActive(false);
            Assert.That(coordinator.isActiveAndEnabled, Is.True);
            transport.Reply.SetResult(new AccountHttpResponse(200, new AccountReply
            {
                profile = new AccountProfile { name = "Alice", gv = 0, gvLifetime = 0,
                    stats = new AccountStats { runs = 0, wins = 0, draws = 0, deaths = 0, kills = 0 } },
                token = new string('a', 64), created = true,
            }));
            Assert.That(await opening, Is.True);
            Assert.That(coordinator.Snapshot.Recovery, Is.EqualTo(AccountCredentialRecovery.PageLifetimeOnly));
        }
        finally { UnityEngine.Object.DestroyImmediate(menu); UnityEngine.Object.DestroyImmediate(owner); }
    }

    [Test]
    public void AnInitializedOwnerCannotSilentlyReplaceItsEndpointAndLoseOutstandingCredentialRecovery()
    {
        var owner = new GameObject("AccountFixedEndpointTest");
        try
        {
            var coordinator = owner.AddComponent<AccountCoordinator>();
            coordinator.Initialize(AccountEndpoint.FromPage("https://local-test.invalid/"), new Transport(), new Credentials());
            Assert.Throws<InvalidOperationException>(() => coordinator.Initialize(AccountEndpoint.FromPage("https://other-test.invalid/"), new Transport(), new Credentials()));
        }
        finally { UnityEngine.Object.DestroyImmediate(owner); }
    }
}

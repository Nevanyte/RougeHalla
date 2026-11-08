using System;
using Roguehalla.Net;
using UnityEngine;

namespace Roguehalla.Client
{
    /// <summary>
    /// Keep this owner on a persistent main-thread object outside toggled panels. Menu/Leave/Results must not disable it.
    /// Holds only account state; presentation and actual synchronous Join belong to its consumer.
    /// </summary>
    public sealed class AccountCoordinator : MonoBehaviour
    {
        public AccountHubFlow Flow { get; private set; }
        public AccountHubSnapshot Snapshot => Flow?.Snapshot;

        public void Initialize(string pageUrl, string explicitApiBase = null)
        {
            if (Flow != null) throw new InvalidOperationException("The account coordinator is already initialized for this page.");
            AccountEndpoint endpoint = AccountEndpoint.FromPage(pageUrl, explicitApiBase);
            var transport = GetComponent<UnityAccountTransport>();
            if (transport == null) transport = gameObject.AddComponent<UnityAccountTransport>();
            Initialize(endpoint, transport, new PlayerPrefsAccountCredentials());
        }

        /// <summary>Embedding/test injection. The endpoint remains fixed once initialized; never recreate this owner on name changes.</summary>
        public void Initialize(AccountEndpoint endpoint, IAccountTransport transport, IAccountCredentialStore credentials)
        {
            if (Flow != null) throw new InvalidOperationException("The account coordinator is already initialized for this page.");
            Flow = new AccountHubFlow(new AccountSession(endpoint, transport, credentials));
        }

        void OnDestroy() { Flow?.Cancel(); }
    }
}

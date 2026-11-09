using System;
using System.Collections.Generic;
using System.Linq;
using System.Reflection;
using System.Threading;
using System.Threading.Tasks;
using NUnit.Framework;
using Roguehalla.Client;
using Roguehalla.Net;
using UnityEngine;

namespace Roguehalla.Client.Tests
{
    public sealed class HubCosmeticsViewEditModeTests
    {
        sealed class ReadCounterTransport : IAccountTransport, IAccountApiTransport
        {
            public int ProfileReads;
            public int ApiRequests;
            public string OwnerToken = new string('a', 64);
            public Guid? LastPurchaseId;
            public TaskCompletionSource<AccountHttpResponse> NextProfileReply;
            public readonly TaskCompletionSource<AccountApiResponse> ApiReply =
                new TaskCompletionSource<AccountApiResponse>(TaskCreationOptions.RunContinuationsAsynchronously);
            public Task<AccountHttpResponse> GetProfileAsync(string url, string ownerToken, string passcode, CancellationToken cancellation)
            {
                ProfileReads++;
                if (NextProfileReply != null)
                {
                    var pending = NextProfileReply; NextProfileReply = null;
                    return pending.Task;
                }
                return Task.FromResult(OwnedResponse());
            }
            public AccountHttpResponse OwnedResponse() => new AccountHttpResponse(200, new AccountReply
                {
                    profile = new AccountProfile { name = "alice", gv = 500, gvLifetime = 1000,
                        stats = new AccountStats { runs = 0, wins = 0, draws = 0, deaths = 0, kills = 0 } },
                    token = OwnerToken, created = true, FullProfile = FullProfile("alice", Array.Empty<string>())
                });
            public Task<AccountApiResponse> SendAsync(AccountApiRequest request, CancellationToken cancellation)
            { ApiRequests++; LastPurchaseId = request.PurchaseId; return ApiReply.Task; }
        }

        sealed class Credentials : IAccountCredentialStore
        {
            public string Read(string endpointScope, string normalizedName) => null;
            public bool WriteConfirmed(string endpointScope, string normalizedName, string token) => false;
        }

        [Test]
        public void NullOwnerCanInitializeAndShowUnavailableCatalog()
        {
            var root = new GameObject("Cosmetics null-owner root", typeof(RectTransform));
            var viewObject = new GameObject("Cosmetics null-owner view");
            viewObject.transform.SetParent(root.transform, false);
            try
            {
                var view = viewObject.AddComponent<HubCosmeticsView>();
                Assert.DoesNotThrow(() => view.Initialize(root.transform, null));
                view.Show(HubCosmeticsTab.Shop);
                Assert.That(view.IsVisible, Is.True);
                Assert.That(view.Root, Is.Not.Null);
            }
            finally
            {
                UnityEngine.Object.DestroyImmediate(root);
            }
        }

        [Test]
        public void ShowingAndChangingCallsSignDoNotIssueProfileReadsAndRefreshRequiresOwnedProfile()
        {
            var root = new GameObject("Cosmetics read gate root", typeof(RectTransform));
            var ownerObject = new GameObject("Cosmetics read gate owner");
            var viewObject = new GameObject("Cosmetics read gate view");
            viewObject.transform.SetParent(root.transform, false);
            var transport = new ReadCounterTransport();
            try
            {
                var owner = ownerObject.AddComponent<AccountCoordinator>();
                owner.Initialize(AccountEndpoint.FromPage("https://local-test.invalid/"), transport, new Credentials());
                var view = viewObject.AddComponent<HubCosmeticsView>();
                view.Initialize(root.transform, owner);
                view.Show(HubCosmeticsTab.Shop);
                owner.Flow.SelectName("alice");
                owner.Flow.SelectName("alice-2");
                Assert.That(transport.ProfileReads, Is.Zero, "visibility and callsign edits must never open/claim profiles");

                typeof(HubCosmeticsView).GetMethod("RefreshProfile", BindingFlags.Instance | BindingFlags.NonPublic).Invoke(view, null);
                Assert.That(transport.ProfileReads, Is.Zero, "manual refresh must require an already owned profile");
            }
            finally
            {
                UnityEngine.Object.DestroyImmediate(root);
                UnityEngine.Object.DestroyImmediate(ownerObject);
            }
        }

        [Test]
        public void EquipGuardAllowsNullOnlyForAnEquippedSlotAndRequiresOwnershipOtherwise()
        {
            var canSubmit = typeof(HubCosmeticsView).GetMethod("CanSubmitEquip", BindingFlags.Static | BindingFlags.NonPublic);
            var owned = new HashSet<string>(StringComparer.Ordinal) { "blade-blue" };
            var equipped = new Dictionary<string, string>(StringComparer.Ordinal) { ["weapon"] = "blade-blue" };
            Assert.That((bool)canSubmit.Invoke(null, new object[] { "weapon", null, owned, equipped }), Is.True);
            Assert.That((bool)canSubmit.Invoke(null, new object[] { "armor", null, owned, equipped }), Is.False);
            Assert.That((bool)canSubmit.Invoke(null, new object[] { "weapon", "blade-blue", owned, equipped }), Is.True);
            Assert.That((bool)canSubmit.Invoke(null, new object[] { "weapon", "blade-red", owned, equipped }), Is.False);
        }

        [Test]
        public void FocusRestoresTheNewActionWhileTheRetiredSameNamedCardStillExists()
        {
            var content = new GameObject("Content", typeof(RectTransform)).transform;
            var card = new GameObject("Cosmetic_blade-blue", typeof(RectTransform)).transform;
            card.SetParent(content, false);
            var action = new GameObject("Equip", typeof(RectTransform));
            action.transform.SetParent(card, false);
            try
            {
                var capture = typeof(HubCosmeticsView).GetMethod("CaptureCardFocus", BindingFlags.Static | BindingFlags.NonPublic);
                var resolve = typeof(HubCosmeticsView).GetMethod("ResolveCardFocus", BindingFlags.Static | BindingFlags.NonPublic);
                object key = capture.Invoke(null, new object[] { content, action });
                var retire = typeof(HubCosmeticsView).GetMethod("RetireCard", BindingFlags.Static | BindingFlags.NonPublic);
                retire.Invoke(null, new object[] { card.gameObject });
                Assert.That(card.gameObject.activeInHierarchy, Is.True, "a current submit callback may still be finishing");
                Assert.That(card.GetComponent<UnityEngine.UI.LayoutElement>().ignoreLayout, Is.True);
                Assert.That(card.GetComponent<CanvasGroup>().alpha, Is.Zero);
                Assert.That(card.GetComponent<CanvasGroup>().interactable, Is.False);
                Assert.That(card.GetComponent<CanvasGroup>().blocksRaycasts, Is.False);
                var rebuiltCard = new GameObject("Cosmetic_blade-blue", typeof(RectTransform)).transform;
                rebuiltCard.SetParent(content, false);
                var rebuiltAction = new GameObject("Equip", typeof(RectTransform));
                rebuiltAction.transform.SetParent(rebuiltCard, false);

                Assert.That(content.Find("Cosmetic_blade-blue"), Is.SameAs(card), "a hierarchy lookup would still select the old row before end-of-frame destruction");
                var restored = resolve.Invoke(null, new object[] { new List<GameObject> { rebuiltCard.gameObject }, key }) as Transform;
                Assert.That(restored, Is.SameAs(rebuiltAction.transform));
            }
            finally
            {
                UnityEngine.Object.DestroyImmediate(content.gameObject);
            }
        }

        [Test]
        public async Task ExistingOwnedFullProfileCanPurchaseWithoutExtraReadAndShowsPendingBeforeReply()
        {
            var root = new GameObject("Cosmetics existing profile root", typeof(RectTransform));
            var ownerObject = new GameObject("Cosmetics existing profile owner");
            var viewObject = new GameObject("Cosmetics existing profile view");
            viewObject.transform.SetParent(root.transform, false);
            var transport = new ReadCounterTransport();
            try
            {
                var owner = ownerObject.AddComponent<AccountCoordinator>();
                owner.Initialize(AccountEndpoint.FromPage("https://local-test.invalid/"), transport, new Credentials());
                Assert.That(await owner.Flow.OpenProfileAsync("alice"), Is.True);
                Assert.That(owner.Snapshot.FullProfile, Is.Not.Null);
                Assert.That(transport.ProfileReads, Is.EqualTo(1));

                var view = viewObject.AddComponent<HubCosmeticsView>();
                view.Initialize(root.transform, owner);
                var item = new AccountCosmeticDefinition("skin-red", "skin", "Red Mantle", 1, 25, null, null, null, null, null);
                var catalog = (List<AccountCosmeticDefinition>)typeof(HubCosmeticsView)
                    .GetField("_catalog", BindingFlags.Instance | BindingFlags.NonPublic).GetValue(view);
                var catalogById = (Dictionary<string, AccountCosmeticDefinition>)typeof(HubCosmeticsView)
                    .GetField("_catalogById", BindingFlags.Instance | BindingFlags.NonPublic).GetValue(view);
                catalog.Clear(); catalog.Add(item); catalogById.Clear(); catalogById.Add(item.Id, item);
                typeof(HubCosmeticsView).GetField("_catalogLoaded", BindingFlags.Instance | BindingFlags.NonPublic).SetValue(view, true);

                view.Show(HubCosmeticsTab.Shop);
                Assert.That(transport.ProfileReads, Is.EqualTo(1), "showing an already loaded profile must not issue another GET");
                var currentProfile = typeof(HubCosmeticsView).GetMethod("CurrentProfile", BindingFlags.Instance | BindingFlags.NonPublic)
                    .Invoke(view, null) as AccountFullProfile;
                Assert.That(currentProfile, Is.SameAs(owner.Snapshot.FullProfile), "owned snapshot data should be immediately usable without a view read result");

                typeof(HubCosmeticsView).GetMethod("Purchase", BindingFlags.Instance | BindingFlags.NonPublic).Invoke(view, new object[] { item });
                Assert.That(transport.ApiRequests, Is.EqualTo(1));
                var content = (Transform)typeof(HubCosmeticsView).GetField("_content", BindingFlags.Instance | BindingFlags.NonPublic).GetValue(view);
                var button = content.Find("Cosmetic_skin-red/Purchase");
                Assert.That(button, Is.Not.Null);
                Assert.That(button.GetComponentInChildren<TMPro.TMP_Text>().text, Is.EqualTo("REQUEST IN FLIGHT"),
                    "pending state must render immediately while the server reply is delayed");
                transport.ApiReply.TrySetResult(new AccountApiResponse(503));
                await Task.Yield();
            }
            finally
            {
                transport.ApiReply.TrySetResult(new AccountApiResponse(503));
                UnityEngine.Object.DestroyImmediate(root);
                UnityEngine.Object.DestroyImmediate(ownerObject);
            }
        }

        [Test]
        public async Task SameNameCredentialReplacementHidesAndRejectsOldUnknownRetryWithoutLosingHistory()
        {
            var root = new GameObject("Cosmetics replacement root", typeof(RectTransform));
            var ownerObject = new GameObject("Cosmetics replacement owner");
            var viewObject = new GameObject("Cosmetics replacement view");
            viewObject.transform.SetParent(root.transform, false);
            var transport = new ReadCounterTransport();
            try
            {
                var owner = ownerObject.AddComponent<AccountCoordinator>();
                owner.Initialize(AccountEndpoint.FromPage("https://local-test.invalid/"), transport, new Credentials());
                Assert.That(await owner.Flow.OpenProfileAsync("alice"), Is.True);

                var view = viewObject.AddComponent<HubCosmeticsView>();
                view.Initialize(root.transform, owner);
                var item = new AccountCosmeticDefinition("skin-red", "skin", "Red Mantle", 1, 25, null, null, null, null, null);
                var catalog = (List<AccountCosmeticDefinition>)typeof(HubCosmeticsView)
                    .GetField("_catalog", BindingFlags.Instance | BindingFlags.NonPublic).GetValue(view);
                var catalogById = (Dictionary<string, AccountCosmeticDefinition>)typeof(HubCosmeticsView)
                    .GetField("_catalogById", BindingFlags.Instance | BindingFlags.NonPublic).GetValue(view);
                catalog.Clear(); catalog.Add(item); catalogById.Clear(); catalogById.Add(item.Id, item);
                typeof(HubCosmeticsView).GetField("_catalogLoaded", BindingFlags.Instance | BindingFlags.NonPublic).SetValue(view, true);
                view.Show(HubCosmeticsTab.Shop);

                typeof(HubCosmeticsView).GetMethod("Purchase", BindingFlags.Instance | BindingFlags.NonPublic).Invoke(view, new object[] { item });
                Assert.That(transport.ApiRequests, Is.EqualTo(1));
                var entries = (System.Collections.IList)typeof(HubCosmeticsView)
                    .GetField("_mutations", BindingFlags.Instance | BindingFlags.NonPublic).GetValue(view);
                object entry = entries[0];
                var operation = (AccountMutation)entry.GetType().GetField("Operation").GetValue(entry);
                Guid originalId = operation.Id;
                transport.ApiReply.TrySetResult(new AccountApiResponse(503));
                for (int i = 0; i < 8 && operation.State != AccountMutationState.Unknown; i++) await Task.Yield();
                Assert.That(operation.State, Is.EqualTo(AccountMutationState.Unknown));

                owner.Flow.Cancel();
                Assert.That(await owner.Flow.OpenProfileAsync("alice"), Is.True, "reopening with the same confirmed credential should restore ownership");
                Assert.That(owner.Api.IsCurrentOwner(operation), Is.True);
                var sameOwnerSummary = (string)typeof(HubCosmeticsView).GetMethod("MutationSummary", BindingFlags.Instance | BindingFlags.NonPublic)
                    .Invoke(view, new object[] { owner.Snapshot.FullProfile });
                Assert.That(sameOwnerSummary, Does.Contain("Retry resubmits this change"), "same-credential Unknown history remains retryable");

                owner.Flow.Cancel();
                transport.OwnerToken = new string('b', 64);
                Assert.That(await owner.Flow.OpenProfileAsync("alice"), Is.True);
                Assert.That(owner.Api.IsCurrentOwner(operation), Is.False);
                Assert.That(operation.Id, Is.EqualTo(originalId));
                entry.GetType().GetField("Submitting").SetValue(entry, true);
                bool staleInFlight = (bool)typeof(HubCosmeticsView).GetMethod("HasCurrentOwnerMutationInFlight", BindingFlags.Instance | BindingFlags.NonPublic)
                    .Invoke(view, new object[] { "alice" });
                Assert.That(staleInFlight, Is.False, "a same-name request owned by prior credentials cannot block current actions");
                entry.GetType().GetField("Submitting").SetValue(entry, false);
                Assert.That(owner.Api.PendingOperations, Has.Some.Matches<AccountMutationInfo>(op => op.Id == originalId && op.State == AccountMutationState.Unknown),
                    "the uncertain operation and UUID remain available as history");

                int requestsBeforeInvalidRetry = transport.ApiRequests;
                typeof(HubCosmeticsView).GetMethod("Retry", BindingFlags.Instance | BindingFlags.NonPublic).Invoke(view, new object[] { entry });
                Assert.That(transport.ApiRequests, Is.EqualTo(requestsBeforeInvalidRetry), "a stale owner retry must not reach the transport");
                var summary = (string)typeof(HubCosmeticsView).GetMethod("MutationSummary", BindingFlags.Instance | BindingFlags.NonPublic)
                    .Invoke(view, new object[] { owner.Snapshot.FullProfile });
                Assert.That(summary, Is.Null, "a previous credential's status must not describe the replacement profile");
                string rendered = string.Join("\n", view.GetComponentsInChildren<TMPro.TMP_Text>(true).Select(t => t.text));
                Assert.That(rendered.Contains("Retry resubmits this change"), Is.False);
                Assert.That(rendered.Contains(transport.OwnerToken), Is.False, "credentials must never be rendered");
            }
            finally
            {
                transport.ApiReply.TrySetResult(new AccountApiResponse(503));
                UnityEngine.Object.DestroyImmediate(root);
                UnityEngine.Object.DestroyImmediate(ownerObject);
            }
        }

        [Test]
        public async Task UnusableSameNameOwnerClearsWalletAndStatusWithoutDiscardingUnknownPurchase()
        {
            var root = new GameObject("Cosmetics wallet privacy root", typeof(RectTransform));
            var ownerObject = new GameObject("Cosmetics wallet privacy owner");
            var viewObject = new GameObject("Cosmetics wallet privacy view");
            viewObject.transform.SetParent(root.transform, false);
            var transport = new ReadCounterTransport();
            TaskCompletionSource<AccountHttpResponse> pending = null;
            try
            {
                var owner = ownerObject.AddComponent<AccountCoordinator>();
                owner.Initialize(AccountEndpoint.FromPage("https://local-test.invalid/"), transport, new Credentials());
                Assert.That(await owner.Flow.OpenProfileAsync("alice"), Is.True);
                var view = viewObject.AddComponent<HubCosmeticsView>();
                view.Initialize(root.transform, owner);
                var item = new AccountCosmeticDefinition("skin-red", "skin", "Red Mantle", 1, 25, null, null, null, null, null);
                var catalog = (List<AccountCosmeticDefinition>)typeof(HubCosmeticsView)
                    .GetField("_catalog", BindingFlags.Instance | BindingFlags.NonPublic).GetValue(view);
                catalog.Clear(); catalog.Add(item);
                typeof(HubCosmeticsView).GetField("_catalogLoaded", BindingFlags.Instance | BindingFlags.NonPublic).SetValue(view, true);
                view.Show(HubCosmeticsTab.Shop);
                var wallet = view.Root.Find("Wallet").GetComponent<TMPro.TMP_Text>();
                var status = view.Root.Find("CosmeticsStatus").GetComponent<TMPro.TMP_Text>();
                StringAssert.Contains("500", wallet.text);
                typeof(HubCosmeticsView).GetMethod("Purchase", BindingFlags.Instance | BindingFlags.NonPublic).Invoke(view, new object[] { item });
                var entries = (System.Collections.IList)typeof(HubCosmeticsView)
                    .GetField("_mutations", BindingFlags.Instance | BindingFlags.NonPublic).GetValue(view);
                object entry = entries[0];
                var operation = (AccountMutation)entry.GetType().GetField("Operation").GetValue(entry);
                Guid originalId = operation.Id;
                transport.ApiReply.TrySetResult(new AccountApiResponse(503));
                for (int i = 0; i < 100 && (operation.State == AccountMutationState.InFlight || (bool)entry.GetType().GetField("Submitting").GetValue(entry)); i++) await Task.Delay(1);
                Assert.That(operation.State, Is.EqualTo(AccountMutationState.Unknown));
                Assert.That(entry.GetType().GetField("Submitting").GetValue(entry), Is.False);
                Assert.That(transport.LastPurchaseId, Is.EqualTo(originalId));
                StringAssert.Contains("Retry resubmits", status.text);

                owner.Flow.Cancel();
                Assert.That(owner.Snapshot.SelectedName, Is.EqualTo("alice"));
                AssertOwnerDisplayCleared(wallet, status);
                Assert.That(operation.State, Is.EqualTo(AccountMutationState.Unknown));
                Assert.That(transport.ApiRequests, Is.EqualTo(1));

                Assert.That(await owner.Flow.OpenProfileAsync("alice"), Is.True);
                Assert.That(owner.Api.IsCurrentOwner(operation), Is.True);
                StringAssert.Contains("500", wallet.text);
                StringAssert.Contains("Retry resubmits", status.text);
                typeof(HubCosmeticsView).GetMethod("Retry", BindingFlags.Instance | BindingFlags.NonPublic).Invoke(view, new object[] { entry });
                Assert.That(transport.ApiRequests, Is.EqualTo(2), "only the explicit retry submits again");
                Assert.That(transport.LastPurchaseId, Is.EqualTo(originalId));
                for (int i = 0; i < 100 && (operation.State == AccountMutationState.InFlight || (bool)entry.GetType().GetField("Submitting").GetValue(entry)); i++) await Task.Delay(1);
                Assert.That(operation.State, Is.EqualTo(AccountMutationState.Unknown));
                Assert.That(entry.GetType().GetField("Submitting").GetValue(entry), Is.False);

                pending = new TaskCompletionSource<AccountHttpResponse>(); transport.NextProfileReply = pending;
                var reopening = owner.Flow.OpenProfileAsync("alice");
                Assert.That(owner.Snapshot.State, Is.EqualTo(AccountHubState.Opening));
                AssertOwnerDisplayCleared(wallet, status);
                pending.SetResult(new AccountHttpResponse(403));
                Assert.That(await reopening, Is.False);
                Assert.That(owner.Snapshot.State, Is.EqualTo(AccountHubState.Failed));
                AssertOwnerDisplayCleared(wallet, status);

                pending = new TaskCompletionSource<AccountHttpResponse>(); transport.NextProfileReply = pending;
                transport.OwnerToken = new string('b', 64);
                var replacement = owner.Flow.OpenProfileAsync("alice");
                Assert.That(owner.Snapshot.State, Is.EqualTo(AccountHubState.Opening));
                AssertOwnerDisplayCleared(wallet, status);
                pending.SetResult(transport.OwnedResponse());
                Assert.That(await replacement, Is.True);
                Assert.That(owner.Api.IsCurrentOwner(operation), Is.False);
                Assert.That(operation.Id, Is.EqualTo(originalId));
                Assert.That(operation.State, Is.EqualTo(AccountMutationState.Unknown));
                Assert.That(owner.Api.PendingOperations, Has.Some.Matches<AccountMutationInfo>(op => op.Id == originalId && op.State == AccountMutationState.Unknown));
                StringAssert.Contains("500", wallet.text, "only the newly admitted owner's profile restores the wallet");
                Assert.That(status.text, Does.Not.Contain("Retry resubmits"));
                Assert.That(transport.ApiRequests, Is.EqualTo(2));
            }
            finally
            {
                pending?.TrySetResult(new AccountHttpResponse(503));
                transport.ApiReply.TrySetResult(new AccountApiResponse(503));
                UnityEngine.Object.DestroyImmediate(root);
                UnityEngine.Object.DestroyImmediate(ownerObject);
            }
        }

        static void AssertOwnerDisplayCleared(TMPro.TMP_Text wallet, TMPro.TMP_Text status)
        {
            Assert.That(wallet.text, Is.EqualTo("PROFILE · not loaded"));
            Assert.That(status.text, Does.Contain("Load an owned profile"));
            Assert.That(status.text, Does.Not.Contain("Retry resubmits").And.Not.Contain("Saved to your profile"));
        }

        static AccountFullProfile FullProfile(string name, IEnumerable<string> owned) => new AccountFullProfile(name, 500, 1000,
            new Dictionary<string, long>(), new AccountFullStats(0, 0, 0, 0, 0),
            new AccountFullCosmetics(owned, new Dictionary<string, string>()), new Dictionary<string, long>(),
            new AccountFullProgress(0, 0, 0, new Dictionary<string, long>(), new Dictionary<string, long>()));
    }
}

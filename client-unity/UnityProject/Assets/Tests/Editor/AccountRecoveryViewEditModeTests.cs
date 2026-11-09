using System;
using System.Collections.Generic;
using System.Threading;
using System.Threading.Tasks;
using NUnit.Framework;
using Roguehalla.Client;
using Roguehalla.Net;
using TMPro;
using UnityEngine;
using UnityEngine.EventSystems;
using UnityEngine.InputSystem.UI;
using UnityEngine.UI;

namespace Roguehalla.Client.Tests
{
    [ExecuteAlways]
    sealed class AccountRecoveryEditModeEventSystem : EventSystem { }

    public sealed class AccountRecoveryViewEditModeTests
    {
        static readonly string AliceKey = new string('a', 64);
        static readonly string BobKey = new string('b', 64);

        sealed class Claim
        {
            public string PresentedToken;
            public readonly TaskCompletionSource<AccountHttpResponse> Reply = new TaskCompletionSource<AccountHttpResponse>();
        }

        sealed class Transport : IAccountTransport
        {
            public readonly List<Claim> Claims = new List<Claim>();
            public Task<AccountHttpResponse> GetProfileAsync(string url, string ownerToken, string passcode, CancellationToken cancellation)
            {
                var claim = new Claim { PresentedToken = ownerToken };
                Claims.Add(claim);
                return claim.Reply.Task;
            }
        }

        sealed class Credentials : IAccountCredentialStore
        {
            readonly Dictionary<string, string> _tokens = new Dictionary<string, string>();
            public string Read(string scope, string name) => _tokens.TryGetValue(scope + name, out string token) ? token : null;
            public bool WriteConfirmed(string scope, string name, string token) { _tokens[scope + name] = token; return false; }
        }

        GameObject _eventsObject, _ownerObject, _viewObject, _canvasObject;
        EventSystem _previousEvents;
        GameObject _previousSelection;
        AccountCoordinator _owner;
        AccountRecoveryView _view;
        Transport _transport;

        [SetUp]
        public void SetUp()
        {
            _previousEvents = EventSystem.current;
            _previousSelection = _previousEvents != null ? _previousEvents.currentSelectedGameObject : null;
            _eventsObject = new GameObject("Account recovery test EventSystem", typeof(AccountRecoveryEditModeEventSystem), typeof(InputSystemUIInputModule));
            var events = _eventsObject.GetComponent<AccountRecoveryEditModeEventSystem>();
            events.enabled = false;
            events.enabled = true;
            EventSystem.current = events;
            Assert.That(EventSystem.current, Is.SameAs(events), "the recovery test needs its registered EventSystem");

            _transport = new Transport();
            _ownerObject = new GameObject("Account recovery test owner");
            _owner = _ownerObject.AddComponent<AccountCoordinator>();
            _owner.Initialize(AccountEndpoint.FromPage("https://recovery-test.invalid/"), _transport, new Credentials());

            _canvasObject = new GameObject("Recovery test canvas", typeof(RectTransform), typeof(Canvas), typeof(GraphicRaycaster));
            _viewObject = new GameObject("Recovery view host");
            _view = _viewObject.AddComponent<AccountRecoveryView>();
            _view.Initialize(_canvasObject.transform, _owner.Flow, (out string name, out string key) => _owner.TryGetRecoveryKey(out name, out key));
        }

        [TearDown]
        public void TearDown()
        {
            if (_view != null && _view.Root != null) _view.SetVisible(false);
            if (EventSystem.current != null && _eventsObject != null && EventSystem.current.gameObject == _eventsObject)
                EventSystem.current.SetSelectedGameObject(null);
            if (_viewObject != null) UnityEngine.Object.DestroyImmediate(_viewObject);
            if (_canvasObject != null) UnityEngine.Object.DestroyImmediate(_canvasObject);
            if (_ownerObject != null) UnityEngine.Object.DestroyImmediate(_ownerObject);
            if (_eventsObject != null) UnityEngine.Object.DestroyImmediate(_eventsObject);
            Assert.That(_previousEvents == null || EventSystem.current == _previousEvents,
                "destroying the recovery test EventSystem should restore the prior current instance");
            if (_previousEvents != null && _previousSelection != null && _previousSelection.activeInHierarchy)
                _previousEvents.SetSelectedGameObject(_previousSelection);
        }

        [Test]
        public async Task UnownedAndFailedProfilesCannotRevealARecoveryKey()
        {
            var field = KeyField();
            var reveal = Button("RevealKey");
            AssertMaskedAndEmpty(field);
            _view.SetVisible(true);
            Assert.IsFalse(_owner.TryGetRecoveryKey(out _, out _));
            Assert.IsFalse(reveal.interactable);
            reveal.onClick.Invoke();
            Assert.IsFalse(_view.IsRevealed);
            Assert.AreEqual(string.Empty, field.text);

            var opening = _owner.Flow.OpenProfileAsync("Alice");
            _transport.Claims[0].Reply.SetResult(new AccountHttpResponse(403));
            Assert.IsFalse(await opening);
            Assert.AreEqual(AccountHubState.Failed, _owner.Snapshot.State);
            Assert.IsFalse(_owner.TryGetRecoveryKey(out _, out _));
            reveal.onClick.Invoke();
            Assert.IsFalse(_view.IsRevealed);
            AssertMaskedAndEmpty(field);
        }

        [Test]
        public async Task OwnedKeyNeedsRevealAndManualSelectionAndClearsOnCloseSwitchCancelAndBlur()
        {
            string clipboard = null;
            bool canReadClipboard = true;
            try { clipboard = GUIUtility.systemCopyBuffer; } catch { canReadClipboard = false; }

            var opening = _owner.Flow.OpenProfileAsync("Alice");
            _transport.Claims[0].Reply.SetResult(OwnedReply("Alice", AliceKey, true));
            Assert.IsTrue(await opening);
            Assert.IsTrue(_owner.TryGetRecoveryKey(out string ownerName, out string returnedKey));
            Assert.AreEqual("Alice", ownerName);
            Assert.AreEqual(AliceKey, returnedKey);

            var field = KeyField();
            var reveal = Button("RevealKey");
            var select = Button("SelectKey");
            _view.SetVisible(true);
            AssertMaskedAndEmpty(field);
            Assert.IsTrue(reveal.interactable);
            Assert.IsFalse(select.interactable);

            reveal.onClick.Invoke();
            Assert.IsTrue(_view.IsRevealed);
            Assert.AreEqual(TMP_InputField.ContentType.Standard, field.contentType);
            Assert.AreEqual(AliceKey, field.text, "display the key actually returned for the owned profile");
            Assert.IsTrue(select.interactable);
            select.onClick.Invoke();
            Assert.AreSame(field.gameObject, EventSystem.current.currentSelectedGameObject);
            Assert.AreEqual(0, field.selectionStringAnchorPosition);
            Assert.AreEqual(AliceKey.Length, field.selectionStringFocusPosition);
            // TMP activation is deferred to LateUpdate. Its normal select-all may reverse the
            // endpoints; either direction must still select the entire unchanged private key.
            typeof(TMP_InputField).GetMethod("LateUpdate", System.Reflection.BindingFlags.Instance | System.Reflection.BindingFlags.NonPublic).Invoke(field, null);
            Assert.IsTrue(field.isFocused);
            Assert.IsTrue(field.readOnly);
            Assert.AreEqual(AliceKey, field.text);
            Assert.AreEqual(0, Math.Min(field.selectionStringAnchorPosition, field.selectionStringFocusPosition));
            Assert.AreEqual(AliceKey.Length, Math.Max(field.selectionStringAnchorPosition, field.selectionStringFocusPosition));
            if (canReadClipboard) Assert.AreEqual(clipboard, GUIUtility.systemCopyBuffer, "revealing/selecting never copies to clipboard");

            Button("CloseRecovery").onClick.Invoke();
            Assert.IsFalse(_view.IsVisible);
            AssertMaskedAndEmpty(field);
            _view.SetVisible(true);
            AssertMaskedAndEmpty(field);

            reveal.onClick.Invoke();
            Assert.IsTrue(_view.IsRevealed);
            _owner.Flow.SelectName("Bob");
            AssertMaskedAndEmpty(field);

            var bobOpening = _owner.Flow.OpenProfileAsync("Bob");
            _transport.Claims[1].Reply.SetResult(OwnedReply("Bob", BobKey, true));
            Assert.IsTrue(await bobOpening);
            reveal.onClick.Invoke();
            Assert.AreEqual(BobKey, field.text);
            _owner.Flow.Cancel();
            AssertMaskedAndEmpty(field);

            var aliceAgain = _owner.Flow.OpenProfileAsync("Alice");
            Assert.AreEqual(AliceKey, _transport.Claims[2].PresentedToken);
            _transport.Claims[2].Reply.SetResult(OwnedReply("Alice", AliceKey, false));
            Assert.IsTrue(await aliceAgain);
            reveal.onClick.Invoke();
            Assert.AreEqual(AliceKey, field.text);
            typeof(AccountRecoveryView).GetMethod("OnApplicationFocus", System.Reflection.BindingFlags.Instance | System.Reflection.BindingFlags.NonPublic).Invoke(_view, new object[] { false });
            Assert.IsFalse(_view.IsVisible);
            AssertMaskedAndEmpty(field);
            if (canReadClipboard) Assert.AreEqual(clipboard, GUIUtility.systemCopyBuffer, "the view never writes the clipboard automatically");
        }

        TMP_InputField KeyField() => _view.Root.Find("RecoveryCard/RecoveryKey").GetComponent<TMP_InputField>();
        Button Button(string name) => _view.Root.Find("RecoveryCard/" + name).GetComponent<Button>();
        static void AssertMaskedAndEmpty(TMP_InputField field)
        {
            Assert.IsFalse(field.text.Length > 0, "hidden key must be cleared from the input field");
            Assert.AreEqual(TMP_InputField.ContentType.Password, field.contentType);
            Assert.IsTrue(field.readOnly, "the recovery field must remain non-editable");
        }

        static AccountHttpResponse OwnedReply(string name, string key, bool created)
            => new AccountHttpResponse(200, new AccountReply
            {
                profile = new AccountProfile { name = name, gv = 0, gvLifetime = 0,
                    stats = new AccountStats { runs = 0, wins = 0, draws = 0, deaths = 0, kills = 0 } },
                token = key, created = created,
            });
    }
}

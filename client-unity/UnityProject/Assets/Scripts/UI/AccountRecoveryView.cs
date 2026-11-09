using System;
using Roguehalla.Net;
using TMPro;
using UnityEngine;
using UnityEngine.EventSystems;
using UnityEngine.UI;

namespace Roguehalla.Client
{
    public delegate bool RecoveryKeyReader(out string canonicalName, out string key);

    /// <summary>Explicit reveal of the confirmed current owner's existing key. Never logs, exports or copies automatically.</summary>
    public sealed class AccountRecoveryView : MonoBehaviour
    {
        RectTransform _root;
        AccountHubFlow _flow;
        RecoveryKeyReader _readKey;
        TMP_InputField _field;
        TMP_Text _status;
        Button _reveal, _select;
        bool _revealed;
        public RectTransform Root => _root;
        public bool IsVisible => _root != null && _root.gameObject.activeSelf;
        public bool IsRevealed => _revealed;

        public void Initialize(Transform parent, AccountHubFlow flow, RecoveryKeyReader reader)
        {
            _flow = flow; _readKey = reader;
            _root = MythicUi.Panel(parent, "AccountRecoveryOverlay", Vector2.zero, Vector2.one, new Color32(3, 7, 12, 235));
            _root.gameObject.AddComponent<ModalDismissSurface>().Dismiss = () => SetVisible(false);
            var card = MythicUi.Panel(_root, "RecoveryCard", new Vector2(.18f, .20f), new Vector2(.82f, .83f));
            MythicUi.Text(card, "Heading", "RECOVER YOUR CALLSIGN", new Vector2(.05f, .83f), new Vector2(.95f, .98f), 25, ShowcasePalette.Gold);
            MythicUi.Text(card, "Explanation", "Keep your ownership key to sign in on another device. Reveal it only when you are ready to save it privately.", new Vector2(.05f, .61f), new Vector2(.95f, .83f), 16);
            var frame = MythicUi.Panel(card, "RecoveryKey", new Vector2(.05f, .42f), new Vector2(.95f, .60f), ShowcasePalette.Background);
            var viewport = MythicUi.Rect(frame, "Viewport", new Vector2(.02f, .06f), new Vector2(.98f, .94f));
            viewport.gameObject.AddComponent<RectMask2D>();
            var text = MythicUi.Text(viewport, "Value", "", Vector2.zero, Vector2.one, 18);
            text.enableWordWrapping = false; text.enableAutoSizing = false;
            _field = frame.gameObject.AddComponent<TMP_InputField>(); _field.textViewport = viewport;
            _field.textComponent = (TextMeshProUGUI)text; _field.readOnly = true; _field.contentType = TMP_InputField.ContentType.Password;
            _field.lineType = TMP_InputField.LineType.SingleLine;
            _reveal = MythicUi.Button(card, "RevealKey", "REVEAL KEY", new Vector2(.05f, .27f), new Vector2(.48f, .40f), Reveal);
            _select = MythicUi.Button(card, "SelectKey", "SELECT KEY", new Vector2(.52f, .27f), new Vector2(.95f, .40f), SelectKey);
            _status = MythicUi.Text(card, "RecoveryStatus", "", new Vector2(.05f, .13f), new Vector2(.95f, .26f), 14, ShowcasePalette.MutedText);
            MythicUi.Button(card, "CloseRecovery", "CLOSE · ESC", new Vector2(.30f, .01f), new Vector2(.70f, .12f), () => SetVisible(false), MythicUi.ButtonStyle.Quiet);
            if (_flow != null) _flow.Changed += OwnerChanged;
            HideKey(); _root.gameObject.SetActive(false);
        }
        public void SetVisible(bool visible)
        {
            if (_root == null) return;
            HideKey(); _root.gameObject.SetActive(visible);
            if (visible) { _root.SetAsLastSibling(); _reveal.Select(); }
            else if (EventSystem.current != null && EventSystem.current.currentSelectedGameObject != null && EventSystem.current.currentSelectedGameObject.transform.IsChildOf(_root))
                EventSystem.current.SetSelectedGameObject(null);
        }
        void Reveal()
        {
            if (_revealed) { HideKey(); return; }
            if (!IsVisible || _flow?.Snapshot.State != AccountHubState.Owned || _readKey == null || !_readKey(out var name, out var key))
            { HideKey(); _status.text = "Load your owned callsign before revealing its key."; return; }
            _field.contentType = TMP_InputField.ContentType.Standard; _field.text = key; _field.ForceLabelUpdate();
            _revealed = true; _select.interactable = true; _reveal.GetComponentInChildren<TMP_Text>().text = "HIDE KEY";
            _status.text = name + " · Select the key, then copy it with Ctrl+C or Cmd+C. This screen has not saved a backup.";
        }
        void SelectKey()
        {
            if (!_revealed || !IsVisible) return;
            // Re-check the current owner at the explicit action boundary. Do not retain an old key across identity changes.
            if (_readKey == null || !_readKey(out _, out var key) || !string.Equals(_field.text, key, StringComparison.Ordinal)) { HideKey(); return; }
            _field.Select(); _field.ActivateInputField();
            // Raw string positions do not depend on a text mesh having been generated this frame.
            _field.selectionStringAnchorPosition = 0; _field.selectionStringFocusPosition = key.Length;
        }
        void HideKey()
        {
            _revealed = false;
            if (_field != null) { _field.text = ""; _field.contentType = TMP_InputField.ContentType.Password; _field.ForceLabelUpdate(); }
            if (_select != null) _select.interactable = false;
            if (_reveal != null) { _reveal.interactable = _flow?.Snapshot.State == AccountHubState.Owned; _reveal.GetComponentInChildren<TMP_Text>().text = "REVEAL KEY"; }
            if (_status != null) _status.text = _flow?.Snapshot.Recovery == AccountCredentialRecovery.PageLifetimeOnly ?
                "This browser could not persist ownership. Save your key before closing this page." : "Key hidden. Saved browser ownership does not create a backup on another device.";
        }
        void OwnerChanged(AccountHubSnapshot _) => HideKey();
        void OnApplicationFocus(bool focus) { if (!focus) SetVisible(false); }
        void OnDisable() { HideKey(); }
        void OnDestroy() { if (_flow != null) _flow.Changed -= OwnerChanged; HideKey(); }
    }
}

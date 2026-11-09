using System.Collections.Generic;
using Roguehalla.Net;
using TMPro;
using UnityEngine;
using UnityEngine.EventSystems;
using UnityEngine.InputSystem;
using UnityEngine.UI;

namespace Roguehalla.Client
{
    public sealed partial class MatchHud
    {
        sealed class ResumeSelectableState
        {
            public Selectable Selectable;
            public bool Interactable;
        }

        RectTransform _resumeOverlay;
        UnityEngine.UI.Button _resumeButton, _resumeArena, _resumeTraining, _forgetRun, _resumeCancel;
        TMP_Text _resumeHint, _resumeStatusText;
        readonly List<ResumeSelectableState> _resumeDisabledSelectables = new List<ResumeSelectableState>();
        GameObject _resumePreviousSelection;
        string _resumeStatusObserved = "";
        bool _resumePreviousMenuInteractable;

        bool ResumeChooserVisible => _resumeOverlay != null && _resumeOverlay.gameObject.activeSelf;

        void InitializeResumeMenu()
        {
            _resumeButton = Button(_menu, "ResumeRun", "RESUME…", .60f, .82f, .94f, .90f, OpenResumeChooser);

            _resumeOverlay = Panel(_root, "ResumeRunOverlay", 0, 0, 1, 1);
            _resumeOverlay.GetComponent<UnityEngine.UI.Image>().color = new Color32(3, 7, 12, 225);
            var dialog = Panel(_resumeOverlay, "ResumeRunDialog", .22f, .25f, .78f, .76f);
            Text(dialog, "ResumeTitle", "RESUME A SAVED RUN", .07f, .83f, .80f, .97f, 24).color = ShowcasePalette.Gold;
            _resumeCancel = Button(dialog, "ResumeCancel", "CLOSE", .82f, .84f, .95f, .96f, CloseResumeChooser);
            _resumeHint = Text(dialog, "ResumeHint", "Resume checks this tab's saved run. A run may have ended. Load or sign in first.",
                .07f, .67f, .93f, .82f, 16);
            _resumeArena = Button(dialog, "ResumeArena", "RESUME ARENA", .07f, .43f, .48f, .61f,
                () => StartResume(MatchLaunchMode.Arena));
            _resumeTraining = Button(dialog, "ResumeTraining", "RESUME TRAINING", .52f, .43f, .93f, .61f,
                () => StartResume(MatchLaunchMode.Training));
            _forgetRun = Button(dialog, "ForgetSavedRun", "FORGET SAVED RUN", .07f, .19f, .48f, .36f, ForgetCurrentSavedRun);
            _resumeStatusText = Text(dialog, "ResumeStatus", "", .52f, .17f, .93f, .38f, 15);
            _resumeOverlay.gameObject.SetActive(false);
        }

        void OpenResumeChooser()
        {
            if (ResumeChooserVisible) return;
            if (_client == null || _menu == null || !_menu.gameObject.activeSelf || _client.IsDiagnostic ||
                _client.LaunchPending || (_settings != null && _settings.gameObject.activeSelf) ||
                (_signIn != null && _signIn.gameObject.activeSelf) || AnyHubPanelVisible ||
                (_help != null && _help.gameObject.activeSelf) || (_results != null && _results.gameObject.activeSelf)) return;

            CloseHubPanels();
            _resumeDisabledSelectables.Clear();
            var selected = EventSystem.current != null ? EventSystem.current.currentSelectedGameObject : null;
            _resumePreviousSelection = selected;
            _resumePreviousMenuInteractable = _launchMenuInput != null && _launchMenuInput.interactable;
            foreach (var selectable in _root.GetComponentsInChildren<Selectable>(true))
            {
                if (selectable == null || selectable.transform.IsChildOf(_resumeOverlay)) continue;
                _resumeDisabledSelectables.Add(new ResumeSelectableState { Selectable = selectable, Interactable = selectable.interactable });
                selectable.interactable = false;
            }
            if (_launchMenuInput != null) _launchMenuInput.interactable = false;

            _resumeOverlay.gameObject.SetActive(true);
            _resumeOverlay.SetAsLastSibling();
            ConsumeResumeChooserInputUpdate();
            RefreshResumeMenu(_client.AccountFlow?.Snapshot, _client.AccountFlow?.Snapshot?.Busy ?? false,
                _client.LaunchTarget(MatchLaunchMode.Arena), _client.LaunchTarget(MatchLaunchMode.Training));
            var focus = _resumeArena.interactable ? _resumeArena : _resumeTraining.interactable ? _resumeTraining : _resumeCancel;
            if (EventSystem.current != null) EventSystem.current.SetSelectedGameObject(focus.gameObject);
        }

        void CloseResumeChooser()
        {
            if (_resumeOverlay == null || !_resumeOverlay.gameObject.activeSelf) return;
            ConsumeResumeChooserInputUpdate();
            _resumeOverlay.gameObject.SetActive(false);
            if (_launchMenuInput != null)
                _launchMenuInput.interactable = _resumePreviousMenuInteractable && (_client == null || !_client.LaunchPending);
            for (int i = 0; i < _resumeDisabledSelectables.Count; i++)
            {
                var item = _resumeDisabledSelectables[i];
                if (item.Selectable != null) item.Selectable.interactable = item.Interactable;
            }
            _resumeDisabledSelectables.Clear();
            if (EventSystem.current != null)
            {
                var old = _resumePreviousSelection;
                var oldSelectable = old != null ? old.GetComponent<Selectable>() : null;
                EventSystem.current.SetSelectedGameObject(oldSelectable != null && old.activeInHierarchy && oldSelectable.IsInteractable() ? old : null);
            }
            _resumePreviousSelection = null;
            RefreshAccountMenu();
        }

        void StartResume(MatchLaunchMode mode)
        {
            if (_client == null || !_client.CanResumeCurrentRun || _client.ResumeBusy || _client.IsDiagnostic ||
                !SameResumeName(_client.AccountFlow?.Snapshot?.SelectedName, _nickname?.text)) return;
            CloseResumeChooser();
            _showcaseAudio?.UnlockFromUserGesture();
            _client.ResumeCurrentRun(_nickname != null ? _nickname.text : "", _faction, mode);
        }

        void ForgetCurrentSavedRun()
        {
            if (_client == null || !_client.CanForgetSavedRun || _client.ResumeBusy) return;
            ConsumeResumeChooserInputUpdate();
            _client.ForgetSavedRun();
            RefreshResumeMenu(_client.AccountFlow?.Snapshot, _client.AccountFlow?.Snapshot?.Busy ?? false,
                _client.LaunchTarget(MatchLaunchMode.Arena), _client.LaunchTarget(MatchLaunchMode.Training));
        }

        bool ReadResumeChooserInput()
        {
            if (!ResumeChooserVisible) return false;
            var keyboard = Keyboard.current;
            if (keyboard != null && keyboard.escapeKey.wasPressedThisFrame &&
                !keyboard.ctrlKey.isPressed && !keyboard.altKey.isPressed && !keyboard.leftMetaKey.isPressed &&
                !keyboard.rightMetaKey.isPressed && !keyboard.shiftKey.isPressed)
                CloseResumeChooser();
            else if (keyboard != null && keyboard.tabKey.wasPressedThisFrame &&
                !keyboard.ctrlKey.isPressed && !keyboard.altKey.isPressed && !keyboard.leftMetaKey.isPressed && !keyboard.rightMetaKey.isPressed)
            {
                UiFocusNavigation.Cycle(_resumeOverlay, keyboard.shiftKey.isPressed);
                ConsumeResumeChooserInputUpdate();
            }
            else ConsumeResumeChooserInputUpdate();
            UiBrowserStorage.CaptureTab(true, true);
            return true;
        }

        void ConsumeResumeChooserInputUpdate()
        {
            ConsumeTrainingUiUpdate();
            UiBrowserStorage.CaptureTab(true, true);
        }

        void RefreshResumeMenu(AccountHubSnapshot state, bool busy, MatchLaunchTarget arena, MatchLaunchTarget training)
        {
            if (_client == null || _resumeButton == null) return;
            if (ResumeChooserVisible && _launchMenuInput != null) _launchMenuInput.interactable = false;
            bool canOpen = _menu != null && _menu.gameObject.activeSelf && !busy && !_client.LaunchPending && !_client.IsDiagnostic;
            _resumeButton.interactable = canOpen;
            bool canResume = _client.CanResumeCurrentRun && SameResumeName(state?.SelectedName, _nickname?.text) &&
                !_client.ResumeBusy && !busy && !_client.LaunchPending && !_client.IsDiagnostic;
            _resumeArena.interactable = canResume && arena.Available;
            _resumeTraining.interactable = canResume && training.Available;
            _forgetRun.interactable = _client.CanForgetSavedRun && !_client.ResumeBusy && !_client.LaunchPending && !_client.IsDiagnostic;

            if (_resumeHint != null)
            {
                string hint;
                if (_client.ResumeBusy) hint = "Checking this tab's saved run…";
                else if (state == null || state.State != AccountHubState.Owned || !SameResumeName(state.SelectedName, _nickname?.text))
                    hint = "Load or sign in to the selected callsign first. A saved run is not guaranteed to remain available.";
                else if (!canResume) hint = "Resume is unavailable while another launch or session is active.";
                else
                {
                    hint = "Choose Arena or Training. We'll check whether your saved run is still available.";
                    if (!arena.Available) hint += " Arena: " + arena.UnavailableReason;
                    if (!training.Available) hint += " Training: " + training.UnavailableReason;
                }
                if (_resumeHint.text != hint) _resumeHint.text = hint;
            }

            string status = _client.ResumeStatus ?? "";
            if (_resumeStatusText != null && _resumeStatusText.text != status) _resumeStatusText.text = status;
            if (status != _resumeStatusObserved)
            {
                _resumeStatusObserved = status;
                if (!string.IsNullOrEmpty(status) && _session != null && !_menu.gameObject.activeSelf)
                {
                    _feedback = status;
                    _dirty = true;
                }
            }
        }

        static bool SameResumeName(string left, string right)
        {
            if (string.IsNullOrEmpty(left) || string.IsNullOrEmpty(right)) return false;
            try { return AccountEndpoint.NormalizeName(left) == AccountEndpoint.NormalizeName(right); }
            catch (System.ArgumentException) { return false; }
        }
    }
}

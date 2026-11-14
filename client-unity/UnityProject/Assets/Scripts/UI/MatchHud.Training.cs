using Roguehalla.Net;
using Roguehalla.Net.Protocol;
using TMPro;
using UnityEngine;
using UnityEngine.EventSystems;
using UnityEngine.InputSystem;
using UnityEngine.InputSystem.LowLevel;

namespace Roguehalla.Client
{
    public sealed partial class MatchHud
    {
        TrainingConsoleView _trainingConsole;
        bool _trainingWindowFocused = true;
        bool _trainingConsumed;
        uint _trainingConsumedUpdate;
        readonly System.Collections.Generic.List<TMP_Dropdown> _trainingDropdowns = new System.Collections.Generic.List<TMP_Dropdown>();
        public TrainingConsoleView TrainingConsole => _trainingConsole;

        // Input edges and this ownership token share the Input System's update clock.
        // Closing/releasing a control must not reclassify the same edge as world input.
        bool TrainingInputConsumed => _trainingConsumed && _trainingConsumedUpdate == InputState.updateCount;
        bool TrainingOwnsKeyboard => TrainingOwnsKeyboardCore(true);
        bool TrainingOwnsKeyboardCore(bool consoleFocus) => consoleFocus && _trainingConsole?.ContainsFocus == true || ExpandedTrainingDropdown() != null ||
            !_trainingWindowFocused && _client != null && _client.ConfirmedPractice;
        bool TrainingHigherPanelVisible => _menu == null || _menu.gameObject.activeSelf ||
            _results.gameObject.activeSelf || _settings.gameObject.activeSelf ||
            (_signIn?.gameObject.activeSelf ?? false) || AnyHubPanelVisible || PlayerFlowVisible ||
            (_drawer?.IsVisible ?? false) || (_help?.gameObject.activeSelf ?? false) ||
            (_map?.IsOpen ?? false) || (_map?.IsPlanning ?? false);

        void InitializeTrainingConsole()
        {
            _trainingConsole = gameObject.AddComponent<TrainingConsoleView>();
            _trainingConsole.Initialize(_root);
            _trainingConsole.OpenStateChanged += ConsumeTrainingUiUpdate;
        }

        void RefreshTrainingConsole(Session session, ServerMsg.Snapshot accepted)
        {
            // A null client/default Training=false is never an owner confirmation.
            // This method is called only by the real accepted-snapshot subscriber.
            if (!isActiveAndEnabled || !_trainingWindowFocused || _client == null || session == null ||
                !ReferenceEquals(_session, session) || !ReferenceEquals(_client.Session, session) ||
                !ReferenceEquals(session.Latest, accepted) || !_client.ConfirmedPractice ||
                session.State != SessionState.InMatch || session.LastResult != null || TrainingHigherPanelVisible)
            { UnbindTrainingSession(); return; }
            _trainingConsole?.Bind(session);
            _trainingConsole?.SetLaunchContext(session, session.TimelineEpoch, MatchLaunchMode.Training);
        }

        public void UnbindTrainingSession()
        {
            if (_trainingConsole == null) return;
            if (_trainingConsole.IsOpen || _trainingConsole.ContainsFocus) ConsumeTrainingUiUpdate();
            _trainingConsole.Bind(null);
        }

        void SuspendTrainingForPanel()
        {
            if (_client != null && _client.ConfirmedPractice) ConsumeTrainingUiUpdate();
            UnbindTrainingSession();
        }

        public void RestoreUiFocusAfterWindowGain()
        {
            _trainingWindowFocused = true;
            // No cached fact reopens/rearms the console. Await a new accepted snapshot.
        }

        void ConsumeTrainingUiUpdate()
        {
            _trainingConsumed = true;
            _trainingConsumedUpdate = InputState.updateCount;
        }

        static bool BareTrainingEscape(Keyboard keys) => keys != null && keys.escapeKey.wasPressedThisFrame &&
            !keys.ctrlKey.isPressed && !keys.altKey.isPressed && !keys.leftMetaKey.isPressed &&
            !keys.rightMetaKey.isPressed && !keys.shiftKey.isPressed;

        TMP_Dropdown ExpandedTrainingDropdown()
        {
            if (_trainingConsole?.IsOpen != true) return null;
            // TMP may place the popup outside the control's subtree. Ownership follows
            // the expanded control, not the transient option's transform parent.
            _trainingDropdowns.Clear();
            _trainingConsole.Root.GetComponentsInChildren(false, _trainingDropdowns);
            foreach (var dropdown in _trainingDropdowns) if (dropdown.IsExpanded) return dropdown;
            return null;
        }

        bool ReadTrainingEscape(Keyboard keys, bool typingAtStart)
        {
            if (_client != null && _client.EscapeConsumedByAim) return false; // this Esc only closed the Frost Wall aim
            if (!BareTrainingEscape(keys) || TrainingHigherPanelVisible || _chestFocus) return false;

            // A control's popup owns Escape before its surrounding console does.
            var dropdown = ExpandedTrainingDropdown();
            if (dropdown != null)
            { dropdown.Hide(); ConsumeTrainingUiUpdate(); return true; }
            if (_trainingConsole?.HandleEscape() == true)
            { ConsumeTrainingUiUpdate(); return true; }

            // Preserve the original RaidScene/Training console behavior: after the
            // console hands focus back, a later bare Escape leaves confirmed practice.
            if (!typingAtStart && _trainingWindowFocused && _client != null && _client.ConfirmedPractice &&
                ReferenceEquals(_client.Session, _session))
            { ConsumeTrainingUiUpdate(); _client.Leave(); return true; }
            return false;
        }
    }
}

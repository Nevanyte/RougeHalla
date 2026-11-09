from pathlib import Path
import difflib
repo=Path(__file__).resolve().parent/'repo';d=repo/'docs/ui';patch=[]
changes={
'client-unity/UnityProject/Assets/Scripts/UI/MatchHud.cs':[
 ('        MatchClient _client;','        MatchClient _client;\n        TrainingConsoleView _trainingConsole;'),
 ('            scaler.referenceResolution = new Vector2(1920, 1080); scaler.matchWidthOrHeight = .5f;','            scaler.referenceResolution = new Vector2(1920, 1080); scaler.matchWidthOrHeight = .5f;\n            _trainingConsole = gameObject.AddComponent<TrainingConsoleView>();\n            _trainingConsole.Initialize(_root);'),
 ('            Unbind(); _session = session;','            Unbind(); _session = session;\n            _trainingConsole?.Bind(session);'),
 ('        void Unbind()\n        {','        void Unbind()\n        {\n            _trainingConsole?.Bind(null);')],
'client-unity/UnityProject/Assets/Scripts/UI/MatchHud.Accounts.cs':[
 ('            if (!ReferenceEquals(_session, session)) return;\n            bool pending = _client != null && _client.LaunchPending;', '            if (!ReferenceEquals(_session, session)) return;\n            if (session != null) _trainingConsole?.SetLaunchContext(session, session.TimelineEpoch,\n                _client != null && ReferenceEquals(_client.Session, session) && _client.ConfirmedPractice\n                    ? (MatchLaunchMode?)MatchLaunchMode.Training : null);\n            bool pending = _client != null && _client.LaunchPending;')],
'client-unity/UnityProject/Assets/Scripts/UI/MatchHud.Features.cs':[
 ('        bool _chestFocus, _chestConsumedDigits;','        bool _chestFocus, _chestConsumedDigits;\n        bool _trainingEscapeConsumed;'),
 ('public bool BlocksKeyboardInput => (_client != null && _client.LaunchPending)', 'public bool BlocksKeyboardInput => _trainingEscapeConsumed || (_trainingConsole?.ContainsFocus ?? false) || (_client != null && _client.LaunchPending)'),
 ('                if (_chestFocus) return _rewards;','                if (_trainingConsole?.ContainsFocus == true) return _trainingConsole.IsOpen ? _trainingConsole.Panel : _trainingConsole.Root;\n                if (_chestFocus) return _rewards;'),
 ('            var kb = Keyboard.current;\n            // Recovery', '            var kb = Keyboard.current;\n            _trainingEscapeConsumed = false;\n            if (kb != null && kb.escapeKey.wasPressedThisFrame && !kb.ctrlKey.isPressed && !kb.altKey.isPressed &&\n                !kb.leftMetaKey.isPressed && !kb.rightMetaKey.isPressed && !kb.shiftKey.isPressed &&\n                !AnyHubPanelVisible && !_settings.gameObject.activeSelf && !_menu.gameObject.activeSelf &&\n                !_results.gameObject.activeSelf && !PlayerFlowVisible && !(_drawer?.IsVisible ?? false) &&\n                !(_help?.gameObject.activeSelf ?? false) && !(_signIn?.gameObject.activeSelf ?? false) &&\n                _trainingConsole?.HandleEscape() == true)\n            { _trainingEscapeConsumed = true; return; }\n            // Recovery'),
 ('            TickPlayerFlows();','            TickPlayerFlows();\n            _trainingConsole?.Refresh();')]
}
for path,replacements in changes.items():
 old=(repo/path).read_text();new=old
 for before,after in replacements:
  assert new.count(before)==1,(path,before,new.count(before));new=new.replace(before,after)
 patch.extend(difflib.unified_diff(old.splitlines(True),new.splitlines(True),fromfile='a/'+path,tofile='b/'+path))
(d/'TRAINING_CONSOLE_INTEGRATION_PROPOSAL.patch').write_text(''.join(patch))
print('Unapplied proposal generated; shared files were not edited.')

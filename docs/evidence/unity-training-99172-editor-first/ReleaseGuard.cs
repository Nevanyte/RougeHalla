using UnityEditor;
AssetDatabase.AllowAutoRefresh();
return new {refreshGuardReleased=true,playing=EditorApplication.isPlaying,compiling=EditorApplication.isCompiling};

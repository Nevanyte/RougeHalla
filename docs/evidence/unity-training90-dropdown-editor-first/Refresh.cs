using UnityEditor;
AssetDatabase.AllowAutoRefresh();
AssetDatabase.Refresh(ImportAssetOptions.ForceSynchronousImport);
return new {refreshGuardReleased=true,playing=EditorApplication.isPlaying,compiling=EditorApplication.isCompiling};

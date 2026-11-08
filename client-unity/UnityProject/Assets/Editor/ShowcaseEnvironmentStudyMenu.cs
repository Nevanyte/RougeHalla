using UnityEditor;
using UnityEngine;
using Roguehalla.Client;

namespace Roguehalla.Editor
{
    [InitializeOnLoad]
    public static class ShowcaseEnvironmentStudyMenu
    {
        const string PendingKey = "Roguehalla.EnvironmentStudyPreview";
        const string CatalogPath = "Assets/Art/Derived/FlareExpansion/AssetReadiness.asset";

        static ShowcaseEnvironmentStudyMenu()
        {
            EditorApplication.playModeStateChanged += Entered;
        }

        [MenuItem("Roguehalla/Art/Play Environment Study")]
        public static void Play()
        {
            if (EditorApplication.isPlayingOrWillChangePlaymode) return;
            if (AssetDatabase.LoadAssetAtPath<AssetReadinessCatalog>(CatalogPath) == null)
            {
                Debug.LogError("Import the staged Flare expansion before opening the environment study.");
                return;
            }
            SessionState.SetBool(PendingKey, true);
            SessionState.SetString("Roguehalla.ArtPreviewQuery", "?preview=1");
            EditorApplication.isPlaying = true;
        }

        static void Entered(PlayModeStateChange state)
        {
            if (state != PlayModeStateChange.EnteredPlayMode || !SessionState.GetBool(PendingKey, false)) return;
            SessionState.EraseBool(PendingKey);
            var originalStudy = GameObject.Find("Presentation study");
            if (originalStudy != null) Object.DestroyImmediate(originalStudy);
            var originalArena = GameObject.Find("Presentation study arena");
            if (originalArena != null) Object.DestroyImmediate(originalArena);
            Camera camera = Camera.main;
            if (camera == null)
            {
                Debug.LogError("Environment study did not find the workshop camera.");
                return;
            }
            var stagedCatalog = AssetDatabase.LoadAssetAtPath<AssetReadinessCatalog>(CatalogPath);
            var root = new GameObject("Staged Environment Study");
            root.AddComponent<ShowcaseEnvironmentStudy>().Initialize(camera, stagedCatalog);
        }
    }
}

using UnityEditor;
using UnityEngine;
using Roguehalla.Client;

namespace Roguehalla.Editor
{
    [InitializeOnLoad]
    public static class AssetReadinessPreviewMenu
    {
        const string PendingKey = "Roguehalla.AssetReadinessPreview";
        const string CatalogPath = "Assets/Art/Derived/FlareExpansion/AssetReadiness.asset";
        static AssetReadinessPreviewMenu() { EditorApplication.playModeStateChanged += Entered; }

        [MenuItem("Roguehalla/Art/Play Asset Readiness Workshop")]
        public static void Play()
        {
            if (EditorApplication.isPlayingOrWillChangePlaymode) return;
            if (AssetDatabase.LoadAssetAtPath<AssetReadinessCatalog>(CatalogPath) == null)
            {
                Debug.LogError("Run Roguehalla/Art/Import Flare Expansion first."); return;
            }
            SessionState.SetBool(PendingKey, true);
            // Reuse the existing no-network bootstrap path, then replace only its staged study root.
            SessionState.SetString("Roguehalla.ArtPreviewQuery", "?preview=1");
            EditorApplication.isPlaying = true;
        }

        static void Entered(PlayModeStateChange state)
        {
            if (state != PlayModeStateChange.EnteredPlayMode || !SessionState.GetBool(PendingKey, false)) return;
            SessionState.EraseBool(PendingKey);
            var study = GameObject.Find("Presentation study");
            if (study != null) Object.DestroyImmediate(study);
            var arena = GameObject.Find("Presentation study arena");
            if (arena != null) Object.DestroyImmediate(arena);
            var camera = Camera.main;
            if (camera == null) { Debug.LogError("No workshop camera found."); return; }
            var catalog = AssetDatabase.LoadAssetAtPath<AssetReadinessCatalog>(CatalogPath);
            new GameObject("Asset Readiness Workshop").AddComponent<AssetReadinessPreview>().Initialize(camera, catalog);
        }
    }
}

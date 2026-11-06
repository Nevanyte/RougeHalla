// Reproducible entry points for the skeleton scene and Web player.
using System.IO;
using UnityEditor;
using UnityEditor.SceneManagement;
using UnityEditor.Build;
using UnityEditor.Build.Reporting;
using UnityEngine;

namespace Roguehalla.Editor
{
    public static class RhBuild
    {
        const string ScenePath = "Assets/Scenes/Main.unity";

        // Separate preparation entry point so package import completes before the build invocation.
        public static void PrepareUiResources()
        {
            if (File.Exists("Assets/TextMesh Pro/Resources/TMP Settings.asset"))
            {
                FinishUiImport();
                return;
            }
            // ImportPackage completes on later Editor updates. Run this entry without -quit.
            AssetDatabase.importPackageCompleted += _ => FinishUiImport();
            AssetDatabase.importPackageFailed += (_, reason) =>
            {
                Debug.LogError("TMP resource import failed: " + reason);
                if (Application.isBatchMode) EditorApplication.Exit(1);
            };
            AssetDatabase.importPackageCancelled += _ =>
            {
                Debug.LogError("TMP resource import cancelled");
                if (Application.isBatchMode) EditorApplication.Exit(1);
            };
            TMPro.TMP_PackageResourceImporter.ImportResources(true, false, false);
        }

        static void FinishUiImport()
        {
            bool ready = AssetDatabase.LoadAssetAtPath<TMPro.TMP_Settings>("Assets/TextMesh Pro/Resources/TMP Settings.asset") != null
                && AssetDatabase.LoadAssetAtPath<TMPro.TMP_FontAsset>("Assets/TextMesh Pro/Resources/Fonts & Materials/LiberationSans SDF.asset") != null;
            Debug.Log(ready ? "TMP HUD resources ready" : "TMP HUD resources missing after import");
            if (Application.isBatchMode) EditorApplication.Exit(ready ? 0 : 1);
        }

        [MenuItem("Roguehalla/Create Main Scene")]
        public static void CreateScene()
        {
            Directory.CreateDirectory("Assets/Scenes");
            var scene = EditorSceneManager.NewScene(NewSceneSetup.EmptyScene, NewSceneMode.Single);
            EditorSceneManager.SaveScene(scene, ScenePath);
            EditorBuildSettings.scenes = new[] { new EditorBuildSettingsScene(ScenePath, true) };
        }

        [MenuItem("Roguehalla/Build Web (WebGL)")]
        public static void BuildWeb()
        {
            if (Roguehalla.Client.BakedContent.Hash == 0)
                throw new BuildFailedException("Run Tools/build-web.sh against rh-server /info to bake its content hash before building.");
            if (AssetDatabase.LoadAssetAtPath<TMPro.TMP_Settings>("Assets/TextMesh Pro/Resources/TMP Settings.asset") == null
                || AssetDatabase.LoadAssetAtPath<TMPro.TMP_FontAsset>("Assets/TextMesh Pro/Resources/Fonts & Materials/LiberationSans SDF.asset") == null)
                throw new BuildFailedException("Run RhBuild.PrepareUiResources before building the HUD.");
            if (!File.Exists(ScenePath)) CreateScene();
            // Plain static hosting: no Brotli/Gzip (needs Content-Encoding headers) and no threads (need COOP/COEP headers).
            PlayerSettings.WebGL.compressionFormat = WebGLCompressionFormat.Disabled;
            PlayerSettings.WebGL.threadsSupport = false;
            PlayerSettings.WebGL.decompressionFallback = false;
            PlayerSettings.SetUseDefaultGraphicsAPIs(BuildTarget.WebGL, true); // WebGL2 baseline
            var report = BuildPipeline.BuildPlayer(new BuildPlayerOptions { scenes = new[] { ScenePath }, locationPathName = "Build/Web", target = BuildTarget.WebGL, options = BuildOptions.None });
            Debug.Log("WebGL build: " + report.summary.result + " -> Build/Web; bytes=" + report.summary.totalSize);
            if (report.summary.result != BuildResult.Succeeded)
                throw new BuildFailedException("WebGL build failed: " + report.summary.result);
        }
    }
}

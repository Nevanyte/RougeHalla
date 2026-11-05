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

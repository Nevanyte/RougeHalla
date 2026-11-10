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
            PlayerSettings.WebGL.template = "PROJECT:Roguehalla";
            PlayerSettings.SetUseDefaultGraphicsAPIs(BuildTarget.WebGL, true); // WebGL2 baseline
            // StreamingAssets are packed into Web.data on WebGL. The region audio must stay out of the first-load data and be fetched
            // on demand, so the folder is moved out of the project for the build and copied next to the player afterwards.
            RestoreAudioIfInterrupted();
            bool moved = MoveAudioAside();
            BuildReport report;
            try
            {
                report = BuildPipeline.BuildPlayer(new BuildPlayerOptions { scenes = new[] { ScenePath }, locationPathName = "Build/Web", target = BuildTarget.WebGL, options = BuildOptions.None });
                if (report.summary.result == BuildResult.Succeeded && moved) CopyAudio();
            }
            finally { if (moved) RestoreAudio(); }
            Debug.Log("WebGL build: " + report.summary.result + " -> Build/Web; bytes=" + report.summary.totalSize);
            if (report.summary.result != BuildResult.Succeeded)
                throw new BuildFailedException("WebGL build failed: " + report.summary.result);
            CopyNotices();
        }

        const string AudioDir = "Assets/StreamingAssets/Audio", AudioAside = "Temp/AudioAside";
        static bool MoveAudioAside()
        {
            if (!Directory.Exists(AudioDir)) return false;
            Directory.CreateDirectory("Temp");
            if (Directory.Exists(AudioAside)) Directory.Delete(AudioAside, true);
            if (File.Exists(AudioAside + ".meta")) File.Delete(AudioAside + ".meta");
            Directory.Move(AudioDir, AudioAside);
            if (File.Exists(AudioDir + ".meta")) File.Move(AudioDir + ".meta", AudioAside + ".meta");
            AssetDatabase.Refresh();
            return true;
        }
        static void RestoreAudio()
        {
            if (!Directory.Exists(AudioAside) || Directory.Exists(AudioDir)) return;
            Directory.Move(AudioAside, AudioDir);
            if (File.Exists(AudioAside + ".meta")) File.Move(AudioAside + ".meta", AudioDir + ".meta");
            AssetDatabase.Refresh();
        }
        static void RestoreAudioIfInterrupted() { RestoreAudio(); }
        static void CopyAudio()
        {
            const string destination = "Build/Web/StreamingAssets/Audio";
            Directory.CreateDirectory(destination);
            foreach (var file in Directory.GetFiles(AudioAside, "*.ogg")) File.Copy(file, Path.Combine(destination, Path.GetFileName(file)), true);
        }

        static void CopyNotices()
        {
            const string destination = "Build/Web/Licenses";
            Directory.CreateDirectory(destination);
            foreach (var pair in new[]
            {
                new[] { "../../LICENSE", "Roguehalla-MIT.txt" },
                new[] { "Assets/Art/ThirdParty/Flare/Raw/LICENSE.txt", "Flare-CC-BY-SA-3.0.txt" },
                new[] { "Assets/Art/ThirdParty/Flare/Raw/CREDITS.txt", "Flare-Credits.txt" },
                new[] { "Assets/Art/ThirdParty/Flare/Audio/NOTICE.txt", "Flare-Audio-Notice.txt" },
                new[] { "Assets/Art/ThirdParty/Fonts/OFL-CinzelDecorative.txt", "CinzelDecorative-OFL.txt" },
                new[] { "Assets/Art/ThirdParty/Fonts/OFL-Nunito.txt", "Nunito-OFL.txt" },
                new[] { "Assets/Art/ThirdParty/Audio/Atmosphere-Audio-Credits.txt", "Atmosphere-Audio-Credits.txt" },
                new[] { "../THIRD_PARTY_ASSETS.md", "Third-Party-Assets.md" },
                new[] { "Assets/TextMesh Pro/License.Unity.md", "Unity-Companion.md" },
                new[] { "Assets/TextMesh Pro/Fonts/LiberationSans - OFL.txt", "LiberationSans-OFL.txt" },
                new[] { "Assets/TextMesh Pro/Sprites/EmojiOne Attribution.txt", "EmojiOne-Attribution.txt" },
            }) if (File.Exists(pair[0])) File.Copy(pair[0], Path.Combine(destination, pair[1]), true);
        }
    }
}

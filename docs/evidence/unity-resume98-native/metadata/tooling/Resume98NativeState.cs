using System;
using System.Diagnostics;
using System.IO;
using Newtonsoft.Json.Linq;
using UnityEditor;
using UnityEngine;
using System.Collections.Generic;
using System.Linq;
using System.Reflection;
using System.Security.Cryptography;
using UnityEditor.PackageManager;
using UnityEditor.SceneManagement;
using UnityEngine.SceneManagement;
using UnityEngine.EventSystems;
using UnityEngine.InputSystem;
using UnityEngine.Rendering.Universal;


internal sealed class Fixture
{
    internal readonly string TypeName, AssetPath, SourceSha256, MetaSha256, Guid;
    internal Fixture(string typeName, string assetPath, string sourceSha256, string metaSha256, string guid)
    { TypeName = typeName; AssetPath = assetPath; SourceSha256 = sourceSha256; MetaSha256 = metaSha256; Guid = guid; }
}

internal static class Resume98ObserverContext
{
    internal const string ExpectedProjectPath = "/Users/nevinmckinnon/.codex/tools/rougehalla-stage2/return-cleanup-2026-11-08/unity-resume98-isolated/repo/client-unity/UnityProject";
    internal const string ExpectedEditorBinaryPath = "/Applications/Unity/Hub/Editor/6000.0.85f2/Unity.app/Contents/MacOS/Unity";
    internal const string FinalSourceSha = "6d5d9340a6b9f425a17d7ea4488b49291fff3dc1";
    internal const string ContractSourceSnapshot = "1bf48a8109249ec36497eab5b1ffc5548a384dd5";
    internal const string ContractSha256 = "6bfa787e4f63be11fc8a1d51879f30cfc7617f4d7d51883afc60a28a7ef8870e";
    internal const string SourcePinsSha256 = "72ab2814479574ed1c159a1a6af077f86b8c6870eaccb86c20ab97ea49312a1c";
    internal const int ExpectedEditorPid = 46583;
    internal const int ForbiddenEditorPid = 9075;
    internal const string DiscoveryOutputPath = "/Users/nevinmckinnon/.codex/tools/rougehalla-stage2/return-cleanup-2026-11-08/unity-resume98-isolated/run-02/evidence/discovered-cases.json";
    internal static readonly Fixture[] Fixtures = new Fixture[]
    {
        new Fixture("MatchLaunchEditModeTests", "Assets/Tests/Editor/MatchLaunchEditModeTests.cs", "1df70730e10dd3a3ea82365cd88db15a2fa631f313d4b168cbdbfe47e5c3323a", "8acab4f6bfac7f69d1d75a36eb4013e2202fe3567749fa49fca9ede4abeed365", "fcfb3901a322446bbd5299b1e19524d6"),
        new Fixture("MatchSettlementEditModeTests", "Assets/Tests/Editor/MatchSettlementEditModeTests.cs", "14687029f4673d872ad7bb4e089abcf8cd519c95375f432e145db0948d53824a", "37bb54f6e6eebe078359fc9b3cc4533942ff9fc8525fe0c9bf1958dab2b26745", "974cc763730f4c7daa0ad5e2a62a01a6"),
        new Fixture("Roguehalla.Client.Tests.PlayerFlowsEditModeTests", "Assets/Tests/Editor/PlayerFlowsEditModeTests.cs", "d3b75829d5fb35708b328eeaa95d3975c0369cc287195db330dfbe2a7bb11c26", "04c5f186600e28ada6ea8cecdd2f7be79b5cb21f1abeec8a8dce0242e642123e", "2695dbaec0cf4aa3b68c217e1e45dd55"),
        new Fixture("Roguehalla.Client.Tests.QuestJournalViewEditModeTests", "Assets/Tests/Editor/QuestJournalViewEditModeTests.cs", "a227e72035a95c76998a8e715eea197e54bf28de37ade69998404830186a9508", "fbf0d2abab7d153e486a3ebe28f86196f290df10a6c0d3da03e5fab70a2110a5", "629434afa706419fbb9172e17b76ce43"),
        new Fixture("Roguehalla.Client.Tests.TraderDialogViewEditModeTests", "Assets/Tests/Editor/TraderDialogViewEditModeTests.cs", "74f08af89ac872699567c2fe7ecc5451bdc3ffa94f6df48ec60abda813bb66cb", "5dbe763a1b42575f08e6837a4e35ff5bfde5735ce102d50757e90e5a32c9f5c8", "fbeed4975d944443b6c6f34fe85c6d32"),
        new Fixture("Roguehalla.Client.Tests.TrainingConsoleIntegrationEditModeTests", "Assets/Tests/Editor/TrainingConsoleIntegrationEditModeTests.cs", "5d66e3f396212856aa85f2c994343781afd22d68b6b5790d42f6c169aab51eac", "29a4cd6768735b57d79594c53d9327201198f9fda234da09f6519ad81ab95fea", "37a43674d2454878b81ca310a4347f64"),
        new Fixture("Roguehalla.Client.Tests.TrainingConsoleSelectorsEditModeTests", "Assets/Tests/Editor/TrainingConsoleSelectorsEditModeTests.cs", "0dbb264aa1f0f00dda1b00e048578719fd11a3475be951e20e3d4884715bccbc", "e2a816f2d458db792331864a4a8f2762bd8f64b48e45dbdf47cc6aace71e9a27", "1990e91c7892488ca41c9b6c7ddf48d5"),
        new Fixture("Roguehalla.Client.Tests.TrainingConsoleViewEditModeTests", "Assets/Tests/Editor/TrainingConsoleViewEditModeTests.cs", "5f53aca82a3ed6a9706c64d477573f3d1ad3825bb6cb0344f8fd2523145223b1", "51ca8c3104d7f3f46d0ab54b8fb79ea806ce6886c9bee5353b00c62476de612b", "5a969452231445798af516800137f354"),
        new Fixture("Roguehalla.Client.Tests.MatchResumeEditModeTests", "Assets/Tests/Editor/MatchResumeEditModeTests.cs", "e4619b124d858c54efa4f0006004100b683eca6ba35ca3649c5b7c0efbf0eb8c", "985fd6d6d20ace2ec95d08e2ddaca98c43ccfd7620321cff4372a09ed25eb3cc", "a6b41f96d0e4485cbf7e25e9096ec813")
    };

    internal static JObject Build()
    {
        AssertEnvironment();
        string project = Path.GetFullPath(Directory.GetParent(Application.dataPath).FullName);
        int pid;
        string processPath;
        using (var process = Process.GetCurrentProcess())
        {
            pid = process.Id;
            processPath = process.MainModule == null ? null : process.MainModule.FileName;
        }
        return new JObject
        {
            ["projectPath"] = project,
            ["editorPid"] = pid,
            ["unityVersion"] = Application.unityVersion,
            ["editorBinaryPath"] = processPath == null ? null : Path.GetFullPath(processPath),
            ["editorApplicationPath"] = EditorApplication.applicationPath,
            ["activeBuildTarget"] = EditorUserBuildSettings.activeBuildTarget.ToString(),
            ["sourceSha"] = FinalSourceSha,
            ["contractSourceSnapshot"] = ContractSourceSnapshot,
            ["contractSha256"] = ContractSha256,
            ["sourcePinsSha256"] = SourcePinsSha256,
            ["isCompiling"] = EditorApplication.isCompiling,
            ["isUpdating"] = EditorApplication.isUpdating,
            ["isPlaying"] = EditorApplication.isPlaying || EditorApplication.isPlayingOrWillChangePlaymode
        };
    }

    internal static void AssertEnvironment()
    {
        string project = Path.GetFullPath(Directory.GetParent(Application.dataPath).FullName);
        int pid;
        string processPath;
        using (var process = Process.GetCurrentProcess())
        {
            pid = process.Id;
            processPath = process.MainModule == null ? null : process.MainModule.FileName;
        }
        if (!string.Equals(project, ExpectedProjectPath, StringComparison.Ordinal))
            throw new InvalidOperationException("Resume98 observer project path mismatch.");
        if (pid != ExpectedEditorPid || pid == ForbiddenEditorPid)
            throw new InvalidOperationException("Resume98 observer Editor PID mismatch or forbidden Editor PID.");
        if (!string.Equals(Application.unityVersion, "6000.0.85f2", StringComparison.Ordinal))
            throw new InvalidOperationException("Resume98 observer Unity version mismatch.");
        if (string.IsNullOrEmpty(processPath) || !string.Equals(Path.GetFullPath(processPath), ExpectedEditorBinaryPath, StringComparison.Ordinal))
            throw new InvalidOperationException("Resume98 observer Editor executable path mismatch.");
        if (EditorUserBuildSettings.activeBuildTarget != BuildTarget.WebGL)
            throw new InvalidOperationException("Resume98 observer active build target is not WebGL.");
        if (EditorApplication.isCompiling || EditorApplication.isUpdating || EditorApplication.isPlaying || EditorApplication.isPlayingOrWillChangePlaymode)
            throw new InvalidOperationException("Resume98 observer requires an idle, stopped Editor.");
    }
}
// External, read-only Editor observer for the Resume98 gate.
// Source only: do not invoke or compile outside the coordinator's approved flow.

public static class Resume98PackagesAndBaseline
{
    public static JObject Run()
    {
        Resume98ObserverContext.AssertEnvironment();
        var context = Resume98ObserverContext.Build();
        return new JObject
        {
            ["context"] = context,
            ["packages"] = PackageSnapshot(),
            ["frameworkAssemblies"] = FrameworkAssemblies(),
            ["baseline"] = Baseline()
        };
    }

    private static JArray PackageSnapshot()
    {
        var result = new JArray();
        var packages = PackageInfo.GetAllRegisteredPackages() ?? Array.Empty<PackageInfo>();
        foreach (var p in packages.OrderBy(x => x.name, StringComparer.Ordinal))
        {
            string jsonPath = string.IsNullOrEmpty(p.resolvedPath) ? null : Path.Combine(p.resolvedPath, "package.json");
            string source = p.source.ToString();
            bool? officialRegistry = p.source == PackageSource.Registry && p.registry != null
                ? (bool?)p.registry.isDefault : (bool?)null;
            result.Add(new JObject
            {
                ["name"] = p.name,
                ["version"] = p.version,
                ["source"] = source,
                ["resolvedPath"] = p.resolvedPath,
                ["packageJsonPath"] = jsonPath,
                ["packageJsonSha256"] = HashFileIfPresent(jsonPath),
                ["officialDefaultRegistry"] = officialRegistry
            });
        }
        return result;
    }

    private static JObject FrameworkAssemblies()
    {
        var assemblies = AppDomain.CurrentDomain.GetAssemblies()
            .Where(a => !a.IsDynamic)
            .ToArray();
        var result = new JObject();
        AddAssembly(result, "client", assemblies.FirstOrDefault(a => a.GetName().Name == "Roguehalla.Client"));
        AddAssembly(result, "net", assemblies.FirstOrDefault(a => a.GetName().Name == "RoguehallaNet"));
        AddAssembly(result, "tests", assemblies.FirstOrDefault(a => a.GetName().Name == "Roguehalla.Client.EditModeTests"));

        Assembly runner = typeof(UnityEditor.TestTools.TestRunner.Api.TestRunnerApi).Assembly;
        Assembly nunit = typeof(NUnit.Framework.TestAttribute).Assembly;
        result["testRunnerApiAssembly"] = AssemblyRecord(runner);
        result["testRunnerApiPackage"] = PackageRecord(PackageInfo.FindForAssembly(runner));
        result["nunitAssembly"] = AssemblyRecord(nunit);
        result["nunitPackage"] = PackageRecord(PackageInfo.FindForAssembly(nunit));
        return result;
    }

    private static void AddAssembly(JObject parent, string key, Assembly assembly)
    {
        parent[key] = AssemblyRecord(assembly);
        parent[key + "Package"] = PackageRecord(assembly == null ? null : PackageInfo.FindForAssembly(assembly));
    }

    private static JObject AssemblyRecord(Assembly assembly)
    {
        if (assembly == null) return new JObject { ["present"] = false };
        string location = SafeLocation(assembly);
        return new JObject
        {
            ["present"] = true,
            ["fullName"] = assembly.FullName,
            ["moduleMvid"] = assembly.ManifestModule.ModuleVersionId.ToString("D"),
            ["location"] = location,
            ["fileSha256"] = HashFileIfPresent(location)
        };
    }

    private static JObject PackageRecord(PackageInfo p)
    {
        if (p == null) return new JObject { ["present"] = false };
        string packageJson = string.IsNullOrEmpty(p.resolvedPath) ? null : Path.Combine(p.resolvedPath, "package.json");
        return new JObject
        {
            ["present"] = true,
            ["name"] = p.name,
            ["version"] = p.version,
            ["source"] = p.source.ToString(),
            ["resolvedPath"] = p.resolvedPath,
            ["packageJsonSha256"] = HashFileIfPresent(packageJson),
            ["officialDefaultRegistry"] = p.source == PackageSource.Registry && p.registry != null ? (JToken)new JValue(p.registry.isDefault) : JValue.CreateNull()
        };
    }

    private static JObject Baseline()
    {
        var scenes = new JArray();
        int sceneRootCount = 0;
        for (int i = 0; i < SceneManager.sceneCount; i++)
        {
            Scene scene = SceneManager.GetSceneAt(i);
            GameObject[] roots = scene.IsValid() && scene.isLoaded ? scene.GetRootGameObjects() : Array.Empty<GameObject>();
            sceneRootCount += roots.Length;
            scenes.Add(new JObject
            {
                ["name"] = scene.name,
                ["path"] = scene.path,
                ["isLoaded"] = scene.isLoaded,
                ["isDirty"] = scene.isDirty,
                ["rootCount"] = roots.Length,
                ["roots"] = new JArray(roots.Select(r => new JObject
                {
                    ["name"] = r.name,
                    ["active"] = r.activeSelf,
                    ["instanceId"] = r.GetInstanceID()
                }))
            });
        }
        Scene active = SceneManager.GetActiveScene();
        var dirty = DirtyCounts();
        var windows = new JArray(Resources.FindObjectsOfTypeAll<EditorWindow>()
            .Where(w => w != null)
            .OrderBy(w => w.GetType().FullName, StringComparer.Ordinal)
            .Select(w => new JObject
            {
                ["type"] = w.GetType().FullName,
                ["title"] = w.titleContent == null ? null : w.titleContent.text,
                ["x"] = w.position.x,
                ["y"] = w.position.y,
                ["width"] = w.position.width,
                ["height"] = w.position.height,
                ["hasFocus"] = w.hasFocus
            }));
        var events = SceneComponents<EventSystem>().Select(x => new JObject
        {
            ["name"] = x.gameObject.name,
            ["scene"] = x.gameObject.scene.name,
            ["active"] = x.isActiveAndEnabled
        });
        var lights = SceneComponents<Light2D>().Select(x => new JObject
        {
            ["name"] = x.gameObject.name,
            ["scene"] = x.gameObject.scene.name,
            ["active"] = x.isActiveAndEnabled,
            ["lightType"] = x.lightType.ToString(),
            ["intensity"] = x.intensity,
            ["color"] = x.color.ToString()
        });
        var devices = new JArray(InputSystem.devices.Select(d => new JObject
        {
            ["name"] = d.name,
            ["layout"] = d.layout,
            ["deviceId"] = d.deviceId,
            ["enabled"] = d.enabled,
            ["added"] = d.added
        }));
        var inputSettings = InputSystem.settings;
        var prefs = new JObject
        {
            ["rh.ui.profile.present"] = PlayerPrefs.HasKey("rh.ui.profile"),
            ["roguehalla.showcase.textScale.present"] = PlayerPrefs.HasKey("roguehalla.showcase.textScale"),
            ["rh.ui.minimapScale.present"] = PlayerPrefs.HasKey("rh.ui.minimapScale")
        };

        return new JObject
        {
            ["scenes"] = scenes,
            ["sceneCount"] = SceneManager.sceneCount,
            ["sceneRootCount"] = sceneRootCount,
            ["activeScene"] = new JObject { ["name"] = active.name, ["path"] = active.path, ["isLoaded"] = active.isLoaded, ["isDirty"] = active.isDirty },
            ["editorSceneSetup"] = new JArray(EditorSceneManager.GetSceneManagerSetup().Select(s => new JObject { ["path"] = s.path, ["isLoaded"] = s.isLoaded, ["isActive"] = s.isActive })),
            ["dirtyCounts"] = dirty,
            ["editorWindows"] = windows,
            ["eventSystems"] = new JArray(events),
            ["light2DInstances"] = new JArray(lights),
            ["input"] = new JObject
            {
                ["activeInputHandler"] = PlayerSettings.activeInputHandler.ToString(),
                ["updateMode"] = inputSettings == null ? null : inputSettings.updateMode.ToString(),
                ["backgroundBehavior"] = inputSettings == null ? null : inputSettings.backgroundBehavior.ToString(),
                ["devices"] = devices
            },
            ["authorizedPreferenceKeyPresenceOnly"] = prefs
        };
    }

    private static JObject DirtyCounts()
    {
        int dirtyObjects = 0, dirtyAssets = 0, dirtySceneObjects = 0;
        var byType = new SortedDictionary<string, int>(StringComparer.Ordinal);
        foreach (UnityEngine.Object obj in Resources.FindObjectsOfTypeAll<UnityEngine.Object>())
        {
            if (obj == null || !EditorUtility.IsDirty(obj)) continue;
            dirtyObjects++;
            string type = obj.GetType().FullName ?? obj.GetType().Name;
            byType[type] = byType.TryGetValue(type, out int count) ? count + 1 : 1;
            if (AssetDatabase.Contains(obj)) dirtyAssets++;
            else if (obj is Component c && c.gameObject.scene.IsValid() || obj is GameObject g && g.scene.IsValid()) dirtySceneObjects++;
        }
        var grouped = new JObject();
        foreach (var kv in byType) grouped[kv.Key] = kv.Value;
        return new JObject { ["loadedDirtyObjectCount"] = dirtyObjects, ["loadedDirtyAssetCount"] = dirtyAssets, ["loadedDirtySceneObjectCount"] = dirtySceneObjects, ["loadedDirtyByType"] = grouped };
    }

    private static IEnumerable<T> SceneComponents<T>() where T : Component
    {
        return Resources.FindObjectsOfTypeAll<T>().Where(c => c != null && c.gameObject.scene.IsValid() && c.gameObject.scene.isLoaded);
    }

    private static string SafeLocation(Assembly assembly)
    {
        try { return assembly.Location; } catch { return null; }
    }

    private static string HashFileIfPresent(string path)
    {
        if (string.IsNullOrEmpty(path) || !File.Exists(path)) return null;
        using (var sha = SHA256.Create())
        using (var stream = File.OpenRead(path))
            return BitConverter.ToString(sha.ComputeHash(stream)).Replace("-", "").ToLowerInvariant();
    }
}

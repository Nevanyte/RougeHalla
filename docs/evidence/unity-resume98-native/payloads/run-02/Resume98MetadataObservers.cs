using System;
using System.Diagnostics;
using System.IO;
using Newtonsoft.Json.Linq;
using UnityEditor;
using UnityEngine;
using System.Linq;
using System.Reflection;
using System.Collections.Generic;
using System.Globalization;
using System.Text;
using System.Threading.Tasks;
using Newtonsoft.Json;
using UnityEditor.TestTools.TestRunner.Api;


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


public static class Resume98Identity
{
    public static JObject Run()
    {
        var context = Resume98ObserverContext.Build();
        var results = new JArray();
        foreach (var fixture in Resume98ObserverContext.Fixtures)
        {
            var script = AssetDatabase.LoadAssetAtPath<MonoScript>(fixture.AssetPath);
            var type = script == null ? null : script.GetClass();
            if (script == null || type == null) throw new InvalidOperationException("Fixture script did not load: " + fixture.TypeName);
            string actualGuid = AssetDatabase.AssetPathToGUID(fixture.AssetPath);
            if (!string.Equals(actualGuid, fixture.Guid, StringComparison.Ordinal))
                throw new InvalidOperationException("Fixture GUID mismatch: " + fixture.TypeName);
            var methods = type.GetMethods(BindingFlags.Public | BindingFlags.Instance | BindingFlags.DeclaredOnly)
                .Where(m => m.GetCustomAttributesData().Any(a =>
                    a.AttributeType.FullName == "NUnit.Framework.TestAttribute" ||
                    a.AttributeType.FullName == "NUnit.Framework.TestCaseAttribute" ||
                    a.AttributeType.FullName == "NUnit.Framework.TestCaseSourceAttribute"))
                .Select(m => m.Name).Distinct().OrderBy(x => x, StringComparer.Ordinal).ToArray();
            results.Add(new JObject
            {
                ["fixtureType"] = fixture.TypeName,
                ["sourcePath"] = fixture.AssetPath,
                ["sourceSha256"] = fixture.SourceSha256,
                ["metaSha256"] = fixture.MetaSha256,
                ["expectedGuid"] = fixture.Guid,
                ["loadedType"] = type.FullName,
                ["importedPath"] = AssetDatabase.GetAssetPath(script),
                ["guid"] = actualGuid,
                ["assembly"] = type.Assembly.FullName,
                ["mvid"] = type.Module.ModuleVersionId.ToString("D"),
                ["methods"] = new JArray(methods)
            });
        }
        var productionScript = AssetDatabase.LoadAssetAtPath<MonoScript>("Assets/Scripts/Net/MatchClient.cs");
        return new JObject
        {
            ["schema"] = "resume98-loaded-identity/1",
            ["sourceSha"] = Resume98ObserverContext.FinalSourceSha,
            ["context"] = context,
            ["compiling"] = EditorApplication.isCompiling,
            ["updating"] = EditorApplication.isUpdating,
            ["loadedProduction"] = new JObject
            {
                ["type"] = typeof(Roguehalla.Client.MatchClient).FullName,
                ["assembly"] = typeof(Roguehalla.Client.MatchClient).Assembly.FullName,
                ["mvid"] = typeof(Roguehalla.Client.MatchClient).Module.ModuleVersionId.ToString("D"),
                ["path"] = "Assets/Scripts/Net/MatchClient.cs",
                ["guid"] = AssetDatabase.AssetPathToGUID("Assets/Scripts/Net/MatchClient.cs"),
                ["sourceSha256"] = "1449fcd431d37fced802da4d63bd46a8c00e0ae7b275f17ee9f27e06f2585553",
                ["scriptLoaded"] = productionScript != null
            },
            ["results"] = results
        };
    }
}


public static class Resume98MethodSignatures
{
    public static JObject Run()
    {
        var context = Resume98ObserverContext.Build();
        var results = new JArray();
        foreach (var fixture in Resume98ObserverContext.Fixtures)
        {
            var script = AssetDatabase.LoadAssetAtPath<MonoScript>(fixture.AssetPath);
            var type = script == null ? null : script.GetClass();
            if (type == null) throw new InvalidOperationException("Fixture type did not load: " + fixture.TypeName);
            var methods = type.GetMethods(BindingFlags.Public | BindingFlags.Instance | BindingFlags.DeclaredOnly)
                .Select(m => new JObject
                {
                    ["name"] = m.Name,
                    ["returnType"] = m.ReturnType.FullName,
                    ["parameters"] = new JArray(m.GetParameters().Select(p => new JObject
                    {
                        ["name"] = p.Name,
                        ["declaredType"] = p.ParameterType.FullName
                    }))
                }).ToArray();
            results.Add(new JObject
            {
                ["type"] = type.FullName,
                ["moduleMvid"] = type.Module.ModuleVersionId.ToString("D"),
                ["methods"] = new JArray(methods)
            });
        }
        return new JObject
        {
            ["schema"] = "resume98-loaded-method-signatures/1",
            ["sourceSha"] = Resume98ObserverContext.FinalSourceSha,
            ["context"] = context,
            ["results"] = results
        };
    }
}


// Public TestRunnerApi discovery only. This class never executes tests or enters Play Mode.
public static class DiscoverResume98Cases
{
    public static async Task Run()
    {
        var context = Resume98ObserverContext.Build();
        var api = ScriptableObject.CreateInstance<TestRunnerApi>();
        var completion = new TaskCompletionSource<bool>();
        try
        {
            api.RetrieveTestList(TestMode.EditMode, root =>
            {
                try
                {
                    Resume98ObserverContext.AssertEnvironment();
                    var cases = new JArray();
                    var modules = new SortedSet<string>(StringComparer.Ordinal);
                    var classMatches = new JObject();
                    foreach (var fixture in Resume98ObserverContext.Fixtures)
                        classMatches[fixture.TypeName.Substring(fixture.TypeName.LastIndexOf('.') + 1)] = new JArray();
                    Visit(root, cases, modules, classMatches);
                    var prefixes = new JArray();
                    foreach (var fixture in Resume98ObserverContext.Fixtures) prefixes.Add(fixture.TypeName + ".");
                    var document = new JObject
                    {
                        ["schema"] = "public-test-discovery-v1",
                        ["mode"] = "EditMode",
                        ["executedTests"] = false,
                        ["sourceSha"] = Resume98ObserverContext.FinalSourceSha,
                        ["context"] = context,
                        ["fixturePrefixes"] = prefixes,
                        ["loadedTestModules"] = new JArray(modules),
                        ["classFilterMatches"] = classMatches,
                        ["caseCount"] = cases.Count,
                        ["cases"] = cases
                    };
                    string outputPath = Resume98ObserverContext.DiscoveryOutputPath;
                    Directory.CreateDirectory(Path.GetDirectoryName(outputPath));
                    using (var stream = new FileStream(outputPath, FileMode.CreateNew, FileAccess.Write, FileShare.None))
                    using (var writer = new StreamWriter(stream, new UTF8Encoding(false)))
                        writer.Write(document.ToString(Formatting.Indented));
                    completion.TrySetResult(true);
                }
                catch (Exception error) { completion.TrySetException(error); }
            });
            await completion.Task;
        }
        finally
        {
            if (api != null) UnityEngine.Object.DestroyImmediate(api);
        }
    }

    private static void Visit(ITestAdaptor node, JArray output, SortedSet<string> modules, JObject classMatches)
    {
        if (node == null) return;
        if (!node.IsSuite && !node.HasChildren)
        {
            foreach (JProperty property in classMatches.Properties())
            {
                string leaf = property.Name;
                if (!string.IsNullOrEmpty(node.FullName) && Resume98ObserverContext.Fixtures.Any(f =>
                    f.TypeName.EndsWith("." + leaf, StringComparison.Ordinal) || f.TypeName == leaf))
                {
                    string fixturePrefix = Resume98ObserverContext.Fixtures.First(f =>
                        f.TypeName.EndsWith("." + leaf, StringComparison.Ordinal) || f.TypeName == leaf).TypeName + ".";
                    if (node.FullName.StartsWith(fixturePrefix, StringComparison.Ordinal))
                        ((JArray)property.Value).Add(node.FullName);
                }
            }
            if (IsRequested(node.FullName)) output.Add(Describe(node, modules));
        }
        var children = node.Children;
        if (children == null) return;
        foreach (var child in children) Visit(child, output, modules, classMatches);
    }

    private static bool IsRequested(string fullName)
    {
        if (string.IsNullOrEmpty(fullName)) return false;
        foreach (var fixture in Resume98ObserverContext.Fixtures)
            if (fullName.StartsWith(fixture.TypeName + ".", StringComparison.Ordinal)) return true;
        return false;
    }

    private static JObject Describe(ITestAdaptor test, SortedSet<string> modules)
    {
        var method = test.Method;
        var reflectedMethod = PublicPropertyValue(method, "MethodInfo") as MethodInfo;
        var declaringType = reflectedMethod == null ? null : reflectedMethod.DeclaringType;
        var module = reflectedMethod == null ? null : reflectedMethod.Module;
        if (module != null) modules.Add(module.Name + ":" + module.ModuleVersionId.ToString("D"));
        var args = new JArray();
        foreach (var value in test.Arguments ?? Array.Empty<object>()) args.Add(DescribeArgument(value));
        var attributes = new JArray();
        if (reflectedMethod != null)
        {
            foreach (var attribute in reflectedMethod.GetCustomAttributesData())
            {
                if (attribute.AttributeType.FullName == null ||
                    attribute.AttributeType.FullName.IndexOf("TestCaseAttribute", StringComparison.Ordinal) < 0) continue;
                var metadata = new JObject { ["typeFullName"] = attribute.AttributeType.FullName };
                var ctor = new JArray();
                foreach (var item in attribute.ConstructorArguments)
                    ctor.Add(new JObject
                    {
                        ["typeFullName"] = item.ArgumentType == null ? null : item.ArgumentType.FullName,
                        ["text"] = item.Value == null ? null : Convert.ToString(item.Value, CultureInfo.InvariantCulture)
                    });
                metadata["constructorArguments"] = ctor;
                attributes.Add(metadata);
            }
        }
        return new JObject
        {
            ["fullName"] = test.FullName,
            ["name"] = test.Name,
            ["methodName"] = method == null ? null : method.Name,
            ["methodParameters"] = reflectedMethod == null ? new JArray() : new JArray(Array.ConvertAll(reflectedMethod.GetParameters(),
                p => new JObject { ["name"] = p.Name, ["declaredType"] = p.ParameterType.FullName })),
            ["declaringType"] = declaringType == null ? (test.TypeInfo == null ? null : test.TypeInfo.FullName) : declaringType.FullName,
            ["runState"] = test.RunState.ToString(),
            ["methodModuleMvid"] = module == null ? null : module.ModuleVersionId.ToString("D"),
            ["arguments"] = args,
            ["nUnitTestCaseAttributes"] = attributes
        };
    }

    private static JObject DescribeArgument(object value)
    {
        var result = new JObject { ["typeFullName"] = value == null ? null : value.GetType().FullName, ["text"] = SafeText(value) };
        if (value is bool boolean) result["boolValue"] = boolean;
        if (value != null && value.GetType().IsEnum) result["enumName"] = Enum.GetName(value.GetType(), value);
        if (IsNumeric(value)) result["numericValue"] = JToken.FromObject(value);
        return result;
    }
    private static bool IsNumeric(object value)
    {
        if (value == null) return false;
        switch (Type.GetTypeCode(value.GetType()))
        {
            case TypeCode.Byte: case TypeCode.SByte: case TypeCode.Int16: case TypeCode.UInt16:
            case TypeCode.Int32: case TypeCode.UInt32: case TypeCode.Int64: case TypeCode.UInt64:
            case TypeCode.Single: case TypeCode.Double: case TypeCode.Decimal: return true;
            default: return false;
        }
    }
    private static string SafeText(object value)
    {
        if (value == null) return null;
        try { return Convert.ToString(value, CultureInfo.InvariantCulture); }
        catch { return "<ToString failed>"; }
    }
    private static object PublicPropertyValue(object target, string propertyName)
    {
        if (target == null) return null;
        var property = target.GetType().GetProperty(propertyName, BindingFlags.Instance | BindingFlags.Public);
        return property == null ? null : property.GetValue(target, null);
    }
}

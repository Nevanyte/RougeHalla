using System;
using System.Collections.Generic;
using System.Globalization;
using System.IO;
using System.Linq;
using System.Security.Cryptography;
using System.Text.Json;
using System.Text.Json.Nodes;
using Mono.Cecil;

static string Hash(string path) => Convert.ToHexString(SHA256.HashData(File.ReadAllBytes(path))).ToLowerInvariant();
static object Unwrap(object value)
{
    while (value is CustomAttributeArgument a) value = a.Value;
    return value;
}
static object JsonValue(object value)
{
    value = Unwrap(value);
    if (value == null) return null;
    if (value is CustomAttributeArgument[] array) return array.Select(x => JsonValue(x)).ToArray();
    if (value is System.Collections.IEnumerable seq && value is not string)
    {
        var items = new List<object>(); foreach (var item in seq) items.Add(JsonValue(item)); return items;
    }
    return value switch
    {
        bool b => b,
        byte n => (int)n,
        sbyte n => (int)n,
        short n => (int)n,
        ushort n => (int)n,
        int n => n,
        uint n => n.ToString(CultureInfo.InvariantCulture),
        long n => n.ToString(CultureInfo.InvariantCulture),
        ulong n => n.ToString(CultureInfo.InvariantCulture),
        _ => value.ToString()
    };
}
static string Display(object value)
{
    value = Unwrap(value);
    if (value is bool b) return b ? "True" : "False";
    return Convert.ToString(value, CultureInfo.InvariantCulture) ?? "null";
}
static IEnumerable<TypeDefinition> Flatten(IEnumerable<TypeDefinition> types)
{
    foreach (var type in types)
    {
        yield return type;
        foreach (var nested in Flatten(type.NestedTypes)) yield return nested;
    }
}
static string GuidFromMeta(string path)
{
    var line = File.ReadLines(path).FirstOrDefault(x => x.StartsWith("guid:", StringComparison.Ordinal));
    return line == null ? null : line.Substring("guid:".Length).Trim();
}
static object FileRecord(string repo, string path) => new
{
    path = Path.GetRelativePath(repo, path).Replace(Path.DirectorySeparatorChar, '/'),
    sha256 = Hash(path)
};

if (args.Length != 5) throw new ArgumentException("usage: metadata-extractor <compiled-tests.dll> <prior-typed-contract.json> <public-discovery.json> <repo-root> <output-root>");
var assemblyPath = Path.GetFullPath(args[0]);
var priorContractPath = Path.GetFullPath(args[1]);
var discoveryPath = Path.GetFullPath(args[2]);
var repo = Path.GetFullPath(args[3]);
var outputRoot = Path.GetFullPath(args[4]);
Directory.CreateDirectory(outputRoot);
var sourceRoot = Path.Combine(repo, "client-unity/UnityProject/Assets/Tests/Editor");
var fixtureNames = new[]
{
    "Roguehalla.Client.Tests.QuestJournalViewEditModeTests",
    "Roguehalla.Client.Tests.TraderDialogViewEditModeTests",
    "Roguehalla.Client.Tests.PlayerFlowsEditModeTests",
    "MatchLaunchEditModeTests",
    "MatchSettlementEditModeTests",
    "Roguehalla.Client.Tests.TrainingConsoleSelectorsEditModeTests",
    "Roguehalla.Client.Tests.TrainingConsoleViewEditModeTests",
    "Roguehalla.Client.Tests.TrainingConsoleIntegrationEditModeTests"
};
var oldFixtureNames = fixtureNames.Take(5).ToHashSet(StringComparer.Ordinal);
var newFixtureNames = fixtureNames.Skip(5).ToHashSet(StringComparer.Ordinal);

using var resolver = new DefaultAssemblyResolver();
resolver.AddSearchDirectory(Path.GetDirectoryName(assemblyPath));
using var assembly = AssemblyDefinition.ReadAssembly(assemblyPath, new ReaderParameters { AssemblyResolver = resolver });
var module = assembly.MainModule;
var typeByName = Flatten(module.Types).ToDictionary(t => t.FullName, StringComparer.Ordinal);
var extracted = new Dictionary<string, List<object>>(StringComparer.Ordinal);
var extractedFullNames = new HashSet<string>(StringComparer.Ordinal);
foreach (var fixtureName in fixtureNames)
{
    if (!typeByName.TryGetValue(fixtureName, out var type)) throw new InvalidOperationException("Compiled assembly missing fixture " + fixtureName);
    var cases = new List<object>(); extracted[fixtureName] = cases;
    foreach (var method in type.Methods)
    {
        var attributes = method.CustomAttributes.Where(a => a.AttributeType.FullName is "NUnit.Framework.TestAttribute" or "NUnit.Framework.TestCaseAttribute").ToArray();
        var testCases = attributes.Where(a => a.AttributeType.FullName == "NUnit.Framework.TestCaseAttribute").ToArray();
        if (!attributes.Any(a => a.AttributeType.FullName == "NUnit.Framework.TestAttribute") && testCases.Length == 0) continue;
        var parameters = method.Parameters.Select(p => new { name = p.Name, declaredType = p.ParameterType.FullName }).ToArray();
        if (testCases.Length == 0 && parameters.Length != 0) throw new InvalidOperationException("Test has parameters but no explicit TestCase attributes: " + fixtureName + "." + method.Name);
        var tuples = new List<(object[] args, object[] typed, string[] display)>();
        if (testCases.Length == 0) tuples.Add((Array.Empty<object>(), Array.Empty<object>(), Array.Empty<string>()));
        foreach (var attribute in testCases)
        {
            var constructorArgs = attribute.ConstructorArguments;
            var rawValues = constructorArgs.Select(a => a.Value).ToArray();
            if (constructorArgs.Count == 1 && constructorArgs[0].Value is CustomAttributeArgument[] packed)
                rawValues = packed.Cast<object>().ToArray();
            var rawList = rawValues.Select(Unwrap).ToArray();
            var typed = new List<object>(); var displays = new List<string>();
            for (int i = 0; i < rawList.Length; i++)
            {
                var raw = rawList[i];
                typed.Add(new
                {
                    declaredType = i < parameters.Length ? parameters[i].declaredType : null,
                    attributeValueType = raw?.GetType().FullName ?? "null",
                    value = JsonValue(raw),
                    displayValue = Display(raw)
                });
                displays.Add(Display(raw));
            }
            tuples.Add((rawList, typed.ToArray(), displays.ToArray()));
        }
        foreach (var tuple in tuples)
        {
            var selector = method.Name + (tuple.display.Length > 0 ? "(" + string.Join(",", tuple.display) + ")" : "");
            var fullName = fixtureName + "." + selector;
            if (!extractedFullNames.Add(fullName)) throw new InvalidOperationException("Duplicate compiled NUnit selector " + fullName);
            cases.Add(new
            {
                fixtureType = fixtureName,
                method = method.Name,
                methodReturnType = method.ReturnType.FullName,
                methodParameters = parameters,
                simpleToolLeafSelector = selector,
                fullName,
                selectedArguments = tuple.typed,
                declaredCaseAttributes = testCases.Length == 0 ? Array.Empty<object>() : new[] { "NUnit.Framework.TestCaseAttribute" }
            });
        }
    }
}

var oldContract = JsonNode.Parse(File.ReadAllText(priorContractPath)).AsObject();
var oldDiscovery = JsonNode.Parse(File.ReadAllText(discoveryPath)).AsObject();
var priorFixtures = oldContract["fixtures"].AsObject();
var oldCases = new List<JsonNode>();
foreach (var fixtureName in fixtureNames.Take(5))
{
    if (!priorFixtures.TryGetPropertyValue(fixtureName, out var oldGroup) || oldGroup == null)
        throw new InvalidOperationException("Prior typed contract missing fixture " + fixtureName);
    foreach (var node in oldGroup["cases"].AsArray()) oldCases.Add(node.DeepClone());
}
if (oldCases.Count != 64) throw new InvalidOperationException("Expected exactly 64 prior public cases, found " + oldCases.Count);

var discoveryNames = oldDiscovery["classFilterMatches"].AsObject().SelectMany(group => group.Value.AsArray().Select(x => x.GetValue<string>())).ToHashSet(StringComparer.Ordinal);
var oldContractNames = oldCases.Select(c => c["fullName"].GetValue<string>()).ToHashSet(StringComparer.Ordinal);
if (!oldContractNames.SetEquals(discoveryNames)) throw new InvalidOperationException("Prior typed contract names do not exactly match the public 64-case discovery receipt");
foreach (var oldCase in oldCases)
{
    var fixtureName = oldCase["fixtureType"].GetValue<string>();
    var methodName = oldCase["method"].GetValue<string>();
    bool metadataMatch = extracted[fixtureName].Select(x => JsonSerializer.SerializeToNode(x)).Any(current =>
    {
        if (current["method"].GetValue<string>() != methodName) return false;
        var oldParameters = oldCase["methodParameters"].AsArray();
        var currentParameters = current["methodParameters"].AsArray();
        if (oldParameters.Count != currentParameters.Count) return false;
        for (int i = 0; i < oldParameters.Count; i++)
            if (oldParameters[i]["declaredType"].GetValue<string>() != currentParameters[i]["declaredType"].GetValue<string>() ||
                oldParameters[i]["name"] != null && oldParameters[i]["name"].GetValue<string>() != currentParameters[i]["name"].GetValue<string>()) return false;
        var oldArguments = oldCase["selectedArguments"].AsArray();
        var currentArguments = current["selectedArguments"].AsArray();
        if (oldArguments.Count != currentArguments.Count) return false;
        for (int i = 0; i < oldArguments.Count; i++)
        {
            if (oldArguments[i]["declaredType"].GetValue<string>() != currentArguments[i]["declaredType"].GetValue<string>()) return false;
            var oldValue = oldArguments[i]["value"];
            var currentValue = currentArguments[i]["value"];
            if (oldValue is JsonObject enumValue && enumValue["numericValue"] != null)
            {
                if (enumValue["numericValue"].ToJsonString() != currentValue.ToJsonString()) return false;
            }
            else if (JsonSerializer.Serialize(oldValue) != JsonSerializer.Serialize(currentValue) ||
                oldArguments[i]["displayValue"].GetValue<string>() != currentArguments[i]["displayValue"].GetValue<string>()) return false;
        }
        return true;
    });
    if (!metadataMatch)
        throw new InvalidOperationException("Current compiled method signature/typed arguments differ from prior selector " + oldCase["fullName"].GetValue<string>());
}

var newCases = newFixtureNames.SelectMany(f => extracted[f]).Select(c => JsonSerializer.SerializeToNode(c)).ToList();
if (newCases.Count != 26) throw new InvalidOperationException("Expected exactly 26 compiled new tests, found " + newCases.Count);
if (newCases.Any(c => c["methodParameters"].AsArray().Count != 0 || c["selectedArguments"].AsArray().Count != 0))
    throw new InvalidOperationException("New wiring/editor tests are expected to be parameterless NUnit Test cases");
var combinedCases = oldCases.Concat(newCases).ToList();
if (combinedCases.Count != 90 || combinedCases.Select(c => c["fullName"].GetValue<string>()).Distinct(StringComparer.Ordinal).Count() != 90)
    throw new InvalidOperationException("Combined selectors are not exactly 90 unique fully qualified names");
foreach (var test in combinedCases)
    if (!test["fullName"].GetValue<string>().StartsWith(test["fixtureType"].GetValue<string>() + ".", StringComparison.Ordinal))
        throw new InvalidOperationException("Selector lacks its fixture prefix: " + test["fullName"].GetValue<string>());

var fixtureSources = fixtureNames.Select(fixture =>
{
    var fileName = fixture.Substring(fixture.LastIndexOf('.') + 1) + ".cs";
    var source = Path.Combine(sourceRoot, fileName);
    var meta = source + ".meta";
    return (object)new
    {
        fixtureType = fixture,
        source = FileRecord(repo, source),
        meta = new { path = Path.GetRelativePath(repo, meta).Replace(Path.DirectorySeparatorChar, '/'), sha256 = Hash(meta), guid = GuidFromMeta(meta) }
    };
}).ToArray();

var compiledInputs = new Dictionary<string, string[]>(StringComparer.Ordinal)
{
    ["clientScripts"] = Directory.GetFiles(Path.Combine(repo, "client-unity/UnityProject/Assets/Scripts"), "*.cs", SearchOption.AllDirectories),
    ["protocolNet"] = Directory.GetFiles(Path.Combine(repo, "client-unity/RoguehallaNet/Net"), "*.cs", SearchOption.AllDirectories)
        .Concat(Directory.GetFiles(Path.Combine(repo, "client-unity/RoguehallaNet/Protocol"), "*.cs", SearchOption.AllDirectories)).ToArray(),
    ["editorTests"] = Directory.GetFiles(sourceRoot, "*.cs", SearchOption.AllDirectories),
    ["netTests"] = Directory.GetFiles(Path.Combine(repo, "client-unity/RoguehallaNet.Tests"), "*.cs", SearchOption.AllDirectories)
};
var inputs = compiledInputs.ToDictionary(kv => kv.Key, kv => kv.Value.OrderBy(p => p, StringComparer.Ordinal).Select(p => FileRecord(repo, p)).ToArray(), StringComparer.Ordinal);
var profilePaths = new[]
{
    "/Users/nevinmckinnon/.codex/tools/rougehalla-ui-training-integration-2026-11-09/profiles/editor/Client.csproj",
    "/Users/nevinmckinnon/.codex/tools/rougehalla-ui-training-integration-2026-11-09/profiles/editor/Tests.csproj",
    "/Users/nevinmckinnon/.codex/tools/rougehalla-ui-training-integration-2026-11-09/profiles/player/Client.csproj",
    Path.Combine(repo, "client-unity/RoguehallaNet/RoguehallaNet.csproj"),
    Path.Combine(repo, "client-unity/RoguehallaNet.Tests/RoguehallaNet.Tests.csproj")
};
var profileRecords = profilePaths.Select(p => new { path = p, sha256 = Hash(p) }).ToArray();
var sourceInputs = new
{
    schema = "roguehalla-unity-training-source-inputs/1",
    repository = repo,
    sourceHead = "e0da2de0b5100d979901aa5e20cc3d8f964e0626",
    compileRoots = inputs,
    projectFiles = profileRecords,
    assemblyReferences = new[]
    {
        new { name = "RoguehallaNet.dll", path = Path.Combine(repo, "client-unity/RoguehallaNet/bin/Debug/netstandard2.1/RoguehallaNet.dll"), sha256 = Hash(Path.Combine(repo, "client-unity/RoguehallaNet/bin/Debug/netstandard2.1/RoguehallaNet.dll")) }
    }
};
var sourceInputsPath = Path.Combine(outputRoot, "source-inputs.json");
File.WriteAllText(sourceInputsPath, JsonSerializer.Serialize(sourceInputs, new JsonSerializerOptions { WriteIndented = true }));

var contract = new
{
    schema = "roguehalla-unity-editmode-typed-fixture-contract/2",
    sourceSnapshot = new { worktree = repo, gitHead = "e0da2de0b5100d979901aa5e20cc3d8f964e0626", sourceInputsSha256 = Hash(sourceInputsPath) },
    provenance = new
    {
        prior64 = new
        {
            publicDiscoveryFile = Path.GetRelativePath(repo, discoveryPath).Replace(Path.DirectorySeparatorChar, '/'),
            publicDiscoverySha256 = Hash(discoveryPath),
            priorTypedContractFile = priorContractPath,
            priorTypedContractSha256 = Hash(priorContractPath),
            compiledMetadataCrosscheck = "all 64 names also present in current compiled Editor assembly",
            executedTests = false
        },
        new26 = new
        {
            compiledAssembly = assemblyPath,
            sha256 = Hash(assemblyPath),
            mvid = module.Mvid.ToString("D"),
            mvidScope = "managed assembly metadata only; not native test execution evidence",
            extraction = "Mono.Cecil metadata only; NUnit Test/TestCase attributes and method signatures",
            extractorSource = Path.Combine(outputRoot, "metadata-tools/Program.cs"),
            extractorSourceSha256 = Hash(Path.Combine(outputRoot, "metadata-tools/Program.cs")),
            extractorProject = Path.Combine(outputRoot, "metadata-tools/MetadataExtractor.csproj"),
            extractorProjectSha256 = Hash(Path.Combine(outputRoot, "metadata-tools/MetadataExtractor.csproj")),
            monoCecilAssembly = "/Users/nevinmckinnon/Documents/Projects/RogueHalla-unity-art/client-unity/UnityProject/Library/PackageCache/com.unity.nuget.mono-cecil@ecb9724e46ff/Mono.Cecil.dll",
            monoCecilSha256 = Hash("/Users/nevinmckinnon/Documents/Projects/RogueHalla-unity-art/client-unity/UnityProject/Library/PackageCache/com.unity.nuget.mono-cecil@ecb9724e46ff/Mono.Cecil.dll"),
            testBodiesInvoked = false,
            unityApisInvoked = false
        }
    },
    counts = new
    {
        old64 = oldCases.Count,
        newByFixture = newFixtureNames.ToDictionary(f => f, f => extracted[f].Count, StringComparer.Ordinal),
        total = combinedCases.Count,
        currentCompiledMetadataTotalForEightFixtures = extracted.Values.Sum(c => c.Count)
    },
    fixtureSources,
    cases = combinedCases,
    validation = new
    {
        priorNamesMatchPublicDiscovery = true,
        priorNamesPresentInCurrentCompiledAssembly = true,
        newMethodsExtractedFromCompiledMetadata = newCases.Count,
        allNamesHaveFixturePrefix = true,
        allSelectorsUnique = true,
        executedTests = false
    }
};
var contractPath = Path.Combine(outputRoot, "typed-fixture-contract.json");
File.WriteAllText(contractPath, JsonSerializer.Serialize(contract, new JsonSerializerOptions { WriteIndented = true }));
Console.WriteLine(JsonSerializer.Serialize(new
{
    contractPath,
    contractSha256 = Hash(contractPath),
    sourceInputsPath,
    sourceInputsSha256 = Hash(sourceInputsPath),
    oldCount = oldCases.Count,
    newCount = newCases.Count,
    compiledFixtureCount = extracted.Values.Sum(c => c.Count),
    assemblyHash = Hash(assemblyPath),
    assemblyMvid = module.Mvid.ToString("D")
}));

using System;
using System.Collections.Generic;
using System.Globalization;
using System.IO;
using System.Linq;
using System.Security.Cryptography;
using System.Text.Json;
using System.Text.Json.Nodes;
using Mono.Cecil;
using Mono.Cecil.Cil;

static string Hash(string path) => Convert.ToHexString(SHA256.HashData(File.ReadAllBytes(path))).ToLowerInvariant();
static IEnumerable<TypeDefinition> Flatten(IEnumerable<TypeDefinition> types)
{
    foreach (var type in types) { yield return type; foreach (var nested in Flatten(type.NestedTypes)) yield return nested; }
}
static object Unwrap(object value) { while (value is CustomAttributeArgument a) value = a.Value; return value; }
static CustomAttributeArgument Normalize(CustomAttributeArgument arg) =>
    arg.Type.FullName == "System.Object" && arg.Value is CustomAttributeArgument inner ? inner : arg;
static object JsonValue(object value)
{
    value = Unwrap(value);
    if (value == null) return null;
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
static string EnumName(TypeReference type, object value)
{
    try
    {
        var definition = type.Resolve();
        if (definition != null && definition.IsEnum)
            foreach (var field in definition.Fields)
                if (field.IsStatic && field.HasConstant && Convert.ToInt64(field.Constant, CultureInfo.InvariantCulture) == Convert.ToInt64(value, CultureInfo.InvariantCulture))
                    return field.Name;
    }
    catch { }
    return null;
}
static object CaseValue(CustomAttributeArgument arg)
{
    arg = Normalize(arg);
    var raw = Unwrap(arg.Value);
    var enumName = EnumName(arg.Type, raw);
    if (enumName != null) return new { name = enumName, numericValue = JsonValue(raw) };
    return JsonValue(raw);
}
static string Display(CustomAttributeArgument arg)
{
    arg = Normalize(arg);
    var raw = Unwrap(arg.Value);
    return EnumName(arg.Type, raw) ?? (raw is bool b ? (b ? "True" : "False") : Convert.ToString(raw, CultureInfo.InvariantCulture) ?? "null");
}
static bool SameArgs(JsonArray left, JsonArray right)
{
    if (left.Count != right.Count) return false;
    for (int i = 0; i < left.Count; i++)
    {
        if (left[i]["declaredType"].GetValue<string>() != right[i]["declaredType"].GetValue<string>()) return false;
        var lv = left[i]["value"]; var rv = right[i]["value"];
        if (lv is JsonObject le && le["numericValue"] != null)
        {
            JsonNode currentNumeric = rv is JsonObject re ? re["numericValue"] : rv;
            if (currentNumeric == null || le["numericValue"].ToJsonString() != currentNumeric.ToJsonString()) return false;
            if (rv is JsonObject namedEnum && le["name"].GetValue<string>() != namedEnum["name"].GetValue<string>()) return false;
            continue;
        }
        else if (JsonSerializer.Serialize(lv) != JsonSerializer.Serialize(rv)) return false;
        if (left[i]["displayValue"] != null && right[i]["displayValue"] != null &&
            left[i]["displayValue"].GetValue<string>() != right[i]["displayValue"].GetValue<string>()) return false;
    }
    return true;
}
static string Relative(string root, string path) => Path.GetRelativePath(root, path).Replace(Path.DirectorySeparatorChar, '/');
static object SourceRecord(string repo, string path) => new { path = Relative(repo, path), sha256 = Hash(path) };
static object MethodIl(MethodDefinition method) => new
{
    name = method.FullName,
    instructions = method.HasBody ? method.Body.Instructions.Select(i => new
    {
        offset = i.Offset,
        opcode = i.OpCode.Name,
        operand = i.Operand is MethodReference called ? called.FullName : i.Operand is Instruction target ? "IL_" + target.Offset.ToString("X4") : i.Operand?.ToString()
    }).ToArray() : Array.Empty<object>()
};
static string[] Calls(MethodDefinition method) => method.HasBody
    ? method.Body.Instructions.Where(i => i.OpCode.Code is Code.Call or Code.Callvirt).Select(i => (i.Operand as MethodReference)?.FullName).Where(s => s != null).ToArray()
    : Array.Empty<string>();

if (args.Length != 8) throw new ArgumentException("usage: metadata-audit <repo> <editor-client.dll> <editor-tests.dll> <player-client.dll> <prior-contract.json> <native-selectors.txt> <output-dir> <compile-root>");
var repo = Path.GetFullPath(args[0]);
var editorClientPath = Path.GetFullPath(args[1]);
var editorTestsPath = Path.GetFullPath(args[2]);
var playerClientPath = Path.GetFullPath(args[3]);
var priorPath = Path.GetFullPath(args[4]);
var selectorPath = Path.GetFullPath(args[5]);
var output = Path.GetFullPath(args[6]);
var compileRoot = Path.GetFullPath(args[7]);
Directory.CreateDirectory(output);

var prior = JsonNode.Parse(File.ReadAllText(priorPath)).AsObject();
var priorCases = prior["cases"].AsArray().Select(c => c.DeepClone()).ToList();
if (priorCases.Count != 90) throw new InvalidOperationException("Prior contract must contain 90 cases.");
var priorByName = priorCases.ToDictionary(c => c["fullName"].GetValue<string>(), StringComparer.Ordinal);
var priorSelectors = File.ReadLines(selectorPath).Where(s => !String.IsNullOrWhiteSpace(s)).Select(s => s.Trim()).ToArray();
if (priorSelectors.Length != 90 || !priorSelectors.ToHashSet(StringComparer.Ordinal).SetEquals(priorByName.Keys))
    throw new InvalidOperationException("Prior native selectors do not exactly match the 90-case typed contract.");

var testResolver = new DefaultAssemblyResolver();
testResolver.AddSearchDirectory(Path.GetDirectoryName(editorTestsPath));
using var testsAsm = AssemblyDefinition.ReadAssembly(editorTestsPath, new ReaderParameters { AssemblyResolver = testResolver });
var fixtureNames = new[]
{
    "Roguehalla.Client.Tests.QuestJournalViewEditModeTests", "Roguehalla.Client.Tests.TraderDialogViewEditModeTests",
    "Roguehalla.Client.Tests.PlayerFlowsEditModeTests", "MatchLaunchEditModeTests", "MatchSettlementEditModeTests",
    "Roguehalla.Client.Tests.TrainingConsoleSelectorsEditModeTests", "Roguehalla.Client.Tests.TrainingConsoleViewEditModeTests",
    "Roguehalla.Client.Tests.TrainingConsoleIntegrationEditModeTests"
};
var typeMap = Flatten(testsAsm.MainModule.Types).ToDictionary(t => t.FullName, StringComparer.Ordinal);
var currentCases = new List<JsonNode>();
foreach (var fixtureName in fixtureNames)
{
    if (!typeMap.TryGetValue(fixtureName, out var type)) throw new InvalidOperationException("Missing compiled fixture " + fixtureName);
    foreach (var method in type.Methods)
    {
        var attrs = method.CustomAttributes.Where(a => a.AttributeType.FullName is "NUnit.Framework.TestAttribute" or "NUnit.Framework.TestCaseAttribute").ToArray();
        var testCases = attrs.Where(a => a.AttributeType.FullName == "NUnit.Framework.TestCaseAttribute").ToArray();
        if (!attrs.Any(a => a.AttributeType.FullName == "NUnit.Framework.TestAttribute") && testCases.Length == 0) continue;
        var parameters = method.Parameters.Select(p => new { name = p.Name, declaredType = p.ParameterType.FullName }).ToArray();
        var cases = new List<CustomAttributeArgument[]>();
        if (testCases.Length == 0) cases.Add(Array.Empty<CustomAttributeArgument>());
        foreach (var attr in testCases)
        {
            if (attr.ConstructorArguments.Count == 1 && attr.ConstructorArguments[0].Value is CustomAttributeArgument[] packed) cases.Add(packed);
            else cases.Add(attr.ConstructorArguments.ToArray());
        }
        foreach (var values in cases)
        {
            var selected = values.Select((arg, i) => new
            {
                declaredType = i < parameters.Length ? parameters[i].declaredType : arg.Type.FullName,
                attributeValueType = Normalize(arg).Type.FullName,
                value = CaseValue(arg),
                displayValue = Display(arg)
            }).ToArray();
            var display = values.Select(Display).ToArray();
            var selector = method.Name + (display.Length == 0 ? "" : "(" + String.Join(",", display) + ")");
            currentCases.Add(JsonSerializer.SerializeToNode(new
            {
                fixtureType = fixtureName,
                method = method.Name,
                methodReturnType = method.ReturnType.FullName,
                methodParameters = parameters,
                simpleToolLeafSelector = selector,
                fullName = fixtureName + "." + selector,
                selectedArguments = selected
            }));
        }
    }
}
if (currentCases.Count != 90) throw new InvalidOperationException("Current compiled metadata yielded " + currentCases.Count + " cases, expected 90.");
// The prior contract contains NUnit's verified display spellings (including numeric suffixes).
// Match each newly read compiled attribute/signature tuple to exactly one prior record before
// carrying its literal selector forward; no test body or NUnit discovery is invoked here.
foreach (var current in currentCases)
{
    var fixtureName = current["fixtureType"].GetValue<string>();
    var methodName = current["method"].GetValue<string>();
    var matches = priorCases.Where(old => old["fixtureType"].GetValue<string>() == fixtureName && old["method"].GetValue<string>() == methodName)
        .Where(old =>
        {
            var oldArgs = old["selectedArguments"].AsArray(); var newArgs = current["selectedArguments"].AsArray();
            if (!SameArgs(oldArgs, newArgs)) return false;
            var oldParams = old["methodParameters"].AsArray(); var newParams = current["methodParameters"].AsArray();
            if (oldParams.Count != newParams.Count) return false;
            for (int i = 0; i < oldParams.Count; i++)
                if (oldParams[i]["declaredType"].GetValue<string>() != newParams[i]["declaredType"].GetValue<string>()) return false;
            return true;
        }).ToArray();
    if (matches.Length != 1) throw new InvalidOperationException("Current compiled typed tuple maps to " + matches.Length + " prior selectors: " + fixtureName + "." + methodName);
    current["fullName"] = matches[0]["fullName"].GetValue<string>();
    current["simpleToolLeafSelector"] = matches[0]["simpleToolLeafSelector"].GetValue<string>();
}
var uniqueCurrent = currentCases.ToDictionary(c => c["fullName"].GetValue<string>(), StringComparer.Ordinal);
if (uniqueCurrent.Count != 90) throw new InvalidOperationException("Current compiled metadata has duplicate selectors.");
if (!uniqueCurrent.Keys.ToHashSet(StringComparer.Ordinal).SetEquals(priorByName.Keys))
    throw new InvalidOperationException("Current compiled full selector set differs from the frozen typed contract.");
foreach (var priorCase in priorCases)
{
    var name = priorCase["fullName"].GetValue<string>();
    var current = uniqueCurrent[name];
    if (priorCase["fixtureType"].GetValue<string>() != current["fixtureType"].GetValue<string>() ||
        priorCase["method"].GetValue<string>() != current["method"].GetValue<string>())
        throw new InvalidOperationException("Fixture/method changed for " + name);
    var oldArgs = priorCase["selectedArguments"].AsArray(); var newArgs = current["selectedArguments"].AsArray();
    if (!SameArgs(oldArgs, newArgs)) throw new InvalidOperationException("Typed argument tuple changed for " + name);
    var oldParams = priorCase["methodParameters"].AsArray(); var newParams = current["methodParameters"].AsArray();
    if (oldParams.Count != newParams.Count) throw new InvalidOperationException("Method signature changed for " + name);
    for (int i = 0; i < oldParams.Count; i++)
        if (oldParams[i]["declaredType"].GetValue<string>() != newParams[i]["declaredType"].GetValue<string>())
            throw new InvalidOperationException("Parameter type changed for " + name);
}
var compiledNames = uniqueCurrent.Keys.ToHashSet(StringComparer.Ordinal);
if (!compiledNames.SetEquals(priorSelectors)) throw new InvalidOperationException("Current compiled selectors differ from native-selectors.txt.");

var clientResolver = new DefaultAssemblyResolver();
clientResolver.AddSearchDirectory(Path.GetDirectoryName(editorClientPath));
using var editorClient = AssemblyDefinition.ReadAssembly(editorClientPath, new ReaderParameters { AssemblyResolver = clientResolver });
var playerResolver = new DefaultAssemblyResolver();
playerResolver.AddSearchDirectory(Path.GetDirectoryName(playerClientPath));
using var playerClient = AssemblyDefinition.ReadAssembly(playerClientPath, new ReaderParameters { AssemblyResolver = playerResolver });
var ownerName = "Roguehalla.Client.TrainingConsoleView";
MethodDefinition FindMethod(AssemblyDefinition asm, string typeName, string methodName) => Flatten(asm.MainModule.Types).Single(t => t.FullName == typeName).Methods.Single(m => m.Name == methodName);
var editorRetire = FindMethod(editorClient, ownerName, "RetireRoot");
var playerRetire = FindMethod(playerClient, ownerName, "RetireRoot");
var playerCalls = Calls(playerRetire); var editorCalls = Calls(editorRetire);
bool playerOnlyDeferred = playerCalls.Any(x => x.Contains("UnityEngine.Object::Destroy(")) && !playerCalls.Any(x => x.Contains("DestroyImmediate") || x.Contains("Application::get_isPlaying"));
bool editorHasGuardedImmediate = Array.IndexOf(editorCalls, "System.Boolean UnityEngine.Application::get_isPlaying()") >= 0 &&
    Array.FindIndex(editorCalls, x => x.Contains("UnityEngine.Object::DestroyImmediate(")) > Array.FindIndex(editorCalls, x => x.Contains("UnityEngine.Application::get_isPlaying()")) &&
    editorCalls.Any(x => x.Contains("UnityEngine.Object::Destroy("));
if (!playerOnlyDeferred) throw new InvalidOperationException("Player RetireRoot contains a nondeferred destruction path.");
if (!editorHasGuardedImmediate) throw new InvalidOperationException("Editor RetireRoot does not show the isPlaying guard before immediate destruction plus fallback.");

var owner = Flatten(editorClient.MainModule.Types).Single(t => t.FullName == ownerName);
MethodDefinition ownerMethod(string name) => owner.Methods.Single(m => m.Name == name);
var sessionPredicates = Flatten(owner.NestedTypes).SelectMany(t => t.Methods)
    .Where(m => m.Name.Contains("Attach", StringComparison.Ordinal) && Calls(m).Any(x => x.Contains("TrainingConsoleView::OwnerAlive", StringComparison.Ordinal))).ToArray();
if (sessionPredicates.Length != 1) throw new InvalidOperationException("Expected exactly one attached session-current predicate guarded by OwnerAlive.");
var detachMethod = ownerMethod("Detach");
var detachCalls = Calls(detachMethod);
var removeEvents = detachCalls.Where(x => x.Contains("remove_", StringComparison.Ordinal)).ToArray();
var guardMethods = new[] { ownerMethod("OwnerAlive"), ownerMethod("get_ActionsAvailable"), ownerMethod("CurrentAction"), ownerMethod("DisposeOwned"), detachMethod, ownerMethod("RetireRoot"), ownerMethod("get_Root"), ownerMethod("get_Panel") };
var actionsCalls = Calls(ownerMethod("get_ActionsAvailable"));
var currentCalls = Calls(ownerMethod("CurrentAction"));
var ownerCalls = Calls(ownerMethod("OwnerAlive"));
var disposeCalls = Calls(ownerMethod("DisposeOwned"));
var disposeInstructions = ownerMethod("DisposeOwned").Body.Instructions;
int detachCallIndex = disposeInstructions.ToList().FindIndex(i => i.Operand is MethodReference called && called.Name == "Detach");
bool BeforeDetach(string field) => detachCallIndex >= 0 && disposeInstructions.Select((i, index) => (i, index))
    .Any(pair => pair.i.OpCode.Code == Code.Stfld && pair.i.Operand is FieldReference f && f.Name == field && pair.index < detachCallIndex);
var guardOrdering = new
{
    ownerAliveCallsUnityFakeNullEqualityBeforeDispose = Array.FindIndex(ownerCalls, x => x.Contains("UnityEngine.Object::op_Inequality")) >= 0 && Array.FindIndex(ownerCalls, x => x.Contains("DisposeOwned")) > Array.FindIndex(ownerCalls, x => x.Contains("UnityEngine.Object::op_Inequality")),
    actionsAvailableCallsOwnerAliveBeforeNativeEnabledCheck = Array.FindIndex(actionsCalls, x => x.Contains("OwnerAlive")) >= 0 && Array.FindIndex(actionsCalls, x => x.Contains("Behaviour::get_isActiveAndEnabled")) > Array.FindIndex(actionsCalls, x => x.Contains("OwnerAlive")),
    currentActionCallsOwnerAliveFirst = currentCalls.Length > 0 && currentCalls[0].Contains("OwnerAlive"),
    disposeMarksInvalidBeforeDetach = BeforeDetach("_destroyed") && BeforeDetach("_confirmed") && BeforeDetach("_opened") && BeforeDetach("_actionGeneration"),
    sessionCurrentPredicateCallsOwnerAliveFirst = Calls(sessionPredicates[0]).Length > 0 && Calls(sessionPredicates[0])[0].Contains("OwnerAlive"),
    detachRemovesOnlyOwnedSessionEvents = removeEvents.Length == 3 && removeEvents.All(x => x.Contains("Session::remove_StateChanged") || x.Contains("Session::remove_SnapshotReceived") || x.Contains("Session::remove_TimelineReset")),
    rootPanelGettersCallOwnerAlive = Calls(ownerMethod("get_Root")).Any(x => x.Contains("OwnerAlive")) && Calls(ownerMethod("get_Panel")).Any(x => x.Contains("OwnerAlive"))
};
if (!guardOrdering.ownerAliveCallsUnityFakeNullEqualityBeforeDispose || !guardOrdering.actionsAvailableCallsOwnerAliveBeforeNativeEnabledCheck ||
    !guardOrdering.currentActionCallsOwnerAliveFirst || !guardOrdering.disposeMarksInvalidBeforeDetach || !guardOrdering.sessionCurrentPredicateCallsOwnerAliveFirst ||
    !guardOrdering.detachRemovesOnlyOwnedSessionEvents || !guardOrdering.rootPanelGettersCallOwnerAlive)
    throw new InvalidOperationException("Compiled owner/disposal IL order check failed.");

var repoSource = Path.Combine(repo, "client-unity/UnityProject/Assets/Scripts/UI/TrainingConsoleView.cs");
var sourceText = File.ReadAllText(repoSource);
var disposeSourceStart = sourceText.IndexOf("void DisposeOwned()", StringComparison.Ordinal);
var disposeSource = sourceText.Substring(disposeSourceStart);
var sourceChecks = new
{
    fakeNullBranchPrecedesDispose = sourceText.IndexOf("if (this != null) return true;", StringComparison.Ordinal) < sourceText.IndexOf("DisposeOwned();", sourceText.IndexOf("bool OwnerAlive()", StringComparison.Ordinal), StringComparison.Ordinal),
    invalidationBeforeDetach = disposeSource.IndexOf("_destroyed = true; _confirmed = _opened = false; _actionGeneration++;", StringComparison.Ordinal) < disposeSource.IndexOf("Detach(); _session = null; OpenStateChanged = null;", StringComparison.Ordinal),
    captureAndClearBeforeRelease = sourceText.IndexOf("var root = _root; _root = _panel = null; _container = null;", StringComparison.Ordinal) < sourceText.IndexOf("ReleaseFocus(root);", StringComparison.Ordinal),
    retireInFinally = sourceText.Contains("finally { RetireRoot(root); }", StringComparison.Ordinal)
};

var outputCases = currentCases.OrderBy(c => c["fullName"].GetValue<string>(), StringComparer.Ordinal).ToArray();
var currentSelectorsPath = Path.Combine(output, "current-selectors.json");
File.WriteAllText(currentSelectorsPath, JsonSerializer.Serialize(new { metadataOnly = true, cases = outputCases }, new JsonSerializerOptions { WriteIndented = true }));
var editorTests = Path.GetFullPath(args[2]);
var fixtureSources = fixtureNames.Select(f =>
{
    string source = Path.Combine(repo, "client-unity/UnityProject/Assets/Tests/Editor", f.Substring(f.LastIndexOf('.') + 1) + ".cs");
    string meta = source + ".meta";
    string guid = File.ReadLines(meta).First(x => x.StartsWith("guid:", StringComparison.Ordinal)).Substring(5).Trim();
    return new { fixtureType = f, source = SourceRecord(repo, source), meta = new { path = Relative(repo, meta), sha256 = Hash(meta), guid } };
}).ToArray();
var sourceRoots = new
{
    scripts = Directory.GetFiles(Path.Combine(repo, "client-unity/UnityProject/Assets/Scripts"), "*.cs", SearchOption.AllDirectories).OrderBy(x => x, StringComparer.Ordinal).Select(x => SourceRecord(repo, x)).ToArray(),
    netProtocol = Directory.GetFiles(Path.Combine(repo, "client-unity/RoguehallaNet/Net"), "*.cs", SearchOption.AllDirectories)
        .Concat(Directory.GetFiles(Path.Combine(repo, "client-unity/RoguehallaNet/Protocol"), "*.cs", SearchOption.AllDirectories)).OrderBy(x => x, StringComparer.Ordinal).Select(x => SourceRecord(repo, x)).ToArray(),
    editorTests = Directory.GetFiles(Path.Combine(repo, "client-unity/UnityProject/Assets/Tests/Editor"), "*.cs", SearchOption.AllDirectories).OrderBy(x => x, StringComparer.Ordinal).Select(x => SourceRecord(repo, x)).ToArray()
};
var projects = new[]
{
    Path.Combine(compileRoot, "profiles/editor/Client.csproj"), Path.Combine(compileRoot, "profiles/editor/Tests.csproj"), Path.Combine(compileRoot, "profiles/player/Client.csproj"),
    Path.Combine(repo, "client-unity/RoguehallaNet/RoguehallaNet.csproj")
}.Select(x => new { path = x, sha256 = Hash(x) }).ToArray();
var outputs = new[]
{
    new { profile = "editor-client", path = editorClientPath },
    new { profile = "editor-tests", path = editorTestsPath },
    new { profile = "player-client", path = playerClientPath }
}.Select(x => new { x.profile, x.path, sha256 = Hash(x.path), mvid = AssemblyDefinition.ReadAssembly(x.path).MainModule.Mvid.ToString("D") }).ToArray();
var netDll = Path.Combine(repo, "client-unity/RoguehallaNet/bin/Debug/netstandard2.1/RoguehallaNet.dll");
var sourcePins = new
{
    schema = "roguehalla-training-lifecycle-source-pins/1",
    repo, head = "d90dd0a12b898dceae6715e26c1aec71a68d8d3a",
    profiles = projects,
    sourceRoots,
    fixtureSources,
    netAssembly = new { path = netDll, sha256 = Hash(netDll) },
    outputAssemblies = outputs
};
var pinsPath = Path.Combine(output, "source-input-pins.json");
File.WriteAllText(pinsPath, JsonSerializer.Serialize(sourcePins, new JsonSerializerOptions { WriteIndented = true }));

var report = new
{
    schema = "roguehalla-training-lifecycle-metadata-audit/1",
    sourceHead = "d90dd0a12b898dceae6715e26c1aec71a68d8d3a",
    metadataTool = new
    {
        source = Path.Combine(compileRoot, "metadata/Program.cs"),
        project = Path.Combine(compileRoot, "metadata/MetadataAudit.csproj"),
        sourceSha256 = Hash(Path.Combine(compileRoot, "metadata/Program.cs")),
        projectSha256 = Hash(Path.Combine(compileRoot, "metadata/MetadataAudit.csproj")),
        testBodiesInvoked = false,
        unityApisInvoked = false
    },
    prior = new { path = priorPath, sha256 = Hash(priorPath), nativeSelectorsPath = selectorPath, nativeSelectorsSha256 = Hash(selectorPath), count = priorCases.Count },
    compiled = new { editorTests = editorTests, sha256 = Hash(editorTests), mvid = testsAsm.MainModule.Mvid.ToString("D"), extractedSelectorCount = currentCases.Count, comparedWithPriorSelectorsAndTypedTuples = true, comparedWithNativeSelectors = true, testBodiesInvoked = false, unityApisInvoked = false },
    retireRoot = new
    {
        editor = MethodIl(editorRetire), editorCalls, editorHasGuardedImmediate,
        player = MethodIl(playerRetire), playerCalls, playerOnlyDeferred
    },
    ownerGuardIl = guardMethods.Select(MethodIl).ToArray(),
    sessionCurrentPredicateIl = sessionPredicates.Select(MethodIl).ToArray(),
    guardOrdering,
    sourceChecks,
    fixtureSources,
    sourcePinsPath = pinsPath,
    sourcePinsSha256 = Hash(pinsPath),
    currentSelectorsPath,
    currentSelectorsSha256 = Hash(currentSelectorsPath),
    allAssertionsPass = playerOnlyDeferred && editorHasGuardedImmediate && guardOrdering.ownerAliveCallsUnityFakeNullEqualityBeforeDispose &&
        guardOrdering.actionsAvailableCallsOwnerAliveBeforeNativeEnabledCheck && guardOrdering.currentActionCallsOwnerAliveFirst &&
        guardOrdering.disposeMarksInvalidBeforeDetach && guardOrdering.sessionCurrentPredicateCallsOwnerAliveFirst && guardOrdering.detachRemovesOnlyOwnedSessionEvents &&
        guardOrdering.rootPanelGettersCallOwnerAlive && sourceChecks.fakeNullBranchPrecedesDispose &&
        sourceChecks.invalidationBeforeDetach && sourceChecks.captureAndClearBeforeRelease && sourceChecks.retireInFinally
};
var reportPath = Path.Combine(output, "metadata-source-validation.json");
File.WriteAllText(reportPath, JsonSerializer.Serialize(report, new JsonSerializerOptions { WriteIndented = true }));
Console.WriteLine(JsonSerializer.Serialize(new
{
    reportPath,
    reportSha256 = Hash(reportPath),
    selectors = currentCases.Count,
    oldContractMatch = true,
    nativeSelectorMatch = true,
    editorHasGuardedImmediate,
    playerOnlyDeferred,
    guardOrdering,
    sourceChecks,
    pinsSha256 = Hash(pinsPath)
}));

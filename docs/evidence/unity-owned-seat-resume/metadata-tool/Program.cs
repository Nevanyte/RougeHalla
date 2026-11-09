using System.Globalization;
using System.Security.Cryptography;
using System.Text.Json;
using System.Text.Json.Nodes;
using System.Xml.Linq;
using Mono.Cecil;
using Mono.Cecil.Cil;

static string Hash(string p) => Convert.ToHexString(SHA256.HashData(File.ReadAllBytes(p))).ToLowerInvariant();
static IEnumerable<TypeDefinition> Flatten(IEnumerable<TypeDefinition> ts) { foreach (var t in ts) { yield return t; foreach (var n in Flatten(t.NestedTypes)) yield return n; } }
static CustomAttributeArgument Norm(CustomAttributeArgument a) => a.Type.FullName == "System.Object" && a.Value is CustomAttributeArgument z ? z : a;
static object? Unwrap(object? x) { while (x is CustomAttributeArgument a) x = a.Value; return x; }
static string? EnumName(TypeReference type, object? value) { try { var d = type.Resolve(); if (d?.IsEnum == true) foreach (var f in d.Fields) if (f.IsStatic && f.HasConstant && Convert.ToInt64(f.Constant, CultureInfo.InvariantCulture) == Convert.ToInt64(value, CultureInfo.InvariantCulture)) return f.Name; } catch { } return null; }
static object? Value(CustomAttributeArgument a) { a = Norm(a); var x = Unwrap(a.Value); if (x is null) return null; var en = EnumName(a.Type, x); if (en is not null) return new { name = en, numericValue = Convert.ToInt32(x, CultureInfo.InvariantCulture) }; return x switch { bool b => b, byte n => (int)n, sbyte n => (int)n, short n => (int)n, ushort n => (int)n, int n => n, uint n => n.ToString(CultureInfo.InvariantCulture), long n => n.ToString(CultureInfo.InvariantCulture), ulong n => n.ToString(CultureInfo.InvariantCulture), _ => x.ToString() }; }
static string Display(CustomAttributeArgument a) { a = Norm(a); var x = Unwrap(a.Value); return EnumName(a.Type, x) ?? (x is bool b ? (b ? "True" : "False") : Convert.ToString(x, CultureInfo.InvariantCulture) ?? "null"); }
static bool SameArgs(JsonArray a, JsonArray b) { if (a.Count != b.Count) return false; for (int i = 0; i < a.Count; i++) { if (a[i]!["declaredType"]!.GetValue<string>() != b[i]!["declaredType"]!.GetValue<string>()) return false; var av = a[i]!["value"]; var bv = b[i]!["value"]; if (av is JsonObject ao && ao["numericValue"] is not null) { var bn = bv is JsonObject bo ? bo["numericValue"] : bv; if (bn is null || ao["numericValue"]!.ToJsonString() != bn.ToJsonString()) return false; if (bv is JsonObject bobj && ao["name"]!.GetValue<string>() != bobj["name"]!.GetValue<string>()) return false; } else if (JsonSerializer.Serialize(av) != JsonSerializer.Serialize(bv)) return false; } return true; }
static string Rel(string root, string file) => Path.GetRelativePath(root, file).Replace(Path.DirectorySeparatorChar, '/');
static object SourceRecord(string root, string file) => new { path = Rel(root, file), sha256 = Hash(file) };
static object[] Instructions(MethodDefinition m) => !m.HasBody ? Array.Empty<object>() : m.Body.Instructions.Select(i => (object)new { offset = i.Offset, opcode = i.OpCode.Name, operand = i.Operand is MethodReference mr ? mr.FullName : i.Operand is FieldReference fr ? fr.FullName : i.Operand is Instruction target ? "IL_" + target.Offset.ToString("X4") : i.Operand?.ToString() }).ToArray();
static MethodDefinition Method(TypeDefinition type, string name) => type.Methods.Single(m => m.Name == name);
static (object Report, bool Pass) FindCaptureSites(TypeDefinition type) {
    var hits = new List<(string Caller, int Offset, bool HasModePredicateBefore, bool HasModeConfirmedWriteBefore)>();
    foreach (var method in Flatten(new[] { type }).SelectMany(t => t.Methods)) {
        if (!method.HasBody) continue;
        var ins = method.Body.Instructions;
        for (var i = 0; i < ins.Count; i++) {
            if (ins[i].Operand is not MethodReference mr || mr.Name != "CaptureConfirmedSeat") continue;
            var priorCalls = ins.Take(i).Where(x => x.OpCode.Code is Code.Call or Code.Callvirt).Select(x => (x.Operand as MethodReference)?.Name).Where(x => x != null).ToArray();
            var priorFields = ins.Take(i).Where(x => x.OpCode.Code == Code.Stfld).Select(x => (x.Operand as FieldReference)?.Name).Where(x => x != null).ToArray();
            hits.Add((method.FullName, ins[i].Offset, priorCalls.Contains("MatchesServer"), priorFields.Contains("_modeConfirmed")));
        }
    }
    var pass = hits.Count > 0 && hits.All(x => x.HasModePredicateBefore && x.HasModeConfirmedWriteBefore);
    return (new { count = hits.Count, sites = hits.Select(x => new { caller = x.Caller, offset = x.Offset, hasModePredicateBefore = x.HasModePredicateBefore, hasModeConfirmedWriteBefore = x.HasModeConfirmedWriteBefore }).ToArray(), allAfterModePredicateAndConfirmation = pass }, pass);
}
static object CallReport(MethodDefinition method) => new { method = method.FullName, instructions = Instructions(method) };
static bool Calls(MethodDefinition m, string fragment) => m.HasBody && m.Body.Instructions.Any(i => i.OpCode.Code is Code.Call or Code.Callvirt && i.Operand is MethodReference mr && mr.FullName.Contains(fragment, StringComparison.Ordinal));
static int CallOffset(MethodDefinition m, string fragment) => m.Body.Instructions.FirstOrDefault(i => i.OpCode.Code is Code.Call or Code.Callvirt && i.Operand is MethodReference mr && mr.FullName.Contains(fragment, StringComparison.Ordinal))?.Offset ?? -1;

if (args.Length != 9) throw new ArgumentException("usage: MetadataAudit <repo> <frozen-source-sha> <editor-tests.dll> <player-client.dll> <prior90.json> <output> <editor-tests.csproj> <player.csproj> <editor-client.dll>");
var repo = Path.GetFullPath(args[0]); var sourceSha = args[1]; var testsPath = Path.GetFullPath(args[2]); var playerPath = Path.GetFullPath(args[3]); var priorPath = Path.GetFullPath(args[4]); var output = Path.GetFullPath(args[5]); var editorProjectPath = Path.GetFullPath(args[6]); var playerProjectPath = Path.GetFullPath(args[7]); var editorClientPath = Path.GetFullPath(args[8]);
Directory.CreateDirectory(output);
var gitInfo = new System.Diagnostics.ProcessStartInfo("git") { RedirectStandardOutput = true, RedirectStandardError = true, UseShellExecute = false }; gitInfo.ArgumentList.Add("-C"); gitInfo.ArgumentList.Add(repo); gitInfo.ArgumentList.Add("rev-parse"); gitInfo.ArgumentList.Add("HEAD");
using var gitHead = System.Diagnostics.Process.Start(gitInfo)!;
var actualHead = gitHead.StandardOutput.ReadToEnd().Trim(); gitHead.WaitForExit();
if (gitHead.ExitCode != 0 || !string.Equals(actualHead, sourceSha, StringComparison.OrdinalIgnoreCase)) throw new Exception("Frozen source SHA does not match repository HEAD.");
var priorRoot = JsonNode.Parse(File.ReadAllText(priorPath))!; var prior = priorRoot["cases"]!.AsArray().Select(x => x!.DeepClone()).ToArray();
if (prior.Length != 90) throw new Exception("Expected prior 90 selectors.");
var priorNames = prior.Select(x => x!["fullName"]!.GetValue<string>()).ToHashSet(StringComparer.Ordinal);
if (priorNames.Count != 90) throw new Exception("Prior 90 contract contains duplicate selector names.");
var resolver = new DefaultAssemblyResolver(); resolver.AddSearchDirectory(Path.GetDirectoryName(testsPath)!); using var testAsm = AssemblyDefinition.ReadAssembly(testsPath, new ReaderParameters { AssemblyResolver = resolver });
var types = Flatten(testAsm.MainModule.Types).ToDictionary(t => t.FullName, StringComparer.Ordinal);
var oldFixtureNames = prior.Select(x => x!["fixtureType"]!.GetValue<string>()).Distinct(StringComparer.Ordinal).OrderBy(x => x, StringComparer.Ordinal).ToArray();
if (oldFixtureNames.Length != 8) throw new Exception("Expected eight frozen prior fixtures.");
const string newFixture = "Roguehalla.Client.Tests.MatchResumeEditModeTests";
var fixtureNames = oldFixtureNames.Append(newFixture).ToArray();
var current = new List<JsonNode>();
foreach (var fn in fixtureNames) {
    if (!types.TryGetValue(fn, out var t)) throw new Exception("Missing fixture type " + fn);
    foreach (var m in t.Methods) {
        var attrs = m.CustomAttributes.Where(a => a.AttributeType.FullName is "NUnit.Framework.TestAttribute" or "NUnit.Framework.TestCaseAttribute").ToArray();
        if (attrs.Length == 0) continue;
        var caseArgs = attrs.Where(a => a.AttributeType.FullName == "NUnit.Framework.TestCaseAttribute").Select(a => a.ConstructorArguments.Count == 1 && a.ConstructorArguments[0].Value is CustomAttributeArgument[] packed ? packed : a.ConstructorArguments.ToArray()).ToArray();
        if (caseArgs.Length == 0) caseArgs = new[] { Array.Empty<CustomAttributeArgument>() };
        var pars = m.Parameters.Select(p => new { name = p.Name, declaredType = p.ParameterType.FullName }).ToArray();
        foreach (var ca in caseArgs) {
            var selected = ca.Select((a, i) => new { declaredType = i < pars.Length ? pars[i].declaredType : a.Type.FullName, attributeValueType = Norm(a).Type.FullName, value = Value(a), displayValue = Display(a) }).ToArray();
            var display = ca.Select(Display).ToArray(); var suffix = display.Length == 0 ? "" : "(" + string.Join(",", display) + ")";
            current.Add(JsonSerializer.SerializeToNode(new { fixtureType = fn, method = m.Name, methodReturnType = m.ReturnType.FullName, methodParameters = pars, simpleToolLeafSelector = m.Name + suffix, fullName = fn + "." + m.Name + suffix, selectedArguments = selected })!);
        }
    }
}
var compiledOld = current.Where(c => oldFixtureNames.Contains(c["fixtureType"]!.GetValue<string>(), StringComparer.Ordinal)).ToArray();
var expectedOld = prior.ToDictionary(c => c!["fullName"]!.GetValue<string>(), StringComparer.Ordinal);
if (compiledOld.Length != 90) throw new Exception("Expected 90 compiled old selector cases; got " + compiledOld.Length);
var currentOld = new Dictionary<string, JsonNode>(StringComparer.Ordinal);
foreach (var c in compiledOld) {
    var fn = c["fixtureType"]!.GetValue<string>(); var mn = c["method"]!.GetValue<string>();
    var candidate = prior.Where(p => p!["fixtureType"]!.GetValue<string>() == fn && p["method"]!.GetValue<string>() == mn &&
        SameArgs(p["selectedArguments"]!.AsArray(), c["selectedArguments"]!.AsArray()) &&
        p["methodParameters"]!.AsArray().Select(x => x!["declaredType"]!.GetValue<string>()).SequenceEqual(c["methodParameters"]!.AsArray().Select(x => x!["declaredType"]!.GetValue<string>()))).ToArray();
    if (candidate.Length != 1) throw new Exception($"Prior typed signature maps to {candidate.Length} compiled cases: {fn}.{mn}");
    var oldName = candidate[0]!["fullName"]!.GetValue<string>();
    if (!currentOld.TryAdd(oldName, c)) throw new Exception("Duplicate prior typed tuple: " + oldName);
}
if (currentOld.Count != 90 || !currentOld.Keys.ToHashSet().SetEquals(expectedOld.Keys)) throw new Exception("Compiled old selector typed tuples differ from frozen prior90.");
foreach (var name in expectedOld.Keys) {
    var a = expectedOld[name]!; var b = currentOld[name];
    if (!SameArgs(a["selectedArguments"]!.AsArray(), b["selectedArguments"]!.AsArray()) || !a["methodParameters"]!.AsArray().Select(x => x!["declaredType"]!.GetValue<string>()).SequenceEqual(b["methodParameters"]!.AsArray().Select(x => x!["declaredType"]!.GetValue<string>()))) throw new Exception("Prior90 typed tuple/signature changed: " + name);
}
var added = current.Where(c => c["fixtureType"]!.GetValue<string>() == newFixture).ToArray();
if (added.Length == 0) throw new Exception("No new resume selectors compiled.");
var union = prior.Select(c => c!.DeepClone()).Concat(added.Select(c => c.DeepClone())).OrderBy(c => c!["fullName"]!.GetValue<string>(), StringComparer.Ordinal).ToArray();
if (union.Select(c => c["fullName"]!.GetValue<string>()).Distinct(StringComparer.Ordinal).Count() != union.Length) throw new Exception("Duplicate selector in combined union.");
var unionPath = Path.Combine(output, "typed-fixture-contract.json"); File.WriteAllText(unionPath, JsonSerializer.Serialize(new { schema = "roguehalla-owned-seat-resume-typed-fixture-contract/1", sourceSha, compiledArtifactsOnly = true, testBodiesInvoked = false, unityApisInvoked = false, old90Preserved = true, counts = new { old90 = 90, newResume = added.Length, total = union.Length }, cases = union }, new JsonSerializerOptions { WriteIndented = true }));

// Capture audit: all inspected bodies below come from compiled metadata only; no method is executed.
using var clientAsm = AssemblyDefinition.ReadAssembly(editorClientPath, new ReaderParameters { AssemblyResolver = resolver });
var clientTypes = Flatten(clientAsm.MainModule.Types).ToDictionary(t => t.FullName, StringComparer.Ordinal);
var mc = clientTypes["Roguehalla.Client.MatchClient"];
var joinCore = Method(mc, "JoinCore"); var close = Method(mc, "CloseCurrentSession"); var retire = Method(mc, "RetireRuntime");
var resume = clientTypes["Roguehalla.Client.MatchClient"];
var resumeCurrent = Method(resume, "ResumeCurrentRun"); var capture = Method(resume, "CaptureConfirmedSeat");
var connectGate = Method(resume, "SeatResumeConnectAllowed"); var modeGate = Method(resume, "SeatResumeModeAllowed");
var connectOff = CallOffset(joinCore, "Session::Connect("); var gateOff = CallOffset(joinCore, "SeatResumeConnectAllowed");
var initResumeField = joinCore.Body.Instructions.Any(i => i.OpCode.Code == Code.Stfld && i.Operand is FieldReference f && f.Name == "InitialResume");
var generationWrite = retire.Body.Instructions.Select((i, idx) => (i, idx)).Where(x => x.i.OpCode.Code == Code.Stfld && x.i.Operand is FieldReference f && f.Name == "_joinGeneration").Select(x => x.idx).FirstOrDefault(-1);
var retireClose = retire.Body.Instructions.Select((i, idx) => (i, idx)).Where(x => x.i.OpCode.Code is Code.Call or Code.Callvirt && x.i.Operand is MethodReference m && m.Name == "CloseCurrentSession").Select(x => x.idx).FirstOrDefault(-1);
var captureSites = FindCaptureSites(mc);
var closeCalls = close.Body.Instructions.Where(i => i.OpCode.Code is Code.Call or Code.Callvirt).Select(i => i.Operand as MethodReference).Where(m => m != null).Select(m => m!.Name).ToArray();
var closeCapturesSession = Calls(close, "get_Session") && close.Body.Variables.Count > 0;
var closeCallsBothRetirementRoutes = closeCalls.Contains("Detach") && closeCalls.Contains("Leave");
var closeInstructions = close.Body.Instructions;
var clearSeatIndex = closeInstructions.Select((i, idx) => (i, idx)).FirstOrDefault(x => x.i.OpCode.Code is Code.Call or Code.Callvirt && x.i.Operand is MethodReference mr && mr.Name == "ClearSeatRecord").idx;
var detachIndex = closeInstructions.Select((i, idx) => (i, idx)).FirstOrDefault(x => x.i.OpCode.Code is Code.Call or Code.Callvirt && x.i.Operand is MethodReference mr && mr.Name == "Detach").idx;
var leaveIndex = closeInstructions.Select((i, idx) => (i, idx)).FirstOrDefault(x => x.i.OpCode.Code is Code.Call or Code.Callvirt && x.i.Operand is MethodReference mr && mr.Name == "Leave").idx;
var retirementGuardRead = closeInstructions.Select((i, idx) => (i, idx)).Any(x => x.idx > clearSeatIndex && x.idx < detachIndex && x.i.OpCode.Code == Code.Ldfld && x.i.Operand is FieldReference f && f.Name == "_joinGeneration");
var retirementGuardBranch = closeInstructions.Select((i, idx) => (i, idx)).Any(x => x.idx > clearSeatIndex && x.idx < detachIndex && x.i.OpCode.FlowControl == FlowControl.Cond_Branch);
var retirementSnapshotCaptured = closeInstructions.Select((i, idx) => (i, idx)).Any(x => x.idx < clearSeatIndex && x.i.OpCode.Code == Code.Ldfld && x.i.Operand is FieldReference f && f.Name == "_joinGeneration") && closeInstructions.Select((i, idx) => (i, idx)).Any(x => x.idx < clearSeatIndex && x.i.OpCode.Code.ToString().StartsWith("Stloc", StringComparison.Ordinal));
var postClearGenerationGuard = retirementSnapshotCaptured && retirementGuardRead && retirementGuardBranch && detachIndex > clearSeatIndex && leaveIndex > clearSeatIndex;
var resumeSourcePath = Path.Combine(repo, "client-unity/UnityProject/Assets/Scripts/Net/MatchClient.Resume.cs");
var resumeSourceText = File.ReadAllText(resumeSourcePath);
var noErrorStringParsing = !resumeSourceText.Contains("session.Error.Contains", StringComparison.Ordinal) && !resumeSourceText.Contains("Error.ToString().Contains", StringComparison.Ordinal);
var resumeProof = new {
    initialResumeAssignedInJoinCore = initResumeField,
    connectGateBeforeConnect = gateOff >= 0 && connectOff > gateOff,
    gateMethodsPresent = Calls(joinCore, "SeatResumeConnectAllowed") && connectGate.Name == "SeatResumeConnectAllowed" && modeGate.Name == "SeatResumeModeAllowed",
    captureOnlyAfterMatchingMode = captureSites.Report,
    retireGenerationBeforeClose = generationWrite >= 0 && retireClose > generationWrite,
    closeCapturesOldSessionAndRecord = closeCapturesSession && closeCalls.Contains("TakeSeatBinding"),
    closeHasDetachAndLeaveRoutes = closeCallsBothRetirementRoutes,
    closeDetachesAfterClearWhenRetirementGenerationChanged = postClearGenerationGuard,
    noErrorStringParsing = noErrorStringParsing,
    directIL = new { joinCore = CallReport(joinCore), resumeCurrent = CallReport(resumeCurrent), captureConfirmedSeat = CallReport(capture), connectGate = CallReport(connectGate), modeGate = CallReport(modeGate), retireRuntime = CallReport(retire), closeCurrentSession = CallReport(close) }
};
if (!resumeProof.initialResumeAssignedInJoinCore || !resumeProof.connectGateBeforeConnect || !resumeProof.gateMethodsPresent || !resumeProof.retireGenerationBeforeClose || !captureSites.Pass || !closeCapturesSession || !closeCalls.Contains("TakeSeatBinding") || !closeCallsBothRetirementRoutes || !postClearGenerationGuard || !noErrorStringParsing) throw new Exception($"Resume core IL check: initial={resumeProof.initialResumeAssignedInJoinCore}; gateOrder={resumeProof.connectGateBeforeConnect}; gates={resumeProof.gateMethodsPresent}; capture={captureSites.Pass}; retireOrder={resumeProof.retireGenerationBeforeClose}; closeCapture={resumeProof.closeCapturesOldSessionAndRecord}; closeRoutes={resumeProof.closeHasDetachAndLeaveRoutes}; postClearRetireGuard={postClearGenerationGuard}; noErrorParse={resumeProof.noErrorStringParsing}; captureSites={JsonSerializer.Serialize(captureSites.Report)}");
var fixtureType = types.Values.Single(t => t.FullName.EndsWith("MatchResumeEditModeTests/Fixture", StringComparison.Ordinal));
var fixtureLifecycle = new {
    type = fixtureType.FullName,
    metadataOnly = true,
    constructor = CallReport(fixtureType.Methods.Single(m => m.IsConstructor && !m.IsStatic)),
    dispose = CallReport(fixtureType.Methods.Single(m => m.Name == "Dispose")),
    profilePreferenceRestore = CallReport(fixtureType.Methods.Single(m => m.Name == "RestoreProfilePreference"))
};
var completeResumeProof = new { runtime = resumeProof, fixtureLifecycle };
var ilPath = Path.Combine(output, "resume-il-audit.json"); File.WriteAllText(ilPath, JsonSerializer.Serialize(completeResumeProof, new JsonSerializerOptions { WriteIndented = true }));

var fixtureRecords = new List<object>();
foreach (var fn in fixtureNames) {
    var file = fn[(fn.LastIndexOf('.') + 1)..] + ".cs"; var source = Path.Combine(repo, "client-unity/UnityProject/Assets/Tests/Editor", file); var meta = source + ".meta";
    var guid = File.ReadLines(meta).Single(x => x.StartsWith("guid:", StringComparison.Ordinal)).Split(':', 2)[1].Trim();
    fixtureRecords.Add(new { fixtureType = fn, source = SourceRecord(repo, source), meta = new { path = Rel(repo, meta), sha256 = Hash(meta), guid } });
}
var editorClientProjectPath = Path.GetFullPath(Path.Combine(Path.GetDirectoryName(editorProjectPath)!, "Client.csproj"));
var projectPaths = new[] { editorClientProjectPath, editorProjectPath, playerProjectPath }.Distinct(StringComparer.Ordinal).Where(File.Exists).ToArray();
var referenceFiles = projectPaths.SelectMany(p => XDocument.Load(p).Descendants("HintPath").Select(x => Path.GetFullPath(x.Value))).Where(File.Exists).Distinct(StringComparer.Ordinal).OrderBy(x => x, StringComparer.Ordinal).Select(p => new { path = p, sha256 = Hash(p) }).ToArray();
var netPath = Path.Combine(repo, "client-unity/RoguehallaNet/bin/Debug/netstandard2.1/RoguehallaNet.dll");
var scriptsDir = Path.Combine(repo, "client-unity/UnityProject/Assets/Scripts"); var allScriptPaths = Directory.GetFiles(scriptsDir, "*.cs", SearchOption.AllDirectories).OrderBy(x => x, StringComparer.Ordinal).Select(p => new { path = Rel(repo, p), sha256 = Hash(p) }).ToArray();
var testSourcePaths = fixtureNames.Select(fn => Path.Combine(repo, "client-unity/UnityProject/Assets/Tests/Editor", fn[(fn.LastIndexOf('.') + 1)..] + ".cs")).Select(p => new { path = Rel(repo, p), sha256 = Hash(p) }).ToArray();
var netSourcePaths = Directory.GetFiles(Path.Combine(repo, "client-unity/RoguehallaNet/Net"), "*.cs", SearchOption.AllDirectories).OrderBy(x => x, StringComparer.Ordinal).Select(p => new { path = Rel(repo, p), sha256 = Hash(p) }).ToArray();
var assemblyPins = new[] { testsPath, editorClientPath, playerPath, netPath }.Where(File.Exists).Select(p => { using var a = AssemblyDefinition.ReadAssembly(p); return new { path = p, sha256 = Hash(p), mvid = a.MainModule.Mvid.ToString("D") }; }).ToArray();
var pinsPath = Path.Combine(output, "source-input-pins.json"); File.WriteAllText(pinsPath, JsonSerializer.Serialize(new { schema = "roguehalla-owned-seat-resume-source-pins/1", sourceSha, actualHead, worktree = repo, fixtureSources = fixtureRecords, scripts = allScriptPaths, netSources = netSourcePaths, scopedTestSources = testSourcePaths, projects = projectPaths.Where(File.Exists).Select(p => new { path = p, sha256 = Hash(p) }), references = referenceFiles, netLibrary = File.Exists(netPath) ? new { path = netPath, sha256 = Hash(netPath) } : null, compiledAssemblies = assemblyPins }, new JsonSerializerOptions { WriteIndented = true }));
var toolSourcePath = Path.GetFullPath(Path.Combine(AppContext.BaseDirectory, "../../../Program.cs")); var toolProjectPath = Path.GetFullPath(Path.Combine(AppContext.BaseDirectory, "../../../MetadataAudit.csproj"));
var report = new { schema = "roguehalla-owned-seat-resume-metadata-audit/1", sourceSha, compiledArtifactsOnly = true, testBodiesInvoked = false, unityApisInvoked = false, prior90TypedSelectorsPreserved = true, newResumeSelectorCount = added.Length, unionCount = union.Length, ilAuditPassed = true, metadataTool = new { source = new { path = toolSourcePath, sha256 = Hash(toolSourcePath) }, project = new { path = toolProjectPath, sha256 = Hash(toolProjectPath) } }, union = new { path = unionPath, sha256 = Hash(unionPath) }, il = new { path = ilPath, sha256 = Hash(ilPath) }, sourcePins = new { path = pinsPath, sha256 = Hash(pinsPath) } };
var reportPath = Path.Combine(output, "metadata-audit.json"); File.WriteAllText(reportPath, JsonSerializer.Serialize(report, new JsonSerializerOptions { WriteIndented = true })); Console.WriteLine($"PASS source={sourceSha} old90 preserved; new={added.Length}; union={union.Length}; IL core checks pass.");

using System;
using System.Linq;
using System.Collections.Generic;
using System.Text.Json;
using Mono.Cecil;

if (args.Length != 1) throw new ArgumentException("assembly path required");
using var assembly = AssemblyDefinition.ReadAssembly(args[0]);
var groups = new[] { "MatchLaunchEditModeTests", "QuestJournalViewEditModeTests", "TraderDialogViewEditModeTests", "PlayerFlowsEditModeTests", "MatchSettlementEditModeTests" };
var output = new List<object>();
foreach (var type in assembly.MainModule.Types.Where(t => groups.Contains(t.Name)))
{
    var methods = new List<object>(); int count = 0;
    foreach (var method in type.Methods)
    {
        var cases = method.CustomAttributes.Where(a => a.AttributeType.FullName == "NUnit.Framework.TestCaseAttribute").ToList();
        bool test = method.CustomAttributes.Any(a => a.AttributeType.FullName == "NUnit.Framework.TestAttribute");
        if (cases.Count == 0 && !test) continue;
        int n = cases.Count > 0 ? cases.Count : 1; count += n;
        methods.Add(new { name = method.Name, caseCount = n });
    }
    output.Add(new { fixture = type.Name, sourceDeclaredCasesInCompiledMetadata = count, status = "UNRUN", methods });
}
Console.WriteLine(JsonSerializer.Serialize(new { purpose = "Metadata-only inspection. No test or Unity API invocation.", assembly = assembly.Name.Name,
    mvid = assembly.MainModule.Mvid.ToString(), fixtures = output }, new JsonSerializerOptions { WriteIndented = true }));

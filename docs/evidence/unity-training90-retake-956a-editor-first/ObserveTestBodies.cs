using System;
using System.Linq;
using System.Reflection;
using System.IO;
using System.Security.Cryptography;
using UnityEditor;
using UnityEngine;
var output=new System.Collections.Generic.List<object>();
foreach(var fixture in new[]{"QuestJournalViewEditModeTests","TraderDialogViewEditModeTests","PlayerFlowsEditModeTests","MatchLaunchEditModeTests","MatchSettlementEditModeTests","TrainingConsoleSelectorsEditModeTests","TrainingConsoleViewEditModeTests","TrainingConsoleIntegrationEditModeTests"}) {
var script=AssetDatabase.LoadAssetAtPath<MonoScript>("Assets/Tests/Editor/"+fixture+".cs");
var t=script.GetClass();
var types=new[]{t}.Concat(t.GetNestedTypes(BindingFlags.Public|BindingFlags.NonPublic)).ToArray();
var methods=types.SelectMany(x=>x.GetMethods(BindingFlags.Public|BindingFlags.NonPublic|BindingFlags.Instance|BindingFlags.Static|BindingFlags.DeclaredOnly)).Where(m=>m.GetMethodBody()!=null).Select(m=>{
 using(var sha=SHA256.Create()) return new{type=m.DeclaringType.FullName,name=m.Name,moduleMvid=m.Module.ModuleVersionId.ToString(),ilSha256=BitConverter.ToString(sha.ComputeHash(m.GetMethodBody().GetILAsByteArray())).Replace("-","").ToLowerInvariant()};
}).ToArray();
string dllHash;using(var sha=SHA256.Create())dllHash=BitConverter.ToString(sha.ComputeHash(File.ReadAllBytes(t.Assembly.Location))).Replace("-","").ToLowerInvariant();
output.Add(new{scope="Own test CLR metadata/IL only, no test invocation",type=t.FullName,moduleMvid=t.Module.ModuleVersionId.ToString(),dll=t.Assembly.Location,dllSha256=dllHash,guid=AssetDatabase.AssetPathToGUID("Assets/Tests/Editor/"+fixture+".cs"),dependencyHash=AssetDatabase.GetAssetDependencyHash("Assets/Tests/Editor/"+fixture+".cs").ToString(),methods});
}
return output;

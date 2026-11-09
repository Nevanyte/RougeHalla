using System;
using System.Linq;
using System.Reflection;
using UnityEditor;
using System.Collections.Generic;
var output=new List<object>();
foreach(var name in new[]{"QuestJournalViewEditModeTests","TraderDialogViewEditModeTests","PlayerFlowsEditModeTests","MatchLaunchEditModeTests","MatchSettlementEditModeTests","TrainingConsoleSelectorsEditModeTests","TrainingConsoleViewEditModeTests","TrainingConsoleIntegrationEditModeTests"}) {
var script=AssetDatabase.LoadAssetAtPath<MonoScript>("Assets/Tests/Editor/"+name+".cs"); var type=script.GetClass();
output.Add(new {type=type.FullName,moduleMvid=type.Module.ModuleVersionId.ToString(),methods=type.GetMethods(BindingFlags.Public|BindingFlags.Instance|BindingFlags.DeclaredOnly).Select(m=>new {name=m.Name,returnType=m.ReturnType.FullName,parameters=m.GetParameters().Select(p=>new {name=p.Name,declaredType=p.ParameterType.FullName}).ToArray()}).ToArray()});
}
return output;

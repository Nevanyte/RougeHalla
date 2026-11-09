using System;
using System.Linq;
using System.Reflection;
using System.IO;
using System.Security.Cryptography;
using UnityEditor;
using UnityEngine;
var script=AssetDatabase.LoadAssetAtPath<MonoScript>("Assets/Tests/Editor/MatchSettlementEditModeTests.cs");
var t=script.GetClass();
var types=new[]{t}.Concat(t.GetNestedTypes(BindingFlags.Public|BindingFlags.NonPublic)).ToArray();
var methods=types.SelectMany(x=>x.GetMethods(BindingFlags.Public|BindingFlags.NonPublic|BindingFlags.Instance|BindingFlags.Static|BindingFlags.DeclaredOnly)).Where(m=>m.GetMethodBody()!=null).Select(m=>{
 using(var sha=SHA256.Create()) return new{type=m.DeclaringType.FullName,name=m.Name,moduleMvid=m.Module.ModuleVersionId.ToString(),ilSha256=BitConverter.ToString(sha.ComputeHash(m.GetMethodBody().GetILAsByteArray())).Replace("-","").ToLowerInvariant()};
}).ToArray();
string dllHash;using(var sha=SHA256.Create())dllHash=BitConverter.ToString(sha.ComputeHash(File.ReadAllBytes(t.Assembly.Location))).Replace("-","").ToLowerInvariant();
return new{scope="Own test CLR metadata/IL only, no test invocation",type=t.FullName,moduleMvid=t.Module.ModuleVersionId.ToString(),dll=t.Assembly.Location,dllSha256=dllHash,guid=AssetDatabase.AssetPathToGUID("Assets/Tests/Editor/MatchSettlementEditModeTests.cs"),dependencyHash=AssetDatabase.GetAssetDependencyHash("Assets/Tests/Editor/MatchSettlementEditModeTests.cs").ToString(),methods};

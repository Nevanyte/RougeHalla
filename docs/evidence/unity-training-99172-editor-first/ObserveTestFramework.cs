using UnityEditor.PackageManager;
using UnityEditor.TestTools.TestRunner.Api;
var assembly=typeof(TestRunnerApi).Assembly;
var package=PackageInfo.FindForAssembly(assembly);
return new{assembly=assembly.FullName,packageName=package!=null?package.name:null,version=package!=null?package.version:null,resolvedPath=package!=null?package.resolvedPath:null};

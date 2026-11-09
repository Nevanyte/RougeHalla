using UnityEngine;
using UnityEditor;
return new {unityVersion=Application.unityVersion,playing=EditorApplication.isPlaying,compiling=EditorApplication.isCompiling,compileFailed=EditorUtility.scriptCompilationFailed};

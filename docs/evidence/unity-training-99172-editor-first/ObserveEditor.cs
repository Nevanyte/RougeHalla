using System;
using System.Linq;
using UnityEditor;
using UnityEditor.SceneManagement;
using UnityEngine;
using UnityEngine.SceneManagement;
using UnityEngine.InputSystem;
var scene = SceneManager.GetActiveScene();
var input = InputSystem.settings;
return new {
    playing=EditorApplication.isPlaying,
    willChangePlay=EditorApplication.isPlayingOrWillChangePlaymode,
    paused=EditorApplication.isPaused,
    compiling=EditorApplication.isCompiling,
    compileFailed=EditorUtility.scriptCompilationFailed,
    background=PlayerSettings.runInBackground,
    runtimeBackground=Application.runInBackground,
    activeScene=new {handle=scene.handle,name=scene.name,path=scene.path,loaded=scene.isLoaded,dirty=scene.isDirty,roots=scene.GetRootGameObjects().Select(x=>new {id=x.GetInstanceID(),name=x.name}).OrderBy(x=>x.id).ToArray()},
    sceneCount=SceneManager.sceneCount,
    previewSceneCount=EditorSceneManager.previewSceneCount,
    inputId=input != null ? input.GetInstanceID() : 0,
    inputFlags=input != null ? input.hideFlags.ToString() : null,
    inputMode=input != null ? input.updateMode.ToString() : null,
    inputBehavior=input != null ? input.backgroundBehavior.ToString() : null,
    textKey=PlayerPrefs.HasKey("roguehalla.showcase.textScale"),
    textScale=PlayerPrefs.GetFloat("roguehalla.showcase.textScale",1f),
    minimapKey=PlayerPrefs.HasKey("rh.ui.minimapScale"),
    minimapIndex=PlayerPrefs.GetInt("rh.ui.minimapScale",1),
    previewQuery=SessionState.GetString("Roguehalla.ArtPreviewQuery","")
};

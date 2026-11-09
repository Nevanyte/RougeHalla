using System;
using UnityEditor;
using UnityEngine;
using UnityEngine.InputSystem;
if(EditorApplication.isPlayingOrWillChangePlaymode || EditorApplication.isCompiling)throw new InvalidOperationException("Must be idle/stopped before exact source switch");
var s=InputSystem.settings;
AssetDatabase.DisallowAutoRefresh();
return new{autoRefreshHeld=true,inputLive=s!=null,inputId=s!=null?s.GetInstanceID():0,flags=s!=null?s.hideFlags.ToString():null,mode=s!=null?s.updateMode.ToString():null,behavior=s!=null?s.backgroundBehavior.ToString():null,playing=EditorApplication.isPlaying,paused=EditorApplication.isPaused,background=PlayerSettings.runInBackground,runtimeBackground=Application.runInBackground,textKey=PlayerPrefs.HasKey("roguehalla.showcase.textScale"),text=PlayerPrefs.GetFloat("roguehalla.showcase.textScale",1f),miniKey=PlayerPrefs.HasKey("rh.ui.minimapScale"),miniIndex=PlayerPrefs.GetInt("rh.ui.minimapScale",1)};

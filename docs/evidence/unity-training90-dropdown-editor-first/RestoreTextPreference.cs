using UnityEditor;
using UnityEngine;
if(EditorApplication.isPlayingOrWillChangePlaymode) throw new System.InvalidOperationException("Editor must be stopped");
var observed=new{key=PlayerPrefs.HasKey("roguehalla.showcase.textScale"),value=PlayerPrefs.GetFloat("roguehalla.showcase.textScale",1f)};
PlayerPrefs.DeleteKey("roguehalla.showcase.textScale");
PlayerPrefs.Save();
return new{observed,restored=new{key=PlayerPrefs.HasKey("roguehalla.showcase.textScale"),value=PlayerPrefs.GetFloat("roguehalla.showcase.textScale",1f)}};

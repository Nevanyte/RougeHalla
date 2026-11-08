using System; using System.IO; using UnityEngine; using UnityEditor;
public static class TagManagerParserProbe {
 [Serializable] public class Output { public string unityVersion; public string[] layerNames; public Sort[] sortingLayers; }
 [Serializable] public class Sort { public string name; public int id; public int value; }
 public static void Run() {
  try { var result=new Output { unityVersion=Application.unityVersion, layerNames=new string[32] };
   for(int i=0;i<32;i++) result.layerNames[i]=LayerMask.LayerToName(i);
   var layers=SortingLayer.layers; result.sortingLayers=new Sort[layers.Length];
   for(int i=0;i<layers.Length;i++) result.sortingLayers[i]=new Sort {name=layers[i].name,id=layers[i].id,value=layers[i].value};
   File.WriteAllText(Path.Combine(Directory.GetParent(Application.dataPath).FullName,"native-values.json"),JsonUtility.ToJson(result,true));
   Debug.Log("TAGMANAGER_PARSER_PROBE_COMPLETED");
  } catch(Exception e) { Debug.LogException(e); EditorApplication.Exit(5); }
 }
}

using System; using System.Linq; using System.Reflection; using UnityEditor; using UnityEngine; using UnityEngine.EventSystems;
uint w,h; PlayModeWindow.GetRenderingResolution(out w,out h);
var t=AppDomain.CurrentDomain.GetAssemblies().Select(a=>a.GetType("TrainingLayoutStage",false)).First(x=>x!=null);
return new {renderingResolution=new {width=w,height=h},viewType=PlayModeWindow.GetViewType().ToString(),screen=new {width=Screen.width,height=Screen.height},stage=t.GetMethod("Describe",BindingFlags.Public|BindingFlags.Static).Invoke(null,null),eventCurrent=EventSystem.current==null?null:EventSystem.current.name,events=Resources.FindObjectsOfTypeAll<EventSystem>().Where(x=>x.gameObject.scene.IsValid()).Select(x=>new{x.name,x.enabled,x.isActiveAndEnabled}).ToArray()};

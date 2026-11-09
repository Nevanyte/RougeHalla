using System; using System.Linq; using System.Reflection;
var t=AppDomain.CurrentDomain.GetAssemblies().Select(a=>a.GetType("TrainingLayoutStage",false)).First(x=>x!=null);
return new {scope="Cleanup only after first native layout error; no retry",errors=t.GetMethod("CloseActive",BindingFlags.Public|BindingFlags.Static).Invoke(null,null),after=t.GetMethod("Describe",BindingFlags.Public|BindingFlags.Static).Invoke(null,null)};

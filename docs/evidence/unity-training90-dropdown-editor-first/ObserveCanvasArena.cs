using System.Linq;
using UnityEngine;
return new {scope="Read-only native Canvas/Arena object inventory",canvases=Resources.FindObjectsOfTypeAll<Canvas>().Select(x=>new{id=x.GetInstanceID(),name=x.name,scene=x.gameObject.scene.path,handle=x.gameObject.scene.handle}).ToArray(),arenaObjects=Resources.FindObjectsOfTypeAll<GameObject>().Where(x=>x.name=="Arena"||x.name=="ArenaManager"||x.name=="ArenaRoot").Select(x=>new{id=x.GetInstanceID(),name=x.name,scene=x.scene.path,handle=x.scene.handle}).ToArray()};

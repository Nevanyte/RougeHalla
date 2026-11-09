using System.Linq;
using UnityEngine;
using UnityEngine.Rendering.Universal;
using UnityEngine.EventSystems;
return new {
    scope="Read-only post-test cleanup inventory; no private manager access or scene construction.",
    lights=Resources.FindObjectsOfTypeAll<Light2D>().Select(x=>new{id=x.GetInstanceID(),name=x.name,kind=x.lightType.ToString(),active=x.isActiveAndEnabled,scene=x.gameObject.scene.path,sceneHandle=x.gameObject.scene.handle}).ToArray(),
    eventSystems=Resources.FindObjectsOfTypeAll<EventSystem>().Select(x=>new{id=x.GetInstanceID(),name=x.name,active=x.isActiveAndEnabled,scene=x.gameObject.scene.path,sceneHandle=x.gameObject.scene.handle}).ToArray(),
    currentEventSystem=EventSystem.current!=null?EventSystem.current.GetInstanceID():0
};

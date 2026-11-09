using System.Linq;
using UnityEngine.InputSystem;
using UnityEngine.EventSystems;
var settings=InputSystem.settings;
return new {inputSettings=settings!=null?settings.GetInstanceID():0,keyboardCurrent=Keyboard.current!=null?Keyboard.current.deviceId:0,mouseCurrent=Mouse.current!=null?Mouse.current.deviceId:0,devices=InputSystem.devices.Select(d=>new {id=d.deviceId,layout=d.layout,name=d.name,enabled=d.enabled}).OrderBy(d=>d.id).ToArray(),eventSystem=EventSystem.current!=null?EventSystem.current.GetInstanceID():0,selected=EventSystem.current!=null&&EventSystem.current.currentSelectedGameObject!=null?EventSystem.current.currentSelectedGameObject.GetInstanceID():0};

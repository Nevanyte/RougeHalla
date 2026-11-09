using System;
using System.Collections;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using UnityEngine;
using UnityEngine.UI;
using TMPro;
using Newtonsoft.Json;
using Roguehalla.Net;
using Roguehalla.Net.Protocol;
using Roguehalla.Client;
const string output="/Users/nevinmckinnon/.codex/tools/rougehalla-unity-art/combined-c6a55-2026-11-08/evidence";
const string source="c6a55d3d68d0023e60ace98b55fd23f581217b38";
if(!Application.isPlaying || ShowcaseSettings.Current==null)throw new Exception("Playing no-network preview with settings required");
foreach(string n in new[]{"Presentation study","Presentation study arena","Presentation study overlay","Staged elemental artwork","No-network animation podium"}){var g=GameObject.Find(n);if(g!=null)UnityEngine.Object.DestroyImmediate(g);}
var host=ShowcaseSettings.Current;
var arena=new GameObject("Decoded wire presentation review - no network").AddComponent<Roguehalla.Client.ArenaView>();
var tiles=new byte[40*28];for(int y=0;y<28;y++)for(int x=0;x<40;x++)if(y==0||x==0||y==27||x==39)tiles[y*40+x]=MapBlob.Wall;
arena.Build(new MapBlob(40,28,tiles));
var cam=Camera.main;cam.orthographicSize=9;cam.transform.position=new Vector3(20,-9.4f,-30);
var cg=new GameObject("Decoded wire review captions");var canvas=cg.AddComponent<Canvas>();canvas.renderMode=RenderMode.ScreenSpaceOverlay;
var scaler=cg.AddComponent<CanvasScaler>();scaler.uiScaleMode=CanvasScaler.ScaleMode.ScaleWithScreenSize;scaler.referenceResolution=new Vector2(2560,1440);
TextMeshProUGUI Caption(string name,string value,Vector2 min,Vector2 max,int size){var g=new GameObject(name,typeof(RectTransform));g.transform.SetParent(cg.transform,false);var t=g.AddComponent<TextMeshProUGUI>();t.font=TMP_Settings.defaultFontAsset;t.text=value;t.fontSize=size;t.alignment=TextAlignmentOptions.Center;t.color=Color.white;t.raycastTarget=false;t.textWrappingMode=TextWrappingModes.NoWrap;var r=t.rectTransform;r.anchorMin=min;r.anchorMax=max;r.offsetMin=Vector2.zero;r.offsetMax=Vector2.zero;return t;}
Caption("Review watermark","STAGED DECODED-WIRE PRESENTATION REVIEW  •  NO NETWORK",new Vector2(.03f,.93f),new Vector2(.97f,.99f),30);
var phase=Caption("Review phase","Initializing pool sequence",new Vector2(.03f,.86f),new Vector2(.97f,.93f),27);
var note=Caption("Review scope","Protocol 14  |  c6a55d3  |  Snapshot decode → buffer → ArenaView  |  Native Editor capture",new Vector2(.03f,.02f),new Vector2(.97f,.09f),24);
var buffer=new SnapshotBuffer();var actors=new List<InterpActor>();var checks=new List<object>();uint tick=100;
void Check(bool value,string name){checks.Add(new{name,pass=value,frame=Time.frameCount});if(!value){File.WriteAllText(output+"/harness-checks.json",JsonConvert.SerializeObject(new{source,complete=false,checks},Formatting.Indented));throw new Exception("Review assertion: "+name);}}
void Deliver(params WireActor[] values){var encoded=new ServerMsg.Snapshot{Tick=tick++,Phase=2,Actors=values}.Encode();File.WriteAllBytes(output+"/wire-"+(tick-1)+".bin",encoded);var decoded=(ServerMsg.Snapshot)ServerMsg.Decode(encoded);Check(buffer.Add(decoded),"decoded frame accepted "+decoded.Tick);Check(buffer.Sample(buffer.NewestMs,actors),"decoded frame sampled "+decoded.Tick);arena.RetainObservedActors(actors,null);arena.Present(actors,null,null,0);}
WireActor Fighter(uint id,byte faction,byte weapon){return new WireActor{Id=id,X=640,Y=448,Facing=0,HpPct=72,Status=1,Faction=faction,Weapon=weapon,Kind=0,BarrierPct=25,BarrierRingStep=3,Sig=1};}
WireActor Giver(uint id,byte barrier,byte ring,byte sig){return new WireActor{Id=id,X=640,Y=448,Facing=0,HpPct=82,Status=1,Faction=15,Weapon=15,Kind=4,MobTypeCode=0,BarrierPct=barrier,BarrierRingStep=ring,Sig=sig};}
Transform Root(){return arena.GetComponentsInChildren<Transform>(true).Single(t=>t.name=="Observed actor" && t.gameObject.activeInHierarchy);}
SpriteRenderer Part(Transform t,string name){return t.GetComponentsInChildren<SpriteRenderer>(true).Single(s=>s.name==name);}
float[] V(Vector3 v){return new[]{v.x,v.y,v.z};}
object Receipt(string key){var r=Root();var a=actors.Single();return new{key,rootId=r.GetInstanceID(),id=a.Id,kind=a.Kind.ToString(),faction=a.Faction?.ToString(),weapon=a.Weapon?.ToString(),a.MobType,a.BarrierPct,a.BarrierRingStep,a.SourceSig,wire=new{kind=buffer.Newest.Actors[0].Kind,kit=buffer.Newest.Actors[0].Faction|(buffer.Newest.Actors[0].Weapon<<4),mob=buffer.Newest.Actors[0].MobTypeCode},rootAnchor=V(r.position),expectedAnchor=V(Roguehalla.Client.ArenaView.WorldPoint(a.X,a.Y)),rootScale=V(r.localScale),sprites=r.GetComponentsInChildren<SpriteRenderer>(true).Select(s=>new{name=s.name,enabled=s.enabled,active=s.gameObject.activeInHierarchy,sprite=s.sprite!=null?s.sprite.name:null,localPosition=V(s.transform.localPosition),localScale=V(s.transform.localScale),boundsMin=V(s.bounds.min),boundsMax=V(s.bounds.max)}).ToArray(),soundContext=arena.TrySoundContext(a.Id,out var w,out var f,out var k,out var m)};}
void Anchored(){var r=Root();Check((r.position-Roguehalla.Client.ArenaView.WorldPoint(640,448)).sqrMagnitude<.0000001f,"ground anchor equals delivered position");Check((r.localScale-new Vector3(1.2f,1.2f,1)).sqrMagnitude<.0000001f,"root has 1.2 XY and 1 Z");}
void Empty(uint oldId,Transform oldRoot){Deliver();Check(!arena.IsObserved(oldId),"removed handle absent");Check(!oldRoot.gameObject.activeInHierarchy,"pooled actor root inactive");Check(!arena.TrySoundContext(oldId,out var w,out var f,out var k,out var m),"removed handle has no sound context");Check(!arena.GetComponentsInChildren<SpriteRenderer>().Any(s=>s.name=="Confirmed impact" && s.gameObject.activeInHierarchy),"removed actor has no retained confirmed flash");}
IEnumerator Capture(string key){int before=Time.frameCount;yield return null;Canvas.ForceUpdateCanvases();yield return new WaitForEndOfFrame();Texture2D shot=null;try{shot=ScreenCapture.CaptureScreenshotAsTexture();Check(Time.frameCount>before,"capture frame advances "+key);Check(Screen.width==2560&&Screen.height==1440&&shot.width==2560&&shot.height==1440,"native QHD dimensions "+key);File.WriteAllBytes(output+"/"+key+".png",shot.EncodeToPNG());File.WriteAllText(output+"/"+key+".json",JsonConvert.SerializeObject(new{source,stage=key,frame=Time.frameCount,screenWidth=Screen.width,screenHeight=Screen.height,imageWidth=shot.width,imageHeight=shot.height,canvas=new{pixelRect=new[]{canvas.pixelRect.x,canvas.pixelRect.y,canvas.pixelRect.width,canvas.pixelRect.height},scale=canvas.scaleFactor},camera=new{orthographic=cam.orthographic,size=cam.orthographicSize,position=V(cam.transform.position)},method="ScreenCapture.CaptureScreenshotAsTexture at WaitForEndOfFrame; native original PNG",scope="Synthetic legal wire payload in actual Unity, no native server, socket, AI, network, Web or performance claim",actor=Receipt(key)},Formatting.Indented));}finally{if(shot!=null)UnityEngine.Object.Destroy(shot);}}
IEnumerator Run(){
 Deliver(Fighter(101,0,0));var root=Root();int rootId=root.GetInstanceID();Anchored();Check(arena.TrySoundContext(101,out var w,out var f,out var k,out var m)&&w==WeaponId.Sword&&f==FactionId.Fire,"fighter has delivered sword and Fire sound context");
 arena.ConfirmedFx(new ServerMsg.Fx{Tick=tick,List=new List<WireFx>{new WireFx{Kind=FxKind.Swing,By=101}}});arena.Present(actors,null,null,0);
 var catalog=Resources.Load<ShowcaseCatalog>("Showcase/Catalog");Check(catalog.Find("hero").Attack.Contains(Part(root,"Authored character").sprite),"confirmed Swing visibly selects fighter attack catalog");
 File.WriteAllText(output+"/fighter-before.json",JsonConvert.SerializeObject(Receipt("fighter-before"),Formatting.Indented));
 Empty(101,root);Deliver(Giver(201,0,0,0));Check(Root().GetInstanceID()==rootId,"fighter to giver reuses same pooled root");Anchored();
 Check(actors[0].Kind==ActorKind.QuestGiver&&!actors[0].Faction.HasValue&&!actors[0].Weapon.HasValue&&!actors[0].MobType.HasValue,"kind4 ff mob0 decodes to absent fighter identity");
 Check(Part(root,"Authored character").sprite==ShowcaseIdentityAssets.GetFactionSilhouette(-1),"giver uses exact neutral silhouette");Check(!Part(root,"Equipped weapon cue").enabled&&Part(root,"Equipped weapon cue").sprite==null,"giver weapon cue cleared");Check(!arena.TrySoundContext(201,out w,out f,out k,out m),"giver has no fabricated combat sound context");
 Check(Part(root,"Faction footprint").sprite==FactionIndicators.GetFootprint(-1),"giver has neutral diamond footprint");Check(Part(root,"Faction insignia").sprite==ShowcaseSprites.Get("rune"),"giver has neutral insignia");
 Check(!Part(root,"Confirmed barrier").enabled&&!root.GetComponentsInChildren<SpriteRenderer>(true).Any(s=>s.name.StartsWith("Barrier ring step ")&&s.enabled),"zero delivered barrier and ring clear fighter state");Check(!root.GetComponentsInChildren<SpriteRenderer>(true).Any(s=>s.name.StartsWith("Signature ")&&s.enabled),"zero signature clears fighter signature");
 File.WriteAllText(output+"/giver-zero-after-fighter.json",JsonConvert.SerializeObject(Receipt("giver-zero-after-fighter"),Formatting.Indented));
 Deliver(Giver(201,35,4,1|2|64));Anchored();Check(Part(root,"Confirmed barrier").enabled&&Mathf.Abs(Part(root,"Confirmed barrier").transform.localScale.x-.35f*.85f)<.00001f,"explicit giver barrier35 has exact width");Check(root.GetComponentsInChildren<SpriteRenderer>(true).Count(s=>s.name.StartsWith("Barrier ring step ")&&s.enabled)==4,"explicit giver ring4 retained");Check(Part(root,"Signature chilled (1)").enabled&&Part(root,"Signature burning (2)").enabled&&Part(root,"Signature execute-blocked (64)").enabled,"explicit giver signature bits retained");
 arena.ConfirmedFx(new ServerMsg.Fx{Tick=tick,List=new List<WireFx>{new WireFx{Kind=FxKind.Swing,By=201}}});arena.Present(actors,null,null,0);Check(Part(root,"Authored character").sprite==ShowcaseIdentityAssets.GetFactionSilhouette(-1),"giver cannot inherit or start fighter attack after Swing");
 phase.text="NEUTRAL GIVER  |  kind 4 · kit FF · mob 0  |  no weapon / no combat sound context";note.text="Synthetic payload case: HP 82% · barrier 35% · ring 4 · signature 1+2+64  |  Same pooled actor root";
 yield return Capture("decoded-giver-native");
 Empty(201,root);Deliver(Fighter(301,3,1));Check(Root().GetInstanceID()==rootId,"giver to fighter reuses same pooled root");Anchored();
 Check(Part(root,"Equipped weapon cue").enabled&&Part(root,"Equipped weapon cue").sprite==ShowcaseSprites.Get("weapon1"),"new fighter has delivered bow cue");Check(catalog.Find("hero-female").Idle.Contains(Part(root,"Authored character").sprite),"new fighter has idle appearance with no stale attack phase");Check(arena.TrySoundContext(301,out w,out f,out k,out m)&&w==WeaponId.Bow&&f==FactionId.Frost&&k==ActorKind.Player,"reused fighter has current Frost bow sound context");Check(!Part(root,"Signature burning (2)").enabled&&!Part(root,"Signature execute-blocked (64)").enabled,"giver signature marks do not leak into fighter");Check(root.GetComponentsInChildren<SpriteRenderer>(true).Count(s=>s.name.StartsWith("Barrier ring step ")&&s.enabled)==3,"new fighter uses current delivered ring3");
 phase.text="FROST FIGHTER AFTER GIVER REUSE  |  delivered bow · idle animation · current sound context";note.text="Same pooled root · ground anchor preserved · 1.2 XY / 1 Z  |  Presentation-only review; no network";
 yield return Capture("reused-fighter-native");
 File.WriteAllText(output+"/harness-checks.json",JsonConvert.SerializeObject(new{source,complete=true,rootInstanceId=rootId,decodedFrames=buffer.Count,checks},Formatting.Indented));Debug.Log("[decoded-giver-review] complete");
}
host.StartCoroutine(Run());return new{started=true,source,scope="decoded wire presentation only; no network"};

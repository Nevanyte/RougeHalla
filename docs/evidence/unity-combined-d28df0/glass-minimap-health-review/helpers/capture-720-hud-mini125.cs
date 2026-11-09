using System;
using System.Collections;
using System.Collections.Generic;
using UnityEngine.EventSystems;
using UnityEngine.Rendering.Universal;
using Roguehalla.Net;
using System.IO;
using System.Linq;
using UnityEngine;
using UnityEngine.UI;
using TMPro;
using Newtonsoft.Json;
using Roguehalla.Client;
const string sourceSha="d28df076bf98d10bfe6cb5fbc88b8d30a3fbe712";
const string mode="hud";
const int expectedWidth=1280, expectedHeight=720;
const string outputFolder="/Users/nevinmckinnon/.codex/tools/rougehalla-unity-art/combined-d28df0-2026-11-08/evidence/layouts";
var review=UnityEngine.Object.FindFirstObjectByType<UiLayoutReview>();
var client=UnityEngine.Object.FindFirstObjectByType<MatchClient>();
if(!Application.isPlaying||review==null||!review.IsReady||client?.Session==null)throw new InvalidOperationException("Ready offline fixture required");
string PathOf(Transform t){string p=t.name;while(t.parent!=null){t=t.parent;p=t.name+"/"+p;}return p;}
float[] BoundsOf(RectTransform r){var c=new Vector3[4];r.GetWorldCorners(c);var p=c.Select(v=>RectTransformUtility.WorldToScreenPoint(null,v)).ToArray();return new[]{p.Min(v=>v.x),p.Min(v=>v.y),p.Max(v=>v.x),p.Max(v=>v.y)};}
float[] V3(Vector3 v){return new[]{v.x,v.y,v.z};}
object RendererInfo(SpriteRenderer r){return new{name=r.name,sprite=r.sprite!=null?r.sprite.name:null,localPosition=V3(r.transform.localPosition),localScale=V3(r.transform.localScale),worldMin=V3(r.bounds.min),worldMax=V3(r.bounds.max)};}
Color32[] InspectTexture(Texture2D tex){if(tex==null)return new Color32[0];if(tex.isReadable)return tex.GetPixels32();var previous=RenderTexture.active;var temporary=RenderTexture.GetTemporary(tex.width,tex.height,0,RenderTextureFormat.ARGB32);Texture2D readback=null;try{Graphics.Blit(tex,temporary);RenderTexture.active=temporary;readback=new Texture2D(tex.width,tex.height,TextureFormat.RGBA32,false);readback.ReadPixels(new Rect(0,0,tex.width,tex.height),0,0);readback.Apply();return readback.GetPixels32();}finally{RenderTexture.active=previous;RenderTexture.ReleaseTemporary(temporary);if(readback!=null)UnityEngine.Object.Destroy(readback);}}
IEnumerator CapturePair(){
 foreach(float textScale in new[]{1.5f}){
  review.SetTextScale(textScale);int initialFrame=Time.frameCount;double initialNewestMs=client.Session.Snapshots.NewestMs;
  yield return null;yield return new WaitForSecondsRealtime(.15f);Canvas.ForceUpdateCanvases();
  foreach(var t in UnityEngine.Object.FindObjectsByType<TMP_Text>(FindObjectsSortMode.None))if(t.isActiveAndEnabled)t.ForceMeshUpdate();
  yield return new WaitForEndOfFrame();
  Texture2D shot=null;
  try{
   int screenWidth=Screen.width,screenHeight=Screen.height;shot=ScreenCapture.CaptureScreenshotAsTexture();
   bool watermark=UnityEngine.Object.FindObjectsByType<TMP_Text>(FindObjectsSortMode.None).Any(t=>t.isActiveAndEnabled&&t.text!=null&&t.text.Contains("STAGED UI REVIEW")&&t.text.Contains("NO NETWORK"));
   var canvases=UnityEngine.Object.FindObjectsByType<Canvas>(FindObjectsSortMode.None).Where(c=>c.isActiveAndEnabled&&c.isRootCanvas).Select(c=>new{name=c.name,mode=c.renderMode.ToString(),pixelRect=new[]{c.pixelRect.x,c.pixelRect.y,c.pixelRect.width,c.pixelRect.height},scale=c.scaleFactor}).ToArray();
   var controls=UnityEngine.Object.FindObjectsByType<Selectable>(FindObjectsSortMode.None).Where(t=>t.isActiveAndEnabled).Select(t=>{var b=BoundsOf((RectTransform)t.transform);var scroll=t.GetComponentInParent<ScrollRect>();var hits=new List<RaycastResult>();if(EventSystem.current!=null)EventSystem.current.RaycastAll(new PointerEventData(EventSystem.current){position=new Vector2((b[0]+b[2])*.5f,(b[1]+b[3])*.5f)},hits);var top=hits.Count>0?hits[0].gameObject:null;var target=top!=null?top.GetComponentInParent<Selectable>():null;return new{path=PathOf(t.transform),centerRaycastAvailable=EventSystem.current!=null,topHit=top!=null?PathOf(top.transform):null,topSelectable=target!=null?PathOf(target.transform):null,centerHitsSelf=target==t,bounds=b,width=b[2]-b[0],height=b[3]-b[1],interactable=t.IsInteractable(),inScroll=scroll!=null,insideScreen=b[0]>=-.5f&&b[1]>=-.5f&&b[2]<=screenWidth+.5f&&b[3]<=screenHeight+.5f};}).ToArray();
   var texts=UnityEngine.Object.FindObjectsByType<TMP_Text>(FindObjectsSortMode.None).Where(t=>t.isActiveAndEnabled&&t.GetComponentInParent<Canvas>()!=null&&!string.IsNullOrWhiteSpace(t.text)).Select(t=>new{path=PathOf(t.transform),text=t.text,font=t.font!=null?t.font.name:null,fontSize=t.fontSize,autoSize=t.enableAutoSizing,overflow=t.isTextOverflowing,truncated=t.isTextTruncated,overflowMode=t.overflowMode.ToString(),bounds=BoundsOf(t.rectTransform),inScroll=t.GetComponentInParent<ScrollRect>()!=null,rect=new[]{t.rectTransform.rect.width,t.rectTransform.rect.height},preferred=new[]{t.preferredWidth,t.preferredHeight}}).ToArray();
   var observed=new List<InterpActor>();client.Session.Snapshots.Sample(client.Session.Snapshots.NewestMs,observed);var me=client.Session.Me;
   var anchors=observed.Where(a=>me==null||a.Id!=me.Id).Select(a=>new KeyValuePair<uint,Vector3>(a.Id,Roguehalla.Client.ArenaView.WorldPoint(a.X,a.Y))).ToList();if(me!=null)anchors.Add(new KeyValuePair<uint,Vector3>(me.Id,Roguehalla.Client.ArenaView.WorldPoint(me.X,me.Y)));
   var camera=Camera.main;var cameraInfo=new{orthographic=camera.orthographic,orthographicSize=camera.orthographicSize,position=V3(camera.transform.position),aspect=camera.aspect};
   var actors=UnityEngine.Object.FindObjectsByType<Transform>(FindObjectsSortMode.None).Where(t=>t.name=="Observed actor"&&t.gameObject.activeInHierarchy).Select(t=>{var matches=anchors.Where(a=>(a.Value-t.position).sqrMagnitude<.000001f).ToArray();var sprites=t.GetComponentsInChildren<SpriteRenderer>().Where(r=>r.enabled&&r.gameObject.activeInHierarchy).ToArray();return new{rootWorldAnchor=V3(t.position),rootLocalScale=V3(t.localScale),rootLossyScale=V3(t.lossyScale),matchingDeliveredAnchorCount=matches.Length,uniqueObservedId=matches.Length==1?matches[0].Key:0,deliveredAnchor=matches.Length==1?V3(matches[0].Value):null,body=sprites.Where(r=>r.name=="Authored character").Select(RendererInfo).ToArray(),overhead=sprites.Where(r=>r.name.Contains("health")||r.name.Contains("Health")||r.name.Contains("barrier")||r.name.Contains("Barrier")||r.name.Contains("insignia")||r.name.Contains("status")||r.name.Contains("Signature")||r.name.Contains("badge")||r.name.Contains("emblem")).Select(RendererInfo).ToArray(),lights=t.GetComponentsInChildren<Light2D>(true).Select(l=>new{name=l.name,enabled=l.enabled,innerRadius=l.pointLightInnerRadius,outerRadius=l.pointLightOuterRadius,worldPosition=V3(l.transform.position),lossyScale=V3(l.transform.lossyScale),transformDerivedWorldOuterRadius=l.pointLightOuterRadius*Mathf.Max(Mathf.Abs(l.transform.lossyScale.x),Mathf.Abs(l.transform.lossyScale.y))}).ToArray()};}).ToArray();
   var graphics=review.Hud.GetComponentsInChildren<Graphic>(true).Select(g=>new{path=PathOf(g.transform),type=g.GetType().Name,active=g.isActiveAndEnabled,inHierarchy=g.gameObject.activeInHierarchy,color=new[]{g.color.r,g.color.g,g.color.b,g.color.a},rendererColor=g.GetComponent<CanvasRenderer>()!=null?new[]{g.GetComponent<CanvasRenderer>().GetColor().r,g.GetComponent<CanvasRenderer>().GetColor().g,g.GetComponent<CanvasRenderer>().GetColor().b,g.GetComponent<CanvasRenderer>().GetColor().a}:null,raycastTarget=g.raycastTarget,sprite=g is Image im&&im.sprite!=null?im.sprite.name:null,canvasGroups=g.GetComponentsInParent<CanvasGroup>(true).Select(q=>new{path=PathOf(q.transform),alpha=q.alpha,blocksRaycasts=q.blocksRaycasts,interactable=q.interactable}).ToArray()}).ToArray();
   var uiRoots=review.Hud.GetComponentsInChildren<RectTransform>(true).Where(r=>new[]{"PlayerHUD","VitalsPanel","BuildStrip","CombatActions","WishPanel","Minimap","TacticalMap","Rewards","Settings","Help","BuildDrawer"}.Contains(r.name)).Select(r=>new{path=PathOf(r),name=r.name,activeSelf=r.gameObject.activeSelf,activeInHierarchy=r.gameObject.activeInHierarchy,bounds=BoundsOf(r),anchorMin=new[]{r.anchorMin.x,r.anchorMin.y},anchorMax=new[]{r.anchorMax.x,r.anchorMax.y}}).ToArray();
   var surfaces=review.Hud.GetComponentsInChildren<TacticalMapSurface>(true).Select(v=>{var raw=v.GetComponent<RawImage>();var tex=raw!=null?raw.texture as Texture2D:null;var colors=InspectTexture(tex);return new{path=PathOf(v.transform),active=v.isActiveAndEnabled,textureWidth=tex!=null?tex.width:0,textureHeight=tex!=null?tex.height:0,rawImageAlpha=raw!=null?raw.color.a:0,textureReadable=tex!=null&&tex.isReadable,textureInspection="Direct CPU pixels when readable; otherwise temporary GPU Blit/readback with active RT restored",textureAlphaCounts=colors.GroupBy(c=>c.a).Select(q=>new{alpha=q.Key,count=q.Count()}).OrderBy(q=>q.alpha).ToArray()};}).ToArray();
   var minimapPrefs=new UiDisplayPreferences();var mapState=new{isOpen=review.Hud.TacticalMap.IsOpen,isPlanning=review.Hud.TacticalMap.IsPlanning,blocksKeyboard=review.Hud.BlocksKeyboardInput,blocksPointer=review.Hud.BlocksPointerInput,savedScaleKey=PlayerPrefs.HasKey("rh.ui.minimapScale"),savedScaleIndex=PlayerPrefs.GetInt("rh.ui.minimapScale",1),loadedScale=minimapPrefs.MinimapScale};
   string key=expectedHeight+"-"+mode+"-text"+(textScale>1.1f?"150":"100")+"-mini125";Directory.CreateDirectory(outputFolder);File.WriteAllBytes(outputFolder+"/"+key+".png",shot.EncodeToPNG());
   var data=new{sourceSha,mode,textScale,expectedWidth,expectedHeight,screenWidth,screenHeight,imageWidth=shot.width,imageHeight=shot.height,initialFrame,frame=Time.frameCount,advanced=Time.frameCount>initialFrame,initialNewestMs,newestMs=client.Session.Snapshots.NewestMs,ticksAdvanced=client.Session.Snapshots.NewestMs>initialNewestMs,isReady=review.IsReady,stagedWatermark=watermark,nativeDimensionsMatch=screenWidth==expectedWidth&&screenHeight==expectedHeight&&shot.width==expectedWidth&&shot.height==expectedHeight,background=Application.runInBackground,quality=ShowcaseSettings.Current.EffectiveQuality.ToString(),reducedMotion=ShowcaseSettings.Current.ReducedMotion,method="Public ScreenCapture.CaptureScreenshotAsTexture at WaitForEndOfFrame; original native PNG, no resizing",canvases,controls,texts,cameraInfo,actors,graphics,uiRoots,surfaces,mapState};
   File.WriteAllText(outputFolder+"/"+key+".json",JsonConvert.SerializeObject(data,Formatting.Indented));
   if(!data.nativeDimensionsMatch||!data.isReady||!data.advanced||!data.ticksAdvanced||!watermark)throw new InvalidOperationException("Capture readiness/dimension precondition failed: "+key);
   Debug.Log("[compact-layout-capture] "+key+" native "+shot.width+"x"+shot.height);
  }finally{if(shot!=null)UnityEngine.Object.Destroy(shot);}
 }
}
review.StartCoroutine(CapturePair());return new{requested=true,mode,expectedWidth,expectedHeight};

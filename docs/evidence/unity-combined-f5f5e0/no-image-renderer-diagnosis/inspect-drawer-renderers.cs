using System;
using System.Collections;
using System.Collections.Generic;
using System.Linq;
using System.IO;
using UnityEngine;
using UnityEngine.UI;
using UnityEditor;
using Roguehalla.Client;
using Newtonsoft.Json;
const string output="/Users/nevinmckinnon/.codex/tools/rougehalla-unity-art/combined-f5f5e0-2026-11-08/diagnostics";
var review=UnityEngine.Object.FindFirstObjectByType<UiLayoutReview>();
if(!Application.isPlaying||review==null||!review.IsReady)throw new Exception("Ready exact offline HUD fixture required");
string PathOf(Transform t){string s=t.name;while(t.parent!=null){t=t.parent;s=t.name+"/"+s;}return s;}
float[] V3(Vector3 v){return new[]{v.x,v.y,v.z};}
float[] ColorOf(Color c){return new[]{c.r,c.g,c.b,c.a};}
float[] BoundsOf(RectTransform r){var c=new Vector3[4];r.GetWorldCorners(c);var p=c.Select(v=>RectTransformUtility.WorldToScreenPoint(null,v)).ToArray();return new[]{p.Min(v=>v.x),p.Min(v=>v.y),p.Max(v=>v.x),p.Max(v=>v.y)};}
bool Overlap(float[] a,float[] b){return a[0]<b[2]&&a[2]>b[0]&&a[1]<b[3]&&a[3]>b[1];}
object MaterialInfo(Material m){if(m==null)return null;var props=new Dictionary<string,object>();foreach(var n in new[]{"_Stencil","_StencilComp","_StencilOp","_ColorMask","_StencilReadMask","_StencilWriteMask","_UseUIAlphaClip"})props[n]=m.HasProperty(n)?(object)m.GetFloat(n):null;props["_Color"]=m.HasProperty("_Color")?(object)ColorOf(m.GetColor("_Color")):null;props["_ClipRect"]=m.HasProperty("_ClipRect")?(object)new[]{m.GetVector("_ClipRect").x,m.GetVector("_ClipRect").y,m.GetVector("_ClipRect").z,m.GetVector("_ClipRect").w}:null;return new{name=m.name,id=m.GetInstanceID(),shader=m.shader!=null?m.shader.name:null,shaderId=m.shader!=null?m.shader.GetInstanceID():0,renderQueue=m.renderQueue,keywords=m.shaderKeywords,passCount=m.passCount,compiledPasses=Enumerable.Range(0,m.passCount).Select(i=>new{pass=i,compiled=ShaderUtil.IsPassCompiled(m,i)}).ToArray(),properties=props};}
Graphic[] Targets(){var all=review.Hud.GetComponentsInChildren<Graphic>(true);return all.Where(g=>PathOf(g.transform).Contains("/BuildDrawer/")&&(g.name=="Viewport"||PathOf(g.transform).Contains("/Content/Card0")||PathOf(g.transform).Contains("/Content/Card1")||PathOf(g.transform).Contains("/Content/Card2")||PathOf(g.transform).Contains("/Content/Card3"))).ToArray();}
object Snapshot(string phase){var viewport=review.Hud.transform.Find("MatchUI/BuildDrawer/CardCatalogScroll/Viewport");var vr=(RectTransform)viewport;var clip=BoundsOf(vr);var mask=viewport.GetComponent<UnityEngine.UI.Mask>();var graphics=Targets().Select(g=>{var cr=g.GetComponent<CanvasRenderer>();var mesh=cr!=null?cr.GetMesh():null;var rect=BoundsOf((RectTransform)g.transform);var colors=mesh!=null?mesh.colors32:new Color32[0];return new{path=PathOf(g.transform),type=g.GetType().Name,active=g.isActiveAndEnabled,componentColor=ColorOf(g.color),depth=g.depth,bounds=rect,intersectsViewport=Overlap(rect,clip),renderer=cr==null?null:new{absoluteDepth=cr.absoluteDepth,relativeDepth=cr.relativeDepth,cull=cr.cull,cullTransparentMesh=cr.cullTransparentMesh,hasRectClipping=cr.hasRectClipping,clippingSoftness=new[]{cr.clippingSoftness.x,cr.clippingSoftness.y},hasPopInstruction=cr.hasPopInstruction,materialCount=cr.materialCount,popMaterialCount=cr.popMaterialCount,normalMaterials=Enumerable.Range(0,cr.materialCount).Select(i=>MaterialInfo(cr.GetMaterial(i))).ToArray(),popMaterials=Enumerable.Range(0,cr.popMaterialCount).Select(i=>MaterialInfo(cr.GetPopMaterial(i))).ToArray()},materialForRendering=MaterialInfo(g.materialForRendering),mesh=mesh==null?null:new{vertexCount=mesh.vertexCount,triangleIndexCount=mesh.triangles.Length,localBoundsCenter=V3(mesh.bounds.center),localBoundsSize=V3(mesh.bounds.size),colors=colors.GroupBy(c=>new{c.r,c.g,c.b,c.a}).Select(q=>new{rgba=new[]{(int)q.Key.r,(int)q.Key.g,(int)q.Key.b,(int)q.Key.a},count=q.Count()}).ToArray()}};}).ToArray();return new{phase,frame=Time.frameCount,realtime=Time.realtimeSinceStartupAsDouble,source="f5f5e016555755fb3e11b77026234148c107ca6b",anythingCompiling=ShaderUtil.anythingCompiling,scriptCompiling=EditorApplication.isCompiling,updating=EditorApplication.isUpdating,viewport=new{path=PathOf(viewport),bounds=clip,maskEnabled=mask.enabled,showMaskGraphic=mask.showMaskGraphic,maskImageColor=ColorOf(viewport.GetComponent<UnityEngine.UI.Image>().color),parentRectMasks=viewport.GetComponentsInParent<RectMask2D>(true).Select(r=>new{path=PathOf(r.transform),canvasRect=new[]{r.canvasRect.x,r.canvasRect.y,r.canvasRect.width,r.canvasRect.height}}).ToArray()},graphics};}
Material[] VisibleMaterials(){var viewport=review.Hud.transform.Find("MatchUI/BuildDrawer/CardCatalogScroll/Viewport");var vr=BoundsOf((RectTransform)viewport);var mats=new List<Material>();foreach(var g in Targets()){var cr=g.GetComponent<CanvasRenderer>();if(!g.isActiveAndEnabled||cr==null||cr.cull||!Overlap(BoundsOf((RectTransform)g.transform),vr))continue;if(g.name!="Viewport"&&g.name!="Card0"&&g.name!="Card1")continue;for(int i=0;i<cr.materialCount;i++)if(cr.GetMaterial(i)!=null)mats.Add(cr.GetMaterial(i));for(int i=0;i<cr.popMaterialCount;i++)if(cr.GetPopMaterial(i)!=null)mats.Add(cr.GetPopMaterial(i));}return mats.Distinct().ToArray();}
var samples=new List<object>();
IEnumerator Inspect(){
 int startFrame=Time.frameCount;bool before=ShaderUtil.anythingCompiling;double started=Time.realtimeSinceStartupAsDouble;
 var details=review.Hud.transform.Find("MatchUI/PlayerHUD/BuildStrip/BuildDetails").GetComponent<UnityEngine.UI.Button>();details.onClick.Invoke();
 samples.Add(Snapshot("immediately-after-existing-button"));
 int stable=0;string previous=null;bool complete=false;int polls=0;
 while(polls<600&&Time.realtimeSinceStartupAsDouble-started<15){
  yield return new WaitForEndOfFrame();polls++;
  var materials=VisibleMaterials();bool all=materials.Length>=3&&materials.All(m=>m.passCount>0&&Enumerable.Range(0,m.passCount).All(i=>ShaderUtil.IsPassCompiled(m,i)));bool any=ShaderUtil.anythingCompiling;string state=any+":"+all+":"+materials.Length;
  if(state!=previous||polls==1){samples.Add(Snapshot("readiness-transition-"+polls));previous=state;}
  stable=!any&&all?stable+1:0;
  if(stable>=6){complete=true;break;}
 }
 samples.Add(Snapshot("final-observation"));
 var result=new{source="f5f5e016555755fb3e11b77026234148c107ca6b",noImageReplay=true,noSourceOrMaterialPropertyMutation=true,shaderStatusBeforeButton=before,startFrame,endFrame=Time.frameCount,framesAdvanced=Time.frameCount>startFrame,polls,stableReadyFrames=stable,observedCompiledReadiness=complete,scope="One same-source offline replay. No new image, shader compile/warmup request, material edit or timing-performance acceptance. No framebuffer/cyan-absence claim is possible from these facts alone.",samples};
 File.WriteAllText(output+"/live-renderer-facts.json",JsonConvert.SerializeObject(result,Formatting.Indented));Debug.Log("[drawer-renderer-diagnostic] complete ready="+complete+" polls="+polls);
}
review.StartCoroutine(Inspect());return new{requested=true,noImage=true};

import { afterEach, describe, expect, it, vi } from "vitest";
import { FIELD_KINDS, type TimedFx } from "@raid/shared";
import { FieldView, type FieldStateLike } from "../src/render/FieldView";
import { FxView } from "../src/render/FxView";
import { ProjectileView } from "../src/render/ProjectileView";
import { QuestView } from "../src/render/QuestView";
import { WishFx } from "../src/render/WishFx";
import { fakeScene, argsOf } from "./fakes";
import { resetReducedMotionCache } from "../src/render/juice";
afterEach(() => { vi.unstubAllGlobals(); resetReducedMotionCache(); });

// A visual can start in sight, cross the boundary, and return without replaying a stale event.
describe("vision across transient renderers", () => {
  it("culls projectiles at their current ground point and restores them upon entering vision", () => {
    const {scene, made} = fakeScene(), view = new ProjectileView(scene);
    view.noteLaunch({id:"a",kind:"arrow",x:100,y:100,vx:900,vy:0,t:1000,range:1000});
    const canSee = (p:{x:number})=>p.x<200;
    view.update(1000, undefined, canSee); expect(made[0]!.state.visible).toBe(true);
    view.update(1200, undefined, canSee); expect(made[0]!.state.visible).toBe(false);
    view.update(1250, undefined, ()=>true); expect(made[0]!.state.visible).toBe(true);
    view.destroy(); expect(argsOf(made[0]!, "destroy")).toHaveLength(1);
  });
  it("removes an ongoing field when vision expires and keeps hidden clouds and unseen trail endpoints off-screen", () => {
    const {scene, made} = fakeScene(), view = new FieldView(scene);
    const field: FieldStateLike = {kind:0,ability:0,x:100,y:100,x2:600,y2:100,r:80,vx:0,vy:0,owner:"foe",subject:"",startedAt:1000,endsAt:5000};
    // Read the schema wire codes from the shared catalog.
    const fields = new Map([["f",field]]);
    view.update(fields,1000,1000,()=>undefined,"me",()=>true);
    expect(made).toHaveLength(1);
    view.update(fields,1100,1100,()=>undefined,"me",()=>false);
    expect(argsOf(made[0]!,"destroy")).toHaveLength(1);
    fields.set("f", {...field,kind:FIELD_KINDS.indexOf("cloud")});
    view.update(fields,1200,1200,()=>undefined,"me",()=>true);
    expect(made).toHaveLength(1);
    fields.set("f", {...field,kind:FIELD_KINDS.indexOf("trail")});
    view.update(fields,1300,1300,()=>undefined,"me",p=>p.x<500);
    expect(made).toHaveLength(1);
  });
  it("does not emit projectile impacts or death location decals outside vision", () => {
    const {scene,made} = fakeScene();
    const done = vi.fn();
    const view = new FxView(scene,{localId:"me",position:()=>undefined,view:()=>undefined,name:()=>"Foe",projectileEnded:done,canSee:()=>false});
    view.enqueue({kind:"projEnd",id:"a",proj:"arrow",x0:100,y0:100,t0:900,x:300,y:100,reason:"wall",t:1000});
    view.enqueue({kind:"death",id:"foe",by:"me",x:300,y:100,t:1000});
    view.update(1000,1000,true);
    expect(done).toHaveBeenCalledWith("a"); expect(made).toEqual([]);
  });
  it("drops an ongoing telegraph as its source disappears and rejects an unseen cast landing", () => {
    const {scene,made} = fakeScene(); let visible=true;
    const view = new WishFx(scene,{localId:"me",position:()=>visible?{x:100,y:100}:undefined,canSee:()=>visible,hidden:()=>!visible});
    view.play({kind:"cast",by:"foe",ability:"freeze",ms:500,target:null,x:100,y:100,t:1000},1000);
    view.update(1100); expect(made).toHaveLength(1);
    visible=false;view.update(1200); expect(made[0]!.state.visible).toBe(false);
    view.play({kind:"castLand",by:"foe",ability:"freeze",target:null,x:100,y:100,t:1200} as TimedFx,1200);
    expect(made).toHaveLength(1);view.destroy();
  });
  it("drops fighter effects immediately when Swarm hides their source", () => {
    const {scene,made} = fakeScene(); let visible = true;
    const view = new FxView(scene,{localId:"me",position:()=>visible?{x:500,y:500}:undefined,view:()=>undefined,name:()=>"Foe",projectileEnded:()=>{},canSee:()=>true});
    view.enqueue({kind:"windup",by:"foe",weapon:"sword",a:0,ms:500,t:1000});
    view.update(1000,1000,true); expect(made[0]!.state.visible).toBe(true);
    visible=false; view.update(1100,1100,true); expect(made[0]!.state.visible).toBe(false);
  });
  it("keeps a visible swing at its event position and rejects a hidden source", () => {
    const {scene,made} = fakeScene(); let visible = true;
    const view = new FxView(scene,{localId:"me",position:()=>visible?{x:500,y:500}:undefined,view:()=>undefined,name:()=>"Foe",projectileEnded:()=>{},canSee:p=>p.x>400});
    const swing = {kind:"swing",by:"foe",weapon:"sword",x:500,y:500,a:0,t:1000} as TimedFx;
    view.enqueue(swing); view.update(1000,1000,true); expect(made[0]!.state.visible).toBe(true);
    visible=false; view.enqueue({...swing,t:1100}); view.update(1100,1100,true); expect(made).toHaveLength(1);
  });
  it("does not fall back to synced carrier coordinates when a quest carrier is outside vision", () => {
    const {scene,ofKind} = fakeScene(), view = new QuestView(scene);
    view.update({quests:new Map([["q",{id:"q",def:"banner-fire",x:100,y:100,status:"open",expiresAt:5000,doneBy:"",carrier:"foe",accepted:new Map([["me",true]]),progress:new Map()}]]),
      containers:new Map(),players:new Map([["foe",{x:600,y:600,status:"alive"}]]),positions:new Map(),localId:"me",canSee:p=>p.x<200});
    expect(ofKind("container")).toHaveLength(1);view.destroy();
  });
});

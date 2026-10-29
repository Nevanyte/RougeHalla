import { afterEach, describe, expect, it, vi } from "vitest";
import { EFFECT_HIDDEN, mapFromTiles } from "@raid/shared";
import { RaidScene } from "../src/scenes/RaidScene";
import { RaidVision } from "../src/render/RaidVision";

vi.mock("phaser", () => ({default: {Scene: class {}}}));
vi.mock("../src/render/PlayerView", () => ({PlayerView: class {
  update = vi.fn(); destroy = vi.fn();
}}));
vi.mock("../src/render/MobView", () => ({MobView: class {
  update = vi.fn(); destroy = vi.fn();
}}));
afterEach(() => vi.restoreAllMocks());

function rig() {
  const map = mapFromTiles(150, 100, new Uint8Array(150 * 100), 17);
  const me = {x:400,y:400,status:"alive",effects:0};
  const foe = {x:1100,y:400,status:"alive",effects:0};
  const mob = {x:1100,y:430,status:"alive",effects:0,kind:"mob"};
  const state: any = {seed:17,gatesLocked:false,training:false,phase:"active",serverTime:1000,
    players:new Map([["me",me],["foe",foe]]),mobs:new Map([["mob",mob]]),containers:new Map(),quests:new Map(),fields:new Map(),camps:[]};
  const noop = () => {};
  const view = {update:noop};
  const scene: any = new RaidScene();
  let now = 1000;
  vi.spyOn(performance, "now").mockImplementation(() => now);
  Object.assign(scene, {
    room:{state,sessionId:"me"},mapView:{map,setGatesLocked:noop},
    vision:new RaidVision(),fog:{update:noop},campWards:view,edgeThreats:view,campTimers:view,
    minimap:{setGatesLocked:noop,setMobs:vi.fn(),setChests:noop,setQuests:noop,setCampStates:noop,update:noop},
    input:{activePointer:{rightButtonDown:()=>false}},
    interp:{renderTime:()=>now,clock:{synced:true,now:()=>now}},juice:{worldTime:(t:number)=>t},
    stepLocal:noop,localSource:()=>"snapshot",
    sampleDrawn(this:any,id:string,_time:number,p:any) { this.tmp.x=p.x;this.tmp.y=p.y;this.rendered.set(id,{x:p.x,y:p.y}); },
    cameras:{main:{centerOn:noop,scrollX:0,scrollY:0,width:1600,height:900}},
    trainingBar:view,deathPending:()=>false,markIsDim:()=>false,ground:{statesOf:()=>({}),forget:noop},projectiles:view,fieldView:view,syncContainers:noop,updateChestPanel:noop,updateQuestDialog:noop,
    questView:view,questLog:{trackedId:null,update:noop,setDestination:noop},updateTargets:noop,opponentInspector:view,
    streamAim:noop,fx:view,wishFx:view,trackArenaDamage:noop,feedback:view,hud:{...view,setTerrain:noop},weaponBar:view,
    updateWishSlot:noop,updatePlanning:noop,trackRoute:noop,
  });
  return {scene,state,me,foe,mob,frame:(time:number)=>{now=time;state.serverTime=time;scene.update(time);}};
}

describe("RaidScene vision integration", () => {
  it("keeps live enemies during the trail and destroys views, hover positions, and minimap dots when it expires", () => {
    const {scene,me,frame} = rig(); frame(1000);
    const enemyView = scene.views.get("foe"), mobView = scene.mobViews.get("mob");
    expect(enemyView).toBeDefined(); expect(mobView).toBeDefined();
    me.x=3700; frame(1100);
    expect(scene.views.get("foe")).toBe(enemyView);
    frame(120999); expect(scene.rendered.has("foe")).toBe(true);
    frame(121000);
    expect(enemyView.destroy).toHaveBeenCalledOnce(); expect(mobView.destroy).toHaveBeenCalledOnce();
    expect(scene.rendered.has("foe")).toBe(false); expect(scene.rendered.has("mob")).toBe(false);
    expect(scene.visiblePosition("foe")).toBeUndefined(); expect(scene.targetCandidates()).toEqual([]);
    const mobs = scene.minimap.setMobs.mock.lastCall[0], ids: string[] = [];
    mobs.forEach((_mob:any,id:string)=>ids.push(id)); expect(ids).toEqual([]);
    expect(scene.rendered.has("me")).toBe(true);
  });
  it("removes Swarm immediately and recreates a newly visible actor without stale view state", () => {
    const {scene,foe,frame} = rig(); frame(1000);
    const old = scene.views.get("foe");
    foe.effects=EFFECT_HIDDEN; frame(1100);
    expect(old.destroy).toHaveBeenCalledOnce(); expect(scene.views.has("foe")).toBe(false);
    expect(scene.visiblePosition("foe")).toBeUndefined();
    foe.effects=0; frame(1200);
    expect(scene.views.get("foe")).toBeDefined(); expect(scene.views.get("foe")).not.toBe(old);
  });
  it("keeps lobby and training actors available while raid fog is disabled", () => {
    const {scene,state,foe,frame} = rig(); foe.x=4000;state.phase="lobby";frame(1000);
    expect(scene.views.has("foe")).toBe(true);
    state.phase="active";state.training=true;frame(1100);
    expect(scene.views.has("foe")).toBe(true);
    state.training=false;frame(1200); expect(scene.views.has("foe")).toBe(false);
  });
});

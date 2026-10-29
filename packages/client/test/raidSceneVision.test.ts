import { afterEach, describe, expect, it, vi } from "vitest";
import { EFFECT_HIDDEN, QUEST_ITEM_PREFIX, mapFromTiles } from "@raid/shared";
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
  const me = {x:400,y:400,status:"alive",effects:0,faction:"fire",huntTarget:""};
  const foe = {x:1100,y:400,status:"alive",effects:0,faction:"frost"};
  const mob = {x:1100,y:430,status:"alive",effects:0,kind:"mob"};
  const state: any = {seed:17,gatesLocked:false,training:false,phase:"active",serverTime:1000,
    players:new Map([["me",me],["foe",foe]]),mobs:new Map([["mob",mob]]),containers:new Map(),quests:new Map(),plagueCorpses:new Map(),fields:new Map(),camps:[]};
  const noop = () => {};
  const view = {update:noop};
  const scene: any = new RaidScene();
  let now = 1000;
  vi.spyOn(performance, "now").mockImplementation(() => now);
  Object.assign(scene, {
    room:{state,sessionId:"me"},mapView:{map,setGatesLocked:noop},
    plagueCorpseView:{update:vi.fn(),destroy:noop},
    vision:new RaidVision(),fog:{update:noop},campWards:view,campBuffs:view,edgeThreats:view,
    minimap:{setGatesLocked:noop,setMobs:vi.fn(),setEnemies:vi.fn(),setCorpses:vi.fn(),setVision:vi.fn(),setCampTimers:vi.fn(),setChests:noop,setQuests:vi.fn(),setCampStates:noop,update:noop},
    input:{activePointer:{rightButtonDown:()=>false}},
    interp:{renderTime:()=>now,clock:{synced:true,now:()=>now}},juice:{worldTime:(t:number)=>t},
    stepLocal:noop,localSource:()=>"snapshot",
    sampleDrawn(this:any,id:string,_time:number,p:any) { this.tmp.x=p.x;this.tmp.y=p.y;this.rendered.set(id,{x:p.x,y:p.y}); },
    cameras:{main:{centerOn:noop,scrollX:0,scrollY:0,width:1600,height:900}},
    trainingBar:view,deathPending:()=>false,markIsDim:()=>false,ground:{statesOf:()=>({}),forget:noop},projectiles:view,fieldView:view,syncContainers:noop,updateChestPanel:noop,updateQuestDialog:noop,
    questView:view,questLog:{trackedId:null,update:noop,setDestination:noop},updateTargets:noop,opponentInspector:view,traderPanel:view,traderView:view,
    streamAim:noop,fx:view,wishFx:view,trackArenaDamage:noop,feedback:view,hud:{...view,setTerrain:noop},weaponBar:view,
    updateWishSlot:noop,updatePlanning:noop,trackRoute:noop,
  });
  return {scene,state,me,foe,mob,frame:(time:number)=>{now=time;state.serverTime=time;scene.update(time);}};
}

describe("RaidScene vision integration", () => {
  it("feeds the local weapon guide current drawn position/aim and hides it for the map, peeking or results", () => {
    const {scene,state,me,frame} = rig();
    Object.assign(me, { weapon0: "bow", weapon1: "wand", slot: 0, facing: 0 });
    scene.weaponRange = { update: vi.fn() };
    scene.hud.noteResultShown = vi.fn();
    scene.aimKnown = true; scene.input.isOver = true; scene.cursorAngle = () => .4;
    scene.beforeTeleport = () => false;
    frame(1000);
    expect(scene.weaponRange.update).toHaveBeenLastCalledWith({ phase: "active", me, at: { x: 400, y: 400 }, aim: .4, hidden: false });
    scene.mapHold = { held: true }; frame(1100);
    expect(scene.weaponRange.update.mock.lastCall[0].hidden).toBe(true);
    scene.mapHold.held = false; scene.peek = { x: 3000, y: 2500 }; frame(1200);
    expect(scene.weaponRange.update.mock.lastCall[0].hidden).toBe(true);
    scene.peek = null; scene.resultsVisible = () => true; frame(1300);
    expect(scene.weaponRange.update.mock.lastCall[0].hidden).toBe(true);
    scene.resultsVisible = () => false; scene.input.isOver = false;
    scene.localSource = () => "predicted"; scene.predict = { motion: { facing: () => 1.2 } };
    scene.updateWeaponRange(me, state);
    expect(scene.weaponRange.update.mock.lastCall[0].aim).toBe(1.2);
  });

  it("keeps an accepted fetch destination on both maps outside fog, without exposing another player's objective", () => {
    const {scene,state,frame} = rig();
    scene.planning = {update:vi.fn(),hide:vi.fn()};
    scene.mapHold = {held:true};
    scene.updatePlanning = (RaidScene.prototype as any).updatePlanning.bind(scene);
    const accepted = new Map([["me",true]]);
    state.quests.set("fetch",{id:"fetch",def:"long-haul",x:3000,y:2000,known:true,status:"open",doneBy:"",expiresAt:999999,carrier:"",accepted,progress:new Map()});
    state.containers.set("parcel",{id:"parcel",kind:"quest",x:4000,y:2000,label:"Parcel",items:{length:1,at:()=>({def:QUEST_ITEM_PREFIX+"fetch"})}});
    frame(1000);
    expect(scene.vision.canSee({x:4000,y:2000})).toBe(false);
    expect(scene.minimap.setQuests.mock.lastCall[0]).toContainEqual(expect.objectContaining({privateObjective:true,x:4000,y:2000}));
    expect(scene.planning.update.mock.lastCall[0].questObjectives).toContainEqual(expect.objectContaining({questId:"fetch",action:"pickup",x:4000,y:2000}));
    accepted.delete("me");
    accepted.set("foe",true);
    frame(1100);
    expect(scene.minimap.setQuests.mock.lastCall[0].some((b:any)=>b.privateObjective)).toBe(false);
    expect(scene.planning.update.mock.lastCall[0].questObjectives).toEqual([]);
  });

  it("passes the local position and only currently visible living enemies to the held full map", () => {
    const {scene,foe,frame} = rig();
    scene.planning = { update: vi.fn(), hide: vi.fn() };
    scene.mapHold = { held: true };
    scene.updatePlanning = (RaidScene.prototype as any).updatePlanning.bind(scene);
    frame(1000);
    expect(scene.planning.update.mock.lastCall[0]).toMatchObject({
      mode: "map", local: { x: 400, y: 400, alive: true },
      enemies: [{ id: "foe", x: 1100, y: 400 }],
    });
    foe.effects = EFFECT_HIDDEN;
    frame(1100);
    expect(scene.planning.update.mock.lastCall[0].enemies).toEqual([]);
    foe.effects = 0;
    foe.status = "dead";
    frame(1200);
    expect(scene.planning.update.mock.lastCall[0].enemies).toEqual([]);
    scene.mapHold.held = false;
    frame(1300);
    expect(scene.planning.hide).toHaveBeenCalled();
  });

  it("publishes current roster kits through fog without exposing hidden actor positions", () => {
    const {scene,state,foe,frame} = rig();
    Object.assign(foe, { name: "Hidden foe", weapon0: "bow", weapon1: "wand", adBonus: 480, effects: EFFECT_HIDDEN, x: 3000 });
    scene.planning = { update: vi.fn(), hide: vi.fn() };
    scene.mapHold = { held: true };
    scene.updatePlanning = (RaidScene.prototype as any).updatePlanning.bind(scene);
    frame(1000);
    expect(scene.planning.update.mock.lastCall[0].roster).toEqual([...state.players].map(([id, player]: any) => ({ id, player })));
    expect(scene.planning.update.mock.lastCall[0].roster[1].player).toMatchObject({ weapon0: "bow", weapon1: "wand", adBonus: 480 });
    expect(scene.planning.update.mock.lastCall[0].enemies).toEqual([]);
  });

  it("shows corpse coordinates to living Plague on both maps outside fog only", () => {
    const {scene,state,me,frame} = rig();
    scene.planning = { update: vi.fn(), hide: vi.fn() };
    scene.mapHold = { held: true };
    scene.updatePlanning = (RaidScene.prototype as any).updatePlanning.bind(scene);
    me.faction = "plague";
    state.plagueCorpses.set("pc1", { id: "pc1", playerId: "foe", playerName: "Foe", x: 3000, y: 2500, expiresAt: 9000 });
    frame(1000);
    expect(scene.vision.canSee({ x: 3000, y: 2500 })).toBe(false);
    expect(scene.minimap.setCorpses.mock.lastCall[0]).toEqual([expect.objectContaining({ id: "pc1", x: 3000, y: 2500 })]);
    expect(scene.planning.update.mock.lastCall[0].corpses).toEqual([expect.objectContaining({ id: "pc1", x: 3000, y: 2500 })]);

    me.faction = "fire"; frame(1100);
    expect(scene.minimap.setCorpses).toHaveBeenLastCalledWith([]);
    expect(scene.planning.update.mock.lastCall[0].corpses).toEqual([]);
    me.faction = "plague"; me.status = "dead"; frame(1200);
    expect(scene.minimap.setCorpses).toHaveBeenLastCalledWith([]);
    expect(scene.planning.update.mock.lastCall[0].corpses).toEqual([]);
  });

  it("keeps nearby corpse markers while F only takes ordinary body loot", () => {
    const {scene,state,me,frame} = rig();
    me.faction = "plague";
    scene.room.send = vi.fn();
    scene.weaponBar.update = vi.fn();
    state.plagueCorpses.set("pc1", { id: "pc1", playerId: "foe", playerName: "Foe", x: 400, y: 400, expiresAt: 9000 });
    state.containers.set("body", { id: "body", kind: "body", x: 400, y: 400, label: "Foe", items: [{ uid: "w", def: "sword" }] });
    frame(1000);
    expect(scene.minimap.setCorpses.mock.lastCall[0]).toHaveLength(1);
    expect(scene.interaction).toMatchObject({ kind: "pickup", container: { id: "body" } });
    scene.interact();
    expect(scene.room.send).toHaveBeenCalledExactlyOnceWith("pickup", { containerId: "body" });
    state.containers.clear();
    frame(1100);
    expect(scene.interaction).toBeNull();
    scene.interact();
    expect(scene.room.send).toHaveBeenCalledTimes(1);
    expect(scene.weaponBar.update.mock.lastCall.at(-1)).toBe("");
    expect(scene.minimap.setCorpses.mock.lastCall[0]).toHaveLength(1);
  });

  it("shows the Sentenced hunt target on both maps through fog without rendering a hidden Swarm actor", () => {
    const {scene,state,me,foe,frame} = rig();
    scene.planning = { update: vi.fn(), hide: vi.fn() };
    scene.mapHold = { held: true };
    scene.updatePlanning = (RaidScene.prototype as any).updatePlanning.bind(scene);
    me.faction = "sentenced"; me.huntTarget = "foe";
    foe.faction = "plague"; foe.effects = EFFECT_HIDDEN; foe.x = 2500;
    frame(1000);
    expect(scene.vision.canSee({ x: foe.x, y: foe.y })).toBe(false);
    expect(scene.views.has("foe")).toBe(false);
    expect(scene.rendered.has("foe")).toBe(false);
    expect(scene.minimap.setEnemies).toHaveBeenLastCalledWith([{ id: "foe", tracked: true, x: foe.x, y: foe.y }]);
    expect(scene.planning.update.mock.lastCall[0].enemies).toContainEqual({ id: "foe", x: foe.x, y: foe.y, tracked: true });
  });

  it("feeds minimap mobs their interpolated on-screen positions rather than raw network positions", () => {
    const {scene,mob,frame} = rig();
    const original = scene.sampleDrawn;
    scene.sampleDrawn = function(id:string,time:number,p:any) {
      original.call(this,id,time,p);
      if (id === "mob") {
        this.tmp.x = p.x - 37.25;
        this.tmp.y = p.y + 4.5;
        this.rendered.set(id,{x:this.tmp.x,y:this.tmp.y});
      }
    };
    frame(1000);
    const marks: any[] = [];
    scene.minimap.setMobs.mock.lastCall[0].forEach((m:any,id:string)=>marks.push({id,...m}));
    expect(marks).toContainEqual(expect.objectContaining({id:"mob",x:mob.x-37.25,y:mob.y+4.5}));
  });

  it("keeps live enemies during the trail and destroys views, hover positions, and minimap dots when it expires", () => {
    const {scene,me,frame} = rig(); frame(1000);
    const enemyView = scene.views.get("foe"), mobView = scene.mobViews.get("mob");
    expect(enemyView).toBeDefined(); expect(mobView).toBeDefined();
    expect(scene.minimap.setEnemies).toHaveBeenLastCalledWith([{ x: 1100, y: 400 }]);
    expect(scene.minimap.setVision).toHaveBeenLastCalledWith(scene.vision.canSee);
    me.x=3700; frame(1100);
    expect(scene.views.get("foe")).toBe(enemyView);
    frame(30999); expect(scene.rendered.has("foe")).toBe(true);
    frame(31000);
    expect(enemyView.destroy).toHaveBeenCalledOnce(); expect(mobView.destroy).toHaveBeenCalledOnce();
    expect(scene.rendered.has("foe")).toBe(false); expect(scene.rendered.has("mob")).toBe(false);
    expect(scene.visiblePosition("foe")).toBeUndefined(); expect(scene.targetCandidates()).toEqual([]);
    expect(scene.minimap.setEnemies).toHaveBeenLastCalledWith([]);
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
    expect(scene.minimap.setEnemies).toHaveBeenLastCalledWith([]);
    foe.effects=0; frame(1200);
    expect(scene.views.get("foe")).toBeDefined(); expect(scene.views.get("foe")).not.toBe(old);
    expect(scene.minimap.setEnemies).toHaveBeenLastCalledWith([{ x: 1100, y: 400 }]);
  });
  it("keeps lobby and training actors available while raid fog is disabled", () => {
    const {scene,state,foe,frame} = rig(); foe.x=4000;state.phase="lobby";frame(1000);
    expect(scene.views.has("foe")).toBe(true);
    expect(scene.minimap.setVision).toHaveBeenLastCalledWith(null);
    state.phase="active";state.training=true;frame(1100);
    expect(scene.views.has("foe")).toBe(true);
    state.training=false;frame(1200); expect(scene.views.has("foe")).toBe(false);
  });
});

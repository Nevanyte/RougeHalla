import { afterEach, describe, expect, it, vi } from "vitest";
import { EFFECT_HIDDEN, QUEST_ITEM_PREFIX, mapFromTiles, packFx, type FxEvent } from "@raid/shared";
import { RaidScene } from "../src/scenes/RaidScene";
import { RaidVision } from "../src/render/RaidVision";

vi.mock("phaser", () => ({default: {Scene: class {}}}));
vi.mock("../src/render/PlayerView", () => ({PlayerView: class {
  update = vi.fn(); destroy = vi.fn(); setLocalBowPull = vi.fn();
}}));
vi.mock("../src/render/MobView", () => ({MobView: class {
  update = vi.fn(); destroy = vi.fn();
}}));
afterEach(() => vi.restoreAllMocks());

function rig() {
  const map = mapFromTiles(150, 100, new Uint8Array(150 * 100), 17);
  const me = {x:400,y:400,status:"alive",effects:0,faction:"fire",huntTarget:"",hp:500,maxHp:500,barrier:0};
  const foe = {x:1100,y:400,status:"alive",effects:0,faction:"frost"};
  const mob = {x:1100,y:430,status:"alive",effects:0,kind:"mob"};
  const state: any = {seed:17,gatesLocked:false,training:false,phase:"active",serverTime:1000,roster:["me","foe"],
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

function damageHarness() {
  const {scene,state,me,frame} = rig();
  Object.assign(me, { hp: 100, maxHp: 100, barrier: 0 });
  frame(1000);
  const order: string[] = [];
  const confirmed: Array<{ amount: number; hp: number; barrier: number }> = [];
  const localView = scene.views.get("me");
  localView.update.mockImplementation(() => order.push(`view:${me.hp}:${me.barrier}`));
  order.length = 0;
  const fx = {
    enqueue: vi.fn(),
    update: vi.fn(),
    confirmedLocalHit: vi.fn((event: { amount: number }) => {
      confirmed.push({ amount: event.amount, hp: me.hp, barrier: me.barrier });
      order.push(`hit:${me.hp}:${me.barrier}`);
    }),
    confirmedOwnBlow: vi.fn(),
  };
  scene.fx = fx;
  scene.ground.combat = { note: vi.fn() };
  return { scene, state, me, frame, order, confirmed, fx };
}

const ROSTER = { roster: new Map([["me", 0], ["foe", 1]]) };
const ownHit = (over: Record<string, unknown> = {}) =>
  ({ kind: "hit" as const, id: "foe", by: "me", amount: 25, weapon: "sword" as const, ...over }) as Extract<FxEvent, { kind: "hit" }>;

/** The scene with FxView mocked: the order of the victim's view update, an own blow's presentation and the render-time fx update. */
function blowHarness() {
  const {scene,state,frame} = rig();
  frame(1000);
  const order: string[] = [];
  scene.views.get("foe").update.mockImplementation(() => order.push("foeView"));
  const fx = {
    enqueue: vi.fn(),
    update: vi.fn((renderT: number) => order.push(`fx.update:${renderT}`)),
    confirmedLocalHit: vi.fn(),
    confirmedOwnBlow: vi.fn((event: { kind: string; t: number }, _now: number, juice: boolean) => order.push(`blow:${event.kind}:${event.t}:${juice}`)),
    localStagger: vi.fn(),
    dropWindups: vi.fn(),
  };
  scene.fx = fx;
  scene.ground.combat = { note: vi.fn() };
  scene.projectiles = { update: () => {}, noteEnd: vi.fn(), has: () => false };
  order.length = 0;
  return { scene, state, frame, order, fx };
}

/** A `this` for RaidScene's teardown: real queues and view maps, and a callable stub for everything else it touches. */
function teardownTarget(scene: any) {
  const stub: any = new Proxy(function () {}, {
    get: (_t, p) => (p === Symbol.iterator ? function* () {} : p === "then" ? undefined : stub),
    apply: () => stub,
  });
  const own: Record<string, unknown> = {
    confirmedBlows: scene.confirmedBlows, confirmedDamage: scene.confirmedDamage, localAutos: scene.localAutos,
    views: new Map(), mobViews: new Map(), zombieViews: new Map(), containerViews: new Map(),
    rendered: new Map(), deaths: new Map(), inHand: new Map(), movementKeys: new Set(),
  };
  return new Proxy(own, { get: (t, p) => (typeof p === "string" && p in t ? t[p] : stub) });
}

function hitBatch(id: string, amount: number, t: number, count = 1) {
  return packFx(
    Array.from({ length: count }, () => ({ kind: "hit" as const, id, by: "foe", amount, weapon: "sword" as const })),
    t,
    { roster: new Map([["me", 0], ["foe", 1]]) },
  );
}

describe("RaidScene vision integration", () => {
  it("waits for the local HP/barrier patch and presents after PlayerView updates in that frame", () => {
    const {scene,me,frame,order,confirmed,fx} = damageHarness();
    scene.onFxBatch(hitBatch("me", 30, 1100));
    frame(1000);
    expect(fx.confirmedLocalHit).not.toHaveBeenCalled();

    Object.assign(me, { hp: 70, barrier: 5 });
    frame(1100);
    expect(confirmed).toEqual([{ amount: 30, hp: 70, barrier: 5 }]);
    expect(order).toEqual(["view:100:0", "view:70:5", "hit:70:5"]);
    frame(1116);
    expect(fx.confirmedLocalHit).toHaveBeenCalledOnce();
  });

  it("presents a patch-before-event local hit on the next frame without waiting for interpolation", () => {
    const {scene,me,frame,confirmed,fx} = damageHarness();
    Object.assign(me, { hp: 80, barrier: 0 });
    frame(1200);
    scene.interp.renderTime = () => 900; // remote render remains behind the already-applied server patch
    scene.onFxBatch(hitBatch("me", 20, 1150));
    expect(fx.confirmedLocalHit).not.toHaveBeenCalled();
    frame(1216);
    expect(confirmed).toEqual([{ amount: 20, hp: 80, barrier: 0 }]);
    expect(fx.update).toHaveBeenLastCalledWith(900, 1216, true);
  });

  it("keeps remote hits on FxView's delayed queue and preserves same-tick barrier-only multihits", () => {
    const remote = damageHarness();
    remote.scene.onFxBatch(hitBatch("foe", 12, 1100));
    expect(remote.fx.enqueue).toHaveBeenCalledOnce();
    expect(remote.fx.enqueue.mock.calls[0]![0]).toMatchObject({ kind: "hit", id: "foe", amount: 12, t: 1100 });
    expect(remote.fx.confirmedLocalHit).not.toHaveBeenCalled();
    remote.scene.interp.renderTime = () => 1000;
    remote.frame(1100);
    expect(remote.fx.update).toHaveBeenLastCalledWith(1000, 1100, true);

    const local = damageHarness();
    Object.assign(local.me, { barrier: 16 });
    local.frame(1050);
    local.scene.onFxBatch(hitBatch("me", 8, 1100, 2));
    Object.assign(local.me, { hp: 100, barrier: 0 }); // both hits were absorbed by the old barrier; HP did not change
    local.frame(1100);
    expect(local.confirmed).toEqual([
      { amount: 8, hp: 100, barrier: 0 }, { amount: 8, hp: 100, barrier: 0 },
    ]);
    expect(local.fx.confirmedLocalHit).toHaveBeenCalledTimes(2);
  });

  it("feeds the local weapon guide current drawn position/aim and hides it for the map, peeking or results", () => {
    const {scene,state,me,frame} = rig();
    Object.assign(me, { weapon0: "bow", weapon1: "wand", slot: 0, facing: 0 });
    scene.weaponRange = { update: vi.fn() };
    scene.hud.noteResultShown = vi.fn();
    scene.aimKnown = true; scene.input.isOver = true; scene.cursorAngle = () => .4;
    scene.beforeTeleport = () => false;
    frame(1000);
    expect(scene.weaponRange.update).toHaveBeenLastCalledWith({ phase: "active", me, slot: 0, at: { x: 400, y: 400 }, aim: .4, hidden: false });
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
    expect(scene.weaponBar.update.mock.lastCall[5]).toBe(""); // the talk hint; the hand slot and the potion counters follow it
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

describe("RaidScene own melee blows", () => {
  it("presents an own blow with its patch, after the victim's view and before the render-time fx, never through the queue", () => {
    const {scene,frame,order,fx} = blowHarness();
    scene.onFxBatch(packFx([ownHit(), { kind: "block", id: "foe", by: "me", weapon: "axe" }], 1100, ROSTER));
    expect(fx.enqueue).not.toHaveBeenCalled();
    frame(1050);
    expect(fx.confirmedOwnBlow).not.toHaveBeenCalled();
    scene.interp.renderTime = () => 1020; // render time a delay behind the patch
    order.length = 0;
    frame(1100);
    expect(order).toEqual(["foeView", "blow:hit:1100:true", "blow:block:1100:true", "fx.update:1020"]);
    frame(1116);
    expect(fx.confirmedOwnBlow).toHaveBeenCalledTimes(2);
  });

  it("keeps projectile, signature, ability, bleed and other fighters' hits on the render-time queue", () => {
    const {scene,fx} = blowHarness();
    scene.onFxBatch(packFx([
      ownHit({ weapon: "bow" }), ownHit({ weapon: "wand" }), ownHit({ sig: "burn" }), ownHit({ ability: "blaze" }),
      ownHit({ weapon: null }), ownHit({ by: "foe" }), { kind: "block", id: "foe", by: "me", weapon: "bow" },
    ], 1100, ROSTER));
    expect(fx.enqueue).toHaveBeenCalledTimes(7);
    expect(fx.confirmedOwnBlow).not.toHaveBeenCalled();
  });

  it("keeps damage the local player returned on the render clock whatever weapon it names, and draws its own bash with its patch", () => {
    const {scene,frame,fx} = blowHarness();
    scene.onFxBatch(packFx([
      { kind: "block", id: "me", by: "foe", weapon: "sword" }, ownHit({ weapon: "shield", passive: true }), // a riposte
      ownHit({ weapon: "shield" }), // the local player's own bash in the same step
    ], 1100, ROSTER));
    scene.onFxBatch(packFx([ownHit({ weapon: "sword", passive: true })], 1150, ROSTER)); // Spiked Shell's return, a step later
    expect(fx.enqueue.mock.calls.map(([e]) => [e.kind, e.weapon, e.passive])).toEqual([
      ["block", "sword", undefined], ["hit", "shield", true], ["hit", "sword", true],
    ]);
    frame(1150);
    expect(fx.confirmedOwnBlow).toHaveBeenCalledOnce();
    expect(fx.confirmedOwnBlow.mock.calls[0]![0]).toMatchObject({ kind: "hit", weapon: "shield" });
    expect(fx.confirmedOwnBlow.mock.calls[0]![0]).not.toHaveProperty("passive");
  });

  it("draws a backlog without juice, drops a stale one, and forgets them when the local player is gone", () => {
    const {scene,state,frame,order,fx} = blowHarness();
    scene.onFxBatch(packFx([ownHit()], 1100, ROSTER));
    frame(1400); // 300 ms behind its patch by the time a frame runs
    expect(order).toContain("blow:hit:1100:false");

    scene.onFxBatch(packFx([ownHit()], 1500, ROSTER));
    frame(3600); // over 2 s late
    expect(fx.confirmedOwnBlow).toHaveBeenCalledOnce();

    scene.onFxBatch(packFx([ownHit()], 3700, ROSTER));
    state.serverTime = 3700; // its patch is in: only the missing local player keeps it from being drawn
    scene.flushConfirmedDamage({ ...state, players: new Map() }, 3700);
    scene.flushConfirmedDamage(state, 3700);
    expect(fx.confirmedOwnBlow).toHaveBeenCalledOnce();
    scene.onFxBatch(packFx([ownHit()], 3700, ROSTER));
    scene.flushConfirmedDamage(state, 3700); // the same flush with the local player there draws it
    expect(fx.confirmedOwnBlow).toHaveBeenCalledTimes(2);
  });

  it("empties the own-blow queue on teardown", () => {
    const {scene,state,fx} = blowHarness();
    vi.stubGlobal("window", { removeEventListener: vi.fn() });
    try {
      scene.onFxBatch(packFx([ownHit()], 1100, ROSTER));
      (RaidScene.prototype as any).teardown.call(teardownTarget(scene));
    } finally {
      vi.unstubAllGlobals();
    }
    state.serverTime = 1100; // its patch is in: only the teardown keeps it from being drawn
    scene.flushConfirmedDamage(state, 1100);
    expect(fx.confirmedOwnBlow).not.toHaveBeenCalled();
    scene.onFxBatch(packFx([ownHit()], 1100, ROSTER));
    scene.flushConfirmedDamage(state, 1100); // the same flush without a teardown draws it
    expect(fx.confirmedOwnBlow).toHaveBeenCalledOnce();
  });

  it("draws the local player's stagger stars on arrival and leaves anyone else's stagger to render time", () => {
    const {scene,fx} = blowHarness();
    scene.views.get("me").cues = { windupEnd: vi.fn() };
    scene.onFxBatch(packFx([{ kind: "stagger", id: "me" }], 1100, ROSTER));
    expect(fx.localStagger).toHaveBeenCalledOnce();
    expect(fx.enqueue).not.toHaveBeenCalled();
    scene.onFxBatch(packFx([{ kind: "stagger", id: "foe" }, { kind: "cancel", id: "me" }], 1100, ROSTER));
    expect(fx.localStagger).toHaveBeenCalledOnce();
    expect(fx.enqueue.mock.calls.map(([e]) => [e.kind, e.id])).toEqual([["stagger", "foe"]]);
  });
});

describe("RaidScene potion counters", () => {
  it("hands the weapon bar the counters a press in flight will leave, and nothing while none is", () => {
    const {scene,me,frame} = rig();
    Object.assign(me, { hp: 100, potionLarge: 1, potionSmall: 2, potionsHealing: 0, healingUntil: 0 });
    scene.weaponBar = { update: vi.fn() };
    frame(1000);
    expect(scene.weaponBar.update.mock.lastCall[7]).toBeUndefined();
    scene.potionCue.press(me, "no", 1000, 1000);
    frame(1010);
    expect(scene.weaponBar.update.mock.lastCall[7]).toMatchObject({ large: 0, small: 2, healing: 1 });
  });
});

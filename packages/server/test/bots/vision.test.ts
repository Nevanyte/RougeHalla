import { describe, expect, it, vi } from "vitest";
import { EFFECT_HIDDEN, mapFromTiles, packFx, VISION_TRAIL_MS, type GameMap } from "@raid/shared";
import { createBotRunner } from "../../src/bots/brain/runner";
import { perceive } from "../../src/bots/brain/perception";
import type { Brain, Percept } from "../../src/bots/brain/types";
import { plainContainer, plainMob, plainPlayer, plainState } from "./fairnessKit";
import { features } from "./fixtures";

function setup(wall = true, worldDelayMs = 0) {
  const tiles = new Uint8Array(140 * 40);
  if (wall) for (let y = 0; y < 40; y++) tiles[y * 140 + 20] = 1;
  const map: GameMap = mapFromTiles(140, 40, tiles, 7);
  map.camps = [{id:"ward",zone:"fire",x:740,y:600,r:100,spots:[],eliteSpot:-1,chest:{x:740,y:600},area:0,radius:100}];
  const me = plainPlayer({x:600,y:600}), foe = plainPlayer({x:740,y:600});
  const mob = plainMob({x:740,y:640}), box = plainContainer({id:"box",x:740,y:600,kind:"ground",items:[{uid:"w",def:"sword"}]});
  const state = plainState({serverTime:1000,players:new Map([["me",me],["foe",foe]]),mobs:new Map([["mob",mob]]),containers:new Map([["box",box]])});
  const captured: Percept[] = [];
  const brain = {tick:(p:Percept)=>{captured.push(p);return [];},end:vi.fn()} as unknown as Brain;
  const runner = createBotRunner({brain,adapter:{selfId:"me",supports:()=>true,send:()=>true},cfg:{selfDelayMs:0,worldDelayMs},map,
    features:features({statusEffects:true,camps:true,chests:true}),tier:{attention:{central:0.7} as any},vision:true});
  return {map,state,me,foe,mob,box,runner,captured,frame:(now:number)=>{state.serverTime=now;runner.frame({state});return captured.at(-1)!;}};
}

describe("live bot raid sight", () => {
  it("withholds wall-hidden players, mobs, minimap dots and container details before reading their private fields", () => {
    const rig = setup();
    for (const [object,key] of [[rig.foe,"hp"],[rig.mob,"kind"],[rig.box,"items"]] as const) {
      Object.defineProperty(object,key,{get:()=>{throw new Error(`hidden ${key} read`);}});
    }
    const p = rig.frame(1000);
    expect(p.fighters).toEqual([]);expect(p.mobs).toEqual([]);expect(p.minimap.mobs).toEqual([]);expect(p.containers).toEqual([]);
    expect(p.hud.alive).toBe(2); // public player count remains available
  });

  it("uses only owned wards and removes their live sight exactly at expiry", () => {
    const rig = setup();
    rig.state.camps = [{type:"fire",reward:"",alive:0,state:2,clearedAt:1000,respawnAt:2000,wardOwner:"foe",wardExpiresAt:2000} as any];
    const otherWard = rig.frame(1000);
    expect(otherWard.fighters).toEqual([]);
    expect(otherWard.extras.camps![0]!.wardOwner).toBe("?");
    (rig.state.camps[0] as any).wardOwner="me";
    expect(rig.frame(1100).fighters.map((f)=>f.id)).toEqual(["foe"]);
    expect(rig.captured.at(-1)!.minimap.mobs.map((m)=>m.id)).toEqual(["mob"]);
    expect(rig.frame(1999).fighters).toHaveLength(1);
    const expired = rig.frame(2000);expect(expired.fighters).toEqual([]);expect(expired.minimap.mobs).toEqual([]);
    expect(expired.extras.camps![0]).toMatchObject({respawnAt:2000,wardOwner:"me",wardExpiresAt:2000});
  });

  it("retains live mob dots through the personal trail, then removes them at exclusive expiry", () => {
    const rig = setup(false);
    expect(rig.frame(1000).minimap.mobs).toHaveLength(1);
    rig.me.x=3500;
    rig.mob.x=800; // the remembered tile reveals live movement, rather than a stale remembered position
    expect(rig.frame(1100).minimap.mobs[0]!.x).toBe(800);
    expect(rig.frame(1000+VISION_TRAIL_MS-1).minimap.mobs).toHaveLength(1);
    expect(rig.frame(1000+VISION_TRAIL_MS).minimap.mobs).toEqual([]);
  });

  it("keeps Swarm hidden even inside an owned ward", () => {
    const rig=setup();rig.foe.effects=EFFECT_HIDDEN;
    rig.state.camps=[{type:"fire",reward:"",alive:0,state:2,wardOwner:"me",wardExpiresAt:2000} as any];
    const p=rig.frame(1000);expect(p.fighters).toEqual([]);expect(p.mobs).toHaveLength(1);
  });

  it("preserves frame delay and never hands the brain a newer hidden frame", () => {
    const rig=setup(false,100);
    rig.frame(1000);expect(rig.captured).toEqual([]);
    rig.foe.hp=250;rig.frame(1050);expect(rig.captured).toEqual([]);
    rig.foe.hp=100;const p=rig.frame(1100);
    expect(p.now).toBe(1100);expect(p.viewT).toBe(1000);expect(p.fighters[0]!.x).toBe(740);
    rig.foe.x=3500;expect(rig.frame(1150).fighters).toEqual([]);
  });

  it("keeps direct legacy perception fixtures opt-in while live runners apply vision", () => {
    const rig=setup();
    const legacy=perceive({state:rig.state},{selfId:"me",map:rig.map,features:features(),lastMinimap:null});
    expect(legacy.fighters).toHaveLength(1);expect(legacy.minimap.mobs).toHaveLength(1);
    expect(rig.frame(1000).fighters).toEqual([]);
  });

  it("does not expose projectile flights behind a wall after the delay ring reconstructs them", () => {
    const rig=setup();
    const batch = packFx([],1000,{launches:[{id:"shot",kind:"arrow",x:740,y:600,vx:600,vy:0,t:1000,range:600}]});
    const legacy = perceive({state:rig.state,fxs:[batch]},{selfId:"me",map:rig.map,features:features(),lastMinimap:null});
    expect(legacy.projectiles).toHaveLength(1);
    rig.runner.frame({state:rig.state,fxs:[batch]});
    expect(rig.captured.at(-1)!.projectiles).toEqual([]);
  });
});

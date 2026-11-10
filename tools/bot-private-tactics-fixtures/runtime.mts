import {join} from 'node:path';
import {pathToFileURL} from 'node:url';
export const ROOT=process.env.RH_BOT_TACTICS_SOURCE_ROOT??'/repo';
const source=(p:string)=>import(pathToFileURL(join(ROOT,p)).href);
export const shared=await source('packages/shared/src/index.ts');
export const types=await source('packages/server/src/bots/brain/types.ts');
export const memory=await source('packages/server/src/bots/brain/memory.ts');
export const knowledge=await source('packages/server/src/bots/brain/knowledge.ts');
export const services=await source('packages/server/src/bots/brain/services.ts');
export const tactics=await source('packages/server/src/bots/brain/tactics.ts');
export const fight=await source('packages/server/src/bots/brain/tactics/fight.ts');
export const kite=await source('packages/server/src/bots/brain/tactics/kite.ts');
export const world=await source('packages/server/src/bots/brain/tactics/world.ts');
export const mapWire=await source('packages/shared/src/mapWire.ts');

export const mapgen=await source('packages/shared/src/mapgen.ts');

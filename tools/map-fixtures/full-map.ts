/** Full canonical gameplay-layer capture. Real generator, no Rust algorithm substitute.
 * Pinned runner: Linux x64 Node 22.23.4, node --import tsx tools/map-fixtures/full-map.ts [--check].
 * Writes only new mapdata fixtures; never changes legacy map pins or rh-map/1 captures.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { certifiedMap, generateMap, tryAttempt } from '../../packages/shared/src/mapgen.ts';
import { mapHashU32 } from '../../packages/shared/src/mapWire.ts';
import { regionAt, type GameMap } from '../../packages/shared/src/map.ts';
import { bushAt } from '../../packages/shared/src/vision.ts';

const plain = (x: unknown): unknown => ArrayBuffer.isView(x) ? Array.from(x as unknown as ArrayLike<number>) :
  Array.isArray(x) ? x.map(plain) : x !== null && typeof x === 'object' ? Object.fromEntries(Object.entries(x).map(([k,v])=>[k,plain(v)])) : x;
function explicit(map: GameMap): unknown {
  const { seed,w,h,tiles,terrain,props,regionGrid,attempt,territoryGrid,coliseum,regions,camps,spawnPool,
    buildings,spawns,crateSpots,groundSpots,features,featureGrid } = map;
  const exported = { seed,w,h,tiles,terrain,props,regionGrid,attempt,territoryGrid,coliseum,regions,camps,spawnPool,
    buildings,spawns,crateSpots,groundSpots,features,featureGrid };
  if (Object.keys(map).sort().join(',') !== Object.keys(exported).sort().join(',')) throw new Error('GameMap fields changed: update rh-map/2 schema explicitly');
  return plain(exported);
}
function emit(name: string, value: unknown): void {
  const path=fileURLToPath(new URL(`../../crates/rh-sim/src/mapdata/fixtures/${name}`,import.meta.url));
  const output=JSON.stringify(value)+'\n';
  if(process.argv.includes('--check')) { if(readFileSync(path,'utf8')!==output) throw new Error(`${name}: full map capture differs`); }
  else writeFileSync(path,output);
}
const manifests=[];
for(const seed of [1,2]) {
  const map=certifiedMap(seed,{decor:false});
  if(!map) throw new Error(`seed ${seed} has no certified attempt`);
  const canonical=explicit(map);
  const direct=generateMap(seed,map.attempt,{decor:false});
  if(JSON.stringify(canonical)!==JSON.stringify(explicit(direct))) throw new Error('certified/direct attempt differ');
  if(map.props.length!==0) throw new Error('decor:false unexpectedly produced props');
  emit(`seed${seed}.map.json`,{format:'rh-map/2',legacyMapHashU32:mapHashU32(map),map:canonical});
  const regionCodes=['none','fire','sentenced','plague','frost','holy','coliseum'];
  const regionQuery=[],bushQuery=[];
  for(let y=0;y<map.h;y++) for(let x=0;x<map.w;x++) {
    const p={x:x*32+16,y:y*32+16};
    regionQuery.push(regionCodes.indexOf(regionAt(map,p.x,p.y)));bushQuery.push(bushAt(map,p));
  }
  const edgeQueries=[];
  for(const x of [-1,-0,0,31.999999999999996,32,5119.999999999999,5120]) {
    for(const y of [-1,0,31.999999999999996,32,5120]) edgeQueries.push({x,y,region:regionCodes.indexOf(regionAt(map,x,y)),bush:bushAt(map,{x,y})});
  }
  manifests.push({seed,attempt:map.attempt,legacyMapHashU32:mapHashU32(map),regionQuery,bushQuery,edgeQueries});
}
emit('oracle.json',{format:'rh-map-data-oracle/1',node:process.version,platform:process.platform,arch:process.arch,maps:manifests});

// These are preserved Number values from real producer calls, not uint32 seed aliases.
const domains = [certifiedMap(-1,{decor:false}), certifiedMap(4294967297,{decor:false}), tryAttempt(1,4294967296,{decor:false})];
if(domains.some(m=>m===null)) throw new Error('safe integer producer example no longer certifies');
emit('domain-maps.json',{maps:domains.map(m=>({format:'rh-map/2',legacyMapHashU32:mapHashU32(m!),map:explicit(m!)}))});

console.log(process.argv.includes('--check')?'full map captures match':'captured full maps and producer domain examples');

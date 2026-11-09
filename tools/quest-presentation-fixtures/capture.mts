// Actual source formatter probes only: no World, DOM/app, grants, acquisition or gameplay-outcome proof.
import assert from "node:assert/strict";
import {createHash} from "node:crypto";
import {execFileSync} from "node:child_process";
import {readFileSync,readdirSync,mkdirSync,writeFileSync} from "node:fs";
import {join,resolve,dirname} from "node:path";
import {pathToFileURL} from "node:url";
import {assertSemantics} from "./compare.mjs";
const [mode,output,repoFlag,rootArg]=process.argv.slice(2);
assert.equal(process.argv.length,6);assert(mode==="--write"||mode==="--check");assert.equal(repoFlag,"--repo");
const root=resolve(rootArg!),tool="tools/quest-presentation-fixtures";
const sha=(bytes:string|Buffer)=>createHash("sha256").update(bytes).digest("hex");
const fileSha=(path:string)=>sha(readFileSync(join(root,path)));
const pins=JSON.parse(readFileSync(join(root,tool,"pins.json"),"utf8"));
assert.equal(process.version,pins.node);assert.equal(process.platform,pins.platform);assert.equal(process.arch,pins.arch);
assert.equal(fileSha(pins.existingCatalog.path),pins.existingCatalog.sha256,"old catalog evidence is immutable");
const old=JSON.parse(readFileSync(join(root,pins.existingCatalog.path),"utf8"));
assert.equal(old.format,"rh-quest-data-source/1");
// These exact actual modules execute. No loader stubs or copied formatter/label logic.
const shared=await import(pathToFileURL(join(root,"packages/shared/src/index.ts")).href);
const model=await import(pathToFileURL(join(root,"packages/client/src/ui/questModel.ts")).href);
for(const name of ["questObjective","questReward","questRows","questFromReveal"])assert.equal(typeof model[name],"function");
const definitions=shared.QUEST_DEFS;assert.equal(definitions.length,20);
const owner="formatter-owner",localName="decorative-owner",now=1000;
const bits=(n:number)=>{const b=Buffer.alloc(8);b.writeDoubleBE(n);return b.toString("hex");};
const fields=["name","giver_label","brief","objective","reward"];
function metadata(row:any) {
  return {name:row.def.name,giver_label:row.def.giver,brief:row.def.text,objective:row.objective,reward:row.reward};
}
const cases=definitions.map((def:any)=>{
  const existing=old.cases.catalog.find((r:any)=>r.id===def.id);assert(existing);
  // Reuse only unchanged catalog identity/text evidence. Never install a captured expected formatter result.
  for(const key of ["name","giver","text"])assert.equal(def[key],existing[key]);
  assert.equal(shared.questDefById(def.id),def);
  const award=shared.questRewardStats(def);
  const contexts=[
    {name:"preview-counted",origin:"actual questFromReveal over declared reveal input",state:"preview",current:137,feed:0},
    {name:"open-zero",origin:"declared formatter row",state:"open",current:0,feed:0},
    {name:"open-counted-feed0",origin:"declared formatter row",state:"open",current:137,feed:0},
    {name:"open-counted-feed6",origin:"declared formatter row",state:"open",current:137,feed:6},
    {name:"open-safe-after-boundary",origin:"declared formatter row",state:"open",current:Number.MAX_SAFE_INTEGER-award.stacks,feed:0},
    {name:"open-crossed-after-boundary",origin:"declared formatter row",state:"open",current:Number.MAX_SAFE_INTEGER,feed:0},
    {name:"open-without-counts",origin:"declared formatter row with absent optional counts",state:"open",current:null,feed:6},
    {name:"closed-done-counted",origin:"declared completed FORMATTER input, not an earned outcome",state:"done",current:137,feed:6},
    {name:"closed-expired-max",origin:"declared expired FORMATTER input, not gameplay expiry",state:"expired",current:Number.MAX_SAFE_INTEGER,feed:0},
  ];
  const probes=contexts.map(context=>{
    const reveal={id:`probe:${def.id}`,def:def.id,x:0,y:0,expiresAt:5000};
    const quest=context.state==="preview"?model.questFromReveal(reveal):{
      ...reveal,status:context.state,doneBy:"",carrier:"",accepted:new Map(),progress:new Map(),visitedRegions:new Map(),
    };
    const counts=context.current===null?undefined:new Map([[award.id,context.current]]);
    const before=counts?JSON.stringify([...counts]):null;
    const rows=model.questRows({forEach:(cb:any)=>cb(quest,quest.id)},owner,now,localName,false,context.feed,counts);
    assert.equal(rows.length,1,"the declared known definition has one formatter row");
    assert.equal(counts?JSON.stringify([...counts]):null,before,"actual formatting leaves owner-count input unchanged");
    const sum=context.current===null?null:context.current+award.stacks;
    return {input:{...context,serverNow:now,rewardStat:award.id,gained:award.stacks},
      observed:metadata(rows[0]),directReward:model.questReward(def,context.feed,counts),
      arithmeticDiagnostic:sum===null?null:{role:"capture-harness Number addition probe, separate from actual helper text",sum,decimal:String(sum),binary64BE:bits(sum)}};
  });
  return {id:def.id,kind:def.kind,actualRewardFacts:{id:award.id,stacks:award.stacks,gv:def.reward.gv},
    actualHelpers:{objective:model.questObjective(def),fixedReward:shared.questRewardText(def),rewardWithoutCounts:model.questReward(def)},probes};
});
function files(dir:string):string[]{return readdirSync(join(root,dir),{withFileTypes:true}).flatMap(entry=>entry.isDirectory()?files(`${dir}/${entry.name}`):[`${dir}/${entry.name}`]);}
const sourceFiles=[...files("packages/shared/src"),"packages/client/src/ui/questModel.ts"].sort();
const harnessFiles=files(tool).filter(path=>/\.(mts|mjs|sh|json)$/.test(path)).sort();
const configFiles=["package.json","package-lock.json","tsconfig.base.json",...(["server","shared","client"].flatMap(p=>[`packages/${p}/package.json`,`packages/${p}/tsconfig.json`]))];
const lock=JSON.parse(readFileSync(join(root,"package-lock.json"),"utf8"));
const utf8=(s:string)=>Buffer.byteLength(s,"utf8");
const maxima=Object.fromEntries(fields.map(field=>[field,Math.max(...cases.flatMap((c:any)=>c.probes.map((p:any)=>utf8(p.observed[field]))))]));
const body={format:"rh-quest-presentation-source/1",cases,
  measured:{definitions:cases.length,formatterContextsPerDefinition:9,actualRowCalls:cases.length*9,utf8FieldMaxima:maxima,
    all20LargestPerDefinitionMetadataUtf8:cases.reduce((n:number,c:any)=>n+fields.reduce((m:number,f:string)=>m+Math.max(...c.probes.map((p:any)=>utf8(p.observed[f]))),0),0),
    fiveU8StringPrefixesForAll20:100},
  provenance:{sourceBaseRevision:pins.sourceBaseRevision,image:pins.image,platform:"linux/amd64",node:process.version,
    npm:execFileSync("npm",["--version"],{encoding:"utf8"}).trim(),v8:process.versions.v8,
    dependencyVersions:Object.fromEntries(["tsx","typescript","esbuild"].map(name=>[name,lock.packages[`node_modules/${name}`].version])),
    existingCatalog:pins.existingCatalog,sourceClosure:"complete shared/src plus actual questModel.ts (its only runtime import is @raid/shared); no import stubs",
    sourceSha256:Object.fromEntries(sourceFiles.map(p=>[p,fileSha(p)])),harnessSha256:Object.fromEntries(harnessFiles.map(p=>[p,fileSha(p)])),
    configSha256:Object.fromEntries(configFiles.map(p=>[p,fileSha(p)])),
    limits:"declared formatter contexts only; actual source helper/row text, no World/DOM/app/gameplay/grants/acquisition, historical card payout, session, UI rendering or public admission"}};
const text=JSON.stringify(body,null,2)+"\n",file=join(output!,"source.json");
if(mode==="--write"){mkdirSync(dirname(file),{recursive:true});writeFileSync(file,text);}else{
  assertSemantics(JSON.parse(readFileSync(file,"utf8")),body);
  assert.equal(text,readFileSync(file,"utf8"),"FULL_BYTE_CHECK_MISMATCH");
}
console.log(JSON.stringify({status:mode==="--check"?"CHECK_PASS":"CAPTURE_PASS",definitions:20,contexts:180,bytes:Buffer.byteLength(text),sha256:sha(text),measured:body.measured}));

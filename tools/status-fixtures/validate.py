#!/usr/bin/env python3
"""Strict fixture admission/negative controls. No mechanics or expected answer construction."""
import copy, json, math, pathlib, sys
HERE=pathlib.Path(__file__).resolve().parent
KINDS=['stun','root','silence','slowMove','slowAttack','antiHeal','dot','invulnerable','untargetable','hidden','zoned','deathFloor','haste','shred']
ABILITIES=['freeze','swarm','trial','blaze','lastStand']
SOURCES=json.loads((HERE/'source-inventory.json').read_text())+['parity/legacy-capture/status-probes.ts','parity/legacy-capture/canon.ts','parity/legacy-capture/intake.ts','tools/status-fixtures/capture.ts','tools/status-fixtures/runtime-cases.ts','tools/status-fixtures/source-inventory.json','tools/status-fixtures/case-inventory.json','package.json','package-lock.json','tsconfig.base.json','packages/shared/package.json','packages/server/package.json']
CASES=json.loads((HERE/'case-inventory.json').read_text())
OPS={
'apply':({'kind','id','apply'},{'linkField'}),'read':({'kind','id'},{'at'}),'remove':({'kind','id','selector'},set()),'cleanse':({'kind','id','classes'},set()),'clock':({'kind','at'},set()),'find':({'kind','id','statusKind'},{'sourceId'}),'reveal':({'kind','id','until'},set()),'collect':({'kind','value'},set()),'drain':({'kind'},set()),'actorPatch':({'kind','id','patch'},set()),'runtimePatch':({'kind','id','patch'},set()),'displace':({'kind','id','to'},set()),'queueNested':({'kind','id'},set()),'input':({'kind','id','type','message'},set()),'step':({'kind','ms'},set()),'removePlayer':({'kind','id'},set()),'extraRows':({'kind','id','rows'},set()),'heal':({'kind','id','amount'},{'options'}),'ledgerHit':({'kind','hit'},set()),'deferHit':({'kind','hit'},set()),'applyLedger':({'kind'},set()),'clearLedger':({'kind'},set()),'fieldAdd':({'kind','field'},{'alias'}),'fieldRemove':({'kind'},{'alias','id'}),'fieldsRead':({'kind'},set()),'fieldRemoveWhere':({'kind','selector'},set()),'onTrail':({'kind','alias','point'},set()),'updateAbilities':({'kind'},set()),'statusDamage':({'kind','dtMs'},set()),'abilityDotFx':({'kind'},set()),'clearFighter':({'kind','id','cause'},set()),'clearAll':({'kind','cause'},set()),'runEnded':({'kind'},set()),'teleported':({'kind'},set()),'floorHp':({'kind','id','before','total'},set()),'onHook':({'kind','hook','victim','operations'},set())}
def require(test,message='admission'):
 if not test:raise ValueError(message)
def fields(v,required,optional=()):
 require(type(v)is dict,'object');require(set(required)<=v.keys() and v.keys()<=set(required)|set(optional),'unknown/missing fields')
def number(v):require(type(v)in(int,float) and math.isfinite(v),'finite number')
def integer(v,lo,hi):require(type(v)is int and lo<=v<=hi,'checked integer')
def source(v):
 fields(v,['id','name'],['ownerId']);require(type(v['id'])is str and type(v['name'])is str);require('ownerId'not in v or type(v['ownerId'])is str)
def numeric_tree(v):
 if type(v)in(int,float):number(v)
 elif type(v)is list:
  for x in v:numeric_tree(x)
 elif type(v)is dict:
  if '$number'in v:fields(v,['$number']);require(v['$number']in ['NaN','Infinity','-Infinity'])
  elif '$undefined'in v:fields(v,['$undefined']);require(v['$undefined']is True)
  elif '$function'in v:fields(v,['$function']);require(type(v['$function'])is str)
  else:
   for x in v.values():numeric_tree(x)
def status(v):
 fields(v,['kind','source','startedAt','until','value'],['ability','tag','revealFrom','revealUntil','fieldId','dealtMult','takenFromSourceMult','moveMult','floorHp','healShare','shares','taken'])
 require(v['kind']in KINDS);source(v['source'])
 for k in ['startedAt','until','value']:number(v[k])
 if 'ability'in v:require(v['ability']in ABILITIES)
 if 'tag'in v:require(type(v['tag'])is str)
def input_tree(v,path=()):
 if type(v)is dict:
  if set(v)=={'$undefined'}:
   require(len(path)>=3 and path[-3:-1]==('apply','data') and v['$undefined']is True,'undefined input only in optional payload');return
  require(not any(k.startswith('$')for k in v),'output-only sentinel in input')
  for k,x in v.items():input_tree(x,path+(k,))
 elif type(v)is list:
  for i,x in enumerate(v):input_tree(x,path+(i,))
 elif type(v)in(int,float):number(v)
def operation(op):
 require(type(op)is dict and op.get('kind')in OPS,'operation enum');req,opt=OPS[op['kind']];fields(op,req,opt);input_tree(op)
 if 'id'in op:require(type(op['id'])is str)
 if op['kind']=='apply':
  a=op['apply'];fields(a,['kind','source','ms'],['ability','tag','value','add','data','quiet']);require(a['kind']in KINDS);source(a['source']);number(a['ms'])
  if 'quiet'in a:require(type(a['quiet'])is bool)
  if 'ability'in a:require(a['ability']in ABILITIES)
  if 'tag'in a:require(type(a['tag'])is str)
  if 'value'in a:number(a['value'])
  if 'add'in a:fields(a['add'],['per','cap']);number(a['add']['per']);number(a['add']['cap'])
  if 'data'in a:fields(a['data'],[],['revealUntil','fieldId','dealtMult','takenFromSourceMult','moveMult','floorHp','healShare','shares'])
  if 'data'in a:
   for k,v in a['data'].items():
    if v=={'$undefined':True}:continue
    if k=='fieldId':require(type(v)is str)
    elif k=='shares':
     fields(v,['phys','magic','true'])
     for n in v.values():number(n)
    else:number(v)
 if op['kind']=='clock':number(op['at']);require(abs(op['at'])<=9007199254740991)
 if op['kind']=='cleanse':require(type(op['classes'])is list and all(c in ['soft','hard','never']for c in op['classes']))
 if op['kind']=='collect':require(type(op['value'])is bool)
 if op['kind']=='onHook':
  require(op['hook']=='hurt' and type(op['victim'])is str and type(op['operations'])is list and op['operations'])
  for nested in op['operations']:operation(nested)
def runtime(v):
 fields(v,['clock','entityCounter','marks','fighters','abilities','events','ledger','landed','deferred','collecting','payouts','callbackOperations','random']);integer(v['entityCounter'],0,4294967295);require(type(v['collecting'])is bool)
 require(type(v['fighters'])is list and v['fighters']);seen=set()
 for f in v['fighters']:
  fields(f,['id','role','standing','name','hp','maxHp','barrier','immuneUntil','effects','sig','mirrors','statuses','weapon','cast','body','cards']);require(type(f['id'])is str and f['id']not in seen);seen.add(f['id']);require(f['role']in ['player','mob','questGiver']and type(f['standing'])is bool);integer(f['effects'],0,65535)
  for key in ['hp','maxHp','barrier','immuneUntil']:number(f[key])
  fields(f['body'],['x','y','facing','displaceSeq','path','history','slip']);integer(f['body']['displaceSeq'],0,255)
  fields(f['weapon'],['readyAt','state'])
  if type(f['statuses'])is list:
   for st in f['statuses']:status(st)
 if v['abilities']is not None:fields(v['abilities'],['fields','mirrors','dot','dotSince','teleportedAt'])
def snapshot(v):
 fields(v,['runtime','clock','modifiers','callbackOperations','fieldAliases','world','itemUid','aliases','random']);numeric_tree(v);runtime(v['runtime']);require(v['runtime']['clock']==v['clock']and v['runtime']['random']==v['random'])
 fields(v['clock'],['tick','serverTime','phase']);integer(v['clock']['tick'],0,4294967295);number(v['clock']['serverTime'])
 fields(v['random'],['random','rewardRandom','questRandom'])
 for stream in v['random'].values():
  fields(stream,['draws','next']);integer(stream['draws'],0,9007199254740991);require(type(stream['next'])is list and len(stream['next'])==4)
  for value in stream['next']:number(value);require(0<=value<1)
 fields(v['world'],['abilities','arena','combat','config','events','factions','hashSalt','hazards','idCounter','joined','map','mobs','orderSalt','planning','players','projectiles','quests','state','stepping','terrain','traders'])
 for key in ['idCounter','joined','orderSalt']:integer(v['world'][key],0,4294967295)
 for _,actor_runtime in v['world']['players']+v['world']['mobs']:
  sts=actor_runtime.get('statuses')
  if type(sts)is list:
   for st in sts:status(st)
 for st in v['world']['state']['players'].values():integer(st['effects'],0,65535);integer(st['displaceSeq'],0,255)
def setup(v):
 fields(v,['seed','randomSeed','rewardSalt','questSalt','newItemUid','config','modules','mapRows','players','clock','trusted'])
 integer(v['seed'],0,4294967295);integer(v['randomSeed'],0,4294967295)
 for salt in ['rewardSalt','questSalt']:
  require(type(v[salt])is list and len(v[salt])==4)
  for word in v[salt]:integer(word,0,4294967295)
 require(v['newItemUid']=='incrementing-decimal-from-zero')
 fields(v['config'],['minPlayers','lobbySeconds','fillSeconds','patienceSeconds','patienceMinSeconds','suddenDeathSeconds','pvpRules']);require(type(v['config']['pvpRules'])is bool)
 fields(v['modules'],['assembler','signatures','walkHints']);require(v['modules']['assembler']=='createGameWorld' and type(v['modules']['signatures'])is bool and type(v['modules']['walkHints'])is bool)
 require(type(v['mapRows'])is list and len(v['mapRows'])==20 and all(type(r)is str and len(r)==40 and set(r)<={'.','#'}for r in v['mapRows']))
 fields(v['clock'],['serverTime','tick']);number(v['clock']['serverTime']);integer(v['clock']['tick'],0,4294967295)
 require(type(v['players'])is list and [p['id']for p in v['players']]==['alice','bob','carol'])
 for p in v['players']:
  fields(p,['id','name','faction','patch','runtime']);require(type(p['name'])is str and p['faction']in ['fire','sentenced','plague','frost','holy']);fields(p['patch'],['x','y','immuneUntil','weapon0']);fields(p['runtime'],['path','history'])
 t=v['trusted'];fields(t,[],['actorOverrides','runtimeOverrides','roles','splitMap','signatures','pvpRules','markSuppressed'])
 for key in ['roles','splitMap','signatures','pvpRules']:
  if key in t:require(type(t[key])is bool)
 for p in t.get('actorOverrides',{}).values():fields(p,[],['status','hp','barrier','x','y','weapon0','displaceSeq','sig'])
 for p in t.get('runtimeOverrides',{}).values():
  fields(p,[],['down','cast'])
  if 'down'in p:fields(p['down'],['outcome']);require(p['down']['outcome']in ['died','mia'])
  if 'cast'in p:fields(p['cast'],['ability','rank','slot','startedAt','landsAt','target','point','landing','prevReadyAt','lagMs'],['prevFullAt']);require(p['cast']['ability']in ABILITIES)
 numeric_tree(v)
def validate(f):
 fields(f,['format','slice','provenance','shared','rules','cases']);require(f['format']=='rh-status-probes/1' and f['slice']in CASES)
 p=f['provenance'];fields(p,['base','node','nodeSha256','platform','arch','scope','sourceSha256']);require(p['node']=='v22.23.4'and p['platform']=='linux'and p['arch']=='x64');require(p['base']=='d1027eac93be54ec9e37435ab71c2e97a3aafdc9')
 require(set(p['sourceSha256'])==set(SOURCES),'source inventory')
 for digest in [p['nodeSha256'],*p['sourceSha256'].values()]:require(type(digest)is str and len(digest)==64 and all(c in '0123456789abcdef'for c in digest),'sha256')
 fields(f['shared'],['tickMs','effectCasting','hiddenRevealMs','dotFxMs','fieldFallback']);fields(f['shared']['fieldFallback'],['blaze','trial']);fields(f['shared']['fieldFallback']['blaze'],['dps','dotMs']);fields(f['shared']['fieldFallback']['trial'],['exitStunMs']);numeric_tree(f['shared']);integer(f['shared']['tickMs'],1,4294967295);integer(f['shared']['effectCasting'],0,65535)
 require(type(f['rules'])is list and [r['kind']for r in f['rules']]==KINDS,'ordered14 rules')
 for r in f['rules']:
  fields(r,['kind','maxMs','combine','cleanse','bit'],['cap','playersOnly']);integer(r['maxMs'],1,4294967295);integer(r['bit'],0,65535);require(r['combine']in ['any','sum','max','product']and r['cleanse']in ['soft','hard','never'])
  if 'cap'in r:number(r['cap'])
  if 'playersOnly'in r:require(r['playersOnly']is True)
 require(type(f['cases'])is list and [c['name']for c in f['cases']]==CASES[f['slice']],'ordered nonempty cases')
 for c in f['cases']:
  fields(c,['name','classification','boundary','setup','operations','steps','observerFullStateEquality','observerReturnEquality','sourceRandomContinuationEquality']);require(c['classification']in ['trusted-helper','ordinary-input']and type(c['boundary'])is str and c['boundary']);fields(c['setup'],['input','initial']);setup(c['setup']['input']);snapshot(c['setup']['initial'])
  for key in ['observerFullStateEquality','observerReturnEquality','sourceRandomContinuationEquality']:require(c[key]is True)
  require(type(c['operations'])is list and c['operations'] and len(c['operations'])==len(c['steps']))
  for op,s in zip(c['operations'],c['steps']):
   operation(op);fields(s,['operation','before','returned','after','hooks']);require(s['operation']==op);snapshot(s['before']);snapshot(s['after']);numeric_tree(s['returned']);numeric_tree(s['hooks'])
def pairs(items):
 result={}
 for key,value in items:
  require(key not in result,'raw duplicate key');result[key]=value
 return result
def parse(text):return json.loads(text,object_pairs_hook=pairs,parse_constant=lambda v:(_ for _ in ()).throw(ValueError('nonfinite JSON')))
def negatives(f):
 tests=[]
 for mode in range(12):
  bad=copy.deepcopy(f)
  if mode==0:bad['cases']=[]
  elif mode==1:bad['cases'][1]=bad['cases'][0]
  elif mode==2:bad['cases'][0]['unknown']=0
  elif mode==3:del bad['cases'][0]['steps'][0]['returned']
  elif mode==4:bad['cases'][0]['steps'][0]['before']['clock']['tick']=4294967296
  elif mode==5:bad['cases'][0]['steps'][0]['after']['world']['state']['players']['alice']['effects']=65536
  elif mode==6:hashes=bad['provenance']['sourceSha256'];hashes['unknown.ts']=hashes.pop(next(iter(hashes)))
  elif mode==7:bad['cases'][0]['operations'][0]['kind']='unknown'
  elif mode==8:bad['rules'][0]['maxMs']=True
  elif mode==9:bad['cases'][0],bad['cases'][1]=bad['cases'][1],bad['cases'][0]
  elif mode==10:del bad['cases'][0]['steps'][0]['after']['runtime']['abilities']
  else:bad['cases'][0]['setup']['input']['modules']['signatures']=1
  try:validate(bad)
  except(ValueError,KeyError,TypeError,IndexError):tests.append(mode)
  else:raise AssertionError('negative survived '+str(mode))
 for raw in ['{"x":1,"x":2}','{"x":{"y":1,"y":2}}','{"x":NaN}']:
  try:parse(raw)
  except ValueError:pass
  else:raise AssertionError('invalid raw JSON survived')
 return len(tests)+3
if __name__=='__main__':
 for arg in sys.argv[1:]:
  f=parse(pathlib.Path(arg).read_text());validate(f);print(json.dumps({'file':arg,'cases':len(f['cases']),'negativeControls':negatives(f)}))

#!/usr/bin/env python3
"""Superseding typed nested admission for immutable v1 data and the two-case v2 addendum.
No game mechanics or expected answers are constructed here. Full enumerable World remains opaque evidence.
"""
import copy,importlib.util,json,pathlib,sys,re
HERE=pathlib.Path(__file__).resolve().parent
spec=importlib.util.spec_from_file_location('status_v1_admission',HERE/'validate.py');v=importlib.util.module_from_spec(spec);spec.loader.exec_module(v)
base_op,base_runtime,base_status,base_setup=v.operation,v.runtime,v.status,v.setup
req,fields,num,integer=v.require,v.fields,v.number,v.integer
def source_enum(path,name):
 text=(HERE/'../..'/path).read_text();m=re.search(r'\bconst '+name+r'(?:\s*:[^=]+)?\s*=\s*\[(.*?)\]\s*(?:as const)?\s*;',text,re.S);req(m is not None,'bound source enum '+name);return re.findall(r'[\"\']([^\"\']+)[\"\']',m.group(1))
STATS=source_enum('packages/shared/src/effects.ts','EFFECT_STATS');MULTS=source_enum('packages/shared/src/effects.ts','MULT_KEYS');FLAGS=source_enum('packages/shared/src/effects.ts','EFFECT_FLAGS');SLOTS=source_enum('packages/shared/src/abilities.ts','ABILITY_SLOTS')
WEAPONS=['fists','sword','axe','shield','bow','wand'];SIGS=['burn','backlash','disease','mark']
def string(x):req(type(x)is str,'string')
def boolean(x):req(type(x)is bool,'boolean')
def undef(x):return type(x)is dict and x=={'$undefined':True}
def point(x):
 fields(x,['x','y']);num(x['x']);num(x['y'])
def optional_point(x):
 if x is not None:point(x)
def finite_or_sentinel(x):
 if type(x)is dict:fields(x,['$number']);req(x['$number']in ['NaN','Infinity','-Infinity'])
 else:num(x)
def shares(x):
 fields(x,['phys','magic','true'])
 for n in x.values():num(n)
def packet(x):
 fields(x,['raw','phys','magic','true'],['crit','mult'])
 for k in ['raw','phys','magic','true']:num(x[k])
 if 'mult'in x:num(x['mult'])
 if 'crit'in x:boolean(x['crit'])
def action(x):
 if x is None:return
 fields(x,['kind','weapon','startedAt','landsAt','a','packet'],['origin','target','rangeMult']);req(x['kind']in ['swing','cast','draw']);req(x['weapon']in WEAPONS)
 for k in ['startedAt','landsAt','a']:num(x[k])
 packet(x['packet'])
 if 'origin'in x:point(x['origin'])
 if 'target'in x and not undef(x['target']):string(x['target'])
 if 'rangeMult'in x:num(x['rangeMult'])
WEAPON_KEYS=['action','rootUntil','staggerImmuneUntil','held','pressedAt','bufferedUntil','aim','aimAt','lagMs','lock','lockSeen','lockLosLostAt','lockPlanAt','lockGoal','lockSearchAt','attackMoveGoal','lastShotAt']
def weapon(x,partial=False):
 fields(x,[]if partial else WEAPON_KEYS,WEAPON_KEYS if partial else [])
 for k,val in x.items():
  if k=='action':action(val)
  elif k in ['held','lockSeen']:boolean(val)
  elif k=='lock':req(val is None or type(val)is str)
  elif k in ['lockGoal','attackMoveGoal']:optional_point(val)
  elif k in ['lockPlanAt','lockSearchAt','lastShotAt']:finite_or_sentinel(val)
  else:num(val)
def cast(x):
 if x is None or undef(x):return
 fields(x,['ability','rank','slot','startedAt','landsAt','target','point','landing','prevReadyAt','lagMs'],['prevFullAt']);req(x['ability']in v.ABILITIES);num(x['rank']);req(x['slot']in SLOTS)
 for k in ['startedAt','landsAt','prevReadyAt','lagMs']:num(x[k])
 if 'prevFullAt'in x:num(x['prevFullAt'])
 req(x['target']is None or type(x['target'])is str);point(x['point']);optional_point(x['landing'])
def slip(x):
 if x is None or undef(x):return
 fields(x,['vx','vy','ax','ay','path','replanAt'],['stuckX','stuckY','stuckN','stuckBest','stuckAt','gripUntil'])
 for k,val in x.items():
  if k=='path':
   if val is not None:
    req(type(val)is list)
    for p in val:point(p)
  elif k=='replanAt':finite_or_sentinel(val)
  else:num(val)
def history(x):
 req(type(x)is list)
 for p in x:fields(p,['t','x','y']);num(p['t']);num(p['x']);num(p['y'])
def actor_patch(x):
 fields(x,[],['status','hp','maxHp','barrier','x','y','facing','weapon0','weapon1','displaceSeq','sig','effects','immuneUntil','readyAt'])
 for k,val in x.items():
  if k=='status':req(val in ['alive','dead','mia','evacuated'])
  elif k in ['weapon0','weapon1']:req(val in ['']+WEAPONS)
  elif k in ['displaceSeq','sig']:integer(val,0,255)
  elif k=='effects':integer(val,0,65535)
  else:num(val)
def runtime_patch(x):
 fields(x,[],['weapon','path','history','slip','down','cast'])
 for k,val in x.items():
  if k=='weapon':weapon(val,True)
  elif k=='path':
   req(type(val)is list)
   for p in val:point(p)
  elif k=='history':history(val)
  elif k=='slip':slip(val)
  elif k=='cast':cast(val)
  elif val is not None:fields(val,['outcome']);req(val['outcome']in ['died','mia'])
def status(x):
 base_status(x)
 for k,val in x.items():
  if k in ['kind','source','ability','tag']:continue
  if undef(val):continue
  if k=='fieldId':string(val)
  elif k=='shares':shares(val)
  else:num(val)
def field(x,with_id=True):
 required=['kind','ability','owner','subject','x','y','x2','y2','r','vx','vy','startedAt','endsAt']+(['id']if with_id else [])
 fields(x,required,['exitStunMs']);req(x['kind']in ['zone','cloud','trail']and x['ability']in v.ABILITIES);v.source(x['owner']);req(x['subject']is None or type(x['subject'])is str)
 if with_id:string(x['id'])
 for key in ['x','y','x2','y2','r','vx','vy','startedAt','endsAt']:num(x[key])
 if 'exitStunMs'in x:num(x['exitStunMs'])
def ledger(x,scale_required=False):
 fields(x,['victim','by','packet','weapon','stagger']+(['scale']if scale_required else []),['scale','ability','dot','projectile','sig','passive','arena','derived','final','execute']);string(x['victim']);v.source(x['by']);packet(x['packet']);req(x['weapon']is None or x['weapon']in WEAPONS);boolean(x['stagger'])
 for k in ['dot','passive','arena','derived','final','execute']:
  if k in x:boolean(x[k])
 if 'scale'in x:num(x['scale'])
 if 'ability'in x:req(x['ability']in v.ABILITIES)
 if 'sig'in x:req(x['sig']in SIGS)
 if 'projectile'in x:string(x['projectile'])
def landed(x):
 fields(x,['victim','by','amount','weapon'],['sig','ability','dot','race','cut','crit','passive','derived']);string(x['victim']);string(x['by']);num(x['amount']);req(x['weapon']is None or x['weapon']in WEAPONS)
 for k in ['sig','ability']:
  if k in x and not undef(x[k]):req(x[k]in(SIGS if k=='sig'else v.ABILITIES))
 for k in ['dot','crit','passive','derived']:
  if k in x:boolean(x[k])
 for k in ['race','cut']:
  if k in x:num(x[k])
def pairs(x,value):
 req(type(x)is list);seen=set()
 for p in x:
  req(type(p)is list and len(p)==2);string(p[0]);req(p[0]not in seen);seen.add(p[0]);value(p[1])
def marks(x):
 if undef(x):return
 fields(x,['suppressed','denies','taxed']);pairs(x['suppressed'],num);pairs(x['taxed'],string)
 def ids(a):
  req(type(a)is list)
  for id in a:string(id)
 pairs(x['denies'],ids)
def ability_runtime(x):
 if x is None:return
 fields(x,['fields','mirrors','dot','dotSince','teleportedAt']);pairs(x['fields'],field)
 for key,record in x['fields']:req(record['id']==key)
 def mirror(m):
  fields(m,['kind','ability','x','y','x2','y2','r','vx','vy','owner','subject','startedAt','endsAt']);integer(m['kind'],0,2);integer(m['ability'],0,4);string(m['owner']);string(m['subject'])
  for k in ['x','y','x2','y2','r','vx','vy','startedAt','endsAt']:num(m[k])
 pairs(x['mirrors'],mirror);req([p[0]for p in x['fields']]==[p[0]for p in x['mirrors']])
 def dot(d):fields(d,['victim','by','ability','amount']);string(d['victim']);string(d['by']);req(d['ability']in v.ABILITIES);num(d['amount'])
 pairs(x['dot'],dot);num(x['dotSince'])
 if not undef(x['teleportedAt']):num(x['teleportedAt'])
def runtime(x):
 base_runtime(x);marks(x['marks'])
 for f in x['fighters']:
  string(f['id']);string(f['name']);integer(f['sig'],0,255)
  fields(f['mirrors'],['asMult','windupMult','speedMult','armorBonus','shieldBonus','adBonus','apBonus'])
  for val in f['mirrors'].values():num(val)
  for k in ['x','y','facing']:num(f['body'][k])
  req(type(f['body']['path'])is list)
  for p in f['body']['path']:point(p)
  history(f['body']['history']);slip(f['body']['slip']);num(f['weapon']['readyAt']);weapon(f['weapon']['state']);cast(f['cast'])
  if not undef(f['cards']):
   fields(f['cards'],['critAccDot','dotRollTick','dotCrit']);num(f['cards']['critAccDot']);integer(f['cards']['dotRollTick'],-1,4294967295);boolean(f['cards']['dotCrit'])
 ability_runtime(x['abilities'])
 for key in ['ledger','deferred']:
  req(type(x[key])is list)
  for e in x[key]:ledger(e,True)
 req(type(x['landed'])is list)
 for e in x['landed']:landed(e)
 for payout in x['payouts']:fields(payout,['$function']);string(payout['$function'])
def selector(x,for_fields=False):
 if for_fields:
  req(x.get('kind')in ['all','owner']);fields(x,['kind']+(['ownerId']if x['kind']=='owner'else[]),['size'])
  if 'ownerId'in x:string(x['ownerId'])
  if 'size'in x:integer(x['size'],0,9007199254740991)
 else:
  req(x.get('kind')in ['all','status','source']);fields(x,['kind']+({'all':[],'status':['statusKind'],'source':['sourceId']}[x['kind']]))
  if 'statusKind'in x:req(x['statusKind']in v.KINDS)
  if 'sourceId'in x:string(x['sourceId'])
def operation(op):
 base_op(op);kind=op['kind']
 if kind=='apply':
  a=op['apply']
  if 'data'in a:
   for key,val in a['data'].items():
    if undef(val):continue
    if key=='shares':shares(val)
    elif key=='fieldId':string(val)
    else:num(val)
 elif kind=='fieldAdd':field(op['field'],False)
 elif kind in ['ledgerHit','deferHit']:ledger(op['hit'])
 elif kind=='actorPatch':actor_patch(op['patch'])
 elif kind=='runtimePatch':runtime_patch(op['patch'])
 elif kind=='displace':point(op['to'])
 elif kind=='onTrail':point(op['point'])
 elif kind=='remove':selector(op['selector'])
 elif kind=='fieldRemoveWhere':selector(op['selector'],True)
 elif kind=='fieldRemove':req(('alias'in op)!=('id'in op))
 elif kind in ['step','statusDamage']:num(op['ms'if kind=='step'else'dtMs'])
 elif kind in ['clock','reveal']:num(op['at'if kind=='clock'else'until'])
 elif kind=='read':
  if 'at'in op:num(op['at'])
 elif kind=='heal':
  num(op['amount'])
  if 'options'in op:
   fields(op['options'],[],['lifesteal','quiet','ignoreLockout','noBarrier','source'])
   for k,val in op['options'].items():string(val)if k=='source'else boolean(val)
 elif kind=='floorHp':num(op['before']);num(op['total'])
 elif kind in ['clearAll','clearFighter']:req(op['cause']in(['teleport','runEnd']if kind=='clearAll'else['down','removed']))
 elif kind=='extraRows':
  req(type(op['rows'])is list)
  for row in op['rows']:
   req(row.get('k')in ['stat','mult','flag'])
   fields(row,['k','stat','v']if row['k']=='stat'else['k','key','v']if row['k']=='mult'else['k','flag'],['requires','needs'])
   if 'v'in row:num(row['v'])
   if 'stat'in row:req(row['stat']in STATS)
   if 'key'in row:req(row['key']in MULTS)
   if 'flag'in row:req(row['flag']in FLAGS)
   if 'needs'in row:req(row['needs']=='status')
   if 'requires'in row:
    req(type(row['requires'])is list)
    for key in row['requires']:string(key)
 elif kind=='input':string(op['type']);req(type(op['message'])is dict) # Raw intake data; actual source/native client validators decide acceptance.
def setup(x):
 base_setup(x)
 for p in x['players']:
  actor_patch(p['patch']);runtime_patch(p['runtime'])
 for p in x['trusted'].get('actorOverrides',{}).values():actor_patch(p)
 for p in x['trusted'].get('runtimeOverrides',{}).values():runtime_patch(p)
 if 'markSuppressed'in x['trusted']:pairs(x['trusted']['markSuppressed'],num)
v.operation,v.runtime,v.status,v.setup=operation,runtime,status,setup
ORIGINAL_CASES=copy.deepcopy(v.CASES);ORIGINAL_SOURCES=list(v.SOURCES)
def configure(f):
 if f['slice']=='review-refinements/2':
  v.CASES={'review-refinements/2':['review-cross-mirror-shred-slowattack','review-queued-displace-after-real-departure']};v.SOURCES=ORIGINAL_SOURCES+['tools/status-fixtures/refinements.ts']
 else:v.CASES=ORIGINAL_CASES;v.SOURCES=ORIGINAL_SOURCES
 def validator():v.validate(f)
 validator()
def nested_negatives(f):
 mutations=[]
 def op_mutation(kind,fn):
  for ci,c in enumerate(f['cases']):
   for oi,op in enumerate(c['operations']):
    if op['kind']==kind:
     bad=copy.deepcopy(f);fn(bad['cases'][ci]['operations'][oi]);bad['cases'][ci]['steps'][oi]['operation']=copy.deepcopy(bad['cases'][ci]['operations'][oi]);return bad
  return None
 for name,kind,fn in [
 ('field-unknown','fieldAdd',lambda op:op['field'].__setitem__('unknown',True)),
 ('field-coordinate-type','fieldAdd',lambda op:op['field'].__setitem__('x','not a coordinate')),
 ('actor-sequence-narrowing','actorPatch',lambda op:op['patch'].__setitem__('displaceSeq',256)),
 ('ledger-raw-type','ledgerHit',lambda op:op['hit']['packet'].__setitem__('raw','not a number'))]:
  bad=op_mutation(kind,fn)
  if bad is not None:mutations.append((name,bad))
 bad=copy.deepcopy(f);bad['cases'][0]['steps'][0]['before']['runtime']['fighters'][0]['body']['x']='not a coordinate';mutations.append(('runtime-coordinate-type',bad))
 for name,bad in mutations:
  try:configure(bad)
  except(ValueError,KeyError,TypeError,IndexError):pass
  else:raise AssertionError('nested negative survived '+name)
 return [name for name,_ in mutations]
if __name__=='__main__':
 for name in sys.argv[1:]:
  data=v.parse(pathlib.Path(name).read_text());configure(data);base=v.negatives(data);extra=nested_negatives(data)
  print(json.dumps({'file':name,'cases':len(data['cases']),'baseNegativeControls':base,'nestedNegativeControls':extra}))

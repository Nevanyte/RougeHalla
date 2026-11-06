#!/usr/bin/env python3
"""Closed v3 input/snapshot overlay; immutable earlier source answers and admission modules are untouched."""
import copy,importlib.util,json,pathlib,sys
HERE=pathlib.Path(__file__).resolve().parent
spec=importlib.util.spec_from_file_location('strict_v2',HERE/'strict-admission-v2.py');s=importlib.util.module_from_spec(spec);spec.loader.exec_module(s)
v=s.v;req,fields,num,integer=s.req,s.fields,s.num,s.integer
NAMES=['queued-displacement-current-goal','queued-displacement-current-collision','nonneutral-healtaken-heal-kinds-floor-payout','nonneutral-farm-lifesteal-outside-cap']
SOURCE_NAMES=s.ORIGINAL_SOURCES+['tools/status-fixtures/probe-v3.ts','tools/status-fixtures/cases-v3.ts','tools/status-fixtures/capture-v3.ts']
SINGLE_POLICY={'farmLifesteal':{'mobType':'rotMonk','effect':{'k':'stat','stat':'lifesteal','v':.0025},'countMax':9007199254740991}}
v.OPS.update({'mapReplace':({'kind','rows'},set()),'farmSetup':({'kind','id','counts'},set())})
base_runtime,base_operation=v.runtime,v.operation
SUM_KEYS=s.STATS+s.source_enum('packages/shared/src/effects.ts','FLAT_STATS')
def rows(x):
 req(type(x)is list and len(x)==20,'map height')
 for row in x:req(type(row)is str and len(row)==40 and set(row)<={'.','#','~'},'map row geometry')
def counts(x):
 req(type(x)is list and x,'nonempty farm map');seen=set()
 for pair in x:
  req(type(pair)is list and len(pair)==2 and pair[0]=='rotMonk'and pair[0]not in seen,'farm key/duplicate');seen.add(pair[0]);integer(pair[1],0,9007199254740991)
def operation(op):
 base_operation(op)
 if op['kind']=='mapReplace':rows(op['rows'])
 elif op['kind']=='farmSetup':counts(op['counts']);s.string(op['id'])
def runtime(x):
 fields(x,['collision','modifierInputs','clock','entityCounter','marks','fighters','abilities','events','ledger','landed','deferred','collecting','payouts','callbackOperations','random'])
 base_runtime({k:val for k,val in x.items()if k not in ['collision','modifierInputs']})
 c=x['collision'];fields(c,['seed','w','h','gatesLocked','rows','sourceMapHash']);integer(c['seed'],0,4294967295);req(c['w']==40 and type(c['w'])is int and c['h']==20 and type(c['h'])is int);s.boolean(c['gatesLocked']);rows(c['rows']);integer(c['sourceMapHash'],0,4294967295)
 req(type(x['modifierInputs'])is list and [m['id']for m in x['modifierInputs']]==[f['id']for f in x['fighters']if f['role']=='player'])
 for m in x['modifierInputs']:
  fields(m,['id','mobStats','farmSums','farmLifestealRows','regularLifestealRows','lifestealMult','lifestealDot','healTakenMult']);s.string(m['id']);fields(m['mobStats'],[],['rotMonk'])
  for value in m['mobStats'].values():integer(value,0,9007199254740991)
  fields(m['farmSums'],SUM_KEYS)
  for value in m['farmSums'].values():num(value)
  for key in ['farmLifestealRows','regularLifestealRows','lifestealMult','lifestealDot','healTakenMult']:num(m[key])
v.runtime,v.operation=runtime,operation
v.CASES={'review-boundaries/3':NAMES};v.SOURCES=SOURCE_NAMES
TOP=['format','slice','provenance','policies','shared','rules','cases']
def validate(f):
 fields(f,TOP);req(f['slice']=='review-boundaries/3');req(f['policies']==SINGLE_POLICY,'bound source farm policy')
 # Pure full-case preflight of new helper requests and references precedes all snapshot checking/mutation.
 for c in f['cases']:
  actors={p['id']for p in c['setup']['input']['players']}
  for op in c['operations']:
   operation(op)
   if op['kind']=='farmSetup':req(op['id']in actors,'farm actor reference')
 base={k:val for k,val in f.items()if k!='policies'};v.validate(base)
def negatives(f):
 failures=[]
 def mutop(name,kind,fn):
  bad=copy.deepcopy(f)
  for c in bad['cases']:
   for i,op in enumerate(c['operations']):
    if op['kind']==kind:
     fn(op);c['steps'][i]['operation']=copy.deepcopy(op)
     try:validate(bad)
     except(ValueError,KeyError,TypeError,IndexError):failures.append(name);return
     raise AssertionError('negative survived '+name)
  raise AssertionError('missing operation for '+name)
 for name,fn in [
 ('map-unknown',lambda o:o.__setitem__('unknown',True)),
 ('map-missing-rows',lambda o:o.pop('rows')),
 ('map-string-rows',lambda o:o.__setitem__('rows','not rows')),
 ('map-ragged',lambda o:o['rows'].__setitem__(1,'.')),
 ('map-unknown-cell',lambda o:o['rows'].__setitem__(1,'?'*40))]:mutop(name,'mapReplace',fn)
 for name,fn in [
 ('farm-unknown',lambda o:o.__setitem__('unknown',True)),
 ('farm-missing-counts',lambda o:o.pop('counts')),
 ('farm-duplicate',lambda o:o['counts'].append(o['counts'][0])),
 ('farm-unknown-kind',lambda o:o['counts'][0].__setitem__(0,'unknown-kind')),
 ('farm-fraction',lambda o:o['counts'][0].__setitem__(1,.5)),
 ('farm-negative',lambda o:o['counts'][0].__setitem__(1,-1)),
 ('farm-unsafe-integer',lambda o:o['counts'][0].__setitem__(1,9007199254740992)),
 ('farm-bool',lambda o:o['counts'][0].__setitem__(1,True)),
 ('farm-bad-actor',lambda o:o.__setitem__('id','never-allocated'))]:mutop(name,'farmSetup',fn)
 for mode in ['policy','runtime-missing-collision','runtime-modifier-type','runtime-null-undefined','reordered-case']:
  bad=copy.deepcopy(f)
  if mode=='policy':bad['policies']['farmLifesteal']['effect']['v']=.005
  elif mode=='runtime-missing-collision':del bad['cases'][0]['steps'][0]['before']['runtime']['collision']
  elif mode=='runtime-modifier-type':bad['cases'][0]['steps'][0]['before']['runtime']['modifierInputs'][0]['healTakenMult']='not number'
  elif mode=='runtime-null-undefined':bad['cases'][0]['steps'][0]['before']['runtime']['fighters'][0]['body']['slip']={'$undefined':False}
  else:bad['cases'][0],bad['cases'][1]=bad['cases'][1],bad['cases'][0]
  try:validate(bad)
  except(ValueError,KeyError,TypeError,IndexError):failures.append(mode)
  else:raise AssertionError('negative survived '+mode)
 for raw in ['{"rows":[],"rows":[]}','{"a":{"x":1,"x":2}}','{"x":NaN}']:
  try:v.parse(raw)
  except ValueError:failures.append('raw-json')
  else:raise AssertionError('raw invalid survived')
 return failures
if __name__=='__main__':
 for name in sys.argv[1:]:
  f=v.parse(pathlib.Path(name).read_text());validate(f);print(json.dumps({'file':name,'cases':len(f['cases']),'negativeControls':negatives(f)}))

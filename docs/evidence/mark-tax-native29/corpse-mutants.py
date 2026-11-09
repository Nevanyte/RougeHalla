#!/usr/bin/env python3
"""Two predecessor regression controls; restores exact production bytes, preserves every red log."""
from pathlib import Path
import json,subprocess,hashlib
p=Path('crates/rh-sim/src/systems/plague_corpses.rs');original=p.read_bytes();text=original.decode();out=Path('docs/evidence/mark-tax-native29/logs');results=[]
cases=[('training-corpse-guard-omitted',' || hx.k.config.training','', 'ordinary_training_npc_death_revives_without_a_plague_corpse_and_restores',False),('corpse-action-order-clone','    for i in 0..cx.s.action_order.len() {\n        let slot = cx.s.action_order[i];','    let order=cx.s.action_order.clone();\n    for slot in order {','corpse_auto_warm_alloc',True)]
for name,old,new,selector,ignored in cases:
 assert text.count(old)==1,(name,text.count(old));log=out/f'mutant-{name}.log';assert not log.exists()
 try:
  p.write_text(text.replace(old,new));cmd=['cargo','test','-p','rh-sim','--lib',selector,'--features','trusted-status-probes','--locked','--','--test-threads=1']+(['--ignored'] if ignored else [])
  with log.open('wb') as f:
   f.write(('COMMAND '+' '.join(cmd)+'\n').encode());f.flush();code=subprocess.run(cmd,stdout=f,stderr=subprocess.STDOUT).returncode
  t=log.read_text();killed=code!=0 and 'panicked at' in t and 'FAILED' in t and 'could not compile' not in t
  r={'name':name,'selector':selector,'base_sha256':hashlib.sha256(original).hexdigest(),'semantic_assertion_kill':killed,'exit':code,'log':str(log)};results.append(r);print(json.dumps(r),flush=True);assert killed,name
 finally:p.write_bytes(original)
Path('docs/evidence/mark-tax-native29/corpse-mutants.json').write_text(json.dumps(results,indent=2)+'\n')

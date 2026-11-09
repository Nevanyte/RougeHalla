#!/usr/bin/env python3
"""Finite native mutation controls. No source fixture is changed. Run from repository root after sourcing final-env.
Restores each original production file in finally; nonzero Cargo status alone is NOT a semantic kill.
"""
from pathlib import Path
import hashlib,json,subprocess
ROOT=Path.cwd()
OUT=ROOT/'docs/evidence/mark-tax-native29/logs'
TAX='crates/rh-sim/src/systems/sentenced/mark_tax.rs'
MOD='crates/rh-sim/src/modifiers/mod.rs'
SIG='crates/rh-sim/src/systems/signatures.rs'
CASES=[
 ('disabled-source',TAX,'(factor < 1.).then_some','(factor < 0.).then_some','earned_training_two_cases_every_frame_phase_event_and_rng'),
 ('farm-excluded',TAX,'(1. + regular + farm).max(0.)','(1. + regular + farm * 0.).max(0.)','earned_training_two_cases_every_frame_phase_event_and_rng'),
 ('delayed-preledger-rebuild',SIG,'        super::sentenced::mark_tax::rebuild(k, w, &mut s.mark_tax_next, cx.stats);','        // mutant: defer first index installation until afterDamage','earned_training_two_cases_every_frame_phase_event_and_rng'),
 ('eager-owner-refold',TAX,'if !next.iter().any(|row| row.victim == victim) {','if !next.iter().any(|row| row.victim == victim && row.by == w.factions.taxed[i].by) {','membership_replacement_does_not_refold_but_removal_does'),
 ('fresh-ordinary-rows',MOD,'if end_mods && holds != w.core(ix).modifiers.holds {','if !end_mods || holds != w.core(ix).modifiers.holds {','earned_training_two_cases_every_frame_phase_event_and_rng'),
 ('stale-conditional-end-rows',MOD,'if end_mods && holds != w.core(ix).modifiers.holds {','if !end_mods && holds != w.core(ix).modifiers.holds {','genuine_card_grant_and_hp_conditional_query_distinguish_fold_stages'),
 ('omitted-public-cut',TAX,'let percent = if w.standing(ix) {','let percent = if w.standing(ix) && core.id.0 == 0 {','earned_training_two_cases_every_frame_phase_event_and_rng'),
]
results=[]
for name,path,old,new,selector in CASES:
 p=ROOT/path;original=p.read_bytes();text=original.decode()
 assert text.count(old)==1,(name,text.count(old))
 log=OUT/f'mutant-{name}.log'
 assert not log.exists(),log
 try:
  p.write_text(text.replace(old,new))
  cmd=['cargo','test','-p','rh-sim','--lib',selector,'--features','trusted-status-probes','--locked','--','--test-threads=1']
  with log.open('wb') as f:
   f.write(('COMMAND '+ ' '.join(cmd)+'\n').encode());f.flush();code=subprocess.run(cmd,stdout=f,stderr=subprocess.STDOUT).returncode
  output=log.read_text()
  killed=code!=0 and f'test systems::sentenced::mark_tax::' in output and 'FAILED' in output and 'panicked at' in output and 'could not compile' not in output
  result={'name':name,'path':path,'base_sha256':hashlib.sha256(original).hexdigest(),'selector':selector,'exit':code,'semantic_assertion_kill':killed,'log':str(log.relative_to(ROOT))}
  results.append(result);print(json.dumps(result),flush=True)
  assert killed,name
 finally:
  p.write_bytes(original)
  assert hashlib.sha256(p.read_bytes()).hexdigest()==hashlib.sha256(original).hexdigest()
(ROOT/'docs/evidence/mark-tax-native29/mutants.json').write_text(json.dumps(results,indent=2)+'\n')

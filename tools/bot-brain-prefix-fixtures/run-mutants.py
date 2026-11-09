#!/usr/bin/env python3
"""Bounded native mutations against the unchanged actual-source component corpus.
Run only in an isolated checkout with its own CARGO_TARGET_DIR. Every edited file is
restored in finally; a compiler error is NOT accepted as a semantic mutant kill.
"""
import hashlib,json,os,pathlib,subprocess
root=pathlib.Path(__file__).resolve().parents[2]
out=pathlib.Path(os.environ.get('RH_BRAIN_PREFIX_EVIDENCE',root/'docs/evidence/bot-brain-prefix/mutants'))
out.mkdir(parents=True,exist_ok=True)
target=os.environ.get('CARGO_TARGET_DIR','')
if not target or target.endswith('/final-target'):
    raise SystemExit('set an isolated CARGO_TARGET_DIR; root final-target is forbidden')
cases=[
 ('01-reentry', 'memory_prefix.rs','now - r.seen_at <= 3000.','now - r.seen_at <= 0.', 'bots::memory_prefix::tests::actual_source_memory_stimuli_and_world_motion_sequences'),
 ('02-roam-boundary','world_tactics.rs','if d <= 48. {','if d < 48. {','bots::world_tactics::tests::actual_source_world_tactics_matches_every_declared_sequence_step'),
 ('03-salient','brain.rs','StimulusKind::NewThreat','StimulusKind::FoeSwapped','bots::brain::tests::actual_source_brain_coordinator_call_sequence_and_rng_trace'),
 ('04-channel-first','brain.rs','if claimed.contains(&ch) {','if false && claimed.contains(&ch) {','bots::brain::tests::actual_source_arbitration_is_observed_before_humanizer_submission'),
 ('05-rng-extra-draw','brain.rs','self.started = true;','self.started = true; let _ = rng.next_f64();','bots::brain::tests::actual_source_brain_coordinator_call_sequence_and_rng_trace'),
]
results=[]
def run(name,test):
    p=subprocess.run(['cargo','test','-p','rh-policy','--locked','--lib',test,'--','--exact'],cwd=root,text=True,stdout=subprocess.PIPE,stderr=subprocess.STDOUT)
    (out/(name+'.log')).write_text(p.stdout.rstrip()+"\n")
    return p
for name,rel,before,after,test in cases:
    path=root/'crates/rh-policy/src/bots'/rel
    original=path.read_bytes(); text=original.decode()
    if text.count(before)!=1: raise SystemExit(f'{name}: mutation anchor is not unique')
    try:
        path.write_text(text.replace(before,after))
        p=run(name,test)
        killed=p.returncode!=0 and 'test result: FAILED.' in p.stdout and 'could not compile' not in p.stdout
        results.append({'name':name,'semanticKill':killed,'exit':p.returncode,'test':test})
        if not killed: raise SystemExit(f'{name}: no semantic kill')
    finally:
        path.write_bytes(original)
# Whitespace/comment control proves the consumer does not simply reject any modified native source.
path=root/'crates/rh-policy/src/bots/world_tactics.rs';original=path.read_bytes()
try:
    path.write_bytes(original+b'\n// Semantic negative control: no changed rule.\n')
    p=run('06-comment-control',cases[1][-1]);assert p.returncode==0
    results.append({'name':'06-comment-control','semanticKill':False,'exit':p.returncode})
finally:
    path.write_bytes(original)
p=subprocess.run(['cargo','test','-p','rh-policy','--locked','--lib'],cwd=root,text=True,stdout=subprocess.PIPE,stderr=subprocess.STDOUT)
(out/'07-restored-control.log').write_text(p.stdout.rstrip()+"\n")
assert p.returncode==0
results.append({'name':'07-restored-control','exit':p.returncode})
report={'format':'rh-bot-brain-prefix-mutants/1','corpusSha256':hashlib.sha256((root/'parity/policy/bot-brain-prefix/source.json').read_bytes()).hexdigest(),'results':results}
(out/'results.json').write_text(json.dumps(report,indent=2)+'\n')
print('5 semantic kills; comment and restored controls PASS')

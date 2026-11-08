import sys
op=sys.argv[1]
if op in ('reason','refund'):
    p='crates/rh-sim/src/systems/abilities/mod.rs'
    old='            super::status::cancel_cast(cx.k, cx.w, cx.ev, id, rt::CastEndReason::Fizzle, false);'
    if op=='reason':
        new='            super::status::cancel_cast(cx.k, cx.w, cx.ev, id, rt::CastEndReason::Interrupted, false);'
    else:
        new='            super::status::cancel_cast(cx.k, cx.w, cx.ev, id, rt::CastEndReason::Fizzle, true);'
elif op=='clock':
    p='crates/rh-sim/src/systems/status/mod.rs'
    old='        event_time: w.server_time,'
    new='        event_time: w.server_time - 1.,'
elif op=='landing':
    p='crates/rh-sim/src/systems/abilities/mod.rs'
    old='        if !ok {\n            super::status::cancel_cast(cx.k, cx.w, cx.ev, id, rt::CastEndReason::Fizzle, false);'
    new='        if !ok && false {\n            super::status::cancel_cast(cx.k, cx.w, cx.ev, id, rt::CastEndReason::Fizzle, false);'
else:
    raise SystemExit('unknown mutation '+op)
s=open(p).read()
assert s.count(old)==1,(op,s.count(old))
open(p,'w').write(s.replace(old,new))
print('mutated '+op)

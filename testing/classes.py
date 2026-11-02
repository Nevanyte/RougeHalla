"""
The five powers (v2: damage types and defenses follow each class's identity;
v3: Fire and Frost attack faster with lighter hits, same damage per second, and backlash 210 -> 200;
balance pass: the compressed sheet of BALANCE_CONTRACT 5.2 (hp, hit, armor, shield and the signature numbers moved so every
faction edge leaves the favourite 10-35% hp, a 60-70% favourite once play noise is in) and typed signatures (D6): burn and
disease are magic, backlash physical, the mark true, whatever the faction's own damage shares are. `sig_types` gives each
part's (physical, true) share; magic is the rest. The hit / hp / signature numbers are no longer on the old design grid
(the compression was found by search over the whole sheet and checked in the real sim, testing/TUNING_BALANCE.md).

Order matters only for the printed matrix: Fire, Sentenced, Plague, Frost, Holy.
"""
from engine import PowerSpec

FIRE = PowerSpec(
    name="Fire", hp=950, rate=0.60, hit=85.2,
    phys=0.0, true=0.0, armor=20, shield=20,
    mechanic="dragonslayer", params=dict(burn=28, backlash=128),
    sig_types=dict(burn=(0.0, 0.0), backlash=(1.0, 0.0)),
)
SENTENCED = PowerSpec(
    name="Sentenced", hp=1085, rate=0.95, hit=72.1,
    phys=0.40, true=0.0, armor=94, shield=94,
    mechanic="marked", params=dict(mark_pct=0.045, mark_kill=0.00675, mark_amp=1, tier_hits=3, tax_keep=1, tax_cap=99, suppress=1),
    sig_types=dict(mark=(0.4, 0.0)),
)
PLAGUE = PowerSpec(
    name="Plague", hp=1020, rate=1.85, hit=28.7,
    phys=0.8, true=0.0, armor=77, shield=77,
    mechanic="rat_king", params=dict(plague=52, execute=325),
    sig_types=dict(disease=(0.0, 0.0), execute=(0.0, 0.0)),
)
FROST = PowerSpec(
    name="Frost", hp=985, rate=0.45, hit=168.2,
    phys=0.9, true=0.0, armor=116, shield=116,
    aura="wall_of_ice", params=dict(slow=0.32),
)
HOLY = PowerSpec(
    name="Holy", hp=1145, rate=0.95, hit=92.2,
    phys=1.0, true=0.0, armor=78, shield=78,
    sustain="radiant", params=dict(ls0=0.08, ls1=0.65, ls_cap=0.6),
)

POWERS = [FIRE, SENTENCED, PLAGUE, FROST, HOLY]

# The ten unordered pairs (the faction rework removed the counter cycle: no pair favours its first power). Same order as the
# old cycle, so tools and fixtures that iterated it keep their row order.
PAIRS = [
    ("Fire", "Sentenced"), ("Fire", "Plague"),
    ("Sentenced", "Plague"), ("Sentenced", "Frost"),
    ("Plague", "Frost"), ("Plague", "Holy"),
    ("Frost", "Holy"), ("Frost", "Fire"),
    ("Holy", "Fire"), ("Holy", "Sentenced"),
]
BEATS = PAIRS  # the old name; kept for the tools that still import it

# Design intent (documentation only; nothing in the engine reads this).
ROLES = {
    "Fire":      dict(role="Glass-cannon duelist",   theme="Dragonslayer, living fire"),
    "Sentenced": dict(role="Patient executioner",    theme="Marked for judgment"),
    "Plague":    dict(role="Attrition swarm",        theme="Rat King, disease"),
    "Frost":     dict(role="Control bruiser",        theme="Living wall of ice"),
    "Holy":      dict(role="Sustain juggernaut",     theme="Light that burns brighter near death"),
}

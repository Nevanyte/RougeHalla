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
    name="Fire", hp=835, rate=0.60, hit=100,
    phys=0.0, true=0.0, armor=0, shield=45,
    mechanic="dragonslayer", params=dict(burn=18, backlash=145),
    sig_types=dict(burn=(0.0, 0.0), backlash=(1.0, 0.0)),
)
SENTENCED = PowerSpec(
    name="Sentenced", hp=800, rate=0.90, hit=10,
    phys=0.0, true=0.0, armor=125, shield=210,
    mechanic="marked", params=dict(mark_ramp=17.5, mark_cap=72),
    sig_types=dict(mark=(0.0, 1.0)),
)
PLAGUE = PowerSpec(
    name="Plague", hp=1375, rate=1.85, hit=20,
    phys=0.8, true=0.0, armor=190, shield=0,
    mechanic="rat_king", params=dict(plague=43, execute=415),
    sig_types=dict(disease=(0.0, 0.0)),
)
FROST = PowerSpec(
    name="Frost", hp=1200, rate=0.45, hit=175,
    phys=0.9, true=0.0, armor=20, shield=190,
    aura="wall_of_ice", params=dict(slow=0.52),
)
HOLY = PowerSpec(
    name="Holy", hp=1400, rate=0.95, hit=96,
    phys=1.0, true=0.0, armor=0, shield=250,
    sustain="radiant", params=dict(ls0=0.10, ls1=0.80, ls_cap=0.75),
)

POWERS = [FIRE, SENTENCED, PLAGUE, FROST, HOLY]

# Target graph C5^2: each power beats exactly two others. (winner, loser)
BEATS = [
    ("Fire", "Sentenced"), ("Fire", "Plague"),
    ("Sentenced", "Plague"), ("Sentenced", "Frost"),
    ("Plague", "Frost"), ("Plague", "Holy"),
    ("Frost", "Holy"), ("Frost", "Fire"),
    ("Holy", "Fire"), ("Holy", "Sentenced"),
]

# Design intent (documentation only; nothing in the engine reads this).
ROLES = {
    "Fire":      dict(role="Glass-cannon duelist",   theme="Dragonslayer, living fire"),
    "Sentenced": dict(role="Patient executioner",    theme="Marked for judgment"),
    "Plague":    dict(role="Attrition swarm",        theme="Rat King, disease"),
    "Frost":     dict(role="Control bruiser",        theme="Living wall of ice"),
    "Holy":      dict(role="Sustain juggernaut",     theme="Light that burns brighter near death"),
}

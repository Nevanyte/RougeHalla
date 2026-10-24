"""
The five powers (v2: damage types and defenses follow each class's identity;
v3: Fire and Frost attack faster with lighter hits, same damage per second, and backlash 210 -> 200).
Every number here is on a design grid:
  hp x50 | rate x0.05 | hit x5 | burn/backlash/plague x5 | execute x50
  mark_ramp x5 | mark_cap x25 | armor/shield x25 | damage shares x10%

Order matters only for the printed matrix: Fire, Sentenced, Plague, Frost, Holy.
"""
from engine import PowerSpec

FIRE = PowerSpec(
    name="Fire", hp=500, rate=0.60, hit=150,
    phys=0.0, true=0.0, armor=0, shield=125,
    mechanic="dragonslayer", params=dict(burn=10, backlash=200),
)
SENTENCED = PowerSpec(
    name="Sentenced", hp=700, rate=0.90, hit=5,
    phys=0.0, true=0.0, armor=100, shield=50,
    mechanic="marked", params=dict(mark_ramp=35, mark_cap=275),
)
PLAGUE = PowerSpec(
    name="Plague", hp=1000, rate=1.85, hit=20,
    phys=0.8, true=0.0, armor=200, shield=0,
    mechanic="rat_king", params=dict(plague=40, execute=2050),
)
FROST = PowerSpec(
    name="Frost", hp=1750, rate=0.45, hit=90,
    phys=0.9, true=0.0, armor=100, shield=100,
    aura="wall_of_ice", params=dict(slow=0.60),
)
HOLY = PowerSpec(
    name="Holy", hp=1450, rate=0.95, hit=65,
    phys=1.0, true=0.0, armor=0, shield=250,
    sustain="radiant", params=dict(ls0=0.25, ls1=1.75, ls_cap=1.50),
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

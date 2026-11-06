use crate::math::js_round;
use crate::stat_fold::{default_definition, js, Folded, StatFoldDefinition, StatSums};

#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash)]
pub enum MirrorField {
    AsMult,
    WindupMult,
    SpeedMult,
    ArmorBonus,
    ShieldBonus,
    AdBonus,
    ApBonus,
}

impl MirrorField {
    pub fn source_order() -> [Self; 7] {
        [
            Self::AsMult,
            Self::WindupMult,
            Self::SpeedMult,
            Self::ArmorBonus,
            Self::ShieldBonus,
            Self::AdBonus,
            Self::ApBonus,
        ]
    }
}

#[derive(Clone, Copy, Debug, PartialEq)]
pub struct StatMirrors {
    pub as_mult: f64,
    pub windup_mult: f64,
    pub speed_mult: f64,
    pub armor_bonus: f64,
    pub shield_bonus: f64,
    pub ad_bonus: f64,
    pub ap_bonus: f64,
}

impl StatMirrors {
    pub fn get(&self, field: MirrorField) -> f64 {
        match field {
            MirrorField::AsMult => self.as_mult,
            MirrorField::WindupMult => self.windup_mult,
            MirrorField::SpeedMult => self.speed_mult,
            MirrorField::ArmorBonus => self.armor_bonus,
            MirrorField::ShieldBonus => self.shield_bonus,
            MirrorField::AdBonus => self.ad_bonus,
            MirrorField::ApBonus => self.ap_bonus,
        }
    }

    pub fn source_values(&self) -> [f64; 7] {
        MirrorField::source_order().map(|field| self.get(field))
    }

    pub fn from_source_values(values: [f64; 7]) -> Self {
        Self {
            as_mult: values[0],
            windup_mult: values[1],
            speed_mult: values[2],
            armor_bonus: values[3],
            shield_bonus: values[4],
            ad_bonus: values[5],
            ap_bonus: values[6],
        }
    }
}

impl Default for StatMirrors {
    fn default() -> Self {
        identity_mirrors()
    }
}

#[derive(Clone, Copy, Debug, PartialEq)]
pub struct WireMirrors {
    pub as_mult: f64,
    pub windup_mult: f64,
    pub speed_mult: f64,
    pub armor_bonus: f64,
    pub shield_bonus: f64,
    pub ad_bonus: f64,
    pub ap_bonus: f64,
}

impl WireMirrors {
    pub fn get(&self, field: MirrorField) -> f64 {
        match field {
            MirrorField::AsMult => self.as_mult,
            MirrorField::WindupMult => self.windup_mult,
            MirrorField::SpeedMult => self.speed_mult,
            MirrorField::ArmorBonus => self.armor_bonus,
            MirrorField::ShieldBonus => self.shield_bonus,
            MirrorField::AdBonus => self.ad_bonus,
            MirrorField::ApBonus => self.ap_bonus,
        }
    }

    pub fn source_values(&self) -> [f64; 7] {
        MirrorField::source_order().map(|field| self.get(field))
    }

    pub fn from_source_values(values: [f64; 7]) -> Self {
        Self {
            as_mult: values[0],
            windup_mult: values[1],
            speed_mult: values[2],
            armor_bonus: values[3],
            shield_bonus: values[4],
            ad_bonus: values[5],
            ap_bonus: values[6],
        }
    }
}

impl Default for WireMirrors {
    fn default() -> Self {
        wire_identity_mirrors()
    }
}

#[derive(Clone, Copy, Debug, PartialEq)]
pub struct SourceMods {
    pub as_mult: f64,
    pub speed_mult: f64,
    pub windup_mult: f64,
    pub armor: f64,
    pub shield: f64,
}

impl Default for SourceMods {
    fn default() -> Self {
        no_source_mods()
    }
}

pub fn identity_mirrors() -> StatMirrors {
    StatMirrors {
        as_mult: 1.0,
        windup_mult: 1.0,
        speed_mult: 1.0,
        armor_bonus: 0.0,
        shield_bonus: 0.0,
        ad_bonus: 0.0,
        ap_bonus: 0.0,
    }
}

pub fn no_source_mods() -> SourceMods {
    SourceMods {
        as_mult: 1.0,
        speed_mult: 1.0,
        windup_mult: 1.0,
        armor: 0.0,
        shield: 0.0,
    }
}

pub fn cap_as_mult(x: f64) -> f64 {
    cap_as_mult_with_definition(x, &default_definition())
}

pub fn cap_as_mult_with_definition(x: f64, definition: &StatFoldDefinition) -> f64 {
    if x > definition.as_mult_cap {
        definition.as_mult_cap
    } else {
        x
    }
}

pub fn encode_mult(x: f64) -> f64 {
    encode_mult_with_definition(x, &default_definition())
}

pub fn encode_mult_with_definition(x: f64, definition: &StatFoldDefinition) -> f64 {
    if !x.is_finite() {
        return definition.mult_wire_per_unit;
    }
    if x > f64::MAX / definition.mult_wire_per_unit {
        return f64::MAX;
    }
    let n = (x * definition.mult_wire_per_unit + 0.5).floor();
    let min = js_round(definition.mod_mult_min * definition.mult_wire_per_unit);
    if n < min {
        min
    } else {
        n
    }
}

pub fn decode_mult(wire: impl Into<Option<f64>>) -> f64 {
    decode_mult_with_definition(wire, &default_definition())
}

pub fn decode_mult_with_definition(
    wire: impl Into<Option<f64>>,
    definition: &StatFoldDefinition,
) -> f64 {
    match wire.into() {
        Some(wire) if wire.is_finite() => wire / definition.mult_wire_per_unit,
        _ => 1.0,
    }
}

pub fn encode_flat(x: f64) -> f64 {
    encode_flat_with_definition(x, &default_definition())
}

pub fn encode_flat_with_definition(x: f64, definition: &StatFoldDefinition) -> f64 {
    if !x.is_finite() {
        return 0.0;
    }
    if x > f64::MAX / definition.flat_wire_per_point {
        return f64::MAX;
    }
    if x < -f64::MAX / definition.flat_wire_per_point {
        return -f64::MAX;
    }
    (x * definition.flat_wire_per_point + 0.5).floor()
}

pub fn decode_flat(wire: impl Into<Option<f64>>) -> f64 {
    decode_flat_with_definition(wire, &default_definition())
}

pub fn decode_flat_with_definition(
    wire: impl Into<Option<f64>>,
    definition: &StatFoldDefinition,
) -> f64 {
    wire.into().unwrap_or(f64::NAN) / definition.flat_wire_per_point
}

pub fn mirrors_from_sums(sums: &StatSums) -> StatMirrors {
    StatMirrors {
        as_mult: 1.0 + sums.attack_speed,
        windup_mult: 1.0 + sums.windup,
        speed_mult: 1.0 + sums.move_speed,
        armor_bonus: sums.armor,
        shield_bonus: sums.shield,
        ad_bonus: sums.ad,
        ap_bonus: sums.ap,
    }
}

pub fn mirrors_from_fold(folded: &Folded) -> StatMirrors {
    mirrors_from_fold_with_definition(folded, &no_source_mods(), 1.0, &default_definition())
}

pub fn mirrors_from_fold_with_sources(
    folded: &Folded,
    source: &SourceMods,
    farm_as_efficiency: f64,
) -> StatMirrors {
    mirrors_from_fold_with_definition(folded, source, farm_as_efficiency, &default_definition())
}

pub fn mirrors_from_fold_with_definition(
    folded: &Folded,
    source: &SourceMods,
    farm_as_efficiency: f64,
    definition: &StatFoldDefinition,
) -> StatMirrors {
    let mut mirrors = mirrors_from_sums(&folded.sums);
    let efficiency = if farm_as_efficiency.is_finite() {
        js::max(0.0, farm_as_efficiency)
    } else {
        1.0
    };
    let row_as = folded.sums.attack_speed;
    let adjusted_row_as = if row_as > 0.0 {
        row_as * efficiency
    } else {
        row_as
    };
    let adjusted_farm_as = if folded.farm_sums.attack_speed > 0.0 {
        folded.farm_sums.attack_speed * efficiency
    } else {
        folded.farm_sums.attack_speed
    };
    mirrors.as_mult =
        (cap_as_mult_with_definition((1.0 + adjusted_row_as) * source.as_mult, definition)
            + adjusted_farm_as * source.as_mult)
            * folded.mults.as_post;
    mirrors.speed_mult = (mirrors.speed_mult + folded.farm_sums.move_speed) * source.speed_mult;
    mirrors.windup_mult *= source.windup_mult;
    mirrors.armor_bonus = js::min(
        definition.bonus_defense_cap,
        mirrors.armor_bonus + source.armor,
    ) + folded.farm_sums.armor;
    mirrors.shield_bonus = js::min(
        definition.bonus_defense_cap,
        mirrors.shield_bonus + source.shield,
    ) + folded.farm_sums.shield;
    mirrors.ad_bonus += folded.farm_sums.ad;
    mirrors.ap_bonus += folded.farm_sums.ap;
    mirrors
}

pub fn encode_mirrors(mirrors: &StatMirrors) -> WireMirrors {
    encode_mirrors_with_definition(mirrors, &default_definition())
}

pub fn encode_mirrors_with_definition(
    mirrors: &StatMirrors,
    definition: &StatFoldDefinition,
) -> WireMirrors {
    WireMirrors {
        as_mult: encode_mult_with_definition(mirrors.as_mult, definition),
        windup_mult: encode_mult_with_definition(mirrors.windup_mult, definition),
        speed_mult: encode_mult_with_definition(mirrors.speed_mult, definition),
        armor_bonus: encode_flat_with_definition(mirrors.armor_bonus, definition),
        shield_bonus: encode_flat_with_definition(mirrors.shield_bonus, definition),
        ad_bonus: encode_flat_with_definition(mirrors.ad_bonus, definition),
        ap_bonus: encode_flat_with_definition(mirrors.ap_bonus, definition),
    }
}

pub fn decode_mirrors(wire: &WireMirrors) -> StatMirrors {
    decode_mirrors_with_definition(wire, &default_definition())
}

pub fn decode_mirrors_with_definition(
    wire: &WireMirrors,
    definition: &StatFoldDefinition,
) -> StatMirrors {
    StatMirrors {
        as_mult: decode_mult_with_definition(wire.as_mult, definition),
        windup_mult: decode_mult_with_definition(wire.windup_mult, definition),
        speed_mult: decode_mult_with_definition(wire.speed_mult, definition),
        armor_bonus: decode_flat_with_definition(wire.armor_bonus, definition),
        shield_bonus: decode_flat_with_definition(wire.shield_bonus, definition),
        ad_bonus: decode_flat_with_definition(wire.ad_bonus, definition),
        ap_bonus: decode_flat_with_definition(wire.ap_bonus, definition),
    }
}

pub fn wire_identity_mirrors() -> WireMirrors {
    encode_mirrors(&identity_mirrors())
}

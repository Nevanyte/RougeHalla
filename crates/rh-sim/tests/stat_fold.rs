use rh_sim::stat_fold as kernel;
use serde::{Deserialize, Deserializer, Serialize};
use serde_json::{json, Map, Value};
use std::collections::{BTreeMap, BTreeSet};
use std::{env, fs};

const BASE_COMMIT: &str = "de6f1c196f9b6a42e50dfdf19327d72bd3683fc8";
const CANONICAL_CASES: usize = 463;
const CONTINUOUS_TOLERANCE: f64 = 2e-6;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
struct F64(u64);

impl F64 {
    fn value(self) -> f64 {
        f64::from_bits(self.0)
    }

    fn bits(self) -> String {
        format!("{:016x}", self.0)
    }

    fn classification(self) -> &'static str {
        let value = self.value();
        if value.is_nan() {
            "nan"
        } else if value == f64::INFINITY {
            "+infinity"
        } else if value == f64::NEG_INFINITY {
            "-infinity"
        } else if value == 0.0 && value.is_sign_negative() {
            "-zero"
        } else if value == 0.0 {
            "+zero"
        } else {
            "finite"
        }
    }
}

impl From<f64> for F64 {
    fn from(value: f64) -> Self {
        Self(value.to_bits())
    }
}

impl<'de> Deserialize<'de> for F64 {
    fn deserialize<D>(deserializer: D) -> Result<Self, D::Error>
    where
        D: Deserializer<'de>,
    {
        #[derive(Deserialize)]
        #[serde(rename_all = "camelCase", deny_unknown_fields)]
        struct Wrapper {
            f64: String,
        }

        let wrapper = Wrapper::deserialize(deserializer)?;
        let text = wrapper.f64;
        if text.len() != 16
            || !text
                .bytes()
                .all(|byte| byte.is_ascii_digit() || (b'a'..=b'f').contains(&byte))
        {
            return Err(serde::de::Error::custom(
                "f64 must contain exactly 16 lowercase hexadecimal digits",
            ));
        }
        u64::from_str_radix(&text, 16)
            .map(Self)
            .map_err(serde::de::Error::custom)
    }
}

fn optional<'de, D, T>(deserializer: D) -> Result<Option<T>, D::Error>
where
    D: Deserializer<'de>,
    T: Deserialize<'de>,
{
    T::deserialize(deserializer).map(Some)
}

fn required_nullable<'de, D, T>(deserializer: D) -> Result<Option<T>, D::Error>
where
    D: Deserializer<'de>,
    T: Deserialize<'de>,
{
    Option::<T>::deserialize(deserializer)
}

#[derive(Clone, Copy, Debug, Deserialize, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
enum Preset {
    Canonical,
    Ci,
    Soak,
}

#[derive(Clone, Copy, Debug, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
enum CaseKind {
    Fold,
    StatFold,
    Requirements,
    BoostBonus,
    BoostGain,
    MultCodec,
    FlatCodec,
    Mirrors,
}

#[derive(Clone, Copy, Debug, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
enum StatName {
    MaxHp,
    AttackSpeed,
    MoveSpeed,
    Damage,
    Windup,
    Lifesteal,
    MarkRate,
    HealTaken,
    DamageTaken,
    Cooldown,
    ExecuteBand,
    SlowResist,
    LifestealMult,
    LifestealDot,
    CritChance,
    HealBarrier,
    Armor,
    Shield,
    Ad,
    Ap,
}

#[derive(Clone, Copy, Debug, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
enum EffectStatName {
    MaxHp,
    AttackSpeed,
    MoveSpeed,
    Damage,
    Windup,
    Lifesteal,
    MarkRate,
    HealTaken,
    DamageTaken,
    Cooldown,
    ExecuteBand,
    SlowResist,
    LifestealMult,
    LifestealDot,
    CritChance,
    HealBarrier,
}

#[derive(Clone, Copy, Debug, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
enum FlatStatName {
    Armor,
    Shield,
    Ad,
    Ap,
}

#[derive(Clone, Copy, Debug, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
enum MultName {
    AsPost,
    Hit,
    Dot,
    Returned,
    Ap,
    WishCooldown,
    HpRace,
    Linger,
}

#[derive(Clone, Copy, Debug, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
enum FlagName {
    LockSecondSlot,
    NoCrit,
    DotCrit,
    PlagueDotCritConversion,
    Gambler,
    ThirdCharm,
    EyeForAnEye,
    TwiceUnarmed,
    BlockHits,
    PlantFeet,
    Festering,
    HeavierSentence,
    SwiftJudgment,
    GallowsPatience,
    NoCommutation,
    FinalVerdict,
}

#[derive(Clone, Copy, Debug, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
enum ConvertFromName {
    Ad,
    MaxHp,
    BonusAttackSpeed,
    BonusMoveSpeed,
}

#[derive(Clone, Copy, Debug, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
enum ConvertToName {
    AttackSpeed,
    MoveSpeed,
    Damage,
    Windup,
    Lifesteal,
    MarkRate,
    HealTaken,
    DamageTaken,
    Cooldown,
    ExecuteBand,
    SlowResist,
    LifestealMult,
    LifestealDot,
    CritChance,
    HealBarrier,
    Armor,
    Shield,
    Ad,
    Ap,
}

#[derive(Clone, Copy, Debug, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
enum BoostStatName {
    Ad,
    Ap,
    Armor,
    Shield,
    MaxHp,
    AttackSpeed,
    MoveSpeed,
    Lifesteal,
}

#[derive(Clone, Copy, Debug, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
enum WhileCondName {
    ChasingLock,
    HpBelow,
    AfterCast,
    NotShooting,
    Unarmed,
    FightTime,
}

#[derive(Clone, Copy, Debug, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
enum VsTest {
    HpAbove,
    HpBelow,
    Slowed,
    Rooted,
    Streak,
    ThirdParty,
    HigherFeed,
    Elite,
    HigherPower,
    PlayerAbove,
}

#[derive(Clone, Copy, Debug, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
enum ScaleSource {
    OwnMissingHp,
    CampsCleared,
    Streak,
}

#[derive(Clone, Copy, Debug, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
enum OnHitStatus {
    SlowMove,
    SlowAttack,
    AntiHeal,
    Dot,
}

#[derive(Clone, Copy, Debug, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
enum TriggerOn {
    HpBelow,
    Kill,
    HitTaken,
    Hit,
    Block,
}

#[derive(Clone, Copy, Debug, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
enum StatusKind {
    Stun,
    Root,
    Silence,
    SlowMove,
    SlowAttack,
    AntiHeal,
    Dot,
    Invulnerable,
    Untargetable,
    Hidden,
    Zoned,
    DeathFloor,
    Haste,
    Shred,
}

#[derive(Clone, Copy, Debug, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
enum TriggerTarget {
    #[serde(rename = "self")]
    Self_,
    Target,
}

#[derive(Clone, Copy, Debug, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
enum CleanseClass {
    Soft,
    Hard,
    Never,
}

#[derive(Clone, Copy, Debug, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
enum Needs {
    Status,
}

#[derive(Clone, Copy, Debug, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
enum Rearm {
    Teleport,
}

#[allow(dead_code)]
#[derive(Clone, Debug, Deserialize)]
#[serde(
    tag = "do",
    rename_all = "camelCase",
    rename_all_fields = "camelCase",
    deny_unknown_fields
)]
enum TriggerAction {
    Status {
        to: TriggerTarget,
        status: StatusKind,
        ms: F64,
        #[serde(default, deserialize_with = "optional")]
        value: Option<F64>,
    },
    Cleanse {
        to: TriggerTarget,
        classes: Vec<CleanseClass>,
    },
    Heal {
        share: F64,
        #[serde(default, deserialize_with = "optional")]
        ignore_lockout: Option<bool>,
        #[serde(default, deserialize_with = "optional")]
        ms: Option<F64>,
    },
    Barrier {
        share: F64,
        ms: F64,
    },
    Cooldown {
        ms: F64,
    },
    Boost {
        #[serde(rename = "as")]
        as_: F64,
        #[serde(rename = "move")]
        move_: F64,
        ms: F64,
    },
    Return {
        share: F64,
        #[serde(default, deserialize_with = "optional")]
        melee: Option<bool>,
    },
    Fortify {
        per: F64,
        cap: F64,
    },
    Splash {
        radius: F64,
    },
}

#[allow(dead_code)]
#[derive(Clone, Debug, Deserialize)]
#[serde(
    tag = "k",
    rename_all = "camelCase",
    rename_all_fields = "camelCase",
    deny_unknown_fields
)]
enum Row {
    Stat {
        stat: EffectStatName,
        v: F64,
        #[serde(default, deserialize_with = "optional")]
        requires: Option<Vec<String>>,
        #[serde(default, deserialize_with = "optional")]
        needs: Option<Needs>,
    },
    Flat {
        stat: FlatStatName,
        v: F64,
        #[serde(default, deserialize_with = "optional")]
        requires: Option<Vec<String>>,
        #[serde(default, deserialize_with = "optional")]
        needs: Option<Needs>,
    },
    Vs {
        test: VsTest,
        arg: F64,
        v: F64,
        #[serde(default, deserialize_with = "optional")]
        requires: Option<Vec<String>>,
        #[serde(default, deserialize_with = "optional")]
        needs: Option<Needs>,
    },
    Scale {
        src: ScaleSource,
        per: F64,
        step: F64,
        #[serde(default, deserialize_with = "optional")]
        cap: Option<F64>,
        #[serde(default, deserialize_with = "optional")]
        requires: Option<Vec<String>>,
        #[serde(default, deserialize_with = "optional")]
        needs: Option<Needs>,
    },
    While {
        cond: WhileCondName,
        arg: F64,
        stat: StatName,
        v: F64,
        #[serde(default, deserialize_with = "optional")]
        ms: Option<F64>,
        #[serde(default, deserialize_with = "optional")]
        requires: Option<Vec<String>>,
        #[serde(default, deserialize_with = "optional")]
        needs: Option<Needs>,
    },
    OnHit {
        status: OnHitStatus,
        per: F64,
        cap: F64,
        ms: F64,
        #[serde(default, deserialize_with = "optional")]
        requires: Option<Vec<String>>,
        #[serde(default, deserialize_with = "optional")]
        needs: Option<Needs>,
    },
    Convert {
        from: ConvertFromName,
        to: ConvertToName,
        per: F64,
        #[serde(default, deserialize_with = "optional")]
        cap: Option<F64>,
        #[serde(default, deserialize_with = "optional")]
        requires: Option<Vec<String>>,
        #[serde(default, deserialize_with = "optional")]
        needs: Option<Needs>,
    },
    Mult {
        key: MultName,
        v: F64,
        #[serde(default, deserialize_with = "optional")]
        requires: Option<Vec<String>>,
        #[serde(default, deserialize_with = "optional")]
        needs: Option<Needs>,
    },
    Flag {
        flag: FlagName,
        #[serde(default, deserialize_with = "optional")]
        requires: Option<Vec<String>>,
        #[serde(default, deserialize_with = "optional")]
        needs: Option<Needs>,
    },
    Trigger {
        on: TriggerOn,
        arg: F64,
        #[serde(default, deserialize_with = "optional")]
        once: Option<bool>,
        #[serde(default, deserialize_with = "optional")]
        rearm: Option<Rearm>,
        #[serde(rename = "do")]
        action: TriggerAction,
        #[serde(default, deserialize_with = "optional")]
        requires: Option<Vec<String>>,
        #[serde(default, deserialize_with = "optional")]
        needs: Option<Needs>,
    },
}

impl Row {
    fn requirements(&self) -> Option<&[String]> {
        match self {
            Self::Stat { requires, .. }
            | Self::Flat { requires, .. }
            | Self::Vs { requires, .. }
            | Self::Scale { requires, .. }
            | Self::While { requires, .. }
            | Self::OnHit { requires, .. }
            | Self::Convert { requires, .. }
            | Self::Mult { requires, .. }
            | Self::Flag { requires, .. }
            | Self::Trigger { requires, .. } => requires.as_deref(),
        }
    }

    fn needs_status(&self) -> bool {
        match self {
            Self::Stat { needs, .. }
            | Self::Flat { needs, .. }
            | Self::Vs { needs, .. }
            | Self::Scale { needs, .. }
            | Self::While { needs, .. }
            | Self::OnHit { needs, .. }
            | Self::Convert { needs, .. }
            | Self::Mult { needs, .. }
            | Self::Flag { needs, .. }
            | Self::Trigger { needs, .. } => needs.is_some(),
        }
    }

    fn is_while(&self) -> bool {
        matches!(self, Self::While { .. })
    }
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct SourceInput {
    as_mult: F64,
    speed_mult: F64,
    windup_mult: F64,
    armor: F64,
    shield: F64,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct FoldInput {
    rows: Vec<Row>,
    farm_rows: Vec<Row>,
    holds: Vec<Option<bool>>,
    farm_holds: Vec<Option<bool>>,
    #[serde(deserialize_with = "required_nullable")]
    owned: Option<Vec<String>>,
    #[serde(deserialize_with = "required_nullable")]
    base_max_hp: Option<F64>,
    #[serde(deserialize_with = "required_nullable")]
    boosts: Option<[Option<F64>; 8]>,
    source: SourceInput,
    farm_as_efficiency: F64,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct StatFoldInput {
    rows: Vec<Row>,
    holds: Vec<Option<bool>>,
    #[serde(deserialize_with = "required_nullable")]
    owned: Option<Vec<String>>,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct RequirementsInput {
    row: Row,
    #[serde(deserialize_with = "required_nullable")]
    owned: Option<Vec<String>>,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct BoostBonusInput {
    picks: F64,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct BoostGainInput {
    stat: BoostStatName,
    picks: F64,
    current: F64,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct CodecInput {
    #[serde(deserialize_with = "required_nullable")]
    value: Option<F64>,
    #[serde(deserialize_with = "required_nullable")]
    wire: Option<F64>,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct MirrorsInput {
    values: [Option<F64>; 7],
    wire: [Option<F64>; 7],
}

#[derive(Clone, Debug)]
enum Input {
    Fold(FoldInput),
    StatFold(StatFoldInput),
    Requirements(RequirementsInput),
    BoostBonus(BoostBonusInput),
    BoostGain(BoostGainInput),
    MultCodec(CodecInput),
    FlatCodec(CodecInput),
    Mirrors(MirrorsInput),
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct FoldOutput {
    plain: [F64; 20],
    sums: [F64; 20],
    farm_sums: [F64; 20],
    mults: [F64; 8],
    flags: Vec<FlagName>,
    max_hp: F64,
    mirrors_from_sums: [F64; 7],
    mirrors_from_fold: [F64; 7],
    encoded: [F64; 7],
    decoded: [F64; 7],
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct StatFoldOutput {
    sums: [F64; 20],
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct RequirementsOutput {
    met: bool,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct BoostBonusOutput {
    bonus: F64,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct BoostGainOutput {
    gain: F64,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct CodecOutput {
    encoded: F64,
    decoded: F64,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct MirrorsOutput {
    encoded: [F64; 7],
    decoded: [F64; 7],
}

#[allow(clippy::large_enum_variant)]
#[derive(Clone, Debug)]
enum Output {
    Fold(FoldOutput),
    StatFold(StatFoldOutput),
    Requirements(RequirementsOutput),
    BoostBonus(BoostBonusOutput),
    BoostGain(BoostGainOutput),
    Codec(CodecOutput),
    Mirrors(MirrorsOutput),
}

#[derive(Clone, Debug, Deserialize)]
#[serde(
    tag = "kind",
    rename_all = "camelCase",
    rename_all_fields = "camelCase",
    deny_unknown_fields
)]
enum Origin {
    Synthetic {
        label: String,
    },
    Card {
        card_id: String,
        #[serde(deserialize_with = "required_nullable")]
        faction: Option<String>,
    },
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct SourceHash {
    path: String,
    sha256: String,
}

#[derive(Clone, Copy, Debug, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
enum CaptureMode {
    Canonical,
    Diagnostic,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct Runtime {
    node: String,
    platform: String,
    arch: String,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct Provenance {
    mode: CaptureMode,
    command: String,
    commit: String,
    base: String,
    runtime: Runtime,
    sources: Vec<SourceHash>,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct Coverage {
    id: String,
    count: u64,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct WireCase {
    id: String,
    seed: u32,
    origin: Origin,
    tags: Vec<String>,
    kind: CaseKind,
    input: Value,
    expected: Value,
}

#[derive(Clone, Debug)]
struct Case {
    id: String,
    seed: u32,
    origin: Origin,
    kind: CaseKind,
    input_value: Value,
    input: Input,
    expected: Output,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct WireCorpus {
    format: String,
    preset: Preset,
    provenance: Provenance,
    coverage: Vec<Coverage>,
    cases: Vec<WireCase>,
}

#[derive(Clone, Debug)]
struct Corpus {
    preset: Preset,
    provenance: Provenance,
    coverage: Vec<Coverage>,
    cases: Vec<Case>,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum Admission {
    Canonical,
    External,
}

fn parse_input(kind: CaseKind, value: Value) -> Result<Input, String> {
    macro_rules! parse {
        ($variant:ident, $ty:ty) => {
            serde_json::from_value::<$ty>(value)
                .map(Input::$variant)
                .map_err(|error| error.to_string())
        };
    }
    match kind {
        CaseKind::Fold => parse!(Fold, FoldInput),
        CaseKind::StatFold => parse!(StatFold, StatFoldInput),
        CaseKind::Requirements => parse!(Requirements, RequirementsInput),
        CaseKind::BoostBonus => parse!(BoostBonus, BoostBonusInput),
        CaseKind::BoostGain => parse!(BoostGain, BoostGainInput),
        CaseKind::MultCodec => parse!(MultCodec, CodecInput),
        CaseKind::FlatCodec => parse!(FlatCodec, CodecInput),
        CaseKind::Mirrors => parse!(Mirrors, MirrorsInput),
    }
}

fn parse_output(kind: CaseKind, value: Value) -> Result<Output, String> {
    macro_rules! parse {
        ($variant:ident, $ty:ty) => {
            serde_json::from_value::<$ty>(value)
                .map(Output::$variant)
                .map_err(|error| error.to_string())
        };
    }
    match kind {
        CaseKind::Fold => parse!(Fold, FoldOutput),
        CaseKind::StatFold => parse!(StatFold, StatFoldOutput),
        CaseKind::Requirements => parse!(Requirements, RequirementsOutput),
        CaseKind::BoostBonus => parse!(BoostBonus, BoostBonusOutput),
        CaseKind::BoostGain => parse!(BoostGain, BoostGainOutput),
        CaseKind::MultCodec | CaseKind::FlatCodec => parse!(Codec, CodecOutput),
        CaseKind::Mirrors => parse!(Mirrors, MirrorsOutput),
    }
}

fn nonempty(value: &str, path: &str) -> Result<(), String> {
    if value.is_empty() {
        Err(format!("{path}: expected nonempty string"))
    } else {
        Ok(())
    }
}

fn validate_strings(values: &[String], path: &str) -> Result<(), String> {
    for (index, value) in values.iter().enumerate() {
        nonempty(value, &format!("{path}[{index}]"))?;
    }
    Ok(())
}

fn validate_rows(rows: &[Row], path: &str) -> Result<(), String> {
    for (index, row) in rows.iter().enumerate() {
        if let Some(requires) = row.requirements() {
            validate_strings(requires, &format!("{path}[{index}].requires"))?;
        }
        if let Row::Trigger {
            action: TriggerAction::Return {
                melee: Some(melee), ..
            },
            ..
        } = row
        {
            if !melee {
                return Err(format!("{path}[{index}].do.melee: expected true"));
            }
        }
    }
    Ok(())
}

fn validate_holds(rows: &[Row], holds: &[Option<bool>], path: &str) -> Result<(), String> {
    if rows.len() != holds.len() {
        return Err(format!(
            "{path}: expected length {}, got {}",
            rows.len(),
            holds.len()
        ));
    }
    for (index, (row, answer)) in rows.iter().zip(holds).enumerate() {
        if row.is_while() != answer.is_some() {
            return Err(format!(
                "{path}[{index}]: while rows require booleans and other rows require null"
            ));
        }
    }
    Ok(())
}

fn validate_input(input: &Input) -> Result<(), String> {
    match input {
        Input::Fold(input) => {
            validate_rows(&input.rows, "input.rows")?;
            validate_rows(&input.farm_rows, "input.farmRows")?;
            validate_holds(&input.rows, &input.holds, "input.holds")?;
            validate_holds(&input.farm_rows, &input.farm_holds, "input.farmHolds")?;
            if let Some(owned) = &input.owned {
                validate_strings(owned, "input.owned")?;
            }
        }
        Input::StatFold(input) => {
            validate_rows(&input.rows, "input.rows")?;
            validate_holds(&input.rows, &input.holds, "input.holds")?;
            if let Some(owned) = &input.owned {
                validate_strings(owned, "input.owned")?;
            }
        }
        Input::Requirements(input) => {
            validate_rows(std::slice::from_ref(&input.row), "input.row")?;
            if let Some(owned) = &input.owned {
                validate_strings(owned, "input.owned")?;
            }
        }
        Input::BoostBonus(_)
        | Input::BoostGain(_)
        | Input::MultCodec(_)
        | Input::FlatCodec(_)
        | Input::Mirrors(_) => {}
    }
    Ok(())
}

fn stable(value: &Value) -> Value {
    match value {
        Value::Array(values) => Value::Array(values.iter().map(stable).collect()),
        Value::Object(values) => {
            let mut sorted = Map::new();
            let mut keys: Vec<_> = values.keys().collect();
            keys.sort_unstable();
            for key in keys {
                sorted.insert(key.clone(), stable(&values[key]));
            }
            Value::Object(sorted)
        }
        _ => value.clone(),
    }
}

fn semantic_key(case: &WireCase) -> String {
    let kind = match case.kind {
        CaseKind::Fold => "fold",
        CaseKind::StatFold => "statFold",
        CaseKind::Requirements => "requirements",
        CaseKind::BoostBonus => "boostBonus",
        CaseKind::BoostGain => "boostGain",
        CaseKind::MultCodec => "multCodec",
        CaseKind::FlatCodec => "flatCodec",
        CaseKind::Mirrors => "mirrors",
    };
    stable(&json!({ "kind": kind, "input": case.input })).to_string()
}

fn validate_provenance(provenance: &Provenance) -> Result<(), String> {
    nonempty(&provenance.command, "provenance.command")?;
    nonempty(&provenance.commit, "provenance.commit")?;
    if provenance.base != BASE_COMMIT {
        return Err("provenance.base: wrong packet base".into());
    }
    nonempty(&provenance.runtime.node, "provenance.runtime.node")?;
    nonempty(&provenance.runtime.platform, "provenance.runtime.platform")?;
    nonempty(&provenance.runtime.arch, "provenance.runtime.arch")?;
    let mut paths = BTreeSet::new();
    for (index, source) in provenance.sources.iter().enumerate() {
        nonempty(&source.path, &format!("provenance.sources[{index}].path"))?;
        if source.sha256.len() != 64
            || !source
                .sha256
                .bytes()
                .all(|byte| byte.is_ascii_digit() || (b'a'..=b'f').contains(&byte))
        {
            return Err(format!("provenance.sources[{index}].sha256: malformed"));
        }
        if !paths.insert(&source.path) {
            return Err(format!("provenance.sources: duplicate {}", source.path));
        }
    }
    const SOURCE_PATHS: [&str; 10] = [
        "packages/shared/src/mods.ts",
        "packages/shared/src/effects.ts",
        "packages/shared/src/chestBoosts.ts",
        "packages/shared/src/constants.ts",
        "packages/shared/src/cards.ts",
        "tools/stat-fold/float.ts",
        "tools/stat-fold/schema.ts",
        "tools/stat-fold/inventory.ts",
        "tools/stat-fold/oracle.ts",
        "tools/stat-fold/capture.ts",
    ];
    let capture: BTreeSet<&str> = SOURCE_PATHS.into_iter().collect();
    let mut runner = capture.clone();
    runner.insert("tools/stat-fold/run.ts");
    let actual: BTreeSet<&str> = paths.into_iter().map(String::as_str).collect();
    if actual != capture && actual != runner {
        return Err("provenance.sources: expected exact capture or runner source inventory".into());
    }
    if provenance.mode == CaptureMode::Canonical
        && (provenance.runtime.node != "v22.23.4"
            || provenance.runtime.platform != "linux"
            || provenance.runtime.arch != "x64")
    {
        return Err("provenance.runtime: canonical requires Linux x64 Node22.23.4".into());
    }
    Ok(())
}

const CANONICAL_COVERAGE: [&str; 207] = [
    "stat:maxHp",
    "stat:attackSpeed",
    "stat:moveSpeed",
    "stat:damage",
    "stat:windup",
    "stat:lifesteal",
    "stat:markRate",
    "stat:healTaken",
    "stat:damageTaken",
    "stat:cooldown",
    "stat:executeBand",
    "stat:slowResist",
    "stat:lifestealMult",
    "stat:lifestealDot",
    "stat:critChance",
    "stat:healBarrier",
    "stat:armor",
    "stat:shield",
    "stat:ad",
    "stat:ap",
    "mult:asPost",
    "mult:hit",
    "mult:dot",
    "mult:returned",
    "mult:ap",
    "mult:wishCooldown",
    "mult:hpRace",
    "mult:linger",
    "flag:lockSecondSlot",
    "flag:noCrit",
    "flag:dotCrit",
    "flag:plagueDotCritConversion",
    "flag:gambler",
    "flag:thirdCharm",
    "flag:eyeForAnEye",
    "flag:twiceUnarmed",
    "flag:blockHits",
    "flag:plantFeet",
    "flag:festering",
    "flag:heavierSentence",
    "flag:swiftJudgment",
    "flag:gallowsPatience",
    "flag:noCommutation",
    "flag:finalVerdict",
    "convert-source:ad",
    "convert-source:maxHp",
    "convert-source:bonusAttackSpeed",
    "convert-source:bonusMoveSpeed",
    "convert-target:attackSpeed",
    "convert-target:moveSpeed",
    "convert-target:damage",
    "convert-target:windup",
    "convert-target:lifesteal",
    "convert-target:markRate",
    "convert-target:healTaken",
    "convert-target:damageTaken",
    "convert-target:cooldown",
    "convert-target:executeBand",
    "convert-target:slowResist",
    "convert-target:lifestealMult",
    "convert-target:lifestealDot",
    "convert-target:critChance",
    "convert-target:healBarrier",
    "convert-target:armor",
    "convert-target:shield",
    "convert-target:ad",
    "convert-target:ap",
    "while:chasingLock:true",
    "while:chasingLock:false",
    "while:hpBelow:true",
    "while:hpBelow:false",
    "while:afterCast:true",
    "while:afterCast:false",
    "while:notShooting:true",
    "while:notShooting:false",
    "while:unarmed:true",
    "while:unarmed:false",
    "while:fightTime:true",
    "while:fightTime:false",
    "requirements:absent",
    "requirements:empty",
    "requirements:missing",
    "requirements:none",
    "requirements:partly",
    "requirements:all",
    "row-order",
    "conversion:one-pass",
    "cap:before-asPost",
    "cap:defense",
    "cap:move",
    "cap:conversion-row",
    "cap:conversion-aggregate",
    "cap:asPost",
    "cap:hit",
    "cap:wishCooldown",
    "cap:hpRace",
    "cap:linger",
    "cap:maxHp",
    "farm",
    "boost",
    "source",
    "farm:outside-cap",
    "boost:pre-sheet",
    "farm-boost-source",
    "farm:efficiency",
    "flags:first-insertion",
    "convert:no-op-product",
    "statFold:ignored-fold-rows",
    "farm:ignored-fold-rows",
    "ignored:validated",
    "codec:ties",
    "codec:overflow",
    "codec:missing",
    "codec:nonfinite",
    "special:signed-zero",
    "special:js-min-max",
    "mirrors:special",
    "kind:fold",
    "kind:statFold",
    "kind:requirements",
    "kind:boostBonus",
    "kind:boostGain",
    "kind:multCodec",
    "kind:flatCodec",
    "kind:mirrors",
    "card:ad1:default",
    "card:ad2:default",
    "card:ad3:default",
    "card:ap1:default",
    "card:ap2:default",
    "card:ap3:default",
    "card:haste1:default",
    "card:haste2:default",
    "card:haste3:default",
    "card:vitality1:default",
    "card:vitality2:default",
    "card:vitality3:default",
    "card:armor1:default",
    "card:armor2:default",
    "card:armor3:default",
    "card:mr1:default",
    "card:mr2:default",
    "card:mr3:default",
    "card:leech1:default",
    "card:leech2:default",
    "card:leech3:default",
    "card:fleet1:default",
    "card:fleet2:default",
    "card:fleet3:default",
    "card:bloodthirst:default",
    "card:secondSkin:default",
    "card:juggernaut:default",
    "card:spellsword:default",
    "card:bigBrain:default",
    "card:arcaneTempo:default",
    "card:momentum:default",
    "card:stoneSkin:default",
    "card:hearty:default",
    "card:festeringArcana:default",
    "card:rhythm:default",
    "card:heavierSentence:default",
    "card:swiftJudgment:default",
    "card:hereComesTheBoom:default",
    "card:machineGun:default",
    "card:glassCannon:default",
    "card:thickSkull:default",
    "card:vampiricPact:default",
    "card:arcaneOverload:default",
    "card:committed:default",
    "card:slowBurn:default",
    "card:fistsOfFury:default",
    "card:overkill:default",
    "card:tankEngine:default",
    "card:pocketSand:default",
    "card:gambler:default",
    "card:slowStarter:default",
    "card:coupDeGrace:default",
    "card:bigGameHunter:default",
    "card:packLeader:default",
    "card:adrenaline:default",
    "card:raceToZero:default",
    "card:cruelWounds:default",
    "card:cruelWounds:plague",
    "card:thirdTimesTheCharm:default",
    "card:eyeForAnEye:default",
    "card:bestOffense:default",
    "card:sittingDucks:default",
    "card:tunnelVision:default",
    "card:firstImpressions:default",
    "card:plantYourFeet:default",
    "card:wishfulThinking:default",
    "card:hemorrhage:default",
    "card:ironWill:default",
    "card:spikedShell:default",
    "card:gatheringStorm:default",
    "card:wellspring:default",
    "card:siphon:default",
    "card:quickdraw:default",
    "card:bountyHunter:default",
    "card:secondWind:default",
    "card:witness:default",
    "card:pestilence:default",
    "card:pestilence:plague",
    "card:lastRites:default",
    "card:gallowsPatience:default",
    "card:noCommutation:default",
    "card:finalVerdict:default",
];

// Validate duplicates before any nested input/expected object is converted to Value.
// serde_json::Value otherwise silently keeps the last duplicate key.
struct UniqueJson(Value);
impl<'de> Deserialize<'de> for UniqueJson {
    fn deserialize<D: Deserializer<'de>>(deserializer: D) -> Result<Self, D::Error> {
        struct Visitor;
        impl<'de> serde::de::Visitor<'de> for Visitor {
            type Value = UniqueJson;
            fn expecting(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
                f.write_str("JSON with unique object keys at every depth")
            }
            fn visit_bool<E: serde::de::Error>(self, v: bool) -> Result<Self::Value, E> {
                Ok(UniqueJson(Value::Bool(v)))
            }
            fn visit_i64<E: serde::de::Error>(self, v: i64) -> Result<Self::Value, E> {
                Ok(UniqueJson(Value::Number(v.into())))
            }
            fn visit_u64<E: serde::de::Error>(self, v: u64) -> Result<Self::Value, E> {
                Ok(UniqueJson(Value::Number(v.into())))
            }
            fn visit_f64<E: serde::de::Error>(self, v: f64) -> Result<Self::Value, E> {
                serde_json::Number::from_f64(v)
                    .map(|n| UniqueJson(Value::Number(n)))
                    .ok_or_else(|| E::custom("nonfinite JSON number"))
            }
            fn visit_str<E: serde::de::Error>(self, v: &str) -> Result<Self::Value, E> {
                Ok(UniqueJson(Value::String(v.into())))
            }
            fn visit_string<E: serde::de::Error>(self, v: String) -> Result<Self::Value, E> {
                Ok(UniqueJson(Value::String(v)))
            }
            fn visit_unit<E: serde::de::Error>(self) -> Result<Self::Value, E> {
                Ok(UniqueJson(Value::Null))
            }
            fn visit_none<E: serde::de::Error>(self) -> Result<Self::Value, E> {
                self.visit_unit()
            }
            fn visit_seq<A: serde::de::SeqAccess<'de>>(
                self,
                mut a: A,
            ) -> Result<Self::Value, A::Error> {
                let mut values = Vec::new();
                while let Some(UniqueJson(value)) = a.next_element()? {
                    values.push(value);
                }
                Ok(UniqueJson(Value::Array(values)))
            }
            fn visit_map<A: serde::de::MapAccess<'de>>(
                self,
                mut a: A,
            ) -> Result<Self::Value, A::Error> {
                let mut values = Map::new();
                while let Some(key) = a.next_key::<String>()? {
                    if values.contains_key(&key) {
                        return Err(serde::de::Error::custom(format!(
                            "duplicate JSON key {key}"
                        )));
                    }
                    let UniqueJson(value) = a.next_value()?;
                    values.insert(key, value);
                }
                Ok(UniqueJson(Value::Object(values)))
            }
        }
        deserializer.deserialize_any(Visitor)
    }
}

fn parse_corpus_value(value: Value, admission: Admission) -> Result<Corpus, String> {
    let wire: WireCorpus = serde_json::from_value(value).map_err(|error| error.to_string())?;
    validate_wire_corpus(wire, admission)
}

fn parse_corpus_text(text: &str, admission: Admission) -> Result<Corpus, String> {
    let strict: UniqueJson = serde_json::from_str(text).map_err(|error| error.to_string())?;
    parse_corpus_value(strict.0, admission)
}

fn validate_wire_corpus(wire: WireCorpus, admission: Admission) -> Result<Corpus, String> {
    if wire.format != "rh-stat-fold/1" {
        return Err("format: expected rh-stat-fold/1".into());
    }
    validate_provenance(&wire.provenance)?;
    if wire.cases.is_empty() {
        return Err("cases: empty inventory".into());
    }
    if admission == Admission::Canonical {
        if wire.preset != Preset::Canonical {
            return Err("preset: canonical comparator requires canonical".into());
        }
        if wire.cases.len() != CANONICAL_CASES {
            return Err(format!(
                "cases: canonical requires exactly {CANONICAL_CASES}, got {}",
                wire.cases.len()
            ));
        }
        if wire.provenance.mode != CaptureMode::Canonical {
            return Err("provenance.mode: canonical corpus must be canonical".into());
        }
    }

    let mut ids = BTreeSet::new();
    let mut semantics = BTreeSet::new();
    let mut tag_counts: BTreeMap<&str, u64> = BTreeMap::new();
    let mut previous_number = None;
    for (index, case) in wire.cases.iter().enumerate() {
        let expected_prefix = match wire.preset {
            Preset::Canonical => "canonical-",
            Preset::Ci => "ci-",
            Preset::Soak => "soak-",
        };
        nonempty(&case.id, &format!("cases[{index}].id"))?;
        let suffix = case
            .id
            .strip_prefix(expected_prefix)
            .ok_or_else(|| format!("cases[{index}].id: wrong preset inventory identity"))?;
        if suffix.len() != 5 || !suffix.bytes().all(|byte| byte.is_ascii_digit()) {
            return Err(format!("cases[{index}].id: malformed inventory identity"));
        }
        let number = suffix.parse::<usize>().map_err(|error| error.to_string())?;
        if admission == Admission::Canonical && number != index {
            return Err(format!(
                "cases[{index}].id: reordered inventory case {}",
                case.id
            ));
        }
        if previous_number.is_some_and(|previous| number <= previous) {
            return Err(format!("cases[{index}].id: reordered inventory case"));
        }
        previous_number = Some(number);
        validate_strings(&case.tags, &format!("cases[{index}].tags"))?;
        let mut tags = BTreeSet::new();
        for tag in &case.tags {
            if !tags.insert(tag) {
                return Err(format!("cases[{index}].tags: duplicate tag {tag}"));
            }
            *tag_counts.entry(tag).or_default() += 1;
        }
        match &case.origin {
            Origin::Synthetic { label } => {
                nonempty(label, &format!("cases[{index}].origin.label"))?
            }
            Origin::Card { card_id, faction } => {
                nonempty(card_id, &format!("cases[{index}].origin.cardId"))?;
                if let Some(faction) = faction {
                    nonempty(faction, &format!("cases[{index}].origin.faction"))?;
                }
            }
        }
        if !ids.insert(&case.id) {
            return Err(format!("cases: duplicate id {}", case.id));
        }
        if !semantics.insert(semantic_key(case)) {
            return Err(format!("cases: semantic duplicate {}", case.id));
        }
    }

    let mut coverage_ids = BTreeSet::new();
    for (index, entry) in wire.coverage.iter().enumerate() {
        nonempty(&entry.id, &format!("coverage[{index}].id"))?;
        if entry.count > 9_007_199_254_740_991 {
            return Err(format!("coverage[{index}].count: above safe integer"));
        }
        if !coverage_ids.insert(&entry.id) {
            return Err(format!("coverage: duplicate {}", entry.id));
        }
        if Some(entry.count) != tag_counts.get(entry.id.as_str()).copied() {
            return Err(format!("coverage.{}: count does not match cases", entry.id));
        }
    }
    if admission == Admission::Canonical {
        if wire.coverage.len() != CANONICAL_COVERAGE.len() {
            return Err(format!(
                "coverage: canonical requires 207 entries, got {}",
                wire.coverage.len()
            ));
        }
        for (index, expected) in CANONICAL_COVERAGE.iter().enumerate() {
            if wire.coverage[index].id != *expected || wire.coverage[index].count == 0 {
                return Err(format!(
                    "coverage[{index}]: expected nonzero {expected}, got {}",
                    wire.coverage[index].id
                ));
            }
        }
    }

    let mut cases = Vec::with_capacity(wire.cases.len());
    for (index, case) in wire.cases.into_iter().enumerate() {
        let input = parse_input(case.kind, case.input.clone())
            .map_err(|error| format!("cases[{index}].input: {error}"))?;
        validate_input(&input).map_err(|error| format!("cases[{index}]: {error}"))?;
        let expected = parse_output(case.kind, case.expected)
            .map_err(|error| format!("cases[{index}].expected: {error}"))?;
        cases.push(Case {
            id: case.id,
            seed: case.seed,
            origin: case.origin,
            kind: case.kind,
            input_value: case.input,
            input,
            expected,
        });
    }
    Ok(Corpus {
        preset: wire.preset,
        provenance: wire.provenance,
        coverage: wire.coverage,
        cases,
    })
}

fn canonical() -> Corpus {
    parse_corpus_text(
        include_str!("../../../parity/stat-fold/canonical.json"),
        Admission::Canonical,
    )
    .expect("strict canonical corpus admission")
}

fn effect_stat(stat: EffectStatName) -> kernel::EffectStat {
    match stat {
        EffectStatName::MaxHp => kernel::EffectStat::MaxHp,
        EffectStatName::AttackSpeed => kernel::EffectStat::AttackSpeed,
        EffectStatName::MoveSpeed => kernel::EffectStat::MoveSpeed,
        EffectStatName::Damage => kernel::EffectStat::Damage,
        EffectStatName::Windup => kernel::EffectStat::Windup,
        EffectStatName::Lifesteal => kernel::EffectStat::Lifesteal,
        EffectStatName::MarkRate => kernel::EffectStat::MarkRate,
        EffectStatName::HealTaken => kernel::EffectStat::HealTaken,
        EffectStatName::DamageTaken => kernel::EffectStat::DamageTaken,
        EffectStatName::Cooldown => kernel::EffectStat::Cooldown,
        EffectStatName::ExecuteBand => kernel::EffectStat::ExecuteBand,
        EffectStatName::SlowResist => kernel::EffectStat::SlowResist,
        EffectStatName::LifestealMult => kernel::EffectStat::LifestealMult,
        EffectStatName::LifestealDot => kernel::EffectStat::LifestealDot,
        EffectStatName::CritChance => kernel::EffectStat::CritChance,
        EffectStatName::HealBarrier => kernel::EffectStat::HealBarrier,
    }
}

fn flat_stat(stat: FlatStatName) -> kernel::FlatStat {
    match stat {
        FlatStatName::Armor => kernel::FlatStat::Armor,
        FlatStatName::Shield => kernel::FlatStat::Shield,
        FlatStatName::Ad => kernel::FlatStat::Ad,
        FlatStatName::Ap => kernel::FlatStat::Ap,
    }
}

fn stat_key(stat: StatName) -> kernel::StatKey {
    match stat {
        StatName::MaxHp => kernel::StatKey::MaxHp,
        StatName::AttackSpeed => kernel::StatKey::AttackSpeed,
        StatName::MoveSpeed => kernel::StatKey::MoveSpeed,
        StatName::Damage => kernel::StatKey::Damage,
        StatName::Windup => kernel::StatKey::Windup,
        StatName::Lifesteal => kernel::StatKey::Lifesteal,
        StatName::MarkRate => kernel::StatKey::MarkRate,
        StatName::HealTaken => kernel::StatKey::HealTaken,
        StatName::DamageTaken => kernel::StatKey::DamageTaken,
        StatName::Cooldown => kernel::StatKey::Cooldown,
        StatName::ExecuteBand => kernel::StatKey::ExecuteBand,
        StatName::SlowResist => kernel::StatKey::SlowResist,
        StatName::LifestealMult => kernel::StatKey::LifestealMult,
        StatName::LifestealDot => kernel::StatKey::LifestealDot,
        StatName::CritChance => kernel::StatKey::CritChance,
        StatName::HealBarrier => kernel::StatKey::HealBarrier,
        StatName::Armor => kernel::StatKey::Armor,
        StatName::Shield => kernel::StatKey::Shield,
        StatName::Ad => kernel::StatKey::Ad,
        StatName::Ap => kernel::StatKey::Ap,
    }
}

fn convert_from(from: ConvertFromName) -> kernel::ConvertFrom {
    match from {
        ConvertFromName::Ad => kernel::ConvertFrom::Ad,
        ConvertFromName::MaxHp => kernel::ConvertFrom::MaxHp,
        ConvertFromName::BonusAttackSpeed => kernel::ConvertFrom::BonusAttackSpeed,
        ConvertFromName::BonusMoveSpeed => kernel::ConvertFrom::BonusMoveSpeed,
    }
}

fn convert_to(to: ConvertToName) -> kernel::ConvertTo {
    match to {
        ConvertToName::AttackSpeed => kernel::ConvertTo::AttackSpeed,
        ConvertToName::MoveSpeed => kernel::ConvertTo::MoveSpeed,
        ConvertToName::Damage => kernel::ConvertTo::Damage,
        ConvertToName::Windup => kernel::ConvertTo::Windup,
        ConvertToName::Lifesteal => kernel::ConvertTo::Lifesteal,
        ConvertToName::MarkRate => kernel::ConvertTo::MarkRate,
        ConvertToName::HealTaken => kernel::ConvertTo::HealTaken,
        ConvertToName::DamageTaken => kernel::ConvertTo::DamageTaken,
        ConvertToName::Cooldown => kernel::ConvertTo::Cooldown,
        ConvertToName::ExecuteBand => kernel::ConvertTo::ExecuteBand,
        ConvertToName::SlowResist => kernel::ConvertTo::SlowResist,
        ConvertToName::LifestealMult => kernel::ConvertTo::LifestealMult,
        ConvertToName::LifestealDot => kernel::ConvertTo::LifestealDot,
        ConvertToName::CritChance => kernel::ConvertTo::CritChance,
        ConvertToName::HealBarrier => kernel::ConvertTo::HealBarrier,
        ConvertToName::Armor => kernel::ConvertTo::Armor,
        ConvertToName::Shield => kernel::ConvertTo::Shield,
        ConvertToName::Ad => kernel::ConvertTo::Ad,
        ConvertToName::Ap => kernel::ConvertTo::Ap,
    }
}

fn mult_key(key: MultName) -> kernel::MultKey {
    match key {
        MultName::AsPost => kernel::MultKey::AsPost,
        MultName::Hit => kernel::MultKey::Hit,
        MultName::Dot => kernel::MultKey::Dot,
        MultName::Returned => kernel::MultKey::Returned,
        MultName::Ap => kernel::MultKey::Ap,
        MultName::WishCooldown => kernel::MultKey::WishCooldown,
        MultName::HpRace => kernel::MultKey::HpRace,
        MultName::Linger => kernel::MultKey::Linger,
    }
}

fn effect_flag(flag: FlagName) -> kernel::EffectFlag {
    match flag {
        FlagName::LockSecondSlot => kernel::EffectFlag::LockSecondSlot,
        FlagName::NoCrit => kernel::EffectFlag::NoCrit,
        FlagName::DotCrit => kernel::EffectFlag::DotCrit,
        FlagName::PlagueDotCritConversion => kernel::EffectFlag::PlagueDotCritConversion,
        FlagName::Gambler => kernel::EffectFlag::Gambler,
        FlagName::ThirdCharm => kernel::EffectFlag::ThirdCharm,
        FlagName::EyeForAnEye => kernel::EffectFlag::EyeForAnEye,
        FlagName::TwiceUnarmed => kernel::EffectFlag::TwiceUnarmed,
        FlagName::BlockHits => kernel::EffectFlag::BlockHits,
        FlagName::PlantFeet => kernel::EffectFlag::PlantFeet,
        FlagName::Festering => kernel::EffectFlag::Festering,
        FlagName::HeavierSentence => kernel::EffectFlag::HeavierSentence,
        FlagName::SwiftJudgment => kernel::EffectFlag::SwiftJudgment,
        FlagName::GallowsPatience => kernel::EffectFlag::GallowsPatience,
        FlagName::NoCommutation => kernel::EffectFlag::NoCommutation,
        FlagName::FinalVerdict => kernel::EffectFlag::FinalVerdict,
    }
}

fn boost_stat(stat: BoostStatName) -> kernel::ChestBoostStat {
    match stat {
        BoostStatName::Ad => kernel::ChestBoostStat::Ad,
        BoostStatName::Ap => kernel::ChestBoostStat::Ap,
        BoostStatName::Armor => kernel::ChestBoostStat::Armor,
        BoostStatName::Shield => kernel::ChestBoostStat::Shield,
        BoostStatName::MaxHp => kernel::ChestBoostStat::MaxHp,
        BoostStatName::AttackSpeed => kernel::ChestBoostStat::AttackSpeed,
        BoostStatName::MoveSpeed => kernel::ChestBoostStat::MoveSpeed,
        BoostStatName::Lifesteal => kernel::ChestBoostStat::Lifesteal,
    }
}

fn while_cond(cond: WhileCondName) -> kernel::WhileCond {
    match cond {
        WhileCondName::ChasingLock => kernel::WhileCond::ChasingLock,
        WhileCondName::HpBelow => kernel::WhileCond::HpBelow,
        WhileCondName::AfterCast => kernel::WhileCond::AfterCast,
        WhileCondName::NotShooting => kernel::WhileCond::NotShooting,
        WhileCondName::Unarmed => kernel::WhileCond::Unarmed,
        WhileCondName::FightTime => kernel::WhileCond::FightTime,
    }
}

fn row_kind(row: &Row) -> kernel::EffectKind {
    match row {
        Row::Stat { stat, v, .. } => kernel::EffectKind::Stat {
            stat: effect_stat(*stat),
            v: v.value(),
        },
        Row::Flat { stat, v, .. } => kernel::EffectKind::Flat {
            stat: flat_stat(*stat),
            v: v.value(),
        },
        Row::Vs { .. } => kernel::EffectKind::Vs,
        Row::Scale { .. } => kernel::EffectKind::Scale,
        Row::While {
            cond,
            arg,
            stat,
            v,
            ms,
            ..
        } => kernel::EffectKind::While(kernel::WhileRow {
            cond: while_cond(*cond),
            arg: arg.value(),
            stat: stat_key(*stat),
            v: v.value(),
            ms: ms.map(F64::value),
        }),
        Row::OnHit { .. } => kernel::EffectKind::OnHit,
        Row::Trigger { .. } => kernel::EffectKind::Trigger,
        Row::Convert {
            from, to, per, cap, ..
        } => kernel::EffectKind::Convert {
            from: convert_from(*from),
            to: convert_to(*to),
            per: per.value(),
            cap: cap.map(F64::value),
        },
        Row::Mult { key, v, .. } => kernel::EffectKind::Mult {
            key: mult_key(*key),
            v: v.value(),
        },
        Row::Flag { flag, .. } => kernel::EffectKind::Flag {
            flag: effect_flag(*flag),
        },
    }
}

fn row_requirements(rows: &[Row]) -> Vec<Vec<&str>> {
    rows.iter()
        .map(|row| {
            row.requirements()
                .unwrap_or(&[])
                .iter()
                .map(String::as_str)
                .collect()
        })
        .collect()
}

fn project_rows<'a>(rows: &'a [Row], requires: &'a [Vec<&'a str>]) -> Vec<kernel::EffectRow<'a>> {
    rows.iter()
        .zip(requires)
        .map(|(row, requires)| kernel::EffectRow {
            kind: row_kind(row),
            requires,
            needs_status: row.needs_status(),
        })
        .collect()
}

fn ownership(owned: &Option<Vec<String>>) -> impl Fn(&str) -> bool + '_ {
    move |id| {
        owned
            .as_ref()
            .is_some_and(|owned| owned.iter().any(|owned| owned == id))
    }
}

fn execute_fold(input: &FoldInput) -> FoldOutput {
    let main_requires = row_requirements(&input.rows);
    let farm_requires = row_requirements(&input.farm_rows);
    let rows = project_rows(&input.rows, &main_requires);
    let farm_rows = project_rows(&input.farm_rows, &farm_requires);
    let owns = ownership(&input.owned);
    let holds = |location: kernel::RowLocation, _row: &kernel::WhileRow| {
        let answers = match location.list {
            kernel::RowList::Effects => &input.holds,
            kernel::RowList::Farm => &input.farm_holds,
        };
        answers[location.index].unwrap_or(false)
    };
    let boosts = input.boosts.map(|boosts| {
        kernel::BoostCounts::from_source_values(boosts.map(|picks| picks.map_or(0.0, F64::value)))
    });
    let context = kernel::FoldContext {
        owns: if input.owned.is_some() {
            Some(&owns)
        } else {
            None
        },
        holds: Some(&holds),
        base_max_hp: input.base_max_hp.map_or(0.0, F64::value),
        farm_rows: &farm_rows,
        boosts: boosts.as_ref(),
    };
    let folded = kernel::fold_rows(&rows, &context);
    let mirrors_from_sums = kernel::mirrors_from_sums(&folded.sums);
    let source = kernel::SourceMods {
        as_mult: input.source.as_mult.value(),
        speed_mult: input.source.speed_mult.value(),
        windup_mult: input.source.windup_mult.value(),
        armor: input.source.armor.value(),
        shield: input.source.shield.value(),
    };
    let mirrors_from_fold =
        kernel::mirrors_from_fold_with_sources(&folded, &source, input.farm_as_efficiency.value());
    let encoded = kernel::encode_mirrors(&mirrors_from_fold);
    let decoded = kernel::decode_mirrors(&encoded);
    FoldOutput {
        plain: folded.plain.source_values().map(F64::from),
        sums: folded.sums.source_values().map(F64::from),
        farm_sums: folded.farm_sums.source_values().map(F64::from),
        mults: folded.mults.source_values().map(F64::from),
        flags: folded
            .flags
            .iter()
            .map(|flag| {
                kernel::EffectFlag::source_order()
                    .into_iter()
                    .position(|candidate| candidate == flag)
                    .map(|index| {
                        [
                            FlagName::LockSecondSlot,
                            FlagName::NoCrit,
                            FlagName::DotCrit,
                            FlagName::PlagueDotCritConversion,
                            FlagName::Gambler,
                            FlagName::ThirdCharm,
                            FlagName::EyeForAnEye,
                            FlagName::TwiceUnarmed,
                            FlagName::BlockHits,
                            FlagName::PlantFeet,
                            FlagName::Festering,
                            FlagName::HeavierSentence,
                            FlagName::SwiftJudgment,
                            FlagName::GallowsPatience,
                            FlagName::NoCommutation,
                            FlagName::FinalVerdict,
                        ][index]
                    })
                    .expect("known flag")
            })
            .collect(),
        max_hp: F64::from(folded.max_hp),
        mirrors_from_sums: mirrors_from_sums.source_values().map(F64::from),
        mirrors_from_fold: mirrors_from_fold.source_values().map(F64::from),
        encoded: encoded.source_values().map(F64::from),
        decoded: decoded.source_values().map(F64::from),
    }
}

fn execute(case: &Case) -> Output {
    match &case.input {
        Input::Fold(input) => Output::Fold(execute_fold(input)),
        Input::StatFold(input) => {
            let requires = row_requirements(&input.rows);
            let rows = project_rows(&input.rows, &requires);
            let owns = ownership(&input.owned);
            let holds = |location: kernel::RowLocation, _row: &kernel::WhileRow| {
                input.holds[location.index].unwrap_or(false)
            };
            let context = kernel::FoldContext {
                owns: if input.owned.is_some() {
                    Some(&owns)
                } else {
                    None
                },
                holds: Some(&holds),
                ..Default::default()
            };
            Output::StatFold(StatFoldOutput {
                sums: kernel::fold_stat_rows(&rows, &context)
                    .source_values()
                    .map(F64::from),
            })
        }
        Input::Requirements(input) => {
            let requires = row_requirements(std::slice::from_ref(&input.row));
            let row = project_rows(std::slice::from_ref(&input.row), &requires);
            let owns = ownership(&input.owned);
            Output::Requirements(RequirementsOutput {
                met: kernel::requirements_met(
                    &row[0],
                    if input.owned.is_some() {
                        Some(&owns)
                    } else {
                        None
                    },
                ),
            })
        }
        Input::BoostBonus(input) => Output::BoostBonus(BoostBonusOutput {
            bonus: F64::from(kernel::chest_boost_bonus(input.picks.value())),
        }),
        Input::BoostGain(input) => Output::BoostGain(BoostGainOutput {
            gain: F64::from(kernel::chest_boost_gain(
                boost_stat(input.stat),
                input.picks.value(),
                input.current.value(),
            )),
        }),
        Input::MultCodec(input) => Output::Codec(CodecOutput {
            encoded: F64::from(kernel::encode_mult(
                input.value.map_or(f64::NAN, F64::value),
            )),
            decoded: F64::from(kernel::decode_mult(input.wire.map(F64::value))),
        }),
        Input::FlatCodec(input) => Output::Codec(CodecOutput {
            encoded: F64::from(kernel::encode_flat(
                input.value.map_or(f64::NAN, F64::value),
            )),
            decoded: F64::from(kernel::decode_flat(input.wire.map(F64::value))),
        }),
        Input::Mirrors(input) => {
            let mirrors = kernel::StatMirrors::from_source_values(
                input.values.map(|value| value.map_or(f64::NAN, F64::value)),
            );
            let wire = kernel::WireMirrors::from_source_values(
                input.wire.map(|value| value.map_or(f64::NAN, F64::value)),
            );
            Output::Mirrors(MirrorsOutput {
                encoded: kernel::encode_mirrors(&mirrors)
                    .source_values()
                    .map(F64::from),
                decoded: kernel::decode_mirrors(&wire).source_values().map(F64::from),
            })
        }
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum ComparisonPolicy {
    Exact,
    DiagnosticContinuous,
}

#[derive(Clone, Debug)]
struct Evidence {
    bit_string: String,
    classification: String,
}

impl Evidence {
    fn float(value: F64) -> Self {
        Self {
            bit_string: value.bits(),
            classification: value.classification().into(),
        }
    }

    fn discrete(value: String, classification: &str) -> Self {
        Self {
            bit_string: value,
            classification: classification.into(),
        }
    }
}

#[derive(Clone, Debug)]
struct Mismatch {
    field: String,
    expected: Evidence,
    actual: Evidence,
}

fn compare_float(
    expected: F64,
    actual: F64,
    field: &str,
    policy: ComparisonPolicy,
) -> Result<(), Mismatch> {
    if expected == actual {
        return Ok(());
    }
    let expected_value = expected.value();
    let actual_value = actual.value();
    if expected_value.is_nan() && actual_value.is_nan() {
        return Ok(());
    }
    if policy == ComparisonPolicy::DiagnosticContinuous
        && expected_value.is_finite()
        && actual_value.is_finite()
        && !(expected_value == 0.0 && actual_value == 0.0)
        && (expected_value - actual_value).abs() <= CONTINUOUS_TOLERANCE
    {
        return Ok(());
    }
    Err(Mismatch {
        field: field.into(),
        expected: Evidence::float(expected),
        actual: Evidence::float(actual),
    })
}

fn compare_floats<const N: usize>(
    expected: &[F64; N],
    actual: &[F64; N],
    field: &str,
    policy: ComparisonPolicy,
) -> Result<(), Mismatch> {
    for (index, (expected, actual)) in expected.iter().zip(actual).enumerate() {
        compare_float(*expected, *actual, &format!("{field}[{index}]"), policy)?;
    }
    Ok(())
}

fn compare_discrete<T: std::fmt::Debug + PartialEq>(
    expected: &T,
    actual: &T,
    field: &str,
    classification: &str,
) -> Result<(), Mismatch> {
    if expected == actual {
        Ok(())
    } else {
        Err(Mismatch {
            field: field.into(),
            expected: Evidence::discrete(format!("{expected:?}"), classification),
            actual: Evidence::discrete(format!("{actual:?}"), classification),
        })
    }
}

fn compare_fold(
    expected: &FoldOutput,
    actual: &FoldOutput,
    policy: ComparisonPolicy,
) -> Result<(), Mismatch> {
    compare_floats(&expected.plain, &actual.plain, "plain", policy)?;
    compare_floats(
        &expected.sums,
        &actual.sums,
        "sums",
        ComparisonPolicy::Exact,
    )?;
    compare_floats(
        &expected.farm_sums,
        &actual.farm_sums,
        "farmSums",
        ComparisonPolicy::Exact,
    )?;
    compare_floats(
        &expected.mults,
        &actual.mults,
        "mults",
        ComparisonPolicy::Exact,
    )?;
    compare_discrete(
        &expected.flags,
        &actual.flags,
        "flags",
        "flag identities/order",
    )?;
    compare_float(
        expected.max_hp,
        actual.max_hp,
        "maxHp",
        ComparisonPolicy::Exact,
    )?;
    compare_floats(
        &expected.mirrors_from_sums,
        &actual.mirrors_from_sums,
        "mirrorsFromSums",
        policy,
    )?;
    compare_floats(
        &expected.mirrors_from_fold,
        &actual.mirrors_from_fold,
        "mirrorsFromFold",
        ComparisonPolicy::Exact,
    )?;
    compare_floats(
        &expected.encoded,
        &actual.encoded,
        "encoded",
        ComparisonPolicy::Exact,
    )?;
    compare_floats(
        &expected.decoded,
        &actual.decoded,
        "decoded",
        ComparisonPolicy::Exact,
    )
}

fn compare_output(
    expected: &Output,
    actual: &Output,
    policy: ComparisonPolicy,
) -> Result<(), Mismatch> {
    match (expected, actual) {
        (Output::Fold(expected), Output::Fold(actual)) => compare_fold(expected, actual, policy),
        (Output::StatFold(expected), Output::StatFold(actual)) => {
            compare_floats(&expected.sums, &actual.sums, "sums", policy)
        }
        (Output::Requirements(expected), Output::Requirements(actual)) => {
            compare_discrete(&expected.met, &actual.met, "met", "requirement decision")
        }
        (Output::BoostBonus(expected), Output::BoostBonus(actual)) => compare_float(
            expected.bonus,
            actual.bonus,
            "bonus",
            ComparisonPolicy::Exact,
        ),
        (Output::BoostGain(expected), Output::BoostGain(actual)) => {
            compare_float(expected.gain, actual.gain, "gain", ComparisonPolicy::Exact)
        }
        (Output::Codec(expected), Output::Codec(actual)) => {
            compare_float(
                expected.encoded,
                actual.encoded,
                "encoded",
                ComparisonPolicy::Exact,
            )?;
            compare_float(
                expected.decoded,
                actual.decoded,
                "decoded",
                ComparisonPolicy::Exact,
            )
        }
        (Output::Mirrors(expected), Output::Mirrors(actual)) => {
            compare_floats(
                &expected.encoded,
                &actual.encoded,
                "encoded",
                ComparisonPolicy::Exact,
            )?;
            compare_floats(
                &expected.decoded,
                &actual.decoded,
                "decoded",
                ComparisonPolicy::Exact,
            )
        }
        _ => Err(Mismatch {
            field: "kind".into(),
            expected: Evidence::discrete(format!("{expected:?}"), "output variant"),
            actual: Evidence::discrete(format!("{actual:?}"), "output variant"),
        }),
    }
}

fn function_name(kind: CaseKind) -> &'static str {
    match kind {
        CaseKind::Fold => "foldRows/mirrorsFromFold/encodeMirrors/decodeMirrors",
        CaseKind::StatFold => "foldStatRows",
        CaseKind::Requirements => "requirementsMet",
        CaseKind::BoostBonus => "chestBoostBonus",
        CaseKind::BoostGain => "chestBoostGain",
        CaseKind::MultCodec => "encodeMult/decodeMult",
        CaseKind::FlatCodec => "encodeFlat/decodeFlat",
        CaseKind::Mirrors => "encodeMirrors/decodeMirrors",
    }
}

fn preset_name(preset: Preset) -> &'static str {
    match preset {
        Preset::Canonical => "canonical",
        Preset::Ci => "ci",
        Preset::Soak => "soak",
    }
}

#[derive(Debug)]
struct ExternalError {
    preset: Option<Preset>,
    case_index: Option<usize>,
    case_id: Option<String>,
    seed: Option<u32>,
    function: Option<String>,
    field: Option<String>,
    input: Option<Value>,
    expected: Option<Evidence>,
    actual: Option<Evidence>,
    message: String,
}

impl ExternalError {
    fn admission(message: String) -> Self {
        Self {
            preset: None,
            case_index: None,
            case_id: None,
            seed: None,
            function: None,
            field: None,
            input: None,
            expected: None,
            actual: None,
            message,
        }
    }

    fn mismatch(corpus: &Corpus, index: usize, mismatch: Mismatch) -> Self {
        let case = &corpus.cases[index];
        Self {
            preset: Some(corpus.preset),
            case_index: Some(index),
            case_id: Some(case.id.clone()),
            seed: Some(case.seed),
            function: Some(function_name(case.kind).into()),
            field: Some(mismatch.field),
            input: Some(case.input_value.clone()),
            expected: Some(mismatch.expected),
            actual: Some(mismatch.actual),
            message: "actual TypeScript and Rust outputs differ".into(),
        }
    }

    fn evidence(&self) -> Value {
        let evidence = |evidence: &Option<Evidence>| {
            evidence.as_ref().map_or(Value::Null, |evidence| {
                json!({
                    "bitString": evidence.bit_string,
                    "classification": evidence.classification,
                })
            })
        };
        let replay = self.case_id.as_ref().map(|id| {
            format!(
                "node --import tsx tools/stat-fold/run.ts case --preset {} --id {}",
                self.preset.map_or("ci", |preset| preset_name(preset)),
                id
            )
        });
        json!({
            "format": "rh-stat-fold-failure/1",
            "preset": self.preset.map(preset_name),
            "caseIndex": self.case_index,
            "id": self.case_id,
            "seed": self.seed,
            "function": self.function,
            "field": self.field,
            "input": self.input,
            "expected": evidence(&self.expected),
            "actual": evidence(&self.actual),
            "replay": replay,
            "message": self.message,
        })
    }
}

fn file_replay(path: &str) -> Value {
    json!({
        "env": { "RH_STAT_FOLD_BATCH": path },
        "argv": ["cargo", "test", "--locked", "-p", "rh-sim", "--test", "stat_fold",
            "external_batch", "--", "--exact", "--nocapture"],
    })
}

#[test]
fn custom_external_replay_preserves_input_path_without_shell_interpolation() {
    let path = "custom inputs/'quoted' $shell `text` \"double\".json";
    let replay = file_replay(path);
    assert_eq!(replay["env"]["RH_STAT_FOLD_BATCH"], path);
    assert_eq!(
        replay["argv"],
        json!([
            "cargo",
            "test",
            "--locked",
            "-p",
            "rh-sim",
            "--test",
            "stat_fold",
            "external_batch",
            "--",
            "--exact",
            "--nocapture"
        ])
    );
}

#[allow(clippy::result_large_err)]
fn run_external(path: &str) -> Result<usize, ExternalError> {
    let text = fs::read_to_string(path)
        .map_err(|error| ExternalError::admission(format!("read {path}: {error}")))?;
    let corpus = parse_corpus_text(&text, Admission::External).map_err(ExternalError::admission)?;
    let policy = match corpus.provenance.mode {
        CaptureMode::Canonical => ComparisonPolicy::Exact,
        CaptureMode::Diagnostic => ComparisonPolicy::DiagnosticContinuous,
    };
    for (index, case) in corpus.cases.iter().enumerate() {
        let actual = execute(case);
        if let Err(mismatch) = compare_output(&case.expected, &actual, policy) {
            return Err(ExternalError::mismatch(&corpus, index, mismatch));
        }
    }
    Ok(corpus.cases.len())
}

#[test]
fn external_batch() {
    let Ok(path) = env::var("RH_STAT_FOLD_BATCH") else {
        return;
    };
    match run_external(&path) {
        Ok(count) => println!("stat-fold external verified {count} cases"),
        Err(error) => {
            let mut evidence = error.evidence();
            evidence["replay"] = file_replay(&path);
            if let Ok(path) = env::var("RH_STAT_FOLD_FAILURE") {
                let bytes = serde_json::to_vec_pretty(&evidence).expect("failure JSON");
                fs::write(&path, bytes).expect("write stat-fold failure evidence");
            }
            panic!("{}", evidence);
        }
    }
}

fn canonical_replay_command(case_id: &str) -> String {
    let suffix = case_id
        .strip_prefix("canonical-")
        .expect("canonical inventory ID");
    format!("node --import tsx tools/stat-fold/run.ts case --preset ci --id ci-{suffix}")
}

fn canonical_mismatch_diagnostic(index: usize, case: &Case, error: &Mismatch) -> String {
    format!(
        "canonical case {index} {} seed {} {} {}: input {}; expected {:?}, actual {:?}; replay: {}",
        case.id,
        case.seed,
        function_name(case.kind),
        error.field,
        case.input_value,
        error.expected,
        error.actual,
        canonical_replay_command(&case.id),
    )
}

#[test]
fn canonical_corpus_executes_every_complete_output() {
    let corpus = canonical();
    assert_eq!(corpus.cases.len(), CANONICAL_CASES);
    assert_eq!(corpus.coverage.len(), CANONICAL_COVERAGE.len());
    for (index, case) in corpus.cases.iter().enumerate() {
        let actual = execute(case);
        compare_output(&case.expected, &actual, ComparisonPolicy::Exact).unwrap_or_else(|error| {
            panic!("{}", canonical_mismatch_diagnostic(index, case, &error))
        });
    }
    println!(
        "stat-fold canonical verified {} cases and {} coverage entries",
        corpus.cases.len(),
        corpus.coverage.len()
    );
}

#[test]
fn canonical_mismatch_diagnostic_contains_full_input_and_ci_replay() {
    let corpus = canonical();
    let case = &corpus.cases[0];
    let mut actual = execute(case);
    let Output::Fold(folded) = &mut actual else {
        unreachable!()
    };
    folded.sums[0] = F64::from(folded.sums[0].value() + 1.0);
    let mismatch = compare_output(&case.expected, &actual, ComparisonPolicy::Exact)
        .expect_err("diagnostic control mismatch");
    let diagnostic = canonical_mismatch_diagnostic(0, case, &mismatch);
    assert!(diagnostic.contains(&format!("input {}", case.input_value)));
    assert!(diagnostic
        .contains("node --import tsx tools/stat-fold/run.ts case --preset ci --id ci-00000"));
    assert!(!diagnostic.contains("--preset canonical"));
    assert_eq!(
        canonical_replay_command("canonical-00337"),
        "node --import tsx tools/stat-fold/run.ts case --preset ci --id ci-00337"
    );
}

#[test]
fn canonical_nan_classification_matches_js_min_max_payload_difference() {
    let corpus = canonical();
    let case = find_case(&corpus, "NaN propagation through source Math.min and max");
    assert_eq!(case.id, "canonical-00337");
    let actual = execute(case);
    let Output::Fold(expected) = &case.expected else {
        unreachable!()
    };
    let Output::Fold(actual_fold) = &actual else {
        unreachable!()
    };
    assert_eq!(expected.mirrors_from_fold[3].bits(), "fff8000000000000");
    assert_eq!(actual_fold.mirrors_from_fold[3].bits(), "7ff8000000000000");
    compare_output(&case.expected, &actual, ComparisonPolicy::Exact)
        .expect("NaN payloads with the same classification must compare equal");
}

#[test]
fn nan_classification_never_relaxes_other_float_classes() {
    for (expected, actual) in [
        (f64::NAN, 0.0),
        (0.0, f64::NAN),
        (f64::NAN, f64::INFINITY),
        (f64::INFINITY, f64::NAN),
        (f64::NAN, f64::NEG_INFINITY),
        (f64::NEG_INFINITY, f64::NAN),
    ] {
        compare_float(
            F64::from(expected),
            F64::from(actual),
            "nan-class-control",
            ComparisonPolicy::Exact,
        )
        .expect_err("NaN must not match finite or infinite values");
    }
    for policy in [
        ComparisonPolicy::Exact,
        ComparisonPolicy::DiagnosticContinuous,
    ] {
        for (expected, actual) in [(0.0, -0.0), (-0.0, 0.0)] {
            compare_float(
                F64::from(expected),
                F64::from(actual),
                "signed-zero-control",
                policy,
            )
            .expect_err("signed zero remains bit-exact before diagnostic tolerance");
        }
    }
    compare_float(
        F64::from(f64::INFINITY),
        F64::from(f64::NEG_INFINITY),
        "infinity-sign-control",
        ComparisonPolicy::Exact,
    )
    .expect_err("infinity signs remain bit-exact");
}

fn canonical_value() -> Value {
    serde_json::from_str(include_str!("../../../parity/stat-fold/canonical.json"))
        .expect("canonical JSON value")
}

fn reject_fixture(label: &str, value: Value) {
    let error = parse_corpus_value(value, Admission::Canonical).expect_err(label);
    assert!(!error.is_empty(), "{label}: empty admission diagnostic");
}

#[test]
fn fixture_integrity_rejects_inventory_and_type_mutations() {
    let mut value = canonical_value();
    value["cases"] = json!([]);
    reject_fixture("empty cases", value);

    let mut value = canonical_value();
    let duplicate = value["cases"][0].clone();
    value["cases"][1] = duplicate;
    reject_fixture("duplicate case", value);

    let mut value = canonical_value();
    value["cases"].as_array_mut().unwrap().remove(7);
    reject_fixture("missing case", value);

    let mut value = canonical_value();
    value["cases"].as_array_mut().unwrap().swap(7, 8);
    reject_fixture("reordered cases", value);

    let mut value = canonical_value();
    let extra = value["cases"][0].clone();
    value["cases"].as_array_mut().unwrap().push(extra);
    reject_fixture("extra case", value);

    let mut value = canonical_value();
    value["cases"][0]["seed"] = json!("not a uint32");
    reject_fixture("bad seed type", value);

    let mut value = canonical_value();
    value["cases"][0]["unknown"] = json!(true);
    reject_fixture("unknown case key", value);

    let mut value = canonical_value();
    value["cases"][0]["kind"] = json!("unknownKind");
    reject_fixture("unknown case variant", value);

    let mut value = canonical_value();
    value.as_object_mut().unwrap().remove("cases");
    reject_fixture("missing cases key", value);

    let mut value = canonical_value();
    value.as_object_mut().unwrap().remove("coverage");
    reject_fixture("missing coverage key", value);

    let mut value = canonical_value();
    value["cases"][0]
        .as_object_mut()
        .unwrap()
        .remove("expected");
    reject_fixture("missing expected output", value);
}

#[test]
fn required_nullable_fields_reject_omission() {
    for key in ["owned", "baseMaxHp", "boosts"] {
        let mut value = canonical_value();
        value["cases"][0]["input"]
            .as_object_mut()
            .unwrap()
            .remove(key);
        reject_fixture(&format!("missing fold input {key}"), value);
    }

    let kind_index = |value: &Value, kind: &str| {
        value["cases"]
            .as_array()
            .unwrap()
            .iter()
            .position(|case| case["kind"] == kind)
            .unwrap()
    };
    for kind in ["statFold", "requirements"] {
        let mut value = canonical_value();
        let index = kind_index(&value, kind);
        value["cases"][index]["input"]
            .as_object_mut()
            .unwrap()
            .remove("owned");
        reject_fixture(&format!("missing {kind} owned"), value);
    }

    for key in ["value", "wire"] {
        let mut value = canonical_value();
        let index = kind_index(&value, "multCodec");
        value["cases"][index]["input"]
            .as_object_mut()
            .unwrap()
            .remove(key);
        reject_fixture(&format!("missing codec input {key}"), value);
    }

    let mut value = canonical_value();
    value["cases"][0]["origin"]
        .as_object_mut()
        .unwrap()
        .remove("faction");
    reject_fixture("missing card-origin faction", value);
}

#[test]
fn fixture_integrity_rejects_coverage_and_ignored_payload_mutations() {
    let mut value = canonical_value();
    value["coverage"][0]["count"] = json!(value["coverage"][0]["count"].as_u64().unwrap() + 1);
    reject_fixture("coverage count disagreement", value);

    let mut value = canonical_value();
    value["coverage"].as_array_mut().unwrap().swap(0, 1);
    reject_fixture("reordered coverage", value);

    let mut value = canonical_value();
    let duplicate = value["coverage"][0].clone();
    value["coverage"][1] = duplicate;
    reject_fixture("duplicate coverage", value);

    let mut value = canonical_value();
    let ignored = value["cases"]
        .as_array()
        .unwrap()
        .iter()
        .position(|case| case["origin"]["label"] == "all ignored variants with complete payloads")
        .expect("ignored payload canonical case");
    value["cases"][ignored]["input"]["rows"][0]["test"] = json!("unknownTest");
    reject_fixture("unknown ignored-row variant", value);

    let mut value = canonical_value();
    let ignored = value["cases"]
        .as_array()
        .unwrap()
        .iter()
        .position(|case| case["origin"]["label"] == "all ignored variants with complete payloads")
        .expect("ignored payload canonical case");
    value["cases"][ignored]["input"]["rows"][3]["do"]["do"] = json!("unknownAction");
    reject_fixture("unknown nested trigger action", value);

    let mut value = canonical_value();
    let ignored = value["cases"]
        .as_array()
        .unwrap()
        .iter()
        .position(|case| case["origin"]["label"] == "all ignored variants with complete payloads")
        .expect("ignored payload canonical case");
    value["cases"][ignored]["input"]["rows"][3]["do"]["ms"] = Value::Null;
    reject_fixture("null optional nested trigger payload", value);

    let mut value = canonical_value();
    let ignored = value["cases"]
        .as_array()
        .unwrap()
        .iter()
        .position(|case| case["origin"]["label"] == "all ignored variants with complete payloads")
        .expect("ignored payload canonical case");
    value["cases"][ignored]["input"]["rows"][3]["do"]["unknown"] = json!(1);
    reject_fixture("unknown nested trigger key", value);

    let mut value = canonical_value();
    let while_case = value["cases"]
        .as_array()
        .unwrap()
        .iter()
        .position(|case| case["origin"]["label"] == "while chasingLock false")
        .expect("while canonical case");
    value["cases"][while_case]["input"]["holds"][0] = Value::Null;
    reject_fixture("malformed while answer", value);
}

#[test]
fn fixture_integrity_rejects_duplicate_json_keys() {
    let text = include_str!("../../../parity/stat-fold/canonical.json");
    let duplicated = text.replacen(
        "\"format\":\"rh-stat-fold/1\"",
        "\"format\":\"rh-stat-fold/1\",\"format\":\"rh-stat-fold/1\"",
        1,
    );
    let error = parse_corpus_text(&duplicated, Admission::Canonical)
        .expect_err("duplicate top-level JSON key");
    assert!(error.contains("duplicate"), "{error}");
}

fn find_case<'a>(corpus: &'a Corpus, label: &str) -> &'a Case {
    corpus
        .cases
        .iter()
        .find(|case| matches!(&case.origin, Origin::Synthetic { label: case_label } if case_label == label))
        .unwrap_or_else(|| panic!("missing canonical control {label}"))
}

fn assert_output_mutation(label: &str, mutate: impl FnOnce(&mut Output)) {
    let corpus = canonical();
    let case = find_case(&corpus, label);
    let mut actual = execute(case);
    compare_output(&case.expected, &actual, ComparisonPolicy::Exact)
        .unwrap_or_else(|error| panic!("unchanged control {label} failed: {error:?}"));
    mutate(&mut actual);
    compare_output(&case.expected, &actual, ComparisonPolicy::Exact).expect_err(&format!(
        "output corruption survived normal comparator: {label}"
    ));
}

#[test]
fn output_corruption_controls_are_caught_by_normal_comparator() {
    assert_output_mutation("product stat source order", |output| {
        let Output::Fold(output) = output else {
            unreachable!()
        };
        output.plain[12] = F64::from(1.25);
        output.sums[12] = F64::from(1.25);
    });
    assert_output_mutation("conversion one-pass chain", |output| {
        let Output::Fold(output) = output else {
            unreachable!()
        };
        output.sums[16] = F64::from(15.0);
    });
    assert_output_mutation("cap attack speed before asPost", |output| {
        let Output::Fold(output) = output else {
            unreachable!()
        };
        output.mirrors_from_fold[0] = F64::from(1.5);
    });
    assert_output_mutation("farm rows outside card ceiling", |output| {
        let Output::Fold(output) = output else {
            unreachable!()
        };
        output.mirrors_from_fold[3] = F64::from(200.0);
    });
    assert_output_mutation("boost gains share one pre-boost sheet", |output| {
        let Output::Fold(output) = output else {
            unreachable!()
        };
        output.farm_sums[18] = F64::from(9.8);
    });
    assert_output_mutation("nonempty requirements default false", |output| {
        let Output::Fold(output) = output else {
            unreachable!()
        };
        output.plain[3] = F64::from(0.1);
        output.sums[3] = F64::from(0.1);
    });
    assert_output_mutation("while answers are row-location-specific", |output| {
        let Output::Fold(output) = output else {
            unreachable!()
        };
        output.plain[18] = F64::from(0.0);
        output.plain[19] = F64::from(20.0);
        output.sums[18] = F64::from(0.0);
        output.sums[19] = F64::from(20.0);
    });
    assert_output_mutation("multCodec half-up tie", |output| {
        let Output::Codec(output) = output else {
            unreachable!()
        };
        output.encoded = F64::from(1234.0);
    });
    assert_output_mutation("multCodec 1000000000", |output| {
        let Output::Codec(output) = output else {
            unreachable!()
        };
        output.encoded = F64::from(2_147_483_647.0);
    });
}

#[test]
fn diagnostic_tolerance_never_relaxes_cap_discrete_or_codec_results() {
    let corpus = canonical();
    let case = find_case(&corpus, "multCodec half-up tie");
    let mut actual = execute(case);
    let Output::Codec(codec) = &mut actual else {
        unreachable!()
    };
    codec.encoded = F64::from(codec.encoded.value() + 1e-7);
    compare_output(
        &case.expected,
        &actual,
        ComparisonPolicy::DiagnosticContinuous,
    )
    .expect_err("codec tolerance mutation");

    let case = find_case(&corpus, "flags first insertion and duplicate");
    let mut actual = execute(case);
    let Output::Fold(folded) = &mut actual else {
        unreachable!()
    };
    folded.flags.swap(0, 1);
    compare_output(
        &case.expected,
        &actual,
        ComparisonPolicy::DiagnosticContinuous,
    )
    .expect_err("flag tolerance mutation");

    let case = find_case(&corpus, "defense cap armor 200");
    let mut actual = execute(case);
    let Output::Fold(folded) = &mut actual else {
        unreachable!()
    };
    folded.sums[16] = F64::from(folded.sums[16].value() + 1e-7);
    compare_output(
        &case.expected,
        &actual,
        ComparisonPolicy::DiagnosticContinuous,
    )
    .expect_err("cap tolerance mutation");
}

#[test]
fn recursive_duplicate_and_source_provenance_controls() {
    let text = include_str!("../../../parity/stat-fold/canonical.json");
    for (needle, replacement) in [
        (
            "\"input\":{\"rows\":[]",
            "\"input\":{\"rows\":[],\"rows\":[]",
        ),
        (
            "\"f64\":\"0000000000000000\"",
            "\"f64\":\"0000000000000000\",\"f64\":\"0000000000000000\"",
        ),
    ] {
        assert!(text.contains(needle));
        let bad = text.replacen(needle, replacement, 1);
        assert!(parse_corpus_text(&bad, Admission::Canonical)
            .unwrap_err()
            .contains("duplicate"));
    }
    for change in 0..4 {
        let mut bad = canonical_value();
        match change {
            0 => bad["provenance"]["sources"] = json!([]),
            1 => bad["provenance"]["sources"][0]["path"] = json!("unrelated.ts"),
            2 => bad["provenance"]["runtime"]["node"] = json!("v25.8.1"),
            _ => {
                bad["provenance"]["sources"].as_array_mut().unwrap().pop();
            }
        }
        reject_fixture("source provenance", bad);
    }
}

#[test]
fn independent_canonical_boost_boundary_corpus() {
    let corpus = parse_corpus_text(
        include_str!("../../../parity/stat-fold/review-boost-boundaries.json"),
        Admission::External,
    )
    .unwrap();
    assert_eq!(corpus.cases.len(), 240);
    for (index, case) in corpus.cases.iter().enumerate() {
        assert_eq!(case.id, format!("ci-{index:05}"));
        compare_output(&case.expected, &execute(case), ComparisonPolicy::Exact).unwrap_or_else(
            |error| {
                panic!(
                    "fresh canonical case {} {:?}: {error:?}",
                    case.id, case.origin
                )
            },
        );
    }
}

#[test]
fn independent_canonical_product_witness_corpus() {
    let corpus = parse_corpus_text(
        include_str!("../../../parity/stat-fold/review-mutant-boundaries.json"),
        Admission::External,
    )
    .unwrap();
    assert_eq!(corpus.cases.len(), 12);
    for (index, case) in corpus.cases.iter().enumerate() {
        assert_eq!(case.id, format!("ci-{index:05}"));
        compare_output(&case.expected, &execute(case), ComparisonPolicy::Exact).unwrap_or_else(
            |error| {
                panic!(
                    "fresh canonical case {} {:?}: {error:?}",
                    case.id, case.origin
                )
            },
        );
    }
}

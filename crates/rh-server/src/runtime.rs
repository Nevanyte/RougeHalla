//! Explicit endpoint configuration. The protocol Hello carries no room mode: each process hosts one profile.
use rh_sim::{abilities, mob_runtime::MobMode, terrain, Arena, ArenaMode, FactionMode, SimConfig};

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Profile {
    SourceArena,
    Training,
}

#[derive(Debug)]
pub struct Settings {
    pub profile: Profile,
    pub map: Option<String>,
    pub min_players: usize,
    pub fill_bots: usize,
    pub max_rooms: usize,
    pub lobby_seconds: f64,
    pub fill_seconds: f64,
    /// ADR0024 (P-HB-9): the live runtimes default to [`LIVE_DEFAULT_HITBOXES`]; `--hitboxes legacy|archetypes` overrides.
    pub hitboxes: rh_sim::archetype::HitboxMode,
}

/// The hitbox mode of the LIVE runtimes (`--runtime source-arena`, `--runtime training` and `--first-playable`, the
/// profiles players join) when `--hitboxes` is absent. The ONE line the coordinator changes to `Archetypes` to flip the
/// live default (after the client's prediction and chest aim are verified; owner sign-off 2026-11-10, DEVIATIONS
/// DEV-009/DEV-010); `--hitboxes legacy` stays the override. The bare core binary (no `--runtime`, `--runtime core`) is a
/// development profile and stays `LegacyCircle` whatever this says. `tests::which_runtimes_default_to_which_hitbox_mode`
/// pins both, so the flip is a deliberate two-line change (this constant and the pinned expectation).
pub const LIVE_DEFAULT_HITBOXES: rh_sim::archetype::HitboxMode =
    rh_sim::archetype::HitboxMode::Archetypes;

/// `--hitboxes legacy|archetypes`, else `default`.
pub fn hitboxes_flag(
    args: &[String],
    default: rh_sim::archetype::HitboxMode,
) -> Result<rh_sim::archetype::HitboxMode, String> {
    use rh_sim::archetype::HitboxMode;
    match value(args, "--hitboxes")? {
        None => Ok(default),
        Some("legacy") => Ok(HitboxMode::LegacyCircle),
        Some("archetypes") => Ok(HitboxMode::Archetypes),
        Some(_) => Err("--hitboxes must be legacy or archetypes".into()),
    }
}

/// The hitbox mode of the core binary path (no `--runtime`, `--runtime core`, or `--first-playable`): `--hitboxes` takes
/// effect there too (review finding 9: it is never silently ignored). The default is [`LIVE_DEFAULT_HITBOXES`] for the live
/// `--first-playable` profile and the legacy circle for the bare core binary. A bad value is a startup error, as it is with
/// `--runtime`.
pub fn core_hitboxes(args: &[String]) -> Result<rh_sim::archetype::HitboxMode, String> {
    let live = args.iter().any(|a| a == "--first-playable");
    hitboxes_flag(
        args,
        if live {
            LIVE_DEFAULT_HITBOXES
        } else {
            rh_sim::archetype::HitboxMode::LegacyCircle
        },
    )
}

fn value<'a>(args: &'a [String], flag: &str) -> Result<Option<&'a str>, String> {
    if args.iter().any(|a| a.starts_with(&format!("{flag}="))) {
        return Err(format!("use {flag} with a separate value"));
    }
    let mut found = args.iter().enumerate().filter(|(_, a)| a.as_str() == flag);
    let Some((i, _)) = found.next() else {
        return Ok(None);
    };
    if found.next().is_some() {
        return Err(format!("{flag} must occur once"));
    }
    args.get(i + 1)
        .filter(|v| !v.starts_with("--"))
        .map(|s| Some(s.as_str()))
        .ok_or_else(|| format!("{flag} requires a value"))
}

impl Settings {
    /// No flag (or explicit core) retains the existing binary configuration. Misspelled runtime flags fail closed.
    pub fn from_args(args: &[String]) -> Result<Option<Self>, String> {
        if args
            .iter()
            .any(|a| a.starts_with("--runtime") && a != "--runtime")
        {
            return Err(
                "unknown --runtime option; use --runtime core|source-arena|training".into(),
            );
        }
        let Some(mode) = value(args, "--runtime")? else {
            return Ok(None);
        };
        if args.iter().any(|a| a.starts_with("--first-play")) {
            return Err("--runtime and --first-playable cannot be combined".into());
        }
        let profile = match mode {
            "core" => return Ok(None),
            "source-arena" => Profile::SourceArena,
            "training" => Profile::Training,
            _ => return Err("--runtime must be core, source-arena or training".into()),
        };
        let seats = |flag, default, min, max| {
            let n = value(args, flag)?.map_or(Ok(default), |v| {
                v.parse::<usize>()
                    .map_err(|_| format!("{flag} requires whole seats"))
            })?;
            if !(min..=max).contains(&n) {
                return Err(format!("{flag} must be {min}..={max}"));
            }
            Ok(n)
        };
        let seconds = |flag, default| {
            let n = value(args, flag)?.map_or(Ok(default), |v| {
                v.parse::<f64>()
                    .map_err(|_| format!("{flag} requires seconds"))
            })?;
            if !n.is_finite() || !(0. ..=86_400.).contains(&n) {
                return Err(format!("{flag} must be finite seconds in 0..=86400"));
            }
            Ok(n)
        };
        let training = profile == Profile::Training;
        let map = value(args, "--map")?.map(str::to_owned);
        if training && map.is_some() {
            return Err("training uses the practice arena; --map is not accepted".into());
        }
        if !training && map.is_none() {
            return Err("source-arena requires --map with a validated rh-map/2 export".into());
        }
        let settings = Self {
            profile,
            map,
            min_players: seats(
                "--min-players",
                if training { 1 } else { 2 },
                1,
                if training {
                    1
                } else {
                    rh_sim::constants::MAX_PLAYERS
                },
            )?,
            fill_bots: seats(
                "--fill-bots",
                0,
                0,
                if training {
                    0
                } else {
                    rh_sim::constants::MAX_PLAYERS
                },
            )?,
            max_rooms: seats("--max-rooms", 16, 1, usize::MAX)?,
            lobby_seconds: seconds("--lobby-seconds", if training { 0. } else { 30. })?,
            fill_seconds: seconds("--fill-seconds", if training { 0. } else { 5. })?,
            hitboxes: hitboxes_flag(args, LIVE_DEFAULT_HITBOXES)?,
        };
        if training && (settings.lobby_seconds != 0. || settings.fill_seconds != 0.) {
            return Err("training requires zero lobby and fill seconds".into());
        }
        Ok(Some(settings))
    }

    pub fn sim(&self) -> SimConfig {
        let training = self.profile == Profile::Training;
        SimConfig {
            walk_hints: Some(true),
            regen: true,
            quests: !training,
            training,
            dummies: training,
            hazards: if training {
                terrain::Mode::Off
            } else {
                terrain::Mode::All
            },
            abilities: abilities::Mode::Full,
            faction_mode: FactionMode::EngagementHolyPlagueFireFrostSentencedFireRoam,
            lifecycle: if training {
                ArenaMode::Off
            } else {
                ArenaMode::Source(Default::default())
            },
            mob_mode: if training { MobMode::Off } else { MobMode::Pve },
            initial_loot: !training,
            consumables: true,
            min_players: self.min_players,
            lobby_seconds: self.lobby_seconds,
            fill_seconds: self.fill_seconds,
            hitboxes: self.hitboxes,
            ..SimConfig::default()
        }
    }

    pub fn arena(&self) -> Result<Arena, String> {
        match self.profile {
            Profile::Training => Ok(rh_sim::arenas::practice_arena()),
            Profile::SourceArena => {
                let path = self.map.as_ref().ok_or("source-arena needs --map")?;
                let bytes = std::fs::read(path).map_err(|e| format!("{path}: {e}"))?;
                source_map(&bytes).map_err(|e| format!("{path}: {e}"))
            }
        }
    }
}

/// Unlike the core loader, this refuses collision-only maps and validates real gates, coliseum, layers and spawns.
pub fn source_map(bytes: &[u8]) -> Result<Arena, String> {
    let map: rh_sim::mapdata::MapExport =
        serde_json::from_slice(bytes).map_err(|e| e.to_string())?;
    let arena = map
        .validate()
        .map_err(|e| e.to_string())?
        .into_arena()
        .map_err(|e| e.to_string())?;
    crate::wire::arena_fits(&arena)?;
    Ok(arena)
}

#[cfg(test)]
mod tests {
    use super::*;
    fn parse(s: &str) -> Result<Option<Settings>, String> {
        Settings::from_args(&s.split_whitespace().map(str::to_owned).collect::<Vec<_>>())
    }
    #[test]
    fn explicit_profiles_and_invalid_combinations() {
        assert!(parse("").unwrap().is_none());
        assert!(parse("--runtime core").unwrap().is_none());
        for args in [
            "--runtime",
            "--runtime arena",
            "--runtime=training",
            "--runtime-mode training",
            "--runtime training --runtime training",
            "--runtime training --first-playable",
            "--runtime source-arena",
            "--runtime training --map x",
            "--runtime training --fill-bots 1",
            "--runtime training --min-players 2",
            "--runtime training --lobby-seconds 1",
            "--runtime source-arena --map x --min-players 1.5",
            "--runtime source-arena --map x --fill-seconds NaN",
            "--runtime source-arena --map x --max-rooms 0",
            "--runtime source-arena --map x --map y",
        ] {
            assert!(parse(args).is_err(), "{args}");
        }
        let source = parse("--runtime source-arena --map x").unwrap().unwrap();
        let sim = source.sim();
        assert_eq!(sim.walk_hints, Some(true));
        assert!(sim.quests && sim.regen && sim.initial_loot && sim.faction_mode.fire_roam());
        assert_eq!(sim.abilities, abilities::Mode::Full);
        assert!(matches!(sim.lifecycle, ArenaMode::Source(_)));
        let training = parse("--runtime training").unwrap().unwrap().sim();
        assert_eq!(training.walk_hints, Some(true));
        assert!(training.training && training.dummies && !training.quests);
        assert_eq!(training.lifecycle, ArenaMode::Off);
    }
    /// The deliberate pin (owner sign-off 2026-11-10): which profiles default to which hitbox mode. Flipping the live
    /// default means changing LIVE_DEFAULT_HITBOXES and the `live` line here, nothing else.
    #[test]
    fn which_runtimes_default_to_which_hitbox_mode() {
        use rh_sim::archetype::HitboxMode;
        let live = HitboxMode::Archetypes; // the pinned live default (flipped 2026-11-10 after the client's prediction and chest aim were verified in the browser)
        assert_eq!(LIVE_DEFAULT_HITBOXES, live);
        let args = |s: &str| s.split_whitespace().map(str::to_owned).collect::<Vec<_>>();
        for profile in ["--runtime source-arena --map x", "--runtime training"] {
            assert_eq!(
                parse(profile).unwrap().unwrap().sim().hitboxes,
                live,
                "{profile}"
            );
        }
        assert_eq!(core_hitboxes(&args("--first-playable")), Ok(live));
        for dev in ["", "--runtime core"] {
            assert_eq!(
                core_hitboxes(&args(dev)),
                Ok(HitboxMode::LegacyCircle),
                "{dev}"
            );
        }
    }
    #[test]
    fn hitboxes_take_effect_on_the_core_path_too() {
        use rh_sim::archetype::HitboxMode;
        let args = |s: &str| s.split_whitespace().map(str::to_owned).collect::<Vec<_>>();
        for base in ["", "--runtime core", "--first-playable"] {
            assert!(parse(base).unwrap().is_none(), "{base}: the core path");
            // The bare core binary is a development profile and stays legacy; --first-playable is a live profile and
            // follows LIVE_DEFAULT_HITBOXES.
            let default = if base == "--first-playable" {
                LIVE_DEFAULT_HITBOXES
            } else {
                HitboxMode::LegacyCircle
            };
            assert_eq!(core_hitboxes(&args(base)), Ok(default), "{base}");
            assert_eq!(
                core_hitboxes(&args(&format!("{base} --hitboxes archetypes"))),
                Ok(HitboxMode::Archetypes),
                "{base}"
            );
            assert_eq!(
                core_hitboxes(&args(&format!("{base} --hitboxes legacy"))),
                Ok(HitboxMode::LegacyCircle),
                "{base}"
            );
            for bad in ["--hitboxes boxes", "--hitboxes", "--hitboxes=archetypes"] {
                assert!(
                    core_hitboxes(&args(&format!("{base} {bad}"))).is_err(),
                    "{base} {bad}"
                );
            }
        }
    }
    #[test]
    fn live_runtimes_follow_the_live_default_and_both_overrides_work() {
        use rh_sim::archetype::HitboxMode;
        for args in ["--runtime source-arena --map x", "--runtime training"] {
            let got = parse(args).unwrap().unwrap();
            assert_eq!(got.sim().hitboxes, LIVE_DEFAULT_HITBOXES, "{args}");
            let opted = parse(&format!("{args} --hitboxes archetypes"))
                .unwrap()
                .unwrap();
            assert_eq!(opted.sim().hitboxes, HitboxMode::Archetypes, "{args}");
            let legacy = parse(&format!("{args} --hitboxes legacy"))
                .unwrap()
                .unwrap();
            assert_eq!(legacy.sim().hitboxes, HitboxMode::LegacyCircle, "{args}");
            for bad in ["--hitboxes boxes", "--hitboxes", "--hitboxes=archetypes"] {
                assert!(parse(&format!("{args} {bad}")).is_err(), "{args} {bad}");
            }
        }
    }
    #[test]
    fn source_maps_require_complete_valid_metadata() {
        assert!(source_map(include_bytes!("../../../parity/maps/duel.map.json")).is_err());
        let doc: serde_json::Value =
            serde_json::from_slice(include_bytes!("../../../parity/arena/source.json")).unwrap();
        let mut export = doc["map"]["export"].clone();
        assert!(source_map(&serde_json::to_vec(&export).unwrap()).is_ok());
        export["map"]["coliseum"]["gates"] = serde_json::json!([]);
        assert!(source_map(&serde_json::to_vec(&export).unwrap()).is_err());
    }
}

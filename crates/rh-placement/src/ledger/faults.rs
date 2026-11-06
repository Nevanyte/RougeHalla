//! Fault points and mutants for crash and negative-control tests. Compiled only with the `fault-injection` feature;
//! nothing in a default or production build reads any of this.
//!
//! Points are named `<before|after>.<what>`. Durable writes are `write.<label>` with labels `start_intent`, `start_accepted`,
//! `stop_intent`, `stop_resolved`, `attempt_resolved`, `fulfilled`, `dns_intent`, `dns_acknowledged`, `dns_verified`, `offer`, `cleanup_intent`,
//! `cleanup_done`, `not_found`, `lease`, `finished`, `release_intent`, `released`. Backend calls are `backend.<call>` with
//! `start_placement`, `describe_placement`, `stop_placement`, `terminate_game_session`, `capacity`, `dns_upsert`,
//! `dns_delete`, `dns_resolve`. `after.backend.*` runs once the effect happened and before the receipt is used, so
//! [`Action::Fail`] there models a lost receipt, and a hook that exits the process models a crash with the effect applied.

use super::Mutant;
use std::future::Future;
use std::pin::Pin;
use std::sync::{Arc, OnceLock, RwLock};

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Action {
    Continue,
    /// The point fails: a durable write returns `Unavailable` (before: not sent; after: the answer is dropped), a backend
    /// call returns `Unavailable`.
    Fail,
}

/// A hook may await (a barrier), never return (a hang) or end the process (a crash).
pub trait Hook: Send + Sync {
    fn point<'a>(&'a self, name: &'a str) -> Pin<Box<dyn Future<Output = Action> + Send + 'a>>;
}

static HOOK: RwLock<Option<Arc<dyn Hook>>> = RwLock::new(None);

pub fn set_hook(hook: Option<Arc<dyn Hook>>) {
    *HOOK.write().unwrap() = hook;
}

pub(crate) async fn point(name: &str) -> Result<(), String> {
    let hook = HOOK.read().unwrap().clone();
    match hook {
        Some(h) => match h.point(name).await {
            Action::Continue => Ok(()),
            Action::Fail => Err(format!("injected fault at {name}")),
        },
        None => Ok(()),
    }
}

/// The mutant named by `RH_PLACEMENT_MUTANT` (`skip_write_ahead`, `skip_ownership_check`, `skip_fencing`,
/// `premature_completion`; unset or `none` = the unchanged control). Read once; an unknown name panics so a typo can never
/// look like a passing control.
pub fn active_mutant() -> Option<Mutant> {
    static M: OnceLock<Option<Mutant>> = OnceLock::new();
    *M.get_or_init(|| match std::env::var("RH_PLACEMENT_MUTANT").as_deref() {
        Err(_) | Ok("") | Ok("none") => None,
        Ok("skip_write_ahead") => Some(Mutant::SkipWriteAhead),
        Ok("skip_ownership_check") => Some(Mutant::SkipOwnershipCheck),
        Ok("skip_fencing") => Some(Mutant::SkipFencing),
        Ok("premature_completion") => Some(Mutant::PrematureCompletion),
        Ok(other) => panic!("unknown RH_PLACEMENT_MUTANT {other:?}"),
    })
}

//! Complete source feature-module registry (`brain/modules/index.ts`).
//!
//! The registry is caller-owned state (the source's module-level singleton maps to one registry per composing caller),
//! which keeps the replay deterministic and thread-independent. Behavior is source-exact: registration order,
//! equal-id replacement **keeping the original place**, `enabledModules(features)` filtering in order, reset that
//! clears the registry and the optional opaque cast-policy slot, and a get/set policy slot that the Wishes module
//! never reads (it calls the real cast policy directly in the separately reviewed Wish adapter).

use std::sync::Arc;

use super::types::{Features, ModuleId};

/// One custom descriptor as the source tests register it (`{ id, enabled }`); the enabled closure is opaque to the
/// caller and is the only function key such a module object has.
#[derive(Clone)]
pub(crate) struct CustomModule {
    pub(crate) id: String,
    /// The declared source token spelling (a source case's custom-object key name).
    pub(crate) token: String,
    pub(crate) enabled: Arc<dyn Fn(&Features) -> bool + Send + Sync>,
}

impl std::fmt::Debug for CustomModule {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("CustomModule")
            .field("id", &self.id)
            .field("token", &self.token)
            .finish()
    }
}

/// One `enabledModules` row as the source returns it: the module id, its own function keys in declaration order, the
/// builtin identity when the object is one of the four actual modules, and the custom token when it is a registered
/// custom object. The source literal always has both optional properties (an absent match is `undefined`).
#[derive(Clone, Debug, PartialEq)]
pub(crate) struct EnabledModule {
    pub(crate) id: String,
    pub(crate) hooks: Vec<&'static str>,
    pub(crate) builtin: Option<ModuleId>,
    pub(crate) token: Option<String>,
}

#[derive(Clone, Debug)]
enum Entry {
    Builtin(ModuleId),
    Custom(CustomModule),
}

impl Entry {
    fn id(&self) -> String {
        match self {
            Self::Builtin(id) => id.as_str().to_owned(),
            Self::Custom(module) => module.id.clone(),
        }
    }
    fn hooks(&self) -> Vec<&'static str> {
        match self {
            Self::Builtin(id) => id.hooks().to_vec(),
            Self::Custom(_) => vec!["enabled"],
        }
    }
}

/// The ordered source registry plus the optional opaque cast-policy slot.
#[derive(Default)]
pub(crate) struct Registry {
    entries: Vec<Entry>,
    cast_policy: Option<Arc<dyn Fn() + Send + Sync>>,
}

impl std::fmt::Debug for Registry {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("Registry")
            .field("entries", &self.entries)
            .field("cast_policy", &self.cast_policy.is_some())
            .finish()
    }
}

impl Clone for Registry {
    fn clone(&self) -> Self {
        Self {
            entries: self.entries.clone(),
            cast_policy: self.cast_policy.clone(),
        }
    }
}

impl Registry {
    /// `registerModule(wishesModule); registerModule(planningModule); registerModule(chestsModule); registerModule(hazardsModule);`
    pub(crate) fn with_defaults() -> Self {
        let mut registry = Self::default();
        registry.reset_defaults();
        registry
    }

    /// Source `registerModule`: `Map.set` replaces by equal id without moving the existing entry.
    pub(crate) fn register_builtin(&mut self, id: ModuleId) {
        self.register_entry(Entry::Builtin(id));
    }

    pub(crate) fn register_custom(&mut self, module: CustomModule) {
        self.register_entry(Entry::Custom(module));
    }

    fn register_entry(&mut self, entry: Entry) {
        let id = entry.id();
        match self.entries.iter_mut().find(|existing| existing.id() == id) {
            Some(slot) => *slot = entry,
            None => self.entries.push(entry),
        }
    }

    /// Source `resetModules`: forget every module and the cast policy.
    pub(crate) fn reset(&mut self) {
        self.entries.clear();
        self.cast_policy = None;
    }

    /// The source bottom-of-file default registration.
    pub(crate) fn reset_defaults(&mut self) {
        self.reset();
        for id in ModuleId::DEFAULT_ORDER {
            self.register_builtin(id);
        }
    }

    /// Source `registerCastPolicy`: an opaque definition; the Wishes module does not read it.
    pub(crate) fn register_cast_policy(&mut self, policy: Arc<dyn Fn() + Send + Sync>) {
        self.cast_policy = Some(policy);
    }

    /// Source `getCastPolicy`.
    pub(crate) fn cast_policy(&self) -> Option<&Arc<dyn Fn() + Send + Sync>> {
        self.cast_policy.as_ref()
    }

    /// Source `enabledModules(features)`: registered modules whose `enabled(features)` holds, in registration order.
    pub(crate) fn enabled(&self, features: &Features) -> Vec<EnabledModule> {
        let mut out = Vec::new();
        for entry in &self.entries {
            let enabled = match entry {
                Entry::Builtin(id) => builtin_enabled(*id, features),
                Entry::Custom(module) => (module.enabled)(features),
            };
            if !enabled {
                continue;
            }
            out.push(match entry {
                Entry::Builtin(id) => EnabledModule {
                    id: id.as_str().to_owned(),
                    hooks: entry.hooks(),
                    builtin: Some(*id),
                    token: None,
                },
                Entry::Custom(module) => EnabledModule {
                    id: module.id.clone(),
                    hooks: entry.hooks(),
                    builtin: None,
                    token: Some(module.token.clone()),
                },
            });
        }
        out
    }

    /// The registered ids in order (diagnostics/tests: source Map iteration order).
    pub(crate) fn ids(&self) -> Vec<String> {
        self.entries.iter().map(Entry::id).collect()
    }
}

/// Source each module's `enabled(features)` at the time the registry runs it (the actual module objects' gates).
fn builtin_enabled(id: ModuleId, features: &Features) -> bool {
    match id {
        ModuleId::Wishes => features.wishes,
        ModuleId::Planning => features.planning,
        ModuleId::Chests => features.chests,
        ModuleId::Hazards => features.hazards,
    }
}

#[cfg(test)]
mod send_assertions {
    //! P-BOT-MODULES-1 pre-seal compatibility: the production policy contract requires `Send`. The private module
    //! layer's persistent registry/state types must therefore be `Send` without any wrapper hiding a non-Send inner
    //! value (registered custom callbacks are declared `Send + Sync`; per-cfg module state keeps no shared cells).
    use super::*;

    fn assert_send<T: Send>() {}

    #[test]
    fn new_private_module_layer_is_send() {
        assert_send::<Registry>();
        assert_send::<CustomModule>();
        assert_send::<crate::bots::temporal_percept::modules::wishes::WishesModule>();
        assert_send::<crate::bots::temporal_percept::modules::planning::PlanningModule>();
        assert_send::<crate::bots::temporal_percept::modules::chests::ChestsModule>();
        assert_send::<crate::bots::temporal_percept::modules::hazards::HazardsModule>();
    }
}

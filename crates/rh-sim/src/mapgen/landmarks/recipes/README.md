# Live landmark recipes

This parent owns the common borrowed template representation and the verified five-faction registry.
`TemplateDefinition` is live source data: ordered key, rows and jobs. `build()` allocates an owned template for one
off-tick parse. `visit_content()` enumerates length-delimited UTF-16 key/rows and declaration-order job tags without
allocation. Runtime selection must not use fixture data as rules.

The `search_family` leaf owns `scorch` and `gallows`; `direct_family` owns `rime`, `sanctum` and `warren`.
Each faction module supplies `Definition<'a>`, `default_definition() -> Definition<'static>`,
`visit_content(&Definition<'_>, impl FnMut(u64))`, and an immutable `Recipe<'a>` parsed once through
`Recipe::from_definition(&Definition<'a>) -> Result<Self, TemplateError>`.
`Recipe::apply(&self, &mut LandmarkRuntime<'_>, &RecipeInputs<'_>)` runs the actual callback. Immutable definition
copies and parsed templates live in the recipe; callback-local caches and scratch must not survive into another zone.

Common policy belongs in the accepted `recipe_support`, `runtime`, `templates` and `search` definitions. Each leaf
enumerates its own live tuning and template content in fixed declaration order. Structural encodings are documented
separately. The coordinator owns module declarations, registry selection, content folding and ordered stage admission.
No recipe consumes the attempt RNG; all actual callbacks consume zero independent context RNG words as well.

Actual-source captures and real recipe execution include refused placements and transient guard/search effects.
The parent stage test runs all five live callbacks with continuously shared state and exact source admission masks.
Source final-map equality checks validate observational taps; they do not prove finished Rust generator pins.
Later stages, finished generation, independent certification and pins remain required.

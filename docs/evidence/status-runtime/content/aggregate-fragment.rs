// Coordinator-owned content.rs fragment. Add these items beside the existing hash wrappers.
// Add `status_words: Option<(&[u64], &[u64])>` as the final argument of
// content_hash_of_definitions; every existing wrapper passes None, preserving
// its supplied map/signature/stat_fold/mob_catalog argument exactly.

/// Perturbs the words emitted by the actual status visitors through the real aggregate path.
pub fn content_hash_of_status_words(
    registry: &[Entry],
    stagger_weapons: &[WeaponId],
    rule_words: &[u64],
    extra_words: &[u64],
) -> u64 {
    let signatures = crate::factions::SignatureKind::ALL.map(|kind| (kind, kind.is_dot()));
    content_hash_of_definitions(
        registry,
        stagger_weapons,
        MapDefinitions::default(),
        &signatures,
        &crate::stat_fold::default_definition(),
        &crate::mob_catalog::DEFINITION,
        Some((rule_words, extra_words)),
    )
}

// Only output words are injected; no status rules or gameplay operations are mutated.
// The default streams the real visitors twice (length, then words), without collecting.
fn fold_status_stream(
    h: &mut Fnv,
    label: &str,
    supplied: Option<&[u64]>,
    visit: fn(&mut dyn FnMut(u64)),
) {
    h.str(label);
    if let Some(words) = supplied {
        h.u64(words.len() as u64);
        for &word in words {
            h.u64(word);
        }
    } else {
        let mut count = 0u64;
        visit(&mut |_| count += 1);
        h.u64(count);
        visit(&mut |word| h.u64(word));
    }
}
fn fold_status_content(h: &mut Fnv, supplied: Option<(&[u64], &[u64])>) {
    fold_status_stream(h, "status-rules/1", supplied.map(|words| words.0), |word| {
        crate::status_runtime::visit_content(word)
    });
    fold_status_stream(h, "status-extra/1", supplied.map(|words| words.1), |word| {
        crate::status_runtime::visit_extra_content(word)
    });
}

// In content_hash_of_definitions, after fold_mob_catalog and before stat-fold:
// fold_status_content(&mut h, status_words);
// Existing stat-fold/mob fold code and all other content ordering stay unchanged.

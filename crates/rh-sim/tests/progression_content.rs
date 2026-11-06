use rh_sim::constants::REGISTRY;
use rh_sim::content::{
    content_hash, content_hash_of_progression_words, visit_progression_content, STAGGER_WEAPONS,
};

#[test]
fn actual_progression_words_and_order_participate_in_the_aggregate_identity() {
    let mut words = Vec::new();
    visit_progression_content(|v| words.push(v));
    let hash = |w: &[u64]| content_hash_of_progression_words(REGISTRY, STAGGER_WEAPONS, w);
    assert_eq!(hash(&words), content_hash());
    assert!(
        words.len() > 200,
        "actual farm keys and all rule components must be present"
    );
    for at in [0, words.len() / 2, words.len() - 1] {
        let mut changed = words.clone();
        changed[at] ^= 1;
        assert_ne!(hash(&changed), content_hash());
    }
    let mut removed = words.clone();
    removed.remove(words.len() / 2);
    assert_ne!(hash(&removed), content_hash());
    let mut reordered = words.clone();
    reordered.swap(0, 1);
    assert_ne!(hash(&reordered), content_hash());
}

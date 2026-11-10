// Opt-in (?scenario.probe=1) read-only state mirror for the UI scenario harness (Tools/ui-scenarios.cjs). The page only receives
// what the client already holds (the server's delivered state projected to screen); it sends nothing back to the game.
mergeInto(LibraryManager.library, {
  RhProbe_Publish: function (json) {
    try { window.__rhProbe = JSON.parse(UTF8ToString(json)); } catch (_) { /* diagnostics never interrupt the frame */ }
  }
});

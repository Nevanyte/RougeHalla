mergeInto(LibraryManager.library, {
  RhShowcase_Settings: function (quality, mode, reducedMotion, textScale, musicVolume) {
    // Public presentation preferences only; no actor, account or simulation state.
    window.__rhShowcaseSettings = {
      quality: ['Low', 'Medium', 'High', 'Ultra'][quality],
      mode: ['Adaptive', 'Manual'][mode],
      reducedMotion: !!reducedMotion,
      textScale: textScale,
      musicVolume: musicVolume
    };
  }
});

// One tab-session slot, never account ownership or durable recovery. No logs, URL transport or persistent fallback.
mergeInto(LibraryManager.library, {
  RhSeatCheckpoint_Read: function() {
    var framed;
    try {
      var value = sessionStorage.getItem("rh.seat.checkpoint.v1");
      framed = value === null ? "M" : value.length > 8192 ? "I" : "R\n" + value;
    } catch (_) { framed = "U"; }
    var ptr = 0;
    try {
      ptr = _malloc(lengthBytesUTF8(framed) + 1);
      if (!ptr) return 0;
      stringToUTF8(framed, ptr, lengthBytesUTF8(framed) + 1);
      return ptr;
    } catch (_) { if (ptr) _free(ptr); return 0; }
  },
  RhSeatCheckpoint_Write: function(textPtr) {
    // Write: Saved=0, Unsaved=1, Unavailable=2, Invalid=3. A throw after obtaining storage is an unconfirmed write.
    var text, storage;
    try { text = UTF8ToString(textPtr); } catch (_) { return 1; }
    if (text.length > 8192) return 3;
    try { storage = sessionStorage; } catch (_) { return 2; }
    try {
      storage.setItem("rh.seat.checkpoint.v1", text);
      return storage.getItem("rh.seat.checkpoint.v1") === text ? 0 : 1;
    } catch (_) { return 1; }
  },
  RhSeatCheckpoint_Clear: function(expectedPtr) {
    // Clear: Cleared=0, Missing=1, Changed=2, Unavailable=3, Unsaved=4, Invalid=5.
    // Same-turn get/compare/remove; no callback or promise between checking and removing.
    var expected, storage, current;
    try { expected = UTF8ToString(expectedPtr); } catch (_) { return 4; }
    if (expected.length > 8192) return 5;
    try { storage = sessionStorage; current = storage.getItem("rh.seat.checkpoint.v1"); } catch (_) { return 3; }
    if (current === null) return 1;
    if (current !== expected) return 2;
    try {
      storage.removeItem("rh.seat.checkpoint.v1");
      return storage.getItem("rh.seat.checkpoint.v1") === null ? 0 : 4;
    } catch (_) { return 4; }
  }
});

mergeInto(LibraryManager.library, {
  RhUi_CanvasCssWidth: function() {
    var c = Module.canvas; return c && c.clientWidth > 0 ? c.clientWidth : window.innerWidth;
  },
  RhUi_CanvasCssHeight: function() {
    var c = Module.canvas; return c && c.clientHeight > 0 ? c.clientHeight : window.innerHeight;
  },
  RhUi_ConsumeSignInKey: function() {
    var fragment = new URLSearchParams(location.hash.slice(1));
    var keys = fragment.getAll("key");
    var value = keys.length === 1 ? keys[0] : "";
    fragment.delete("key");
    var query = new URLSearchParams(location.search); query.delete("token");
    var clean = location.pathname + (query.toString() ? "?" + query.toString() : "") + (fragment.toString() ? "#" + fragment.toString() : "");
    history.replaceState(null, "", clean);
    var size = lengthBytesUTF8(value) + 1;
    var ptr = _malloc(size); stringToUTF8(value, ptr, size); return ptr;
  },
  RhUi_GetRoute: function(keyPtr) {
    var value = "";
    try { value = sessionStorage.getItem("rh.ui.route.v1:" + UTF8ToString(keyPtr)) || ""; } catch (_) {}
    var size = lengthBytesUTF8(value) + 1;
    var ptr = _malloc(size); stringToUTF8(value, ptr, size); return ptr;
  },
  RhUi_SetRoute: function(keyPtr, valuePtr) {
    try { sessionStorage.setItem("rh.ui.route.v1:" + UTF8ToString(keyPtr), UTF8ToString(valuePtr)); } catch (_) {}
  },
  RhUi_SetTabCapture: function(capture) {
    Module.rhUiTabCapture = capture;
    if (Module.rhUiTabListener) return;
    Module.rhUiTabListener = function(e) {
      if (Module.rhUiTabCapture && e.code === "Tab" && !e.ctrlKey && !e.metaKey && !e.altKey && (!e.shiftKey || Module.rhUiTabCapture === 2) && e.target === Module.canvas) e.preventDefault();
    };
    document.addEventListener("keydown", Module.rhUiTabListener);
  }
});

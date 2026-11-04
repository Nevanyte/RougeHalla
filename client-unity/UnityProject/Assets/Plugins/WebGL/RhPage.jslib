// Page facts for Bootstrap (NOT COMPILED here). Returns window.location.search as a UTF-8 string, e.g. "?server=wss://host/ws&profile=a&token=b".
mergeInto(LibraryManager.library, {
  RhPage_GetSearch: function () {
    var s = window.location.search || "";
    var n = lengthBytesUTF8(s) + 1;
    var p = _malloc(n);
    stringToUTF8(s, p, n);
    return p;
  }
});

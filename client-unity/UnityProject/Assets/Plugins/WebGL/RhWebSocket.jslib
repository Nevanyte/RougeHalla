// Browser WebSocket bridge. NOT COMPILED/RUN in Stage 1 (no Unity toolchain here).
// Polling design: JS never calls back into C#. Received frames are queued per socket and C# drains them each frame, which is
// robust under WebGL (single thread, no re-entrancy into managed code from a JS event).
// State: 0 connecting, 1 open, 2 closed.
mergeInto(LibraryManager.library, {
  RhWs_Create: function (urlPtr) {
    var url = UTF8ToString(urlPtr);
    var reg = Module.rhSockets || (Module.rhSockets = { next: 1, map: {} });
    var id = reg.next++;
    var s = { ws: null, state: 0, queue: [], code: 0 };
    reg.map[id] = s;
    try {
      var ws = new WebSocket(url);
      ws.binaryType = "arraybuffer";
      ws.onopen = function () { s.state = 1; };
      ws.onmessage = function (e) { if (e.data instanceof ArrayBuffer) s.queue.push(new Uint8Array(e.data)); };
      ws.onerror = function () { /* onclose follows with the code */ };
      ws.onclose = function (e) { s.state = 2; s.code = e.code || 1006; };
      s.ws = ws;
    } catch (err) { s.state = 2; s.code = 1006; }
    return id;
  },
  RhWs_State: function (id) { var s = Module.rhSockets && Module.rhSockets.map[id]; return s ? s.state : 2; },
  RhWs_CloseCode: function (id) { var s = Module.rhSockets && Module.rhSockets.map[id]; return s ? s.code : 0; },
  RhWs_Send: function (id, ptr, len) {
    var s = Module.rhSockets && Module.rhSockets.map[id];
    if (!s || !s.ws || s.state !== 1) return 0;
    s.ws.send(HEAPU8.slice(ptr, ptr + len)); // copy: the wasm heap can grow or change under us
    return 1;
  },
  // Length of the next queued frame, or -1 when none.
  RhWs_NextLength: function (id) { var s = Module.rhSockets && Module.rhSockets.map[id]; return s && s.queue.length ? s.queue[0].length : -1; },
  // Copies the next frame to ptr (capacity cap) and pops it. Returns its length, or -1 when none / does not fit.
  RhWs_Receive: function (id, ptr, cap) {
    var s = Module.rhSockets && Module.rhSockets.map[id];
    if (!s || !s.queue.length || s.queue[0].length > cap) return -1;
    var f = s.queue.shift();
    HEAPU8.set(f, ptr);
    return f.length;
  },
  RhWs_Close: function (id) { var s = Module.rhSockets && Module.rhSockets.map[id]; if (s && s.ws && s.state < 2) { try { s.ws.close(1000); } catch (e) {} } },
  RhWs_Release: function (id) {
    var reg = Module.rhSockets; var s = reg && reg.map[id];
    if (!s) return;
    if (s.ws) { s.ws.onopen = s.ws.onmessage = s.ws.onerror = s.ws.onclose = null; try { s.ws.close(1000); } catch (e) {} }
    delete reg.map[id];
  }
});

// NOT COMPILED in Stage 1 (no Unity). Browser transport: talks to Plugins/WebGL/RhWebSocket.jslib and is polled from Session.Update().
using System;
using Roguehalla.Net;
#if UNITY_WEBGL && !UNITY_EDITOR
using System.Runtime.InteropServices;
#endif

namespace Roguehalla.Client
{
    public sealed class WebGLTransport : ITransport
    {
        public event Action Opened;
        public event Action<byte[]> Received;
        public event Action<string> Closed;

        const int MaxFrame = 256 * 1024; // Wire.MaxServerFrame
        int _id;
        int _lastState = 2;
        byte[] _rx = new byte[16 * 1024];

#if UNITY_WEBGL && !UNITY_EDITOR
        [DllImport("__Internal")] static extern int RhWs_Create(string url);
        [DllImport("__Internal")] static extern int RhWs_State(int id);
        [DllImport("__Internal")] static extern int RhWs_CloseCode(int id);
        [DllImport("__Internal")] static extern int RhWs_Send(int id, byte[] data, int len);
        [DllImport("__Internal")] static extern int RhWs_NextLength(int id);
        [DllImport("__Internal")] static extern int RhWs_Receive(int id, byte[] buf, int cap);
        [DllImport("__Internal")] static extern void RhWs_Close(int id);
        [DllImport("__Internal")] static extern void RhWs_Release(int id);
#else
        static int RhWs_Create(string url) { throw new NotSupportedException("WebGLTransport only works in a WebGL player; use NativeTransport in the Editor."); }
        static int RhWs_State(int id) { return 2; }
        static int RhWs_CloseCode(int id) { return 0; }
        static int RhWs_Send(int id, byte[] data, int len) { return 0; }
        static int RhWs_NextLength(int id) { return -1; }
        static int RhWs_Receive(int id, byte[] buf, int cap) { return -1; }
        static void RhWs_Close(int id) { }
        static void RhWs_Release(int id) { }
#endif

        public void Connect(string url)
        {
            Close();
            _id = RhWs_Create(url);
            _lastState = 0;
        }

        public void Send(byte[] frame) { if (_id != 0) RhWs_Send(_id, frame, frame.Length); }

        public void Close()
        {
            if (_id == 0) return;
            RhWs_Release(_id); // detaches the JS handlers: no late events from the old socket
            _id = 0;
            _lastState = 2;
        }

        public void Poll()
        {
            if (_id == 0) return;
            int id = _id, state = RhWs_State(id);
            if (_lastState == 0 && state >= 1) { _lastState = 1; if (Opened != null) Opened(); if (_id != id) return; }
            // Drain frames first so the last messages before a close are not lost.
            int n;
            while (_id == id && (n = RhWs_NextLength(id)) >= 0)
            {
                if (n > MaxFrame) { Close(); if (Closed != null) Closed("frame too large"); return; }
                if (n > _rx.Length) _rx = new byte[Math.Max(n, _rx.Length * 2)];
                int got = RhWs_Receive(id, _rx, _rx.Length);
                if (got < 0) break;
                var frame = new byte[got];
                Buffer.BlockCopy(_rx, 0, frame, 0, got);
                if (Received != null) Received(frame);
            }
            if (_id == id && state == 2 && _lastState != 2)
            {
                int code = RhWs_CloseCode(id);
                _lastState = 2;
                RhWs_Release(id); _id = 0;
                if (Closed != null) Closed("websocket closed (code " + code + ")");
            }
        }
    }
}

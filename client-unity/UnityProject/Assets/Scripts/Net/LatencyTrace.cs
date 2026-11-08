// Optional test observer. The browser harness enables it before loading Unity; ordinary players record nothing.
using System.Runtime.InteropServices;
using System;
#if UNITY_EDITOR
using System.Collections.Generic;
#endif
using UnityEngine;

namespace Roguehalla.Client
{
    public static class LatencyTrace
    {
#if UNITY_WEBGL && !UNITY_EDITOR
        [DllImport("__Internal")] static extern int RhLatency_Enabled();
        [DllImport("__Internal")] static extern int RhLatency_TakeTargetRequest();
        [DllImport("__Internal")] static extern void RhLatency_Mark(string kind, int frame, uint player, int moveSeq, double x, double y);
        [DllImport("__Internal")] static extern void RhLatency_WishPresented(string kind, int frame, uint caster, int ability, double sourceTime);
        public static bool Enabled { get { return RhLatency_Enabled() != 0; } }
        public static bool TakeTargetRequest() { return RhLatency_TakeTargetRequest() != 0; }
        public static void Mark(string kind, uint player, int moveSeq, double x, double y)
        {
            RhLatency_Mark(kind, Time.frameCount, player, moveSeq, x, y);
        }
#elif UNITY_EDITOR
        [Serializable]
        public struct EditorRecord
        {
            public string kind;
            public int frame;
            public uint player;
            public int moveSeq, ability;
            public double x, y, sourceTime, at;
            public bool hasSourceTime;
            public string wireBase64;
        }

        const int Limit = 20000;
        static List<EditorRecord> _editorEvents;
        static bool _editorEnabled, _editorTargets;
        public static bool EditorOverflow { get; private set; }
        public static bool Enabled { get { return _editorEnabled; } }
        public static void BeginEditor()
        {
            if (_editorEvents == null) _editorEvents = new List<EditorRecord>(Limit);
            _editorEvents.Clear();
            _editorTargets = false;
            EditorOverflow = false;
            _editorEnabled = true;
        }
        public static void EndEditor() { _editorEnabled = _editorTargets = false; }
        public static EditorRecord[] ReadEditor() { return _editorEvents == null ? Array.Empty<EditorRecord>() : _editorEvents.ToArray(); }
        public static void RequestEditorTargets() { if (_editorEnabled) _editorTargets = true; }
        public static bool TakeTargetRequest()
        {
            bool requested = _editorEnabled && _editorTargets;
            _editorTargets = false;
            return requested;
        }
        static void Append(EditorRecord value)
        {
            if (!_editorEnabled) return;
            if (_editorEvents.Count >= Limit) { EditorOverflow = true; return; }
            value.frame = Time.frameCount;
            value.at = Time.realtimeSinceStartupAsDouble * 1000.0;
            _editorEvents.Add(value);
        }
        public static void Mark(string kind, uint player, int moveSeq, double x, double y)
        {
            if (_editorEnabled) Append(new EditorRecord { kind = kind, player = player, moveSeq = moveSeq, x = x, y = y });
        }

        /// <summary>Records only an already encoded ClientMsg.Input frame at NativeTransport's queue boundary.</summary>
        public static void NativeInputQueued(byte[] frame)
        {
#if UNITY_EDITOR
            if (!_editorEnabled || frame == null || frame.Length == 0 || frame[0] != 0x02) return;
            try { Append(new EditorRecord { kind = "nativeInputQueued", wireBase64 = Convert.ToBase64String(frame) }); }
            catch { /* Optional diagnostics never interrupt the transport. */ }
#endif
        }

        /// <summary>Records only an already received server FX frame at NativeTransport's main-thread dispatch boundary.</summary>
        public static void NativeFxReceived(byte[] frame)
        {
#if UNITY_EDITOR
            if (!_editorEnabled || frame == null || frame.Length == 0 || frame[0] != 0x85) return;
            try { Append(new EditorRecord { kind = "nativeFxReceived", wireBase64 = Convert.ToBase64String(frame) }); }
            catch { /* Optional diagnostics never interrupt receive dispatch. */ }
#endif
        }
#else
        public static bool Enabled { get { return false; } }
        public static bool TakeTargetRequest() { return false; }
        public static void Mark(string kind, uint player, int moveSeq, double x, double y) { }
        public static void NativeInputQueued(byte[] frame) { }
        public static void NativeFxReceived(byte[] frame) { }
#endif

        /// <summary>Opt-in observation after a confirmed cue is applied by its presentation consumer, including a
        /// nonspatial termination. Keep each occurrence and its original source time; this does not drive rendering.</summary>
        public static void WishPresented(string kind, uint caster, int ability, double sourceTime)
        {
            if (!Enabled || (kind != "presentWishStarted" && kind != "presentWishLanded" && kind != "presentWishEnded")) return;
#if UNITY_WEBGL && !UNITY_EDITOR
            RhLatency_WishPresented(kind, Time.frameCount, caster, ability, sourceTime);
#elif UNITY_EDITOR
            Append(new EditorRecord { kind = kind, player = caster, ability = ability, sourceTime = sourceTime, hasSourceTime = true });
#endif
        }
    }
}

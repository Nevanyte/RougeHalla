// Dev flag ?inputlat=1: logs key-down to first local-position change and to first server-confirmed movement to the browser console.
// Off by default; costs one cached bool when off. Diagnostic only, no gameplay effect.
using UnityEngine;
using UnityEngine.InputSystem;
using Roguehalla.Net;

namespace Roguehalla.Client
{
    public static class InputLatencyProbe
    {
        static int _enabled = -1; // -1 unknown
        static readonly InputLatencyTracker Tracker = new InputLatencyTracker();
        static bool _held;

        public static bool Enabled
        {
            get
            {
                if (_enabled < 0)
                {
                    string url = Application.absoluteURL ?? "";
                    int q = url.IndexOf('?');
                    string search = q >= 0 ? url.Substring(q) : "";
                    int hash = search.IndexOf('#'); if (hash >= 0) search = search.Substring(0, hash);
                    _enabled = Bootstrap.Query(search, "inputlat", "0") == "1" ? 1 : 0;
                    if (_enabled == 1) Debug.Log("[inputlat] enabled: press a movement key from rest; each press logs key->frame, key->local, key->server (ms)");
                }
                return _enabled == 1;
            }
        }

        /// <summary>Call each frame before input is read, when <see cref="Enabled"/>.</summary>
        public static void BeginFrame(Keyboard kb, double nowMs, double localX, double localY, double serverX, double serverY)
        {
            if (kb == null) return;
            bool down = kb.wKey.isPressed || kb.aKey.isPressed || kb.sKey.isPressed || kb.dKey.isPressed ||
                kb.upArrowKey.isPressed || kb.downArrowKey.isPressed || kb.leftArrowKey.isPressed || kb.rightArrowKey.isPressed;
            if (down && !_held)
            {
                double eventMs = kb.lastUpdateTime * 1000.0;
                if (eventMs > nowMs || eventMs < nowMs - 250) eventMs = nowMs; // other timebase or a stale device stamp: use the frame
                Tracker.KeyDown(eventMs, nowMs, localX, localY, serverX, serverY);
            }
            _held = down;
        }

        /// <summary>Call each frame after the frame is presented, when <see cref="Enabled"/>.</summary>
        public static void EndFrame(double nowMs, double localX, double localY, double serverX, double serverY)
        {
            string line = Tracker.Update(nowMs, localX, localY, serverX, serverY);
            if (line == null) return;
            Debug.Log(line);
            if (Tracker.Samples % 10 == 0) Debug.Log(Tracker.Summary());
        }
    }
}

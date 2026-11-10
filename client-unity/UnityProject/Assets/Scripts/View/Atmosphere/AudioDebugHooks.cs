using System;
using System.Globalization;
using Roguehalla.Net;
using UnityEngine;

namespace Roguehalla.Client
{
    /// <summary>
    /// Browser-probe entry points, created only when the page URL has <c>?audiolog=1</c>. The probe calls them with
    /// <c>unityInstance.SendMessage("RhAudioDebug", method, text)</c>. They use the same settings and playback paths as the game
    /// (the volume methods are exactly what the settings sliders call); nothing here is reachable in a normal session.
    /// </summary>
    public sealed class AudioDebugHooks : MonoBehaviour
    {
        RegionAtmosphere _atmos;
        public static void Create(RegionAtmosphere atmos)
        {
            if (!AudioDiag.Logging) return;
            var go = new GameObject("RhAudioDebug"); go.transform.SetParent(atmos.transform, false);
            go.AddComponent<AudioDebugHooks>()._atmos = atmos;
            AudioDiag.Line("debug hooks ready");
        }

        static float F(string s) { float v; return float.TryParse(s, NumberStyles.Float, CultureInfo.InvariantCulture, out v) ? v : 0f; }
        public void SetMusicVolume(string v) { var s = ShowcaseSettings.Current; if (s != null) s.SetMusicVolume(F(v)); AudioDiag.Line("set music volume " + v); }
        public void SetAmbienceVolume(string v) { var s = ShowcaseSettings.Current; if (s != null) s.SetAmbienceVolume(F(v)); AudioDiag.Line("set ambience volume " + v); }
        public void SetSfxVolume(string v) { var s = ShowcaseSettings.Current; if (s != null) s.SetSfxVolume(F(v)); AudioDiag.Line("set sfx volume " + v); }
        /// <summary>"music_fire,amb_fire" (either may be empty) plays exactly those beds; "release" returns to the region.</summary>
        public void Force(string spec)
        {
            var a = _atmos != null ? _atmos.Audio : null; if (a == null) return;
            if (spec == "release") { a.ReleaseForced(); return; }
            var parts = (spec ?? "").Split(','); a.Force(parts.Length > 0 && parts[0].Length > 0 ? parts[0] : null, parts.Length > 1 && parts[1].Length > 0 ? parts[1] : null);
        }
        public void Isolate(string on) { AudioDiag.Isolate = on == "1"; AudioDiag.Line("isolate " + on); }
        public void SeekEnd(string seconds) { var a = _atmos != null ? _atmos.Audio : null; if (a != null) a.SeekEnd(F(seconds)); }
        /// <summary>"Snow,0.8" plays that footstep clip once at that gain.</summary>
        public void Step(string spec)
        {
            var parts = (spec ?? "").Split(','); StepSound sound; if (!Enum.TryParse(parts[0], true, out sound)) return;
            SurfaceFx.AuditionLive(sound, parts.Length > 1 ? F(parts[1]) : 1f);
        }
        /// <summary>"Stone,Player,3": the step as heard from that kind of actor (Local, Player or Mob) that many tiles away, with the game's own voicing (gain).</summary>
        public void StepAs(string spec)
        {
            var parts = (spec ?? "").Split(','); StepSound sound; if (parts.Length < 3 || !Enum.TryParse(parts[0], true, out sound)) return;
            bool local = parts[1] == "Local", mob = parts[1] == "Mob";
            if (FootstepVoicing.Plan(local, mob, local ? 0f : F(parts[2]), 0f, out float gain, out _)) { AudioDiag.Line("voicing " + parts[1] + " dist=" + parts[2] + " gain=" + gain.ToString("0.000")); SurfaceFx.AuditionLive(sound, gain); }
        }
    }
}

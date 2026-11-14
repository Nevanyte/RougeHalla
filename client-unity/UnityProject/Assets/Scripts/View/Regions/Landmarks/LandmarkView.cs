using System;
using System.Collections.Generic;
using UnityEngine;
using Roguehalla.Net.Protocol;
using Roguehalla.Net.Ui;

namespace Roguehalla.Client
{
    /// <summary>
    /// P-UNITY-LANDMARK-1: builds each anchor's landmark art once per map from the anchor and the delivered tiles in its footprint,
    /// and fades the roof while an actor the client may see (C-OBS: ArenaView passes only those) stands on an interior tile.
    /// </summary>
    public sealed class LandmarkView : IDisposable
    {
        /// <summary>Roof alpha with nobody inside, and while an actor is inside (reached at LandmarkView's fade rate, PropFade.FadeRate).</summary>
        public const float RoofOpaqueAlpha = 1f, RoofFadedAlpha = .1f;
        /// <summary>STUB (P-UNITY-LANDMARK-ROOF-RETURN-1): roof alpha while only another actor, not the local player, is inside.</summary>
        public const float RoofPeekAlpha = .5f;

        readonly List<Landmark> _landmarks = new List<Landmark>();

        /// <summary>Landmarks built (anchors whose kind has art registered).</summary>
        public int Count { get { return _landmarks.Count; } }
        public Landmark Get(int index) { return _landmarks[index]; }

        /// <summary>Builds from map.Anchors under <paramref name="parent"/>. A map without anchors builds nothing.</summary>
        public static LandmarkView Build(Transform parent, MapBlob map) { return Build(parent, map, map.Anchors); }

        /// <summary>As <see cref="Build(Transform, MapBlob)"/> with the anchors given. An unknown kind code logs
        /// "LandmarkView: unknown kind N", a known kind without art "LandmarkView: no art for kind N"; each once per build, and
        /// draws nothing.</summary>
        public static LandmarkView Build(Transform parent, MapBlob map, MapAnchor[] anchors)
        {
            var view = new LandmarkView();
            if (anchors == null || anchors.Length == 0) return view;
            HashSet<byte> told = null, failed = null;
            foreach (var anchor in anchors)
            {
                if (!LandmarkArts.TryGet(anchor.Kind, out var art))
                {
                    if (told == null) told = new HashSet<byte>();
                    if (told.Add(anchor.Kind))
                        Debug.LogWarning(LandmarkArts.IsKnownKind(anchor.Kind) ? "LandmarkView: no art for kind " + anchor.Kind : "LandmarkView: unknown kind " + anchor.Kind);
                    continue;
                }
                var lm = Landmark.Create(parent, map, anchor);
                if (lm == null) continue;
                try { art(lm); }
                catch (Exception e)
                {
                    lm.Dispose();
                    if (failed == null) failed = new HashSet<byte>();
                    if (failed.Add(anchor.Kind)) Debug.LogWarning("LandmarkView: art for kind " + anchor.Kind + " failed: " + e.GetType().Name + ": " + e.Message);
                    continue;
                }
                view._landmarks.Add(lm);
            }
            return view;
        }

        /// <summary>Call once per frame for each actor drawn (the same callers as RegionProps.NoteActor); feet in world space.</summary>
        public void NoteActor(Vector3 feet)
        {
            if (_landmarks.Count == 0) return;
            int tx = Mathf.FloorToInt(feet.x), ty = Mathf.FloorToInt(-feet.y / ArenaView.GroundSquash);
            for (int i = 0; i < _landmarks.Count; i++)
                if (_landmarks[i].Fades(tx, ty)) _landmarks[i].ActorInside = true;
        }

        /// <summary>STUB (P-UNITY-LANDMARK-ROOF-RETURN-1): a delivered actor other than the local player; feet in world space. `NoteActor` stays the
        /// local player's (fully fading) note. The stub behaves like NoteActor; the implementation makes the roof peek (RoofPeekAlpha).</summary>
        public void NoteOtherActor(Vector3 feet) { NoteActor(feet); }

        /// <summary>Moves each roof toward its target (faded when an actor was noted inside since the last Tick, else opaque), then
        /// forgets the notes. No allocation.</summary>
        public void Tick(float dt)
        {
            for (int i = 0; i < _landmarks.Count; i++)
            {
                var lm = _landmarks[i];
                float target = lm.ActorInside ? RoofFadedAlpha : RoofOpaqueAlpha;
                lm.ActorInside = false;
                lm.SetRoofAlpha(Mathf.MoveTowards(lm.RoofAlpha, target, PropFade.FadeRate * dt));
            }
        }

        public void Dispose()
        {
            foreach (var lm in _landmarks) lm.Dispose();
            _landmarks.Clear();
        }
    }
}

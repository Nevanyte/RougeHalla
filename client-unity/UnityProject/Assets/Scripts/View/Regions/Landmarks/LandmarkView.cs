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
        /// <summary>A delivered actor other than the local player; feet in world space. The roof peeks (RoofPeekAlpha) unless the local player is inside too.</summary>
        public void NoteOtherActor(Vector3 feet)
        {
            if (_landmarks.Count == 0) return;
            int tx = Mathf.FloorToInt(feet.x), ty = Mathf.FloorToInt(-feet.y / ArenaView.GroundSquash);
            for (int i = 0; i < _landmarks.Count; i++)
                if (_landmarks[i].Fades(tx, ty)) _landmarks[i].OtherInside = true;
        }

        /// <summary>Moves each roof toward its target (faded when an actor was noted inside since the last Tick, else opaque), then
        /// forgets the notes. No allocation.</summary>
        public void Tick(float dt)
        {
            for (int i = 0; i < _landmarks.Count; i++)
            {
                var lm = _landmarks[i];
                float target = lm.ActorInside ? RoofFadedAlpha : lm.OtherInside ? RoofPeekAlpha : RoofOpaqueAlpha;
                lm.ActorInside = false; lm.OtherInside = false;
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

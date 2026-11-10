using System.Collections.Generic;
using UnityEngine;
using Roguehalla.Net;
using Roguehalla.Net.Protocol;

namespace Roguehalla.Client
{
    /// <summary>
    /// Graceful entry and exit for observed actors (vision). An actor that stops being delivered while alive in a running match does
    /// not pop: its art is detached from the live set (so every query, cue and sound treats it as gone) and left where it was last
    /// drawn, frozen, while it fades out together with its health bar, markers, shadow and footprint. It never moves or extrapolates, so it
    /// cannot show where the actor went. Died, left-the-match and timeline cuts keep their own presentations (see <see cref="VisionFade"/>).
    /// A newly delivered actor fades in quickly. The rules and curves are in Roguehalla.Net (tested); this file only applies them.
    /// </summary>
    public sealed partial class SpriteActorPresenter
    {
        sealed class ActorFadeSlot
        {
            public uint Id;
            public bool Local;
            public ActorStatus Status;
            public ActorKind Kind;
            public bool Entering, Exiting;
            public float EnterAt, EnterFrom, ExitAt, ExitFrom;
            public float Opacity = 1f;
            public Color[] Base = new Color[0], Applied = new Color[0];
            public int Count;

            public void Note(uint id, bool local, ActorStatus status, ActorKind kind) { Id = id; Local = local; Status = status; Kind = kind; }
        }

        static readonly List<SpriteRenderer> Gather = new List<SpriteRenderer>(64);
        readonly List<Art> _ghosts = new List<Art>(8);
        readonly RecentDeaths _deaths = new RecentDeaths(32);

        /// <summary>Time source of the fades (seconds); tests replace it to step time deterministically.</summary>
        public static System.Func<float> FadeClock;
        static float Now() { return FadeClock != null ? FadeClock() : Time.unscaledTime; }

        /// <summary>True while a running match lets a departing actor fade (set by ArenaView each frame). Off in lobby, planning, after the end.</summary>
        public bool ExitFadesAllowed { get; set; }
        /// <summary>Ids in the newest delivered observation. An actor still in it is never treated as departed (an interpolation gap).</summary>
        public HashSet<uint> Delivered { get; set; }
        /// <summary>Live fades, for diagnostics.</summary>
        /// <summary>Raised with the tile an actor was last drawn on when it stops being delivered (diagnostics: sight agreement).</summary>
        public System.Action<float, float> OnDeparted;
        /// <summary>Raised with the tile of a newly shown remote actor (diagnostics).</summary>
        public System.Action<float, float> OnArrived;
        public int GhostCount { get { return _ghosts.Count; } }

        /// <summary>A Death event named this actor: it died, it did not walk out of sight. Cancels a fade already under way.</summary>
        public void NoteDeath(uint id)
        {
            _deaths.Note(id, Now());
            for (int i = _ghosts.Count - 1; i >= 0; i--)
                if (_ghosts[i].Fade.Id == id) ReleaseGhostAt(i);
        }

        /// <summary>A timeline cut (welcome, resume, clock epoch): the old view is void, so nothing keeps fading.</summary>
        public void CancelFades()
        {
            for (int i = _ghosts.Count - 1; i >= 0; i--) ReleaseGhostAt(i);
            _deaths.Clear();
            foreach (var pair in _active) { var f = pair.Value.Fade; if (f.Entering) { f.Entering = false; Apply(pair.Value, 1f); } }
        }

        /// <summary>Called when the actor's art is first shown for an id (a new Art or one from the pool).</summary>
        void BeginEnter(Art a, bool local, ActorKind kind)
        {
            var f = a.Fade;
            f.Exiting = false; f.Opacity = 1f; f.Count = 0;
            // Only players fade. The server renews the observer handle of a creature on (almost) every observation, so a creature that
            // "arrives" or "departs" is usually the same creature under a new id; fading those would flicker every mob (and the client
            // is told never to infer continuity from position). Creatures keep the plain show and hide.
            f.Entering = !local && kind == ActorKind.Player; f.EnterAt = Now(); f.EnterFrom = 0f;
            if (f.Entering && OnArrived != null) OnArrived(a.LastPosition.x, -a.LastPosition.y / ArenaView.GroundSquash);
        }

        /// <summary>Evict hook: a living actor that dropped out of the observation of a running match becomes a fading ghost.</summary>
        bool TryBeginExit(uint id, Art art)
        {
            var f = art.Fade;
            if (!ExitFadesAllowed || f.Local || f.Kind != ActorKind.Player) return false;
            if (Delivered != null && Delivered.Contains(id)) return false;
            if (VisionFade.Classify(f.Status, _deaths.Contains(id, Now()), true, false) != DepartureCause.LeftSight) return false;
            if (OnDeparted != null) { var p = art.Root.transform.position; OnDeparted(p.x, -p.y / ArenaView.GroundSquash); }
            _active.Remove(id);
            art.Light.SetVisible(false);
            f.Entering = false; f.Exiting = true; f.ExitAt = Now(); f.ExitFrom = f.Opacity;
            _ghosts.Add(art);
            return true;
        }

        /// <summary>Advances every fade to now. Cheap and idempotent within a frame; ArenaView calls it after each presentation pass.</summary>
        public void StepFades()
        {
            float now = Now();
            for (int i = _ghosts.Count - 1; i >= 0; i--)
            {
                var art = _ghosts[i]; var f = art.Fade;
                float alpha = VisionFade.ExitAlpha(now - f.ExitAt, f.ExitFrom);
                if (alpha <= 0.002f) { ReleaseGhostAt(i); continue; }
                Apply(art, alpha);
            }
            foreach (var pair in _active)
            {
                var art = pair.Value; var f = art.Fade;
                if (!f.Entering) continue;
                float alpha = VisionFade.EnterAlpha(now - f.EnterAt, f.EnterFrom);
                if (alpha >= 0.999f) { f.Entering = false; Apply(art, 1f); }
                else Apply(art, alpha);
            }
        }

        void ReleaseGhostAt(int index)
        {
            var art = _ghosts[index];
            _ghosts.RemoveAt(index);
            Apply(art, 1f); // restore the colours the pool will hand to the next actor
            art.Fade.Exiting = false;
            Release(art);
        }

        /// <summary>
        /// Multiplies the alpha of every renderer of the actor by <paramref name="alpha"/>. Present rewrites some colours each frame and
        /// never touches others, so each renderer's undimmed colour is tracked: a colour that is not the one written last time was
        /// set by Present and becomes the new base.
        /// </summary>
        void Apply(Art art, float alpha)
        {
            var f = art.Fade;
            Gather.Clear();
            art.Root.GetComponentsInChildren(true, Gather);
            int n = Gather.Count;
            if (n != f.Count || f.Base.Length < n)
            {
                if (f.Base.Length < n) { f.Base = new Color[n]; f.Applied = new Color[n]; }
                for (int i = 0; i < n; i++) f.Applied[i] = f.Base[i] = Gather[i].color;
                f.Count = n;
            }
            for (int i = 0; i < n; i++)
            {
                var r = Gather[i];
                Color cur = r.color;
                if (cur != f.Applied[i]) f.Base[i] = cur;
                Color c = f.Base[i]; c.a *= alpha;
                r.color = c; f.Applied[i] = c;
            }
            f.Opacity = alpha;
            Gather.Clear();
        }

        /// <summary>
        /// Writes one clearing per presented actor (live or fading) for the fog layer: tile units, strength = the actor's opacity, so a
        /// fading actor keeps its surroundings clear only as long as it is visible. Returns the count written.
        /// </summary>
        public int CollectClearings(FogClearing[] output)
        {
            int n = 0;
            foreach (var pair in _active)
            {
                if (n == output.Length) return n;
                var art = pair.Value;
                var p = art.Root.transform.position;
                output[n++] = new FogClearing(p.x, -p.y / ArenaView.GroundSquash, art.Fade.Opacity);
            }
            for (int i = 0; i < _ghosts.Count && n < output.Length; i++)
            {
                var art = _ghosts[i];
                var p = art.Root.transform.position;
                output[n++] = new FogClearing(p.x, -p.y / ArenaView.GroundSquash, art.Fade.Opacity);
            }
            return n;
        }
    }
}

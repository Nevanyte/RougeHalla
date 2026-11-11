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
        /// <summary>
        /// Creature art creates, continuations and destroys (diagnostics, printed once a second with <c>?mob.audit=1</c>). A create is a
        /// creature shown with fresh art, a continue is a renewed handle that took over departed art, a destroy is creature art released.
        /// <c>?mob.continuity=0</c> restores the old behaviour (creatures pop in and out) so the two can be measured against each other.
        /// </summary>
        public static readonly MobContinuity.Counters MobArt = new MobContinuity.Counters();
        static bool? _continuity;
        /// <summary>False only with <c>?mob.continuity=0</c> in the page URL (the measurement baseline).</summary>
        public static bool ContinuityEnabled
        {
            get { if (!_continuity.HasValue) { string u = Application.absoluteURL ?? ""; _continuity = !u.Contains("mob.continuity=0"); } return _continuity.Value; }
            set { _continuity = value; }
        }
        static bool Fades(ActorKind kind) { return kind == ActorKind.Player || (ContinuityEnabled && (kind == ActorKind.RegionalMob || kind == ActorKind.Zombie)); }
        static bool IsCreature(ActorKind kind) { return kind == ActorKind.RegionalMob || kind == ActorKind.Zombie; }
        MobCandidate[] _candidates = new MobCandidate[16];
        static float _auditAt; static int _auditCreated, _auditDestroyed, _auditContinued;

        static MobLook LookOf(ActorKind kind, FactionId? faction, MobTypeId? mob, string archetypeKey)
        { return new MobLook((byte)kind, mob.HasValue ? (int)mob.Value : -1, faction.HasValue ? (int)faction.Value : -1, archetypeKey); }

        /// <summary>
        /// A creature id with no art: if a departed creature of the same look was drawn within two tiles under 0.6 s ago, the handle was
        /// renewed and the art (and its animation) carries over; otherwise this is a real arrival. See <see cref="MobContinuity"/>.
        /// </summary>
        bool TryContinue(uint id, ActorKind kind, FactionId? faction, MobTypeId? mob, string archetypeKey, float x, float y, out Art art)
        {
            art = null;
            if (!ContinuityEnabled || _ghosts.Count == 0) return false;
            var look = LookOf(kind, faction, mob, archetypeKey);
            int n = 0;
            if (_candidates.Length < _ghosts.Count) System.Array.Resize(ref _candidates, _ghosts.Count * 2);
            for (int i = 0; i < _ghosts.Count; i++)
            {
                var g = _ghosts[i];
                if (!IsCreature(g.Fade.Kind)) continue;
                var p = g.LastPosition;
                _candidates[n++] = new MobCandidate { Handle = i, Look = g.Look, X = p.x / ArenaView.Scale, Y = -p.y / (ArenaView.Scale * ArenaView.GroundSquash), SeenAt = g.Fade.ExitAt };
            }
            int pick = MobContinuity.Pick(_candidates, n, look, x, y, Now());
            if (pick < 0) return false;
            int index = _candidates[pick].Handle;
            art = _ghosts[index]; _ghosts.RemoveAt(index);
            var f = art.Fade; float alpha = f.Opacity;
            f.Exiting = false;
            if (alpha < .999f) { f.Entering = true; f.EnterFrom = 0f; f.EnterAt = Now() - VisionFade.EnterElapsedFor(alpha); }
            else { f.Entering = false; Apply(art, 1f); }
            MobArt.Continued++;
            return true;
        }

        void AuditTick()
        {
            if (!(Application.absoluteURL ?? "").Contains("mob.audit=1")) return;
            float now = Time.unscaledTime;
            if (now - _auditAt < 1f) return;
            if (_auditAt > 0f) Debug.Log("[mob.audit] t=" + now.ToString("F1") + " continuity=" + (ContinuityEnabled ? 1 : 0) + " created/s=" + (MobArt.Created - _auditCreated) + " destroyed/s=" + (MobArt.Destroyed - _auditDestroyed) + " continued/s=" + (MobArt.Continued - _auditContinued) + " creatures=" + CreatureCount() + " totals c/d/k=" + MobArt.Created + "/" + MobArt.Destroyed + "/" + MobArt.Continued);
            _auditAt = now; _auditCreated = MobArt.Created; _auditDestroyed = MobArt.Destroyed; _auditContinued = MobArt.Continued;
        }
        int CreatureCount() { int n = 0; foreach (var pair in _active) if (IsCreature(pair.Value.Fade.Kind)) n++; return n; }

        /// <summary>Raised with the tile an actor was last drawn on when it stops being delivered (diagnostics: sight agreement).</summary>
        public System.Action<float, float> OnDeparted;
        /// <summary>Raised with the tile of a newly shown remote actor (diagnostics).</summary>
        public System.Action<float, float> OnArrived;
        public int GhostCount { get { return _ghosts.Count; } }
        /// <summary>Test seam: the clock time (Time.unscaledTime) the actor's death clip started, false when it is not shown dead.</summary>
        public bool TryDeathStart(uint id, out float at) { at = 0f; if (!_active.TryGetValue(id, out var a) || !a.Dead) return false; at = a.DeadAt; return true; }
        /// <summary>Test seam: the opacity last applied to the actor's art (1 = fully visible), false when the id has no art.</summary>
        public bool TryOpacity(uint id, out float opacity) { opacity = 0f; if (!_active.TryGetValue(id, out var a)) return false; opacity = a.Fade.Opacity; return true; }

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
            // The server renews the observer handle of a creature on (almost) every observation, so a creature that "arrives" or "departs"
            // is usually the same creature under a new id. Present first tries to continue departed art (TryContinue); only a creature that
            // truly arrives gets here, and it fades in like a player. With ?mob.continuity=0 creatures keep the old plain show and hide.
            f.Entering = !local && Fades(kind); f.EnterAt = Now(); f.EnterFrom = 0f;
            if (f.Entering && kind == ActorKind.Player && OnArrived != null) OnArrived(a.LastPosition.x, -a.LastPosition.y / ArenaView.GroundSquash);
        }

        /// <summary>Evict hook: a living actor that dropped out of the observation of a running match becomes a fading ghost.</summary>
        bool TryBeginExit(uint id, Art art)
        {
            var f = art.Fade;
            if (!ExitFadesAllowed || f.Local || !Fades(f.Kind)) return false;
            if (Delivered != null && Delivered.Contains(id)) return false;
            if (VisionFade.Classify(f.Status, _deaths.Contains(id, Now()), true, false) != DepartureCause.LeftSight) return false;
            if (OnDeparted != null && f.Kind == ActorKind.Player) { var p = art.Root.transform.position; OnDeparted(p.x, -p.y / ArenaView.GroundSquash); }
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
            AuditTick();
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
            art.Ind?.ApplyOpacity(alpha);
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

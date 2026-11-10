using System.Collections.Generic;
using Roguehalla.Net;
using Roguehalla.Net.Protocol;
using UnityEngine;

namespace Roguehalla.Client
{
    /// <summary>Bounded, owned copies of confirmed spatial cues. No targeting or gameplay decisions.</summary>
    public sealed class ConfirmedWishPresenter
    {
        const int Capacity = 64;
        const double LandingLifetimeMs = 500;
        struct Fact
        {
            public FxKind Kind;
            public byte Ability, Reason;
            public double EventTime, Duration;
            public uint? Caster, Target;
            public bool HasAnchor, HasDestination;
            public float X, Y, X2, Y2;
        }
        sealed class Cue
        {
            public Fact Fact;
            public GameObject Root;
            public SpriteRenderer[] Parts;
            public bool Presented;
        }
        readonly Transform _parent;
        readonly SpriteActorPresenter _actors;
        readonly List<Cue> _active = new List<Cue>(Capacity);
        readonly Stack<Cue> _pool = new Stack<Cue>(Capacity);
        static readonly string[] Glyphs = { "sigil3", "sigil2", "sigil1", "spark", "sigil4" };
        static readonly int[] Factions = { 3, 2, 1, 0, 4 };
        // One provisional own telegraph, shown at the Wish press until any server Wish cue for that caster arrives (the
        // confirmed cue then takes over) or its hold expires. Owned separately from the confirmed pool; no rule here.
        const float ProvisionalAlpha = .55f;
        Cue _provisional;
        bool _provisionalLive;
        uint _provisionalCaster;
        double _provisionalUntil;

        public ConfirmedWishPresenter(Transform parent, SpriteActorPresenter actors) { _parent = parent; _actors = actors; }
        public int ActiveCount { get { return _active.Count; } }

        /// <summary>
        /// Shows the own Wish telegraph at the press (local time), for at most <paramref name="holdMs"/>. Any server Wish cue
        /// for <paramref name="caster"/> replaces it; without one it disappears when the hold ends.
        /// </summary>
        public void Provisional(uint caster, byte ability, double holdMs)
        {
            if (caster == 0 || ability > 4 || !Finite(holdMs) || holdMs <= 0) return;
            if (_provisional == null) _provisional = Create();
            _provisional.Fact = new Fact { Kind = FxKind.WishStarted, Ability = ability, Caster = caster };
            _provisionalCaster = caster;
            _provisionalUntil = Time.realtimeSinceStartupAsDouble * 1000.0 + holdMs;
            _provisionalLive = true;
            _provisional.Root.SetActive(false);
        }
        public void CancelProvisional()
        {
            _provisionalLive = false;
            if (_provisional == null) return;
            _provisional.Root.SetActive(false);
            foreach (var part in _provisional.Parts) part.enabled = false;
        }

        public void Accept(WireFx source)
        {
            // Any server Wish cue for the provisional caster confirms or refuses the press: the server's cue wins.
            if (_provisionalLive && source != null && source.Caster.HasValue && source.Caster.Value == _provisionalCaster &&
                (source.Kind == FxKind.WishStarted || source.Kind == FxKind.WishLanded || source.Kind == FxKind.WishEnded))
                CancelProvisional();
            if (source == null || source.Ability > 4 || !Finite(source.EventTime) || source.EventTime < 0) return;
            if (source.Kind != FxKind.WishStarted && source.Kind != FxKind.WishLanded && source.Kind != FxKind.WishEnded) return;
            // The decoded record and its container may be recycled immediately after this callback.
            var fact = new Fact {
                Kind = source.Kind, Ability = source.Ability, Reason = source.Reason,
                EventTime = source.EventTime, Duration = source.Duration,
                Caster = source.Caster, Target = source.Target,
                HasAnchor = source.HasAnchor, HasDestination = source.HasDestination,
                X = source.AnchorX, Y = source.AnchorY, X2 = source.DestinationX, Y2 = source.DestinationY
            };
            if (fact.Kind != FxKind.WishStarted && fact.Caster.HasValue)
            {
                // Process every occurrence in arrival order. A terminal clears preceding starts,
                // not a later start in the same wake, and never deduplicates spatial landings.
                for (int i = _active.Count - 1; i >= 0; i--)
                {
                    var prior = _active[i].Fact;
                    if (prior.Kind == FxKind.WishStarted && prior.Caster == fact.Caster && prior.Ability == fact.Ability && prior.EventTime <= fact.EventTime)
                        Recycle(i);
                }
            }
            if (fact.Kind == FxKind.WishEnded)
            {
                if (fact.Caster.HasValue) LatencyTrace.WishPresented("presentWishEnded", fact.Caster.Value, fact.Ability, fact.EventTime);
                return;
            }
            if (fact.Kind == FxKind.WishStarted)
            {
                if (!fact.Caster.HasValue || !Finite(fact.Duration) || fact.Duration <= 0) return;
            }
            else
            {
                // Nonspatial visible-caster metadata legitimately terminates a telegraph.
                // There is never an actor-position or one-ended fallback for a landing.
                if (!fact.HasAnchor)
                {
                    if (fact.Caster.HasValue && !fact.HasDestination)
                        LatencyTrace.WishPresented("presentWishLanded", fact.Caster.Value, fact.Ability, fact.EventTime);
                    return;
                }
                if (fact.Ability == (byte)AbilityId.Blaze && !fact.HasDestination) return;
                if (fact.Ability != (byte)AbilityId.Blaze && fact.HasDestination) return;
                fact.Duration = LandingLifetimeMs;
            }
            if (_active.Count == Capacity) Recycle(0); // bounded cosmetic budget; terminals were already applied
            var cue = _pool.Count > 0 ? _pool.Pop() : Create();
            cue.Fact = fact;
            cue.Presented = false;
            cue.Root.SetActive(false);
            _active.Add(cue);
        }

        public void Retain(HashSet<uint> membership)
        {
            if (_provisionalLive && !membership.Contains(_provisionalCaster)) CancelProvisional();
            for (int i = _active.Count - 1; i >= 0; i--)
                if (_active[i].Fact.Kind == FxKind.WishStarted && (!_active[i].Fact.Caster.HasValue || !membership.Contains(_active[i].Fact.Caster.Value))) Recycle(i);
        }

        public void Tick(double serverTimeMs)
        {
            bool reduced = ShowcaseSettings.Current != null && ShowcaseSettings.Current.ReducedMotion;
            TickProvisional(reduced);
            if (!Finite(serverTimeMs) || serverTimeMs < 0) return;
            for (int i = 0; i < _active.Count;)
            {
                var cue = _active[i]; var fact = cue.Fact;
                double age = serverTimeMs - fact.EventTime;
                if (age >= fact.Duration || (fact.Kind == FxKind.WishStarted && (!_actors.IsLiving(fact.Caster.Value)))) { Recycle(i); continue; }
                cue.Root.SetActive(age >= 0);
                if (age < 0) { i++; continue; }
                Vector3 point;
                if (fact.HasAnchor) point = ArenaView.WorldPoint(fact.X, fact.Y);
                else if (!_actors.TryPosition(fact.Caster.Value, out point)) { Recycle(i); continue; }
                Draw(cue, point, Mathf.Clamp01((float)(age / fact.Duration)), reduced);
                if (!cue.Presented)
                {
                    LatencyTrace.WishPresented(fact.Kind == FxKind.WishStarted ? "presentWishStarted" : "presentWishLanded",
                        fact.Caster ?? 0, fact.Ability, fact.EventTime);
                    cue.Presented = true;
                }
                i++;
            }
        }

        public void Reset()
        {
            CancelProvisional();
            for (int i = _active.Count - 1; i >= 0; i--) Recycle(i);
        }

        void TickProvisional(bool reduced)
        {
            if (!_provisionalLive) return;
            if (Time.realtimeSinceStartupAsDouble * 1000.0 > _provisionalUntil || !_actors.IsLiving(_provisionalCaster) ||
                !_actors.TryPosition(_provisionalCaster, out var point)) { CancelProvisional(); return; }
            _provisional.Root.SetActive(true);
            Draw(_provisional, point, 0, reduced);
            foreach (var part in _provisional.Parts)
                if (part.enabled) { var c = part.color; c.a = ProvisionalAlpha; part.color = c; }
        }

        void Draw(Cue cue, Vector3 point, float progress, bool reduced)
        {
            foreach (var part in cue.Parts) part.enabled = false;
            var fact = cue.Fact;
            Color color = ShowcasePalette.Faction(Factions[fact.Ability]);
            color.a = fact.Kind == FxKind.WishStarted ? .8f : 1 - progress * .65f;
            if (fact.Kind == FxKind.WishLanded && fact.Ability == (byte)AbilityId.Blaze)
            {
                Vector3 destination = ArenaView.WorldPoint(fact.X2, fact.Y2), delta = destination - point;
                Part(cue, 0, "spark", point, new Vector2(.55f, .55f), color);
                Part(cue, 1, "spark", destination, new Vector2(.55f, .55f), color);
                if (delta.sqrMagnitude > 0)
                    Part(cue, 2, "bar", (point + destination) / 2, new Vector2(delta.magnitude, .065f), color,
                        Mathf.Atan2(delta.y, delta.x) * Mathf.Rad2Deg);
                return;
            }
            float growth = reduced ? 1 : fact.Kind == FxKind.WishStarted ? 1 + .08f * Mathf.Sin(progress * Mathf.PI) : 1 + progress * .3f;
            Part(cue, 0, Glyphs[fact.Ability], point + new Vector3(0, .08f), Vector2.one * .6f, color);
            Part(cue, 1, "ring", point, new Vector2(.95f, .95f * ArenaView.GroundSquash) * growth, color);
            if (fact.Ability == (byte)AbilityId.Swarm)
            {
                Part(cue, 2, "spark", point + new Vector3(-.4f, .15f), new Vector2(.15f, .2f), color);
                Part(cue, 3, "spark", point + new Vector3(.4f, .15f), new Vector2(.15f, .2f), color);
                Part(cue, 4, "spark", point + new Vector3(0, .45f), new Vector2(.15f, .2f), color);
            }
            else if (fact.Ability == (byte)AbilityId.Trial)
            {
                Part(cue, 2, "bar", point + new Vector3(-.35f, .1f), new Vector2(.055f, .6f), color);
                Part(cue, 3, "bar", point + new Vector3(.35f, .1f), new Vector2(.055f, .6f), color);
                Part(cue, 4, "bar", point + new Vector3(0, .38f), new Vector2(.75f, .055f), color);
            }
            else if (fact.Ability == (byte)AbilityId.LastStand)
            {
                Part(cue, 2, "spark", point + new Vector3(-.45f, .05f), new Vector2(.18f, .18f), color);
                Part(cue, 3, "spark", point + new Vector3(.45f, .05f), new Vector2(.18f, .18f), color);
                Part(cue, 4, "spark", point + new Vector3(0, .5f), new Vector2(.18f, .18f), color);
            }
        }

        void Part(Cue cue, int index, string sprite, Vector3 point, Vector2 scale, Color color, float rotation = 0)
        {
            var part = cue.Parts[index];
            part.enabled = true; part.sprite = ShowcaseSprites.Get(sprite); part.color = color;
            part.sharedMaterial = ShowcaseSprites.Unlit;
            part.transform.position = point; part.transform.localScale = new Vector3(scale.x, scale.y, 1);
            part.transform.rotation = Quaternion.Euler(0, 0, rotation);
        }
        Cue Create()
        {
            var root = new GameObject("Confirmed Wish artwork"); root.transform.SetParent(_parent, false);
            var cue = new Cue { Root = root, Parts = new SpriteRenderer[5] };
            for (int i = 0; i < cue.Parts.Length; i++) cue.Parts[i] = ShowcaseSprites.Create(root.transform,
                "Confirmed Wish shape " + i, "ring", 30010 + i, Color.white, Vector2.one, Vector3.zero, false);
            return cue;
        }
        void Recycle(int index)
        {
            var cue = _active[index]; cue.Root.SetActive(false);
            foreach (var part in cue.Parts) part.enabled = false;
            _active.RemoveAt(index); _pool.Push(cue);
        }
        static bool Finite(double value) { return !double.IsNaN(value) && !double.IsInfinity(value); }
    }
}

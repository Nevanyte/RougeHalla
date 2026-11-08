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
        }
        readonly Transform _parent;
        readonly SpriteActorPresenter _actors;
        readonly List<Cue> _active = new List<Cue>(Capacity);
        readonly Stack<Cue> _pool = new Stack<Cue>(Capacity);
        static readonly string[] Glyphs = { "sigil3", "sigil2", "sigil1", "spark", "sigil4" };
        static readonly int[] Factions = { 3, 2, 1, 0, 4 };

        public ConfirmedWishPresenter(Transform parent, SpriteActorPresenter actors) { _parent = parent; _actors = actors; }
        public int ActiveCount { get { return _active.Count; } }

        public void Accept(WireFx source)
        {
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
            if (fact.Kind == FxKind.WishEnded) return;
            if (fact.Kind == FxKind.WishStarted)
            {
                if (!fact.Caster.HasValue || !Finite(fact.Duration) || fact.Duration <= 0) return;
            }
            else
            {
                // Nonspatial visible-caster metadata legitimately terminates a telegraph.
                // There is never an actor-position or one-ended fallback for a landing.
                if (!fact.HasAnchor || (fact.Ability == (byte)AbilityId.Blaze && !fact.HasDestination)) return;
                if (fact.Ability != (byte)AbilityId.Blaze && fact.HasDestination) return;
                fact.Duration = LandingLifetimeMs;
            }
            if (_active.Count == Capacity) Recycle(0); // bounded cosmetic budget; terminals were already applied
            var cue = _pool.Count > 0 ? _pool.Pop() : Create();
            cue.Fact = fact;
            cue.Root.SetActive(false);
            _active.Add(cue);
        }

        public void Retain(HashSet<uint> membership)
        {
            for (int i = _active.Count - 1; i >= 0; i--)
                if (_active[i].Fact.Kind == FxKind.WishStarted && (!_active[i].Fact.Caster.HasValue || !membership.Contains(_active[i].Fact.Caster.Value))) Recycle(i);
        }

        public void Tick(double serverTimeMs)
        {
            if (!Finite(serverTimeMs) || serverTimeMs < 0) return;
            bool reduced = ShowcaseSettings.Current != null && ShowcaseSettings.Current.ReducedMotion;
            for (int i = _active.Count - 1; i >= 0; i--)
            {
                var cue = _active[i]; var fact = cue.Fact;
                double age = serverTimeMs - fact.EventTime;
                if (age >= fact.Duration || (fact.Kind == FxKind.WishStarted && (!_actors.IsLiving(fact.Caster.Value)))) { Recycle(i); continue; }
                cue.Root.SetActive(age >= 0);
                if (age < 0) continue;
                Vector3 point;
                if (fact.HasAnchor) point = ArenaView.WorldPoint(fact.X, fact.Y);
                else if (!_actors.TryPosition(fact.Caster.Value, out point)) { Recycle(i); continue; }
                Draw(cue, point, Mathf.Clamp01((float)(age / fact.Duration)), reduced);
            }
        }

        public void Reset()
        {
            for (int i = _active.Count - 1; i >= 0; i--) Recycle(i);
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

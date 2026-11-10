// Debug overlay for the ADR0024 hitboxes, off unless the page URL carries ?hitboxes=1. For every delivered actor it draws the foot
// box (walls and paths) and the body box (hits) from the Welcome archetype table, centred on where the sprite is actually drawn; for
// a projectile it draws the ground track point and the raised point (the drawn position) joined by a line. Presentation only: it
// reads delivered facts and the table, and simulates nothing. When the flag is absent no object of this type is ever created.
using System.Collections.Generic;
using UnityEngine;
using Roguehalla.Net;
using Roguehalla.Net.Protocol;

namespace Roguehalla.Client
{
    public sealed class HitboxOverlay
    {
        /// <summary>True for <c>?hitboxes=1</c> in a URL query string (with or without the leading '?'); anything else is off.</summary>
        public static bool ParseFlag(string search)
        {
            return Bootstrap.Query(search, "hitboxes", "0") == "1";
        }

        static int _enabled = -1;
        /// <summary>Cached page flag. Always false outside a page URL (editor, tests) unless <see cref="ForceForTests"/> is set.</summary>
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
                    _enabled = ParseFlag(search) ? 1 : 0;
                }
                return _enabled == 1;
            }
        }
        /// <summary>Test hook: null restores the URL decision.</summary>
        public static void ForceForTests(bool? on) { _enabled = on.HasValue ? (on.Value ? 1 : 0) : -1; }

        public static readonly Color FootColor = new Color(.1f, 1f, 1f, .95f), BodyColor = new Color(1f, .85f, .1f, .95f),
            GroundColor = new Color(1f, .25f, .9f, 1f), RaisedColor = new Color(1f, 1f, 1f, 1f);
        const float Thin = .028f, Cap = 2400, Mark = .12f;
        const int Order = 31000;

        struct ActorNote { public uint Id; public byte Archetype; public int Frame; }
        struct ShotNote { public float X, Y, Height; public int Frame; }

        readonly Transform _root;
        readonly SpriteActorPresenter _actors;
        readonly Dictionary<uint, ActorNote> _notes = new Dictionary<uint, ActorNote>();
        readonly List<ShotNote> _shots = new List<ShotNote>();
        readonly List<SpriteRenderer> _pool = new List<SpriteRenderer>();
        int _used, _previous, _shotFrame = -1;

        public HitboxOverlay(Transform root, SpriteActorPresenter actors) { _root = root; _actors = actors; }

        /// <summary>Number of line sprites currently shown (tests).</summary>
        public int Used { get { return _used; } }

        public void NoteActor(uint id, byte archetype)
        {
            _notes[id] = new ActorNote { Id = id, Archetype = archetype, Frame = Time.frameCount };
        }

        public void NoteShot(float x, float y, float height)
        {
            if (_shotFrame != Time.frameCount) { _shots.Clear(); _shotFrame = Time.frameCount; }
            _shots.Add(new ShotNote { X = x, Y = y, Height = height, Frame = Time.frameCount });
        }

        /// <summary>Draws this frame's notes; call from LateUpdate so positions are the ones the sprites ended the frame on.</summary>
        public void Draw(WireArchetype[] table)
        {
            _used = 0;
            int frame = Time.frameCount;
            foreach (var pair in _notes)
            {
                var n = pair.Value;
                if (frame - n.Frame > 1 || !_actors.TryPosition(n.Id, out var world)) continue;
                float x = world.x / ArenaView.Scale, y = -world.y / (ArenaView.Scale * ArenaView.GroundSquash);
                DrawActor(x, y, WireArchetype.Find(table, n.Archetype));
            }
            if (_shotFrame >= frame - 1)
                foreach (var s in _shots)
                {
                    var ground = ArenaView.WorldPoint(s.X, s.Y);
                    var raised = ArenaView.WorldPoint(s.X, s.Y - s.Height);
                    Cross(ground, GroundColor); Cross(raised, RaisedColor);
                    Segment(ground, raised, new Color(1f, 1f, 1f, .5f));
                }
            for (int i = _used; i < _previous && i < _pool.Count; i++) _pool[i].enabled = false;
            _previous = _used;
        }

        /// <summary>Boxes of one actor at feet (x, y) in sim units; a circle row (legacy) is drawn as a ring, with no table as the 12 u disc.</summary>
        public void DrawActor(float x, float y, WireArchetype row)
        {
            if (row == null) { Ring(x, y, (float)Footprint.LegacyRadius, FootColor); return; }
            if (row.Hull == 0) { Ring(x, y, row.R, FootColor); return; }
            Rect(x - row.Fx, y - row.Fy, x + row.Fx, y + row.Fy, FootColor);
            float cy = y + row.Oy, cx = x + row.Ox;
            Rect(cx - row.Bx, cy - row.By, cx + row.Bx, cy + row.By, BodyColor);
        }

        /// <summary>The outline rectangle, sim units, y0 north of y1; used by tests and the proof pages.</summary>
        public void Rect(float x0, float y0, float x1, float y1, Color c)
        {
            var a = ArenaView.WorldPoint(x0, y0); var b = ArenaView.WorldPoint(x1, y0);
            var d = ArenaView.WorldPoint(x0, y1); var e = ArenaView.WorldPoint(x1, y1);
            Segment(a, b, c); Segment(d, e, c); Segment(a, d, c); Segment(b, e, c);
        }

        void Ring(float x, float y, float r, Color c)
        {
            const int n = 20;
            for (int i = 0; i < n; i++)
            {
                float a0 = i * 2 * Mathf.PI / n, a1 = (i + 1) * 2 * Mathf.PI / n;
                Segment(ArenaView.WorldPoint(x + r * Mathf.Cos(a0), y + r * Mathf.Sin(a0)), ArenaView.WorldPoint(x + r * Mathf.Cos(a1), y + r * Mathf.Sin(a1)), c);
            }
        }

        void Cross(Vector3 p, Color c)
        {
            Segment(p + new Vector3(-Mark, 0), p + new Vector3(Mark, 0), c);
            Segment(p + new Vector3(0, -Mark), p + new Vector3(0, Mark), c);
        }

        void Segment(Vector3 a, Vector3 b, Color c)
        {
            if (_used >= Cap) return;
            SpriteRenderer r;
            if (_used == _pool.Count)
            {
                var go = new GameObject("Hitbox line"); go.transform.SetParent(_root, false);
                r = go.AddComponent<SpriteRenderer>(); ShowcaseSprites.Initialize(); r.sharedMaterial = ShowcaseSprites.Unlit;
                r.sprite = ShowcaseSprites.Get("bar");
                _pool.Add(r);
            }
            else r = _pool[_used];
            _used++;
            Vector3 d = b - a; float len = d.magnitude + Thin;
            r.enabled = true; r.color = c; r.sortingOrder = Order;
            r.transform.SetPositionAndRotation((a + b) * .5f, Quaternion.Euler(0, 0, Mathf.Atan2(d.y, d.x) * Mathf.Rad2Deg));
            r.transform.localScale = new Vector3(len, Thin, 1);
        }
    }
}

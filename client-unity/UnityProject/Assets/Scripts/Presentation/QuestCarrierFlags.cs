using System;
using System.Collections.Generic;
using Roguehalla.Net.Ui;
using UnityEngine;

namespace Roguehalla.Client
{
    /// <summary>Where a delivered, drawn actor stands (sim units); false when that actor is not drawn.</summary>
    public delegate bool ActorPoint(uint actorId, out float simX, out float simY);

    /// <summary>The small gold flag over a quest's carrier (W7), as legacy QuestView.makeCarrier: 14 x 12 px, 56 px above the carrier's ground point.
    /// One flag per row whose actor is drawn (the local player included) and whose giver is not fogged. Pooled; a steady frame allocates nothing.
    /// Presentation only.</summary>
    public sealed class QuestCarrierFlags
    {
        const int FlagOrder = 29050;

        sealed class Flag { public SpriteRenderer Fill, Rim; }

        readonly Transform _root;
        readonly List<Flag> _pool = new List<Flag>();
        int _shown, _created;

        public QuestCarrierFlags(Transform root) { _root = root; }

        public void Update(IReadOnlyList<CarrierFlagRow> rows, ActorPoint actorAt, Func<float, float, bool> canSee)
        {
            int used = 0;
            if (rows != null && actorAt != null)
            {
                for (int i = 0; i < rows.Count; i++)
                {
                    var row = rows[i];
                    // QuestView.ts:57: a fogged quest giver returns before the carrier block (legacy quirk, pinned).
                    if (canSee != null && !canSee((float)row.GiverX, (float)row.GiverY)) continue;
                    float x, y;
                    if (!actorAt(row.Actor, out x, out y)) continue;
                    if (used == _pool.Count) _pool.Add(NewFlag());
                    var f = _pool[used++];
                    var at = ArenaView.WorldPoint(x, y) + new Vector3(0, QuestCarrierFlag.CentrePx / 32f, 0);
                    f.Fill.transform.position = at; f.Rim.transform.position = at;
                    if (!f.Fill.enabled) { f.Fill.enabled = true; f.Rim.enabled = true; }
                }
            }
            for (int i = used; i < _pool.Count; i++)
            {
                var f = _pool[i];
                if (f.Fill.enabled) { f.Fill.enabled = false; f.Rim.enabled = false; }
            }
            _shown = used;
        }

        public int Shown { get { return _shown; } }
        /// <summary>GameObjects created since construction (a steady frame creates none).</summary>
        public int Created { get { return _created; } }
        public Vector3 PositionAt(int i) { return i >= 0 && i < _shown ? _pool[i].Fill.transform.position : Vector3.zero; }
        public Vector2 SizeAt(int i)
        {
            return i >= 0 && i < _shown ? new Vector2(QuestCarrierFlag.WidthPx / 32f, QuestCarrierFlag.HeightPx / 32f) : Vector2.zero;
        }
        public Color32 ColorAt(int i) { return i >= 0 && i < _shown ? (Color32)_pool[i].Fill.color : default(Color32); }

        Flag NewFlag()
        {
            var f = new Flag();
            float o = QuestCarrierFlag.OutlineWidthPx;   // a 2 px stroke centred on the edge: 1 px each side
            f.Rim = ShowcaseSprites.Create(_root, "Quest carrier flag rim", "bar", FlagOrder, Rgb(QuestCarrierFlag.OutlineRgb),
                new Vector2((QuestCarrierFlag.WidthPx + o) / 32f, (QuestCarrierFlag.HeightPx + o) / 32f), Vector3.zero, false);
            f.Fill = ShowcaseSprites.Create(_root, "Quest carrier flag", "bar", FlagOrder + 1, Rgb(QuestCarrierFlag.FillRgb),
                new Vector2(QuestCarrierFlag.WidthPx / 32f, QuestCarrierFlag.HeightPx / 32f), Vector3.zero, false);
            f.Rim.enabled = false; f.Fill.enabled = false;
            _created += 2;
            return f;
        }

        static Color Rgb(uint rgb)
        {
            return (Color)new Color32((byte)(rgb >> 16), (byte)(rgb >> 8), (byte)rgb, 255);
        }
    }
}

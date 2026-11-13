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
        public QuestCarrierFlags(Transform root) { }

        public void Update(IReadOnlyList<CarrierFlagRow> rows, ActorPoint actorAt, Func<float, float, bool> canSee) { }

        public int Shown { get { return 0; } }
        /// <summary>GameObjects created since construction (a steady frame creates none).</summary>
        public int Created { get { return 0; } }
        public Vector3 PositionAt(int i) { return Vector3.zero; }
        public Vector2 SizeAt(int i) { return Vector2.zero; }
        public Color32 ColorAt(int i) { return default(Color32); }
    }
}

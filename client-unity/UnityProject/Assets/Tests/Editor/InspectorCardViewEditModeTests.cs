using System.Collections.Generic;
using NUnit.Framework;
using Roguehalla.Client;
using Roguehalla.Net;
using Roguehalla.Net.Ui;
using UnityEngine;

public sealed class InspectorCardViewEditModeTests
{
    const uint Self = 1, Other = 7;

    static InterpActor Row(uint id, byte hp = 60) => new InterpActor
    {
        Id = id, Kind = ActorKind.Player, Status = ActorStatus.Alive, Faction = FactionId.Frost, Weapon = WeaponId.Axe, HpPct = hp, TopStat1 = StatKey.Ad,
    };

    [Test]
    public void HoveringShowsTheModelsLinesMovingOffHidesAndALockKeepsIt()
    {
        var host = new GameObject("Inspector test", typeof(RectTransform));
        try
        {
            var view = new InspectorCardView(host.transform);
            var rows = new List<InterpActor> { Row(Other) };
            var expected = new List<string>();
            Assert.That(InspectorCard.Build(rows[0], Self, expected), Is.True);

            view.Show(rows, Other, 0, Self);
            Assert.That(view.Visible, Is.True);
            Assert.That(view.ShownId, Is.EqualTo(Other));
            Assert.That(view.Lines, Is.EqualTo(expected));
            Assert.That(view.Text, Is.EqualTo(string.Join("\n", expected)));
            Assert.That(view.Root.gameObject.activeSelf, Is.True);

            view.Show(rows, 0, 0, Self);
            Assert.That(view.Visible, Is.False);
            Assert.That(view.Root.gameObject.activeSelf, Is.False);

            view.Show(rows, 0, Other, Self);   // wand lock with no hover
            Assert.That(view.Visible, Is.True);
            view.Show(rows, 0, 0, Self);
            Assert.That(view.Visible, Is.False);

            view.Show(rows, Self, 0, Self);    // self is never offered
            Assert.That(view.Visible, Is.False);

            view.Show(rows, Other, 0, Self);
            rows[0] = Row(Other, 25);          // a changed row rebuilds the lines
            view.Show(rows, Other, 0, Self);
            Assert.That(view.Text, Does.Contain("Health 25%"));
        }
        finally { Object.DestroyImmediate(host); }
    }
}

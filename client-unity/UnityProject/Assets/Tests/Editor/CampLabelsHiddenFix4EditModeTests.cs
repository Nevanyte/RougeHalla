using System.Collections.Generic;
using NUnit.Framework;
using Roguehalla.Net.Ui;
using UnityEngine;

namespace Roguehalla.Client.Tests
{
    /// <summary>P-UNITY-HUD-VISUAL-FIX-4: the camp respawn and ward labels hide with the other world labels while the Tab map is open.</summary>
    public sealed class CampLabelsHiddenFix4EditModeTests
    {
        GameObject _root; UiTheme _saved;

        [SetUp] public void SetUp() { _saved = UiTheme.Current; UiTheme.Current = UiTheme.Placeholder(); ShowcaseSprites.Initialize(); _root = new GameObject("camp labels fix4"); WorldLabelVisibility.Hidden = false; }
        [TearDown] public void TearDown() { WorldLabelVisibility.Hidden = false; Object.DestroyImmediate(_root); UiTheme.Current = _saved; }

        [Test]
        public void RespawnLabelsAreNotDrawnWhileWorldLabelsAreHidden()
        {
            var labels = new CampRespawnLabels(_root.transform);
            var rows = new List<CampWorldLabel> { new CampWorldLabel { Text = "RESPAWN 5", WorldX = 500, WorldY = 500 } };
            var wards = new List<CampWardRow>();
            labels.Draw(rows, wards);
            Assert.That(labels.Used, Is.EqualTo(1), "set-up");
            WorldLabelVisibility.Hidden = true;
            labels.Draw(rows, wards);
            Assert.That(labels.Used, Is.EqualTo(0));
        }
    }
}

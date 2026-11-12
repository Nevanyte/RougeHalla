using System.Reflection;
using NUnit.Framework;
using Roguehalla.Net;
using Roguehalla.Net.Protocol;
using Roguehalla.Net.Ui;
using UnityEngine;

namespace Roguehalla.Client.Tests
{
    /// <summary>Standing on an ember, bog or ice tile draws the model's chip; plain floor draws none (P-UNITY-HUD-TERRAIN-1).</summary>
    public sealed class TerrainChipsHudEditModeTests
    {
        GameObject _canvas, _owner;
        MatchHud _hud;
        UiTheme _saved;

        [SetUp]
        public void SetUp()
        {
            _saved = UiTheme.Current;
            UiTheme.Current = UiTheme.Placeholder();
            _canvas = new GameObject("Terrain canvas", typeof(RectTransform), typeof(Canvas));
            _owner = new GameObject("Terrain owner");
            _hud = _owner.AddComponent<MatchHud>();
            typeof(MatchHud).GetField("_hud", BindingFlags.Instance | BindingFlags.NonPublic).SetValue(_hud, _canvas.GetComponent<RectTransform>());
        }

        [TearDown]
        public void TearDown()
        {
            Object.DestroyImmediate(_canvas); Object.DestroyImmediate(_owner); UiTheme.Current = _saved;
        }

        [TestCase((byte)4)]
        [TestCase((byte)5)]
        [TestCase((byte)6)]
        public void HazardTileDrawsTheModelsChip(byte code)
        {
            var chip = TerrainChips.For(code, MapBlob.GroundTerrainAll, FactionId.Holy)[0];
            _hud.ShowTerrain(true, code, MapBlob.GroundTerrainAll, FactionId.Holy);
            Assert.That(_hud.TerrainChipLabel, Is.EqualTo(chip.Glyph + " " + chip.Label));
            Assert.That(_hud.TerrainChipTooltip, Is.EqualTo(chip.Explanation));
        }

        [Test]
        public void PlainFloorAndLeavingTheTileDrawNothing()
        {
            _hud.ShowTerrain(true, 4, MapBlob.GroundTerrainAll, FactionId.Fire);
            Assert.That(_hud.TerrainChipLabel, Is.Not.Empty);
            _hud.ShowTerrain(true, 0, MapBlob.GroundTerrainAll, FactionId.Fire);
            Assert.That(_hud.TerrainChipLabel, Is.Empty);
            _hud.ShowTerrain(true, 5, MapBlob.GroundTerrainAll, FactionId.Fire);
            _hud.ShowTerrain(false, 5, MapBlob.GroundTerrainAll, FactionId.Fire);
            Assert.That(_hud.TerrainChipLabel, Is.Empty);
        }

        [Test]
        public void HomeGroundNoteShowsUnderMapModeOnly()
        {
            _hud.ShowTerrain(true, 4, MapBlob.GroundTerrainMap, FactionId.Fire);
            Assert.That(_hud.TerrainChipLabel, Is.Empty);
            Assert.That(_hud.TerrainNoteLabel, Is.EqualTo("Home ground: embers can't burn you"));
        }
    }
}

using System.Collections.Generic;
using NUnit.Framework;
using Roguehalla.Client;

namespace Roguehalla.Client.Tests
{
    /// <summary>Every generated prop keeps a transparent margin on all four sides of its atlas cell: nothing is cut off at the cell edge (the Plague tree canopy was).</summary>
    public sealed class RegionPropMarginEditModeTests
    {
        [Test]
        public void NoPropTouchesItsCellEdge()
        {
            var bad = new List<string>(); int n = 0;
            foreach (var key in RegionPropArt.Keys)
            {
                Assert.That(RegionPropArt.TryGet(key, out var s), Is.True, key); n++;
                if (s.MinMargin < RegionPropArt.RequiredMargin)
                    bad.Add(key + " (L" + s.MarginLeft + " R" + s.MarginRight + " B" + s.MarginBottom + " T" + s.MarginTop + ")");
            }
            Assert.That(n, Is.GreaterThan(30), "prop count");
            Assert.That(bad, Is.Empty, "props with opaque pixels within " + RegionPropArt.RequiredMargin + " px of the cell edge: " + string.Join(", ", bad));
        }

        [Test]
        public void ReportWhichPropsOverhungTheirOldCell()
        {
            var over = new List<string>();
            foreach (var key in RegionPropArt.Keys) { RegionPropArt.TryGet(key, out var s); if (s.ExceededCell) over.Add(key); }
            UnityEngine.Debug.Log("props that used to be cut off at their cell edge: " + string.Join(", ", over));
            Assert.That(over, Does.Contain("plague.tree"));
        }

        [TestCase("plague.tree"), TestCase("frost.pine"), TestCase("frost.pine2"), TestCase("sent.deadtree"), TestCase("holy.palm"), TestCase("fire.spire"), TestCase("temple.minaret")]
        public void TallPropsAreNotClipped(string key)
        {
            Assert.That(RegionPropArt.TryGet(key, out var s), Is.True, key);
            Assert.That(s.MarginLeft, Is.GreaterThanOrEqualTo(RegionPropArt.RequiredMargin), key + " left");
            Assert.That(s.MarginRight, Is.GreaterThanOrEqualTo(RegionPropArt.RequiredMargin), key + " right");
            Assert.That(s.MarginTop, Is.GreaterThanOrEqualTo(RegionPropArt.RequiredMargin), key + " top");
        }
    }
}

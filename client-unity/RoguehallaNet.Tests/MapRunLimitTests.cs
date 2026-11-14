using System;
using System.Linq;
using System.Reflection;
using NUnit.Framework;
using Roguehalla.Net.Protocol;

namespace Roguehalla.Net.Tests
{
    /// <summary>
    /// P-UNITY-DRESS-2 oracle, item 3: one map-run limit in C#. The decoder's cumulative run limit is Rust's
    /// MAX_CUMULATIVE_RUNS = 6 * MAX_MAP_TILES (crates/rh-protocol/src/map.rs:19: collision, terrain, regions, bushes, ground
    /// variants, patience). Today Wire.MaxMapRuns is a stale, unused 5x value and MapBlob enforces a private copy of the 6x one.
    /// Neither side of the limit can be built as a blob: a blob at 6 * 1048576 runs is about 18 MB, and the encoder refuses a
    /// map over Wire.MaxServerFrame (256 KiB, "welcome too large"), as the decoder refuses a longer extension. The limit is a
    /// ceiling no frame can reach, so it is pinned as constants: the relation to Rust, and that MapBlob keeps no copy of its own.
    /// </summary>
    public sealed class MapRunLimitTests
    {
        [Test]
        public void TheMapRunLimitIsSixPlanesOfTiles()
        {
            Assert.AreEqual(6 * Wire.MaxMapTiles, Wire.MaxMapRuns, "Rust MAX_CUMULATIVE_RUNS = 6 * MAX_MAP_TILES");
        }

        [Test]
        public void MapBlobKeepsNoRunLimitOfItsOwn()
        {
            var own = typeof(MapBlob).GetFields(BindingFlags.Static | BindingFlags.Instance | BindingFlags.Public | BindingFlags.NonPublic | BindingFlags.DeclaredOnly)
                .Where(f => f.IsLiteral && f.Name.IndexOf("Run", StringComparison.OrdinalIgnoreCase) >= 0).Select(f => f.Name).ToArray();
            CollectionAssert.IsEmpty(own, "the decoder enforces Wire.MaxMapRuns; a second constant can drift from it");
        }
    }
}

// Public region lookup for other systems (lighting, particles, music). Reads the public per-tile region plane delivered in the
// map; absent planes mean "unknown" and every query answers RegionId.None. Never feeds gameplay.
//
//   ArenaView.RegionAt(worldPos)        region id at a Unity world position (ArenaView.WorldPoint space)
//   ArenaView.LocalRegion               region under the local player (debounced)
//   ArenaView.LocalRegionChanged        event (previous, current), raised on the main thread from ArenaView.Present
using System;
using UnityEngine;
using Roguehalla.Net.Protocol;

namespace Roguehalla.Client
{
    public sealed class RegionMap
    {
        /// <summary>A new region must hold under the player for this long before <see cref="LocalRegionChanged"/> fires, so a ragged border never flickers.</summary>
        public const float ConfirmSeconds = .25f;
        byte[] _regions, _terrain; int _w, _h;
        RegionId _local = RegionId.None, _pending = RegionId.None; float _pendingSince;
        public bool HasRegions { get { return _regions != null; } }
        public bool HasTerrain { get { return _terrain != null; } }
        public int Width { get { return _w; } }
        public int Height { get { return _h; } }
        public RegionId LocalRegion { get { return _local; } }
        public event Action<RegionId, RegionId> LocalRegionChanged;

        public void Load(MapBlob map)
        {
            _w = map.W; _h = map.H; _regions = map.Regions; _terrain = map.Terrain;
            if (_regions != null && _regions.Length != _w * _h) _regions = null;
            if (_terrain != null && _terrain.Length != _w * _h) _terrain = null;
        }

        public RegionId RegionAtTile(int tx, int ty)
        {
            if (_regions == null || (uint)tx >= (uint)_w || (uint)ty >= (uint)_h) return RegionId.None;
            byte v = _regions[ty * _w + tx]; return v <= (byte)RegionId.Coliseum ? (RegionId)v : RegionId.None;
        }
        public TerrainKind TerrainAtTile(int tx, int ty)
        {
            if (_terrain == null || (uint)tx >= (uint)_w || (uint)ty >= (uint)_h) return TerrainKind.None;
            byte v = _terrain[ty * _w + tx]; return v <= (byte)TerrainKind.Light ? (TerrainKind)v : TerrainKind.None;
        }
        /// <summary>Region at a server-space position (32 units per tile, as in snapshots).</summary>
        public RegionId RegionAtServer(float sx, float sy) { return RegionAtTile(Mathf.FloorToInt(sx / 32f), Mathf.FloorToInt(sy / 32f)); }
        public TerrainKind TerrainAtServer(float sx, float sy) { return TerrainAtTile(Mathf.FloorToInt(sx / 32f), Mathf.FloorToInt(sy / 32f)); }
        /// <summary>Region at a Unity world position (the space ArenaView.WorldPoint returns).</summary>
        public RegionId RegionAt(Vector2 world)
        {
            float tx = world.x, ty = -world.y / ArenaView.GroundSquash;
            return RegionAtTile(Mathf.FloorToInt(tx), Mathf.FloorToInt(ty));
        }
        public RegionId RegionAt(Vector3 world) { return RegionAt(new Vector2(world.x, world.y)); }

        /// <summary>Feeds the local player's drawn server position; <paramref name="now"/> is unscaled seconds. Tiles with no region (outer border) are ignored.</summary>
        public void UpdateLocal(float serverX, float serverY, float now)
        {
            if (_regions == null) return;
            var at = RegionAtServer(serverX, serverY);
            if (at == RegionId.None || at == _local) { _pending = _local; return; }
            if (_local == RegionId.None) { Commit(at); return; }          // first fix: no debounce
            if (at != _pending) { _pending = at; _pendingSince = now; return; }
            if (now - _pendingSince >= ConfirmSeconds) Commit(at);
        }

        /// <summary>Immediate change (teleport, respawn, tests).</summary>
        public void SnapLocal(float serverX, float serverY)
        {
            var at = RegionAtServer(serverX, serverY);
            if (at != RegionId.None && at != _local) Commit(at);
        }
        void Commit(RegionId at)
        {
            var previous = _local; _local = at; _pending = at;
            var handler = LocalRegionChanged; if (handler != null) handler(previous, at);
        }
    }
}

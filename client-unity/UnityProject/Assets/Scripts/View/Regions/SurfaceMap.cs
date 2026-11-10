// "What is the character standing on?" Presentation-only answer for footprints, ripples and footstep sounds. Derived from the
// public region plane, the public terrain plane and the decorative layouts the client generates (temple floor, Plague mud, grass
// and shallow water). It never feeds gameplay: a decorative surface is only a look, the server alone decides speed, burn or heal.
//
//   ArenaView.Surfaces.SurfaceAt(worldPos)         Unity world position (the space ArenaView.WorldPoint returns)
//   ArenaView.Surfaces.SurfaceAtServer(sx, sy)     server space (32 units per tile, as in snapshots)
//   ArenaView.Surfaces.SurfaceAtTile(tx, ty)       tile coordinates
//
// Priority: real terrain surfaces first (lava, ember, bog, ice, light; these come from the terrain plane and already honour the
// room's terrain mode, see RegionMap), then the decorative layer (only ever on floor tiles), then the region default.
using UnityEngine;

namespace Roguehalla.Client
{
    public enum SurfaceKind : byte
    {
        None, Snow, Ice, Sand, TempleFloor, Flagstone, Basalt, Ember, Lava, Mud, Grass, ShallowWater, Bog, Limestone, HolyLight
    }

    /// <summary>Decorative surface source (temple footprint, Plague ground). Must be a pure, allocation-free function of the tile.</summary>
    public interface ISurfaceLayer
    {
        /// <summary>True and <paramref name="kind"/> set when this layer paints the tile; false to fall through to the region default.</summary>
        bool TryGet(int tx, int ty, RegionId region, out SurfaceKind kind);
    }

    public sealed class SurfaceMap
    {
        readonly RegionMap _regions;
        ISurfaceLayer[] _layers = new ISurfaceLayer[0];

        public SurfaceMap(RegionMap regions) { _regions = regions; }

        /// <summary>Registers a decorative layer; layers asked in registration order, first match wins.</summary>
        public void AddLayer(ISurfaceLayer layer)
        {
            if (layer == null) return;
            var next = new ISurfaceLayer[_layers.Length + 1];
            System.Array.Copy(_layers, next, _layers.Length); next[_layers.Length] = layer; _layers = next;
        }
        public void ClearLayers() { _layers = new ISurfaceLayer[0]; }

        /// <summary>Surface under a Unity world position (x = tile, y = -tile * GroundSquash).</summary>
        public SurfaceKind SurfaceAt(Vector3 world)
        {
            return SurfaceAtTile(Mathf.FloorToInt(world.x), Mathf.FloorToInt(-world.y / ArenaView.GroundSquash));
        }
        public SurfaceKind SurfaceAt(Vector2 world) { return SurfaceAt(new Vector3(world.x, world.y, 0)); }
        /// <summary>Surface under a server-space position (32 units per tile).</summary>
        public SurfaceKind SurfaceAtServer(float sx, float sy) { return SurfaceAtTile(Mathf.FloorToInt(sx / 32f), Mathf.FloorToInt(sy / 32f)); }

        public SurfaceKind SurfaceAtTile(int tx, int ty)
        {
            var region = _regions.RegionAtTile(tx, ty);
            if (region == RegionId.None) return SurfaceKind.None;
            switch (_regions.TerrainAtTile(tx, ty))
            {
                case TerrainKind.Lava: return SurfaceKind.Lava;
                case TerrainKind.Ember: return SurfaceKind.Ember;
                case TerrainKind.Bog: return SurfaceKind.Bog;
                case TerrainKind.Ice: return SurfaceKind.Ice;
                case TerrainKind.Light: return SurfaceKind.HolyLight;
            }
            for (int i = 0; i < _layers.Length; i++)
                if (_layers[i].TryGet(tx, ty, region, out var kind)) return kind;
            return DefaultFor(region);
        }

        /// <summary>The region's plain ground when nothing more specific applies.</summary>
        public static SurfaceKind DefaultFor(RegionId region)
        {
            switch (region)
            {
                case RegionId.Fire: return SurfaceKind.Basalt;
                case RegionId.Sentenced: return SurfaceKind.Flagstone;
                case RegionId.Plague: return SurfaceKind.Mud;
                case RegionId.Frost: return SurfaceKind.Snow;
                case RegionId.Holy: return SurfaceKind.Sand;
                case RegionId.Coliseum: return SurfaceKind.Limestone;
                default: return SurfaceKind.None;
            }
        }
    }
}

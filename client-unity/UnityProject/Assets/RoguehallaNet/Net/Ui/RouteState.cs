using System;
using System.Collections.Generic;
using Roguehalla.Net.Protocol;

namespace Roguehalla.Net.Ui
{
    /// <summary>A world coordinate used by the local route preview. It carries no gameplay authority.</summary>
    public readonly struct RoutePoint : IEquatable<RoutePoint>
    {
        public readonly double X;
        public readonly double Y;

        public RoutePoint(double x, double y) { X = x; Y = y; }
        public bool Equals(RoutePoint other) { return X.Equals(other.X) && Y.Equals(other.Y); }
        public override bool Equals(object obj) { return obj is RoutePoint && Equals((RoutePoint)obj); }
        public override int GetHashCode() { unchecked { return (X.GetHashCode() * 397) ^ Y.GetHashCode(); } }
    }

    /// <summary>Explicit units needed to preview a path; callers supply them from their map/game presentation contract.</summary>
    public readonly struct RouteGeometry
    {
        public readonly double TileSize;
        public readonly double BodyRadius;
        public readonly double WalkSpeed;

        public RouteGeometry(double tileSize, double bodyRadius, double walkSpeed)
        {
            if (!Finite(tileSize) || tileSize <= 0) throw new ArgumentOutOfRangeException(nameof(tileSize));
            if (!Finite(bodyRadius) || bodyRadius < 0) throw new ArgumentOutOfRangeException(nameof(bodyRadius));
            if (!Finite(walkSpeed) || walkSpeed <= 0) throw new ArgumentOutOfRangeException(nameof(walkSpeed));
            TileSize = tileSize;
            BodyRadius = bodyRadius;
            WalkSpeed = walkSpeed;
        }

        static bool Finite(double value) { return !double.IsNaN(value) && !double.IsInfinity(value); }
    }

    public sealed class RouteLeg
    {
        public int WaypointIndex { get; private set; }
        public RoutePoint End { get; private set; }
        internal RouteLeg(int waypointIndex, RoutePoint end) { WaypointIndex = waypointIndex; End = end; }
    }

    /// <summary>An immutable, presentation-only route result. Unreachable stops remain in the waypoint list.</summary>
    public sealed class RoutePlanSnapshot
    {
        readonly IReadOnlyList<RoutePoint> _points;
        readonly IReadOnlyList<RouteLeg> _legs;
        readonly IReadOnlyList<int> _unreachable;
        public RoutePoint? Start { get; private set; }
        public IReadOnlyList<RoutePoint> Points { get { return _points; } }
        public IReadOnlyList<RouteLeg> Legs { get { return _legs; } }
        public IReadOnlyList<int> Unreachable { get { return _unreachable; } }
        public double Distance { get; private set; }
        public double EtaSeconds { get; private set; }

        internal RoutePlanSnapshot(RoutePoint? start, List<RoutePoint> points, List<RouteLeg> legs, List<int> unreachable, double distance, double etaSeconds)
        {
            Start = start;
            _points = Array.AsReadOnly(points.ToArray());
            _legs = Array.AsReadOnly(legs.ToArray());
            _unreachable = Array.AsReadOnly(unreachable.ToArray());
            Distance = distance;
            EtaSeconds = etaSeconds;
        }
    }

    /// <summary>A waypoint export value. Loading sanitizes untrusted values and caps the route at twelve stops.</summary>
    public readonly struct RouteWaypoint
    {
        public readonly double X;
        public readonly double Y;
        public RouteWaypoint(double x, double y) { X = x; Y = y; }
    }

    /// <summary>
    /// Private client route state. It only previews paths and never sends movement orders or changes simulation outcomes.
    /// Store one instance per local room/session; do not share its waypoints with other players.
    /// </summary>
    public sealed class RouteState
    {
        public const int MaxWaypoints = 12;
        readonly List<RoutePoint> _waypoints = new List<RoutePoint>();
        readonly IReadOnlyList<RoutePoint> _waypointView;
        readonly Pathfinder _pathfinder = new Pathfinder();
        RoutePoint? _start;
        int _next;
        int _version;
        Cache _cache;

        sealed class Cache
        {
            public MapBlob Map;
            public int Version;
            public RouteGeometry Geometry;
            public int FirstWaypoint;
            public RoutePoint? Start;
            public RoutePlanSnapshot Plan;
        }

        public RouteState() { _waypointView = _waypoints.AsReadOnly(); }

        public IReadOnlyList<RoutePoint> Waypoints { get { return _waypointView; } }
        public RoutePoint? Start { get { return _start; } }
        public int NextIndex { get { return _next; } }
        public int Version { get { return _version; } }

        public bool Add(RoutePoint point, MapBlob map, double tileSize)
        {
            if (_waypoints.Count >= MaxWaypoints) return false;
            _waypoints.Add(Clamp(point, map, tileSize));
            Changed();
            return true;
        }

        /// <summary>Removes the first upcoming stop within two tiles; otherwise appends the point.</summary>
        public bool ToggleUpcoming(RoutePoint point, MapBlob map, double tileSize)
        {
            RoutePoint clamped = Clamp(point, map, tileSize);
            double reach = 2 * tileSize;
            for (int i = _next; i < _waypoints.Count; i++)
            {
                if (Distance(_waypoints[i], clamped) <= reach) return RemoveAt(i);
            }
            if (_waypoints.Count >= MaxWaypoints) return false;
            _waypoints.Add(clamped);
            Changed();
            return true;
        }

        public bool RemoveAt(int index)
        {
            if (index < 0 || index >= _waypoints.Count) return false;
            _waypoints.RemoveAt(index);
            if (_next > index) _next--;
            Changed();
            return true;
        }

        public bool Undo() { return RemoveAt(_waypoints.Count - 1); }

        public void Clear()
        {
            if (_waypoints.Count == 0) return;
            _waypoints.Clear();
            _next = 0;
            Changed();
        }

        public void SetStart(RoutePoint? point)
        {
            if (_start.HasValue == point.HasValue && (!_start.HasValue || _start.Value.Equals(point.Value))) return;
            _start = point;
            Changed();
        }

        public void Restart()
        {
            if (_next == 0) return;
            _next = 0;
            Changed();
        }

        /// <summary>Advances sequentially past stops reached within two caller-supplied tiles.</summary>
        public bool Advance(RoutePoint at, double tileSize)
        {
            if (!Finite(tileSize) || tileSize <= 0) throw new ArgumentOutOfRangeException(nameof(tileSize));
            int next = _next;
            double reach = 2 * tileSize;
            while (next < _waypoints.Count && Distance(_waypoints[next], at) <= reach) next++;
            if (next == _next) return false;
            _next = next;
            Changed();
            return true;
        }

        public RoutePlanSnapshot Plan(MapBlob map, RouteGeometry geometry)
        {
            return PlanRange(map, geometry, 0, _start);
        }

        /// <summary>Plans only the remaining stops from a supplied current position without changing route state.</summary>
        public RoutePlanSnapshot PlanAhead(MapBlob map, RouteGeometry geometry, RoutePoint? currentPosition)
        {
            return PlanRange(map, geometry, _next, currentPosition);
        }

        RoutePlanSnapshot PlanRange(MapBlob map, RouteGeometry geometry, int firstWaypoint, RoutePoint? start)
        {
            if (map == null) throw new ArgumentNullException(nameof(map));
            if (_cache != null && ReferenceEquals(_cache.Map, map) && _cache.Version == _version && _cache.FirstWaypoint == firstWaypoint
                && Nullable.Equals(_cache.Start, start) && Same(_cache.Geometry, geometry)) return _cache.Plan;
            var points = new List<RoutePoint>();
            var legs = new List<RouteLeg>();
            var unreachable = new List<int>();
            RoutePoint? at = start;
            if (at.HasValue) points.Add(at.Value);

            for (int i = firstWaypoint; i < _waypoints.Count; i++)
            {
                RoutePoint target = _waypoints[i];
                PathPoint[] path;
                if (!at.HasValue)
                {
                    path = _pathfinder.FindPath(map, target.X, target.Y, target.X, target.Y, geometry.BodyRadius);
                    if (path.Length == 0) { unreachable.Add(i); continue; }
                    RoutePoint snapped = new RoutePoint(path[path.Length - 1].X, path[path.Length - 1].Y);
                    points.Add(snapped);
                    legs.Add(new RouteLeg(i, snapped));
                    at = snapped;
                    continue;
                }

                path = _pathfinder.FindPath(map, at.Value.X, at.Value.Y, target.X, target.Y, geometry.BodyRadius);
                if (path.Length == 0) { unreachable.Add(i); continue; }
                for (int p = 0; p < path.Length; p++) points.Add(new RoutePoint(path[p].X, path[p].Y));
                RoutePoint end = new RoutePoint(path[path.Length - 1].X, path[path.Length - 1].Y);
                legs.Add(new RouteLeg(i, end));
                at = end;
            }

            double distance = 0;
            for (int i = 1; i < points.Count; i++) distance += Distance(points[i - 1], points[i]);
            var plan = new RoutePlanSnapshot(start, points, legs, unreachable, distance, distance / geometry.WalkSpeed);
            _cache = new Cache { Map = map, Version = _version, Geometry = geometry, FirstWaypoint = firstWaypoint, Start = start, Plan = plan };
            return plan;
        }

        /// <summary>Exports a detached copy; fractional click positions are rounded like the legacy storage format.</summary>
        public RouteWaypoint[] Export()
        {
            var result = new RouteWaypoint[_waypoints.Count];
            for (int i = 0; i < result.Length; i++) result[i] = new RouteWaypoint(RoundLikeLegacy(_waypoints[i].X), RoundLikeLegacy(_waypoints[i].Y));
            return result;
        }

        /// <summary>Replaces waypoints after dropping invalid values, rounding, clamping and enforcing the twelve-stop cap.</summary>
        public void Load(IEnumerable<RouteWaypoint> values, MapBlob map, double tileSize)
        {
            if (map == null) throw new ArgumentNullException(nameof(map));
            if (values == null) throw new ArgumentNullException(nameof(values));
            _waypoints.Clear();
            _next = 0;
            foreach (var value in values)
            {
                if (_waypoints.Count >= MaxWaypoints) break;
                if (!Finite(value.X) || !Finite(value.Y)) continue;
                _waypoints.Add(Clamp(new RoutePoint(RoundLikeLegacy(value.X), RoundLikeLegacy(value.Y)), map, tileSize));
            }
            Changed();
        }

        void Changed() { _version++; _cache = null; }

        static bool Same(RouteGeometry a, RouteGeometry b)
        {
            return a.TileSize.Equals(b.TileSize) && a.BodyRadius.Equals(b.BodyRadius) && a.WalkSpeed.Equals(b.WalkSpeed);
        }

        static RoutePoint Clamp(RoutePoint point, MapBlob map, double tileSize)
        {
            if (map == null) throw new ArgumentNullException(nameof(map));
            if (!Finite(tileSize) || tileSize <= 0) throw new ArgumentOutOfRangeException(nameof(tileSize));
            if (!Finite(point.X) || !Finite(point.Y)) throw new ArgumentOutOfRangeException(nameof(point));
            return new RoutePoint(Math.Max(0, Math.Min(map.W * tileSize, point.X)), Math.Max(0, Math.Min(map.H * tileSize, point.Y)));
        }

        static double Distance(RoutePoint a, RoutePoint b) { return Math.Sqrt((b.X - a.X) * (b.X - a.X) + (b.Y - a.Y) * (b.Y - a.Y)); }
        static double RoundLikeLegacy(double value) { return Math.Floor(value + 0.5); }
        static bool Finite(double value) { return !double.IsNaN(value) && !double.IsInfinity(value); }
    }
}

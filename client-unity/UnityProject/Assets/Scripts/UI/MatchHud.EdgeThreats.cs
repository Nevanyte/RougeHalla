// Edge-of-screen threat glows (legacy ui/edgeThreat.ts, RaidScene.ts:806): one soft glow on the screen edge toward every visible enemy, red when near and
// green at the edge of sight. Fed from the delivered actor list and the Welcome's vision radius; shown only while the local fighter is alive in a running match.
using System.Collections.Generic;
using UnityEngine;
using Roguehalla.Net;
using Roguehalla.Net.Protocol;

namespace Roguehalla.Client
{
    public sealed partial class MatchHud
    {
        const int MaxEdgeThreats = 24;
        readonly List<EdgeThreat> _edgeList = new List<EdgeThreat>(MaxEdgeThreats);

        void UpdateEdgeThreats()
        {
            if (_edgeThreats == null) return;
            var s = _session; var me = s != null ? s.Me : null;
            if (s == null || me == null || s.State != SessionState.InMatch || s.Phase != MatchPhase.Active || me.Status != ActorStatus.Alive || s.Vision == null || _client == null || s.Training)
            { _edgeThreats.Show(null); return; }
            var rect = _edgeThreats.Root.rect; float w = rect.width - EdgeThreatView.Margin, h = rect.height - EdgeThreatView.Margin;
            _edgeList.Clear();
            var cam = _client.Cam;
            float halfH = cam != null ? cam.orthographicSize * 32f : 288f, halfW = cam != null ? cam.orthographicSize * cam.aspect * 32f : 512f;   // the visible ground in sim units (squashed)
            EdgeThreats.Collect(_client.Actors, me.Id, me.X, me.Y, w, h, (float)s.Vision.Radius, _edgeList, MaxEdgeThreats, halfW, halfH);
            _edgeThreats.Show(_edgeList);
        }
    }

    public static class EdgeThreats
    {
        /// <summary>The glow positions for every living creature or fighter other than <paramref name="meId"/> (legacy "threats", players only and only those off screen): the bearing is squashed like the ground, the colour follows the unsquashed distance.</summary>
        public static void Collect(IReadOnlyList<InterpActor> actors, uint meId, float meX, float meY, float width, float height, float far, List<EdgeThreat> into, int max, float viewHalfW = 0f, float viewHalfH = 0f)
        {
            for (int i = 0; i < actors.Count && into.Count < max; i++)
            {
                var a = actors[i];
                if (a.Id == meId || a.Status != ActorStatus.Alive || a.Kind != ActorKind.Player) continue;   // legacy: other living players only (RaidScene.ts:773)
                if ((a.Effects & Roguehalla.Net.Ui.Indicators.Hidden) != 0) continue;
                float dx = a.X - meX, dy = a.Y - meY, dist = Mathf.Sqrt(dx * dx + dy * dy);
                if (viewHalfW > 0f && Mathf.Abs(dx) < viewHalfW && Mathf.Abs(dy * ArenaView.GroundSquash) < viewHalfH) continue;   // on screen: the fighter itself is the cue, a dot would only cover it
                into.Add(EdgeThreat.Compute(dx, -dy * ArenaView.GroundSquash, dist, width, height, far));
            }
        }
    }
}

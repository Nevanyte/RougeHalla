using System.Collections.Generic;
using System.Globalization;
using System.Runtime.InteropServices;
using System.Text;
using Roguehalla.Net;
using UnityEngine;

namespace Roguehalla.Client
{
    /// <summary>
    /// DIAGNOSTICS ONLY (<c>?scenario.probe=1</c>, off by default): publishes what the client already holds from the server (own state,
    /// delivered actors, props, reward chests, quest rows, merchants) with their screen positions as <c>window.__rhProbe</c>, so the
    /// UI scenario harness can steer a real match (click on a creature, walk to a chest) instead of guessing from pixels. It reads
    /// and never writes game state, and sends nothing to the server.
    /// </summary>
    public sealed class ScenarioProbe : MonoBehaviour
    {
#if UNITY_WEBGL && !UNITY_EDITOR
        [DllImport("__Internal")] static extern void RhProbe_Publish(string json);
#else
        static void RhProbe_Publish(string json) { }
#endif
        MatchClient _mc;
        float _next, _nextUi;
        string _uiJson = "[]";
        readonly Vector3[] _corners = new Vector3[4];
        readonly StringBuilder _sb = new StringBuilder(8192);
        readonly List<InterpActor> _actors = new List<InterpActor>(64);

        public void Initialize(MatchClient mc) { _mc = mc; }

        void LateUpdate()
        {
            if (_mc == null || _mc.Cam == null || Time.unscaledTime < _next) return;
            _next = Time.unscaledTime + .1f;
            if (Time.unscaledTime >= _nextUi) { _nextUi = Time.unscaledTime + .4f; _uiJson = UiButtons(); }
            var s = _mc.Session;
            var sb = _sb; sb.Length = 0;
            sb.Append("{\"ui\":").Append(_uiJson).Append(",\"t\":").Append(Time.unscaledTime.ToString("F2", CultureInfo.InvariantCulture))
              .Append(",\"sw\":").Append(Screen.width).Append(",\"sh\":").Append(Screen.height);
            if (s == null) { sb.Append(",\"session\":false}"); RhProbe_Publish(sb.ToString()); return; }
            sb.Append(",\"session\":true,\"training\":").Append(s.Training ? "true" : "false")
              .Append(",\"practice\":").Append(_mc.ConfirmedPractice ? "true" : "false")
              .Append(",\"state\":\"").Append(s.State).Append("\",\"phase\":").Append(s.Phase.HasValue ? ((int)s.Phase.Value).ToString() : "-1")
              .Append(",\"result\":").Append(s.LastResult != null ? "true" : "false")
              .Append(",\"hitFx\":").Append(ArenaView.DiagHitFx).Append(",\"hitFxOnMe\":").Append(ArenaView.DiagHitFxOnMe)
              .Append(",\"lastAmountOnMe\":").Append(Num(ArenaView.DiagLastAmountOnMe)).Append(",\"lastPassiveOnMe\":").Append(ArenaView.DiagLastPassiveOnMe ? "true" : "false")
              .Append(",\"vignette\":").Append(_mc.Arena != null ? Num(_mc.Arena.DiagVignetteStrength) : "0").Append(",\"flashes\":").Append(_mc.Arena != null ? _mc.Arena.DiagFlashes : 0);
            var me = s.Me;
            if (me != null)
            {
                sb.Append(",\"me\":{");
                Common(sb, me.Id, me.X, me.Y);
                sb.Append(",\"hp\":").Append(Num(me.Hp)).Append(",\"maxHp\":").Append(Num(me.MaxHp)).Append(",\"faction\":").Append((int)me.Faction)
                  .Append(",\"bounty\":").Append(me.Bounty).Append(",\"kills\":").Append(me.Kills).Append(",\"gv\":").Append(me.Gv)
                  .Append(",\"status\":").Append((int)me.Status).Append(",\"effects\":").Append(me.Effects).Append(",\"sig\":").Append(me.SelfSig)
                  .Append(",\"weapon\":").Append((int)me.Weapon).Append(",\"hunt\":").Append(me.HuntTarget.HasValue ? (long)me.HuntTarget.Value : -1)
                  .Append(",\"lock\":").Append(me.OwnerCombat.HasValue && me.OwnerCombat.Value.Lock.Target.HasValue ? (long)me.OwnerCombat.Value.Lock.Target.Value : -1)
                  .Append('}');
            }
            if (s.Snapshots.Count > 0)
            {
                _actors.Clear(); s.Snapshots.Sample(s.Snapshots.NewestMs, _actors);
                sb.Append(",\"actors\":[");
                for (int i = 0; i < _actors.Count; i++)
                {
                    var a = _actors[i]; if (i > 0) sb.Append(',');
                    sb.Append('{'); Common(sb, a.Id, a.X, a.Y);
                    sb.Append(",\"kind\":").Append((int)a.Kind).Append(",\"mob\":").Append(a.MobType.HasValue ? (int)a.MobType.Value : -1)
                      .Append(",\"faction\":").Append(a.Faction.HasValue ? (int)a.Faction.Value : -1).Append(",\"status\":").Append((int)a.Status)
                      .Append(",\"hp\":").Append(a.HpPct).Append(",\"bounty\":").Append(a.Bounty).Append(",\"effects\":").Append(a.Effects)
                      .Append(",\"sig\":").Append(a.SourceSig).Append('}');
                }
                sb.Append(']');
            }
            var c = s.Collections;
            sb.Append(",\"props\":[");
            for (int i = 0; i < c.Props.Count; i++)
            {
                var p = c.Props[i]; if (i > 0) sb.Append(',');
                sb.Append('{'); Common(sb, (uint)i, p.X, p.Y);
                sb.Append(",\"kind\":").Append((int)p.Kind).Append(",\"focused\":").Append(p.Focused ? "true" : "false").Append(",\"open\":").Append(p.Open ? "true" : "false")
                  .Append(",\"weapon\":").Append(p.Weapon.HasValue ? (int)p.Weapon.Value : -1).Append('}');
            }
            sb.Append("],\"chests\":[");
            for (int i = 0; i < c.RewardChests.Count; i++)
            {
                var r = c.RewardChests[i]; if (i > 0) sb.Append(',');
                sb.Append('{'); Common(sb, (uint)i, r.X, r.Y);
                sb.Append(",\"picked\":").Append(r.Picked ? "true" : "false").Append(",\"canChoose\":").Append(r.CanChoose ? "true" : "false")
                  .Append(",\"options\":").Append(r.Options != null ? r.Options.Count : 0).Append('}');
            }
            sb.Append("],\"camps\":").Append(c.Camps.Count);
            if (c.Quests != null && c.Quests.Available)
            {
                sb.Append(",\"quests\":[");
                for (int i = 0; i < c.Quests.Rows.Count; i++)
                {
                    var q = c.Quests.Rows[i]; if (i > 0) sb.Append(',');
                    sb.Append('{'); Common(sb, (uint)i, (float)q.GiverX, (float)q.GiverY);
                    sb.Append(",\"def\":\"").Append(Esc(q.Def)).Append("\",\"state\":").Append((int)q.State).Append(",\"canAccept\":").Append(q.CanAccept ? "true" : "false")
                      .Append(",\"accepted\":").Append(q.OwnerAccepted ? "true" : "false").Append(",\"ready\":").Append(q.OwnerReady ? "true" : "false")
                      .Append(",\"completed\":").Append(q.OwnerCompleted ? "true" : "false").Append(",\"progress\":").Append(q.OwnerProgress).Append('}');
                }
                sb.Append(']');
            }
            if (c.Trade != null && c.Trade.Available)
            {
                sb.Append(",\"merchants\":[");
                for (int i = 0; i < c.Trade.Merchants.Count; i++)
                {
                    var m = c.Trade.Merchants[i]; if (i > 0) sb.Append(',');
                    sb.Append('{'); Common(sb, (uint)i, (float)m.X, (float)m.Y);
                    sb.Append(",\"kind\":").Append((int)m.Kind).Append(",\"name\":\"").Append(Esc(m.Name)).Append("\"}");
                }
                sb.Append(']');
            }
            sb.Append('}');
            RhProbe_Publish(sb.ToString());
        }

        /// <summary>Every active button's screen rectangle (top-left origin) and label, so the harness can click a control by name.</summary>
        string UiButtons()
        {
            var sb = new StringBuilder("["); bool first = true;
            foreach (var b in FindObjectsByType<UnityEngine.UI.Button>(FindObjectsSortMode.None))
            {
                if (b == null || !b.isActiveAndEnabled || !b.gameObject.activeInHierarchy) continue;
                var rt = b.transform as RectTransform; if (rt == null) continue;
                rt.GetWorldCorners(_corners);
                float x = _corners[0].x, w = _corners[2].x - _corners[0].x, h = _corners[1].y - _corners[0].y, y = Screen.height - _corners[1].y;
                if (w < 1f || h < 1f || x > Screen.width || y > Screen.height || x + w < 0 || y + h < 0) continue;
                var label = b.GetComponentInChildren<TMPro.TMP_Text>(false);
                if (!first) sb.Append(','); first = false;
                sb.Append("{\"n\":\"").Append(Esc(b.name)).Append("\",\"p\":\"").Append(Esc(b.transform.parent != null ? b.transform.parent.name : ""))
                  .Append("\",\"i\":").Append(b.interactable ? "true" : "false")
                  .Append(",\"x\":").Append(Num(x)).Append(",\"y\":").Append(Num(y)).Append(",\"w\":").Append(Num(w)).Append(",\"h\":").Append(Num(h))
                  .Append(",\"t\":\"").Append(Esc(label != null ? label.text : "")).Append("\"}");
            }
            return sb.Append(']').ToString();
        }

        void Common(StringBuilder sb, uint id, float x, float y)
        {
            var sp = _mc.Cam.WorldToScreenPoint(ArenaView.WorldPoint(x, y));
            sb.Append("\"id\":").Append(id).Append(",\"x\":").Append(Num(x)).Append(",\"y\":").Append(Num(y))
              .Append(",\"sx\":").Append(Num(sp.x)).Append(",\"sy\":").Append(Num(Screen.height - sp.y));
        }
        static string Num(float v) { return float.IsNaN(v) || float.IsInfinity(v) ? "0" : v.ToString("F1", CultureInfo.InvariantCulture); }
        static string Esc(string v) { return v == null ? "" : v.Replace("\\", "/").Replace("\"", "'").Replace("\n", " ").Replace("\r", " "); }
    }
}

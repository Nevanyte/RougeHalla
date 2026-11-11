using System.Collections.Generic;
using Roguehalla.Net;
using Roguehalla.Net.Protocol;
using Roguehalla.Net.Ui;
using TMPro;
using UnityEngine;

namespace Roguehalla.Client
{
    /// <summary>
    /// "RESPAWN Ns" / "RESPAWN READY" in the world below a cleared camp (legacy CampWards.ts:19-30: 11 px monospace #e5edf7 with a
    /// dark stroke, centred 32 units below the camp). Text comes from the pure <see cref="CampMarks"/> model; labels are pooled and the
    /// text is only rewritten when it changes, so a steady frame allocates nothing. Presentation only.
    /// </summary>
    public sealed class CampRespawnLabels
    {
        const int Order = 29000;
        const float OffsetUnits = 32f;
        readonly Transform _root;
        readonly List<CampWorldLabel> _rows = new List<CampWorldLabel>();
        readonly List<TextMeshPro> _labels = new List<TextMeshPro>();
        public int Used { get; private set; }
        public string TextAt(int i) { return i >= 0 && i < Used ? _labels[i].text : null; }

        public CampRespawnLabels(Transform root) { _root = root; }

        /// <summary>Redraws from the session's camp rows and map; hides every label when there is no map, no rows or the match is not active.</summary>
        public void Update(Session session)
        {
            _rows.Clear();
            if (session != null && session.Map != null && session.State == SessionState.InMatch)
                CampMarks.WorldLabels(session.Map.Camps, session.Collections.Camps, session.ServerTimeMs, !session.Training, _rows);
            Used = _rows.Count;
            for (int i = 0; i < Used; i++)
            {
                var label = Get(i);
                var row = _rows[i];
                if (label.text != row.Text) label.text = row.Text;
                label.transform.position = ArenaView.WorldPoint((float)row.WorldX, (float)row.WorldY + OffsetUnits);
                if (!label.gameObject.activeSelf) label.gameObject.SetActive(true);
            }
            for (int i = Used; i < _labels.Count; i++) if (_labels[i].gameObject.activeSelf) _labels[i].gameObject.SetActive(false);
        }

        TextMeshPro Get(int i)
        {
            while (_labels.Count <= i)
            {
                var go = new GameObject("Camp respawn label"); go.transform.SetParent(_root, false);
                var t = go.AddComponent<TextMeshPro>();
                var font = Resources.Load<TMP_FontAsset>("Showcase/NunitoBold");
                t.font = font != null ? font : TMP_Settings.defaultFontAsset;
                t.alignment = TextAlignmentOptions.Center; t.enableWordWrapping = false;
                t.fontSize = 3.4f; t.color = new Color32(0xe5, 0xed, 0xf7, 255);
                t.fontSharedMaterial = OverheadIndicators.OutlinedMaterial(t.font);
                t.rectTransform.sizeDelta = new Vector2(6f, .6f);
                t.GetComponent<MeshRenderer>().sortingOrder = Order;
                go.SetActive(false);
                _labels.Add(t);
            }
            return _labels[i];
        }
    }
}

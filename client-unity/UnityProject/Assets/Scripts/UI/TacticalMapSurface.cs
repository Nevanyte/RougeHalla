using System;
using System.Collections.Generic;
using Roguehalla.Net;
using Roguehalla.Net.Protocol;
using Roguehalla.Net.Ui;
using UnityEngine;
using UnityEngine.EventSystems;
using UnityEngine.UI;

namespace Roguehalla.Client
{
    /// <summary>One public map projection shared by planning, the tactical map and minimap. No visibility inference.</summary>
    public sealed class TacticalMapSurface : MonoBehaviour, IPointerDownHandler, IPointerUpHandler, IDragHandler
    {
        public Action<Vector2, PointerEventData.InputButton> Pressed;
        public Action<Vector2, PointerEventData.InputButton> Dragged;
        public Action<Vector2, PointerEventData.InputButton> PointerReleased;
        public Action Aborted;
        RawImage _terrain;
        TacticalMapMarks _marks;
        Texture2D _texture;
        MapBlob _map;
        public MapBlob Map => _map;
        public RectTransform Rect => (RectTransform)transform;

        public void Initialize()
        {
            _terrain = gameObject.AddComponent<RawImage>();
            _terrain.color = Color.white;
            _terrain.raycastTarget = true;
            var marks = new GameObject("Delivered contacts and personal route", typeof(RectTransform));
            marks.transform.SetParent(transform, false);
            var r = (RectTransform)marks.transform;
            r.anchorMin = Vector2.zero; r.anchorMax = Vector2.one; r.offsetMin = r.offsetMax = Vector2.zero;
            _marks = marks.AddComponent<TacticalMapMarks>();
            _marks.raycastTarget = false;
        }

        public void SetMap(MapBlob map)
        {
            if (ReferenceEquals(map, _map)) return;
            _map = map;
            if (_texture != null) { if (Application.isPlaying) Destroy(_texture); else DestroyImmediate(_texture); }
            _texture = null; _terrain.texture = null;
            _marks.SetMap(map);
            if (map == null) return;
            _texture = new Texture2D(map.W, map.H, TextureFormat.RGBA32, false) { filterMode = FilterMode.Point, wrapMode = TextureWrapMode.Clamp, name = "Public map terrain" };
            var pixels = new Color32[map.W * map.H];
            for (int y = 0; y < map.H; y++)
                for (int x = 0; x < map.W; x++)
                {
                    byte tile = map.Tiles[y * map.W + x];
                    pixels[(map.H - 1 - y) * map.W + x] = tile == MapBlob.Wall ? new Color32(117, 137, 159, 255) :
                        tile == MapBlob.Low ? new Color32(126, 113, 82, 255) : new Color32(16, 27, 37, 255);
                }
            _texture.SetPixels32(pixels); _texture.Apply(false, true); _terrain.texture = _texture;
            var fit = GetComponent<AspectRatioFitter>() ?? gameObject.AddComponent<AspectRatioFitter>();
            fit.aspectMode = AspectRatioFitter.AspectMode.FitInParent; fit.aspectRatio = (float)map.W / map.H;
        }

        public void Present(Session session, IReadOnlyList<RoutePoint> route)
        {
            _marks.Present(session, route);
        }

        public bool PointerWorld(PointerEventData e, out Vector2 point)
        {
            point = default;
            if (_map == null || !RectTransformUtility.ScreenPointToLocalPointInRectangle(Rect, e.position, e.pressEventCamera, out var p)) return false;
            var rect = Rect.rect;
            float x = Mathf.Clamp01((p.x - rect.xMin) / rect.width), y = Mathf.Clamp01((p.y - rect.yMin) / rect.height);
            point = new Vector2(x * _map.W * 32f, (1 - y) * _map.H * 32f);
            return true;
        }
        public void OnPointerDown(PointerEventData e) { if (PointerWorld(e, out var point)) Pressed?.Invoke(point, e.button); }
        public void OnDrag(PointerEventData e) { if (PointerWorld(e, out var point)) Dragged?.Invoke(point, e.button); }
        public void OnPointerUp(PointerEventData e) { if (PointerWorld(e, out var point)) PointerReleased?.Invoke(point, e.button); }
        void OnDisable() => Aborted?.Invoke();
        void OnApplicationFocus(bool focus) { if (!focus) Aborted?.Invoke(); }
        void OnDestroy() { if (_texture != null) { if (Application.isPlaying) Destroy(_texture); else DestroyImmediate(_texture); } }
    }

}

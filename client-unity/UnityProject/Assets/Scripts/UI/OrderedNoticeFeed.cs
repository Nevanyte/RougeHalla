using System;
using System.Collections.Generic;
using System.Collections.ObjectModel;
using System.Text;
using Roguehalla.Net;
using Roguehalla.Net.Protocol;
using TMPro;
using UnityEngine;

namespace Roguehalla.Client
{
    /// <summary>Transient received-order history. Equal text is still a separate delivered notice.</summary>
    public sealed class OrderedNoticeFeed : MonoBehaviour
    {
        public readonly struct Entry
        {
            public readonly uint Tick;
            public readonly EventKind Kind;
            public readonly string Text;
            public Entry(uint tick, EventKind kind, string text) { Tick = tick; Kind = kind; Text = text; }
        }

        readonly List<Entry> _entries = new List<Entry>();
        readonly StringBuilder _history = new StringBuilder();
        ReadOnlyCollection<Entry> _readOnly;
        RectTransform _root, _recentRoot;
        TMP_Text _body, _recent;
        UnityEngine.UI.ScrollRect _historyScroll, _recentScroll;
        Action _onClose;
        ulong _version = 1, _historyVersion, _recentVersion, _cachedVersion;
        string _cachedText;
        public RectTransform Root => _root;
        public bool IsVisible => _root != null && _root.gameObject.activeSelf;
        public IReadOnlyList<Entry> Entries => _readOnly ?? (_readOnly = _entries.AsReadOnly());

        public void Initialize(Transform parent, Action onClose = null)
        {
            _onClose = onClose;
            _root = MythicUi.Panel(parent, "NoticeHistory", new Vector2(.12f, .12f), new Vector2(.88f, .915f));
            MythicUi.Text(_root, "Title", "SERVER NOTICES", new Vector2(.025f, .915f), new Vector2(.78f, .995f), 25, ShowcasePalette.Gold);
            MythicUi.Button(_root, "Close", "CLOSE", new Vector2(.82f, .92f), new Vector2(.98f, .99f), () => { SetVisible(false); _onClose?.Invoke(); });
            _body = MythicUi.ScrollText(_root, "History", "No server notices received.", new Vector2(.025f, .04f), new Vector2(.975f, .80f), 17);
            _historyScroll = _body.GetComponentInParent<UnityEngine.UI.ScrollRect>();
            _historyScroll.gameObject.AddComponent<KeyboardScrollPane>().Initialize(_historyScroll);
            _recentRoot = MythicUi.Panel(parent, "RecentServerNotices", new Vector2(.405f, .735f), new Vector2(.665f, .845f));
            _recent = MythicUi.ScrollText(_recentRoot, "ReceivedNotices", "", new Vector2(.02f, .03f), new Vector2(.98f, .97f), 14);
            _recentScroll = _recent.GetComponentInParent<UnityEngine.UI.ScrollRect>();
            _recentScroll.gameObject.AddComponent<KeyboardScrollPane>().Initialize(_recentScroll);
            _root.gameObject.SetActive(false); _recentRoot.gameObject.SetActive(false);
        }

        public void SetVisible(bool visible) { if (_root != null) { _root.gameObject.SetActive(visible); Refresh(); } }
        public void SetRecentVisible(bool visible)
        {
            if (_recentRoot != null) _recentRoot.gameObject.SetActive(visible && _entries.Count != 0);
            if (visible) Refresh();
        }
        public void Clear()
        {
            _entries.Clear(); _history.Clear(); _version++;
            _cachedText = "No server notices received."; _cachedVersion = _version;
            if (_body != null) _body.text = _cachedText;
            if (_recent != null) _recent.text = "";
            _historyVersion = _recentVersion = 0;
            if (_recentRoot != null) _recentRoot.gameObject.SetActive(false);
            Refresh();
        }
        public void Append(ServerMsg.Events batch)
        {
            if (batch == null) return;
            int before = _entries.Count;
            foreach (var item in batch.List)
            {
                if (!TryText(item, out var text)) continue;
                _entries.Add(new Entry(batch.Tick, item.Kind, text));
                if (_history.Length != 0) _history.Append('\n');
                _history.Append(_entries.Count).Append(" · ").Append(text);
            }
            if (_entries.Count != before) _version++;
            Refresh();
        }
        public void Refresh()
        {
            if (_body == null) return;
            bool historyChanged = IsVisible && _historyVersion != _version;
            bool recentChanged = _recentRoot.gameObject.activeSelf && _recentVersion != _version;
            if (!historyChanged && !recentChanged) return;
            if (_cachedVersion != _version)
            {
                _cachedText = _entries.Count == 0 ? "No server notices received." : _history.ToString();
                _cachedVersion = _version;
            }
            // Closed history does not force a large TMP layout. All entries remain in the received list.
            if (historyChanged) { SetTextPreservingReader(_body, _historyScroll, _cachedText); _historyVersion = _version; }
            if (recentChanged) { SetTextPreservingReader(_recent, _recentScroll, _cachedText); _recentVersion = _version; }
        }
        static void SetTextPreservingReader(TMP_Text target, UnityEngine.UI.ScrollRect scroll, string text)
        {
            if (target.text == text) return;
            bool tail = scroll.verticalNormalizedPosition <= .01f || target.text.Length == 0;
            Vector2 position = scroll.content.anchoredPosition;
            target.text = text;
            UnityEngine.UI.LayoutRebuilder.ForceRebuildLayoutImmediate(target.rectTransform);
            if (tail) scroll.verticalNormalizedPosition = 0;
            else scroll.content.anchoredPosition = position;
        }
        static bool TryText(WireEvent item, out string text)
        {
            text = null;
            switch (item.Kind)
            {
                case EventKind.Toast: text = item.ToastText; return true;
                case EventKind.PotionNotice: text = PotionNoticeFormatter.Format((PotionNotice)item.PotionNotice); return true;
                case EventKind.PickupRefused: text = "Pickup refused by server (" + item.PickupReason + ")"; return true;
                case EventKind.ChestRefused: text = "Choice refused by server (" + item.ChestReason + ")"; return true;
                case EventKind.WindEmblem: text = "Wind emblem"; return true;
                case EventKind.CannonNotice:
                    // Public protocol codes: sealed, cannot enter, blast, reloading with supplied seconds.
                    text = item.CannonCode == 1 ? "Cannon sealed" : item.CannonCode == 2 ? "Cannot enter cannon" :
                        item.CannonCode == 3 ? "Cannon blast" : "Cannon reloading · " + item.CannonSeconds + "s";
                    return true;
                default: return false;
            }
        }
    }
}

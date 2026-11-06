using System;
using System.Text;
using TMPro;
using UnityEngine;
using UnityEngine.EventSystems;
using UnityEngine.InputSystem;
using UnityEngine.InputSystem.UI;
using Roguehalla.Net;
using Roguehalla.Net.Protocol;

namespace Roguehalla.Client
{
    /// <summary>Displays delivered facts and forwards explicit user intents. Contains no gameplay decisions.</summary>
    public sealed class MatchHud : MonoBehaviour
    {
        MatchClient _client;
        Session _session;
        RectTransform _root, _menu, _hud, _rewards, _results;
        TMP_InputField _nickname;
        TMP_Text _factionLabel, _banner, _vitals, _build, _focusLabel, _rewardTitle, _resultText, _notice;
        readonly UnityEngine.UI.Button[] _options = new UnityEngine.UI.Button[3];
        UnityEngine.UI.Button _skip, _pickup;
        readonly UnityEngine.UI.Button[] _slots = new UnityEngine.UI.Button[2];
        int _faction = 4, _chestIndex;
        RewardChestHandle _shownChest;
        bool _dirty, _rewardsDirty;
        SessionState _bannerState = (SessionState)(-1);
        int _bannerPhase = -1, _bannerAttempt = -1;
        float _lastHp = float.NaN, _lastMaxHp;
        ushort _lastKills, _lastGv;
        ActorStatus _lastStatus;
        WireResult _lastResult;
        string _feedback = "";
        InventoryView? _inventoryShown;
        PropView? _focusShown;
        readonly byte[] _cardsShown = new byte[3], _boostsShown = new byte[8];
        bool _buildShown, _hasBuildShown;
        ulong _rewardSignature = ulong.MaxValue;
        static readonly Color PanelColor = new Color32(17, 24, 34, 242);
        static readonly string[] Factions = { "Fire", "Sentenced", "Plague", "Frost", "Holy" };
        static readonly string[] Phases = { "Lobby — waiting for players", "Match active", "Match ended", "Match closed" };
        static readonly string[] Outcomes = { "Victory", "Draw", "Defeated", "Missing in action" };

        public bool BlocksWorldInput
        {
            get
            {
                if (_menu.gameObject.activeSelf || _results.gameObject.activeSelf || _nickname.isFocused) return true;
                return EventSystem.current != null && EventSystem.current.IsPointerOverGameObject();
            }
        }

        public void Initialize(MatchClient client)
        {
            _client = client; _faction = client.Faction >= 0 && client.Faction < Factions.Length ? client.Faction : 4;
            if (EventSystem.current == null)
                new GameObject("EventSystem", typeof(EventSystem), typeof(InputSystemUIInputModule));
            else if (EventSystem.current.GetComponent<InputSystemUIInputModule>() == null)
            {
                foreach (var module in EventSystem.current.GetComponents<BaseInputModule>()) module.enabled = false;
                EventSystem.current.gameObject.AddComponent<InputSystemUIInputModule>();
            }
            var go = new GameObject("MatchUI", typeof(RectTransform), typeof(Canvas), typeof(UnityEngine.UI.CanvasScaler), typeof(UnityEngine.UI.GraphicRaycaster));
            go.transform.SetParent(transform, false);
            _root = (RectTransform)go.transform;
            go.GetComponent<Canvas>().renderMode = RenderMode.ScreenSpaceOverlay;
            var scaler = go.GetComponent<UnityEngine.UI.CanvasScaler>();
            scaler.uiScaleMode = UnityEngine.UI.CanvasScaler.ScaleMode.ScaleWithScreenSize;
            scaler.referenceResolution = new Vector2(1280, 800); scaler.matchWidthOrHeight = .5f;
            _banner = Text(_root, "Connection", "Choose a faction and join", .02f, .92f, .82f, .99f, 23);
            var leave = Button(_root, "Leave", "Leave / menu", .83f, .93f, .98f, .99f, () => _client.Leave());
            _menu = Panel(_root, "JoinMenu", .22f, .25f, .78f, .82f);
            Text(_menu, "Title", "ROGUEHALLA", .05f, .80f, .95f, .96f, 36);
            Text(_menu, "Intro", "Choose your faction. Survive the arena.", .05f, .67f, .95f, .80f, 20);
            _nickname = Input(_menu, client.Profile, .08f, .49f, .92f, .63f);
            _factionLabel = Text(_menu, "Faction", "", .08f, .33f, .92f, .46f, 23);
            Button(_menu, "Holy", "Holy", .08f, .19f, .34f, .32f, () => SetFaction(4));
            Button(_menu, "Fire", "Fire", .37f, .19f, .63f, .32f, () => SetFaction(0));
            Button(_menu, "Plague", "Plague", .66f, .19f, .92f, .32f, () => SetFaction(2));
            Button(_menu, "Join", "Join match", .25f, .03f, .75f, .16f, () => _client.Join(_nickname.text, _faction));
            SetFaction(_faction);
            _hud = Panel(_root, "PlayerHUD", .02f, .02f, .98f, .23f);
            _vitals = Text(_hud, "Vitals", "Waiting for player state", .02f, .69f, .64f, .98f, 23);
            _slots[0] = Button(_hud, "Slot1", "1 —", .02f, .39f, .19f, .69f, () => Swap(0));
            _slots[1] = Button(_hud, "Slot2", "2 —", .20f, .39f, .37f, .69f, () => Swap(1));
            Button(_hud, "Potion", "E · Use potion", .39f, .39f, .57f, .69f, UsePotion);
            _pickup = Button(_hud, "Pickup", "F · Pick up", .59f, .39f, .77f, .69f, () => _client.PickupFocus());
            _focusLabel = Text(_hud, "Focus", "", .65f, .70f, .98f, .98f, 19);
            _build = Text(_hud, "Build", "Build: awaiting server", .02f, .20f, .98f, .39f, 17);
            Text(_hud, "Controls", "WASD / arrows · move    Click · attack    Right click · move    Shift + right click · attack move    1 / 2 / Q · swap", .02f, .01f, .98f, .19f, 16);
            _notice = Text(_root, "Notice", "", .03f, .24f, .56f, .31f, 19);
            _rewards = Panel(_root, "Rewards", .59f, .34f, .98f, .86f);
            _rewardTitle = Text(_rewards, "RewardTitle", "", .06f, .81f, .94f, .97f, 23);
            for (int i = 0; i < 3; i++)
            {
                sbyte pick = (sbyte)i;
                _options[i] = Button(_rewards, "Option" + i, "", .06f, .59f - i * .18f, .94f, .75f - i * .18f, () => Choose(pick));
            }
            _skip = Button(_rewards, "Skip", "Skip", .06f, .05f, .47f, .19f, () => Choose(-1));
            Button(_rewards, "Next", "Next chest", .51f, .05f, .94f, .19f, () => { _chestIndex++; _dirty = _rewardsDirty = true; });
            _results = Panel(_root, "Results", .22f, .28f, .78f, .85f);
            Text(_results, "ResultsTitle", "RUN RESULTS", .08f, .80f, .92f, .97f, 30);
            _resultText = Text(_results, "ResultFacts", "", .08f, .25f, .92f, .79f, 23);
            Button(_results, "Rejoin", "Play again", .08f, .05f, .48f, .20f, () => _client.Join(_client.Profile, _faction));
            Button(_results, "Menu", "Return to menu", .52f, .05f, .92f, .20f, () => _client.Leave());
            ShowMenu();
        }

        void SetFaction(int value) { _faction = value; _factionLabel.text = "Faction: " + Factions[value]; }
        void Swap(byte slot) { if (Active) _session.Input.Swap(slot); }
        void UsePotion() { if (Active) _session.Input.UseConsumable(); }
        bool Active { get { return _session != null && _session.State == SessionState.InMatch; } }
        void Choose(sbyte pick) { if (Active && _shownChest.IsValid) _session.Input.Choose(_shownChest, pick); }
        public void Bind(Session session)
        {
            Unbind(); _session = session;
            session.StateChanged += Changed; session.SnapshotReceived += Snapshot;
            session.CollectionsChanged += Collections; session.EventsReceived += Events;
            _menu.gameObject.SetActive(false); _hud.gameObject.SetActive(true);
            _results.gameObject.SetActive(false); _rewards.gameObject.SetActive(false);
            _feedback = ""; _lastResult = null; _lastHp = float.NaN; _chestIndex = 0; _shownChest = default;
            _inventoryShown = null; _focusShown = null; _buildShown = false; _rewardSignature = ulong.MaxValue;
            _dirty = _rewardsDirty = true; _bannerState = (SessionState)(-1); _bannerPhase = -1;
            _vitals.text = "Waiting for player state";
            _pickup.interactable = false; _pickup.GetComponentInChildren<TMP_Text>().text = "F · No pickup";
            _focusLabel.text = "Potions: awaiting server";
            _slots[0].GetComponentInChildren<TMP_Text>().text = "1 · awaiting server";
            _slots[1].GetComponentInChildren<TMP_Text>().text = "2 · awaiting server";
            RefreshCollections(session.Collections);
        }
        void Unbind()
        {
            if (_session == null) return;
            _session.StateChanged -= Changed; _session.SnapshotReceived -= Snapshot;
            _session.CollectionsChanged -= Collections; _session.EventsReceived -= Events;
            _session = null;
        }
        public void ShowMenu()
        {
            Unbind(); _menu.gameObject.SetActive(true); _hud.gameObject.SetActive(false);
            _rewards.gameObject.SetActive(false); _results.gameObject.SetActive(false);
            _banner.text = "Choose a faction and join"; _notice.text = "";
        }
        void OnDestroy() { Unbind(); }
        void Changed(SessionState state) { if (_session != null) RefreshCollections(_session.Collections); _dirty = _rewardsDirty = true; }
        void Snapshot(ServerMsg.Snapshot snapshot) { _dirty = true; }
        void Collections(CollectionsView view) { RefreshCollections(view); _dirty = _rewardsDirty = true; }
        void Events(ServerMsg.Events events)
        {
            foreach (var ev in events.List)
            {
                if (ev.Kind == EventKind.PotionNotice) _feedback = "Potion: " + (PotionNotice)ev.PotionNotice;
                else if (ev.Kind == EventKind.PickupRefused) _feedback = "Pickup refused by server (" + ev.PickupReason + ")";
                else if (ev.Kind == EventKind.ChestRefused) _feedback = "Choice refused by server (" + ev.ChestReason + ")";
            }
            _dirty = true;
        }
        void LateUpdate()
        {
            if (_session != null && _session.ReconnectAttempt != _bannerAttempt) _dirty = true;
            if (!_dirty || _session == null) return;
            _dirty = false;
            int phase = _session.Snapshots.Newest == null ? -1 : _session.Snapshots.Newest.Phase;
            string banner = _banner.text;
            if (_bannerState != _session.State || _bannerPhase != phase || _bannerAttempt != _session.ReconnectAttempt)
            {
            if (_session.State == SessionState.InMatch)
            {
                var latest = _session.Snapshots.Newest;
                banner = latest == null ? "Joined — waiting for arena state" : Phases[latest.Phase];
                if (_session.Me == null && latest != null) banner += " · Spectating";
            }
            else if (_session.State == SessionState.Reconnecting || _session.State == SessionState.HelloSent && _session.ReconnectAttempt > 0)
                banner = "Connection interrupted · resuming seat (attempt " + _session.ReconnectAttempt + ")";
            else if (_session.State == SessionState.Rejected) banner = "Join rejected: " + _session.RejectReason;
            else if (_session.State == SessionState.Failed) banner = "Connection failed: " + _session.Error;
            else banner = _session.State.ToString();
            Set(_banner, banner); _bannerState = _session.State; _bannerPhase = phase; _bannerAttempt = _session.ReconnectAttempt;
            }
            Set(_notice, _feedback);
            var me = _session.Me;
            if (me == null) { Set(_vitals, "Waiting / spectating"); _lastHp = float.NaN; }
            if (me != null && (me.Hp != _lastHp || me.MaxHp != _lastMaxHp || me.Kills != _lastKills || me.Gv != _lastGv || me.Status != _lastStatus))
            {
                Set(_vitals, "HP " + me.Hp.ToString("0.#") + " / " + me.MaxHp.ToString("0.#") + "   Kills " + me.Kills + "   GV " + me.Gv + "   " + me.Status);
                _lastHp = me.Hp; _lastMaxHp = me.MaxHp; _lastKills = me.Kills; _lastGv = me.Gv; _lastStatus = me.Status;
            }
            if (_rewardsDirty) { _rewardsDirty = false; RefreshRewards(); }
            if (_session.LastResult != null && !ReferenceEquals(_lastResult, _session.LastResult))
            {
                _lastResult = _session.LastResult; var r = _lastResult;
                _resultText.text = (r.Outcome < Outcomes.Length ? Outcomes[r.Outcome] : "Outcome " + r.Outcome) + "\nPlace " + r.Place + " / " + r.Players + " · " + r.Kills + " kills\nGV " + r.GvTotal + " (win " + r.GvWin + ")\nDuration " + r.DurationSec + "s" + (string.IsNullOrEmpty(r.KilledBy) ? "" : "\nKilled by " + r.KilledBy) + (r.WinBonusWithheld ? "\nWin bonus withheld by server" : "");
                _results.gameObject.SetActive(true); _rewards.gameObject.SetActive(false);
            }
            if ((_session.State == SessionState.Failed || _session.State == SessionState.Rejected || _session.State == SessionState.Ended) && _session.LastResult == null)
            {
                _resultText.text = banner + "\nNo authoritative result received.";
                _results.gameObject.SetActive(true);
            }
        }
        void RefreshCollections(CollectionsView view)
        {
            if (!view.Inventory.HasValue)
            {
                _inventoryShown = null;
                Set(_slots[0].GetComponentInChildren<TMP_Text>(), "1 · awaiting server");
                Set(_slots[1].GetComponentInChildren<TMP_Text>(), "2 · awaiting server");
                Set(_focusLabel, "Potions: awaiting server");
            }
            if (view.Inventory.HasValue && (!_inventoryShown.HasValue ||
                view.Inventory.Value.ActiveSlot != _inventoryShown.Value.ActiveSlot || view.Inventory.Value.Slot0 != _inventoryShown.Value.Slot0 ||
                view.Inventory.Value.Slot1 != _inventoryShown.Value.Slot1 || view.Inventory.Value.PotionSmall != _inventoryShown.Value.PotionSmall ||
                view.Inventory.Value.PotionsHealing != _inventoryShown.Value.PotionsHealing))
            {
                var inv = view.Inventory.Value; _inventoryShown = inv;
                Set(_slots[0].GetComponentInChildren<TMP_Text>(), "1 · " + (inv.Slot0.HasValue ? inv.Slot0.ToString() : "Empty") + (inv.ActiveSlot == 0 ? " [active]" : ""));
                Set(_slots[1].GetComponentInChildren<TMP_Text>(), "2 · " + (inv.Slot1.HasValue ? inv.Slot1.ToString() : "Empty") + (inv.ActiveSlot == 1 ? " [active]" : ""));
                Set(_focusLabel, "Potions " + inv.PotionSmall + " small / " + inv.PotionsHealing + " healing");
            }
            if (view.Focus.HasValue != _focusShown.HasValue || view.Focus.HasValue &&
                (!view.Focus.Value.Handle.Equals(_focusShown.Value.Handle) || view.Focus.Value.Weapon != _focusShown.Value.Weapon || view.Focus.Value.Kind != _focusShown.Value.Kind))
            {
                _focusShown = view.Focus;
                _pickup.interactable = view.Focus.HasValue;
                Set(_pickup.GetComponentInChildren<TMP_Text>(), view.Focus.HasValue ? "F · " + (view.Focus.Value.Weapon.HasValue ? view.Focus.Value.Weapon.ToString() : view.Focus.Value.Kind.ToString()) : "F · No pickup");
            }
            bool buildChanged = !_buildShown || _hasBuildShown != view.HasBuild;
            for (int i = 0; i < _cardsShown.Length; i++)
            { byte value = i < view.Cards.Count ? view.Cards[i] : (byte)0; if (_cardsShown[i] != value) buildChanged = true; _cardsShown[i] = value; }
            for (int i = 0; i < _boostsShown.Length; i++)
            { byte value = i < view.Boosts.Count ? view.Boosts[i] : (byte)0; if (_boostsShown[i] != value) buildChanged = true; _boostsShown[i] = value; }
            if (!buildChanged) return;
            _buildShown = true; _hasBuildShown = view.HasBuild;
            var text = new StringBuilder("Build: "); bool any = false;
            for (int i = 0; i < view.Cards.Count; i++) if (view.Cards[i] > 0) { text.Append((CardId)i).Append('×').Append(view.Cards[i]).Append("  "); any = true; }
            for (int i = 0; i < view.Boosts.Count; i++) if (view.Boosts[i] > 0) { text.Append((BoostId)i).Append('+').Append(view.Boosts[i]).Append("  "); any = true; }
            if (!any) text.Append(view.HasBuild ? "None" : "awaiting server");
            Set(_build, text.ToString());
        }
        void RefreshRewards()
        {
            var chests = _session.Collections.RewardChests;
            bool show = chests.Count > 0 && !_results.gameObject.activeSelf;
            _rewards.gameObject.SetActive(show);
            if (!show) return;
            _chestIndex %= chests.Count;
            var chest = chests[_chestIndex]; _shownChest = chest.Handle;
            // A presentation cache only; all option eligibility comes directly from the server.
            ulong signature = chest.Handle.Value;
            unchecked
            {
                signature = signature * 397 ^ (ulong)chests.Count;
                signature = signature * 397 ^ (ulong)_chestIndex;
                signature = signature * 397 ^ (chest.Picked ? 1UL : 0UL);
                signature = signature * 397 ^ (chest.CanChoose ? 1UL : 0UL);
                signature = signature * 397 ^ (Active ? 1UL : 0UL);
                foreach (var option in chest.Options)
                {
                    signature = signature * 397 ^ (ulong)(option.Card.HasValue ? (int)option.Card.Value + 1 : 0);
                    signature = signature * 397 ^ (ulong)(option.Boost.HasValue ? (int)option.Boost.Value + 1 : 0);
                    signature = signature * 397 ^ (option.Taken ? 1UL : 0UL);
                }
            }
            if (_rewardSignature == signature) return;
            _rewardSignature = signature;
            Set(_rewardTitle, "Chest " + (_chestIndex + 1) + " / " + chests.Count + (chest.Picked ? " · chosen" : chest.CanChoose ? " · choose reward" : " · unavailable"));
            for (int i = 0; i < _options.Length; i++)
            {
                _options[i].gameObject.SetActive(i < chest.Options.Count);
                if (i >= chest.Options.Count) continue;
                var option = chest.Options[i];
                Set(_options[i].GetComponentInChildren<TMP_Text>(), (option.Card.HasValue ? option.Card.ToString() : option.Boost.ToString()) + (option.Taken ? " · taken" : ""));
                _options[i].interactable = Active && chest.CanChoose && !chest.Picked && !option.Taken;
            }
            _skip.interactable = Active && chest.CanChoose && !chest.Picked;
        }
        static void Set(TMP_Text text, string value) { if (text.text != value) text.text = value; }
        static RectTransform Rect(Transform parent, string name, float x0, float y0, float x1, float y1)
        {
            var rect = (RectTransform)new GameObject(name, typeof(RectTransform)).transform;
            rect.SetParent(parent, false); rect.anchorMin = new Vector2(x0, y0); rect.anchorMax = new Vector2(x1, y1);
            rect.offsetMin = rect.offsetMax = Vector2.zero; return rect;
        }
        static RectTransform Panel(Transform parent, string name, float x0, float y0, float x1, float y1)
        {
            var r = Rect(parent, name, x0, y0, x1, y1);
            var image = r.gameObject.AddComponent<UnityEngine.UI.Image>(); image.color = PanelColor; image.raycastTarget = true;
            return r;
        }
        static TMP_Text Text(Transform parent, string name, string text, float x0, float y0, float x1, float y1, int size)
        {
            var r = Rect(parent, name, x0, y0, x1, y1);
            var label = r.gameObject.AddComponent<TextMeshProUGUI>();
            label.font = TMP_Settings.defaultFontAsset != null ? TMP_Settings.defaultFontAsset : Resources.Load<TMP_FontAsset>("Fonts & Materials/LiberationSans SDF");
            label.text = text; label.fontSize = size; label.color = Color.white;
            label.alignment = TextAlignmentOptions.MidlineLeft; label.raycastTarget = false; label.richText = false;
            label.enableAutoSizing = true; label.fontSizeMin = size * .75f; label.fontSizeMax = size;
            return label;
        }
        static UnityEngine.UI.Button Button(Transform parent, string name, string text, float x0, float y0, float x1, float y1, UnityEngine.Events.UnityAction action)
        {
            var r = Panel(parent, name, x0, y0, x1, y1);
            r.GetComponent<UnityEngine.UI.Image>().color = new Color32(44, 67, 83, 255);
            var button = r.gameObject.AddComponent<UnityEngine.UI.Button>();
            button.targetGraphic = r.GetComponent<UnityEngine.UI.Image>(); button.onClick.AddListener(action);
            var label = Text(r, "Label", text, .04f, .05f, .96f, .95f, 20); label.alignment = TextAlignmentOptions.Center;
            var colors = button.colors; colors.highlightedColor = new Color(.65f, .87f, 1f); colors.disabledColor = new Color(.42f, .45f, .48f); button.colors = colors;
            return button;
        }
        static TMP_InputField Input(Transform parent, string value, float x0, float y0, float x1, float y1)
        {
            var r = Panel(parent, "Nickname", x0, y0, x1, y1);
            var viewport = Rect(r, "Viewport", .04f, .02f, .96f, .98f);
            viewport.gameObject.AddComponent<UnityEngine.UI.RectMask2D>();
            var label = Text(viewport, "Text", "", 0, 0, 1, 1, 24);
            var input = r.gameObject.AddComponent<TMP_InputField>();
            input.textViewport = viewport; input.textComponent = (TextMeshProUGUI)label;
            input.characterLimit = 32; input.lineType = TMP_InputField.LineType.SingleLine; input.text = value;
            return input;
        }
    }
}

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
    public sealed partial class MatchHud : MonoBehaviour
    {
        MatchClient _client;
        Session _session;
        RectTransform _root, _menu, _hud, _rewards, _results, _settings;
        TMP_InputField _nickname;
        TMP_Text _factionLabel, _banner, _vitals, _build, _focusLabel, _wishCard, _rewardTitle, _resultTitle, _resultText, _notice;
        RectTransform _healthBarFill, _barrierBarFill;
        readonly UnityEngine.UI.Button[] _options = new UnityEngine.UI.Button[3];
        UnityEngine.UI.Button _skip, _pickup;
        ShowcaseSettings _showcaseSettings;
        ShowcaseAudio _showcaseAudio;
        readonly System.Collections.Generic.List<TMP_Text> _scaledText = new System.Collections.Generic.List<TMP_Text>();
        readonly System.Collections.Generic.List<float> _textBaseSize = new System.Collections.Generic.List<float>();
        readonly UnityEngine.UI.Button[] _slots = new UnityEngine.UI.Button[2];
        int _faction = 4, _chestIndex;
        RewardChestHandle _shownChest;
        bool _dirty, _rewardsDirty;
        SessionState _bannerState = (SessionState)(-1);
        int _bannerPhase = -1, _bannerAttempt = -1;
        float _lastHp = float.NaN, _lastMaxHp;
        WishView? _lastWish;
        float _lastBarrier = float.NaN;
        byte _lastBarrierRing;
        double _lastServerTime = double.NaN;
        ushort _lastKills, _lastGv;
        ActorStatus _lastStatus;
        WireResult _lastResult;
        string _feedback = "";
        InventoryView? _inventoryShown;
        PropView? _focusShown;
        byte[] _cardsShown = Array.Empty<byte>();
        readonly byte[] _boostsShown = new byte[8];
        bool _buildShown, _hasBuildShown;
        ulong _rewardSignature = ulong.MaxValue;
        static readonly string[] Factions = { "Fire", "Sentenced", "Plague", "Frost", "Holy" };
        static readonly string[] Phases = { "Lobby — waiting for players", "Match active", "Match ended", "Planning — choose your spawn" };
        static readonly string[] Outcomes = { "Victory", "Draw", "Defeated", "Missing in action" };

        public bool BlocksWorldInput => BlocksKeyboardInput || BlocksPointerInput;

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
            _showcaseSettings = go.AddComponent<ShowcaseSettings>();
            _showcaseAudio = go.AddComponent<ShowcaseAudio>();
            _showcaseSettings.Changed += ApplyTextScale;
            go.GetComponent<Canvas>().renderMode = RenderMode.ScreenSpaceOverlay;
            var scaler = go.GetComponent<UnityEngine.UI.CanvasScaler>();
            scaler.uiScaleMode = UnityEngine.UI.CanvasScaler.ScaleMode.ScaleWithScreenSize;
            scaler.referenceResolution = new Vector2(1920, 1080); scaler.matchWidthOrHeight = .5f;
            _banner = Text(_root, "Connection", "Choose a faction and join", .02f, .925f, .30f, .99f, 15);
            Button(_root, "Settings", "SETTINGS", .68f, .93f, .82f, .99f, ToggleSettings);
            var leave = Button(_root, "Leave", "Leave / menu", .83f, .93f, .98f, .99f, () => _client.Leave());
            CreateJoinMenu();
            SetFaction(_faction);
            CreateCombatHud();
            _notice = Text(_root, "Notice", "", .32f, .25f, .78f, .32f, 19);
            _rewards = Panel(_root, "Rewards", .59f, .34f, .98f, .86f);
            _rewardTitle = Text(_rewards, "RewardTitle", "", .06f, .81f, .94f, .97f, 23);
            _rewardTitle.color = ShowcasePalette.Gold;
            for (int i = 0; i < 3; i++)
            {
                sbyte pick = (sbyte)i;
                _options[i] = Button(_rewards, "Option" + i, "", .06f, .59f - i * .18f, .94f, .75f - i * .18f, () => Choose(pick));
            }
            _skip = Button(_rewards, "Skip", "Skip", .06f, .05f, .47f, .19f, () => Choose(-1));
            Button(_rewards, "Next", "Next chest", .51f, .05f, .94f, .19f, () => { _chestIndex++; _dirty = _rewardsDirty = true; });
            _results = Panel(_root, "Results", .22f, .28f, .78f, .85f);
            _resultTitle = Text(_results, "ResultsTitle", "RUN RESULTS", .08f, .80f, .92f, .97f, 30);
            _resultTitle.color = ShowcasePalette.Gold;
            _resultText = MythicUi.ScrollText(_results, "ResultFacts", "", new Vector2(.08f, .25f), new Vector2(.92f, .79f), 23);
            Button(_results, "Rejoin", "Play again", .08f, .05f, .48f, .20f, JoinAgain);
            Button(_results, "Menu", "Return to menu", .52f, .05f, .92f, .20f, () => _client.Leave());
            InitializeFeatures();
            ShowMenu();
        }

        void SetFaction(int value)
        {
            _faction = value;
            _client?.SelectFaction(value);
            _atrium?.SetFaction(value);
            _hubGuide?.SetFaction(value);
            _factionLabel.text = "FACTION  " + ShowcasePalette.GetFactionMark(value) + "  " + Factions[value].ToUpperInvariant();
            _factionLabel.color = ShowcasePalette.Faction(value);
        }

        void ToggleSettings()
        {
            _showcaseAudio?.UnlockFromUserGesture();
            bool show = !_modernSettings.IsVisible;
            if (show) { SetSignInVisible(false); _hubGuide?.SetVisible(false); _drawer?.SetVisible(false); _help?.gameObject.SetActive(false); _map?.SetOpen(false); }
            _modernSettings.SetVisible(show);
        }

        void JoinAgain()
        {
            if (_showcaseAudio != null) _showcaseAudio.UnlockFromUserGesture();
            _client.Join(_client.Profile, _faction);
        }

        void ApplyTextScale()
        {
            float scale = _showcaseSettings != null ? _showcaseSettings.TextScale : 1f;
            for (int i = 0; i < _scaledText.Count; i++)
            {
                if (_scaledText[i] == null) continue;
                _scaledText[i].fontSize = _textBaseSize[i] * scale;
                _scaledText[i].fontSizeMin = _textBaseSize[i] * .75f * scale;
                _scaledText[i].fontSizeMax = _textBaseSize[i] * scale;
            }
            MythicUi.ApplyTextScale(_root, scale);
            _hubGuide?.RefreshScale(scale);
        }
        void Swap(byte slot) { if (Active) _session.Input.Swap(slot); EventSystem.current?.SetSelectedGameObject(null); }
        void UsePotion() { if (Active) _session.Input.UseConsumable(); EventSystem.current?.SetSelectedGameObject(null); }
        bool Active { get { return _session != null && _session.State == SessionState.InMatch; } }
        void Choose(sbyte pick)
        {
            if (!Active || !_shownChest.IsValid || (pick >= 0 && !_options[pick].interactable) || (pick < 0 && !_skip.interactable)) return;
            _session.Input.Choose(_shownChest, pick);
            ReleaseChestFocus();
        }
        public void Bind(Session session)
        {
            Unbind(); _session = session;
            session.StateChanged += Changed; session.SnapshotReceived += Snapshot;
            session.CollectionsChanged += Collections; session.EventsReceived += Events;
            _menu.gameObject.SetActive(false); _hud.gameObject.SetActive(true); _settings.gameObject.SetActive(false);
            SetSignInVisible(false); _hubGuide?.SetVisible(false);
            _results.gameObject.SetActive(false); _rewards.gameObject.SetActive(false);
            _feedback = ""; _lastResult = null; _lastHp = float.NaN; _chestIndex = 0; _shownChest = default;
            _lastWish = null; _lastBarrier = float.NaN; _lastBarrierRing = 0; _lastServerTime = double.NaN;
            _inventoryShown = null; _focusShown = null; _buildShown = false; _rewardSignature = ulong.MaxValue;
            _dirty = _rewardsDirty = true; _bannerState = (SessionState)(-1); _bannerPhase = -1;
            ClearOwnerPresentation("Awaiting server");
            _pickup.interactable = false; _pickup.GetComponentInChildren<TMP_Text>().text = "F · No pickup";
            _focusLabel.text = "Potions: awaiting server";
            _slots[0].GetComponentInChildren<TMP_Text>().text = "1 · —";
            _slots[1].GetComponentInChildren<TMP_Text>().text = "2 · —";
            RefreshCollections(session.Collections);
            _map?.Bind(session);
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
            _rewards.gameObject.SetActive(false); _results.gameObject.SetActive(false); _settings.gameObject.SetActive(false);
            ClearOwnerPresentation("Awaiting server");
            _banner.text = "Choose a faction and join"; _notice.text = "";
            _map?.Bind(null); _drawer?.SetVisible(false); ReleaseChestFocus();
        }

        /// <summary>Clears ephemeral notices and redraws owner facts after an accepted presentation clock cut.</summary>
        public void ResetTransientPresentation()
        {
            _feedback = "";
            Set(_notice, "");
            if (_session == null) ClearOwnerPresentation("Awaiting server");
            else if (_session.Me == null) ClearOwnerPresentation(_session.Latest == null ? "Awaiting server" : "Unavailable");
            else RefreshOwnerPresentation(_session.Me, _session.ServerTimeMs);
            _dirty = true;
        }

        void OnDestroy() { Unbind(); if (_uiPrefs != null) _uiPrefs.Changed -= ApplyDisplayPreferences; UiBrowserStorage.CaptureTab(false); }
        void Changed(SessionState state) { if (_session != null) RefreshCollections(_session.Collections); _dirty = _rewardsDirty = true; }
        void Snapshot(ServerMsg.Snapshot snapshot) { _dirty = true; }
        void Collections(CollectionsView view) { RefreshCollections(view); _dirty = _rewardsDirty = true; }
        void Events(ServerMsg.Events events)
        {
            foreach (var ev in events.List)
            {
                if (ev.Kind == EventKind.PotionNotice) _feedback = PotionNoticeFormatter.Format((PotionNotice)ev.PotionNotice);
                else if (ev.Kind == EventKind.PickupRefused) _feedback = "Pickup refused by server (" + ev.PickupReason + ")";
                else if (ev.Kind == EventKind.ChestRefused) _feedback = "Choice refused by server (" + ev.ChestReason + ")";
            }
            _dirty = true;
        }
        void LateUpdate()
        {
            TickFeatures();
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
            if (me == null)
            {
                ClearOwnerPresentation(_session.Latest == null ? "Awaiting server" : "Unavailable");
            }
            else
            {
                RefreshOwnerPresentation(me, _session.ServerTimeMs);
            }
            if (_rewardsDirty) { _rewardsDirty = false; RefreshRewards(); }
            if (_session.LastResult != null && !ReferenceEquals(_lastResult, _session.LastResult))
            {
                _lastResult = _session.LastResult; var r = _lastResult;
                _client?.RefreshAccountAfterResult();
                _resultTitle.color = r.Outcome == 0 ? ShowcasePalette.Gold : r.Outcome == 2 ? ShowcasePalette.Warning : ShowcasePalette.Text;
                _resultText.text = (r.Outcome < Outcomes.Length ? Outcomes[r.Outcome] : "Outcome " + r.Outcome) + "\nPlace " + r.Place + " / " + r.Players + " · " + r.Kills + " kills\nGV " + r.GvTotal + " (win " + r.GvWin + ")\nDuration " + r.DurationSec + "s" + (string.IsNullOrEmpty(r.KilledBy) ? "" : "\nKilled by " + r.KilledBy) + (r.WinBonusWithheld ? "\nWin bonus withheld by server" : "");
                _results.gameObject.SetActive(true); _rewards.gameObject.SetActive(false);
            }
            if ((_session.State == SessionState.Failed || _session.State == SessionState.Rejected || _session.State == SessionState.Ended) && _session.LastResult == null)
            {
                _resultText.text = banner + "\nNo authoritative result received.";
                _resultTitle.color = ShowcasePalette.Warning;
                _results.gameObject.SetActive(true);
            }
        }
        /// <summary>Renders only delivered owner facts; the accepted server clock is used for elapsed-time labels.</summary>
        internal void RefreshOwnerPresentation(SelfView me, double serverTimeMs)
        {
            if (me.Hp != _lastHp || me.MaxHp != _lastMaxHp || me.Kills != _lastKills || me.Gv != _lastGv || me.Status != _lastStatus || me.Barrier != _lastBarrier || me.BarrierRingStep != _lastBarrierRing)
            {
                Set(_vitals, "HP " + me.Hp.ToString("0.#") + " / " + me.MaxHp.ToString("0.#") + " · Barrier " + me.Barrier.ToString("0.#") + "\nKills " + me.Kills + " · GV " + me.Gv + " · " + me.Status);
                _lastHp = me.Hp; _lastMaxHp = me.MaxHp; _lastKills = me.Kills; _lastGv = me.Gv; _lastStatus = me.Status; _lastBarrier = me.Barrier; _lastBarrierRing = me.BarrierRingStep;
                OwnerVitalBars.Percent(me, out float healthPercent, out float barrierPercent);
                float healthEnd = healthPercent / 100f;
                float barrierEnd = (healthPercent + barrierPercent) / 100f;
                _healthBarFill.anchorMax = new Vector2(healthEnd, 1f);
                _barrierBarFill.anchorMin = new Vector2(healthEnd, 0f);
                _barrierBarFill.anchorMax = new Vector2(barrierEnd, 1f);
            }
            bool wishChanged = _lastWish.HasValue != me.Wish.HasValue;
            if (!wishChanged && me.Wish.HasValue && _lastWish.HasValue) wishChanged = !WishEquals(me.Wish.Value, _lastWish.Value);
            if (wishChanged || serverTimeMs != _lastServerTime)
            {
                Set(_wishCard, FormatWishCard(me.Wish, serverTimeMs));
                _lastWish = me.Wish; _lastServerTime = serverTimeMs;
            }
        }

        internal void ClearOwnerPresentation(string reason)
        {
            _lastHp = float.NaN; _lastBarrier = 0f; _lastBarrierRing = 0; _lastWish = null; _lastServerTime = double.NaN;
            Set(_vitals, reason == "Unavailable" ? "Waiting / spectating" : "Waiting for player state");
            Set(_wishCard, "R · WISH\n" + reason);
            if (_healthBarFill != null) _healthBarFill.anchorMax = Vector2.zero;
            if (_barrierBarFill != null) { _barrierBarFill.anchorMin = Vector2.zero; _barrierBarFill.anchorMax = Vector2.zero; }
        }

        internal static string FormatWishCard(WishView? wish, double serverTimeMs)
        {
            if (!wish.HasValue) return "R · WISH\nNone delivered";
            var w = wish.Value;
            var text = new StringBuilder("R · ").Append(w.Ability).Append(" · ").Append(w.Charges).Append('/').Append(w.MaxCharges);
            text.Append(" charges\nWish timer: ").Append(FormatSeconds(w.ReadyAt - serverTimeMs));
            text.Append("\nRecharge ").Append(FormatSeconds(w.RechargeMs));
            if (w.NextChargeAt.HasValue) text.Append("\nNext charge in ").Append(FormatSeconds(w.NextChargeAt.Value - serverTimeMs));
            if (w.FullAt.HasValue) text.Append("\nFull charges in ").Append(FormatSeconds(w.FullAt.Value - serverTimeMs));
            if (w.Cast.HasValue)
            {
                var cast = w.Cast.Value;
                text.Append("\nCasting ").Append(cast.Ability).Append(" · ").Append(FormatSeconds(cast.LandsAt - serverTimeMs));
            }
            return text.ToString();
        }

        static string FormatSeconds(double remainingMs)
        {
            double seconds = Math.Max(0d, Math.Ceiling(remainingMs / 100d) / 10d);
            return seconds.ToString("0.0", System.Globalization.CultureInfo.InvariantCulture) + "s";
        }

        static bool WishEquals(WishView a, WishView b)
        {
            if (a.Ability != b.Ability || a.ReadyAt != b.ReadyAt || a.FullAt != b.FullAt || a.MaxCharges != b.MaxCharges || a.RechargeMs != b.RechargeMs || a.Charges != b.Charges || a.NextChargeAt != b.NextChargeAt || a.Cast.HasValue != b.Cast.HasValue) return false;
            return !a.Cast.HasValue || a.Cast.Value.Ability == b.Cast.Value.Ability && a.Cast.Value.StartedAt == b.Cast.Value.StartedAt && a.Cast.Value.LandsAt == b.Cast.Value.LandsAt;
        }
        void RefreshCollections(CollectionsView view)
        {
            RefreshBuildIcons(view);
            if (!view.Inventory.HasValue)
            {
                _inventoryShown = null;
                Set(_slots[0].GetComponentInChildren<TMP_Text>(), "1 · —");
                Set(_slots[1].GetComponentInChildren<TMP_Text>(), "2 · —");
                Set(_focusLabel, "Potions: awaiting server");
            }
            if (view.Inventory.HasValue && (!_inventoryShown.HasValue ||
                view.Inventory.Value.ActiveSlot != _inventoryShown.Value.ActiveSlot || view.Inventory.Value.Slot0 != _inventoryShown.Value.Slot0 ||
                view.Inventory.Value.Slot1 != _inventoryShown.Value.Slot1 || view.Inventory.Value.PotionSmall != _inventoryShown.Value.PotionSmall ||
                view.Inventory.Value.PotionLarge != _inventoryShown.Value.PotionLarge ||
                view.Inventory.Value.PotionsHealing != _inventoryShown.Value.PotionsHealing))
            {
                var inv = view.Inventory.Value; _inventoryShown = inv;
                Set(_slots[0].GetComponentInChildren<TMP_Text>(), "1 · " + (inv.Slot0.HasValue ? inv.Slot0.ToString() : "Empty") + "");
                Set(_slots[1].GetComponentInChildren<TMP_Text>(), "2 · " + (inv.Slot1.HasValue ? inv.Slot1.ToString() : "Empty") + "");
                Set(_focusLabel, "Potions " + inv.PotionSmall + " small / " + inv.PotionLarge + " camp / " + inv.PotionsHealing + " healing");
            }
            if (view.Focus.HasValue != _focusShown.HasValue || view.Focus.HasValue &&
                (!view.Focus.Value.Handle.Equals(_focusShown.Value.Handle) || view.Focus.Value.Weapon != _focusShown.Value.Weapon || view.Focus.Value.Kind != _focusShown.Value.Kind))
            {
                _focusShown = view.Focus;
                _pickup.interactable = view.Focus.HasValue;
                Set(_pickup.GetComponentInChildren<TMP_Text>(), view.Focus.HasValue ? "F · " + (view.Focus.Value.Weapon.HasValue ? view.Focus.Value.Weapon.ToString() : view.Focus.Value.Kind.ToString()) : "F · No pickup");
            }
            bool buildChanged = !_buildShown || _hasBuildShown != view.HasBuild;
            if (_cardsShown.Length != view.Cards.Count)
            {
                _cardsShown = new byte[view.Cards.Count];
                buildChanged = true;
            }
            for (int i = 0; i < _cardsShown.Length; i++)
            { byte value = i < view.Cards.Count ? view.Cards[i] : (byte)0; if (_cardsShown[i] != value) buildChanged = true; _cardsShown[i] = value; }
            for (int i = 0; i < _boostsShown.Length; i++)
            { byte value = i < view.Boosts.Count ? view.Boosts[i] : (byte)0; if (_boostsShown[i] != value) buildChanged = true; _boostsShown[i] = value; }
            if (!buildChanged) return;
            _buildShown = true; _hasBuildShown = view.HasBuild;
            var text = new StringBuilder("BUILD  "); bool any = false;
            for (int i = 0; i < view.Cards.Count; i++) if (view.Cards[i] > 0) { text.Append(CardDisplayCatalog.Title((byte)i)).Append('×').Append(view.Cards[i]).Append("  "); any = true; }
            for (int i = 0; i < view.Boosts.Count; i++) if (view.Boosts[i] > 0) { text.Append((BoostId)i).Append('+').Append(view.Boosts[i]).Append("  "); any = true; }
            if (!any) text.Append(view.HasBuild ? "None" : "awaiting server");
            Set(_build, any ? "B · BUILD DETAILS · " + CountCards(view) + " card stacks" : text.ToString());
        }
        void RefreshRewards()
        {
            var chests = _session.Collections.RewardChests;
            bool show = chests.Count > 0 && !_results.gameObject.activeSelf;
            _rewards.gameObject.SetActive(show);
            if (!show) { _shownChest = default; ReleaseChestFocus(); return; }
            _chestIndex %= chests.Count;
            var chest = chests[_chestIndex]; if (!_shownChest.Equals(chest.Handle)) ReleaseChestFocus(); _shownChest = chest.Handle;
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
                    signature = signature * 397 ^ (ulong)(option.KillKey.HasValue ? (int)option.KillKey.Value + 1 : 0);
                    signature = signature * 397 ^ unchecked((ulong)BitConverter.DoubleToInt64Bits(option.KillGain));
                    signature = signature * 397 ^ (option.Taken ? 1UL : 0UL);
                }
            }
            if (_rewardSignature == signature) return;
            _rewardSignature = signature;
            bool trophy = false;
            foreach (var option in chest.Options) trophy |= option.KillKey.HasValue;
            Set(_rewardTitle, (trophy ? "Trophy " : "Chest ") + (_chestIndex + 1) + " / " + chests.Count + (chest.Picked ? " · chosen" : chest.CanChoose ? " · choose reward" : " · unavailable"));
            for (int i = 0; i < _options.Length; i++)
            {
                _options[i].gameObject.SetActive(i < chest.Options.Count);
                if (i >= chest.Options.Count) continue;
                var option = chest.Options[i];
                string label = option.KillKey.HasValue ? TrophyText.Title(option.KillKey.Value, option.KillGain)
                    : option.Card.HasValue ? CardDisplayCatalog.Title((byte)option.Card.Value) : option.Boost.ToString();
                Set(_options[i].GetComponentInChildren<TMP_Text>(), label + (option.Taken ? " · taken" : ""));
                _options[i].interactable = Active && chest.CanChoose && !chest.Picked && !option.Taken;
                _options[i].GetComponentInChildren<TMP_Text>().color = option.Taken ? ShowcasePalette.Success :
                    _options[i].interactable ? ShowcasePalette.Gold : ShowcasePalette.MutedText;
            }
            _skip.interactable = Active && chest.CanChoose && !chest.Picked;
        }
        static void Set(TMP_Text text, string value) { if (text != null && text.text != value) text.text = value; }
        static RectTransform Rect(Transform parent, string name, float x0, float y0, float x1, float y1)
        {
            var rect = (RectTransform)new GameObject(name, typeof(RectTransform)).transform;
            rect.SetParent(parent, false); rect.anchorMin = new Vector2(x0, y0); rect.anchorMax = new Vector2(x1, y1);
            rect.offsetMin = rect.offsetMax = Vector2.zero; return rect;
        }
        static RectTransform Panel(Transform parent, string name, float x0, float y0, float x1, float y1)
        {
            var r = Rect(parent, name, x0, y0, x1, y1);
            var image = r.gameObject.AddComponent<UnityEngine.UI.Image>(); image.color = ShowcasePalette.Panel; image.raycastTarget = true;
            var outline = r.gameObject.AddComponent<UnityEngine.UI.Outline>();
            outline.effectColor = new Color32(126, 96, 51, 220); outline.effectDistance = new Vector2(1f, -1f); outline.useGraphicAlpha = true;
            if (name == "JoinMenu" || name == "PlayerHUD" || name == "Rewards" || name == "Results" || name == "SettingsPanel")
                AddCornerOrnaments(r);
            return r;
        }

        static void AddCornerOrnaments(RectTransform panel)
        {
            // Fine, non-interactive corner strokes frame the panels without covering content or stealing clicks.
            const float length = .026f, thickness = .0025f;
            AddOrnament(panel, "OrnamentTLH", 0, 1 - thickness, length, 1);
            AddOrnament(panel, "OrnamentTLV", 0, 1 - length, thickness, 1);
            AddOrnament(panel, "OrnamentTRH", 1 - length, 1 - thickness, 1, 1);
            AddOrnament(panel, "OrnamentTRV", 1 - thickness, 1 - length, 1, 1);
            AddOrnament(panel, "OrnamentBLH", 0, 0, length, thickness);
            AddOrnament(panel, "OrnamentBLV", 0, 0, thickness, length);
            AddOrnament(panel, "OrnamentBRH", 1 - length, 0, 1, thickness);
            AddOrnament(panel, "OrnamentBRV", 1 - thickness, 0, 1, length);
        }

        static void AddOrnament(Transform parent, string name, float x0, float y0, float x1, float y1)
        {
            var rect = Rect(parent, name, x0, y0, x1, y1);
            var image = rect.gameObject.AddComponent<UnityEngine.UI.Image>();
            image.color = new Color32(156, 119, 62, 225);
            image.raycastTarget = false;
        }
        TMP_Text Text(Transform parent, string name, string text, float x0, float y0, float x1, float y1, int size)
        {
            size = Mathf.RoundToInt(size * 1.5f);
            var r = Rect(parent, name, x0, y0, x1, y1);
            var label = r.gameObject.AddComponent<TextMeshProUGUI>();
            bool decorativeTitle = name == "Title" || name == "RewardTitle" || name == "ResultsTitle" || name == "SettingsTitle";
            var bodyFont = Resources.Load<TMP_FontAsset>("Fonts & Materials/LiberationSans SDF");
            var titleFont = decorativeTitle ? Resources.Load<TMP_FontAsset>("Showcase/CinzelDecorative") : null;
            label.font = titleFont != null ? titleFont : bodyFont != null ? bodyFont : TMP_Settings.defaultFontAsset;
            label.text = text; label.fontSize = size * (_showcaseSettings != null ? _showcaseSettings.TextScale : 1f); label.color = ShowcasePalette.Text;
            if (decorativeTitle) label.characterSpacing = 2.0f;
            label.alignment = TextAlignmentOptions.MidlineLeft; label.raycastTarget = false; label.richText = false;
            label.enableAutoSizing = true; label.fontSizeMin = size * .75f * (_showcaseSettings != null ? _showcaseSettings.TextScale : 1f); label.fontSizeMax = size * (_showcaseSettings != null ? _showcaseSettings.TextScale : 1f);
            _scaledText.Add(label); _textBaseSize.Add(size);
            return label;
        }
        UnityEngine.UI.Button Button(Transform parent, string name, string text, float x0, float y0, float x1, float y1, UnityEngine.Events.UnityAction action)
        {
            var r = Panel(parent, name, x0, y0, x1, y1);
            var background = r.GetComponent<UnityEngine.UI.Image>();
            background.color = Color.white;
            var button = r.gameObject.AddComponent<UnityEngine.UI.Button>();
            button.targetGraphic = background; button.onClick.AddListener(action);
            var label = Text(r, "Label", text, .04f, .05f, .96f, .95f, 20); label.alignment = TextAlignmentOptions.Center;
            var colors = button.colors;
            colors.normalColor = ShowcasePalette.PanelRaised;
            colors.highlightedColor = new Color32(73, 67, 52, 255);
            colors.selectedColor = new Color32(86, 70, 46, 255);
            colors.pressedColor = new Color32(96, 69, 31, 255);
            colors.disabledColor = new Color32(37, 43, 51, 255);
            colors.fadeDuration = .12f;
            button.colors = colors;
            return button;
        }
        TMP_InputField Input(Transform parent, string value, float x0, float y0, float x1, float y1)
        {
            var r = Panel(parent, "Nickname", x0, y0, x1, y1);
            var viewport = Rect(r, "Viewport", .04f, .02f, .96f, .98f);
            viewport.gameObject.AddComponent<UnityEngine.UI.RectMask2D>();
            var label = Text(viewport, "Text", "", 0, 0, 1, 1, 24);
            var input = r.gameObject.AddComponent<TMP_InputField>();
            input.textViewport = viewport; input.textComponent = (TextMeshProUGUI)label;
            input.characterLimit = 16; input.lineType = TMP_InputField.LineType.SingleLine; input.text = value;
            return input;
        }
    }
}

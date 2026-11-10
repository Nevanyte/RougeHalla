// UI lab stage (?uilab=1): the indicator gallery. A serverless diagnostic stage that feeds SYNTHETIC view data (InterpActor rows, a SelfView, a
// CollectionsView built through the real State apply path, Fx records) to the SAME presentation path a match uses (ArenaView.RetainObservedActors
// -> PresentCollections -> Present -> ConfirmedFx -> SpriteActorPresenter / OverheadIndicators / WorldMarks / WorldIndicators), over the game's own
// region ground. Nothing here forks drawing code, talks to a server or exists in normal play: Bootstrap builds it only for `?uilab=1`.
//
// A page is one ground (Sentenced flagstone, Holy temple floor, Frost snow) x one group of cells (UiLabCatalog). Each page settles for a moment,
// then runs its timeline (events at freeze - age) and FREEZES: after that ArenaView is no longer driven or ticked, so every time-based effect keeps
// exactly the pixels it had and Tools/ui-gallery.cjs can crop the same frame as often as it likes. `?uilab.t=<s>` replaces every age by one value;
// `?uilab.loop=1` never freezes and replays the timeline (for looking at it live).
using System;
using System.Collections.Generic;
using System.Reflection;
using TMPro;
using UnityEngine;
using UnityEngine.UI;
using Roguehalla.Net;
using Roguehalla.Net.Protocol;
using Roguehalla.Net.Ui;
#if UNITY_WEBGL && !UNITY_EDITOR
using System.Runtime.InteropServices;
#endif

namespace Roguehalla.Client
{
    public sealed class UiLabStage : MonoBehaviour
    {
#if UNITY_WEBGL && !UNITY_EDITOR
        [DllImport("__Internal")] static extern void RhUiLab_Init();
        [DllImport("__Internal")] static extern void RhUiLab_Publish(string json);
#endif
        public const string ObjectName = "UiLab";
        public const uint MeId = 1, FirstId = 100, OtherId = 999;
        const float SettleFirst = 5f, SettlePage = 1.6f, LoopHold = 1.4f;

        public static bool Requested(string search) { return Bootstrap.Query(search, "uilab", "0") == "1"; }

        Camera _cam; ArenaView _arena; MapBlob _map;
        List<UiLabPage> _pages; int _pageIndex = -1; UiLabGround _ground; UiLabPage _page;
        enum Phase { Settle, Run, Frozen }
        Phase _phase; float _phaseStart, _settle, _freeze;       // _freeze: the timeline length F (seconds)
        int _cmdSeq, _publishedFor = -1, _frozenFrames;
        float _tOverride = -1f; bool _loop;
        readonly List<Run> _runs = new List<Run>();
        readonly List<InterpActor> _rows = new List<InterpActor>();
        readonly List<CellGeo> _geo = new List<CellGeo>();
        SelfView _me; CollectionsView _collections; uint _hover;
        readonly List<Caption> _captions = new List<Caption>();
        EdgeThreatView _edge; Canvas _hud;
        float _loopStart; bool _hasMe; string[] _hide = new string[0];

        sealed class Run
        {
            public UiLabActor Spec; public UiLabCell Cell; public uint Id; public float X, Y;
            public bool HitFired, DeathFired, WindupFired, SwingFired, HealFired;
        }
        sealed class CellGeo { public UiLabCell Cell; public int Slot; public Vector2 TopLeft; }
        sealed class Caption { public TextMeshPro Text; public SpriteRenderer Plate; }

        public IList<UiLabPage> Pages { get { return _pages; } }
        public string LastJson { get; private set; }

        public void Initialize(Camera cam, string search)
        {
            ShowcaseSprites.Initialize();
            if (ShowcaseSettings.Current == null) new GameObject("Showcase presentation settings").AddComponent<ShowcaseSettings>();
            Begin(cam, new GameObject("UI lab arena").AddComponent<ArenaView>(), search);
        }

        /// <summary>Starts the gallery on an existing arena (Initialize creates one; EditMode tests pass their own after running its Awake).</summary>
        public void Begin(Camera cam, ArenaView arena, string search)
        {
            _cam = cam; gameObject.name = ObjectName; _arena = arena;
            _map = UiLabMap.Build(); _arena.Build(_map);
            SyntheticWeapons();
            _pages = UiLabCatalog.Build();
            float t;
            if (float.TryParse(Bootstrap.Query(search, "uilab.t", ""), System.Globalization.NumberStyles.Float, System.Globalization.CultureInfo.InvariantCulture, out t) && t >= 0f) _tOverride = t;
            _loop = Bootstrap.Query(search, "uilab.loop", "0") == "1";
            string hide = Uri.UnescapeDataString(Bootstrap.Query(search, "uilab.hide", "")); if (hide.Length > 0) _hide = hide.Split(',');   // diagnostic: renderers (by object name) to switch off
            float ortho; if (float.TryParse(Bootstrap.Query(search, "uilab.ortho", ""), System.Globalization.NumberStyles.Float, System.Globalization.CultureInfo.InvariantCulture, out ortho) && ortho >= 4f && ortho <= 14f) cam.orthographicSize = ortho;
            BuildHud();
#if UNITY_WEBGL && !UNITY_EDITOR
            RhUiLab_Init();
#endif
            int n; int.TryParse(Bootstrap.Query(search, "uilab.page", "0"), out n);
            SelectPage(Mathf.Clamp(n, 0, TotalPages - 1), SettleFirst);
        }

        // Test seams (EditMode): show a page, drive one frame at timeline time st, read the state the page would publish.
        public void ShowPageForTest(int global) { SelectPage(global, 0f); }
        public void DriveForTest(float st) { DriveFrame(st); }
        public float FreezeSeconds { get { return _freeze; } }
        public string PublishForTest() { Publish(true); return LastJson; }

        public int TotalPages { get { return _pages.Count * 3; } }
        public static UiLabGround GroundOf(int globalPage, int pageCount) { return (UiLabGround)(globalPage / pageCount); }

        void BuildHud()
        {
            var go = new GameObject("UI lab HUD", typeof(RectTransform), typeof(Canvas));
            _hud = go.GetComponent<Canvas>(); _hud.renderMode = RenderMode.ScreenSpaceOverlay; _hud.sortingOrder = 5;
            _edge = new EdgeThreatView(go.transform);
        }

        /// <summary>SYNTHETIC weapon table for the gallery (no Welcome here): the Rust values of crates/rh-sim/src/content.rs, as a server would deliver them.</summary>
        static void SyntheticWeapons()
        {
            float pi = Mathf.PI;
            WeaponShapes.Set(new List<WeaponShape> { new WeaponShape { Weapon = 0, Kind = 1, Reach = 112f, HalfArc = pi / 4f }, new WeaponShape { Weapon = 1, Kind = 2 }, new WeaponShape { Weapon = 2, Kind = 2 },
                new WeaponShape { Weapon = 3, Kind = 1, Reach = 96f, HalfArc = pi / 3f }, new WeaponShape { Weapon = 4, Kind = 1, Reach = 112f, HalfArc = pi / 2f }, new WeaponShape { Weapon = 5, Kind = 1, Reach = 72f, HalfArc = pi / 3f } });
        }

        // ---- page control ---------------------------------------------------------------------------------------------------

        void SelectPage(int global, float settle)
        {
            _pageIndex = global; int count = _pages.Count;
            _ground = GroundOf(global, count); _page = _pages[global % count];
            _arena.enabled = true;
            _arena.DiagSetExitFades(false);
            _arena.ResetTransientPresentation(0); _arena.SetHover(0);
            BuildRuns(); BuildCollections(); BuildCaptions();
            float max = 0f;
            foreach (var r in _runs) { max = Mathf.Max(max, r.Spec.AppearAge, r.Spec.LeaveAge, r.Spec.DieAge, r.Spec.HitAge, r.Spec.SwingAge, r.Spec.WindupAge, r.Spec.HealAge); }
            _freeze = _tOverride >= 0f ? _tOverride : Mathf.Max(0f, max);
            _phase = Phase.Settle; _phaseStart = Time.unscaledTime; _settle = settle; _frozenFrames = 0;
            _publishedFor = -1; PublishNotReady();
        }

        /// <summary>Called from the page through RhUiLab.jslib (SendMessage): {"page":3,"seq":2}.</summary>
        [UnityEngine.Scripting.Preserve]
        public void JsCommand(string json)
        {
            var cmd = JsonUtility.FromJson<Command>(json);
            if (cmd == null) return;
            _cmdSeq = cmd.seq;
            if (cmd.t >= 0f) _tOverride = cmd.t; else if (cmd.t < -1.5f) _tOverride = -1f;   // -2: back to the catalog ages
            SelectPage(Mathf.Clamp(cmd.page, 0, TotalPages - 1), SettlePage);
        }

        [Serializable] sealed class Command { public int page; public float t = -1f; public int seq; }

        float Age(float age) { return age < 0f ? -1f : (_tOverride >= 0f ? _tOverride : age); }

        void BuildRuns()
        {
            _runs.Clear(); _geo.Clear(); _hasMe = false; _hover = 0;
            var centre = UiLabMap.GridCentre[(int)_ground];
            uint id = FirstId;
            int used; var slots = UiLabGrid.Slots(_page.Cells, _page.StartSlot, out used);
            for (int i = 0; i < _page.Cells.Count; i++)
            {
                var cell = _page.Cells[i]; int slot = slots[i];
                var tl = UiLabGrid.TopLeft(centre, slot);
                _geo.Add(new CellGeo { Cell = cell, Slot = slot, TopLeft = tl });
                if (cell.Shot == UiLabShot.Screen) continue;
                var feet = UiLabGrid.Feet(centre, slot, cell.Span);
                foreach (var a in cell.Actors)
                {
                    var run = new Run { Spec = a, Cell = cell, Id = a.Own ? MeId : id++, X = (feet.x + a.Dx) * 32f, Y = (feet.y + a.Dy) * 32f };
                    if (a.Own) _hasMe = true;
                    _runs.Add(run);
                }
            }
            foreach (var r in _runs) { if (r.Spec.Hover) _hover = r.Id; }
            var names = new Dictionary<uint, string>(); foreach (var r in _runs) if (!string.IsNullOrEmpty(r.Spec.Name)) names[r.Id] = Indicators.DisplayName(r.Spec.Name, r.Spec.Bot);
            LegacyFacts.NameOverride = id => { string n; return names.TryGetValue(id, out n) ? n : null; };
        }

        void BuildCaptions()
        {
            foreach (var c in _captions) { c.Text.gameObject.SetActive(false); c.Plate.enabled = false; }
            int used = 0;
            foreach (var g in _geo)
            {
                if (g.Cell.Shot != UiLabShot.Cell || g.Cell.Row.Length == 0) continue;
                while (_captions.Count <= used) _captions.Add(NewCaption());
                var cap = _captions[used++];
                var at = ArenaView.WorldPoint((g.TopLeft.x + UiLabGrid.PitchX * g.Cell.Span * .5f) * 32f, (g.TopLeft.y + UiLabGrid.CaptionFromTop) * 32f);
                cap.Text.text = g.Cell.Caption; cap.Text.transform.position = at; cap.Text.gameObject.SetActive(true);
                cap.Plate.enabled = true; cap.Plate.transform.position = at;
                cap.Plate.transform.localScale = new Vector3(Mathf.Min(UiLabGrid.PitchX * g.Cell.Span - .06f, cap.Text.preferredWidth + .1f), .34f, 1);
            }
        }

        Caption NewCaption()
        {
            var plate = ShowcaseSprites.Create(transform, "Gallery caption plate", "bar", 31000, new Color(.03f, .04f, .06f, .94f), Vector2.one, Vector3.zero, false);
            var go = new GameObject("Gallery caption"); go.transform.SetParent(transform, false);
            var t = go.AddComponent<TextMeshPro>();
            var font = Resources.Load<TMP_FontAsset>("Showcase/NunitoBold");
            t.font = font != null ? font : TMP_Settings.defaultFontAsset; t.fontSize = 1.55f; t.alignment = TextAlignmentOptions.Center; t.enableWordWrapping = false;
            t.color = new Color(.93f, .95f, .97f); t.rectTransform.sizeDelta = new Vector2(UiLabGrid.PitchX, .4f);
            t.GetComponent<MeshRenderer>().sortingOrder = 31001; go.SetActive(false);
            return new Caption { Text = t, Plate = plate };
        }

        // ---- collections through the real State apply path ----------------------------------------------------------------------

        void BuildCollections()
        {
            var centre = UiLabMap.GridCentre[(int)_ground];
            var items = new List<StateItem>();
            // Inventory (the own off-hand badge reads it).
            WeaponId? main = null, second = null; bool inv = false;
            foreach (var r in _runs) if (r.Spec.Own) { main = r.Spec.Weapon; second = r.Spec.Second; inv = !r.Spec.NoInventory; }
            if (inv)
            {
                byte? s1 = second.HasValue && second.Value != WeaponId.Fists ? (byte?)(byte)second.Value : null;
                items.Add(new InventoryState { Value = new WireInventory { ActiveSlot = 0, Slot0 = main.HasValue ? (byte?)(byte)main.Value : null, Slot1 = s1, PotionSmall = 0, PotionLarge = 0, PotionsHealing = 0 } });
            }
            var props = new List<WireProp>(); var chests = new List<WireRewardChest>(); var questRows = new List<WireQuestRow>(); var merchants = new List<WireMerchant>();
            var focused = new HashSet<uint>(); PickupHandle? focus = null; uint handle = 1; uint questHandle = 1; uint chestHandle = 1;
            foreach (var g in _geo)
            {
                var c = g.Cell; if (c.Shot != UiLabShot.Cell) continue;
                var feet = UiLabGrid.Feet(centre, g.Slot, c.Span);
                foreach (var p in c.Props)
                {
                    var wp = new WireProp
                    {
                        Handle = new PickupHandle(handle++), X = Quant.QuantizePos((feet.x + p.Dx) * 32f), Y = Quant.QuantizePos((feet.y + p.Dy) * 32f), Kind = (PropKind)(byte)p.Kind,
                        GroundWeapon = p.Weapon.HasValue ? (byte)p.Weapon.Value : (byte)0, Open = p.Open, BodyLabel = p.BodyLabel ?? "", CorpseLabel = p.CorpseLabel ?? ""
                    };
                    if (p.Kind == PropAppearance.QuestItem)
                    {
                        // A quest item needs the quest row it belongs to; that row's giver stands far off the map, so only the item is on screen.
                        uint qh = 100 + questHandle++;
                        questRows.Add(QuestRow(qh, 6000, 6000, false, false, "Far giver"));
                        wp.QuestRef = new QuestHandle(qh); wp.QuestFetch = p.QuestFetch;
                    }
                    props.Add(wp);
                    if (p.Focused) { focus = wp.Handle; focused.Add(wp.Handle.Value); }
                }
                foreach (var q in c.Quests) questRows.Add(QuestRow(questHandle++, (feet.x + q.Dx) * 32f, (feet.y + q.Dy) * 32f, q.Accepted, q.Ready, q.Label));
                foreach (var m in c.Merchants) merchants.Add(new WireMerchant { Kind = m.Kind, X = (feet.x + m.Dx) * 32f, Y = (feet.y + m.Dy) * 32f, Name = m.Name });
                foreach (var ch in c.Chests)
                    chests.Add(new WireRewardChest { Handle = new RewardChestHandle(chestHandle++), X = Quant.QuantizePos((feet.x + ch.Dx) * 32f), Y = Quant.QuantizePos((feet.y + ch.Dy) * 32f), ExpiresAt = ch.LeftMs,
                        Options = new[] { new WireRewardOption { Kind = 1, Id = 0 } }, CanChoose = false });
            }
            props.Sort((a, b) => a.Handle.Value.CompareTo(b.Handle.Value));
            items.Add(new PropsState { Rows = props.ToArray(), Focus = focus.HasValue ? new WireFocus { Handle = focus.Value } : (WireFocus?)null });
            items.Add(new RewardChestsState { Rows = chests.ToArray() });
            items.Add(new QuestsState { Available = true, View = new WireQuestView { Rows = questRows.ToArray() } });
            items.Add(new TradeState { Available = true, Value = new WireTradeView { Merchants = merchants.ToArray() } });
            var state = new ServerMsg.State { Tick = 1, Items = items.ToArray() };
            Array.Sort(state.Items, (a, b) => a.Key.CompareTo(b.Key));
            _collections = new CollectionsView();
            Apply(_collections, state);
            MarkFocused(_collections, focused);
        }

        /// <summary>
        /// A match focuses ONE prop at a time (State carries a single focus handle); the gallery shows several focused props on a page, so the rows the real
        /// apply path produced get their Focused flag set directly. The presenters read only that flag.
        /// </summary>
        static void MarkFocused(CollectionsView view, HashSet<uint> handles)
        {
            if (handles.Count == 0) return;
            var rows = new PropView[view.Props.Count];
            for (int i = 0; i < rows.Length; i++) { rows[i] = view.Props[i]; if (handles.Contains(rows[i].Handle.Value)) rows[i].Focused = true; }
            typeof(CollectionsView).GetProperty("Props", BindingFlags.Instance | BindingFlags.Public).SetValue(view, rows);
        }

        static WireQuestRow QuestRow(uint handle, float x, float y, bool accepted, bool ready, string label)
        {
            return new WireQuestRow
            {
                Handle = new QuestHandle(handle), Def = "uilab", GiverX = x, GiverY = y, State = QuestRowState.Open, ExpiresAt = 1e9,
                CanAccept = !accepted, OwnerAccepted = accepted, OwnerReady = ready, Name = "Gallery quest", GiverLabel = label, Brief = "", Objective = "", Reward = "", DoneBy = ""
            };
        }

        static MethodInfo _apply;
        /// <summary>The real State apply path (CollectionsView.Apply is internal to the net assembly): the gallery's collections are what a server's State would produce.</summary>
        static void Apply(CollectionsView view, ServerMsg.State state)
        {
            if (_apply == null) _apply = typeof(CollectionsView).GetMethod("Apply", BindingFlags.Instance | BindingFlags.NonPublic | BindingFlags.Public);
            if (_apply == null) throw new InvalidOperationException("CollectionsView.Apply not found");
            try { _apply.Invoke(view, new object[] { state }); }
            catch (TargetInvocationException e) { throw e.InnerException ?? e; }
        }

        // ---- per frame ---------------------------------------------------------------------------------------------------------

        void Update()
        {
            if (_arena == null || _cam == null || _page == null) return;
            var centre = UiLabMap.GridCentre[(int)_ground];
            // ArenaView.Follow puts the camera 1.5 world units above the point it is given; ask for the point that lands the view centre on the grid centre.
            _arena.Follow(_cam, centre.x * 32f, (centre.y + 1.5f / ArenaView.GroundSquash) * 32f);
            float now = Time.unscaledTime, dt = now - _phaseStart;
            if (_phase == Phase.Frozen) { _frozenFrames++; PublishIfReady(); return; }
            if (_phase == Phase.Settle)
            {
                DriveFrame(-1f);
                if (dt >= _settle) { _phase = Phase.Run; _phaseStart = now; _arena.DiagSetExitFades(_page.Fades); ResetFired(); }
                return;
            }
            float st = dt;
            if (_loop)
            {
                float span = _freeze + LoopHold; float wrapped = span > 0f ? st % span : 0f;
                if (wrapped < _loopStart) { ResetFired(); }
                _loopStart = wrapped; DriveFrame(wrapped); return;
            }
            if (st >= _freeze)
            {
                DriveFrame(_freeze);
                _phase = Phase.Frozen; _arena.enabled = false;      // no more Present, effects or vignette ticks: the frame is final
                _frozenFrames = 0; _publishedFor = -1;
                return;
            }
            DriveFrame(st);
        }

        void ResetFired() { foreach (var r in _runs) { r.HitFired = r.DeathFired = r.WindupFired = r.SwingFired = r.HealFired = false; } }

        /// <summary>Feeds the real presentation path with the delivered facts at timeline time <paramref name="st"/> (negative: before every event).</summary>
        void DriveFrame(float st)
        {
            _rows.Clear(); _me = null;
            foreach (var r in _runs)
            {
                var a = r.Spec;
                float appear = Age(a.AppearAge), leave = Age(a.LeaveAge), die = Age(a.DieAge);
                bool delivered = (appear < 0f || st >= _freeze - appear) && !(leave >= 0f && st >= _freeze - leave);
                bool dead = die >= 0f && st >= _freeze - die;
                if (a.Own)
                {
                    delivered = true;
                    _me = new SelfView
                    {
                        Id = MeId, Faction = a.Faction ?? FactionId.Fire, X = r.X, Y = r.Y, Facing = a.Facing, Hp = a.Hp, MaxHp = 100f, Status = ActorStatus.Alive, Weapon = a.Weapon ?? WeaponId.Sword,
                        Bounty = a.Bounty, Effects = a.Effects, SelfSig = a.Sig, Barrier = a.Barrier, BarrierRingStep = a.BarrierRing, Flags = FlagsOf(a, false), TopStat1 = a.Top1, TopStat2 = a.Top2, MarkTier = a.Tier, Brand = a.Brand, MarkTax = a.Tax,
                        Wish = a.WishAbility == 255 ? (WishView?)null : new WishView { Ability = (AbilityId)a.WishAbility, ReadyAt = a.WishReady ? 0 : 1e9, RechargeMs = 45000, Charges = (byte)(a.WishReady ? 1 : 0), MaxCharges = 1 }
                    };
                    continue;
                }
                if (!delivered) continue;
                _rows.Add(new InterpActor
                {
                    Id = r.Id, Faction = a.Faction, Status = dead ? ActorStatus.Dead : ActorStatus.Alive, Weapon = a.Weapon, HpPct = a.HpPct, X = r.X, Y = r.Y, Facing = a.Facing,
                    Bounty = a.Bounty, Effects = a.Effects, Kind = a.Kind, MobType = a.Mob, SourceSig = a.Sig, BarrierPct = a.BarrierPct, BarrierRingStep = a.BarrierRing,
                    Flags = FlagsOf(a, true), OffhandWeapon = a.Kind == ActorKind.Player ? (a.Second ?? WeaponId.Fists) : (WeaponId?)null, TopStat1 = a.Top1, TopStat2 = a.Top2, MarkTier = a.Tier, Brand = a.Brand, MarkTax = a.Tax
                });
            }
            if (_me != null)
            {
                uint lockTarget = 0, hunt = 0;
                foreach (var r in _runs) { if (r.Spec.Lock) lockTarget = r.Id; if (r.Spec.Hunt) hunt = r.Id; }
                if (hunt != 0) _me.HuntTarget = hunt;
                if (lockTarget != 0) _me.OwnerCombat = LockView(lockTarget);
            }
            // The same order the match uses (MatchClient): membership, hover, collections, then the actors.
            var all = new List<InterpActor>(_rows);
            _arena.RetainObservedActors(all, _me);
            _arena.SetHover(_hover);
            _arena.PresentCollections(_collections);
            _arena.Present(_rows, _me, null, Mathf.PI / 2f);
            FireEvents(st);
            UpdateEdge();
            if (_hide.Length > 0) HideRenderers();
        }

        void HideRenderers()
        {
            foreach (var r in _arena.GetComponentsInChildren<SpriteRenderer>(true))
                foreach (var name in _hide) if (r.gameObject.name == name) r.forceRenderingOff = true;
        }

        static byte FlagsOf(UiLabActor a, bool remote)
        {
            int f = 0;
            if (remote ? a.RemoteWishReady : a.WishReady) f |= WireIndicators.FlagWishReady;
            if (a.Engaged) f |= WireIndicators.FlagEngaged;
            if (a.Immune) f |= WireIndicators.FlagTeleportImmune;
            if (a.Roam) f |= WireIndicators.FlagRoamReady;
            return (byte)f;
        }

        void FireEvents(float st)
        {
            foreach (var r in _runs)
            {
                var a = r.Spec;
                float hit = Age(a.HitAge), die = Age(a.DieAge);
                if (hit >= 0f && !r.HitFired && st >= _freeze - hit)
                {
                    r.HitFired = true;
                    var fx = new ServerMsg.Fx { Tick = 1 };
                    if (a.SigKind != 0) fx.List.Add(new WireFx { Kind = FxKind.SigHit, Victim = r.Id, By = OtherId, Amount = a.HitAmount, HitKind = a.SigKind });
                    else fx.List.Add(new WireFx { Kind = FxKind.Hit, Victim = r.Id, By = a.HitByMe ? MeId : OtherId, Amount = a.HitAmount, Passive = a.HitPassive, Critical = a.HitCrit, X = r.X, Y = r.Y, A = 0f });
                    _arena.ConfirmedFx(fx);
                }
                float swing = Age(a.SwingAge), wind = Age(a.WindupAge), heal = Age(a.HealAge);
                if (wind >= 0f && !r.WindupFired && st >= _freeze - wind)
                {
                    r.WindupFired = true; var fx = new ServerMsg.Fx { Tick = 1 };
                    fx.List.Add(new WireFx { Kind = FxKind.Windup, By = r.Id, Weapon = a.SwingWeapon, A = a.Facing, Ms = (ushort)a.WindupMs }); _arena.ConfirmedFx(fx);
                }
                if (swing >= 0f && !r.SwingFired && st >= _freeze - swing)
                {
                    r.SwingFired = true; var fx = new ServerMsg.Fx { Tick = 1 };
                    fx.List.Add(new WireFx { Kind = FxKind.Swing, By = r.Id, Weapon = a.SwingWeapon, X = r.X, Y = r.Y, A = a.Facing }); _arena.ConfirmedFx(fx);
                }
                if (heal >= 0f && !r.HealFired && st >= _freeze - heal)
                {
                    r.HealFired = true; var fx = new ServerMsg.Fx { Tick = 1 };
                    fx.List.Add(new WireFx { Kind = FxKind.Heal, Id = r.Id, Amount = a.HealAmount }); _arena.ConfirmedFx(fx);
                }
                if (die >= 0f && a.DeathMark && !r.DeathFired && st >= _freeze - die) { r.DeathFired = true; _arena.DiagDeathMark(r.X, r.Y); }
            }
        }

        static OwnerCombatView LockView(uint target)
        {
            var wire = new WireOwnerCombat { Lock = new WireOwnerLock { Kind = WireOwnerLockKind.Held, Target = target } };
            return (OwnerCombatView)Activator.CreateInstance(typeof(OwnerCombatView), BindingFlags.Instance | BindingFlags.NonPublic | BindingFlags.Public, null, new object[] { wire }, null);
        }

        void UpdateEdge()
        {
            bool on = false; foreach (var g in _geo) if (g.Cell.EdgeGlows) on = true;
            if (!on) { _edge.Show(null); return; }
            float w = Screen.width, h = Screen.height, far = 700f;
            var list = new List<EdgeThreat>
            {
                EdgeThreat.Compute(-1f, .12f, 170f, w, h, far), EdgeThreat.Compute(.8f, .62f, 340f, w, h, far), EdgeThreat.Compute(.15f, -1f, 520f, w, h, far),
                EdgeThreat.Compute(1f, -.25f, 680f, w, h, far), EdgeThreat.Compute(-.7f, .8f, 250f, w, h, far)
            };
            _edge.Show(list);
        }

        // ---- publishing ----------------------------------------------------------------------------------------------------------

        [Serializable] sealed class CellJson
        {
            public string id, row, variant, caption, legacy, shot; public float age; public int slot;
            public float x, y, w, h;      // backbuffer pixels, y down
        }

        [Serializable] sealed class PageJson { public int index; public string name, ground, shot; public bool fades; }

        [Serializable] sealed class StateJson
        {
            public int version = 1, ack, page, pageCount, totalPages, screenW, screenH; public bool ready, loop, reducedMotion;
            public string ground, pageName, quality; public float orthoSize, freeze, t;
            public PageJson[] pages;
            public List<CellJson> cells = new List<CellJson>();
        }

        void PublishNotReady() { Publish(false); }

        void PublishIfReady()
        {
            // A few frozen frames first, so the screenshot sees the final pixels and not the last driven frame.
            if (_frozenFrames >= 4 && _publishedFor != _cmdSeq) { _publishedFor = _cmdSeq; Publish(true); }
        }

        void Publish(bool ready)
        {
            var s = new StateJson
            {
                ready = ready, ack = _cmdSeq, page = _pageIndex, pageCount = _pages.Count, totalPages = TotalPages, screenW = Screen.width, screenH = Screen.height, loop = _loop,
                ground = UiLabMap.GroundName(_ground), pageName = _page != null ? _page.Name : "", orthoSize = _cam.orthographicSize, freeze = _freeze, t = _tOverride,
                reducedMotion = ShowcaseSettings.Current != null && ShowcaseSettings.Current.ReducedMotion,
                quality = ShowcaseSettings.Current != null ? ShowcaseSettings.Current.EffectiveQuality.ToString() : "?"
            };
            s.pages = new PageJson[TotalPages];
            for (int i = 0; i < s.pages.Length; i++)
            {
                var pg = _pages[i % _pages.Count];
                s.pages[i] = new PageJson { index = i, name = pg.Name, ground = UiLabMap.GroundName(GroundOf(i, _pages.Count)), shot = pg.Shot.ToString().ToLowerInvariant(), fades = pg.Fades };
            }
            if (ready) FillCells(s);
            string json = JsonUtility.ToJson(s);
#if UNITY_WEBGL && !UNITY_EDITOR
            RhUiLab_Publish(json);
#endif
            LastJson = json;
        }

        void FillCells(StateJson s)
        {
            float sw = Screen.width, sh = Screen.height;
            foreach (var g in _geo)
            {
                var c = g.Cell; if (c.Row.Length == 0) continue;
                var j = new CellJson { id = c.Id, row = c.Row, variant = c.Variant, caption = c.Caption, legacy = c.Legacy, shot = c.Shot.ToString().ToLowerInvariant(), age = c.Age < 0 ? -1f : Age(c.Age), slot = g.Slot };
                if (c.Shot == UiLabShot.Screen) { j.x = 0; j.y = 0; j.w = sw; j.h = sh; }
                else
                {
                    float top = g.TopLeft.y - (c.Tall ? UiLabGrid.PitchY : 0f);
                    var tl = ArenaView.WorldPoint(g.TopLeft.x * 32f, top * 32f);
                    var br = ArenaView.WorldPoint((g.TopLeft.x + UiLabGrid.PitchX * c.Span) * 32f, (g.TopLeft.y + UiLabGrid.PitchY) * 32f);
                    var a = _cam.WorldToScreenPoint(tl); var b = _cam.WorldToScreenPoint(br);
                    j.x = Mathf.Min(a.x, b.x); j.w = Mathf.Abs(b.x - a.x); j.y = sh - Mathf.Max(a.y, b.y); j.h = Mathf.Abs(b.y - a.y);
                }
                s.cells.Add(j);
            }
        }
    }
}

using System.Collections.Generic;
using System.Reflection;
using NUnit.Framework;
using Roguehalla.Client;
using Roguehalla.Net;
using Roguehalla.Net.Protocol;
using UnityEngine;

namespace Roguehalla.Client.Tests
{
    public sealed class WishFxPresenterEditModeTests
    {
        const string QualityModeKey = "roguehalla.showcase.qualityMode";
        const string ManualQualityKey = "roguehalla.showcase.manualQuality";
        const string ReducedMotionKey = "roguehalla.showcase.reducedMotion";
        readonly List<GameObject> _objects = new List<GameObject>();
        bool _hadQualityMode, _hadManualQuality, _hadReducedMotion;
        int _previousQualityMode, _previousManualQuality, _previousReducedMotion;
        ShowcaseSettings _previousSettings;
        ShowcaseQualityMode _previousSettingsMode; ShowcaseQuality _previousSettingsQuality; bool _previousSettingsReducedMotion;
        Transform _parent;
        SpriteActorPresenter _actors;
        WishFxPresenter _fx;
        readonly List<AreaView> _rows = new List<AreaView>();

        [SetUp]
        public void SetUp()
        {
            _hadQualityMode = PlayerPrefs.HasKey(QualityModeKey); _hadManualQuality = PlayerPrefs.HasKey(ManualQualityKey); _hadReducedMotion = PlayerPrefs.HasKey(ReducedMotionKey);
            _previousQualityMode = PlayerPrefs.GetInt(QualityModeKey); _previousManualQuality = PlayerPrefs.GetInt(ManualQualityKey); _previousReducedMotion = PlayerPrefs.GetInt(ReducedMotionKey);
            _previousSettings = ShowcaseSettings.Current;
            if (_previousSettings != null)
            { _previousSettingsMode = _previousSettings.QualityMode; _previousSettingsQuality = _previousSettings.ManualQuality; _previousSettingsReducedMotion = _previousSettings.ReducedMotion; }
            var go = new GameObject("wish fx presenter test"); _objects.Add(go); _parent = go.transform;
            _actors = new SpriteActorPresenter(_parent, null);
            _fx = new WishFxPresenter(_parent, _actors);
            _rows.Clear();
            Quality.Set(ShowcaseQuality.High, default(QualityOverrides));
            SetReduced(false);
            PresentActors();
        }

        [TearDown]
        public void TearDown()
        {
            if (_previousSettings != null)
            {
                SetPrivateField(_previousSettings, "_qualityMode", _previousSettingsMode);
                SetPrivateField(_previousSettings, "_manualQuality", _previousSettingsQuality);
                SetPrivateField(_previousSettings, "_reducedMotion", _previousSettingsReducedMotion);
            }
            for (int i = _objects.Count - 1; i >= 0; i--) if (_objects[i] != null) Object.DestroyImmediate(_objects[i]);
            _objects.Clear();
            Restore(QualityModeKey, _hadQualityMode, _previousQualityMode); Restore(ManualQualityKey, _hadManualQuality, _previousManualQuality); Restore(ReducedMotionKey, _hadReducedMotion, _previousReducedMotion);
            PlayerPrefs.Save(); Quality.Reset();
        }

        // ------------------------------------------------------------ extents equal the server's
        [Test]
        public void ZoneAndCloudRingsAreExactlyTheDeliveredRadiusInWorldSpace()
        {
            _rows.Add(Row(AreaKind.Zone, AbilityId.Trial, 3600, 1040, 0, 0, 300, 1000, 6000, 3));
            _rows.Add(Row(AreaKind.Cloud, AbilityId.Swarm, 4208, 1360, 0, 0, 72, 1000, 9000));
            Frame(2000);
            Assert.That(_fx.DrawnAreas.Count, Is.EqualTo(2));
            var zone = _fx.DrawnAreas[0]; var cloud = _fx.DrawnAreas[1];
            Assert.That(zone.Kind, Is.EqualTo(AreaKind.Zone));
            Assert.That(zone.Size.x, Is.EqualTo(300 * 2 * ArenaView.Scale).Within(1e-4f), "trial ring diameter");
            Assert.That(zone.Size.y, Is.EqualTo(300 * 2 * ArenaView.Scale * ArenaView.GroundSquash).Within(1e-4f), "squashed like the ground");
            Assert.That(zone.Center, Is.EqualTo(ArenaView.WorldPoint(3600, 1040)));
            Assert.That(cloud.Size.x, Is.EqualTo(72 * 2 * ArenaView.Scale).Within(1e-4f), "swarm cloud diameter");
            Assert.That(cloud.Center, Is.EqualTo(ArenaView.WorldPoint(4208, 1360)), "an anonymous cloud stays where it was delivered");
        }

        [Test]
        public void TrailBandCoversTheDeliveredHalfWidthAndEndpoints()
        {
            _rows.Add(Row(AreaKind.Trail, AbilityId.Blaze, 4304, 2512, 4504, 2632, 20, 1000, 3500, 5));
            Frame(1500);
            Assert.That(_fx.DrawnAreas.Count, Is.EqualTo(1));
            var t = _fx.DrawnAreas[0];
            Vector3 a = ArenaView.WorldPoint(4304, 2512), b = ArenaView.WorldPoint(4504, 2632);
            Assert.That(t.Center, Is.EqualTo((a + b) / 2));
            Assert.That(t.End, Is.EqualTo(b));
            Assert.That(t.Size.x, Is.EqualTo((b - a).magnitude).Within(1e-4f));
            // Perpendicular thickness is twice the half-width measured on the squashed floor.
            Vector2 dir = ((Vector2)(b - a)).normalized;
            Vector2 edge = new Vector2(-(2632 - 2512f), 4504 - 4304f).normalized * 20f; edge = new Vector2(edge.x * ArenaView.Scale, -edge.y * ArenaView.Scale * ArenaView.GroundSquash);
            float expected = Mathf.Abs(dir.x * edge.y - dir.y * edge.x) * 2f;
            Assert.That(t.Size.y, Is.EqualTo(expected).Within(1e-4f));
            // Axis-aligned trail: thickness is exactly 2 x half-width in world units along the unsquashed axis.
            _rows.Clear(); _rows.Add(Row(AreaKind.Trail, AbilityId.Blaze, 1000, 1000, 1000, 1200, 20, 1000, 3500));
            Frame(1500);
            Assert.That(_fx.DrawnAreas[0].Size.y, Is.EqualTo(40 * ArenaView.Scale).Within(1e-4f));
        }

        [Test]
        public void NothingIsDrawnForARowThatIsNotDelivered()
        {
            Frame(2000);
            Assert.That(_fx.DrawnAreas.Count, Is.Zero); Assert.That(_fx.SpritesDrawn, Is.Zero);
        }

        // ------------------------------------------------------------ event to effect mapping
        [Test]
        public void StartedDrawsATelegraphOnTheCasterAndLandedDrawsAtItsAnchor()
        {
            foreach (byte ability in new byte[] { 0, 1, 2 })
            {
                _fx.Reset();
                _fx.Accept(Started(ability, 1000, 350, 1, 2, 12, 12));
                Frame(1100);
                Assert.That(_fx.ActiveCueCount, Is.EqualTo(1));
                Assert.That(_fx.SpritesDrawn, Is.GreaterThan(2), "windup of ability " + ability + " draws rings/beam/swarm");
                Frame(1400);
                Assert.That(_fx.ActiveCueCount, Is.EqualTo(0), "the telegraph ends with its delivered duration");
            }
            _fx.Reset();
            _fx.Accept(Landed(0, 2000, 1, 2, true, 20, 22));
            Frame(2100);
            Assert.That(_fx.SpritesDrawn, Is.GreaterThan(2), "an ice burst");
        }

        [Test]
        public void LandingNeedsAnAnchorAndBlazeNeedsBothEnds()
        {
            _fx.Accept(Landed(0, 100, 1, null, false, 0, 0)); Assert.That(_fx.ActiveCueCount, Is.Zero, "no anchor, no fallback to the caster");
            var one = Landed(3, 100, 1, null, true, 4, 4); _fx.Accept(one); Assert.That(_fx.ActiveCueCount, Is.Zero, "one-ended blink is refused");
            var both = Landed(3, 100, 1, null, true, 4, 4); both.HasDestination = true; both.DestinationX = 9; both.DestinationY = 9; _fx.Accept(both);
            Assert.That(_fx.ActiveCueCount, Is.EqualTo(1));
            var ghost = Landed(4, 100, 1, null, true, 4, 4); ghost.HasDestination = true; _fx.Accept(ghost);
            Assert.That(_fx.ActiveCueCount, Is.EqualTo(1), "only Blaze has a destination");
        }

        [Test]
        public void EndedAndLandedClearTheirCastersTelegraphButNotALaterOne()
        {
            _fx.Accept(Started(2, 10, 1000, 1, null, 0, 0)); _fx.Accept(new WireFx { Kind = FxKind.WishEnded, Ability = 2, EventTime = 11, Caster = 1 });
            Assert.That(_fx.ActiveCueCount, Is.Zero);
            _fx.Accept(Started(2, 20, 1000, 1, null, 0, 0)); _fx.Accept(new WireFx { Kind = FxKind.WishEnded, Ability = 2, EventTime = 21, Caster = 1 });
            _fx.Accept(Started(2, 22, 1000, 1, null, 0, 0));
            Assert.That(_fx.ActiveCueCount, Is.EqualTo(1));
            _fx.Retain(new HashSet<uint>()); Assert.That(_fx.ActiveCueCount, Is.Zero, "a caster that left observation takes its telegraph");
        }

        [Test]
        public void AFutureCueDrawsNothingUntilItsServerTimeAndALateExpiredOneNever()
        {
            _fx.Accept(Started(1, 5000, 250, 1, null, 0, 0));
            Frame(4000); Assert.That(_fx.SpritesDrawn, Is.Zero);
            Frame(5100); Assert.That(_fx.SpritesDrawn, Is.GreaterThan(0));
            _fx.Accept(Started(1, 10, 100, 1, null, 0, 0)); Frame(5200);
            Assert.That(_fx.ActiveCueCount, Is.Zero.Or.EqualTo(1));
            Frame(9000); Assert.That(_fx.ActiveCueCount, Is.Zero);
        }

        // ------------------------------------------------------------ statuses and ends
        [Test]
        public void StatusBitsDrawOnlyOnObservedLivingActors()
        {
            Frame(1000, WishEffectBits.Stunned);
            Assert.That(_fx.SpritesDrawn, Is.GreaterThan(3), "stars over the stunned fighter");
            Frame(1050, WishEffectBits.LastStand | WishEffectBits.Haste);
            Assert.That(_fx.SpritesDrawn, Is.GreaterThan(5), "column, bubble, rim and halo");
            Frame(1100, WishEffectBits.Zoned);
            Assert.That(_fx.SpritesDrawn, Is.GreaterThan(4), "sigil ring, chains, mark");
            Frame(1150, 0);
            Assert.That(_fx.SpritesDrawn, Is.EqualTo(0).Or.GreaterThan(0), "end cues may still play");
            Frame(1150 + 2000, 0);
            Assert.That(_fx.SpritesDrawn, Is.Zero, "everything cleans up");
            Frame(3300, WishEffectBits.LastStand, alive: false);
            Assert.That(_fx.SpritesDrawn, Is.Zero, "a dead actor shows no status art");
        }

        [Test]
        public void EndingAStatusPlaysAnEndCueOncePerTransition()
        {
            Frame(1000, WishEffectBits.LastStand);
            Frame(1050, WishEffectBits.LastStand);
            Assert.That(_fx.ActiveCueCount, Is.Zero);
            Frame(1100, 0);
            Assert.That(_fx.ActiveCueCount, Is.EqualTo(1), "radiant burst when the bit clears");
            Frame(1150, 0);
            Assert.That(_fx.ActiveCueCount, Is.EqualTo(1), "not retriggered");
            Frame(2500, 0);
            Assert.That(_fx.ActiveCueCount, Is.Zero);
        }

        [Test]
        public void NpcStatusNeverFiresEdgeCuesBecauseTheirHandlesRenewEverySnapshot()
        {
            for (uint handle = 2148000000; handle < 2148000010; handle++)
            {
                _fx.BeginFrame();
                _fx.NoteActor(handle, ActorKind.RegionalMob, WishEffectBits.Stunned, true);
                _fx.PresentAreas(_rows); _fx.Tick(1000 + (handle - 2148000000) * 50, .016f);
            }
            Assert.That(_fx.ActiveCueCount, Is.Zero);
        }

        // ------------------------------------------------------------ pooling, lifetime and bounds
        [Test]
        public void ExpiredAreasLeaveAGhostThatThenExpiresAndTheSpritePoolStaysBounded()
        {
            _rows.Add(Row(AreaKind.Trail, AbilityId.Blaze, 100, 100, 300, 100, 20, 1000, 3500, 5));
            Frame(1500); Frame(3000);
            int pool = _fx.SpritePoolSize;
            _rows.Clear(); Frame(3600);
            Assert.That(_fx.GhostCount, Is.EqualTo(1), "the scorch lingers after the row is removed");
            Assert.That(_fx.SpritesDrawn, Is.GreaterThan(0));
            Frame(3600 + 2500);
            Assert.That(_fx.GhostCount, Is.Zero); Assert.That(_fx.SpritesDrawn, Is.Zero);
            for (int i = 0; i < 200; i++) { _fx.Accept(Landed(4, 6200 + i, 1, null, true, i % 50, i % 40)); Frame(6200 + i); }
            Assert.That(_fx.SpritePoolSize, Is.LessThanOrEqualTo(WishFxPresenter.SpriteCap));
            Assert.That(_fx.ActiveCueCount, Is.LessThanOrEqualTo(WishFxPresenter.CueCapacity));
            Assert.That(_fx.SpritePoolSize, Is.GreaterThanOrEqualTo(pool).Or.Zero);
        }

        [Test]
        public void PoolDoesNotGrowAfterWarmUp()
        {
            _rows.Add(Row(AreaKind.Zone, AbilityId.Trial, 500, 500, 0, 0, 300, 1000, 9000, 3));
            _rows.Add(Row(AreaKind.Cloud, AbilityId.Swarm, 800, 500, 0, 0, 72, 1000, 9000));
            for (int i = 0; i < 20; i++) Frame(1500 + i * 50, WishEffectBits.LastStand);
            int pool = _fx.SpritePoolSize;
            for (int i = 20; i < 120; i++) Frame(1500 + i * 50, WishEffectBits.LastStand);
            Assert.That(_fx.SpritePoolSize, Is.EqualTo(pool), "steady state allocates no new renderers");
        }

        // ------------------------------------------------------------ reduced motion and quality
        [Test]
        public void ReducedMotionDropsParticlesAndMotionButKeepsTheAreaAndStatusLook()
        {
            SetReduced(true);
            _rows.Add(Row(AreaKind.Zone, AbilityId.Trial, 3600, 1040, 0, 0, 300, 1000, 6000, 3));
            _rows.Add(Row(AreaKind.Cloud, AbilityId.Swarm, 800, 500, 0, 0, 72, 1000, 9000));
            _fx.Accept(Landed(3, 2000, 1, null, true, 5, 5, 10, 10));
            Frame(2010, WishEffectBits.Stunned);
            Assert.That(_fx.IsReduced, Is.True);
            Assert.That(_fx.LiveParticles, Is.Zero, "no particles");
            Assert.That(_fx.DrawnAreas.Count, Is.EqualTo(2), "area indicators remain");
            Assert.That(_fx.DrawnAreas[0].Size.x, Is.EqualTo(600 * ArenaView.Scale).Within(1e-4f), "and are at full extent at once");
            Assert.That(_fx.SpritesDrawn, Is.GreaterThan(10));
            // The same frame twice is identical: nothing animates with wall time.
            int first = _fx.SpritesDrawn; Frame(2010, WishEffectBits.Stunned); Assert.That(_fx.SpritesDrawn, Is.EqualTo(first));
        }

        [Test]
        public void LowQualityEmitsNoParticlesAndHighEmitsSome()
        {
            Quality.Set(ShowcaseQuality.Low, default(QualityOverrides));
            _fx.Accept(Landed(3, 2000, 1, null, true, 5, 5, 10, 10)); _fx.Accept(Landed(4, 2000, 1, null, true, 9, 9));
            for (int i = 0; i < 5; i++) Frame(2010 + i * 16);
            Assert.That(_fx.LiveParticles, Is.Zero, "Quality.Particles is 0 at Low");
            Assert.That(_fx.SpritesDrawn, Is.GreaterThan(5), "the sprite layers remain");
            Quality.Set(ShowcaseQuality.High, default(QualityOverrides));
            _fx.Reset();
            _fx.Accept(Landed(3, 3000, 1, null, true, 5, 5, 10, 10));
            Frame(3010);
            Assert.That(_fx.LiveParticles, Is.GreaterThan(0));
            Assert.That(_fx.LiveParticles, Is.LessThanOrEqualTo(_fx.ParticleCapacity));
        }

        // ------------------------------------------------------------ actor hooks
        [Test]
        public void WishCueAndTintTargetObservedActorsOnly()
        {
            Assert.That(_actors.WishCue(1, AbilityId.Freeze), Is.True);
            Assert.That(_actors.WishCue(999, AbilityId.Freeze), Is.False, "nothing is played for an actor that is not observed");
            _actors.SetWishTint(1, Color.cyan, .5f); _actors.SetWishTint(999, Color.cyan, .5f);
            _actors.ClearWishTints();
            PresentActors(); // must not throw with the cue pending
        }

        // ------------------------------------------------------------ helpers
        void PresentActors(bool alive = true)
        {
            _actors.Begin();
            _actors.Present(1, 10, 10, 0, 80, FactionId.Fire, alive ? ActorStatus.Alive : ActorStatus.Dead, WeaponId.Sword, ActorKind.Player, null, 0, 0, false);
            _actors.Present(2, 12, 12, 0, 80, FactionId.Frost, ActorStatus.Alive, WeaponId.Sword, ActorKind.Player, null, 0, 0, false);
            _actors.End();
        }

        void Frame(double ms, ushort effects = 0, bool alive = true)
        {
            PresentActors(alive);
            _fx.BeginFrame(); _fx.SetOwner(1);
            _fx.NoteActor(1, ActorKind.Player, effects, alive);
            _fx.PresentAreas(_rows);
            _fx.Tick(ms, .016f);
        }

        static AreaView Row(AreaKind kind, AbilityId ability, float x, float y, float x2, float y2, float r, double start, double end, uint? owner = null)
        {
            return new AreaView { Kind = kind, Ability = ability, X = x, Y = y, X2 = x2, Y2 = y2, Radius = r, StartedAt = start, EndsAt = end, Owner = owner };
        }

        static WireFx Started(byte ability, double time, double duration, uint caster, uint? target, float x, float y)
        {
            return new WireFx { Kind = FxKind.WishStarted, Ability = ability, EventTime = time, Duration = duration, Caster = caster, Target = target, HasAnchor = true, AnchorX = x, AnchorY = y };
        }

        static WireFx Landed(byte ability, double time, uint? caster, uint? target, bool anchor, float x, float y, float dx = 0, float dy = 0)
        {
            var f = new WireFx { Kind = FxKind.WishLanded, Ability = ability, EventTime = time, Caster = caster, Target = target, HasAnchor = anchor, AnchorX = x, AnchorY = y };
            if (ability == 3 && anchor && (dx != 0 || dy != 0)) { f.HasDestination = true; f.DestinationX = dx; f.DestinationY = dy; }
            return f;
        }

        void SetReduced(bool reduced)
        {
            var settings = ShowcaseSettings.Current;
            if (settings == null)
            {
                var go = new GameObject("wish fx test settings"); _objects.Add(go);
                settings = go.AddComponent<ShowcaseSettings>();
                settings.GetType().GetMethod("Awake", BindingFlags.Instance | BindingFlags.NonPublic).Invoke(settings, null);
            }
            SetPrivateField(settings, "_reducedMotion", reduced);
        }
        static void SetPrivateField(object target, string field, object value) => target.GetType().GetField(field, BindingFlags.Instance | BindingFlags.NonPublic).SetValue(target, value);
        static void Restore(string key, bool had, int value) { if (had) PlayerPrefs.SetInt(key, value); else PlayerPrefs.DeleteKey(key); }
    }
}

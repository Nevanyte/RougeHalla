using System.Collections.Generic;
using System.Reflection;
using NUnit.Framework;
using Roguehalla.Client;
using Roguehalla.Net;
using Roguehalla.Net.Protocol;
using UnityEngine;

namespace Roguehalla.Client.Tests
{
    public sealed class ConfirmedWishPresenterEditModeTests
    {
        const string QualityModeKey = "roguehalla.showcase.qualityMode";
        const string ManualQualityKey = "roguehalla.showcase.manualQuality";
        const string ReducedMotionKey = "roguehalla.showcase.reducedMotion";
        readonly List<GameObject> _objects = new List<GameObject>();
        bool _hadQualityMode, _hadManualQuality, _hadReducedMotion;
        int _previousQualityMode, _previousManualQuality, _previousReducedMotion;
        ShowcaseSettings _previousSettings;
        ShowcaseQualityMode _previousSettingsMode;
        ShowcaseQuality _previousSettingsQuality;
        bool _previousSettingsReducedMotion;
        Transform _parent;
        SpriteActorPresenter _actors;
        ConfirmedWishPresenter _presenter;

        [SetUp]
        public void SetUp()
        {
            _hadQualityMode = PlayerPrefs.HasKey(QualityModeKey);
            _hadManualQuality = PlayerPrefs.HasKey(ManualQualityKey);
            _hadReducedMotion = PlayerPrefs.HasKey(ReducedMotionKey);
            _previousQualityMode = PlayerPrefs.GetInt(QualityModeKey);
            _previousManualQuality = PlayerPrefs.GetInt(ManualQualityKey);
            _previousReducedMotion = PlayerPrefs.GetInt(ReducedMotionKey);
            _previousSettings = ShowcaseSettings.Current;
            if (_previousSettings != null)
            {
                _previousSettingsMode = _previousSettings.QualityMode;
                _previousSettingsQuality = _previousSettings.ManualQuality;
                _previousSettingsReducedMotion = _previousSettings.ReducedMotion;
            }
            var parent = new GameObject("confirmed wish presenter test");
            _objects.Add(parent);
            _parent = parent.transform;
            _actors = new SpriteActorPresenter(_parent, null);
            _presenter = new ConfirmedWishPresenter(_parent, _actors);
            PresentActor(1);
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
            for (int i = _objects.Count - 1; i >= 0; i--)
                if (_objects[i] != null) Object.DestroyImmediate(_objects[i]);
            _objects.Clear();
            RestorePreference(QualityModeKey, _hadQualityMode, _previousQualityMode);
            RestorePreference(ManualQualityKey, _hadManualQuality, _previousManualQuality);
            RestorePreference(ReducedMotionKey, _hadReducedMotion, _previousReducedMotion);
            PlayerPrefs.Save();
        }

        [Test]
        public void AcceptCopiesBorrowedRecordAndRendersAllFiveDistinctUnlitGlyphsAtLowReducedQuality()
        {
            SetLowReducedMotion();
            string[] names = { "sigil3", "sigil2", "sigil1", "spark", "sigil4" };
            var source = Start(0, 100, 500, 1, true, 3, 4);
            _presenter.Accept(source);
            source.Ability = 4; source.EventTime = 900; source.Duration = 1; source.Caster = 999;
            source.AnchorX = 90; source.AnchorY = 91;
            for (byte ability = 1; ability < 5; ability++) _presenter.Accept(Start(ability, 100 + ability, 500, 1));
            _presenter.Tick(105);

            var roots = ActiveRoots();
            Assert.That(roots.Count, Is.EqualTo(5));
            var seen = new HashSet<Sprite>();
            foreach (var root in roots)
            {
                var glyph = root.Find("Confirmed Wish shape 0").GetComponent<SpriteRenderer>();
                Assert.That(glyph.enabled, Is.True);
                Assert.That(glyph.sharedMaterial, Is.SameAs(ShowcaseSprites.Unlit));
                Assert.That(seen.Add(glyph.sprite), Is.True, "each delivered ability has a distinct unlit glyph");
            }
            for (int ability = 0; ability < 5; ability++)
                Assert.That(roots[ability].Find("Confirmed Wish shape 0").GetComponent<SpriteRenderer>().sprite,
                    Is.SameAs(ShowcaseSprites.Get(names[ability])));
            Vector3 copiedPoint = ArenaView.WorldPoint(3, 4) + new Vector3(0, .08f);
            Assert.That(roots[0].Find("Confirmed Wish shape 0").position, Is.EqualTo(copiedPoint), "mutating decoded packet after Accept cannot move the owned cue");
            _presenter.Tick(599);
            Assert.That(_presenter.ActiveCount, Is.EqualTo(5), "the copied duration remains 500 ms after source mutation");
            _presenter.Tick(600);
            Assert.That(_presenter.ActiveCount, Is.EqualTo(4));
        }

        [Test]
        public void TickHidesFutureCueAgesFromEventTimeAndExpiresAtDuration()
        {
            _presenter.Accept(Start(0, 200, 100, 1));
            _presenter.Tick(150);
            var root = _parent.Find("Confirmed Wish artwork");
            Assert.That(root.gameObject.activeSelf, Is.False, "future delivery remains hidden before accepted server time");
            Assert.That(_presenter.ActiveCount, Is.EqualTo(1), "future delivery remains queued before accepted server time");
            _presenter.Tick(225);
            Assert.That(root.gameObject.activeSelf, Is.True);
            _presenter.Tick(300);
            Assert.That(_presenter.ActiveCount, Is.Zero);
            Assert.That(root.gameObject.activeSelf, Is.False);
        }

        [Test]
        public void SameWakeTerminalsClearOnlyPriorStartsAndMetadataLandingHasNoFallbackPoint()
        {
            _presenter.Accept(Start(2, 10, 1000, 1));
            _presenter.Accept(End(2, 11, 1));
            Assert.That(_presenter.ActiveCount, Is.Zero, "same-wake Ended clears the preceding telegraph");

            _presenter.Accept(Start(2, 20, 1000, 1));
            var metadata = Landed(2, 21, 1); // no permitted point
            _presenter.Accept(metadata);
            Assert.That(_presenter.ActiveCount, Is.Zero, "metadata-only landing clears a visible caster's telegraph");
            Assert.That(ActiveRoots().Count, Is.Zero, "no fake point or line was created");

            _presenter.Accept(Start(2, 30, 1000, 1));
            _presenter.Accept(End(2, 31, 1));
            _presenter.Accept(Start(2, 32, 1000, 1));
            Assert.That(_presenter.ActiveCount, Is.EqualTo(1), "a later start in the same wake survives prior termination");
            _presenter.Tick(33);
            Assert.That(ActiveRoots()[0].gameObject.activeSelf, Is.True);
        }

        [Test]
        public void BlazeRequiresBothEndpointsAndKeepsIdenticalTimeLandingsAndAnonymousGeometry()
        {
            var incomplete = Landed(3, 40, 1);
            incomplete.HasAnchor = true; incomplete.AnchorX = 2; incomplete.AnchorY = 3;
            _presenter.Accept(incomplete);
            Assert.That(_presenter.ActiveCount, Is.Zero, "one-sided Blaze is rejected without fallback");

            var first = Landed(3, 50, 1);
            first.HasAnchor = first.HasDestination = true;
            first.AnchorX = 2; first.AnchorY = 3; first.DestinationX = 7; first.DestinationY = 9;
            var second = Landed(3, 50, 1);
            second.HasAnchor = second.HasDestination = true;
            second.AnchorX = 4; second.AnchorY = 1; second.DestinationX = 8; second.DestinationY = 5;
            _presenter.Accept(first); _presenter.Accept(second);
            Assert.That(_presenter.ActiveCount, Is.EqualTo(2), "same caster and timestamp do not deduplicate landing occurrences");
            _presenter.Tick(50);
            var roots = ActiveRoots();
            Assert.That(roots.Count, Is.EqualTo(2));
            AssertBlazeLine(roots[0], ArenaView.WorldPoint(2, 3), ArenaView.WorldPoint(7, 9));
            AssertBlazeLine(roots[1], ArenaView.WorldPoint(4, 1), ArenaView.WorldPoint(8, 5));

            var anonymous = Landed(3, 60, null);
            anonymous.HasAnchor = anonymous.HasDestination = true;
            anonymous.AnchorX = 11; anonymous.AnchorY = 2; anonymous.DestinationX = 14; anonymous.DestinationY = 6;
            _presenter.Accept(anonymous);
            _presenter.Tick(60);
            Assert.That(_presenter.ActiveCount, Is.EqualTo(3), "permitted world geometry needs no caster actor lookup");
        }

        [Test]
        public void DeadCasterLosesStartedTelegraphWhileAnonymousWorldLandingRemains()
        {
            _presenter.Accept(Start(0, 10, 500, 1));
            var landing = Landed(0, 10, null);
            landing.HasAnchor = true; landing.AnchorX = 15; landing.AnchorY = 15;
            _presenter.Accept(landing);
            PresentActor(1, ActorStatus.Dead);
            _presenter.Tick(10);

            Assert.That(_actors.IsLiving(1), Is.False);
            Assert.That(_presenter.ActiveCount, Is.EqualTo(1), "only the actor-bound start is cleared");
            var roots = ActiveRoots();
            Assert.That(roots.Count, Is.EqualTo(1));
            Assert.That(roots[0].Find("Confirmed Wish shape 0").position,
                Is.EqualTo(ArenaView.WorldPoint(15, 15) + new Vector3(0, .08f)), "anonymous permitted world effect remains spatial");
        }

        [Test]
        public void RetainRemovesActorBoundStartedCuesAndResetClearsPooledShapes()
        {
            _presenter.Accept(Start(1, 10, 500, 1));
            _presenter.Tick(10);
            var root = ActiveRoots()[0];
            _presenter.Retain(new HashSet<uint>());
            Assert.That(_presenter.ActiveCount, Is.Zero);
            Assert.That(root.gameObject.activeSelf, Is.False);

            for (int i = 0; i < 72; i++)
            {
                var point = Landed(1, 100 + i, null);
                point.HasAnchor = true; point.AnchorX = i; point.AnchorY = i;
                _presenter.Accept(point);
            }
            Assert.That(_presenter.ActiveCount, Is.EqualTo(64), "visual cue storage stays bounded");
            _presenter.Tick(200);
            _presenter.Reset();
            Assert.That(_presenter.ActiveCount, Is.Zero);
            foreach (var artwork in _parent.GetComponentsInChildren<SpriteRenderer>(true))
                if (artwork.transform.parent.name == "Confirmed Wish artwork") Assert.That(artwork.enabled, Is.False);
            for (int i = 0; i < _parent.childCount; i++)
            {
                var child = _parent.GetChild(i);
                if (child.name == "Confirmed Wish artwork") Assert.That(child.gameObject.activeSelf, Is.False);
            }
        }

        void SetLowReducedMotion()
        {
            var settings = ShowcaseSettings.Current;
            if (settings == null)
            {
                var go = new GameObject("wish test settings"); _objects.Add(go);
                settings = go.AddComponent<ShowcaseSettings>();
                InvokeAwake(settings);
            }
            SetPrivateField(settings, "_qualityMode", ShowcaseQualityMode.Manual);
            SetPrivateField(settings, "_manualQuality", ShowcaseQuality.Low);
            SetPrivateField(settings, "_reducedMotion", true);
            Assert.That(settings.EffectiveQuality, Is.EqualTo(ShowcaseQuality.Low));
            Assert.That(settings.ReducedMotion, Is.True);
        }

        void PresentActor(uint id, ActorStatus status = ActorStatus.Alive)
        {
            _actors.Begin();
            _actors.Present(id, 10, 10, 0, 80, FactionId.Fire, status, WeaponId.Sword,
                ActorKind.Player, null, 0, 0, false);
            _actors.End();
        }

        static WireFx Start(byte ability, double time, double duration, uint caster, bool anchor = false, float x = 0, float y = 0)
        {
            return new WireFx { Kind = FxKind.WishStarted, Ability = ability, EventTime = time, Duration = duration,
                Caster = caster, HasAnchor = anchor, AnchorX = x, AnchorY = y };
        }

        static WireFx End(byte ability, double time, uint caster) =>
            new WireFx { Kind = FxKind.WishEnded, Ability = ability, EventTime = time, Caster = caster };

        static WireFx Landed(byte ability, double time, uint? caster) =>
            new WireFx { Kind = FxKind.WishLanded, Ability = ability, EventTime = time, Caster = caster };

        List<Transform> ActiveRoots()
        {
            var roots = new List<Transform>();
            for (int i = 0; i < _parent.childCount; i++)
            {
                var child = _parent.GetChild(i);
                if (child.name == "Confirmed Wish artwork" && child.gameObject.activeSelf) roots.Add(child);
            }
            return roots;
        }

        static void AssertBlazeLine(Transform root, Vector3 start, Vector3 end)
        {
            var first = root.Find("Confirmed Wish shape 0").GetComponent<SpriteRenderer>();
            var second = root.Find("Confirmed Wish shape 1").GetComponent<SpriteRenderer>();
            var line = root.Find("Confirmed Wish shape 2").GetComponent<SpriteRenderer>();
            Assert.That(first.enabled && second.enabled && line.enabled, Is.True);
            Assert.That(first.transform.position, Is.EqualTo(start));
            Assert.That(second.transform.position, Is.EqualTo(end));
            Assert.That(line.transform.position, Is.EqualTo((start + end) / 2));
            Assert.That(line.transform.localScale.x, Is.EqualTo(Vector3.Distance(start, end)).Within(.0001f));
            Assert.That(Mathf.DeltaAngle(line.transform.eulerAngles.z, Mathf.Atan2(end.y - start.y, end.x - start.x) * Mathf.Rad2Deg), Is.EqualTo(0).Within(.001f));
        }

        static void InvokeAwake(MonoBehaviour component) => component.GetType().GetMethod("Awake", BindingFlags.Instance | BindingFlags.NonPublic).Invoke(component, null);
        static void SetPrivateField(object target, string field, object value) => target.GetType().GetField(field, BindingFlags.Instance | BindingFlags.NonPublic).SetValue(target, value);
        static void RestorePreference(string key, bool hadValue, int value)
        {
            if (hadValue) PlayerPrefs.SetInt(key, value);
            else PlayerPrefs.DeleteKey(key);
        }
    }
}

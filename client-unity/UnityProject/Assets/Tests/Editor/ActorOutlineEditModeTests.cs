using System.Collections.Generic;
using NUnit.Framework;
using Roguehalla.Net;
using Roguehalla.Net.Protocol;
using Roguehalla.Net.Ui;
using UnityEngine;

namespace Roguehalla.Client.Tests
{
    /// <summary>The adaptive neutral outline (docs/rework/CONTRAST_GATE.md): present on every actor kind and marker, follows the fade, dead and hidden states, never off in a preset.</summary>
    public sealed class ActorOutlineEditModeTests
    {
        readonly List<GameObject> _objects = new List<GameObject>();
        SpriteActorPresenter _presenter; Transform _parent; float _now;

        [SetUp]
        public void SetUp()
        {
            var root = new GameObject("outline presenter test"); _objects.Add(root); _parent = root.transform;
            _presenter = new SpriteActorPresenter(_parent, Resources.Load<ShowcaseCatalog>("Showcase/Catalog"));
            _now = 100f; SpriteActorPresenter.FadeClock = () => _now;
            _presenter.ExitFadesAllowed = true; _presenter.Delivered = new HashSet<uint>();
            SpriteOutline.Enabled = true;
        }

        [TearDown]
        public void TearDown()
        {
            SpriteActorPresenter.FadeClock = null; SpriteOutline.Enabled = true;
            for (int i = _objects.Count - 1; i >= 0; i--) if (_objects[i] != null) Object.DestroyImmediate(_objects[i]);
            _objects.Clear();
        }

        void Present(uint id, ActorKind kind = ActorKind.Player, ActorStatus status = ActorStatus.Alive, float hp = 60, ushort effects = 0, bool local = false, MobTypeId? mob = null, FactionId? faction = FactionId.Fire)
        {
            _presenter.Begin();
            _presenter.Present(id, 640, 640, 0, hp, faction, status, WeaponId.Sword, kind, mob, effects, 0, local);
            _presenter.End(); _now += 1f; _presenter.StepFades();   // a new remote player fades in over a fraction of a second: let it settle
        }

        Transform Root(int index = 0) { int n = 0; for (int i = 0; i < _parent.childCount; i++) if (_parent.GetChild(i).name == "Observed actor" && n++ == index) return _parent.GetChild(i); return null; }
        static SpriteRenderer Find(Transform root, string name) { foreach (var r in root.GetComponentsInChildren<SpriteRenderer>(true)) if (r.gameObject.name == name) return r; return null; }

        [Test] public void NoEnlargedOffsetOrStaticCopyOfTheBodyIsDrawn()
        {
            // Owner feedback: a faint delayed ghost copy behind the character. The only things behind the body are the stroke (a child of the body, same frame), the
            // contact shadow and the footprint; there is no scaled or offset copy of the sprite and the faction mantle is off.
            Present(40, faction: FactionId.Sentenced);
            var root = Root(); var body = Find(root, "Authored character");
            Assert.That(ShowcaseIdentityOwner.MantleEnabled, Is.False);
            var mantle = Find(root, "Faction mantle"); Assert.That(mantle == null || !mantle.enabled, Is.True, "the faction silhouette behind the body is not drawn");
            Assert.That(Find(root, "Character light rim"), Is.Null); Assert.That(Find(root, "Character contrast rim").transform.parent, Is.SameAs(body.transform));
            foreach (var r in root.GetComponentsInChildren<SpriteRenderer>(true))
                if (r.enabled && r != body && r.sprite == body.sprite && r.gameObject.name != "Authored character")
                    Assert.Fail(r.gameObject.name + " draws the body's own sprite as a copy");
            // the stroke follows the body's transform in the same frame: same parent chain, so identical position and rotation, and the sprite it rebuilds from is the body's
            var rim = Find(root, "Character contrast rim");
            Assert.That(rim.transform.rotation, Is.EqualTo(body.transform.rotation).Using(new QuaternionComparer()));
        }

        sealed class QuaternionComparer : System.Collections.Generic.IEqualityComparer<Quaternion>
        {
            public bool Equals(Quaternion a, Quaternion b) { return Quaternion.Angle(a, b) < .01f; }
            public int GetHashCode(Quaternion q) { return q.GetHashCode(); }
        }

        [Test] public void ShaderIsInTheBuildAndSupported()
        {
            var shader = Resources.Load<Shader>(SpriteOutline.ShaderPath);
            Assert.That(shader, Is.Not.Null); Assert.That(shader.isSupported, Is.True);
            Assert.That(SpriteOutline.SharedMaterial, Is.Not.Null);
        }

        [Test] public void EveryActorKindHasAnOpaqueOutlineUnderItsBody()
        {
            var kinds = new[] { ActorKind.Player, ActorKind.RegionalMob, ActorKind.Zombie, ActorKind.TrainingDummy, ActorKind.QuestGiver };
            uint id = 1;
            _presenter.Begin();
            foreach (var kind in kinds)
            {
                _presenter.Present(id, 400 + id * 90, 640, 0, 70, kind == ActorKind.QuestGiver ? (FactionId?)null : FactionId.Plague, ActorStatus.Alive, WeaponId.Sword, kind, null, 0, 0, false);
                id++;
            }
            _presenter.End(); _now += 1f; _presenter.StepFades();
            for (int i = 0; i < kinds.Length; i++)
            {
                var root = Root(i); Assert.That(root, Is.Not.Null, kinds[i] + " root");
                var body = Find(root, "Authored character"); var rim = Find(root, "Character contrast rim");
                Assert.That(rim, Is.Not.Null, kinds[i] + " has the body outline");
                Assert.That(rim.enabled, Is.True, kinds[i].ToString());
                Assert.That(rim.sharedMaterial.shader.name, Is.EqualTo("Roguehalla/ActorOutline"));
                Assert.That(rim.sortingOrder, Is.EqualTo(body.sortingOrder), kinds[i] + ": sorts with its figure, among the strokes");
                Assert.That(rim.sortingLayerID, Is.EqualTo(StrokeLayer.Id), kinds[i] + ": drawn in the Strokes layer, above whatever stands in front of the figure");
                Assert.That(rim.color.a, Is.EqualTo(1f).Within(1e-4f), kinds[i] + ": opaque");
                Assert.That(rim.transform.parent, Is.SameAs(body.transform));
                Assert.That(rim.transform.localScale.x, Is.GreaterThan(0f));
            }
        }

        [Test] public void GatedMarkersCarryTheirOutline()
        {
            Present(7, ActorKind.Player, hp: 60);
            var root = Root();
            foreach (var name in new[] { "Health and barrier track outline", "Faction footprint outline", "Faction insignia backplate outline" })
            {
                var o = Find(root, name); Assert.That(o, Is.Not.Null, name); Assert.That(o.enabled, Is.True, name);
                Assert.That(o.sharedMaterial.shader.name, Is.EqualTo("Roguehalla/ActorOutline"), name);
                Assert.That(ContrastLabStage.ClassOf(name), Is.Not.EqualTo(ContrastLabStage.ClassOther), name + " is classified with its mark");
            }
            Assert.That(Find(root, "Faction footprint outline").sortingOrder, Is.EqualTo(Find(root, "Faction footprint").sortingOrder));
            Assert.That(Find(root, "Faction footprint outline").sortingLayerID, Is.EqualTo(StrokeLayer.Id));
        }

        [Test] public void AMarkerOutlineFollowsItsMarkerOffAndOn()
        {
            Present(8, ActorKind.RegionalMob, hp: 100, mob: null);   // a calm regional mob shows no hp bar
            var root = Root();
            Assert.That(Find(root, "Health and barrier track").enabled, Is.False);
            Assert.That(Find(root, "Health and barrier track outline").enabled, Is.False, "no bar, no outline");
            Present(8, ActorKind.RegionalMob, hp: 40);
            Assert.That(Find(root, "Health and barrier track outline").enabled, Is.True, "a hurt mob shows its bar and the bar's outline");
        }

        [Test] public void DeadActorKeepsAFainterOutline()
        {
            Present(9); Present(9, status: ActorStatus.Dead, hp: 0);
            var rim = Find(Root(), "Character contrast rim");
            Assert.That(rim.enabled, Is.True); Assert.That(rim.color.a, Is.EqualTo(ActorOutlineModel.StateAlpha(true, 1f)).Within(1e-4f));
            Assert.That(Find(Root(), "Health and barrier track outline").enabled, Is.False, "a dead actor has no bar");
        }

        [Test] public void HiddenOwnerShowsTheStrokeAtTheBodyAlphaAndAHiddenRemoteShowsNone()
        {
            Present(10, local: true, effects: Indicators.Hidden);
            var root = Root(); var body = Find(root, "Authored character"); var rim = Find(root, "Character contrast rim");
            Assert.That(rim.color.a, Is.EqualTo(.45f).Within(1e-3f)); Assert.That(rim.color.a, Is.EqualTo(body.color.a).Within(1e-3f));
            Present(11, local: false, effects: Indicators.Hidden);
            Assert.That(Root(0).gameObject.activeSelf, Is.False, "a hidden remote fighter is not drawn at all, outline included");
        }

        [Test] public void ExitFadeDimsTheOutlineWithTheFigure()
        {
            Present(12);
            var rim = Find(Root(), "Character contrast rim"); Assert.That(rim.color.a, Is.EqualTo(1f).Within(1e-3f));
            var keep = new HashSet<uint>(); _presenter.Delivered = keep; _presenter.Retain(keep);
            Assert.That(_presenter.GhostCount, Is.EqualTo(1));
            _now += .12f; _presenter.StepFades();
            var body = Find(Root(), "Authored character");
            Assert.That(body.color.a, Is.LessThan(.95f), "the figure is fading");
            Assert.That(rim.color.a, Is.EqualTo(body.color.a).Within(.02f), "the outline fades exactly with it");
            Assert.That(Find(Root(), "Faction footprint outline").color.a, Is.LessThan(.95f));
            _now += 5f; _presenter.StepFades();
            Assert.That(_presenter.GhostCount, Is.EqualTo(0));
        }

        [Test] public void NoQualityPresetTurnsTheOutlineOff()
        {
            foreach (ShowcaseQuality q in System.Enum.GetValues(typeof(ShowcaseQuality)))
            {
                AtmosphereQuality.ApplyPreset(q, false);
                Assert.That(SpriteOutline.Enabled, Is.True, "preset " + q);
                Present(20 + (uint)q);
                Assert.That(Find(Root(0), "Character contrast rim").enabled, Is.True, "preset " + q);
            }
            AtmosphereQuality.ApplyPreset(ShowcaseQuality.High, false);
            foreach (var f in typeof(AtmosphereQuality).GetFields(System.Reflection.BindingFlags.Public | System.Reflection.BindingFlags.Static))
                Assert.That(f.Name.ToLowerInvariant().Contains("outline"), Is.False, "a preset switch named " + f.Name + " must not exist");
        }

        [Test] public void ADisabledMeasurementSwitchHidesEveryStroke()
        {
            SpriteOutline.Enabled = false; Present(30);
            foreach (var r in Root().GetComponentsInChildren<SpriteRenderer>(true))
                if (r.gameObject.name.EndsWith("outline") || r.gameObject.name == "Character contrast rim") Assert.That(r.enabled, Is.False, r.gameObject.name);
        }

        [Test] public void StrokesLayerSortsAfterDefaultAndEveryStrokeIsOnIt()
        {
            Assert.That(StrokeLayer.Exists, Is.True, "ProjectSettings/TagManager must declare the Strokes layer");
            Assert.That(SortingLayer.GetLayerValueFromID(StrokeLayer.Id), Is.GreaterThan(SortingLayer.GetLayerValueFromID(0)), "Strokes sorts after Default");
            Present(41);
            int strokes = 0;
            foreach (var r in Root().GetComponentsInChildren<SpriteRenderer>(true))
                if (r.gameObject.name.EndsWith(" outline") || r.gameObject.name == "Character contrast rim") { strokes++; Assert.That(r.sortingLayerID, Is.EqualTo(StrokeLayer.Id), r.gameObject.name); }
            Assert.That(strokes, Is.GreaterThanOrEqualTo(30), "the body, the weapon cue, the three gated markers and every overhead plate and ring carry a stroke");
        }

        [Test] public void NoFilledPlateUnderTheFeet()
        {
            // The footprint is one light line (the faction colour); its dark and light companions are the adaptive strokes, so no black band and no filled plate.
            for (int f = 0; f < 5; f++)
            {
                var px = FactionIndicators.GetFootprint(f).texture.GetPixels32(); int dark = 0, opaque = 0;
                foreach (var c in px) { if (c.a > 200) { opaque++; if (c.r < 60 && c.g < 60 && c.b < 60) dark++; } }
                Assert.That(dark, Is.EqualTo(0), "faction " + f); Assert.That(opaque, Is.GreaterThan(150));
            }
        }

        [Test] public void RendererAssetGrabsTheCameraSortingLayerAfterDefault()
        {
#if UNITY_EDITOR
            var so = new UnityEditor.SerializedObject(UnityEditor.AssetDatabase.LoadMainAssetAtPath("Assets/Settings/Roguehalla2DRenderer.asset"));
            Assert.That(so.FindProperty("m_UseCameraSortingLayersTexture").boolValue, Is.True);
            Assert.That(so.FindProperty("m_CameraSortingLayersTextureBound").intValue, Is.EqualTo(0), "bound to Default: the grab holds the scene as the stroke sits on it");
#endif
        }
    }
}

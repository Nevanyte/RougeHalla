using System.Collections.Generic;
using NUnit.Framework;
using Roguehalla.Client;
using Roguehalla.Net;
using Roguehalla.Net.Protocol;
using UnityEngine;
using UnityEngine.Rendering.Universal;

namespace Roguehalla.Client.Tests
{
    public sealed class ArenaPresentationEditModeTests
    {
        const string QualityModeKey = "roguehalla.showcase.qualityMode";
        const string ManualQualityKey = "roguehalla.showcase.manualQuality";
        readonly List<GameObject> _objects = new List<GameObject>();
        readonly List<Object> _assets = new List<Object>();
        bool _hadQualityMode, _hadManualQuality;
        int _previousQualityMode, _previousManualQuality;

        [SetUp]
        public void SetUp()
        {
            _hadQualityMode = PlayerPrefs.HasKey(QualityModeKey);
            _hadManualQuality = PlayerPrefs.HasKey(ManualQualityKey);
            _previousQualityMode = PlayerPrefs.GetInt(QualityModeKey);
            _previousManualQuality = PlayerPrefs.GetInt(ManualQualityKey);
        }

        [TearDown]
        public void TearDown()
        {
            for (int i = _objects.Count - 1; i >= 0; i--)
                if (_objects[i] != null) Object.DestroyImmediate(_objects[i]);
            _objects.Clear();
            for (int i = _assets.Count - 1; i >= 0; i--)
                if (_assets[i] != null) Object.DestroyImmediate(_assets[i]);
            _assets.Clear();
            RestorePreference(QualityModeKey, _hadQualityMode, _previousQualityMode);
            RestorePreference(ManualQualityKey, _hadManualQuality, _previousManualQuality);
            PlayerPrefs.Save();
        }

        [Test]
        public void WorldPointAndScreenToServerRoundTripAtFollowedCameraPosition()
        {
            var arena = CreateArena();
            var cameraObject = CreateObject("round trip camera");
            var camera = cameraObject.AddComponent<Camera>();
            camera.orthographic = true;
            camera.orthographicSize = 12;
            camera.targetTexture = new RenderTexture(2560, 1440, 0);
            _assets.Add(camera.targetTexture);

            const float serverX = 1337;
            const float serverY = 927;
            arena.Follow(camera, 711, 493);
            Vector3 world = ArenaView.WorldPoint(serverX, serverY);
            Vector3 screen = camera.WorldToScreenPoint(world);

            Assert.That(arena.ScreenToServer(camera, new Vector2(screen.x, screen.y), out float actualX, out float actualY), Is.True);
            Assert.That(actualX, Is.EqualTo(serverX).Within(.01f));
            Assert.That(actualY, Is.EqualTo(serverY).Within(.01f));
            Assert.That(camera.transform.position.x, Is.Not.EqualTo(0));
            Assert.That(camera.transform.position.y, Is.Not.EqualTo(0));
        }

        [Test]
        public void RemovingObservationDeactivatesActorLightAndConfirmedFlashAndNewIdStartsClean()
        {
            var arena = CreateArena();
            var me = new SelfView { Id = 41, X = 80, Y = 120, Hp = 100, MaxHp = 100, Status = ActorStatus.Alive,
                Faction = FactionId.Fire, Weapon = WeaponId.Sword };
            arena.Present(new List<InterpActor>(), me, null, 0);
            Transform actorRoot = FindDirectChild(arena.transform, "Observed actor");
            Assert.That(actorRoot, Is.Not.Null);
            Light2D accent = actorRoot.GetComponentInChildren<Light2D>(true);
            Assert.That(accent, Is.Not.Null);
            Assert.That(accent.enabled, Is.True);

            arena.ConfirmedFx(new ServerMsg.Fx { List = new List<WireFx> { new WireFx { Kind = FxKind.Hit, Victim = 41 } } });
            Transform fxRoot = FindDirectChild(arena.transform, "Confirmed effects");
            Transform flash = FindDirectChild(fxRoot, "Confirmed impact");
            Assert.That(flash, Is.Not.Null);
            Assert.That(flash.gameObject.activeSelf, Is.True);

            arena.Present(new List<InterpActor>(), null, null, 0);
            Assert.That(actorRoot.gameObject.activeSelf, Is.False);
            Assert.That(accent.enabled, Is.False);
            Assert.That(flash.gameObject.activeSelf, Is.False);

            arena.Present(new List<InterpActor> { RemoteActor(52) }, null, null, 0);
            Assert.That(FindDirectChild(arena.transform, "Observed actor"), Is.SameAs(actorRoot));
            Assert.That(actorRoot.gameObject.activeSelf, Is.True);
            Assert.That(accent.enabled, Is.False, "a remote actor must not inherit the previous local actor's accent light");
            Assert.That(flash.gameObject.activeSelf, Is.False, "a pooled confirmed flash must not reappear for a new actor id");
            Assert.That(arena.IsObserved(41), Is.False);
            Assert.That(arena.IsObserved(52), Is.True);
        }

        [Test]
        public void LatestMembershipRemovesAnActorStillInTheDelayedInterpolationSample()
        {
            var arena=CreateArena();var oldSample=new List<InterpActor>{RemoteActor(77)};
            arena.Present(oldSample,null,null,0);
            arena.ConfirmedFx(new ServerMsg.Fx{List=new List<WireFx>{new WireFx{Kind=FxKind.Hit,Victim=77,Amount=12}}});
            arena.RetainObservedActors(new List<InterpActor>(),null);
            arena.Present(oldSample,null,null,0);
            Assert.That(arena.IsObserved(77),Is.False);
            Assert.That(FindDirectChild(arena.transform,"Observed actor").gameObject.activeSelf,Is.False);
            var effects=FindDirectChild(arena.transform,"Confirmed effects");
            foreach(Transform effect in effects) Assert.That(effect.gameObject.activeSelf,Is.False);
        }

        [Test]
        public void RenewedNpcHandleUsesLatestTypedFactsAndQueuedFxWithoutIdentityInference()
        {
            var arena=CreateArena();
            var old=RemoteActor(100);old.Kind=ActorKind.RegionalMob;
            var latest=old;latest.Id=101;latest.X=300;
            var delayed=new List<InterpActor>{old};
            arena.Present(delayed,null,null,0);
            arena.ConfirmedFx(new ServerMsg.Fx{List=new List<WireFx>{new WireFx{Kind=FxKind.Hit,Victim=101,Amount=7}}});
            arena.RetainObservedActors(new List<InterpActor>{latest},null);
            Assert.That(arena.IsObserved(100),Is.False);
            Assert.That(arena.IsObserved(101),Is.True);
            arena.Present(delayed,null,null,0);
            Assert.That(arena.IsObserved(100),Is.False);
            Assert.That(arena.IsObserved(101),Is.True);
            Assert.That(FindDirectChild(arena.transform,"Observed actor").position.x,Is.EqualTo(ArenaView.WorldPoint(300,240).x));
            var effects=FindDirectChild(arena.transform,"Confirmed effects");
            Assert.That(FindDirectChild(effects,"Confirmed impact").gameObject.activeSelf,Is.True);
            arena.RetainObservedActors(new List<InterpActor>(),null);
            foreach(Transform effect in effects) Assert.That(effect.gameObject.activeSelf,Is.False);
        }

        [Test]
        public void NormalPresentationRemovesLatestAbsentActorsAndQueuedCuesWithAudioDisabled()
        {
            var arena=CreateArena();
            var clientObject=CreateObject("test client without audio");
            var client=clientObject.AddComponent<MatchClient>();client.Arena=arena;
            clientObject.AddComponent<ShowcaseSoundscape>().enabled=false;
            var session=new Session(new SilentTransport(),new SessionOptions{Now=()=>0});
            typeof(MatchClient).GetProperty("Session").SetValue(client,session);
            var delayed=(List<InterpActor>)typeof(MatchClient).GetField("_actors",System.Reflection.BindingFlags.Instance|System.Reflection.BindingFlags.NonPublic).GetValue(client);
            var player=RemoteActor(77);var npc=RemoteActor(78);npc.Kind=ActorKind.RegionalMob;
            delayed.Add(player);delayed.Add(npc);
            session.Snapshots.Add(new ServerMsg.Snapshot{Tick=1,Actors=new[]{
                new WireActor{Id=77,Kind=0,X=120,Y=240,Status=1,HpPct=100},
                new WireActor{Id=78,Kind=1,X=140,Y=240,Status=1,HpPct=100}}});
            var present=typeof(MatchClient).GetMethod("Present",System.Reflection.BindingFlags.Instance|System.Reflection.BindingFlags.NonPublic);
            present.Invoke(client,null);
            Assert.That(arena.IsObserved(77)&&arena.IsObserved(78),Is.True);
            arena.ConfirmedFx(new ServerMsg.Fx{List=new List<WireFx>{
                new WireFx{Kind=FxKind.Hit,Victim=77,Amount=5},new WireFx{Kind=FxKind.Hit,Victim=79,Amount=9}}});
            session.Snapshots.Add(new ServerMsg.Snapshot{Tick=2});
            present.Invoke(client,null); // Still has the old delayed interpolation list.
            Assert.That(arena.IsObserved(77)||arena.IsObserved(78)||arena.IsObserved(79),Is.False);
            var effects=FindDirectChild(arena.transform,"Confirmed effects");
            foreach(Transform effect in effects) Assert.That(effect.gameObject.activeSelf,Is.False);
            session.Snapshots.Add(new ServerMsg.Snapshot{Tick=3,Actors=new[]{new WireActor{Id=79,Kind=1,X=120,Y=240,Status=1,HpPct=100}}});
            present.Invoke(client,null);
            Assert.That(arena.IsObserved(79),Is.True);
            foreach(Transform effect in effects) Assert.That(effect.gameObject.activeSelf,Is.False,"an absent subject's queued cue must not replay later");
            session.Snapshots.Clear(); // Same timeline reset performed by a resume Welcome.
            present.Invoke(client,null);
            Assert.That(arena.IsObserved(79),Is.False,"a new timeline cannot reuse stale NPC membership before its first snapshot");
        }

        sealed class SilentTransport : ITransport
        {
            public event System.Action Opened { add{} remove{} }
            public event System.Action<byte[]> Received { add{} remove{} }
            public event System.Action<string> Closed { add{} remove{} }
            public void Connect(string url){} public void Send(byte[] frame){} public void Close(){} public void Poll(){}
        }

        [Test]
        public void ShowcaseCatalogHasEightDirectionClipsAndAuthoredHumanSprites()
        {
            var catalog = Resources.Load<ShowcaseCatalog>("Showcase/Catalog");
            Assert.That(catalog, Is.Not.Null);
            foreach (string key in new[] { "hero", "hero-female" })
            {
                var appearance = catalog.Find(key);
                Assert.That(appearance, Is.Not.Null, key);
                Assert.That(appearance.GroundPivot.x, Is.InRange(0f, 1f), key + " pivot x");
                Assert.That(appearance.GroundPivot.y, Is.InRange(0f, 1f), key + " pivot y");
                AssertEightDirections(appearance.Idle, key + " idle");
                AssertEightDirections(appearance.Walk, key + " walk");
                AssertEightDirections(appearance.Attack, key + " attack");
                AssertEightDirections(appearance.Block, key + " block");
                AssertEightDirections(appearance.Hit, key + " hit");
                AssertEightDirections(appearance.Death, key + " death");
                AssertEightDirections(appearance.Cast, key + " cast");
                AssertEightDirections(appearance.Shoot, key + " shoot");
                Assert.That(appearance.IdleFPS,Is.EqualTo(5).Within(.01f),key+" authored idle cadence");
            }
        }

        [Test]
        public void ConfirmedBowCueAndDeliveredDeathSelectAuthoredFrames()
        {
            var arena=CreateArena();
            var me=new SelfView{Id=91,X=200,Y=200,Hp=100,MaxHp=100,Status=ActorStatus.Alive,Faction=FactionId.Fire,Weapon=WeaponId.Bow};
            arena.Present(new List<InterpActor>(),me,null,0);
            var body=FindDirectChild(FindDirectChild(arena.transform,"Observed actor"),"Authored character").GetComponent<SpriteRenderer>();
            var art=Resources.Load<ShowcaseCatalog>("Showcase/Catalog").Find("hero");
            arena.ConfirmedFx(new ServerMsg.Fx{List=new List<WireFx>{new WireFx{Kind=FxKind.Swing,By=91}}});
            arena.Present(new List<InterpActor>(),me,null,0);
            CollectionAssert.Contains(art.Shoot,body.sprite);
            me.Status=ActorStatus.Dead;
            arena.Present(new List<InterpActor>(),me,null,0);
            CollectionAssert.Contains(art.Death,body.sprite);
            Assert.That(body.transform.localRotation,Is.EqualTo(Quaternion.identity));
            Assert.That(me.Hp,Is.EqualTo(100),"art playback never applies game outcomes");
        }

        [Test]
        public void ArenaAndObservedActorsCreateNoPhysicsComponents()
        {
            var arena = CreateArena();
            arena.Present(new List<InterpActor> { RemoteActor(70) }, null, null, 0);

            Assert.That(arena.GetComponentsInChildren<Collider2D>(true), Is.Empty);
            Assert.That(arena.GetComponentsInChildren<Rigidbody2D>(true), Is.Empty);
            Assert.That(arena.GetComponentsInChildren<Collider>(true), Is.Empty);
            Assert.That(arena.GetComponentsInChildren<Rigidbody>(true), Is.Empty);
        }

        [Test]
        public void LoweringShowcaseQualityKeepsObservedActorAndEssentialIndicatorsVisible()
        {
            PlayerPrefs.SetInt(QualityModeKey, 1); // Manual
            PlayerPrefs.SetInt(ManualQualityKey, (int)ShowcaseQuality.High);
            var settingsObject = CreateObject("test showcase settings");
            settingsObject.AddComponent<ShowcaseSettings>();
            InvokeAwake(settingsObject.GetComponent<ShowcaseSettings>());
            var arena = CreateArena();
            var me = new SelfView { Id = 88, X = 200, Y = 180, Hp = 75, MaxHp = 100, Status = ActorStatus.Alive,
                Faction = FactionId.Frost, Weapon = WeaponId.Bow };
            arena.Present(new List<InterpActor>(), me, null, 0);
            Transform actor = FindDirectChild(arena.transform, "Observed actor");
            Assert.That(actor, Is.Not.Null);

            settingsObject.GetComponent<ShowcaseSettings>().CycleQuality(); // High to Medium
            settingsObject.GetComponent<ShowcaseSettings>().CycleQuality(); // Medium to Low
            arena.Present(new List<InterpActor>(), me, null, 0); // The following presentation frame applies the preference.

            Assert.That(ShowcaseSettings.Current.EffectiveQuality, Is.EqualTo(ShowcaseQuality.Low));
            Assert.That(actor.gameObject.activeSelf, Is.True);
            AssertRendererEnabled(actor, "Authored character");
            AssertRendererEnabled(actor, "Faction footprint");
            AssertRendererEnabled(actor, "Faction insignia");
            AssertRendererEnabled(actor, "Confirmed health");
            Assert.That(actor.GetComponentInChildren<Light2D>(true).enabled, Is.False);
        }

        ArenaView CreateArena()
        {
            var arenaObject = CreateObject("test arena");
            var arena = arenaObject.AddComponent<ArenaView>();
            InvokeAwake(arena);
            return arena;
        }

        // EditMode does not run the player lifecycle. Invoke its real C# initializer directly;
        // GameObject.SendMessage intentionally refuses non-ExecuteAlways behaviours outside Play mode.
        static void InvokeAwake(MonoBehaviour component)
        {
            component.GetType().GetMethod("Awake", System.Reflection.BindingFlags.Instance | System.Reflection.BindingFlags.NonPublic).Invoke(component, null);
        }

        GameObject CreateObject(string name)
        {
            var value = new GameObject(name);
            _objects.Add(value);
            return value;
        }

        static InterpActor RemoteActor(uint id)
        {
            return new InterpActor { Id = id, X = 120, Y = 240, Facing = .4f, HpPct = 82, Faction = FactionId.Plague,
                Status = ActorStatus.Alive, Weapon = WeaponId.Sword, Kind = ActorKind.Player };
        }

        static void RestorePreference(string key, bool hadKey, int value)
        {
            if (hadKey) PlayerPrefs.SetInt(key, value);
            else PlayerPrefs.DeleteKey(key);
        }

        static Transform FindDirectChild(Transform parent, string name)
        {
            if (parent == null) return null;
            for (int i = 0; i < parent.childCount; i++)
                if (parent.GetChild(i).name == name) return parent.GetChild(i);
            return null;
        }

        static void AssertEightDirections(Sprite[] frames, string label)
        {
            Assert.That(frames, Is.Not.Null.And.Not.Empty, label);
            Assert.That(frames.Length % 8, Is.Zero, label + " frame count must divide into eight direction rows");
            foreach (var sprite in frames) Assert.That(sprite, Is.Not.Null, label + " contains a missing sprite");
        }

        static void AssertRendererEnabled(Transform root, string name)
        {
            var child = FindDirectChild(root, name);
            Assert.That(child, Is.Not.Null, name + " object missing");
            var renderer = child.GetComponent<SpriteRenderer>();
            Assert.That(renderer, Is.Not.Null, name + " renderer missing");
            Assert.That(renderer.enabled, Is.True, name + " should remain visible at low quality");
        }
    }
}

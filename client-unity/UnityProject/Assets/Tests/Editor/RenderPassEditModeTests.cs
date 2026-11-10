using System.Collections.Generic;
using NUnit.Framework;
using Roguehalla.Net;
using Roguehalla.Net.Protocol;
using UnityEngine;
using UnityEngine.Rendering.Universal;

namespace Roguehalla.Client.Tests
{
    /// <summary>
    /// The render pass (docs/rework/RENDER_PLAN.md): every effect has its own switch, is culled to the camera, nothing is emitted for actors the
    /// client was not given, and the passive light floor and light ordering never depend on any of it.
    /// </summary>
    public sealed class RenderPassEditModeTests
    {
        readonly List<Object> _objects = new List<Object>();

        [SetUp] public void SetUp() { Quality.Set(ShowcaseQuality.Ultra, default(QualityOverrides)); AtmosphereQuality.SetUrl(""); AtmosphereQuality.ApplyPreset(ShowcaseQuality.Ultra, false); LocalLightField.Clear(); }
        [TearDown]
        public void TearDown()
        {
            foreach (var o in _objects) if (o != null) Object.DestroyImmediate(o);
            _objects.Clear();
            Quality.Reset(); AtmosphereQuality.SetUrl(""); AtmosphereQuality.ApplyPreset(ShowcaseQuality.High, false); LocalLightField.Clear();
        }

        // ---- switches -------------------------------------------------------------------------------------------------------------
        [Test] public void UltraTurnsEveryRenderPassOnAndLowTurnsThemOff()
        {
            AtmosphereQuality.ApplyPreset(ShowcaseQuality.Ultra, false);
            Assert.IsTrue(AtmosphereQuality.LocalLights && AtmosphereQuality.Relief && AtmosphereQuality.LocalShadows && AtmosphereQuality.Cookies && AtmosphereQuality.Gloss);
            Assert.IsTrue(AtmosphereQuality.Wind && AtmosphereQuality.Clouds && AtmosphereQuality.Water && AtmosphereQuality.Fireflies && AtmosphereQuality.EmberLight && AtmosphereQuality.FxLights && AtmosphereQuality.Sparks);
            Assert.Greater(AtmosphereQuality.EffectiveLocalLights, AtmosphereQuality.HardMaxLights, "the analytic budget is no longer tied to the Light2D pool");
            AtmosphereQuality.ApplyPreset(ShowcaseQuality.Low, false);
            Assert.IsFalse(AtmosphereQuality.LocalLights || AtmosphereQuality.Relief || AtmosphereQuality.Wind || AtmosphereQuality.Clouds || AtmosphereQuality.Fireflies || AtmosphereQuality.Sparks);
            Assert.AreEqual(0, AtmosphereQuality.EffectiveLocalLights);
            AtmosphereQuality.ApplyPreset(ShowcaseQuality.High, false);
            Assert.IsTrue(AtmosphereQuality.Relief && AtmosphereQuality.Wind); Assert.IsFalse(AtmosphereQuality.Fireflies, "fireflies are an Ultra extra");
            AtmosphereQuality.ApplyPreset(ShowcaseQuality.Ultra, true);
            Assert.IsFalse(AtmosphereQuality.Wind || AtmosphereQuality.Clouds || AtmosphereQuality.Fireflies, "reduced motion stills the sway, the clouds and the wandering lights");
        }

        [Test] public void EveryRenderPassHasItsOwnUrlSwitch()
        {
            string[] keys = { "locallights", "relief", "lshadows", "cookies", "gloss", "wind", "clouds", "water", "fireflies", "emberlight", "fxlights", "sparks", "actorlights" };
            System.Func<bool>[] get =
            {
                () => AtmosphereQuality.LocalLights, () => AtmosphereQuality.Relief, () => AtmosphereQuality.LocalShadows, () => AtmosphereQuality.Cookies, () => AtmosphereQuality.Gloss,
                () => AtmosphereQuality.Wind, () => AtmosphereQuality.Clouds, () => AtmosphereQuality.Water, () => AtmosphereQuality.Fireflies, () => AtmosphereQuality.EmberLight,
                () => AtmosphereQuality.FxLights, () => AtmosphereQuality.Sparks, () => AtmosphereQuality.ActorLights,
            };
            for (int i = 0; i < keys.Length; i++)
            {
                AtmosphereQuality.SetUrl("http://x/?fx." + keys[i] + "=0"); AtmosphereQuality.ApplyPreset(ShowcaseQuality.Ultra, false);
                Assert.IsFalse(get[i](), keys[i] + " off");
                for (int j = 0; j < keys.Length; j++) if (j != i) Assert.IsTrue(get[j](), keys[j] + " unaffected by " + keys[i]);
            }
            Assert.IsFalse(AtmosphereQuality.Painterly, "the painterly grade is held off by default (it lifted luma and cost marker contrast)");
            AtmosphereQuality.SetUrl("http://x/?fx.painterly=1"); AtmosphereQuality.ApplyPreset(ShowcaseQuality.Ultra, false); Assert.IsTrue(AtmosphereQuality.Painterly);
            AtmosphereQuality.SetUrl(""); AtmosphereQuality.ApplyPreset(ShowcaseQuality.Ultra, false);
            Assert.IsFalse(AtmosphereQuality.Tonemap, "the tonemap is held off by default (it cost contrast in the bright zones)");
            AtmosphereQuality.SetUrl("http://x/?fx.tonemap=1"); AtmosphereQuality.ApplyPreset(ShowcaseQuality.Ultra, false); Assert.IsTrue(AtmosphereQuality.Tonemap);
            AtmosphereQuality.SetUrl("http://x/?fx.maxlights=3"); AtmosphereQuality.ApplyPreset(ShowcaseQuality.Ultra, false);
            Assert.AreEqual(3, AtmosphereQuality.EffectiveLocalLights);
            AtmosphereQuality.SetUrl("http://x/?fx.maxlights=999"); AtmosphereQuality.ApplyPreset(ShowcaseQuality.Ultra, false);
            Assert.AreEqual(LocalLightField.Max, AtmosphereQuality.EffectiveLocalLights, "a URL can never ask for an unbounded light count");
            AtmosphereQuality.SetUrl("http://x/?fx.locallights=0"); AtmosphereQuality.ApplyPreset(ShowcaseQuality.Ultra, false);
            Assert.AreEqual(0, AtmosphereQuality.EffectiveLocalLights); Assert.IsFalse(AtmosphereQuality.AnalyticLights);
        }

        // ---- the light field ------------------------------------------------------------------------------------------------------
        [Test] public void LightFieldIsCappedFlashesAgeOutAndStagedLightsLastOneFrame()
        {
            LocalLightField.Begin(3);
            for (int i = 0; i < 10; i++) LocalLightField.Add(i, i, 1, 3, 1, 1, 1);
            Assert.AreEqual(3, LocalLightField.Count, "the cap is hard");
            LocalLightField.Begin(LocalLightField.Max); Assert.AreEqual(0, LocalLightField.Count);
            Assert.IsFalse(LocalLightField.Add(0, 0, 1, 0f, 1, 1, 1), "a light with no radius is not a light");
            LocalLightField.Flash(5, 5, 1, 4, Color.white, 2f, .4f);
            LocalLightField.Stage(8, 8, 1, 3, 1, 1, 1);
            LocalLightField.Begin(LocalLightField.Max); LocalLightField.AddFlashes(.1f);
            Assert.AreEqual(2, LocalLightField.Count, "one staged light and one live flash");
            LocalLightField.Begin(LocalLightField.Max); LocalLightField.AddFlashes(.1f);
            Assert.AreEqual(1, LocalLightField.Count, "the staged light was consumed; the flash is still alive");
            LocalLightField.Begin(LocalLightField.Max); LocalLightField.AddFlashes(1f);
            Assert.AreEqual(0, LocalLightField.Count); Assert.AreEqual(0, LocalLightField.LiveFlashes, "flashes always end");
            for (int i = 0; i < 40; i++) LocalLightField.Flash(i, 0, 1, 2, Color.white, 1f, 1f);
            Assert.LessOrEqual(LocalLightField.LiveFlashes, LocalLightField.MaxFlashes, "the flash ring is bounded");
            LocalLightField.Begin(LocalLightField.Max); LocalLightField.AddFlashes(.01f); LocalLightField.Push(true, true, true, true);
            Assert.AreEqual(LocalLightField.Count, Shader.GetGlobalVector("_RhLI").x);
            LocalLightField.Clear(); Assert.AreEqual(0, Shader.GetGlobalVector("_RhLI").x, "cleared: the shaders loop over nothing");
        }

        [Test] public void WallDistanceIsSignedAndBounded()
        {
            const int w = 16; var tiles = new byte[w * w];
            for (int y = 6; y < 10; y++) for (int x = 6; x < 10; x++) tiles[y * w + x] = MapBlob.Wall;
            var px = WallSdf.Bake(tiles, w, w); int tw = w * WallSdf.TexelsPerTile;
            float At(float tx, float ty) { return WallSdf.Decode(px[(int)(ty * WallSdf.TexelsPerTile) * tw + (int)(tx * WallSdf.TexelsPerTile)]); }
            Assert.Less(At(8f, 8f), -.8f, "deep inside a wall is negative");
            Assert.Greater(At(2f, 2f), 3f, "open floor reads about its distance, clamped to the encoded range");
            Assert.AreEqual(1.0f, At(5.0f, 8f), .35f, "one tile off the wall edge");
            Assert.LessOrEqual(At(0.5f, 0.5f), 4.05f);
            Assert.Less(At(5.5f, 8f), At(3.5f, 8f));
        }

        [Test] public void ActorFieldUploadsOnlyTheNearestEightPresentedActors()
        {
            ActorField.Begin();
            for (int i = 0; i < 20; i++) ActorField.Note(ArenaView.WorldPoint(i * 32f * 3f, 0f));
            Assert.AreEqual(20, ActorField.Noted);
            int n = ActorField.Push(0f, 0f); Assert.AreEqual(ActorField.Max, n);
            for (int i = 0; i < n; i++) Assert.LessOrEqual(ActorField.SentAt(i).x, 7 * 3f + .01f, "the eight nearest to the camera");
            ActorField.Begin(); Assert.AreEqual(0, ActorField.Push(0f, 0f), "nothing presented, nothing uploaded");
        }

        // ---- wind: the prop atlas ---------------------------------------------------------------------------------------------------
        [Test] public void WindCapableArtSitsBelowTheAtlasThreshold()
        {
            Assert.IsTrue(RegionPropArt.TryGet("plague.tree", out var tree)); Assert.IsTrue(RegionPropArt.TryGet("holy.palm", out var palm));
            Assert.IsTrue(RegionPropArt.TryGet("sent.tomb", out var tomb)); Assert.IsTrue(RegionPropArt.TryGet("temple.column", out var column));
            float v = RegionPropArt.SwayV; Assert.Greater(v, 0f); Assert.Less(v, 1f);
            float Top(RegionPropSprite s) { var r = s.Sprite.textureRect; return (r.y + r.height) / RegionPropArt.Atlas.height; }
            float Bottom(RegionPropSprite s) { var r = s.Sprite.textureRect; return r.y / RegionPropArt.Atlas.height; }
            Assert.Less(Top(tree), v); Assert.Less(Top(palm), v); Assert.Greater(Bottom(tomb), v); Assert.Greater(Bottom(column), v);
            foreach (var key in RegionPropArt.Keys)
            {
                RegionPropArt.TryGet(key, out var s);
                if (RegionPropArt.Sways(key)) Assert.Less(Top(s), v, key + " sways"); else Assert.Greater(Bottom(s), v, key + " is rigid");
            }
        }

        // ---- arena integration ------------------------------------------------------------------------------------------------------
        static MapBlob LavaMap()
        {
            const int w = 64; var tiles = new byte[w * w]; var regions = new byte[w * w]; var terrain = new byte[w * w];
            for (int i = 0; i < regions.Length; i++) regions[i] = (byte)RegionId.Fire;
            foreach (var b in new[] { new[] { 24, 24 }, new[] { 34, 24 }, new[] { 24, 34 }, new[] { 34, 34 }, new[] { 44, 24 }, new[] { 14, 24 }, new[] { 24, 14 }, new[] { 34, 14 }, new[] { 44, 34 } })
                for (int y = b[1]; y < b[1] + 4; y++) for (int x = b[0]; x < b[0] + 4; x++) terrain[y * w + x] = (byte)TerrainKind.Lava;
            for (int y = 0; y < w; y++) for (int x = 0; x < w; x++) if (x == 0 || y == 0 || x == w - 1 || y == w - 1 || (x == 30 && y < 40)) tiles[y * w + x] = MapBlob.Wall;
            return new MapBlob(w, w, tiles, terrain, regions, MapBlob.GroundTerrainAll);
        }

        ArenaView Arena(out Camera cam)
        {
            var camGo = new GameObject("cam"); _objects.Add(camGo); cam = camGo.AddComponent<Camera>(); cam.orthographic = true; cam.orthographicSize = 9; cam.allowHDR = true;
            camGo.AddComponent<UniversalAdditionalCameraData>();
            var go = new GameObject("arena"); _objects.Add(go); var arena = go.AddComponent<ArenaView>();
            typeof(ArenaView).GetMethod("Awake", System.Reflection.BindingFlags.NonPublic | System.Reflection.BindingFlags.Instance).Invoke(arena, null);
            arena.Build(LavaMap());
            return arena;
        }

        void Frame(ArenaView arena, Camera cam, float tx, float ty, int frames = 4)
        {
            arena.Regions.SnapLocal(tx * 32f, ty * 32f);
            arena.Follow(cam, tx * 32f, ty * 32f);
            for (int i = 0; i < frames; i++) arena.Atmosphere.OnFollow(cam, 1f);
        }

        [Test] public void AccentLightsFeedTheFieldAndTheirLight2DTwinsOnlyLightActors()
        {
            var arena = Arena(out var cam); Frame(arena, cam, 30f, 30f);
            var lights = arena.Atmosphere.Lights;
            Assert.Greater(LocalLightField.Count, 0, "lava in view lights the field");
            Assert.LessOrEqual(LocalLightField.Count, AtmosphereQuality.EffectiveLocalLights);
            Assert.LessOrEqual(lights.ActiveLight2D, AtmosphereQuality.EffectiveMaxLights, "the Light2D pool for actors stays small");
            Assert.AreEqual(2, lights.Light2DBlendStyle, "Light2D twins use the masked blend style: the region shaders (mask 0) take these lights analytically");
            for (int i = 0; i < LocalLightField.Count; i++)
            {
                var p = LocalLightField.PositionAt(i); Assert.Greater(p.w, 0f); Assert.That(p.x, Is.InRange(30 - 30, 30 + 30), "culled to the camera");
            }
            // cookies and shadows are decided per site: lava casts shadows, bog and holy light use leaf dapple
            Assert.IsTrue(CastsShadow(TerrainKind.Lava)); Assert.IsFalse(CastsShadow(TerrainKind.Ice));
            AccentLights.Shape(new TerrainCluster { Kind = TerrainKind.Bog }, out _, out int cookie, out _); Assert.AreEqual(LocalLightField.CookieDapple, cookie);
            AccentLights.Shape(new TerrainCluster { Lantern = true }, out _, out cookie, out bool shadow); Assert.AreEqual(LocalLightField.CookieGrate, cookie); Assert.IsTrue(shadow);
            AccentLights.Shape(new TerrainCluster { Lantern = true, TempleLamp = true }, out _, out cookie, out _); Assert.AreEqual(LocalLightField.CookieGlass, cookie);
        }
        static bool CastsShadow(TerrainKind k) { AccentLights.Shape(new TerrainCluster { Kind = k }, out _, out _, out bool s); return s; }

        [Test] public void TurningTheFieldOffRestoresTheFlatLight2DLook()
        {
            var arena = Arena(out var cam);
            AtmosphereQuality.SetUrl("http://x/?fx.locallights=0"); AtmosphereQuality.ApplyPreset(ShowcaseQuality.Ultra, false);      // after Awake, which reads the (empty) page URL
            Frame(arena, cam, 30f, 30f);
            Assert.AreEqual(0, LocalLightField.Count, "no analytic lights"); Assert.AreEqual(0, Shader.GetGlobalVector("_RhLI").x);
            Assert.AreEqual(0, arena.Atmosphere.Lights.Light2DBlendStyle, "blend style 0: the ground is lit by Light2D exactly as before");
            Assert.Greater(arena.Atmosphere.Lights.ActiveLight2D, 0, "and the Light2D pool still lights");
        }

        [Test] public void CharactersTakeTheAnalyticLightsAndTheTwinsStandDown()
        {
            var arena = Arena(out var cam);
            var me = new SelfView { Id = 1, Faction = FactionId.Fire, X = 30 * 32f, Y = 30 * 32f, Hp = 900, MaxHp = 985, Weapon = WeaponId.Sword, Status = ActorStatus.Alive };
            arena.Present(new List<InterpActor>(), me, null, 0f); Frame(arena, cam, 30f, 30f);
            Assert.AreEqual(0, arena.Atmosphere.Lights.ActiveLight2D, "actor lights on: the Light2D twins are not needed");
            Assert.AreEqual(1f, Shader.GetGlobalVector("_RhLG").y, "the actor shader reads the field (and masks the twins)");
            var body = FindRenderer(arena.transform, "Authored character"); Assert.NotNull(body);
            Assert.AreEqual("Roguehalla/ActorLit", body.sharedMaterial.shader.name);
            AtmosphereQuality.SetUrl("http://x/?fx.actorlights=0"); AtmosphereQuality.ApplyPreset(ShowcaseQuality.Ultra, false);
            Frame(arena, cam, 30f, 30f);
            Assert.Greater(arena.Atmosphere.Lights.ActiveLight2D, 0, "actor lights off: the Light2D twins light them as before"); Assert.AreEqual(0f, Shader.GetGlobalVector("_RhLG").y);
        }
        static SpriteRenderer FindRenderer(Transform root, string name)
        {
            foreach (var r in root.GetComponentsInChildren<SpriteRenderer>(true)) if (r.gameObject.name == name) return r;
            return null;
        }

        [Test] public void LightBudgetRespectsTheQualityCap()
        {
            var arena = Arena(out var cam);
            AtmosphereQuality.SetUrl("http://x/?fx.maxlights=2"); AtmosphereQuality.ApplyPreset(ShowcaseQuality.Ultra, false);
            Frame(arena, cam, 30f, 30f);
            Assert.LessOrEqual(LocalLightField.Count, 2);
        }

        [Test] public void LivingLightsFollowTheirSwitchesAndPools()
        {
            var arena = Arena(out var cam); var life = arena.Atmosphere.Life;
            for (int i = 0; i < 60; i++) Frame(arena, cam, 30f, 30f, 1);                    // the map is all Fire: embers rise off the lava, there are no fireflies
            Assert.Greater(life.LiveEmbers, 0, "embers off the lava"); Assert.AreEqual(0, life.LiveFireflies, "fireflies belong to the Plague marsh");
            Assert.LessOrEqual(life.Live, LifeLights.Cap); Assert.LessOrEqual(life.LiveEmbers, LifeLights.MaxEmbers);
            AtmosphereQuality.SetUrl("http://x/?fx.emberlight=0"); AtmosphereQuality.ApplyPreset(ShowcaseQuality.Ultra, false);
            for (int i = 0; i < 40; i++) arena.Atmosphere.OnFollow(cam, .1f);
            Assert.AreEqual(0, life.LiveEmbers); Assert.AreEqual(0, life.DrawnSprites, "switched off: nothing lives and no sprite is drawn");
        }

        [Test] public void WindAndCloudShadowsReachTheShadersOnlyWhileSwitchedOn()
        {
            var arena = Arena(out var cam); Frame(arena, cam, 30f, 30f);
            Assert.Greater(Shader.GetGlobalVector("_RhWind").z, 0f); Assert.AreEqual(1f, Shader.GetGlobalVector("_RhActorN").y);
            AtmosphereQuality.SetUrl("http://x/?fx.wind=0&fx.clouds=0"); AtmosphereQuality.ApplyPreset(ShowcaseQuality.Ultra, false);
            arena.Atmosphere.OnFollow(cam, .1f);
            Assert.AreEqual(0f, Shader.GetGlobalVector("_RhWind").z, "no sway"); Assert.AreEqual(0f, Shader.GetGlobalVector("_RhActorN").y, "no cloud shadows");
        }

        [Test] public void PresentedActorsAreExactlyTheOnesTheClientDraws()
        {
            var arena = Arena(out var cam);
            var remote = new List<InterpActor>
            {
                new InterpActor { Id = 10, Faction = FactionId.Fire, Status = ActorStatus.Alive, Weapon = WeaponId.Sword, HpPct = 90, X = 31 * 32f, Y = 31 * 32f, Kind = ActorKind.Player },
                new InterpActor { Id = 11, Faction = FactionId.Plague, Status = ActorStatus.Alive, Weapon = WeaponId.Sword, HpPct = 90, X = 33 * 32f, Y = 31 * 32f, Kind = ActorKind.Player },
            };
            var me = new SelfView { Id = 1, Faction = FactionId.Fire, X = 30 * 32f, Y = 30 * 32f, Hp = 900, MaxHp = 985, Weapon = WeaponId.Sword, Status = ActorStatus.Alive };
            arena.Present(remote, me, null, 0f);
            Assert.AreEqual(3, ActorField.Noted, "the owner and two delivered actors");
            arena.Present(new List<InterpActor>(), me, null, 0f);
            Assert.AreEqual(1, ActorField.Noted, "an actor that was not delivered casts no clearing, no bend");
        }

        // ---- combat light and sparks -----------------------------------------------------------------------------------------------
        [Test] public void ImpactSparksAppearOnlyForShotsThatWereDeliveredAndVanished()
        {
            var parent = new GameObject("sparks"); _objects.Add(parent);
            var sparks = new CombatSparks(parent.transform); uint rng = 7;
            var shot = new List<NetProjectileView> { new NetProjectileView { Kind = ProjectileKind.Arrow, X = 600, Y = 600, Owner = 5 } };
            var center = ArenaView.WorldPoint(600, 600);
            sparks.Observe(1, shot, center, 12, 9, ref rng); Assert.AreEqual(0, sparks.Live, "first sight of a shot is not an impact");
            shot[0] = new NetProjectileView { Kind = ProjectileKind.Arrow, X = 620, Y = 600, Owner = 5 };
            sparks.Observe(2, shot, center, 12, 9, ref rng); Assert.AreEqual(0, sparks.Live, "a shot that moved on did not strike");
            sparks.Observe(3, new List<NetProjectileView>(), center, 12, 9, ref rng);
            Assert.Greater(sparks.Live, 0, "a delivered shot that disappeared inside the view struck something");
            Assert.Greater(LocalLightField.LiveFlashes, 0, "and lit the scene for a moment");
            AtmosphereQuality.SetUrl("http://x/?fx.sparks=0&fx.fxlights=0"); AtmosphereQuality.ApplyPreset(ShowcaseQuality.Ultra, false); LocalLightField.Clear(); sparks.Clear();
            sparks.Observe(4, shot, center, 12, 9, ref rng); sparks.Observe(5, new List<NetProjectileView>(), center, 12, 9, ref rng);
            Assert.AreEqual(0, sparks.Live, "switch off: no particles"); Assert.AreEqual(0, LocalLightField.LiveFlashes, "switch off: no flash");
        }

        [Test] public void ShotsLeavingAtTheEdgeOfTheViewMakeNoImpact()
        {
            var parent = new GameObject("sparks"); _objects.Add(parent);
            var sparks = new CombatSparks(parent.transform); uint rng = 7;
            var shot = new List<NetProjectileView> { new NetProjectileView { Kind = ProjectileKind.Ball, X = 600, Y = 600, Owner = 5 } };
            var far = ArenaView.WorldPoint(600 + 30 * 32f, 600);           // the camera is 30 tiles away: the shot was off screen
            sparks.Observe(1, shot, far, 12, 9, ref rng); sparks.Observe(2, new List<NetProjectileView>(), far, 12, 9, ref rng);
            Assert.AreEqual(0, sparks.Live);
        }

        [Test] public void HitSparksAndLightFollowTheirSwitches()
        {
            var parent = new GameObject("sparks"); _objects.Add(parent);
            var sparks = new CombatSparks(parent.transform); uint rng = 3;
            sparks.Hit(Vector3.zero, false, ref rng); Assert.Greater(sparks.Live, 0); Assert.Greater(LocalLightField.LiveFlashes, 0);
            sparks.Clear(); LocalLightField.Clear();
            AtmosphereQuality.SetUrl("http://x/?fx.fxlights=0"); AtmosphereQuality.ApplyPreset(ShowcaseQuality.Ultra, false);
            sparks.Hit(Vector3.zero, true, ref rng); Assert.Greater(sparks.Live, 0, "sparks are a separate switch"); Assert.AreEqual(0, LocalLightField.LiveFlashes);
        }

        // ---- falling leaves ride the wind switch ----------------------------------------------------------------------------------------------
        [Test] public void FallingLeavesExistInPlagueAndHolyAndFollowTheWindSwitch()
        {
            foreach (var id in new[] { ParticlePresetId.Spores, ParticlePresetId.Pollen })
            {
                bool any = false; foreach (var l in ParticlePresets.Get(id)) if (l.WindDriven) { any = true; Assert.AreEqual("chaff", l.Texture); Assert.IsFalse(l.AboveActors, "leaves never fall over characters"); }
                Assert.IsTrue(any, id + " has leaves"); Assert.LessOrEqual(ParticlePresets.Layers(id), ParticlePresets.MaxLayers);
            }
            int on = ParticlePresets.Budget(ParticlePresetId.Spores, 1f);
            AtmosphereQuality.SetUrl("http://x/?fx.wind=0"); AtmosphereQuality.ApplyPreset(ShowcaseQuality.Ultra, false);
            Assert.Less(ParticlePresets.Budget(ParticlePresetId.Spores, 1f), on, "no wind, no leaves");
        }

        // ---- no per-frame managed allocation ------------------------------------------------------------------------------------------------
        [Test] public void TheRenderPassAllocatesNothingPerFrame()
        {
            var arena = Arena(out var cam); Frame(arena, cam, 30f, 30f, 8);
            var parent = new GameObject("sparks"); _objects.Add(parent); var sparks = new CombatSparks(parent.transform); uint rng = 11;
            var shots = new List<NetProjectileView> { new NetProjectileView { Kind = ProjectileKind.Arrow, X = 900, Y = 900, Owner = 3 } };
            var life = arena.Atmosphere.Life; var lights = arena.Atmosphere.Lights;
            for (int i = 0; i < 20; i++) { LocalLightField.Begin(20); LocalLightField.AddFlashes(.016f); lights.Tick(30f, 30f, 12f, 9f, .016f, i * .016f); life.Tick(.016f, i * .016f, 30f, 30f, 12f, 9f, 0f, 1f, lights.Planner); LocalLightField.Push(true, true, true, true, true); ActorField.Begin(); ActorField.Note(Vector3.zero); ActorField.Push(30f, 30f); sparks.Observe((uint)i, shots, Vector3.zero, 12, 9, ref rng); }      // warm up (first calls may JIT or size pools)
            long before = System.GC.GetAllocatedBytesForCurrentThread();
            for (int i = 0; i < 200; i++)
            {
                float t = 2f + i * .016f;
                LocalLightField.Begin(20); LocalLightField.Stage(30, 30, 1, 3, 1, 1, 1); LocalLightField.Flash(31, 31, 1, 3, Color.white, 1f, .2f); LocalLightField.AddFlashes(.016f);
                lights.Tick(30f, 30f, 12f, 9f, .016f, t); life.Tick(.016f, t, 30f, 30f, 12f, 9f, 0f, 1f, lights.Planner);
                LocalLightField.Push(true, true, true, true, true);
                ActorField.Begin(); ActorField.Note(Vector3.zero); ActorField.Note(Vector3.one); ActorField.Push(30f, 30f);
                sparks.Trail(Vector3.zero, Vector3.left, Color.white, .1f); sparks.Burst(Vector3.zero, Color.white, 3, 2f, .1f, ref rng); sparks.Observe((uint)(100 + i), shots, Vector3.zero, 12, 9, ref rng);
            }
            long grown = System.GC.GetAllocatedBytesForCurrentThread() - before;
            Assert.LessOrEqual(grown, 4096, "200 frames of light field, accent and living lights, actor field and sparks allocated " + grown + " bytes");
        }

        // ---- the passive floor and the ordering never depend on these effects -----------------------------------------------------------
        [Test] public void PassiveLightFloorAndOrderingIgnoreEveryRenderPass()
        {
            float L(RegionId r) { return AtmosphereLighting.Level(RegionAtmosphereTable.Get(r).Params); }
            AtmosphereQuality.SetUrl("http://x/?fx.locallights=0&fx.wind=0&fx.clouds=0&fx.water=0"); AtmosphereQuality.ApplyPreset(ShowcaseQuality.Low, false);
            float holy = L(RegionId.Holy), frost = L(RegionId.Frost), plague = L(RegionId.Plague), fire = L(RegionId.Fire), sent = L(RegionId.Sentenced);
            AtmosphereQuality.SetUrl(""); AtmosphereQuality.ApplyPreset(ShowcaseQuality.Ultra, false);
            Assert.AreEqual(holy, L(RegionId.Holy), 1e-6f); Assert.AreEqual(sent, L(RegionId.Sentenced), 1e-6f);
            Assert.Greater(holy, frost); Assert.Greater(frost, plague); Assert.Greater(plague, fire); Assert.Greater(fire, sent - .0001f);
            for (int i = 1; i <= 6; i++)
            {
                var p = RegionAtmosphereTable.Get(i).Params; var m = AtmosphereLighting.Passive(p, AtmosphereLighting.FlatNdl);
                Assert.GreaterOrEqual(m.r, AtmosphereLighting.GlobalMinFloor - 1e-4f); Assert.GreaterOrEqual(m.g, AtmosphereLighting.GlobalMinFloor - 1e-4f);
            }
        }

        [Test] public void ZoneGradesNeverLiftBlacksAboveTheFloor()
        {
            for (int i = 0; i <= 6; i++)
            {
                var p = RegionAtmosphereTable.Get(i).Params;
                Assert.LessOrEqual(p.Lift.w, .06f, "painterly lift is gentle, region " + i); Assert.LessOrEqual(p.Gain.w, .1f, "gain is gentle, region " + i);
                Assert.Greater(p.Lift.x + p.Lift.y + p.Lift.z, 1.5f, "the lift tint is a tint, not a colour wash, region " + i);
            }
            var a = RegionAtmosphereTable.Get(RegionId.Sentenced).Params; var b = RegionAtmosphereTable.Get(RegionId.Holy).Params;
            var mid = AtmosphereParams.Lerp(a, b, .5f); Assert.AreEqual((a.Lift.w + b.Lift.w) * .5f, mid.Lift.w, 1e-5f, "grades blend continuously across a border");
        }
    }
}

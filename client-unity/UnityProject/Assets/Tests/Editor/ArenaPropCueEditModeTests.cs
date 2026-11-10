using System;
using System.Collections.Generic;
using System.Reflection;
using NUnit.Framework;
using Roguehalla.Client;
using ClientArenaView = Roguehalla.Client.ArenaView;
using Roguehalla.Net;
using Roguehalla.Net.Protocol;
using UnityEngine;

namespace Roguehalla.Client.Tests
{
    public sealed class ArenaPropCueEditModeTests
    {
        readonly List<GameObject> _objects = new List<GameObject>();

        [TearDown]
        public void TearDown()
        {
            for (int i = _objects.Count - 1; i >= 0; i--)
                if (_objects[i] != null) UnityEngine.Object.DestroyImmediate(_objects[i]);
            _objects.Clear();
        }

        [Test]
        public void GroundPropsUseTheirDeliveredWeaponGlyphAndUnknownValuesStayNeutral()
        {
            var arena = CreateArena();
            var rows = new WireProp[6];
            for (byte weapon = 0; weapon < 5; weapon++)
                rows[weapon] = Ground((uint)(weapon + 1), (ushort)(100 + weapon * 80), weapon);
            rows[5] = Ground(6, 580, 255); // Bypass decoding to prove malformed public state still has a safe neutral fallback.

            arena.PresentCollections(BuildPublicCollections(rows));

            var root = FindDirectChild(arena.transform, "Observed collections");
            for (int weapon = 0; weapon < 5; weapon++)
            {
                var glyph = FindAtX(root, WorldPointFromRaw((ushort)(100 + weapon * 80), 200).x, ShowcaseSprites.Get("weapon" + weapon));
                Assert.That(glyph, Is.Not.Null, "ground weapon " + weapon + " must use its matching generated glyph");
                Assert.That(glyph.gameObject.activeSelf, Is.True);
                Assert.That(glyph.sharedMaterial, Is.SameAs(ShowcaseSprites.Unlit));
            }
            var unknown = FindAtX(root, WorldPointFromRaw(580, 200).x, ShowcaseSprites.Get("stone"));
            Assert.That(unknown, Is.Not.Null, "unsupported values use a neutral cue rather than a known weapon glyph");
            Assert.That(FindAtX(root, WorldPointFromRaw(580, 200).x, ShowcaseSprites.Get("weapon4")), Is.Null);
        }

        [Test]
        public void WindEmblemAndCannonHaveDistinctVisibleUnlitSilhouettes()
        {
            var arena = CreateArena();
            arena.PresentCollections(BuildPublicCollections(
                new WireProp { Handle = new PickupHandle(1), X = 100, Y = 200, Kind = PropKind.WindEmblem },
                new WireProp { Handle = new PickupHandle(2), X = 400, Y = 200, Kind = PropKind.Cannon }));

            var root = FindDirectChild(arena.transform, "Observed collections");
            float windX = WorldPointFromRaw(100, 200).x;
            float cannonX = WorldPointFromRaw(400, 200).x;
            var windSprites = SpritesNear(root, windX);
            var cannonSprites = SpritesNear(root, cannonX);
            CollectionAssert.Contains(windSprites, ShowcaseSprites.Get("rune"));
            CollectionAssert.Contains(windSprites, ShowcaseSprites.Get("spark"));
            CollectionAssert.Contains(windSprites, ShowcaseSprites.Get("ring"));
            CollectionAssert.Contains(cannonSprites, ShowcaseSprites.Get("stone"));
            CollectionAssert.Contains(cannonSprites, ShowcaseSprites.Get("bar"));
            CollectionAssert.Contains(cannonSprites, ShowcaseSprites.Get("ring"));
            CollectionAssert.DoesNotContain(cannonSprites, ShowcaseSprites.Get("rune"));
            CollectionAssert.DoesNotContain(windSprites, ShowcaseSprites.Get("stone"));
            foreach (var renderer in root.GetComponentsInChildren<SpriteRenderer>(true))
                if (renderer.gameObject.activeSelf && (Mathf.Abs(renderer.transform.position.x - windX) < .6f || Mathf.Abs(renderer.transform.position.x - cannonX) < .6f))
                    Assert.That(renderer.sharedMaterial, Is.SameAs(ShowcaseSprites.Unlit));
        }

        [Test]
        public void DeliveredChestOpenStateAddsVisibleOpeningAndPooledPropsClearCleanly()
        {
            var arena = CreateArena();
            var root = FindDirectChild(arena.transform, "Observed collections");
            var closed = new WireProp { Handle = new PickupHandle(1), X = 200, Y = 200, Kind = PropKind.Chest, Open = false };
            arena.PresentCollections(BuildPublicCollections(closed));
            int closedCount = ActiveRendererCount(root);

            var open = closed;
            open.Open = true;
            arena.PresentCollections(BuildPublicCollections(open));
            int openCount = ActiveRendererCount(root);
            Assert.That(openCount, Is.EqualTo(closedCount + 2), "the delivered open boolean adds the opening and raised lid cues");
            Assert.That(FindAtX(root, WorldPointFromRaw(200, 200).x, ShowcaseSprites.Get("bar")), Is.Not.Null);

            var focusedGround = Ground(2, 200, 0);
            var focused = BuildPublicCollections(new[] { focusedGround }, 2);
            arena.PresentCollections(focused);
            Assert.That(ActiveRendererCount(root), Is.EqualTo(4), "shadow, weapon cue, and the focused gold ring with its soft fill are presented");
            arena.PresentCollections(BuildPublicCollections(Array.Empty<WireProp>()));
            Assert.That(ActiveRendererCount(root), Is.Zero, "a complete empty collection replacement clears pooled cues");

            arena.PresentCollections(BuildPublicCollections(closed));
            Assert.That(ActiveRendererCount(root), Is.EqualTo(closedCount), "reused chest renderers reset to the closed presentation");
            Assert.That(FindAtX(root, WorldPointFromRaw(200, 200).x, ShowcaseSprites.Get("bar")), Is.Null,
                "open-only bars cannot linger when the dynamic prop pool is reused");
        }

        ClientArenaView CreateArena()
        {
            var arenaObject = new GameObject("prop cue test arena");
            _objects.Add(arenaObject);
            var arena = arenaObject.AddComponent<ClientArenaView>();
            arena.GetType().GetMethod("Awake", BindingFlags.Instance | BindingFlags.NonPublic).Invoke(arena, null);
            return arena;
        }

        static CollectionsView BuildPublicCollections(params WireProp[] rows)
        {
            return BuildPublicCollections(rows, null);
        }

        static CollectionsView BuildPublicCollections(WireProp[] rows, uint? focusedHandle)
        {
            var props = new PropsState { Rows = rows };
            if (focusedHandle.HasValue) props.Focus = new WireFocus { Handle = new PickupHandle(focusedHandle.Value) };
            var state = new ServerMsg.State { Tick = 7, Items = new StateItem[] { props } };
            var view = new CollectionsView();
            typeof(CollectionsView).GetMethod("Apply", BindingFlags.Instance | BindingFlags.NonPublic).Invoke(view, new object[] { state });
            return view;
        }

        static WireProp Ground(uint handle, ushort x, byte weapon)
        {
            return new WireProp { Handle = new PickupHandle(handle), X = x, Y = 200, Kind = PropKind.Ground, GroundWeapon = weapon };
        }

        static Vector3 WorldPointFromRaw(float x, float y)
        {
            return ClientArenaView.WorldPoint(x / 8f, y / 8f);
        }

        static List<Sprite> SpritesNear(Transform root, float x)
        {
            var result = new List<Sprite>();
            foreach (var renderer in root.GetComponentsInChildren<SpriteRenderer>(true))
                if (renderer.gameObject.activeSelf && Mathf.Abs(renderer.transform.position.x - x) < .6f)
                    result.Add(renderer.sprite);
            return result;
        }

        static SpriteRenderer FindAtX(Transform root, float x, Sprite sprite)
        {
            foreach (var renderer in root.GetComponentsInChildren<SpriteRenderer>(true))
                if (renderer.gameObject.activeSelf && Mathf.Abs(renderer.transform.position.x - x) < .6f && renderer.sprite == sprite)
                    return renderer;
            return null;
        }

        static int ActiveRendererCount(Transform root)
        {
            int count = 0;
            foreach (var renderer in root.GetComponentsInChildren<SpriteRenderer>(true))
                if (renderer.gameObject.activeSelf) count++;
            return count;
        }

        static Transform FindDirectChild(Transform parent, string name)
        {
            for (int i = 0; i < parent.childCount; i++)
                if (parent.GetChild(i).name == name) return parent.GetChild(i);
            return null;
        }
    }
}

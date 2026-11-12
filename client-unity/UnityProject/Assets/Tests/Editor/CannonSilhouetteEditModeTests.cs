using System;
using System.Collections.Generic;
using System.Reflection;
using NUnit.Framework;
using Roguehalla.Net;
using Roguehalla.Net.Protocol;
using UnityEngine;
using ClientArenaView = Roguehalla.Client.ArenaView;

namespace Roguehalla.Client.Tests
{
    /// <summary>
    /// P-UNITY-HUD-VISUAL-FIX-3, item 6: the travel cannon is a grey stone card with a small bar (shot 17). It must read as a cannon:
    /// a wide silhouette whose body is not one big card, a raised (tilted) barrel and two equal wheels at its foot, built from the
    /// shapes already in the project. ArenaPropCueEditModeTests still pins that stone, bar and ring appear in it and rune does not.
    /// </summary>
    public sealed class CannonSilhouetteEditModeTests
    {
        GameObject _arenaObject;

        [TearDown]
        public void TearDown() { if (_arenaObject != null) UnityEngine.Object.DestroyImmediate(_arenaObject); }

        static List<SpriteRenderer> CannonParts(Transform root, float x)
        {
            var parts = new List<SpriteRenderer>();
            foreach (var r in root.GetComponentsInChildren<SpriteRenderer>(true))
                if (r.gameObject.activeSelf && Mathf.Abs(r.transform.position.x - x) < .6f && r.sprite != ShowcaseSprites.Get("shadow")) parts.Add(r);
            return parts;
        }

        [Test]
        public void TheCannonIsAWideSilhouetteWithATiltedBarrelTwoWheelsAndNoCardBody()
        {
            _arenaObject = new GameObject("fix3 cannon arena");
            var arena = _arenaObject.AddComponent<ClientArenaView>();
            arena.GetType().GetMethod("Awake", BindingFlags.Instance | BindingFlags.NonPublic).Invoke(arena, null);
            var props = new PropsState { Rows = new[] { new WireProp { Handle = new PickupHandle(2), X = 400, Y = 200, Kind = PropKind.Cannon } } };
            var view = new CollectionsView();
            typeof(CollectionsView).GetMethod("Apply", BindingFlags.Instance | BindingFlags.NonPublic)
                .Invoke(view, new object[] { new ServerMsg.State { Tick = 7, Items = new StateItem[] { props } } });
            arena.PresentCollections(view);

            var root = _arenaObject.transform.Find("Observed collections");
            float x = ClientArenaView.WorldPoint(400 / 8f, 200 / 8f).x;
            var parts = CannonParts(root, x);
            var distinct = new HashSet<Sprite>(); foreach (var p in parts) distinct.Add(p.sprite);
            Assert.That(distinct.Count, Is.GreaterThanOrEqualTo(3), "at least three distinct shapes");

            Bounds all = parts[0].bounds; foreach (var p in parts) all.Encapsulate(p.bounds);
            Assert.That(all.size.x / all.size.y, Is.GreaterThanOrEqualTo(1.3f), "wider than tall: " + all.size);

            float card = 0f;
            foreach (var p in parts) if (p.sprite == ShowcaseSprites.Get("stone")) card += p.bounds.size.x * p.bounds.size.y;
            Assert.That(card / (all.size.x * all.size.y), Is.LessThan(.4f), "a stone card must not be the body (it reads as a grey card)");

            SpriteRenderer barrel = null;
            foreach (var p in parts)
                if (p.sprite == ShowcaseSprites.Get("bar") && Mathf.Abs(Mathf.DeltaAngle(0f, p.transform.eulerAngles.z)) >= 8f
                    && Mathf.Abs(Mathf.DeltaAngle(0f, p.transform.eulerAngles.z)) <= 60f && p.transform.lossyScale.x * p.sprite.bounds.size.x >= .5f)
                    barrel = p;
            Assert.That(barrel, Is.Not.Null, "a barrel: a bar at least half a tile long, raised 8 to 60 degrees");

            var wheels = new List<SpriteRenderer>();
            foreach (var p in parts) if (p.sprite == ShowcaseSprites.Get("ring")) wheels.Add(p);
            Assert.That(wheels.Count, Is.EqualTo(2), "two wheels");
            Assert.That(wheels[0].bounds.size.x, Is.EqualTo(wheels[1].bounds.size.x).Within(.01f), "equal wheels");
            Assert.That(wheels[0].bounds.size.x, Is.GreaterThanOrEqualTo(.24f), "wheels large enough to read");
            Assert.That(wheels[0].bounds.center.y, Is.EqualTo(wheels[1].bounds.center.y).Within(.01f), "wheels side by side");
            foreach (var p in parts)
                if (!wheels.Contains(p))
                    Assert.That(p.bounds.min.y, Is.GreaterThanOrEqualTo(wheels[0].bounds.min.y - .01f), "the wheels are at the foot");
        }
    }
}

using System.Collections.Generic;
using NUnit.Framework;
using UnityEngine;

namespace Roguehalla.Client.Tests
{
    public sealed class ShowcaseAnimationPreviewEditModeTests
    {
        const int FramesPerDirection = 3;
        readonly List<Sprite> _sprites = new List<Sprite>();
        Texture2D _texture;

        [SetUp]
        public void SetUp()
        {
            _texture = new Texture2D(ShowcaseAnimationPreview.ActionCount * ShowcaseAnimationPreview.DirectionCount * FramesPerDirection, 1);
            for (int i = 0; i < _texture.width; i++)
                _sprites.Add(Sprite.Create(_texture, new Rect(i, 0, 1, 1), new Vector2(.5f, .5f), 1));
        }

        [TearDown]
        public void TearDown()
        {
            foreach (var sprite in _sprites)
                if (sprite != null) Object.DestroyImmediate(sprite);
            _sprites.Clear();
            if (_texture != null) Object.DestroyImmediate(_texture);
        }

        [Test]
        public void EveryActionUsesItsOwnFramesAndAuthoredRate()
        {
            var appearance = CreateAppearance();
            for (int action = 0; action < ShowcaseAnimationPreview.ActionCount; action++)
            {
                var selectedAction = (ShowcasePreviewAction)action;
                Assert.That(ShowcaseAnimationPreview.TryFrame(appearance, selectedAction, 0, .3f, false, out var frame),
                    Is.True, selectedAction.ToString());
                float rate = GetRate(appearance, selectedAction);
                int localFrame = Mathf.FloorToInt(.3f * rate);
                localFrame = selectedAction == ShowcasePreviewAction.Death
                    ? Mathf.Min(FramesPerDirection - 1, localFrame)
                    : localFrame % FramesPerDirection;
                Assert.That(frame, Is.SameAs(ActionFrames(action)[localFrame]), selectedAction + " uses its authored clip and FPS");
            }
        }

        [Test]
        public void DirectionMajorFramesCoverEightDirectionsAndNormalizeWraparound()
        {
            var appearance = CreateAppearance();
            var frames = appearance.Idle;
            for (int direction = 0; direction < ShowcaseAnimationPreview.DirectionCount; direction++)
            {
                Assert.That(ShowcaseAnimationPreview.DirectionName(direction),
                    Is.EqualTo(new[] { "SW", "W", "NW", "N", "NE", "E", "SE", "S" }[direction]));
                Assert.That(ShowcaseAnimationPreview.TryFrame(appearance, ShowcasePreviewAction.Idle, direction, 0, false, out var frame), Is.True);
                Assert.That(frame, Is.SameAs(frames[direction * FramesPerDirection]));
            }

            Assert.That(ShowcaseAnimationPreview.DirectionName(8), Is.EqualTo("SW"));
            Assert.That(ShowcaseAnimationPreview.DirectionName(-1), Is.EqualTo("S"));
            Assert.That(ShowcaseAnimationPreview.TryFrame(appearance, ShowcasePreviewAction.Idle, 8, 0, false, out var wrapped), Is.True);
            Assert.That(wrapped, Is.SameAs(frames[0]));
            Assert.That(ShowcaseAnimationPreview.TryFrame(appearance, ShowcasePreviewAction.Idle, -1, 0, false, out var negative), Is.True);
            Assert.That(negative, Is.SameAs(frames[7 * FramesPerDirection]));
        }

        [Test]
        public void LoopsDeathAndReducedMotionSelectExpectedFrames()
        {
            var appearance = CreateAppearance();
            appearance.IdleFPS = 2f;
            appearance.DeathFPS = 2f;
            var idle = appearance.Idle;
            var death = appearance.Death;

            Assert.That(ShowcaseAnimationPreview.TryFrame(appearance, ShowcasePreviewAction.Idle, 2, 2f, false, out var looped), Is.True);
            Assert.That(looped, Is.SameAs(idle[2 * FramesPerDirection + 1]), "four elapsed frames wrap to local frame one");
            Assert.That(ShowcaseAnimationPreview.TryFrame(appearance, ShowcasePreviewAction.Death, 2, 20f, false, out var held), Is.True);
            Assert.That(held, Is.SameAs(death[2 * FramesPerDirection + FramesPerDirection - 1]));
            Assert.That(ShowcaseAnimationPreview.TryFrame(appearance, ShowcasePreviewAction.Idle, 2, 20f, true, out var reducedLoop), Is.True);
            Assert.That(reducedLoop, Is.SameAs(idle[2 * FramesPerDirection]));
            Assert.That(ShowcaseAnimationPreview.TryFrame(appearance, ShowcasePreviewAction.Death, 2, 0, true, out var reducedDeath), Is.True);
            Assert.That(reducedDeath, Is.SameAs(death[2 * FramesPerDirection + FramesPerDirection - 1]));
        }

        [Test]
        public void MissingMalformedAndNullSelectedFramesClearTheOutput()
        {
            var appearance = CreateAppearance();
            Assert.That(ShowcaseAnimationPreview.TryFrame(appearance, ShowcasePreviewAction.Idle, 0, 0, false, out var frame), Is.True);
            Assert.That(frame, Is.Not.Null);
            Assert.That(ShowcaseAnimationPreview.TryFrame(null, ShowcasePreviewAction.Idle, 0, 0, false, out frame), Is.False);
            Assert.That(frame, Is.Null);
            appearance.Idle = null;
            AssertMissing(appearance, ref frame);
            appearance.Idle = new Sprite[0];
            AssertMissing(appearance, ref frame);
            appearance.Idle = new Sprite[ShowcaseAnimationPreview.DirectionCount - 1];
            for (int i = 0; i < appearance.Idle.Length; i++) appearance.Idle[i] = _sprites[i];
            AssertMissing(appearance, ref frame);
            appearance.Idle = new Sprite[ShowcaseAnimationPreview.DirectionCount + 1];
            for (int i = 0; i < appearance.Idle.Length; i++) appearance.Idle[i] = _sprites[i];
            AssertMissing(appearance, ref frame);
            appearance.Idle = new Sprite[ShowcaseAnimationPreview.DirectionCount];
            AssertMissing(appearance, ref frame);
            frame = _sprites[0];
            Assert.That(ShowcaseAnimationPreview.TryFrame(appearance, (ShowcasePreviewAction)99, 0, 0, false, out frame), Is.False);
            Assert.That(frame, Is.Null);
        }

        [Test]
        public void InvalidClipRateFallsBackToAppearanceRateThenTen()
        {
            var appearance = CreateAppearance();
            appearance.Idle = ActionFrames(0);
            appearance.IdleFPS = float.NaN;
            appearance.FramesPerSecond = 2f;
            Assert.That(ShowcaseAnimationPreview.TryFrame(appearance, ShowcasePreviewAction.Idle, 0, .6f, false, out var appearanceRate), Is.True);
            Assert.That(appearanceRate, Is.SameAs(appearance.Idle[1]));

            appearance.IdleFPS = float.PositiveInfinity;
            appearance.FramesPerSecond = 0f;
            Assert.That(ShowcaseAnimationPreview.TryFrame(appearance, ShowcasePreviewAction.Idle, 0, .2f, false, out var guardRate), Is.True);
            Assert.That(guardRate, Is.SameAs(appearance.Idle[2]));

            appearance.IdleFPS = 0f;
            Assert.That(ShowcaseAnimationPreview.TryFrame(appearance, ShowcasePreviewAction.Idle, 0, -1f, false, out var safeElapsed), Is.True);
            Assert.That(safeElapsed, Is.SameAs(appearance.Idle[0]));
            Assert.That(ShowcaseAnimationPreview.TryFrame(appearance, ShowcasePreviewAction.Idle, 0, float.NaN, false, out var nanElapsed), Is.True);
            Assert.That(nanElapsed, Is.SameAs(appearance.Idle[0]));
            Assert.That(ShowcaseAnimationPreview.TryFrame(appearance, ShowcasePreviewAction.Idle, 0, float.PositiveInfinity, false, out var infiniteElapsed), Is.True);
            Assert.That(infiniteElapsed, Is.SameAs(appearance.Idle[0]));
        }

        void AssertMissing(ShowcaseCatalog.Appearance appearance, ref Sprite frame)
        {
            frame = _sprites[0];
            Assert.That(frame, Is.Not.Null, "the previous successful selection remains in the caller before this attempt");
            Assert.That(ShowcaseAnimationPreview.TryFrame(appearance, ShowcasePreviewAction.Idle, 0, 0, false, out frame), Is.False);
            Assert.That(frame, Is.Null);
        }

        ShowcaseCatalog.Appearance CreateAppearance()
        {
            var appearance = new ShowcaseCatalog.Appearance { FramesPerSecond = 5f };
            for (int action = 0; action < ShowcaseAnimationPreview.ActionCount; action++)
            {
                var frames = ActionFrames(action);
                float rate = 2f + action * 4f;
                switch ((ShowcasePreviewAction)action)
                {
                    case ShowcasePreviewAction.Idle: appearance.Idle = frames; appearance.IdleFPS = rate; break;
                    case ShowcasePreviewAction.Walk: appearance.Walk = frames; appearance.WalkFPS = rate; break;
                    case ShowcasePreviewAction.Attack: appearance.Attack = frames; appearance.AttackFPS = rate; break;
                    case ShowcasePreviewAction.Block: appearance.Block = frames; appearance.BlockFPS = rate; break;
                    case ShowcasePreviewAction.Hit: appearance.Hit = frames; appearance.HitFPS = rate; break;
                    case ShowcasePreviewAction.Death: appearance.Death = frames; appearance.DeathFPS = rate; break;
                    case ShowcasePreviewAction.Cast: appearance.Cast = frames; appearance.CastFPS = rate; break;
                    case ShowcasePreviewAction.Shoot: appearance.Shoot = frames; appearance.ShootFPS = rate; break;
                }
            }
            return appearance;
        }

        Sprite[] ActionFrames(int action)
        {
            int start = action * ShowcaseAnimationPreview.DirectionCount * FramesPerDirection;
            var frames = new Sprite[ShowcaseAnimationPreview.DirectionCount * FramesPerDirection];
            for (int i = 0; i < frames.Length; i++) frames[i] = _sprites[start + i];
            return frames;
        }

        static float GetRate(ShowcaseCatalog.Appearance appearance, ShowcasePreviewAction action)
        {
            switch (action)
            {
                case ShowcasePreviewAction.Idle: return appearance.IdleFPS;
                case ShowcasePreviewAction.Walk: return appearance.WalkFPS;
                case ShowcasePreviewAction.Attack: return appearance.AttackFPS;
                case ShowcasePreviewAction.Block: return appearance.BlockFPS;
                case ShowcasePreviewAction.Hit: return appearance.HitFPS;
                case ShowcasePreviewAction.Death: return appearance.DeathFPS;
                case ShowcasePreviewAction.Cast: return appearance.CastFPS;
                default: return appearance.ShootFPS;
            }
        }
    }
}

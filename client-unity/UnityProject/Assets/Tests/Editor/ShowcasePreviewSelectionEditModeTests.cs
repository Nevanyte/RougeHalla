using System.Reflection;
using NUnit.Framework;
using UnityEngine;

namespace Roguehalla.Client.Tests
{
    public sealed class ShowcasePreviewSelectionEditModeTests
    {
        const int FramesPerDirection = 2;
        GameObject _root;
        ShowcaseCatalog _catalog;
        Texture2D _texture;
        Sprite[] _firstFrames, _firstWalkFrames, _secondFrames;

        [SetUp]
        public void SetUp()
        {
            _root = new GameObject("staged animation preview test");
            _catalog = ScriptableObject.CreateInstance<ShowcaseCatalog>();
            _texture = new Texture2D(48, 1);
            _firstFrames = CreateFrames(0);
            _firstWalkFrames = CreateFrames(16);
            _secondFrames = CreateFrames(32);
            _catalog.Actors = new[]
            {
                new ShowcaseCatalog.Appearance { Key = "first", Idle = _firstFrames, Walk = _firstWalkFrames, WorldHeight = 1.1f },
                new ShowcaseCatalog.Appearance { Key = "second", Idle = _secondFrames, WorldHeight = 1.4f }
            };

            ShowcaseSprites.Initialize();
            var preview = _root.AddComponent<ShowcasePreview>();
            SetField(preview, "_catalog", _catalog);
            Invoke(preview, "SelectDefaultAppearance");
            Invoke(preview, "CreateAnimationPodium");
        }

        [TearDown]
        public void TearDown()
        {
            if (_root != null) Object.DestroyImmediate(_root);
            if (_catalog != null) Object.DestroyImmediate(_catalog);
            DestroyFrames(_firstFrames);
            DestroyFrames(_firstWalkFrames);
            DestroyFrames(_secondFrames);
            if (_texture != null) Object.DestroyImmediate(_texture);
        }

        [Test]
        public void ActualPodiumClearsMissingClipAndRecoversWhenSelectionBecomesValid()
        {
            var preview = _root.GetComponent<ShowcasePreview>();
            Invoke(preview, "UpdateAnimationPreview", true);
            var renderer = (SpriteRenderer)GetField(preview, "_previewRenderer");
            Assert.That(renderer.enabled, Is.True);
            Assert.That(renderer.sprite, Is.SameAs(_firstFrames[10]), "the default source direction is east");

            _catalog.Actors[0].Idle = null;
            Invoke(preview, "UpdateAnimationPreview", true);
            Assert.That(renderer.enabled, Is.False);
            Assert.That(renderer.sprite, Is.Null);

            _catalog.Actors[0].Idle = _firstFrames;
            Invoke(preview, "UpdateAnimationPreview", true);
            Assert.That(renderer.enabled, Is.True);
            Assert.That(renderer.sprite, Is.SameAs(_firstFrames[10]));
        }

        [Test]
        public void DirectionPreservesElapsedTimeWhileActionAndAppearanceChangesResetIt()
        {
            var preview = _root.GetComponent<ShowcasePreview>();
            Invoke(preview, "UpdateAnimationPreview", false); // consume the initial-selection pause
            SetField(preview, "_previewElapsed", 4f);
            Invoke(preview, "ChangeDirection", 1);
            float elapsedDelta = Time.unscaledDeltaTime;
            Invoke(preview, "UpdateAnimationPreview", false);
            float expectedElapsed = 4f + elapsedDelta;
            Assert.That((float)GetField(preview, "_previewElapsed"), Is.EqualTo(expectedElapsed).Within(.0001f));
            Assert.That(ShowcaseAnimationPreview.TryFrame(_catalog.Actors[0], ShowcasePreviewAction.Idle,
                6, expectedElapsed, false, out var expectedDirectionFrame), Is.True);
            var renderer = (SpriteRenderer)GetField(preview, "_previewRenderer");
            Assert.That(renderer.sprite, Is.SameAs(expectedDirectionFrame), "direction changes preserve the current clip phase");

            SetField(preview, "_previewElapsed", 4f);
            Invoke(preview, "ChangeAction", 1);
            Invoke(preview, "UpdateAnimationPreview", false);
            Assert.That((float)GetField(preview, "_previewElapsed"), Is.Zero);
            Assert.That((ShowcasePreviewAction)GetField(preview, "_previewAction"), Is.EqualTo(ShowcasePreviewAction.Walk));
            Assert.That(renderer.sprite, Is.SameAs(_firstWalkFrames[6 * FramesPerDirection]),
                "action selection renders its first directional frame immediately");

            SetField(preview, "_previewElapsed", 4f);
            Invoke(preview, "ChangeDirection", -1);
            Invoke(preview, "UpdateAnimationPreview", false);
            Assert.That((float)GetField(preview, "_previewElapsed"), Is.EqualTo(4f + elapsedDelta).Within(.0001f));
            Invoke(preview, "ChangeAction", -1);
            SetField(preview, "_previewElapsed", 4f);
            Invoke(preview, "AdvanceAppearance", 1);
            Invoke(preview, "UpdateAnimationPreview", false);
            Assert.That((float)GetField(preview, "_previewElapsed"), Is.Zero);
            Assert.That(renderer.sprite, Is.SameAs(_secondFrames[5 * FramesPerDirection]),
                "appearance selection renders its first directional frame immediately");
        }

        Sprite[] CreateFrames(int start)
        {
            var frames = new Sprite[ShowcaseAnimationPreview.DirectionCount * FramesPerDirection];
            for (int i = 0; i < frames.Length; i++)
                frames[i] = Sprite.Create(_texture, new Rect(start + i, 0, 1, 1), new Vector2(.5f, 0), 1);
            return frames;
        }

        static void DestroyFrames(Sprite[] frames)
        {
            if (frames == null) return;
            foreach (var frame in frames)
                if (frame != null) Object.DestroyImmediate(frame);
        }

        static object GetField(object target, string name)
        {
            return target.GetType().GetField(name, BindingFlags.Instance | BindingFlags.NonPublic).GetValue(target);
        }

        static void SetField(object target, string name, object value)
        {
            target.GetType().GetField(name, BindingFlags.Instance | BindingFlags.NonPublic).SetValue(target, value);
        }

        static object Invoke(object target, string name, params object[] args)
        {
            var method = target.GetType().GetMethod(name, BindingFlags.Instance | BindingFlags.NonPublic);
            return method.Invoke(target, args);
        }
    }
}

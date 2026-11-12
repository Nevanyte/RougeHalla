using System.Collections.Generic;
using NUnit.Framework;
using Roguehalla.Net;
using Roguehalla.Net.Protocol;
using UnityEngine;

namespace Roguehalla.Client.Tests
{
    /// <summary>P-UNITY-NAME-GROUP-1 review note: the mob under the cursor always shows its own name, even when its pack hid it.</summary>
    public sealed class NamePackHoverEditModeTests
    {
        GameObject _arena; SpriteActorPresenter _presenter; UiTheme _savedTheme;

        [SetUp]
        public void SetUp()
        {
            _savedTheme = UiTheme.Current; UiTheme.Current = UiTheme.Placeholder();
            ShowcaseSprites.Initialize();
            _arena = new GameObject("name pack hover arena");
            _presenter = new SpriteActorPresenter(_arena.transform, null);
            _presenter.Delivered = new HashSet<uint>();
        }

        [TearDown]
        public void TearDown()
        {
            if (_arena != null) Object.DestroyImmediate(_arena);
            UiTheme.Current = _savedTheme;
        }

        void Frame(uint hoveredId)
        {
            _presenter.Begin();
            var xs = new[] { 640f, 740f, 840f, 940f };
            for (uint id = 1; id <= 4; id++)
            {
                _presenter.Present(id, xs[id - 1], id % 2 == 0 ? 700f : 640f, 0, 100, null, ActorStatus.Alive, null, ActorKind.RegionalMob, MobTypeId.MagmaBrute, 0, 0, false, 0, 0, "grunt");
                _presenter.PresentIndicators(id, 0, false, WeaponId.Fists, false, -1, id == hoveredId);
            }
            _presenter.End();
        }

    }
}

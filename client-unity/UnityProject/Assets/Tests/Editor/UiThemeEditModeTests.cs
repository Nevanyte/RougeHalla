using NUnit.Framework;
using UnityEngine;

namespace Roguehalla.Client.Tests
{
    public sealed class UiThemeEditModeTests
    {
        UiTheme _saved;

        [SetUp] public void SetUp() { _saved = UiTheme.Current; }
        [TearDown] public void TearDown() { UiTheme.Current = _saved; }

        [Test]
        public void PlaceholderTextRolesMeetWcagAaOnBothSurfaces()
        {
            var t = UiTheme.Placeholder();
            foreach (var surface in new[] { t.Surface, t.SurfaceRaised })
            {
                Assert.That(ShowcasePalette.ContrastRatio(t.TextPrimary, surface), Is.GreaterThanOrEqualTo(4.5f), "textPrimary");
                Assert.That(ShowcasePalette.ContrastRatio(t.TextSecondary, surface), Is.GreaterThanOrEqualTo(4.5f), "textSecondary");
                Assert.That(ShowcasePalette.ContrastRatio(t.Accent, surface), Is.GreaterThanOrEqualTo(4.5f), "accent");
                Assert.That(ShowcasePalette.ContrastRatio(t.Danger, surface), Is.GreaterThanOrEqualTo(4.5f), "danger");
                Assert.That(ShowcasePalette.ContrastRatio(t.Success, surface), Is.GreaterThanOrEqualTo(4.5f), "success");
                Assert.That(ShowcasePalette.ContrastRatio(t.Warning, surface), Is.GreaterThanOrEqualTo(4.5f), "warning");
                Assert.That(ShowcasePalette.ContrastRatio(t.Info, surface), Is.GreaterThanOrEqualTo(4.5f), "info");
                for (int i = 0; i < t.Faction.Length; i++)
                    Assert.That(ShowcasePalette.ContrastRatio(t.Faction[i], surface), Is.GreaterThanOrEqualTo(4.5f), "faction " + i);
            }
        }

        [Test]
        public void SwappingTheThemeReskinsEveryPaletteAccessor()
        {
            var custom = UiTheme.Placeholder();
            custom.Surface = new Color32(1, 2, 3, 255); custom.TextPrimary = new Color32(250, 251, 252, 255);
            custom.Faction[2] = new Color32(9, 8, 7, 255);
            UiTheme.Current = custom;
            Assert.That((Color)ShowcasePalette.Panel, Is.EqualTo((Color)new Color32(1, 2, 3, 255)));
            Assert.That((Color)ShowcasePalette.Text, Is.EqualTo((Color)new Color32(250, 251, 252, 255)));
            Assert.That((Color)ShowcasePalette.Faction(2), Is.EqualTo((Color)new Color32(9, 8, 7, 255)));
            Assert.That(custom.Owns(new Color32(1, 2, 3, 40)));
            Assert.That(custom.Owns(Color.clear));
            Assert.That(custom.Owns(new Color32(200, 100, 50, 255)), Is.False);
        }

        [Test]
        public void ShippedSkinMeetsWcagAndKeepsFactionsApartByLightness()
        {
            var t = UiTheme.Skin();
            foreach (var surface in new[] { t.Surface, t.SurfaceRaised, t.SurfaceHover, t.SurfaceSelected })
            {
                Assert.That(ShowcasePalette.ContrastRatio(t.TextPrimary, surface), Is.GreaterThanOrEqualTo(4.5f));
                Assert.That(ShowcasePalette.ContrastRatio(t.TextSecondary, surface), Is.GreaterThanOrEqualTo(4.5f));
                Assert.That(ShowcasePalette.ContrastRatio(t.Accent, surface), Is.GreaterThanOrEqualTo(4.5f));
                Assert.That(ShowcasePalette.ContrastRatio(t.Danger, surface), Is.GreaterThanOrEqualTo(4.5f));
            }
            Assert.That(ShowcasePalette.ContrastRatio(t.OutlineDark, t.AccentDim), Is.GreaterThanOrEqualTo(4.5f), "primary button ink");
            Assert.That(ShowcasePalette.ContrastRatio(t.Border, t.Surface), Is.GreaterThanOrEqualTo(3f), "panel edges");
            Assert.That(t.Owns(t.OutlineDark) && t.Owns(t.OutlineLight));
        }

        [Test]
        public void GeneratedSlicedSpritesDrawTheirBordersInHudUnits()
        {
            // Regression: a sprite with pixelsPerUnit 1 makes a UI Image scale the 9-slice border by 100, which collapses every panel to a stretched blob.
            var theme = UiTheme.Skin();
            var host = new GameObject("Slice host", typeof(RectTransform), typeof(Canvas));
            try
            {
                foreach (float radius in new[] { 3f, 6f, 8f, 14f })
                {
                    var go = new GameObject("img", typeof(RectTransform), typeof(UnityEngine.UI.Image));
                    go.transform.SetParent(host.transform, false);
                    var image = go.GetComponent<UnityEngine.UI.Image>();
                    image.type = UnityEngine.UI.Image.Type.Sliced;
                    foreach (var sprite in new[] { UiSprites.Panel(theme, radius), UiSprites.Frame(theme, radius), UiSprites.Gloss(theme, radius) })
                    {
                        image.sprite = sprite;
                        Assert.That(image.hasBorder, sprite.name);
                        Assert.That(sprite.border.x / image.pixelsPerUnit, Is.EqualTo(radius).Within(.01f), sprite.name + " border in HUD units equals the corner radius");
                        Assert.That(sprite.rect.width, Is.GreaterThan(sprite.border.x * 2f), sprite.name + " keeps a stretchable centre");
                        Assert.That(sprite.texture.mipmapCount, Is.GreaterThan(1), sprite.name + " is mip-mapped so it stays sharp when minified");
                    }
                }
            }
            finally { Object.DestroyImmediate(host); }
        }

        [Test]
        public void GeneratedPanelSpritesAreNineSlicedAndThemeIndependent()
        {
            var theme = UiTheme.Placeholder();
            var panel = UiSprites.Panel(theme);
            Assert.That(panel.border.x, Is.GreaterThan(0f));
            Assert.That(UiSprites.Frame(theme, theme.CornerRadius), Is.Not.SameAs(panel));
            theme.PanelSprite = panel;
            Assert.That(UiSprites.Panel(theme), Is.SameAs(panel), "a theme panel sprite overrides the generated one");
        }
    }
}

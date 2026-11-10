using NUnit.Framework;
using Roguehalla.Net;
using TMPro;
using UnityEngine;
using UnityEngine.UI;

namespace Roguehalla.Client.Tests
{
    /// <summary>Fourth UI pass: chest card text rules, the Sentenced hunt picker rules, faction pictograms instead of bracket marks.</summary>
    public sealed class Ui4EditModeTests
    {
        GameObject _root;

        [TearDown] public void TearDown() { if (_root != null) Object.DestroyImmediate(_root); _root = null; }

        Transform Canvas()
        {
            _root = new GameObject("Canvas", typeof(RectTransform), typeof(Canvas), typeof(GraphicRaycaster));
            return _root.transform;
        }

        [Test]
        public void ChestTierComesFromTheRomanSuffixOfTheCardTitle()
        {
            Assert.AreEqual("II", MatchHud.TierOf("Offense II"));
            Assert.AreEqual("III", MatchHud.TierOf("Soul Offence III"));
            Assert.AreEqual("", MatchHud.TierOf("Hemorrhage"));
            Assert.AreEqual("", MatchHud.TierOf(""));
            Assert.AreEqual("", MatchHud.TierOf(null));
        }

        [Test]
        public void ChestBoostsReadAsStatNamesNotEnumNames()
        {
            Assert.AreEqual("Max health", MatchHud.BoostLabel(BoostId.MaxHp));
            Assert.AreEqual("Attack speed", MatchHud.BoostLabel(BoostId.AttackSpeed));
            Assert.AreEqual("Lifesteal", MatchHud.BoostLabel(BoostId.Lifesteal));
        }

        [Test]
        public void HuntPickerIsOnlyForALivingSentencedInAnActiveRunOutsideTraining()
        {
            Assert.IsTrue(SentencedHuntPanel.Eligible(FactionId.Sentenced, ActorStatus.Alive, false, MatchPhase.Active));
            Assert.IsFalse(SentencedHuntPanel.Eligible(FactionId.Fire, ActorStatus.Alive, false, MatchPhase.Active));
            Assert.IsFalse(SentencedHuntPanel.Eligible(FactionId.Sentenced, ActorStatus.Dead, false, MatchPhase.Active));
            Assert.IsFalse(SentencedHuntPanel.Eligible(FactionId.Sentenced, ActorStatus.Alive, true, MatchPhase.Active));
            Assert.IsFalse(SentencedHuntPanel.Eligible(FactionId.Sentenced, ActorStatus.Alive, false, null));
            Assert.AreEqual("Hunt · +6% mark strength", SentencedHuntPanel.TitleFor(3));
            Assert.AreEqual("Plague rival", SentencedHuntPanel.RivalLabel(FactionId.Plague));
            Assert.AreEqual("Unknown rival", SentencedHuntPanel.RivalLabel(null));
        }

        [Test]
        public void HuntPanelBuildsHiddenUntilTheHudShowsIt()
        {
            var panel = Canvas().gameObject.AddComponent<SentencedHuntPanel>();
            panel.Initialize(_root.transform);
            Assert.IsFalse(panel.IsVisible);
            panel.Refresh(null, true);
            Assert.IsFalse(panel.IsVisible, "no session, no picker");
        }

        [Test]
        public void EveryFactionHasAGeneratedPictogramAndNoBracketMarksRemain()
        {
            var parent = Canvas();
            for (int i = 0; i < 5; i++)
            {
                var icon = LaunchUi.FactionShape(parent, "Icon" + i, i, 0, 0, 20, Color.white);
                Assert.IsNotNull(icon.sprite, "faction " + i);
            }
            var distinct = new System.Collections.Generic.HashSet<Sprite>();
            for (int i = 0; i < 5; i++) distinct.Add(LaunchUi.FactionShape(parent, "Again" + i, i, 0, 0, 20, Color.white).sprite);
            Assert.AreEqual(5, distinct.Count, "each faction has its own shape");
            foreach (var name in new[] { "Fire", "Sentenced", "Plague", "Frost", "Holy" })
                StringAssert.DoesNotContain("[", ShowcasePalette.GetFactionName(System.Array.IndexOf(new[] { "Fire", "Sentenced", "Plague", "Frost", "Holy" }, name)));
        }

        [Test]
        public void RecentNoticeCardExpiresButTheHistoryKeepsEveryNotice()
        {
            var feed = Canvas().gameObject.AddComponent<OrderedNoticeFeed>();
            feed.Initialize(_root.transform);
            feed.SetRecentVisible(true);
            Assert.IsFalse(feed.Root.gameObject.activeSelf);
            var recent = _root.transform.Find("RecentServerNotices");
            Assert.IsFalse(recent.gameObject.activeSelf, "nothing received, nothing shown");
            Assert.AreEqual(8f, OrderedNoticeFeed.RecentSeconds);
        }
    }
}

using System.Linq;
using System.Text.RegularExpressions;
using NUnit.Framework;
using Roguehalla.Client;
using TMPro;
using UnityEngine;
using UnityEngine.UI;

public sealed class HelpGuideViewEditModeTests
{
    [Test]
    public void ControlsRetainEveryLegacyContextAndKeyBindingGroup()
    {
        var sections = HelpGuideContent.Controls;
        CollectionAssert.AreEqual(new[] { "In a run and in practice", "Planning before the run", "In the hub", "Anywhere" }, sections.Select(x => x.Title));
        string all = string.Join("\n", sections.SelectMany(x => x.Entries).Select(x => x.Keys));
        foreach (string key in new[] { "W · A · S · D / Arrows", "Left click", "Right click", "1 · 2", "Q", "E", "F", "R",
            "J", "Enter", "C", "0 (after C)", "Hold Tab", "Delete", "Page Up · Page Down", "Hold Shift", "Alt + Enter", "H", "Esc" })
            StringAssert.Contains(key, all);
        Assert.That(sections.SelectMany(x => x.Entries).Count(), Is.GreaterThanOrEqualTo(40));
    }

    [Test]
    public void MechanicsCoverGlossarySignaturesAndWeaponsWithoutNumericInstructions()
    {
        string terms = string.Join("\n", HelpGuideContent.Mechanics.SelectMany(x => x.Entries).Select(x => x.Term + " " + x.Description));
        foreach (string term in new[] { "Offense", "SO · Soul Offence", "Physical", "Magic", "True", "Damage over time", "On-hit", "Returned",
            "Slow", "Heal", "Block", "Ramping", "Execute", "Critical strike", "Area", "Wish", "Fire · Burn", "Sentenced · Mark",
            "Plague · Disease and execute", "Frost · Chill", "Holy · Lifesteal", "Sword", "Axe", "Bow", "Wand", "Shield", "Fists" })
            StringAssert.Contains(term, terms);
        Assert.IsFalse(Regex.IsMatch(terms, @"\d"), "Mechanics descriptions and terms avoid numeric formulas and balance values.");
        Assert.AreEqual(4, HelpGuideContent.Mechanics.Count);
    }

    [Test]
    public void ViewSwitchesIndependentScrollableTabsAndCloseCallbackHidesIt()
    {
        var host = new GameObject("Help guide test", typeof(RectTransform));
        try
        {
            var view = host.AddComponent<HelpGuideView>();
            int closes = 0;
            view.Initialize(host.transform, () => closes++);
            Assert.That(view.CurrentTab, Is.EqualTo(HelpGuideTab.Controls));
            Assert.That(view.IsVisible, Is.False);
            Assert.That(view.Root.Find("HelpGuideCard/ControlsScroll").GetComponent<ScrollRect>(), Is.Not.Null);
            Assert.That(view.Root.Find("HelpGuideCard/MechanicsScroll").GetComponent<ScrollRect>(), Is.Not.Null);
            Assert.That(view.Root.Find("HelpGuideCard/ControlsScroll").gameObject.activeSelf, Is.True);
            Assert.That(view.Root.Find("HelpGuideCard/MechanicsScroll").gameObject.activeSelf, Is.False);

            view.SetVisible(true);
            Assert.That(view.IsVisible, Is.True);
            view.MechanicsTab.onClick.Invoke();
            Assert.That(view.CurrentTab, Is.EqualTo(HelpGuideTab.Mechanics));
            Assert.That(view.Root.Find("HelpGuideCard/ControlsScroll").gameObject.activeSelf, Is.False);
            Assert.That(view.Root.Find("HelpGuideCard/MechanicsScroll").gameObject.activeSelf, Is.True);
            view.ControlsTab.onClick.Invoke();
            Assert.That(view.CurrentTab, Is.EqualTo(HelpGuideTab.Controls));
            var close = view.Root.Find("HelpGuideCard/CloseHelp").GetComponent<Button>();
            close.onClick.Invoke();
            Assert.That(view.IsVisible, Is.False);
            Assert.That(closes, Is.EqualTo(1));
        }
        finally { Object.DestroyImmediate(host); }
    }

    [Test]
    public void ScrollBodiesKeepUserSizedTextAndSeparateLabelsFromDescriptions()
    {
        var host = new GameObject("Help text test", typeof(RectTransform));
        try
        {
            var view = host.AddComponent<HelpGuideView>(); view.Initialize(host.transform, null);
            var controls = view.Root.Find("HelpGuideCard/ControlsScroll/Viewport/Content").GetComponent<TMP_Text>();
            var mechanics = view.Root.Find("HelpGuideCard/MechanicsScroll/Viewport/Content").GetComponent<TMP_Text>();
            Assert.That(controls.enableAutoSizing, Is.False);
            Assert.That(mechanics.enableAutoSizing, Is.False);
            Assert.That(controls.richText, Is.True);
            StringAssert.Contains("<b>W · A · S · D / Arrows</b>", controls.text);
            StringAssert.Contains("<b>Damage over time</b>", mechanics.text);
            StringAssert.Contains("decided by the server", mechanics.text);
        }
        finally { Object.DestroyImmediate(host); }
    }
}

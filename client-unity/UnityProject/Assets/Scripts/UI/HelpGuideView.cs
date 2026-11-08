using System;
using System.Collections.Generic;
using System.Text;
using TMPro;
using UnityEngine;
using UnityEngine.EventSystems;
using UnityEngine.UI;

namespace Roguehalla.Client
{
    public enum HelpGuideTab { Controls, Mechanics }

    public sealed class HelpGuideEntry
    {
        public string Keys { get; }
        public string Description { get; }
        public HelpGuideEntry(string keys, string description) { Keys = keys; Description = description; }
    }

    public sealed class HelpGuideSection
    {
        public string Title { get; }
        public IReadOnlyList<HelpGuideEntry> Entries { get; }
        public HelpGuideSection(string title, IEnumerable<HelpGuideEntry> entries)
        { Title = title; Entries = new List<HelpGuideEntry>(entries).AsReadOnly(); }
    }

    public sealed class HelpMechanicEntry
    {
        public string Term { get; }
        public string Description { get; }
        public HelpMechanicEntry(string term, string description) { Term = term; Description = description; }
    }

    public sealed class HelpMechanicSection
    {
        public string Title { get; }
        public IReadOnlyList<HelpMechanicEntry> Entries { get; }
        public HelpMechanicSection(string title, IEnumerable<HelpMechanicEntry> entries)
        { Title = title; Entries = new List<HelpMechanicEntry>(entries).AsReadOnly(); }
    }

    /// <summary>Display copy adapted from the legacy help overlay and shared glossary; no executable game rules.</summary>
    public static class HelpGuideContent
    {
        static readonly IReadOnlyList<HelpGuideSection> ControlsData = Array.AsReadOnly(new[]
        {
            new HelpGuideSection("In a run and in practice", new[]
            {
                E("W · A · S · D / Arrows", "Move."),
                E("Left click", "Attack toward the cursor; hold to repeat. The wand can lock onto an enemy."),
                E("Melee", "Swing while moving without an attack windup."),
                E("Range guide", "Soft outlines show your equipped weapon’s reach."),
                E("Right click", "Move to a point on the ground; hold to keep steering."),
                E("1 · 2", "Select a weapon slot."),
                E("Q", "Swap weapons."),
                E("E", "Drink a potion. Small potions restore less health."),
                E("Wind emblem", "Walk over it to gain extra speed temporarily."),
                E("Plague body", "Walk over a body to raise, grow, or revive your zombie."),
                E("F", "Pick up a nearby weapon or speak to a giver."),
                E("R", "Cast your faction’s Wish. Cooldowns vary by faction."),
                E("J", "Show or hide the quest log."),
                E("Enter", "Accept the quest offer opened with F."),
                E("C", "Give the chest panel keyboard focus, or give focus back."),
                E("1 · 2 · 3 (after C)", "Choose a chest card."),
                E("0 (after C)", "Skip the chest."),
                E("Hold Tab", "Open the tactical map, weapon guide, quests, ranked roster, and personal route."),
                E("Minimap · right click", "Move to the selected point."),
                E("Minimap · hold left click", "Peek at a point; release to return the camera."),
                E("Minimap marks", "Coral marks enemy players; dots and counts mark mobs; bright marks indicate vision."),
                E("Map clocks", "Gold marks chest time; blue marks the respawn countdown after loot."),
                E("Edge lights", "Visible players shift from green at a distance through yellow to red nearby."),
                E("Camp timers", "Respawn and ward countdowns appear at cleared camps."),
                E("Camp clear", "A clear stores a potion and starts ward and respawn timers."),
                E("Vision", "Walls block sight; trails reveal live enemies temporarily."),
                E("Colosseum", "Full arena vision is available while fighting inside."),
                E("Stat icons", "Green plus means health; the blood drop means life steal."),
                E("Stat icons", "Sword means Offense; sparkle means Soul Offence; bow means attack speed."),
                E("Stat icons", "Shield means Defense; bubble means Soul Defense; boot means movement."),
                E("Esc", "Leave practice (training only)."),
            }),
            new HelpGuideSection("Planning before the run", new[]
            {
                E("1 · 2", "Choose the first or second spawn."),
                E("Click map", "Add a route stop; click near an upcoming stop to remove it."),
                E("Tab", "Move between planning options and buttons."),
                E("Arrow keys", "Move between map markers."),
                E("Page Up · Page Down", "Jump to camps in the previous or next zone."),
                E("Enter", "Activate the focused Ready, spawn, or camp control."),
                E("Delete", "Remove the focused route stop."),
            }),
            new HelpGuideSection("In the hub", new[]
            {
                E("Hold Shift", "Show the Champions guide with ability and scaling details."),
                E("WASD · Arrow keys", "Walk."),
                E("Right click", "Walk to a spot; hold to keep steering."),
                E("E", "Use the station you are standing at."),
                E("Left click", "Walk to a station and use it."),
            }),
            new HelpGuideSection("Anywhere", new[]
            {
                E("Alt + Enter", "Toggle fullscreen."),
                E("H", "Show or hide this guide."),
                E("Esc", "Close the open panel."),
            }),
        });

        static readonly IReadOnlyList<HelpMechanicSection> MechanicsData = Array.AsReadOnly(new[]
        {
            new HelpMechanicSection("Damage and terms", new[]
            {
                M("Offense", "Adds physical damage to weapon hits when listed as a scaling stat. It does not change the base damage type or automatically scale champion abilities. Some mob kills and quests grant it."),
                M("SO · Soul Offence", "Adds magic damage where listed, including wand, shield, fists, burn, and disease. It does not automatically scale Wishes, slows, or true-damage marks."),
                M("Physical", "Physical damage is reduced by Defense."),
                M("Magic", "Magic damage is reduced by Soul Defense."),
                M("True", "True damage is not reduced by Defense or Soul Defense."),
                M("Damage over time", "Damage applied over time, such as burn, disease, and bleeds. Each source scales in its own way; SO does not automatically strengthen every effect."),
                M("On-hit", "An effect applied when a weapon hit lands. More hits apply it more often."),
                M("Returned", "Damage dealt back to whoever hit you."),
                M("Slow", "Reduces movement or attack speed."),
                M("Heal", "Restores health. Lifesteal and camp heals follow their own timing."),
                M("Block", "A shield stops part of a hit arriving from the front; the remainder can still land."),
                M("Ramping", "Grows as a fight lasts or as more hits land."),
                M("Execute", "Grows more powerful as a target’s health falls."),
                M("Critical strike", "A hit that deals increased damage."),
                M("Area", "Can hit more than one enemy."),
                M("Wish", "Your faction’s once-per-run ability."),
            }),
            new HelpMechanicSection("Cards, power, and PvP", new[]
            {
                M("Card power", "Summarizes the tiers of cards you hold and informs the server’s player-versus-player damage factor. Live chest choices and mob stat stacks do not add to card power."),
                M("PvP factor", "The server scales damage between players using card power. Mobs, Wishes, and arena burn use their own damage handling."),
                M("Normal mob rewards", "Normal mob kills grant their type’s stat reward. Regular camp clears do not drop a chest."),
                M("Quest rewards", "Quests grant stat rewards associated with their mob and zone, plus GV."),
                M("Chests", "An elite can leave an augment chest. Each player makes a single server-validated choice, and an option may have a cost."),
            }),
            new HelpMechanicSection("Faction signatures", new[]
            {
                M("Fire · Burn", "Magic damage over time."),
                M("Fire · Backlash", "Physical damage returned to an attacker."),
                M("Sentenced · Mark", "Combines physical and magic damage."),
                M("Plague · Disease and execute", "Disease deals magic damage over time; the signature also threatens weakened targets."),
                M("Frost · Chill", "Slows the target."),
                M("Holy · Lifesteal", "Restores health from damage dealt."),
            }),
            new HelpMechanicSection("Weapons", new[]
            {
                M("Sword", "Close-range physical hits with on-hit effects. Unblocked hits can stagger windups and casts."),
                M("Axe", "Heavy swings can land while moving and shred Defense."),
                M("Bow", "Directional arrows fly straight. Movement is available through most of the draw."),
                M("Wand", "Longest weapon reach and the only lock-on weapon. Magic balls can remove arrows and splash onto nearby enemies."),
                M("Shield", "Blocks attacks from the front, ripostes, and reflects arrows."),
                M("Fists", "An empty weapon slot uses fast, short-reach attacks with strong on-hit effects."),
            }),
        });

        public static IReadOnlyList<HelpGuideSection> Controls => ControlsData;
        public static IReadOnlyList<HelpMechanicSection> Mechanics => MechanicsData;
        static HelpGuideEntry E(string keys, string description) => new HelpGuideEntry(keys, description);
        static HelpMechanicEntry M(string term, string description) => new HelpMechanicEntry(term, description);
    }

    /// <summary>Two-tab, scrollable help and glossary panel. All copy is presentation data; it never implements mechanics.</summary>
    public sealed class HelpGuideView : MonoBehaviour
    {
        RectTransform _root, _card;
        Button _controlsTab, _mechanicsTab, _closeButton;
        ScrollRect _controlsScroll, _mechanicsScroll;
        TMP_Text _controlsText, _mechanicsText;
        Action _close;
        HelpGuideTab _currentTab;
        bool _initialized;

        public RectTransform Root => _root;
        public bool IsVisible => _root != null && _root.gameObject.activeSelf;
        public HelpGuideTab CurrentTab => _currentTab;
        public Button ControlsTab => _controlsTab;
        public Button MechanicsTab => _mechanicsTab;

        public void Initialize(Transform root, Action close)
        {
            if (_initialized) throw new InvalidOperationException("HelpGuideView is already initialized.");
            if (root == null) throw new ArgumentNullException(nameof(root));
            _initialized = true; _close = close;
            _root = MythicUi.Panel(root, "HelpGuideOverlay", Vector2.zero, Vector2.one, new Color32(3, 7, 12, 224));
            var dismiss = _root.gameObject.AddComponent<ModalDismissSurface>(); dismiss.Dismiss = CloseByUser;
            _card = MythicUi.Panel(_root, "HelpGuideCard", new Vector2(.105f, .055f), new Vector2(.895f, .945f), ShowcasePalette.Panel);
            MythicUi.Text(_card, "HelpTitle", "FIELD GUIDE", new Vector2(.035f, .925f), new Vector2(.73f, .995f), 27, ShowcasePalette.Gold);
            _closeButton = MythicUi.Button(_card, "CloseHelp", "CLOSE · H / ESC", new Vector2(.76f, .925f), new Vector2(.965f, .99f), CloseByUser, MythicUi.ButtonStyle.Quiet);
            _controlsTab = MythicUi.Button(_card, "ControlsTab", "CONTROLS", new Vector2(.035f, .865f), new Vector2(.49f, .925f), () => ShowTab(HelpGuideTab.Controls), MythicUi.ButtonStyle.Primary);
            _mechanicsTab = MythicUi.Button(_card, "MechanicsTab", "MECHANICS", new Vector2(.51f, .865f), new Vector2(.965f, .925f), () => ShowTab(HelpGuideTab.Mechanics));
            _controlsScroll = CreateTextScroll(_card, "ControlsScroll", new Vector2(.035f, .075f), new Vector2(.965f, .85f), out _controlsText);
            _mechanicsScroll = CreateTextScroll(_card, "MechanicsScroll", new Vector2(.035f, .075f), new Vector2(.965f, .85f), out _mechanicsText);
            _controlsText.text = FormatControls(HelpGuideContent.Controls);
            _mechanicsText.text = FormatMechanics(HelpGuideContent.Mechanics);
            SetBodyFont(_controlsText); SetBodyFont(_mechanicsText);
            ShowTab(HelpGuideTab.Controls);
            SetVisible(false);
        }

        public void SetVisible(bool visible)
        {
            if (_root == null || _root.gameObject.activeSelf == visible) return;
            _root.gameObject.SetActive(visible);
            if (visible && EventSystem.current != null) EventSystem.current.SetSelectedGameObject(_currentTab == HelpGuideTab.Controls ? _controlsTab.gameObject : _mechanicsTab.gameObject);
        }

        public void ShowTab(HelpGuideTab tab)
        {
            if (tab != HelpGuideTab.Controls && tab != HelpGuideTab.Mechanics) throw new ArgumentOutOfRangeException(nameof(tab));
            _currentTab = tab;
            if (_controlsScroll != null) _controlsScroll.gameObject.SetActive(tab == HelpGuideTab.Controls);
            if (_mechanicsScroll != null) _mechanicsScroll.gameObject.SetActive(tab == HelpGuideTab.Mechanics);
            SetTabStyle(_controlsTab, tab == HelpGuideTab.Controls);
            SetTabStyle(_mechanicsTab, tab == HelpGuideTab.Mechanics);
        }

        void CloseByUser()
        {
            SetVisible(false);
            if (_close != null) _close();
        }

        static void SetTabStyle(Button button, bool selected)
        {
            if (button == null) return;
            var colors = button.colors;
            colors.normalColor = selected ? ShowcasePalette.GoldDim : ShowcasePalette.PanelRaised;
            colors.highlightedColor = ShowcasePalette.PanelStroke;
            colors.selectedColor = selected ? ShowcasePalette.GoldDim : ShowcasePalette.PanelStroke;
            button.colors = colors;
            var image = button.targetGraphic as Image;
            if (image != null) image.color = Color.white;
            var label = button.GetComponentInChildren<TMP_Text>();
            if (label != null) label.color = selected ? ShowcasePalette.Text : ShowcasePalette.MutedText;
        }

        static ScrollRect CreateTextScroll(Transform parent, string name, Vector2 min, Vector2 max, out TMP_Text text)
        {
            var frame = MythicUi.Rect(parent, name, min, max);
            var scroll = frame.gameObject.AddComponent<ScrollRect>();
            scroll.horizontal = false; scroll.vertical = true; scroll.movementType = ScrollRect.MovementType.Clamped;
            scroll.scrollSensitivity = 42; scroll.inertia = true;
            var viewport = MythicUi.Rect(frame, "Viewport", Vector2.zero, Vector2.one);
            var mask = viewport.gameObject.AddComponent<Image>(); mask.color = new Color(1, 1, 1, .012f); mask.raycastTarget = true;
            viewport.gameObject.AddComponent<RectMask2D>();
            text = MythicUi.Text(viewport, "Content", "", new Vector2(.02f, 1), new Vector2(.98f, 1), 16, ShowcasePalette.Text);
            text.rectTransform.pivot = new Vector2(.5f, 1); text.enableAutoSizing = false;
            text.alignment = TextAlignmentOptions.TopLeft; text.enableWordWrapping = true; text.richText = true;
            text.gameObject.AddComponent<ContentSizeFitter>().verticalFit = ContentSizeFitter.FitMode.PreferredSize;
            scroll.viewport = viewport; scroll.content = text.rectTransform;
            return scroll;
        }

        static void SetBodyFont(TMP_Text text)
        {
            var font = Resources.Load<TMP_FontAsset>("Fonts & Materials/LiberationSans SDF");
            if (font != null) text.font = font;
        }

        static string FormatControls(IReadOnlyList<HelpGuideSection> sections)
        {
            var output = new StringBuilder();
            foreach (var section in sections)
            {
                output.Append("<size=130%><color=#EDC77B><b>").Append(Escape(section.Title)).Append("</b></color></size>\n\n");
                foreach (var entry in section.Entries)
                    output.Append("<b>").Append(Escape(entry.Keys)).Append("</b>   ").Append(Escape(entry.Description)).Append("\n\n");
                output.Append("\n");
            }
            return output.ToString();
        }

        static string FormatMechanics(IReadOnlyList<HelpMechanicSection> sections)
        {
            var output = new StringBuilder();
            foreach (var section in sections)
            {
                output.Append("<size=130%><color=#EDC77B><b>").Append(Escape(section.Title)).Append("</b></color></size>\n\n");
                foreach (var entry in section.Entries)
                    output.Append("<b>").Append(Escape(entry.Term)).Append("</b>   ").Append(Escape(entry.Description)).Append("\n\n");
                output.Append("\n");
            }
            output.Append("<color=#B5C2D2>These descriptions explain the terms shown in the interface. All choices and outcomes are decided by the server.</color>");
            return output.ToString();
        }

        static string Escape(string text) => (text ?? "").Replace("&", "&amp;").Replace("<", "&lt;").Replace(">", "&gt;");
    }
}

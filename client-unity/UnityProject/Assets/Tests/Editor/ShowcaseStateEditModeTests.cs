using System;
using System.Reflection;
using NUnit.Framework;
using Roguehalla.Client;
using Roguehalla.Net;
using Roguehalla.Net.Protocol;
using TMPro;
using UnityEngine;

namespace Roguehalla.Client.Tests
{
    public sealed class ShowcaseStateEditModeTests
    {
        GameObject _root;
        AudioClip _clip;

        [TearDown]
        public void TearDown()
        {
            if (_root != null) UnityEngine.Object.DestroyImmediate(_root);
            if (_clip != null) UnityEngine.Object.DestroyImmediate(_clip);
        }

        [Test]
        public void BuildLabelUpdatesWhenOnlyTheHighestCardIndexChanges()
        {
            _root = new GameObject("match hud test");
            var hud = _root.AddComponent<MatchHud>();
            var labelObject = new GameObject("build label");
            labelObject.transform.SetParent(_root.transform, false);
            var label = labelObject.AddComponent<TextMeshPro>();
            SetField(hud, "_build", label);
            var slots = (UnityEngine.UI.Button[])GetField(hud, "_slots");
            slots[0] = CreateSlot("slot one");
            slots[1] = CreateSlot("slot two");
            var focusObject = new GameObject("focus label");
            focusObject.transform.SetParent(_root.transform, false);
            SetField(hud, "_focusLabel", focusObject.AddComponent<TextMeshPro>());

            RefreshCollections(hud, BuildView(0));
            string previous = label.text;
            RefreshCollections(hud, BuildView(1));

            Assert.That(previous, Does.Contain("SlowBurn×1"));
            Assert.That(label.text, Does.Contain("79×1"));
            Assert.That(label.text, Is.Not.EqualTo(previous));
        }

        [Test]
        public void PotionCampCountUpdatesWithoutChangingOtherHudInventoryFactsAndClearsWhenInventoryIsMissing()
        {
            _root = new GameObject("match hud potion inventory test");
            var hud = _root.AddComponent<MatchHud>();
            var slots = (UnityEngine.UI.Button[])GetField(hud, "_slots");
            slots[0] = CreateSlot("slot one");
            slots[1] = CreateSlot("slot two");
            var focusObject = new GameObject("focus label");
            focusObject.transform.SetParent(_root.transform, false);
            var focusLabel = focusObject.AddComponent<TextMeshPro>();
            SetField(hud, "_focusLabel", focusLabel);
            var buildObject = new GameObject("build label");
            buildObject.transform.SetParent(_root.transform, false);
            SetField(hud, "_build", buildObject.AddComponent<TextMeshPro>());

            RefreshCollections(hud, InventoryView(1));
            string firstSlot = slots[0].GetComponentInChildren<TMP_Text>().text;
            string secondSlot = slots[1].GetComponentInChildren<TMP_Text>().text;
            Assert.That(focusLabel.text, Is.EqualTo("Potions 2 small / 1 camp / 3 healing"));

            RefreshCollections(hud, InventoryView(0));

            Assert.That(focusLabel.text, Is.EqualTo("Potions 2 small / 0 camp / 3 healing"));
            Assert.That(slots[0].GetComponentInChildren<TMP_Text>().text, Is.EqualTo(firstSlot));
            Assert.That(slots[1].GetComponentInChildren<TMP_Text>().text, Is.EqualTo(secondSlot));

            RefreshCollections(hud, InventoryView(null));

            Assert.That(focusLabel.text, Is.EqualTo("Potions: awaiting server"));
        }

        [Test]
        public void DetachingStopsAndClearsEveryPooledVoice()
        {
            _root = new GameObject("soundscape test");
            var soundscape = _root.AddComponent<ShowcaseSoundscape>();
            soundscape.Initialize(null);
            _clip = AudioClip.Create("test cue", 64, 1, 44100, false);
            var voices = (Array)GetField(soundscape, "_voices");
            Assert.That(voices.Length, Is.GreaterThan(0));
            foreach (object voice in voices)
            {
                var voiceType = voice.GetType();
                var source = (AudioSource)voiceType.GetField("Source", BindingFlags.Instance | BindingFlags.Public).GetValue(voice);
                source.clip = _clip;
                voiceType.GetField("Actor", BindingFlags.Instance | BindingFlags.Public).SetValue(voice, 42u);
            }

            typeof(ShowcaseSoundscape).GetMethod("DetachSession", BindingFlags.Instance | BindingFlags.NonPublic).Invoke(soundscape, null);

            foreach (object voice in voices)
            {
                var voiceType = voice.GetType();
                var source = (AudioSource)voiceType.GetField("Source", BindingFlags.Instance | BindingFlags.Public).GetValue(voice);
                Assert.That(source.clip, Is.Null);
                Assert.That(voiceType.GetField("Actor", BindingFlags.Instance | BindingFlags.Public).GetValue(voice), Is.EqualTo(0u));
            }
        }

        static CollectionsView BuildView(byte highCard)
        {
            var cards = new byte[80];
            cards[0] = 1;
            cards[1] = 2;
            cards[79] = highCard;
            var boosts = new byte[8];
            boosts[0] = 1;
            var view = new CollectionsView();
            var state = new ServerMsg.State
            {
                Items = new StateItem[]
                {
                    new BuildState { Value = new WireBuild { Cards = cards, Boosts = boosts } }
                }
            };
            typeof(CollectionsView).GetMethod("Apply", BindingFlags.Instance | BindingFlags.NonPublic).Invoke(view, new object[] { state });
            return view;
        }

        static CollectionsView InventoryView(byte? potionLarge)
        {
            var view = new CollectionsView();
            var inventory = new InventoryState
            {
                Value = potionLarge.HasValue
                    ? new WireInventory { ActiveSlot = 0, Slot0 = (byte)WeaponId.Sword, Slot1 = (byte)WeaponId.Bow,
                        PotionSmall = 2, PotionLarge = potionLarge.Value, PotionsHealing = 3 }
                    : (WireInventory?)null
            };
            typeof(CollectionsView).GetMethod("Apply", BindingFlags.Instance | BindingFlags.NonPublic)
                .Invoke(view, new object[] { new ServerMsg.State { Items = new StateItem[] { inventory } } });
            return view;
        }

        static void RefreshCollections(MatchHud hud, CollectionsView view)
        {
            typeof(MatchHud).GetMethod("RefreshCollections", BindingFlags.Instance | BindingFlags.NonPublic).Invoke(hud, new object[] { view });
        }

        static object GetField(object target, string name)
        {
            return target.GetType().GetField(name, BindingFlags.Instance | BindingFlags.NonPublic).GetValue(target);
        }

        static void SetField(object target, string name, object value)
        {
            target.GetType().GetField(name, BindingFlags.Instance | BindingFlags.NonPublic).SetValue(target, value);
        }

        UnityEngine.UI.Button CreateSlot(string name)
        {
            var buttonObject = new GameObject(name);
            buttonObject.transform.SetParent(_root.transform, false);
            var button = buttonObject.AddComponent<UnityEngine.UI.Button>();
            var textObject = new GameObject(name + " text");
            textObject.transform.SetParent(buttonObject.transform, false);
            textObject.AddComponent<TextMeshPro>();
            return button;
        }
    }
}

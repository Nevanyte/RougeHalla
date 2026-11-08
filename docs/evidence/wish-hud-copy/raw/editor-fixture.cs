using System;
using System.Collections.Generic;
using System.Reflection;
using Roguehalla.Client;
using Roguehalla.Net;
using Roguehalla.Net.Protocol;
using UnityEngine;
using TMPro;

var client = UnityEngine.Object.FindFirstObjectByType<MatchClient>();
if (client == null || client.Hud == null) throw new Exception("Runtime bootstrap/HUD not ready");
client.enabled = false; // This staged fixture never reads or sends ordinary player input.
var settings = ShowcaseSettings.Current;
settings.SetTextScale(1.5f);
for (int i = 0; i < 5 && (settings.QualityMode != ShowcaseQualityMode.Manual || settings.EffectiveQuality != ShowcaseQuality.High); i++) settings.CycleQuality();
if (settings.ReducedMotion) settings.ToggleReducedMotion();
if (client.Arena != null) { client.Arena.gameObject.SetActive(false); UnityEngine.Object.Destroy(client.Arena.gameObject); }
client.Arena = new GameObject("Staged protocol12 arena").AddComponent<Roguehalla.Client.ArenaView>();
var assembly = Array.Find(AppDomain.CurrentDomain.GetAssemblies(), a => a.GetName().Name == "Roguehalla.Client.EditModeTests");
var transportType = assembly.GetType("Roguehalla.Client.Tests.PresentationTimelineEditModeTests+Transport");
var transport = (ITransport)Activator.CreateInstance(transportType, true);
var session = new Session(transport, new SessionOptions { Url = "ws://editor-fixture/ws", Profile = "editor-fixture", Now = () => Time.realtimeSinceStartupAsDouble * 1000 });
typeof(MatchClient).GetProperty("Session").SetValue(client, session);
client.Hud.Bind(session);
typeof(MatchClient).GetMethod("BindPresentationSession", BindingFlags.Instance | BindingFlags.NonPublic).Invoke(client, new object[] { session });
var queue = transportType.GetMethod("Queue");
session.Connect(); transportType.GetMethod("Open").Invoke(transport, null);
queue.Invoke(transport, new object[] { new ServerMsg.Welcome { Protocol = Wire.ProtocolVersion, MatchId = new byte[16], Session = new byte[16],
    PlayerId = 3, TickRate = 20, Tick = 1, ServerMs = 50, Map = new MapBlob(32, 32, new byte[1024]) } });
var snapshot = new ServerMsg.Snapshot { Tick = 1, Phase = 1, ServerTimeOverrideMs = 5000,
    Me = new WireSelf { Id = 3, Faction = 3, X = 448, Y = 384, Status = 1, Hp = 520, MaxHp = 600, Barrier = 80, BarrierRingStep = 8, Kills = 12, Gv = 120,
        Wish = new WireWishOwner { Ability = 0, ReadyAt = 5500, FullAt = 12000, MaxCharges = 2, Charges = 1, RechargeMs = 4000, NextChargeAt = 7000,
            Cast = new WireWishCast { Ability = 0, StartedAt = 4500, LandsAt = 6500 } } } };
snapshot.Actors = new WireActor[5];
for (byte i = 0; i < 5; i++) snapshot.Actors[i] = new WireActor { Id = (uint)(100 + i), Faction = i, X = (9 + i * 2.5f) * 32,
    Y = 8.5f * 32, Status = 1, HpPct = (byte)(i == 0 ? 55 : 80), BarrierPct = (byte)(i == 0 ? 50 : 25), BarrierRingStep = (byte)(i == 0 ? 8 : 1) };
queue.Invoke(transport, new object[] { snapshot });
queue.Invoke(transport, new object[] { new ServerMsg.State { Tick = 1, Items = new StateItem[] { new InventoryState {
    Value = new WireInventory { PotionSmall = 5, PotionLarge = 5, PotionsHealing = 3 } } } } });
byte[] abilities = {3,2,1,0,4};
var effects = new ServerMsg.Fx();
for (byte i = 0; i < 5; i++) effects.List.Add(new WireFx { Kind = FxKind.WishLanded, Ability = abilities[i], EventTime = 5000,
    HasAnchor = true, AnchorX = (9 + i * 2.5f) * 32, AnchorY = 14 * 32,
    HasDestination = abilities[i] == 3, DestinationX = (11 + i * 2.5f) * 32, DestinationY = 14 * 32 });
queue.Invoke(transport, new object[] { effects });
session.Poll();
client.Arena.Build(session.Map);
var actors = new List<InterpActor>(); session.Snapshots.Sample(session.Clock.RenderMs, actors);
client.Arena.RefreshVisibility(session); client.Arena.PresentCollections(session.Collections); client.Arena.Present(actors, session.Me, null, 0);
client.Cam.orthographicSize = 8.6f; client.Arena.Follow(client.Cam, session.Me.X, session.Me.Y);
typeof(MatchHud).GetMethod("LateUpdate", BindingFlags.Instance | BindingFlags.NonPublic).Invoke(client.Hud, null);
var uiRoot = (RectTransform)typeof(MatchHud).GetField("_root", BindingFlags.Instance | BindingFlags.NonPublic).GetValue(client.Hud);
var labelObject = new GameObject("Editor fixture scope", typeof(RectTransform), typeof(TextMeshProUGUI));
labelObject.transform.SetParent(uiRoot, false);
var rect = (RectTransform)labelObject.transform; rect.anchorMin = new Vector2(.02f, .865f); rect.anchorMax = new Vector2(.98f, .92f); rect.offsetMin = rect.offsetMax = Vector2.zero;
var label = labelObject.GetComponent<TextMeshProUGUI>(); label.font = TMP_Settings.defaultFontAsset; label.fontSize = 18; label.color = ShowcasePalette.Gold;
label.text = "HUD COPY EDITOR FIXTURE - synthetic protocol12 facts / no server  |  Blaze / Trial / Swarm / Freeze / Last Stand"; label.raycastTarget = false;
AppDomain.CurrentDomain.SetData("Roguehalla.WishBarrier.EditorFixture.Session", session);
Canvas.ForceUpdateCanvases();
return new { fixture = "synthetic protocol12, no server", playing = Application.isPlaying, frame = Time.frameCount,
    serverTime = session.ServerTimeMs, sourceEpoch = session.TimelineEpoch, textScale = settings.TextScale,
    quality = settings.EffectiveQuality.ToString(), reducedMotion = settings.ReducedMotion, width = Screen.width, height = Screen.height };

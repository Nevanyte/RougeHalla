using System;
using System.Collections.Generic;
using System.Reflection;
using Roguehalla.Client;
using Roguehalla.Net;
using Roguehalla.Net.Protocol;
using UnityEngine;
using TMPro;

// Synthetic editor presentation fixture only: no server and no player input. The delivered State is encoded,
// transported, decoded by Session.Poll, then presented through the ordinary MatchHud refresh path.
var client = UnityEngine.Object.FindFirstObjectByType<MatchClient>();
if (client == null || client.Hud == null) throw new Exception("Runtime bootstrap/HUD not ready");
client.enabled = false; // prevent ordinary player input/update while staging the deterministic screenshot.
var settings = ShowcaseSettings.Current;
settings.SetTextScale(1.5f);
for (int i = 0; i < 5 && (settings.QualityMode != ShowcaseQualityMode.Manual || settings.EffectiveQuality != ShowcaseQuality.High); i++) settings.CycleQuality();
if (settings.ReducedMotion) settings.ToggleReducedMotion();
if (client.Arena != null) { client.Arena.gameObject.SetActive(false); UnityEngine.Object.Destroy(client.Arena.gameObject); }
client.Arena = new GameObject("Staged protocol13 trophy arena").AddComponent<Roguehalla.Client.ArenaView>();
var assembly = Array.Find(AppDomain.CurrentDomain.GetAssemblies(), a => a.GetName().Name == "Roguehalla.Client.EditModeTests");
if (assembly == null) throw new Exception("EditMode test assembly not loaded");
var transportType = assembly.GetType("Roguehalla.Client.Tests.PresentationTimelineEditModeTests+Transport");
if (transportType == null) throw new Exception("Synthetic test transport not found");
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
queue.Invoke(transport, new object[] { new ServerMsg.State { Tick = 1, Items = new StateItem[] {
    new InventoryState { Value = new WireInventory { PotionSmall = 5, PotionLarge = 5, PotionsHealing = 3 } },
    new RewardChestsState { Rows = new[] { new WireRewardChest {
        Handle = new RewardChestHandle(73), X = 448, Y = 384, ExpiresAt = 15000, Picked = false, CanChoose = true,
        Options = new[] {
            // Captured formatter rows; the two 1.1875 values are formatter stress samples, not gameplay maxima.
            new WireRewardOption { Kind = 3, KillKey = TrophyStatKey.Speed, KillGain = 1.1875 },
            new WireRewardOption { Kind = 3, KillKey = TrophyStatKey.Ap, KillGain = 3.3 },
            new WireRewardOption { Kind = 3, KillKey = TrophyStatKey.AttackSpeed, KillGain = 1.1875 }
        }
    } } }
} } });
session.Poll(); // decode actual protocol 13 State bytes into Session.Collections.
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
label.text = "SYNTHETIC PROTOCOL13 TROPHY EDITOR FIXTURE / no server / input disabled"; label.raycastTarget = false;
AppDomain.CurrentDomain.SetData("Roguehalla.Trophy13.EditorFixture.Session", session);
Canvas.ForceUpdateCanvases();
return new { fixture = "SYNTHETIC PROTOCOL13 TROPHY EDITOR FIXTURE / no server / input disabled", playing = Application.isPlaying,
    frame = Time.frameCount, serverTime = session.ServerTimeMs, sourceEpoch = session.TimelineEpoch, textScale = settings.TextScale,
    quality = settings.EffectiveQuality.ToString(), reducedMotion = settings.ReducedMotion, width = Screen.width, height = Screen.height,
    trophyExamples = new[] { "+118.8% movement speed", "+3.3 Soul Offence", "+118.8% attack speed" } };

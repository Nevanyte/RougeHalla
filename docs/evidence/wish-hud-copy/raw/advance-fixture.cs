using System;
using System.Collections.Generic;
using System.Reflection;
using Roguehalla.Client;
using Roguehalla.Net;
using Roguehalla.Net.Protocol;
using UnityEngine;
using TMPro;

var client = UnityEngine.Object.FindFirstObjectByType<MatchClient>();
var session = client.Session;
var transport = typeof(Session).GetField("_t", BindingFlags.Instance | BindingFlags.NonPublic).GetValue(session);
var snapshot = new ServerMsg.Snapshot { Tick = 2, Phase = 1, ServerTimeOverrideMs = 5250,
    Me = new WireSelf { Id = 3, Faction = 3, X = 448, Y = 384, Status = 1, Hp = 520, MaxHp = 600, Barrier = 80, BarrierRingStep = 8, Kills = 12, Gv = 120,
        Wish = new WireWishOwner { Ability = 0, ReadyAt = 5500, FullAt = 12000, MaxCharges = 2, Charges = 1, RechargeMs = 4000, NextChargeAt = 7000,
            Cast = new WireWishCast { Ability = 0, StartedAt = 4500, LandsAt = 6500 } } } };
snapshot.Actors = new WireActor[5];
for (byte i = 0; i < 5; i++) snapshot.Actors[i] = new WireActor { Id = (uint)(100 + i), Faction = i, X = (9 + i * 2.5f) * 32,
    Y = 8.5f * 32, Status = 1, HpPct = (byte)(i == 0 ? 55 : 80), BarrierPct = (byte)(i == 0 ? 50 : 25), BarrierRingStep = (byte)(i == 0 ? 8 : 1) };
transport.GetType().GetMethod("Queue").Invoke(transport, new object[] { snapshot });
session.Poll();
var actors = new List<InterpActor>(); session.Snapshots.Sample(session.Clock.RenderMs, actors);
client.Arena.RefreshVisibility(session); client.Arena.Present(actors, session.Me, null, 0);
typeof(MatchHud).GetMethod("LateUpdate", BindingFlags.Instance | BindingFlags.NonPublic).Invoke(client.Hud, null);
Canvas.ForceUpdateCanvases();
return new { synthetic = true, clientUpdateEnabled = client.enabled, serverTime = session.ServerTimeMs, epoch = session.TimelineEpoch };

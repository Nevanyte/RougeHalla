using System;
using System.Collections.Generic;
using System.IO;
using System.Text.Json;
using NUnit.Framework;
using Roguehalla.Net.Protocol;

namespace Roguehalla.Net.Tests
{
    /// <summary>
    /// The attack movement pause (ADR 0008 amendment 2026-11-10) replayed from the Rust truth. <c>protocol/fixtures/ranged_pause_v2.json</c>
    /// is written by <c>crates/rh-parity/tests/ranged_pause_golden.rs</c> from the real sim: one walking fighter attacking in several
    /// ways, per 50 ms tick the server's position and whether the tick moved it, and ONLY the facts the owner's observation delivers
    /// (its Windup, Cancel and Stagger fx, weapon and effects). This replays those facts through the real <see cref="Session"/>
    /// poll order with link latency and checks the drawn position against the zero-latency server timeline at every tick.
    /// <para>
    /// Without the mirror (<see cref="LocalMotion.PredictAttackPause"/> off) the same replay draws the walk straight through the
    /// server's pause and is pulled back afterwards: the control cases measure that, so the passing cases prove something.
    /// </para>
    /// </summary>
    public class RangedPausePredictionTests
    {
        const double Tick = 50.0;
        const double Frame = 1000.0 / 120.0;
        const double ServerClockOffset = 7000.0;
        const double TickWalk = 170.0 * Tick / 1000.0;
        /// <summary>The zero-latency acceptance tolerance of <c>PredictionLatencyTests</c> (wire floats).</summary>
        const double LeadTolerance = 0.01;
        const uint Me = 3;

        sealed class QueuedTransport : ITransport
        {
            public event Action Opened;
            public event Action<byte[]> Received;
            public event Action<string> Closed;
            readonly Queue<byte[]> incoming = new Queue<byte[]>();
            public void Connect(string url) { }
            public void Send(byte[] frame) { }
            public void Close() { Closed?.Invoke("closed"); }
            public void Poll() { while (incoming.Count != 0) Received(incoming.Dequeue()); }
            public void Open() { Opened(); }
            public void Enqueue(ServerMsg msg) { incoming.Enqueue(msg.Encode()); }
        }

        static JsonDocument _fixture;
        static JsonElement Fixture
        {
            get
            {
                if (_fixture == null)
                    _fixture = JsonDocument.Parse(File.ReadAllText(Path.Combine(Util.RepoRoot(), "protocol/fixtures/ranged_pause_v2.json")));
                return _fixture.RootElement;
            }
        }

        static JsonElement Case(string name)
        {
            foreach (var c in Fixture.GetProperty("cases").EnumerateArray())
                if (c.GetProperty("name").GetString() == name) return c;
            throw new ArgumentException("no fixture case " + name);
        }

        static MapBlob Map()
        {
            using var paths = JsonDocument.Parse(File.ReadAllText(Path.Combine(Util.RepoRoot(), "protocol/fixtures/pathfinding_v1.json")));
            var reader = new Reader(Util.FromHex(paths.RootElement.GetProperty("mapBlob").GetProperty("hex").GetString()));
            var map = MapBlob.ReadCollisionFixture(ref reader); reader.End();
            return map;
        }

        static uint SourceTick(double ms) { return (uint)Math.Round((ServerClockOffset + ms) / Tick); }
        static double CeilTick(double ms) { return Math.Ceiling(ms / Tick - 1e-9) * Tick; }
        static double Dist(double ax, double ay, double bx, double by) { double dx = ax - bx, dy = ay - by; return Math.Sqrt(dx * dx + dy * dy); }

        sealed class Result
        {
            public double MaxOnTickError;
            public double MaxAnyError;
            public int Snaps;
            public double ReconMaxErr;
            public int PausedTicks;
            public int WindupFx;
            public double WorstAtMs;
        }

        /// <summary>
        /// One replay: the Move is ordered a frame in, applied by the first server tick after the uplink, and every fixture row k is
        /// the server's state after k-1 ticks of walking (row 0: before the order). Row k's fx are delivered with row k's
        /// snapshot, before it, as the server sends them. The drawn position is compared with the zero-latency server timeline
        /// (<c>PredictionLatencyTests</c>' ideal): exactly on frames a whole number of ticks after the order, within one tick of
        /// walking between them.
        /// </summary>
        static Result Replay(string name, double uplink, double downlink, bool predict)
        {
            var one = Case(name);
            var rows = one.GetProperty("rows");
            int last = rows.GetArrayLength() - 1;
            var xs = new double[last + 1];
            var ys = new double[last + 1];
            for (int k = 0; k <= last; k++) { xs[k] = rows[k].GetProperty("x").GetDouble(); ys[k] = rows[k].GetProperty("y").GetDouble(); }

            double now = 0;
            var t = new QueuedTransport();
            var s = new Session(t, new SessionOptions { Url = "ws://x/ws", Profile = "p", Now = () => now });
            s.Connect(); t.Open();
            t.Enqueue(new ServerMsg.Welcome { Protocol = Wire.ProtocolVersion, MatchId = new byte[16], PlayerId = Me, Session = new byte[16], TickRate = 20, Tick = SourceTick(0), ServerMs = ServerClockOffset, Map = Map() });
            t.Enqueue(new ServerMsg.Snapshot { Tick = SourceTick(0), Phase = 1, Me = SelfAt(rows[0], xs[0], ys[0], 0) });
            s.Poll();
            s.Motion.PredictAttackPause = predict;

            var result = new Result();
            double c = Frame;
            double applied = CeilTick(c + uplink);
            double nextServerTick = Tick;
            bool ordered = false;
            int sentRow = -1;
            double end = applied + Tick * (last - 1) + downlink; // the fixture ends with the last row: past it the server timeline is unknown
            for (int f = 1; f * Frame <= end; f++)
            {
                now = f * Frame;
                while (nextServerTick + downlink <= now + 1e-9)
                {
                    int k = nextServerTick < applied ? 0 : Math.Min(last, (int)((nextServerTick - applied) / Tick) + 1);
                    if (k != sentRow || k == 0)
                    {
                        if (k != sentRow && k > 0) FeedFx(t, rows[k], nextServerTick);
                        t.Enqueue(new ServerMsg.Snapshot
                        {
                            Tick = SourceTick(nextServerTick), Phase = 1, Me = SelfAt(rows[k], xs[k], ys[k], (byte)(k > 0 ? 1 : 0)),
                            AckInput = k > 0 ? 1u : 0u,
                            OwnerCombat = OwnerAt(rows[k], SourceTick(nextServerTick) * Tick - rows[k].GetProperty("t").GetDouble()),
                        });
                    }
                    sentRow = k;
                    nextServerTick += Tick;
                }
                s.Poll();
                if (!ordered && now >= c - 1e-9)
                {
                    s.OrderMove((float)one.GetProperty("goal")[0].GetDouble(), (float)one.GetProperty("goal")[1].GetDouble());
                    ordered = true;
                }
                s.FlushInput();
                if (!ordered) continue;
                if (now - c > Tick * (last - 1)) break;
                double kf = Math.Min(last, Math.Max(0, (now - c) / Tick));
                int k0 = (int)Math.Floor(kf + 1e-6), k1 = Math.Min(last, k0 + 1);
                bool onTick = Math.Abs(kf - Math.Round(kf)) < 1e-6;
                double err = onTick ? Dist(s.Motion.DrawnX, s.Motion.DrawnY, xs[k0], ys[k0])
                    : Math.Min(Dist(s.Motion.DrawnX, s.Motion.DrawnY, xs[k0], ys[k0]), Dist(s.Motion.DrawnX, s.Motion.DrawnY, xs[k1], ys[k1]));
                if (onTick && err > result.MaxOnTickError) { result.MaxOnTickError = err; result.WorstAtMs = now; }
                if (err > result.MaxAnyError) result.MaxAnyError = err;
            }
            result.Snaps = s.Motion.Snaps;
            result.ReconMaxErr = s.Motion.ReconMaxErr;
            for (int k = 1; k <= last; k++)
            {
                var m = rows[k].GetProperty("moveMult");
                if (m.ValueKind == JsonValueKind.Number && m.GetInt32() == 0) result.PausedTicks++;
                foreach (var fx in rows[k].GetProperty("fx").EnumerateArray()) if (fx.GetProperty("kind").GetString() == "windup") result.WindupFx++;
            }
            return result;
        }

        /// <summary>The owner block a row delivers, its clocks moved into the replay's clock by <paramref name="shift"/> (null: no block).</summary>
        static WireOwnerCombat OwnerAt(JsonElement row, double shift)
        {
            var o = row.GetProperty("owner");
            if (o.ValueKind != JsonValueKind.Object) return null;
            uint draw = o.GetProperty("drawStartedAt").GetUInt32();
            return new WireOwnerCombat
            {
                DrawStartedAt = draw == 0 ? 0 : (uint)(draw + shift), ReadyAt = (uint)(o.GetProperty("readyAt").GetUInt32() + shift),
                AsMilli = o.GetProperty("asMilli").GetDouble(), WindupMilli = o.GetProperty("windupMilli").GetDouble(), SpeedMilli = o.GetProperty("speedMilli").GetDouble(),
            };
        }

        static WireSelf SelfAt(JsonElement row, double x, double y, byte seq)
        {
            return new WireSelf
            {
                Id = Me, X = (float)x, Y = (float)y, Hp = 10, MaxHp = 10, Status = 1, MoveSeq = seq,
                Weapon = (byte)row.GetProperty("weapon").GetInt32(), Effects = (ushort)row.GetProperty("effects").GetInt32(),
            };
        }

        static void FeedFx(QueuedTransport t, JsonElement row, double serverTickMs)
        {
            var list = new List<WireFx>();
            foreach (var fx in row.GetProperty("fx").EnumerateArray())
            {
                switch (fx.GetProperty("kind").GetString())
                {
                    case "windup":
                        list.Add(new WireFx { Kind = FxKind.Windup, By = Me, Weapon = (byte)fx.GetProperty("weapon").GetInt32(), A = (float)fx.GetProperty("a").GetDouble(), Ms = (ushort)fx.GetProperty("ms").GetInt32() });
                        break;
                    case "stagger": list.Add(new WireFx { Kind = FxKind.Stagger, Id = Me }); break;
                    case "cancel": list.Add(new WireFx { Kind = FxKind.Cancel, Id = Me }); break;
                }
            }
            if (list.Count == 0) return;
            var msg = new ServerMsg.Fx { Tick = SourceTick(serverTickMs) };
            msg.List.AddRange(list);
            t.Enqueue(msg);
        }

        static readonly string[] AllCases =
        {
            "wand-single-shot", "wand-held", "wand-rejected-cooldown", "wand-staggered", "wand-staggered-in-pause",
            "wand-weapon-swap", "bow-single-shot", "bow-held", "bow-holy-faction", "bow-plague-faction", "bow-frost-faction",
            "bow-rejected-cooldown", "bow-staggered-mid-draw", "bow-weapon-swap-mid-draw", "bow-weapon-swap-early-draw", "sword-swing",
        };

        // ----------------------------------------------------------------------------------------------------------------
        // The rule constants and where the window is placed, against the Rust truth (no latency, no frames)

        [Test]
        public void TheRuleConstantsAreTheRustValues()
        {
            var k = Fixture.GetProperty("constants");
            Assert.AreEqual(k.GetProperty("rangedReleasePauseMs").GetDouble(), LocalMotion.RangedReleasePauseMs, "RANGED_RELEASE_PAUSE_MS");
            Assert.AreEqual(k.GetProperty("tieEpsMs").GetDouble(), LocalMotion.TieEpsMs, "TIE_EPS_MS");
            Assert.AreEqual(k.GetProperty("bowWindupMaxS").GetDouble(), LocalMotion.BowWindupMaxS, "BOW_WINDUP_MAX_S");
            Assert.AreEqual(k.GetProperty("bowWindupIntervalShare").GetDouble(), LocalMotion.BowWindupIntervalShare, "BOW_WINDUP_INTERVAL_SHARE");
            Assert.AreEqual(k.GetProperty("tickMs").GetDouble(), LocalMotion.TickMs, "TICK_MS");
            Assert.AreEqual(k.GetProperty("playerSpeed").GetDouble(), LocalMotion.PlayerSpeed, "PLAYER_SPEED");
        }

        /// <summary>
        /// Feeds a case's rows to a bare <see cref="LocalMotion"/> in server order (a row's fx, then its self block) and returns, for
        /// every row with a defined multiplier, (row, server stopped the walk, mirror stops the step ending at that row's tick).
        /// </summary>
        static List<(int row, bool server, bool mirror)> Place(string name)
        {
            var rows = Case(name).GetProperty("rows");
            var m = new LocalMotion(Map());
            var result = new List<(int, bool, bool)>();
            for (int k = 0; k < rows.GetArrayLength(); k++)
            {
                var row = rows[k];
                double tick = row.GetProperty("t").GetDouble();
                foreach (var fx in row.GetProperty("fx").EnumerateArray())
                {
                    switch (fx.GetProperty("kind").GetString())
                    {
                        case "windup": m.NoteOwnWindup(tick, fx.GetProperty("ms").GetInt32(), (byte)fx.GetProperty("weapon").GetInt32()); break;
                        case "stagger": m.NoteOwnStagger(tick); break;
                        case "cancel": m.NoteOwnCancel(tick); break;
                    }
                }
                m.OnSnapshot(SelfAt(row, row.GetProperty("x").GetDouble(), row.GetProperty("y").GetDouble(), 0), tick, null, tick);
                var own = OwnerAt(row, 0);
                if (own != null) m.NoteOwnerDraw(tick, own.DrawStartedAt, own.ReadyAt, own.WindupMilli);
                // What the mirror says about the step ending at this row's tick, right after the row's facts: the step is already
                // decided server side, so every fact that changes it (a stagger or swap at this very tick included) is in by now.
                var mult = row.GetProperty("moveMult");
                if (k > 0 && mult.ValueKind == JsonValueKind.Number) result.Add((k, mult.GetInt32() == 0, m.AttackPauseStops(tick)));
            }
            return result;
        }

        [TestCase("wand-single-shot")]
        [TestCase("wand-held")]
        [TestCase("wand-rejected-cooldown")]
        [TestCase("wand-staggered")]
        [TestCase("wand-staggered-in-pause")]
        [TestCase("wand-weapon-swap")]
        [TestCase("bow-single-shot")]
        [TestCase("bow-held")]
        [TestCase("bow-holy-faction")]
        [TestCase("bow-plague-faction")]
        [TestCase("bow-frost-faction")]
        [TestCase("bow-rejected-cooldown")]
        [TestCase("bow-staggered-mid-draw")]
        [TestCase("bow-weapon-swap-mid-draw")]
        [TestCase("bow-weapon-swap-early-draw")]
        [TestCase("sword-swing")]
        public void TheMirrorStopsExactlyTheStepsTheServerStopped(string name)
        {
            var placed = Place(name);
            foreach (var p in placed)
                Assert.AreEqual(p.server, p.mirror, name + ": row " + p.row + " the server " + (p.server ? "stopped" : "walked") + " but the mirror " + (p.mirror ? "stops" : "walks"));
            int stopped = 0;
            foreach (var p in placed) if (p.server) stopped++;
            if (name == "sword-swing" || name == "wand-staggered" || name == "bow-weapon-swap-early-draw") Assert.AreEqual(0, stopped, name + ": nothing to stop");
            else Assert.GreaterOrEqual(stopped, 1, name + ": the case must contain a server pause");
        }

        [Test]
        public void TheBowLandingDerivedFromTheOwnerBlockIsTheServers()
        {
            // Only the owner block's clocks and the two mirrored constants: the shot lands min(max, share * interval) after the draw
            // starts. The block's clocks are whole milliseconds, so the derivation is within about a millisecond of the server's own.
            int draws = 0; double worst = 0;
            foreach (var c in Fixture.GetProperty("cases").EnumerateArray())
            {
                if (c.GetProperty("weapon").GetInt32() != (int)WeaponId.Bow) continue;
                foreach (var row in c.GetProperty("rows").EnumerateArray())
                {
                    var own = row.GetProperty("owner");
                    var truth = row.GetProperty("truthLandsAt");
                    if (own.ValueKind != JsonValueKind.Object || truth.ValueKind != JsonValueKind.Number) continue;
                    double draw = own.GetProperty("drawStartedAt").GetUInt32(), ready = own.GetProperty("readyAt").GetUInt32();
                    double derived = draw + 1000.0 * Math.Min(LocalMotion.BowWindupMaxS, LocalMotion.BowWindupIntervalShare * (ready - draw) / 1000.0);
                    worst = Math.Max(worst, Math.Abs(derived - truth.GetDouble()));
                    Assert.LessOrEqual(Math.Abs(derived - truth.GetDouble()), 1.5, c.GetProperty("name").GetString() + " row " + row.GetProperty("row").GetInt32());
                    draws++;
                }
            }
            Assert.Greater(draws, 30);
            TestContext.Progress.WriteLine("bow landing derived from the owner block: " + draws + " rows, worst error " + worst.ToString("F3") + " ms");
        }

        [Test]
        public void ADrawAtAWindupScaleAboveOneIsLeftUnpredicted()
        {
            var m = new LocalMotion(Map());
            m.OnSnapshot(new WireSelf { Id = Me, X = 100, Y = 100, Hp = 1, MaxHp = 1, Status = 1, Weapon = 1 }, 1000, null, 1000);
            m.NoteOwnerDraw(1000, 1000, 1854, 1500.0);   // a windup mirror above 1 scales the wait by a rule the client does not hold
            Assert.AreEqual(0, m.AttackPauseWindows);
            m.NoteOwnerDraw(1050, 0, 1854, 1500.0);
            m.NoteOwnerDraw(1100, 1100, 1954, 1000.0);
            Assert.AreEqual(1, m.AttackPauseWindows);
        }

        [Test]
        public void NothingIsPlacedWithoutADeliveredFactOrWhenSwitchedOff()
        {
            var m = new LocalMotion(Map());
            m.NoteOwnWindup(1000, 450, (byte)WeaponId.Wand);
            Assert.AreEqual(0, m.AttackPauseWindows, "no sample stamp yet: the server time cannot be placed on the model clock");
            m.OnSnapshot(new WireSelf { Id = Me, X = 100, Y = 100, Hp = 1, MaxHp = 1, Status = 1, Weapon = 2 }, 1000, null, 1000);
            m.NoteOwnWindup(1000, 0, (byte)WeaponId.Sword);
            Assert.AreEqual(0, m.AttackPauseWindows, "a zero wait is a swing that lands at once: nothing to pause");
            m.PredictAttackPause = false;
            m.NoteOwnWindup(1000, 450, (byte)WeaponId.Wand);
            Assert.AreEqual(0, m.AttackPauseWindows, "switched off");
            m.PredictAttackPause = true;
            m.NoteOwnWindup(1000, 450, (byte)WeaponId.Wand);
            Assert.AreEqual(1, m.AttackPauseWindows);
            m.OnSnapshot(new WireSelf { Id = Me, X = 100, Y = 100, Hp = 0, MaxHp = 1, Status = 0, Weapon = 2 }, 1050, null, 1050);
            Assert.AreEqual(0, m.AttackPauseWindows, "death clears it");
            m.NoteOwnWindup(1050, 450, (byte)WeaponId.Wand);
            m.Clear();
            Assert.AreEqual(0, m.AttackPauseWindows, "a cleared self holds no pause");
        }

        [Test]
        public void AStunInTheSelfBlockEndsThePause()
        {
            var m = new LocalMotion(Map());
            Func<ushort, WireSelf> self = e => new WireSelf { Id = Me, X = 100, Y = 100, Hp = 1, MaxHp = 1, Status = 1, Weapon = 2, Effects = e };
            m.OnSnapshot(self(0), 1000, null, 1000);
            m.NoteOwnWindup(1000, 450, (byte)WeaponId.Wand);   // lands 1450: the steps ending 1250..1400 are stopped
            Assert.IsTrue(m.AttackPauseStops(1250));
            Assert.IsTrue(m.AttackPauseStops(1400));
            m.OnSnapshot(self(1), 1300, null, 1300);            // stunned at tick 1300: the step ending 1300 and later walk
            Assert.IsTrue(m.AttackPauseStops(1250));
            Assert.IsFalse(m.AttackPauseStops(1300));
            Assert.IsFalse(m.AttackPauseStops(1400));
        }

        // ----------------------------------------------------------------------------------------------------------------
        // Through the session with link latency: what the player sees

        [TestCase("wand-single-shot", 0.0)]
        [TestCase("wand-single-shot", 50.0)]
        [TestCase("wand-single-shot", 100.0)]
        [TestCase("wand-single-shot", 150.0)]
        [TestCase("wand-held", 0.0)]
        [TestCase("wand-held", 50.0)]
        [TestCase("wand-held", 100.0)]
        [TestCase("wand-held", 150.0)]
        [TestCase("wand-rejected-cooldown", 100.0)]
        public void AWalkingWandShotIsNotPulledBack(string name, double rtt)
        {
            var on = Replay(name, rtt / 2, rtt / 2, true);
            var off = Replay(name, rtt / 2, rtt / 2, false);
            TestContext.Progress.WriteLine(name + " rtt " + rtt + ": drawn vs the server timeline max " + on.MaxOnTickError.ToString("F3") + " u with the mirror, "
                + off.MaxOnTickError.ToString("F2") + " u without; model-vs-server " + on.ReconMaxErr.ToString("F2") + " vs " + off.ReconMaxErr.ToString("F2"));
            Assert.LessOrEqual(on.MaxOnTickError, LeadTolerance, name + ": with the mirror the drawn walk is the server's");
            Assert.AreEqual(0, on.Snaps, "never snaps");
            Assert.Less(on.ReconMaxErr, LocalMotion.ReconCorrectionU, "the server never has to correct the model");
            // The control: the same replay without the mirror shows the old error, so the test proves something.
            Assert.GreaterOrEqual(off.MaxOnTickError, 2 * TickWalk, name + ": without the mirror the walk is drawn through the pause (" + off.MaxOnTickError.ToString("F1") + " u)");
            Assert.GreaterOrEqual(off.ReconMaxErr, TickWalk - 0.01, "and the server pulls it back every tick");
            Assert.Greater(on.PausedTicks, 0);
        }

        [Test]
        public void AVerySlowLinkStillBeatsNoMirror()
        {
            // At 250 ms RTT the first part of the pause is learned after the model has already walked into it; the mirror still
            // removes most of the error and never snaps.
            var on = Replay("wand-single-shot", 125, 125, true);
            var off = Replay("wand-single-shot", 125, 125, false);
            Assert.Less(on.MaxOnTickError, LocalMotion.DivergeErr);
            Assert.Less(on.MaxOnTickError, off.MaxOnTickError / 4);
            Assert.AreEqual(0, on.Snaps);
        }

        [TestCase("wand-staggered-in-pause", 0.0)]
        [TestCase("wand-staggered-in-pause", 50.0)]
        [TestCase("wand-staggered-in-pause", 100.0)]
        [TestCase("wand-staggered-in-pause", 150.0)]
        [TestCase("wand-weapon-swap", 0.0)]
        [TestCase("wand-weapon-swap", 50.0)]
        [TestCase("wand-weapon-swap", 100.0)]
        [TestCase("wand-weapon-swap", 150.0)]
        public void ACancelInsideThePauseEndsItAtTheCancel(string name, double rtt)
        {
            var on = Replay(name, rtt / 2, rtt / 2, true);
            var off = Replay(name, rtt / 2, rtt / 2, false);
            TestContext.Progress.WriteLine(name + " rtt " + rtt + ": " + on.MaxOnTickError.ToString("F2") + " u with the mirror, " + off.MaxOnTickError.ToString("F2") + " without");
            Assert.LessOrEqual(on.MaxOnTickError, off.MaxOnTickError + 0.05, "the mirror is never worse than the unpredicted walk");
            Assert.LessOrEqual(on.MaxOnTickError, 2 * TickWalk + 0.01, "at most two steps of the pause survive the cancel's trip");
            Assert.AreEqual(0, on.Snaps);
        }

        [TestCase("wand-staggered", 0.0)]
        [TestCase("wand-staggered", 50.0)]
        public void ACancelBeforeThePauseLeavesTheWalkAloneWhenTheFactIsFastEnough(string name, double rtt)
        {
            var on = Replay(name, rtt / 2, rtt / 2, true);
            Assert.LessOrEqual(on.MaxOnTickError, LocalMotion.ReconCorrectionU + 1.0, name + " rtt " + rtt + ": " + on.MaxOnTickError.ToString("F2"));
            Assert.AreEqual(0, on.Snaps);
        }

        [TestCase("wand-staggered", 100.0)]
        [TestCase("wand-staggered", 150.0)]
        public void ACancelThatArrivesAfterTheModelPausedCostsAtMostThePauseAndNeverSnaps(string name, double rtt)
        {
            // The documented price of predicting from the announcement: when the cancelling fact is slower than the model's lead the
            // model stands still for the part of the pause it had already reached, then walks on. The error is bounded by the
            // pause (4 steps) and is spread by the correction, never a snap.
            var on = Replay(name, rtt / 2, rtt / 2, true);
            TestContext.Progress.WriteLine(name + " rtt " + rtt + ": " + on.MaxOnTickError.ToString("F2") + " u");
            Assert.LessOrEqual(on.MaxOnTickError, 4 * TickWalk + 0.01);
            Assert.AreEqual(0, on.Snaps);
        }

        [Test]
        public void ASwordSwingHasNoWindUpSoNothingChanges()
        {
            foreach (var rtt in new[] { 0.0, 100.0 })
            {
                var on = Replay("sword-swing", rtt / 2, rtt / 2, true);
                Assert.LessOrEqual(on.MaxOnTickError, LeadTolerance);
                Assert.AreEqual(0, on.PausedTicks);
            }
        }

        [TestCase("bow-single-shot", 0.0)]
        [TestCase("bow-single-shot", 50.0)]
        [TestCase("bow-single-shot", 100.0)]
        [TestCase("bow-single-shot", 150.0)]
        [TestCase("bow-held", 0.0)]
        [TestCase("bow-held", 100.0)]
        [TestCase("bow-held", 150.0)]
        [TestCase("bow-holy-faction", 50.0)]
        [TestCase("bow-frost-faction", 50.0)]
        [TestCase("bow-frost-faction", 150.0)]
        [TestCase("bow-staggered-mid-draw", 100.0)]
        [TestCase("bow-rejected-cooldown", 100.0)]
        public void AWalkingBowShotIsNotPulledBack(string name, double rtt)
        {
            var on = Replay(name, rtt / 2, rtt / 2, true);
            var off = Replay(name, rtt / 2, rtt / 2, false);
            TestContext.Progress.WriteLine(name + " rtt " + rtt + ": " + on.MaxOnTickError.ToString("F3") + " u with the mirror, " + off.MaxOnTickError.ToString("F2")
                + " without; model-vs-server " + on.ReconMaxErr.ToString("F2") + " vs " + off.ReconMaxErr.ToString("F2"));
            Assert.LessOrEqual(on.MaxOnTickError, LeadTolerance, name);
            Assert.AreEqual(0, on.Snaps);
            Assert.Less(on.ReconMaxErr, LocalMotion.ReconCorrectionU);
            Assert.GreaterOrEqual(off.MaxOnTickError, 2 * TickWalk, name + ": the control shows the old error");
            Assert.GreaterOrEqual(off.ReconMaxErr, TickWalk - 0.01);
        }

        [TestCase("bow-plague-faction", 0.0)]
        [TestCase("bow-plague-faction", 50.0)]
        public void ADrawShorterThanTheLinkIsLearnedLateButStillHelps(string name, double rtt)
        {
            // A 277 ms interval: the whole 152 ms draw is a pause, and it is learned when the first snapshot of the draw arrives.
            var on = Replay(name, rtt / 2, rtt / 2, true);
            var off = Replay(name, rtt / 2, rtt / 2, false);
            TestContext.Progress.WriteLine(name + " rtt " + rtt + ": " + on.MaxOnTickError.ToString("F3") + " u with the mirror, " + off.MaxOnTickError.ToString("F2") + " without");
            Assert.LessOrEqual(on.MaxOnTickError, off.MaxOnTickError + 0.05);
            Assert.AreEqual(0, on.Snaps);
        }

        [TestCase("bow-weapon-swap-mid-draw", 0.0)]
        [TestCase("bow-weapon-swap-mid-draw", 50.0)]
        [TestCase("bow-weapon-swap-mid-draw", 100.0)]
        [TestCase("bow-weapon-swap-early-draw", 0.0)]
        [TestCase("bow-weapon-swap-early-draw", 50.0)]
        [TestCase("bow-weapon-swap-early-draw", 100.0)]
        public void ASwapDuringADrawEndsItsPauseAtTheSwap(string name, double rtt)
        {
            var on = Replay(name, rtt / 2, rtt / 2, true);
            var off = Replay(name, rtt / 2, rtt / 2, false);
            TestContext.Progress.WriteLine(name + " rtt " + rtt + ": " + on.MaxOnTickError.ToString("F2") + " u with the mirror, " + off.MaxOnTickError.ToString("F2") + " without");
            // The swap fact is slower than the model's lead once the link is slow: the model has paused for the part of the pause
            // it had reached (the documented price of predicting from the draw). Bounded by the pause, never a snap.
            if (rtt <= 50) Assert.LessOrEqual(on.MaxOnTickError, off.MaxOnTickError + 0.05, "not worse than the unpredicted walk on a fast link");
            Assert.LessOrEqual(on.MaxOnTickError, 4 * TickWalk + 0.01);
            Assert.AreEqual(0, on.Snaps);
        }

        [Test, Explicit("prints the measurement table")]
        public void Report()
        {
            foreach (var name in AllCases)
                foreach (var rtt in new[] { 0.0, 50.0, 100.0, 150.0, 250.0 })
                {
                    var on = Replay(name, rtt / 2, rtt / 2, true);
                    var off = Replay(name, rtt / 2, rtt / 2, false);
                    TestContext.Progress.WriteLine(name.PadRight(26) + " rtt " + rtt.ToString("F0").PadLeft(3) + " paused " + on.PausedTicks + " windup " + on.WindupFx
                        + " | on: tick " + on.MaxOnTickError.ToString("F3") + " recon " + on.ReconMaxErr.ToString("F2") + " snaps " + on.Snaps
                        + " | off: tick " + off.MaxOnTickError.ToString("F3") + " recon " + off.ReconMaxErr.ToString("F2"));
                }
        }
    }
}

using System;
using System.Globalization;
using System.IO;
using System.Linq;
using System.Text.Json;
using NUnit.Framework;
using Roguehalla.Net.Protocol;
using Client = Roguehalla.Net.Protocol.SceneCandidateClient14;

namespace Roguehalla.Net.Tests
{
    public class SceneCandidateClient14Tests
    {
        static JsonDocument Fixture(string name = "client14.json")
        {
            return JsonDocument.Parse(File.ReadAllText(Path.Combine(
                Util.RepoRoot(), "protocol", "fixtures", "scene-candidate", name)));
        }

        static byte[] Hex(string value)
        {
            var bytes = new byte[value.Length / 2];
            for (int i = 0; i < bytes.Length; i++)
                bytes[i] = Convert.ToByte(value.Substring(i * 2, 2), 16);
            return bytes;
        }

        static ulong U64(JsonElement value)
        {
            return ulong.Parse(value.GetString(), CultureInfo.InvariantCulture);
        }

        static SceneCandidate.Limits Limits(JsonElement document)
        {
            return LimitsObject(document.GetProperty("limits"));
        }

        static SceneCandidate.Limits LimitsObject(JsonElement l)
        {
            return new SceneCandidate.Limits(l.GetProperty("bodyBytes").GetInt32(),
                l.GetProperty("partBytes").GetInt32(), l.GetProperty("parts").GetInt32(),
                l.GetProperty("frames").GetInt32(), l.GetProperty("frameBytes").GetInt32(),
                l.GetProperty("retainedBodyBytes").GetInt32());
        }

        static Client NewClient(JsonElement document)
        {
            return new Client(U64(document.GetProperty("generation")),
                U64(document.GetProperty("epoch")), Limits(document));
        }

        static Exception Refuses(Action action)
        {
            try { action(); }
            catch (Exception error) { return error; }
            Assert.Fail("Expected refusal");
            return null;
        }

        static Client.Candidate Deliver(Client client, JsonElement scene)
        {
            var records = scene.GetProperty("recordsHex").EnumerateArray().ToArray();
            var old = client.Current;
            Client.Candidate candidate = null;
            for (int i = 0; i < records.Length; i++)
            {
                byte[] wire = Hex(records[i].GetString());
                candidate = client.Push(client.Generation, wire);
                Array.Clear(wire, 0, wire.Length); // Transport buffer reuse cannot alter staging.
                Assert.AreSame(old, client.Current);
                if (i != records.Length - 1) Assert.IsNull(candidate);
            }
            Assert.IsNotNull(candidate);
            CollectionAssert.AreEqual(Hex(scene.GetProperty("bodyHex").GetString()), candidate.BodyCopy());
            MatchMessages(candidate, scene);
            return candidate;
        }

        static void MatchMessages(Client.Candidate candidate, JsonElement scene)
        {
            var meta = scene.GetProperty("meta");
            Assert.AreEqual(U64(meta.GetProperty("epoch")), candidate.Metadata.Epoch);
            Assert.AreEqual(U64(meta.GetProperty("scene")), candidate.Metadata.Scene);
            Assert.AreEqual(U64(meta.GetProperty("cueFrom")), candidate.Metadata.CueFrom);
            Assert.AreEqual(U64(meta.GetProperty("cueThrough")), candidate.Metadata.CueThrough);
            Assert.AreEqual(meta.GetProperty("tick").GetUInt32(), candidate.Metadata.Tick);
            if (meta.TryGetProperty("sourceTimeBits", out var timeBits))
                Assert.AreEqual(timeBits.GetString(), Bits(candidate.Metadata.SourceTime));
            if (meta.TryGetProperty("sourceTime", out var time))
                Assert.AreEqual(BitConverter.DoubleToInt64Bits(time.GetDouble()),
                    BitConverter.DoubleToInt64Bits(candidate.Metadata.SourceTime));
            var expected = scene.GetProperty("inner14Hex").EnumerateArray().ToArray();
            var messages = candidate.MessagesCopy();
            Assert.AreEqual(expected.Length, messages.Length);
            for (int i = 0; i < messages.Length; i++)
                CollectionAssert.AreEqual(Hex(expected[i].GetString()), messages[i].Encode());
            var snapshot = (ServerMsg.Snapshot)messages[0];
            var state = (ServerMsg.State)messages[1];
            Assert.AreEqual(candidate.Metadata.Tick, snapshot.Tick);
            Assert.AreEqual(BitConverter.DoubleToInt64Bits(candidate.Metadata.SourceTime),
                BitConverter.DoubleToInt64Bits(snapshot.ServerMs));
            CollectionAssert.AreEqual(Enumerable.Range(1, 11).Select(i => (uint)i),
                state.Items.Select(item => item.Key));
            if (scene.TryGetProperty("publicData", out var projection))
                MatchPublicData(messages, projection, candidate.Metadata);
        }

        static string Bits(double value)
        {
            return unchecked((ulong)BitConverter.DoubleToInt64Bits(value))
                .ToString("x16", CultureInfo.InvariantCulture);
        }

        static string Bits(float value)
        {
            return unchecked((uint)BitConverter.SingleToInt32Bits(value))
                .ToString("x8", CultureInfo.InvariantCulture);
        }

        static string Id(uint? value)
        {
            return value.HasValue ? value.Value.ToString(CultureInfo.InvariantCulture) : null;
        }

        static string FxName(FxKind kind)
        {
            switch (kind)
            {
                case FxKind.Block: return "block";
                case FxKind.Stagger: return "stagger";
                case FxKind.Swing: return "swing";
                case FxKind.Hit: return "hit";
                case FxKind.Teleport: return "teleport";
                case FxKind.WishStarted: return "wishStarted";
                case FxKind.WishLanded: return "wishLanded";
                case FxKind.WishEnded: return "wishEnded";
                default: throw new InvalidDataException("unknown decoded FX");
            }
        }

        static void MatchPublicData(ServerMsg[] messages, JsonElement projection, SceneCandidate.Meta metadata)
        {
            var frames = projection.GetProperty("frames").EnumerateArray().ToArray();
            Assert.AreEqual(frames.Length, messages.Length);
            long occurrences = 0;
            for (int i = 0; i < frames.Length; i++)
            {
                var frame = frames[i];
                string kind = frame.GetProperty("kind").GetString();
                if (messages[i] is ServerMsg.Snapshot snapshot)
                {
                    Assert.AreEqual("snapshot", kind);
                    Assert.AreEqual(frame.GetProperty("tick").GetUInt32(), snapshot.Tick);
                    Assert.AreEqual(frame.GetProperty("serverTimeBits").GetString(), Bits(snapshot.ServerMs));
                    Assert.AreEqual(frame.GetProperty("selfId").GetString(), Id(snapshot.Me?.Id));
                    Assert.AreEqual(frame.GetProperty("selfHpBits").GetString(),
                        snapshot.Me == null ? null : Bits(snapshot.Me.Hp));
                    Assert.AreEqual(frame.GetProperty("training").GetBoolean(), snapshot.Training);
                    CollectionAssert.AreEqual(frame.GetProperty("actorIds").EnumerateArray().Select(v => v.GetString()),
                        snapshot.Actors.Select(actor => Id(actor.Id)));
                    var owner = frame.GetProperty("ownerCombat");
                    if (owner.ValueKind == JsonValueKind.Null) Assert.IsNull(snapshot.OwnerCombat);
                    else
                    {
                        Assert.IsNotNull(snapshot.OwnerCombat);
                        var combat = snapshot.OwnerCombat;
                        Assert.AreEqual(owner.GetProperty("lock").GetString(),
                            combat.Lock.Kind == WireOwnerLockKind.Clear ? "clear" : "held");
                        Assert.AreEqual(owner.GetProperty("targetId").GetString(), Id(combat.Lock.Target));
                        Assert.AreEqual(owner.GetProperty("drawStartedAt").GetUInt32(), combat.DrawStartedAt);
                        Assert.AreEqual(owner.GetProperty("readyAt").GetUInt32(), combat.ReadyAt);
                        Assert.AreEqual(owner.GetProperty("asMilliBits").GetString(), Bits(combat.AsMilli));
                        Assert.AreEqual(owner.GetProperty("windupMilliBits").GetString(), Bits(combat.WindupMilli));
                        Assert.AreEqual(owner.GetProperty("speedMilliBits").GetString(), Bits(combat.SpeedMilli));
                    }
                }
                else if (messages[i] is ServerMsg.State state)
                {
                    Assert.AreEqual("state", kind);
                    Assert.AreEqual(frame.GetProperty("tick").GetUInt32(), state.Tick);
                    var groups = frame.GetProperty("groups").EnumerateArray().ToArray();
                    Assert.AreEqual(11, groups.Length);
                    for (int group = 0; group < groups.Length; group++)
                    {
                        Assert.AreEqual(groups[group].GetProperty("key").GetUInt32(), state.Items[group].Key);
                        MatchGroup(state.Items[group], groups[group]);
                    }
                }
                else if (messages[i] is ServerMsg.Events events)
                {
                    Assert.AreEqual("events", kind);
                    Assert.AreEqual(frame.GetProperty("tick").GetUInt32(), events.Tick);
                    Assert.AreEqual(frame.GetProperty("count").GetInt32(), events.List.Count);
                    occurrences += events.List.Count;
                }
                else if (messages[i] is ServerMsg.Fx fx)
                {
                    Assert.AreEqual("fx", kind);
                    Assert.AreEqual(frame.GetProperty("tick").GetUInt32(), fx.Tick);
                    Assert.AreEqual(frame.GetProperty("count").GetInt32(), fx.List.Count);
                    CollectionAssert.AreEqual(frame.GetProperty("kinds").EnumerateArray().Select(v => v.GetString()),
                        fx.List.Select(value => FxName(value.Kind)));
                    occurrences += fx.List.Count;
                }
                else Assert.Fail("Unsupported projected frame");
            }
            Assert.AreEqual(projection.GetProperty("cueOccurrences").GetInt64(), occurrences);
            Assert.AreEqual(metadata.CueThrough - metadata.CueFrom, (ulong)occurrences);
            var batches = projection.GetProperty("cueBatches").EnumerateArray().ToArray();
            Assert.AreEqual(messages.Length - 2, batches.Length);
            for (int i = 0; i < batches.Length; i++)
            {
                var batch = batches[i];
                var message = messages[i + 2];
                if (message is ServerMsg.Events events)
                {
                    Assert.AreEqual("events", batch.GetProperty("kind").GetString());
                    Assert.AreEqual(events.Tick, batch.GetProperty("tick").GetUInt32());
                    Assert.AreEqual(events.List.Count, batch.GetProperty("count").GetInt32());
                }
                else
                {
                    var fx = (ServerMsg.Fx)message;
                    Assert.AreEqual("fx", batch.GetProperty("kind").GetString());
                    Assert.AreEqual(fx.Tick, batch.GetProperty("tick").GetUInt32());
                    Assert.AreEqual(fx.List.Count, batch.GetProperty("count").GetInt32());
                }
                CollectionAssert.AreEqual(Hex(batch.GetProperty("hex").GetString()), message.Encode());
            }
        }

        static void MatchGroup(StateItem item, JsonElement group)
        {
            string name = ((StateKey)item.Key).ToString();
            name = char.ToLowerInvariant(name[0]) + name.Substring(1);
            Assert.AreEqual(group.GetProperty("group").GetString(), name);
            if (group.TryGetProperty("focus", out var focus))
                Assert.AreEqual(focus.GetBoolean(), ((PropsState)item).Focus.HasValue);
            if (group.TryGetProperty("available", out var available))
            {
                bool actual;
                switch (item)
                {
                    case InventoryState inventory: actual = inventory.Value.HasValue; break;
                    case BuildState build: actual = build.Value.HasValue; break;
                    case PlanState plan: actual = plan.Value != null; break;
                    case ArenaState arena: actual = arena.Value.HasValue; break;
                    case QuestsState quests: actual = quests.Available; break;
                    case TradeState trade: actual = trade.Available; break;
                    default: throw new InvalidDataException("unexpected availability projection");
                }
                Assert.AreEqual(available.GetBoolean(), actual);
            }
            if (group.TryGetProperty("rows", out var rows))
            {
                int count;
                switch (item)
                {
                    case PropsState props: count = props.Rows.Length; break;
                    case FieldsState fields: count = fields.Rows.Length; break;
                    case RewardChestsState chests: count = chests.Rows.Length; break;
                    case CampsState camps: count = camps.Rows.Length; break;
                    case ProjectilesState projectiles: count = projectiles.Rows.Length; break;
                    case QuestsState quests: count = quests.Available ? quests.View.Rows.Length : 0; break;
                    default: throw new InvalidDataException("unexpected row projection");
                }
                Assert.AreEqual(rows.GetInt32(), count);
            }
            if (group.TryGetProperty("roster", out var roster))
            {
                var quests = (QuestsState)item;
                Assert.AreEqual(roster.GetInt32(), quests.Available ? quests.View.Roster.Length : 0);
            }
            if (group.TryGetProperty("objectives", out var objectives))
            {
                var quests = (QuestsState)item;
                Assert.AreEqual(objectives.GetInt32(), quests.Available ? quests.View.Objectives.Length : 0);
            }
            if (group.TryGetProperty("offers", out var offers))
            {
                var trade = (TradeState)item;
                Assert.AreEqual(offers.GetInt32(), trade.Available ? trade.Value.Offers.Length : 0);
            }
            if (group.TryGetProperty("stats", out var stats))
            {
                var trade = (TradeState)item;
                Assert.AreEqual(stats.GetInt32(), trade.Available ? trade.Value.Stats.Length : 0);
            }
            if (group.TryGetProperty("merchants", out var merchants))
            {
                var trade = (TradeState)item;
                Assert.AreEqual(merchants.GetInt32(), trade.Available ? trade.Value.Merchants.Length : 0);
            }
        }

        static void MutateCopyOut(Client.Candidate candidate)
        {
            byte[] bytes = candidate.BodyCopy();
            Array.Clear(bytes, 0, bytes.Length);
            var messages = candidate.MessagesCopy();
            var snapshot = (ServerMsg.Snapshot)messages[0];
            if (snapshot.Me != null) snapshot.Me.Hp = -123;
            if (snapshot.OwnerCombat != null) snapshot.OwnerCombat.AsMilli = -123;
            if (snapshot.Actors.Length > 0) snapshot.Actors[0].Id = uint.MaxValue;
            var state = (ServerMsg.State)messages[1];
            var build = ((BuildState)state.Items[4]).Value;
            if (build.HasValue && build.Value.Cards.Length > 0) build.Value.Cards[0] ^= 1;
            var quests = (QuestsState)state.Items[9];
            if (quests.Available && quests.View.Rows.Length > 0)
            {
                quests.View.Rows[0].Def = "caller mutation";
                if (quests.View.Rows[0].Participants.Length > 0)
                    quests.View.Rows[0].Participants[0].Progress = uint.MaxValue;
            }
            foreach (var message in messages.Skip(2))
            {
                if (message is ServerMsg.Fx fx)
                {
                    if (fx.List.Count > 0) fx.List[0].Amount = -123;
                    fx.List.Clear();
                }
                else if (message is ServerMsg.Events events) events.List.Clear();
            }
            state.Items[0] = null;
        }

        [Test]
        public void RustScenesStageOwnedDataThenExplicitlyCommitAndEncodeExactAck()
        {
            using (var fixture = Fixture())
            {
                var root = fixture.RootElement;
                Assert.AreEqual(14, root.GetProperty("protocol").GetInt32());
                var client = NewClient(root);
                Client.AppliedReceipt previous = null;
                byte[] previousAck = null;
                long charged = 0;
                foreach (var scene in root.GetProperty("scenes").EnumerateArray())
                {
                    Assert.IsTrue(scene.TryGetProperty("publicData", out _), "actual Rust projection is required");
                    var old = client.Current;
                    var candidate = Deliver(client, scene);
                    charged += Hex(scene.GetProperty("bodyHex").GetString()).Length;
                    Assert.AreEqual(charged, client.OwnedBodyBytes);
                    Assert.AreSame(old, client.Current);
                    Refuses(() => client.EncodeAck(client.Generation, null));
                    if (previous != null)
                        CollectionAssert.AreEqual(previousAck, client.EncodeAck(client.Generation, previous));
                    MutateCopyOut(candidate);
                    MatchMessages(candidate, scene);
                    var receipt = client.CommitApplied(client.Generation, candidate);
                    Assert.AreSame(candidate, client.Current);
                    var ack = client.EncodeAck(client.Generation, receipt);
                    Assert.AreEqual(34, ack.Length);
                    CollectionAssert.AreEqual(Hex(scene.GetProperty("ackHex").GetString()), ack);
                    Array.Clear(ack, 0, ack.Length);
                    CollectionAssert.AreEqual(Hex(scene.GetProperty("ackHex").GetString()),
                        client.EncodeAck(client.Generation, receipt));
                    if (previous != null) Refuses(() => client.EncodeAck(client.Generation, previous));
                    Assert.IsFalse(client.Closed);
                    previous = receipt;
                    previousAck = Hex(scene.GetProperty("ackHex").GetString());
                }
                var held = client.Current;
                byte[] heldBody = held.BodyCopy();
                client.Close();
                Assert.AreSame(held, client.Current);
                CollectionAssert.AreEqual(heldBody, held.BodyCopy());
                Assert.IsNotEmpty(held.MessagesCopy());
                Refuses(() => client.EncodeAck(client.Generation, previous));
            }
        }

        [Test]
        public void AllEightExistingNativeAndDeclaredShapesSurviveFreshTrackerAndCollections()
        {
            using (var fixture = Fixture("full14.json"))
            {
                var root = fixture.RootElement;
                var cases = root.GetProperty("cases").EnumerateArray().ToArray();
                Assert.AreEqual(8, cases.Length);
                foreach (var scene in cases)
                {
                    ulong epoch = U64(scene.GetProperty("meta").GetProperty("epoch"));
                    var client = new Client(1, epoch, Limits(root));
                    var candidate = Deliver(client, scene);
                    MutateCopyOut(candidate);
                    MatchMessages(candidate, scene);
                    var messages = candidate.MessagesCopy();
                    var snapshot = (ServerMsg.Snapshot)messages[0];
                    var state = (ServerMsg.State)messages[1];
                    string name = scene.GetProperty("name").GetString();
                    if (name == "synthetic-available-empty")
                    {
                        Assert.IsTrue(((QuestsState)state.Items[9]).Available);
                        Assert.IsTrue(((TradeState)state.Items[10]).Available);
                    }
                    if (name == "synthetic-redacted-owner-lock")
                    {
                        Assert.AreEqual(WireOwnerLockKind.Held, snapshot.OwnerCombat.Lock.Kind);
                        Assert.IsNull(snapshot.OwnerCombat.Lock.Target);
                    }
                    if (name == "synthetic-clear-mirror-range")
                    {
                        Assert.AreEqual(WireOwnerLockKind.Clear, snapshot.OwnerCombat.Lock.Kind);
                        Assert.AreEqual(BitConverter.DoubleToInt64Bits(double.MaxValue),
                            BitConverter.DoubleToInt64Bits(snapshot.OwnerCombat.AsMilli));
                    }
                    if (name == "native-training-currentref-rack")
                    {
                        Assert.IsTrue(snapshot.Training);
                        Assert.IsTrue(snapshot.OwnerCombat.Lock.Target.HasValue);
                        Assert.IsTrue(snapshot.Actors.Any(actor => actor.Id == snapshot.OwnerCombat.Lock.Target.Value));
                    }
                    client.CommitApplied(1, candidate);
                    Assert.AreSame(candidate, client.Current);
                    client.Close();
                }
            }
        }

        [Test]
        public void RustNegativeTransactionsCloseWithoutChangingAppliedViewOrCursors()
        {
            using (var fixture = Fixture())
            {
                var root = fixture.RootElement;
                var first = root.GetProperty("scenes")[0];
                foreach (var negative in root.GetProperty("negatives").EnumerateArray())
                {
                    var client = negative.TryGetProperty("limitsOverride", out var customLimits)
                        ? new Client(U64(root.GetProperty("generation")), U64(root.GetProperty("epoch")),
                            LimitsObject(customLimits))
                        : NewClient(root);
                    var held = Deliver(client, first);
                    var receipt = client.CommitApplied(client.Generation, held);
                    byte[] oldBody = held.BodyCopy();
                    var oldMeta = held.Metadata;
                    var records = negative.GetProperty("recordsHex").EnumerateArray().ToArray();
                    int rejectAt = negative.GetProperty("rejectAt").GetInt32();
                    for (int i = 0; i < rejectAt; i++)
                    {
                        Assert.IsNull(client.Push(client.Generation, Hex(records[i].GetString())));
                        Assert.AreSame(held, client.Current);
                    }
                    Refuses(() => client.Push(client.Generation, Hex(records[rejectAt].GetString())));
                    Assert.IsTrue(client.Closed, negative.GetProperty("name").GetString());
                    Assert.AreSame(held, client.Current);
                    CollectionAssert.AreEqual(oldBody, held.BodyCopy());
                    Assert.AreEqual(oldMeta.Scene, client.Current.Metadata.Scene);
                    Assert.AreEqual(oldMeta.CueThrough, client.Current.Metadata.CueThrough);
                    Assert.AreEqual(BitConverter.DoubleToInt64Bits(oldMeta.SourceTime),
                        BitConverter.DoubleToInt64Bits(client.Current.Metadata.SourceTime));
                    Refuses(() => client.EncodeAck(client.Generation, receipt));
                    Refuses(() => client.Push(client.Generation, Hex(first.GetProperty("recordsHex")[0].GetString())));
                }
            }
        }

        [Test]
        public void GenerationAndForeignOpaqueTokensCannotMutateAnotherContext()
        {
            using (var fixture = Fixture())
            {
                var root = fixture.RootElement;
                var first = root.GetProperty("scenes")[0];
                var a = NewClient(root);
                var b = NewClient(root); // Same numeric generation/epoch still require exact owner identity.
                var ca = Deliver(a, first);
                var cb = Deliver(b, first);
                ulong wrong = a.Generation == ulong.MaxValue ? a.Generation - 1 : a.Generation + 1;
                long owned = a.OwnedBodyBytes;
                Refuses(() => a.Push(wrong, Array.Empty<byte>()));
                Refuses(() => a.CommitApplied(wrong, ca));
                Refuses(() => a.Refuse(wrong, ca));
                Refuses(() => b.CommitApplied(b.Generation, ca));
                Refuses(() => b.Refuse(b.Generation, ca));
                Assert.IsFalse(a.Closed);
                Assert.IsFalse(b.Closed);
                Assert.IsNull(a.Current);
                Assert.IsNull(b.Current);
                Assert.AreEqual(owned, a.OwnedBodyBytes);
                var ra = a.CommitApplied(a.Generation, ca);
                var rb = b.CommitApplied(b.Generation, cb);
                Refuses(() => b.EncodeAck(b.Generation, ra));
                Refuses(() => a.EncodeAck(wrong, ra));
                Refuses(() => a.CommitApplied(a.Generation, ca));
                Refuses(() => a.Refuse(a.Generation, ca));
                Assert.AreSame(ca, a.Current);
                Assert.AreSame(cb, b.Current);
                Assert.IsFalse(a.Closed);
                Assert.IsFalse(b.Closed);
                CollectionAssert.AreEqual(Hex(first.GetProperty("ackHex").GetString()), b.EncodeAck(b.Generation, rb));
                a.Close();
                Refuses(() => a.CommitApplied(a.Generation, ca));
                Refuses(() => a.Refuse(a.Generation, ca));
                Refuses(() => a.EncodeAck(a.Generation, ra));
                Assert.AreSame(ca, a.Current);
                Assert.IsFalse(b.Closed);
                a.Close();
                b.Close();
            }
        }

        [Test]
        public void PendingRefusalAndSuccessorWireClosePreservePreviousApplication()
        {
            using (var fixture = Fixture())
            {
                var root = fixture.RootElement;
                var first = root.GetProperty("scenes")[0];
                var second = root.GetProperty("scenes")[1];
                foreach (bool refuse in new[] { false, true })
                {
                    var client = NewClient(root);
                    var old = Deliver(client, first);
                    client.CommitApplied(client.Generation, old);
                    var pending = Deliver(client, second);
                    long owned = client.OwnedBodyBytes;
                    Refuses(() => client.Refuse(client.Generation, old));
                    Assert.IsFalse(client.Closed);
                    if (refuse) client.Refuse(client.Generation, pending);
                    else Refuses(() => client.Push(client.Generation,
                        Hex(second.GetProperty("recordsHex")[0].GetString())));
                    Assert.IsTrue(client.Closed);
                    Assert.AreSame(old, client.Current);
                    Assert.AreEqual(owned, client.OwnedBodyBytes, "complete DATA charges are not refunded");
                    Refuses(() => client.CommitApplied(client.Generation, pending));
                    MatchMessages(old, first);
                }
            }
        }

        [Test]
        public void CumulativeBudgetRefusesNextBodyAndCloseRefundsOnlyUnfinishedAssembly()
        {
            using (var fixture = Fixture())
            {
                var root = fixture.RootElement;
                var first = root.GetProperty("scenes")[0];
                var second = root.GetProperty("scenes")[1];
                int firstSize = Hex(first.GetProperty("bodyHex").GetString()).Length;
                int secondSize = Hex(second.GetProperty("bodyHex").GetString()).Length;
                var l = Limits(root);
                var bounded = new SceneCandidate.Limits(Math.Max(firstSize, secondSize),
                    l.PartBytes, l.Parts, l.Frames, l.FrameBytes, firstSize + secondSize - 1);
                var client = new Client(U64(root.GetProperty("generation")), U64(root.GetProperty("epoch")), bounded);
                var old = Deliver(client, first);
                client.CommitApplied(client.Generation, old);
                Refuses(() => client.Push(client.Generation, Hex(second.GetProperty("recordsHex")[0].GetString())));
                Assert.IsTrue(client.Closed);
                Assert.AreSame(old, client.Current);
                Assert.AreEqual(firstSize, client.OwnedBodyBytes);

                client = NewClient(root);
                old = Deliver(client, first);
                client.CommitApplied(client.Generation, old);
                Assert.IsNull(client.Push(client.Generation, Hex(second.GetProperty("recordsHex")[0].GetString())));
                Assert.AreEqual(firstSize + secondSize, client.OwnedBodyBytes);
                client.Close();
                Assert.AreSame(old, client.Current);
                Assert.AreEqual(firstSize, client.OwnedBodyBytes);
            }
        }

        [Test]
        public void ConstructorRequiresGenerationAndEpochButAllowsMaximumLocalGeneration()
        {
            using (var fixture = Fixture("full14.json"))
            {
                var root = fixture.RootElement;
                ulong epoch = U64(root.GetProperty("cases")[0].GetProperty("meta").GetProperty("epoch"));
                var limits = Limits(root);
                Assert.IsInstanceOf<ArgumentOutOfRangeException>(Refuses(() => new Client(0, epoch, limits)));
                Refuses(() => new Client(1, 0, limits));
                Refuses(() => new Client(1, ulong.MaxValue, limits));
                Refuses(() => new Client(1, epoch, default(SceneCandidate.Limits)));
                var max = new Client(ulong.MaxValue, epoch, limits);
                Assert.AreEqual(ulong.MaxValue, max.Generation);
                Assert.AreEqual(epoch, max.Epoch);
                Assert.IsNull(max.Current);
                Assert.AreEqual(0, max.OwnedBodyBytes);
                max.Close();
            }
        }
    }
}

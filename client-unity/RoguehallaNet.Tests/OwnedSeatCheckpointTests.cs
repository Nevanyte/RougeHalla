using System;
using System.Linq;
using System.Text;
using System.Threading;
using System.Threading.Tasks;
using NUnit.Framework;
using Roguehalla.Net.Protocol;

namespace Roguehalla.Net.Tests
{
    public sealed class OwnedSeatCheckpointTests
    {
        sealed class Http : IAccountTransport
        {
            readonly string _name;
            public Http(string name) { _name = name; }
            public Task<AccountHttpResponse> GetProfileAsync(string url, string token, string passcode, CancellationToken cancellation) =>
                Task.FromResult(new AccountHttpResponse(200, new AccountReply { token = token, created = false,
                    profile = new AccountProfile { name = _name, gv = 0, gvLifetime = 0, stats = new AccountStats { runs = 0, wins = 0, draws = 0, deaths = 0, kills = 0 } } }));
        }
        sealed class Credentials : IAccountCredentialStore
        {
            public string Read(string scope, string name) => null;
            public bool WriteConfirmed(string scope, string name, string token) => true;
        }
        sealed class Storage : IOwnedSeatCheckpointStorage
        {
            public string Raw;
            public int Reads, Writes, Clears;
            public bool ThrowRead, ThrowWrite, ThrowClear, DropWrite, ThrowAfterWrite;
            public Action BeforeCompare;
            public SeatCheckpointWriteStatus WriteStatus = SeatCheckpointWriteStatus.Saved;
            public SeatCheckpointReadStatus? ReadStatus;
            public SeatCheckpointClearStatus? ClearStatus;
            public SeatCheckpointReadStatus Read(out string value)
            {
                Reads++; if (ThrowRead) throw new OutOfMemoryException("declared copy failure");
                value = Raw; return ReadStatus ?? (Raw == null ? SeatCheckpointReadStatus.Missing : SeatCheckpointReadStatus.Ready);
            }
            public SeatCheckpointWriteStatus Write(string value)
            {
                Writes++; if (ThrowWrite) throw new InvalidOperationException("declared write failure");
                if (!DropWrite) Raw = value;
                if (ThrowAfterWrite) throw new OutOfMemoryException("declared post-write copy failure");
                return WriteStatus;
            }
            public SeatCheckpointClearStatus CompareAndClear(string expected)
            {
                Clears++; if (ThrowClear) throw new InvalidOperationException("declared clear failure");
                var before = BeforeCompare; BeforeCompare = null; before?.Invoke();
                if (ClearStatus.HasValue) return ClearStatus.Value;
                if (Raw == null) return SeatCheckpointClearStatus.Missing;
                if (Raw != expected) return SeatCheckpointClearStatus.Changed;
                Raw = null; return SeatCheckpointClearStatus.Cleared;
            }
        }

        OwnedAccount _alice, _bob;
        Storage _storage;
        OwnedSeatCheckpointStore _store;
        static byte[] Data(byte start) => Enumerable.Range(0, 16).Select(i => (byte)(start+i)).ToArray();
        static byte[] Capability() => Data(32);
        static byte[] Match() => Data(80);
        static string Base64(string s) => Convert.ToBase64String(Encoding.UTF8.GetBytes(s));
        static AccountEndpoint Endpoint(string scope = "https://game.example/api/") => AccountEndpoint.FromPage(null, scope);
        OwnedSeatCheckpointContext Context(OwnedAccount owner = null, string scope = "https://game.example/api/",
            string target = "wss://game.example/arena/ws", OwnedSeatMode mode = OwnedSeatMode.Arena, ushort protocol = 14, ulong content = 123) =>
            new OwnedSeatCheckpointContext(owner ?? _alice, Endpoint(scope), target, mode, protocol, content);
        OwnedSeatCheckpoint Save(OwnedSeatCheckpointContext context = null)
        {
            var saved = _store.Save(context ?? Context(), Capability(), Match(), 3);
            Assert.That(saved.Status, Is.EqualTo(SeatCheckpointWriteStatus.Saved)); return saved.Record;
        }
        static string Field(string raw, string name, string value)
        {
            var lines = raw.Split('\n'); int index = Array.FindIndex(lines, l => l.StartsWith(name + "=", StringComparison.Ordinal));
            Assert.That(index, Is.GreaterThanOrEqualTo(0)); lines[index] = name + "=" + value; return string.Join("\n", lines);
        }

        [SetUp]
        public async Task Setup()
        {
            var a = new AccountSession(Endpoint(), new Http("ALIce"), new Credentials());
            var b = new AccountSession(Endpoint(), new Http("Bob"), new Credentials());
            _alice = (await a.OpenAsync("ALIce", "synthetic-account-proof")).Account;
            _bob = (await b.OpenAsync("Bob", "synthetic-other-proof")).Account;
            Assert.That(a.CanJoin(_alice) && b.CanJoin(_bob), Is.True);
            _storage = new Storage(); _store = new OwnedSeatCheckpointStore(_storage);
        }

        [TestCase(OwnedSeatMode.Arena, "wss://game.example/arena/ws")]
        [TestCase(OwnedSeatMode.Training, "wss://game.example/training/ws")]
        public void ConfirmedScopedRecordOffersAnIndependentSeedForANewSession(OwnedSeatMode mode, string target)
        {
            var context = Context(mode: mode, target: target); var saved = Save(context);
            var read = _store.Read(context);
            Assert.That(read.Status, Is.EqualTo(SeatCheckpointReadStatus.Ready));
            Assert.That(read.Record, Is.Not.SameAs(saved)); Assert.That(read.Record.Revision, Is.EqualTo(saved.Revision));
            Assert.That(read.Record.Callsign, Is.EqualTo("alice")); Assert.That(read.Record.MatchUrl, Is.EqualTo(target));
            var wire = new FakeTransport(); var client = new Session(wire, new SessionOptions { Url = target, InitialResume = read.Record.CreateSeed(), Now = () => 0 });
            client.Connect(); wire.Open();
            Assert.That(wire.LastSent<ClientMsg.Hello>().Resume.SequenceEqual(Capability()), Is.True);
            wire.Deliver(new ServerMsg.Welcome { Protocol = Wire.ProtocolVersion, MatchId = Match(), PlayerId = 3, Session = Capability(), Map = new MapBlob(4,4,new byte[16]) });
            Assert.That(client.State, Is.EqualTo(SessionState.InMatch)); Assert.That(wire.Url, Is.EqualTo(target));
            Assert.That(_storage.Raw.Contains("synthetic-account-proof"), Is.False, "account bearer is never serialized");
        }

        [Test]
        public void SourceAndReturnedArrayMutationCannotChangeSavedIdentityOrCapability()
        {
            var capability = Capability(); var match = Match();
            var saved = _store.Save(Context(), capability, match, 3).Record; string raw = _storage.Raw;
            Array.Clear(capability,0,16); Array.Clear(match,0,16);
            var copy = saved.CopyMatchId(); Array.Clear(copy,0,16);
            Assert.That(saved.CopyMatchId().SequenceEqual(Match()), Is.True); Assert.That(_storage.Raw == raw, Is.True);
            var wire = new FakeTransport(); var client = new Session(wire, new SessionOptions { InitialResume = saved.CreateSeed(), Now = () => 0 });
            client.Connect(); wire.Open(); Assert.That(wire.LastSent<ClientMsg.Hello>().Resume.SequenceEqual(Capability()), Is.True);
            wire.Deliver(new ServerMsg.Welcome { Protocol = Wire.ProtocolVersion, MatchId = Match(), PlayerId = 3, Session = Capability(), Map = new MapBlob(4,4,new byte[16]) });
            Assert.That(client.State, Is.EqualTo(SessionState.InMatch));
        }

        [TestCase("owner")] [TestCase("api-prefix")] [TestCase("origin")] [TestCase("path")]
        [TestCase("mode")] [TestCase("protocol")] [TestCase("content")]
        public void CurrentExpectationsMustMatchBeforeARecordOrSeedCanBeOffered(string changed)
        {
            Save(); string original = _storage.Raw;
            var expected = changed == "owner" ? Context(owner: _bob) : changed == "api-prefix" ? Context(scope: "https://game.example/other/api/") :
                changed == "origin" ? Context(scope: "https://other.example/api/", target: "wss://other.example/arena/ws") :
                changed == "path" ? Context(target: "wss://game.example/other/ws") : changed == "mode" ? Context(mode: OwnedSeatMode.Training) :
                changed == "protocol" ? Context(protocol: 15) : Context(content: 124);
            var read = _store.Read(expected);
            Assert.That(read.Status, Is.EqualTo(SeatCheckpointReadStatus.Mismatch)); Assert.That(read.Record, Is.Null);
            Assert.That(_storage.Raw == original, Is.True); Assert.That(_storage.Writes, Is.EqualTo(1)); Assert.That(_storage.Clears, Is.Zero);
        }

        [TestCase("")] [TestCase("wss://elsewhere.example/training/ws")]
        [TestCase("wss://game.example/ws?token=private")] [TestCase("wss://game.example/ws#key=private")]
        [TestCase("wss://user:private@game.example/ws")] [TestCase("wss://game.example:444/ws")]
        [TestCase("https://game.example/ws")] [TestCase("wss://game.example/not-ws")]
        [TestCase(" wss://game.example/ws")] [TestCase("wss://game.example/ws\n")]
        public void InvalidCurrentTargetCannotBeReplacedByASavedDestination(string target)
        {
            Assert.Throws<ArgumentException>(() => Context(target: target));
            Assert.That(_storage.Reads + _storage.Writes + _storage.Clears, Is.Zero);
        }

        [Test]
        public void MissingProofOrUnknownBuildExpectationsCannotReadOrCreateACheckpoint()
        {
            Assert.Throws<ArgumentNullException>(() => new OwnedSeatCheckpointContext(null, Endpoint(), "wss://game.example/ws", OwnedSeatMode.Arena, 14, 1));
            Assert.Throws<ArgumentException>(() => Context(protocol: 0)); Assert.Throws<ArgumentException>(() => Context(content: 0));
            Assert.Throws<ArgumentException>(() => Context(mode: (OwnedSeatMode)99));
            Assert.That(_store.Read(null).Status, Is.EqualTo(SeatCheckpointReadStatus.Mismatch));
            Assert.That(_storage.Reads + _storage.Writes, Is.Zero);
        }

        [TestCase("truncated")] [TestCase("oversized")] [TestCase("version")] [TestCase("duplicate")]
        [TestCase("unknown")] [TestCase("reorder")] [TestCase("extra-newline")] [TestCase("crlf")]
        [TestCase("name-case")] [TestCase("scope-canonical")] [TestCase("scope-utf8")] [TestCase("scope-base64")]
        [TestCase("address-too-long")] [TestCase("protocol-zero")] [TestCase("protocol-leading-zero")] [TestCase("protocol-overflow")]
        [TestCase("player-zero")] [TestCase("player-negative")] [TestCase("player-overflow")] [TestCase("match-short")]
        [TestCase("capability-upper")] [TestCase("capability-short")] [TestCase("content-upper")] [TestCase("mode")]
        [TestCase("revision-empty")] [TestCase("revision-upper")] [TestCase("nul")]
        public void MalformedOrNoncanonicalStorageNeverProducesASeedOrGetsSilentlyCleared(string mutation)
        {
            Save(); string raw = _storage.Raw;
            switch (mutation)
            {
                case "truncated": raw = raw.Substring(0,raw.Length-1); break;
                case "oversized": raw = new string('x', OwnedSeatCheckpointStore.MaxRecordChars+1); break;
                case "version": raw = Field(raw,"version","2"); break;
                case "duplicate": raw += "name=alice\n"; break;
                case "unknown": raw = raw.Replace("name=", "account="); break;
                case "reorder": raw = raw.Replace("version=1\nscope=", "scope=1\nversion="); break;
                case "extra-newline": raw += "\n"; break;
                case "crlf": raw = raw.Replace("\n", "\r\n"); break;
                case "name-case": raw = Field(raw,"name","ALIce"); break;
                case "scope-canonical": raw = Field(raw,"scope",Base64("https://game.example/api")); break;
                case "scope-utf8": raw = Field(raw,"scope",Convert.ToBase64String(new byte[] { 0xff })); break;
                case "scope-base64": raw = Field(raw,"scope",Base64("https://game.example/api/") + " "); break;
                case "address-too-long": raw = Field(raw,"url",Base64("wss://game.example/" + new string('a',2048) + "/ws")); break;
                case "protocol-zero": raw = Field(raw,"protocol","0"); break;
                case "protocol-leading-zero": raw = Field(raw,"protocol","014"); break;
                case "protocol-overflow": raw = Field(raw,"protocol","65536"); break;
                case "player-zero": raw = Field(raw,"player","0"); break;
                case "player-negative": raw = Field(raw,"player","-3"); break;
                case "player-overflow": raw = Field(raw,"player","4294967296"); break;
                case "match-short": raw = Field(raw,"match",new string('0',31)); break;
                case "capability-upper": raw = Field(raw,"capability",new string('A',32)); break;
                case "capability-short": raw = Field(raw,"capability",new string('0',31)); break;
                case "content-upper": raw = Field(raw,"content","000000000000007B"); break;
                case "mode": raw = Field(raw,"mode","Arena"); break;
                case "revision-empty": raw = Field(raw,"revision",new string('0',32)); break;
                case "revision-upper": raw = Field(raw,"revision",new string('A',32)); break;
                case "nul": raw += "\0"; break;
            }
            _storage.Raw = raw; var read = _store.Read(Context());
            Assert.That(read.Status, Is.EqualTo(SeatCheckpointReadStatus.Invalid)); Assert.That(read.Record, Is.Null);
            Assert.That(_storage.Clears, Is.Zero); Assert.That(_storage.Raw == raw, Is.True);
        }

        [Test]
        public void MissingAndEmptyAreDifferentAndTheNativeAdapterHasNoHiddenFallback()
        {
            Assert.That(_store.Read(Context()).Status, Is.EqualTo(SeatCheckpointReadStatus.Missing));
            _storage.Raw = ""; Assert.That(_store.Read(Context()).Status, Is.EqualTo(SeatCheckpointReadStatus.Invalid));
            var native = new WebGlSeatCheckpointStorage();
            Assert.That(native.Read(out string text), Is.EqualTo(SeatCheckpointReadStatus.Unavailable)); Assert.That(text, Is.Null);
            Assert.That(native.Write("synthetic"), Is.EqualTo(SeatCheckpointWriteStatus.Unavailable));
            Assert.That(native.CompareAndClear("synthetic"), Is.EqualTo(SeatCheckpointClearStatus.Unavailable));
        }

        [Test]
        public void EveryNewWriteGetsANewRevisionAndAnOldCallbackCannotClearTheNewRecord()
        {
            var old = Save(); Func<SeatCheckpointClearStatus> callback = () => _store.Clear(old);
            var newer = Save(); string current = _storage.Raw;
            Assert.That(newer.Revision, Is.Not.EqualTo(old.Revision));
            Assert.That(callback(), Is.EqualTo(SeatCheckpointClearStatus.Changed)); Assert.That(_storage.Raw == current, Is.True);
            Assert.That(_store.Read(Context()).Record.Revision, Is.EqualTo(newer.Revision));
            Assert.That(_store.Clear(newer), Is.EqualTo(SeatCheckpointClearStatus.Cleared));
            Assert.That(callback(), Is.EqualTo(SeatCheckpointClearStatus.Missing));
        }

        [Test]
        public void AReplacementImmediatelyBeforeCompareCannotBeDeletedByAnOldRevision()
        {
            var old = Save(); OwnedSeatCheckpoint newer = null;
            _storage.BeforeCompare = () => newer = Save(Context(mode: OwnedSeatMode.Training, target: "wss://game.example/training/ws"));
            Assert.That(_store.Clear(old), Is.EqualTo(SeatCheckpointClearStatus.Changed));
            var read = _store.Read(Context(mode: OwnedSeatMode.Training, target: "wss://game.example/training/ws"));
            Assert.That(read.Record.Revision, Is.EqualTo(newer.Revision));
        }

        [Test]
        public void FailureAndCopyExceptionsCannotBecomeFalseSavedReadyOrClearedOutcomes()
        {
            _storage.ThrowRead = true; Assert.That(_store.Read(Context()).Status, Is.EqualTo(SeatCheckpointReadStatus.Unavailable));
            _storage.ThrowRead = false; _storage.DropWrite = true;
            Assert.That(_store.Save(Context(),Capability(),Match(),3).Status, Is.EqualTo(SeatCheckpointWriteStatus.Unsaved));
            _storage.DropWrite = false; _storage.ThrowWrite = true;
            Assert.That(_store.Save(Context(),Capability(),Match(),3).Record, Is.Null);
            _storage.ThrowWrite = false; _storage.ThrowAfterWrite = true;
            Assert.That(_store.Save(Context(),Capability(),Match(),3).Status, Is.EqualTo(SeatCheckpointWriteStatus.Unsaved));
            _storage.ThrowAfterWrite = false; var saved = Save(); _storage.ThrowClear = true;
            Assert.That(_store.Clear(saved), Is.EqualTo(SeatCheckpointClearStatus.Unsaved));
            Assert.That(_store.Read(Context()).Record.Revision, Is.EqualTo(saved.Revision));
        }

        [Test]
        public void ReadbackFailureAndUnsupportedBackendStatusesRemainUnconfirmed()
        {
            _storage.ReadStatus = SeatCheckpointReadStatus.Unavailable;
            Assert.That(_store.Save(Context(),Capability(),Match(),3).Status, Is.EqualTo(SeatCheckpointWriteStatus.Unsaved));
            _storage.ReadStatus = (SeatCheckpointReadStatus)999;
            Assert.That(_store.Read(Context()).Status, Is.EqualTo(SeatCheckpointReadStatus.Unavailable));
            _storage.ReadStatus = null; _storage.WriteStatus = (SeatCheckpointWriteStatus)999;
            Assert.That(_store.Save(Context(),Capability(),Match(),3).Status, Is.EqualTo(SeatCheckpointWriteStatus.Unsaved));
            _storage.WriteStatus = SeatCheckpointWriteStatus.Unavailable;
            Assert.That(_store.Save(Context(),Capability(),Match(),3).Status, Is.EqualTo(SeatCheckpointWriteStatus.Unavailable));
            _storage.WriteStatus = SeatCheckpointWriteStatus.Saved; var saved = Save(); _storage.ClearStatus = (SeatCheckpointClearStatus)999;
            Assert.That(_store.Clear(saved), Is.EqualTo(SeatCheckpointClearStatus.Unsaved));
        }

        [TestCase(0)] [TestCase(15)] [TestCase(17)]
        public void InvalidDeliveredShapesNeverTouchStorage(int length)
        {
            Assert.That(_store.Save(Context(),new byte[length],Match(),3).Status, Is.EqualTo(SeatCheckpointWriteStatus.Invalid));
            Assert.That(_store.Save(Context(),Capability(),new byte[length],3).Status, Is.EqualTo(SeatCheckpointWriteStatus.Invalid));
            Assert.That(_store.Save(Context(),Capability(),Match(),0).Status, Is.EqualTo(SeatCheckpointWriteStatus.Invalid));
            Assert.That(_store.Clear(null), Is.EqualTo(SeatCheckpointClearStatus.Invalid));
            Assert.That(_storage.Writes + _storage.Reads + _storage.Clears, Is.Zero);
        }
    }
}

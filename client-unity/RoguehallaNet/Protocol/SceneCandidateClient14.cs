using System;
using System.IO;
using System.Text;

namespace Roguehalla.Net.Protocol
{
    /// <summary>
    /// Private Full-current14 application handoff. Callers serialize all operations.
    /// This class has no socket, Session, default decoder, gameplay or AcceptedFrame binding.
    /// </summary>
    public sealed class SceneCandidateClient14
    {
        readonly object owner = new object();
        readonly SceneCandidate.Receiver receiver;
        Candidate pending;
        AppliedReceipt appliedReceipt;

        public ulong Generation { get; }
        public ulong Epoch { get; }
        public bool Closed { get { return receiver.Closed; } }
        /// <summary>
        /// Conservative cumulative accepted encoded-body allocations in this receiver epoch.
        /// Temporary copies, DTOs, caller-retained graphs and process RSS are separate.
        /// </summary>
        public long OwnedBodyBytes { get { return receiver.OwnedBodyBytes; } }
        /// <summary>The last explicitly applied complete candidate, retained across Close.</summary>
        public Candidate Current { get; private set; }

        public SceneCandidateClient14(ulong generation, ulong epoch, SceneCandidate.Limits limits)
        {
            if (generation == 0) throw new ArgumentOutOfRangeException(nameof(generation));
            receiver = new SceneCandidate.Receiver(epoch, limits);
            Generation = generation;
            Epoch = epoch;
        }

        /// <summary>
        /// Null means staging only. One complete unresolved candidate must be committed or
        /// refused before another wire record. Wrong local generation does not touch state.
        /// </summary>
        public Candidate Push(ulong generation, byte[] record)
        {
            RequireGeneration(generation);
            RequireOpen();
            if (pending != null)
            {
                Close();
                throw Bad("unresolved application candidate");
            }
            try
            {
                if (!receiver.Push(record)) return null;
                var view = receiver.Current;
                DecodeOriginal(view); // Fresh tracker and collections; no held DTO is reused.
                var candidate = new Candidate(owner, view);
                pending = candidate;
                return candidate;
            }
            catch
            {
                Close();
                throw;
            }
        }

        /// <summary>
        /// Trusted caller assertion that application preparation succeeded. This synchronous
        /// pointer replacement invokes no callback/I/O and does not attest Unity/gameplay use.
        /// All allocation/validation happens before publication; no ACK is sent or generated.
        /// </summary>
        public AppliedReceipt CommitApplied(ulong generation, Candidate candidate)
        {
            RequirePending(generation, candidate);
            var receipt = new AppliedReceipt(owner, candidate);
            Current = candidate;
            pending = null;
            appliedReceipt = receipt;
            return receipt;
        }

        /// <summary>Refusal closes this context and retains its previously applied candidate.</summary>
        public void Refuse(ulong generation, Candidate candidate)
        {
            RequirePending(generation, candidate);
            Close();
        }

        /// <summary>
        /// Copies the existing experimental ACK only for the exact current applied receipt.
        /// No sending occurs. Previously returned caller-owned bytes cannot be revoked by Close;
        /// an eventual transport must fence its own generation/epoch and outstanding sends.
        /// </summary>
        public byte[] EncodeAck(ulong generation, AppliedReceipt receipt)
        {
            RequireGeneration(generation);
            RequireOpen();
            if (receipt == null || !ReferenceEquals(receipt.Owner, owner) ||
                !ReferenceEquals(receipt, appliedReceipt) ||
                !ReferenceEquals(receipt.Candidate, Current))
                throw Bad("foreign or stale applied receipt");
            var meta = Current.Metadata;
            var writer = new Writer(34);
            writer.Bytes(Encoding.ASCII.GetBytes("RHC14EXP"));
            writer.U8(1);
            writer.U8(4);
            writer.U64(meta.Epoch);
            writer.U64(meta.Scene);
            writer.U64(meta.CueThrough);
            return writer.Finish();
        }

        public void Close()
        {
            receiver.Close();
            pending = null;
            appliedReceipt = null;
        }

        void RequireGeneration(ulong generation)
        {
            if (generation != Generation) throw Bad("foreign generation");
        }

        void RequireOpen()
        {
            if (Closed) throw Bad("closed");
        }

        void RequirePending(ulong generation, Candidate candidate)
        {
            RequireGeneration(generation);
            RequireOpen();
            if (candidate == null || !ReferenceEquals(candidate.Owner, owner) ||
                !ReferenceEquals(candidate, pending) || candidate.Metadata.Epoch != Epoch)
                throw Bad("foreign or stale candidate");
        }

        static InvalidOperationException Bad(string field)
        {
            return new InvalidOperationException("scene client14: " + field);
        }

        /// <summary>
        /// Immutable byte-owned DATA, not an application/command capability. Returned arrays
        /// and nested DTOs are detached. No decoded graph or duplicate body is retained here.
        /// </summary>
        public sealed class Candidate
        {
            internal readonly object Owner;
            readonly SceneCandidate.View view;
            internal Candidate(object owner, SceneCandidate.View view)
            {
                Owner = owner;
                this.view = view;
            }
            public SceneCandidate.Meta Metadata { get { return view.Metadata; } }
            public byte[] BodyCopy() { return view.BodyCopy(); }
            public ServerMsg[] MessagesCopy() { return DecodeOriginal(view); }
        }

        /// <summary>Opaque local receipt; only CommitApplied returns an authorized instance.</summary>
        public sealed class AppliedReceipt
        {
            internal readonly object Owner;
            internal readonly Candidate Candidate;
            internal AppliedReceipt(object owner, Candidate candidate)
            {
                Owner = owner;
                Candidate = candidate;
            }
        }

        static ServerMsg[] DecodeOriginal(SceneCandidate.View view)
        {
            // The original immutable View already passed the existing complete receiver
            // validator. Slice original frame bytes, never seed a tracker from re-encoded DTOs.
            byte[] body = view.BodyCopy();
            using (var stream = new MemoryStream(body, false))
            using (var reader = new BinaryReader(stream))
            {
                int count = reader.ReadUInt16();
                if (count < 2) throw new InvalidDataException("scene client14: missing groups");
                var messages = new ServerMsg[count];
                var tracker = new SnapshotTracker();
                var collections = new Roguehalla.Net.CollectionsView();
                for (int index = 0; index < count; index++)
                {
                    uint length = reader.ReadUInt32();
                    if (length == 0 || length > Wire.MaxServerFrame ||
                        length > stream.Length - stream.Position)
                        throw new InvalidDataException("scene client14: inner length");
                    byte[] frame = reader.ReadBytes((int)length);
                    var message = tracker.Decode(frame, frame.Length, null);
                    if (index == 0)
                    {
                        if (!(message is ServerMsg.Snapshot snapshot) ||
                            !tracker.HasBase || tracker.HeldTick != view.Metadata.Tick ||
                            snapshot.Tick != view.Metadata.Tick)
                            throw new InvalidDataException("scene client14: Full snapshot");
                    }
                    else if (index == 1)
                    {
                        if (!(message is ServerMsg.State state) || state.Items.Length != 11)
                            throw new InvalidDataException("scene client14: complete state");
                        collections.Apply(state);
                        if (!collections.HasFullState)
                            throw new InvalidDataException("scene client14: incomplete collections");
                    }
                    else if (!(message is ServerMsg.Events) && !(message is ServerMsg.Fx))
                        throw new InvalidDataException("scene client14: tail role");
                    messages[index] = message;
                }
                if (stream.Position != stream.Length)
                    throw new InvalidDataException("scene client14: trailing body");
                return messages;
            }
        }
    }
}

using System;
using System.Collections.Generic;
using System.IO;
using System.Text;

namespace Roguehalla.Net.Protocol
{
    /// <summary>Isolated experimental Full container. No live protocol fallback, authority or pooled DTO reuse.</summary>
    public static class SceneCandidate
    {
        static readonly byte[] Magic = Encoding.ASCII.GetBytes("RHC14EXP");
        public readonly struct Limits
        {
            public readonly int BodyBytes, PartBytes, Parts, Frames, FrameBytes, RetainedBodyBytes;
            public Limits(int bodyBytes,int partBytes,int parts,int frames,int frameBytes,int retainedBodyBytes)
            {
                if(Wire.ProtocolVersion!=15||bodyBytes<=0||partBytes<=0||partBytes>bodyBytes||parts<=0||parts>ushort.MaxValue||frames<2||frames>ushort.MaxValue||frameBytes<=0||frameBytes>Wire.MaxServerFrame||retainedBodyBytes<bodyBytes||frameBytes<69||(long)partBytes+32>frameBytes) throw Bad("limits");
                BodyBytes=bodyBytes;PartBytes=partBytes;Parts=parts;Frames=frames;FrameBytes=frameBytes;RetainedBodyBytes=retainedBodyBytes;
            }
            internal void Check(){if(BodyBytes<=0||PartBytes<=0||Parts<=0||Frames<2||FrameBytes<=0)throw Bad("limits");}
        }
        public readonly struct Meta
        {
            public readonly ulong Epoch, Scene, CueFrom, CueThrough;
            public readonly uint Tick;
            public readonly double SourceTime;
            public Meta(ulong epoch,ulong scene,uint tick,double sourceTime,ulong cueFrom,ulong cueThrough)
            {Epoch=epoch;Scene=scene;Tick=tick;SourceTime=sourceTime;CueFrom=cueFrom;CueThrough=cueThrough;Check();}
            internal void Check(){if(Epoch==0||Epoch==ulong.MaxValue||Scene==0||Scene==ulong.MaxValue||double.IsNaN(SourceTime)||double.IsInfinity(SourceTime)||SourceTime<0||CueThrough<CueFrom||CueThrough==ulong.MaxValue)throw Bad("tuple");}
        }
        public sealed class Prepared
        {
            readonly byte[] body; readonly Limits limits; readonly int parts;
            public Meta Metadata {get;}
            public int RecordCount {get{return parts+2;}}
            public long FramedBytes {get{return body.LongLength+parts*32L+109;}}
            internal Prepared(Meta m,byte[] b,Limits l){Metadata=m;body=b;limits=l;parts=1+(body.Length-1)/l.PartBytes;if(parts>l.Parts)throw Bad("parts");}
            public byte[] BodyCopy(){return (byte[])body.Clone();}
            public byte[] Record(int index)
            {
                if(index<0||index>=RecordCount)throw Bad("index");
                byte kind=index==0?(byte)1:index==RecordCount-1?(byte)3:(byte)2;
                using(var stream=new MemoryStream())using(var w=new BinaryWriter(stream))
                {
                    Prefix(w,kind,Metadata.Epoch,Metadata.Scene);
                    if(kind==1){w.Write(Metadata.Tick);w.Write(Metadata.SourceTime);w.Write((byte)0);w.Write(0UL);w.Write(Metadata.CueFrom);w.Write(Metadata.CueThrough);w.Write((ushort)parts);w.Write((uint)body.Length);}
                    else if(kind==3){w.Write((ushort)parts);w.Write((uint)body.Length);w.Write(Metadata.CueThrough);}
                    else{int from=(index-1)*limits.PartBytes,len=Math.Min(limits.PartBytes,body.Length-from);w.Write((ushort)(index-1));w.Write((uint)len);w.Write(body,from,len);}
                    return stream.ToArray();
                }
            }
        }
        public static Prepared Prepare(Meta meta,IReadOnlyList<byte[]> frames,Limits limits)
        {
            meta.Check();limits.Check();if(frames==null||frames.Count<2||frames.Count>limits.Frames)throw Bad("frames");
            long size=2;foreach(var f in frames){if(f==null||f.Length==0||f.Length>limits.FrameBytes)throw Bad("frame size");size=checked(size+4+f.Length);}
            if(size>limits.BodyBytes)throw Bad("body size");
            byte[] body;using(var s=new MemoryStream((int)size))using(var w=new BinaryWriter(s)){w.Write((ushort)frames.Count);foreach(var f in frames){w.Write((uint)f.Length);w.Write(f);}body=s.ToArray();}
            ValidateBody(meta,body,limits);return new Prepared(meta,body,limits);
        }
        /// <summary>Immutable accepted DATA, never an AcceptedFrame. Every accessor returns detached bytes/DTOs.</summary>
        public sealed class View
        {
            readonly byte[] body;
            public Meta Metadata{get;}
            internal View(Meta meta,byte[] owned){Metadata=meta;body=owned;}
            public byte[] BodyCopy(){return (byte[])body.Clone();}
            public ServerMsg[] Messages(){using(var r=new R(body)){int n=r.U16();var messages=new ServerMsg[n];for(int i=0;i<n;i++)messages[i]=ServerMsg.Decode(r.Bytes(r.Length32()));r.End();return messages;}}
        }
        public sealed class Receiver
        {
            readonly ulong epoch; readonly Limits limits;
            byte[] staging; Meta meta; int total,parts,next,position;
            public View Current{get;private set;}
            public bool Closed{get;private set;}
            public long OwnedBodyBytes{get;private set;}
            public Receiver(ulong epoch,Limits limits){limits.Check();if(epoch==0||epoch==ulong.MaxValue)throw Bad("epoch");this.epoch=epoch;this.limits=limits;}
            public void Close(){Closed=true;if(staging!=null)OwnedBodyBytes-=staging.Length;staging=null;}
            public bool Push(byte[] bytes)
            {
                if(Closed)throw Bad("closed");
                try{if(bytes==null||bytes.Length>limits.FrameBytes)throw Bad("outer size");return PushInner(bytes);}catch{Close();throw;}
            }
            bool PushInner(byte[] bytes)
            {
                using(var r=new R(bytes))
                {
                    var h=r.Header();if(h.epoch!=epoch)throw Bad("epoch");
                    if(h.kind==1)
                    {
                        if(staging!=null)throw Bad("duplicate begin");
                        uint tick=r.U32();double time=r.F64();if(r.U8()!=0||r.U64()!=0)throw Bad("Full only");
                        ulong from=r.U64(),through=r.U64();int p=r.U16(),t=r.Length32();r.End();var m=new Meta(epoch,h.scene,tick,time,from,through);
                        ulong last=Current==null?0:Current.Metadata.Scene,lastCue=Current==null?0:Current.Metadata.CueThrough;
                        if(last==ulong.MaxValue||h.scene!=last+1||from!=lastCue||Current!=null&&(tick<Current.Metadata.Tick||time<Current.Metadata.SourceTime))throw Bad("base");
                        if(t==0||t>limits.BodyBytes||p==0||p>limits.Parts||1+(t-1)/limits.PartBytes!=p)throw Bad("assembly size");
                        if(OwnedBodyBytes+t>limits.RetainedBodyBytes)throw Bad("retained bodies");OwnedBodyBytes+=t;staging=new byte[t];meta=m;total=t;parts=p;next=position=0;return false;
                    }
                    if(staging==null)throw Bad("no begin");
                    if(h.kind==2)
                    {
                        int index=r.U16(),len=r.Length32();if(h.scene!=meta.Scene||index!=next||index>=parts||len!=Math.Min(total-position,limits.PartBytes))throw Bad("part");
                        byte[] data=r.Bytes(len);r.End();Array.Copy(data,0,staging,position,len);position+=len;next++;return false;
                    }
                    if(h.kind==3)
                    {
                        int p=r.U16(),t=r.Length32();ulong cue=r.U64();r.End();if(h.scene!=meta.Scene||p!=parts||t!=total||cue!=meta.CueThrough||next!=parts||position!=total)throw Bad("commit");
                        ValidateBody(meta,staging,limits);var candidate=new View(meta,staging);staging=null;Current=candidate;return true;
                    }
                    throw Bad("unsupported kind");
                }
            }
        }
        static void ValidateBody(Meta meta,byte[] body,Limits limits)
        {
            using(var r=new R(body))
            {
                int n=r.U16();if(n<2||n>limits.Frames)throw Bad("frames");ulong count=0;
                for(int i=0;i<n;i++)
                {
                    int len=r.Length32();if(len==0||len>limits.FrameBytes)throw Bad("frame size");
                    var m=ServerMsg.Decode(r.Bytes(len)); // Fresh DTO, never decode into held/pooled state.
                    m.Encode(); // Match Rust decode + current14 encoder structural validation.
                    if(i==0&&m is ServerMsg.Snapshot snap&&snap.Tick==meta.Tick&&BitConverter.DoubleToInt64Bits(snap.ServerMs)==BitConverter.DoubleToInt64Bits(meta.SourceTime)){if(snap.ServerTimeOverrideMs.HasValue&&BitConverter.DoubleToInt64Bits(snap.ServerTimeOverrideMs.Value)==BitConverter.DoubleToInt64Bits(snap.Tick*50.0))throw Bad("redundant time");}
                    else if(i==1&&m is ServerMsg.State state&&state.Tick==meta.Tick&&state.Items.Length==11){for(int k=0;k<11;k++)if(state.Items[k].Key!=(uint)(k+1))throw Bad("keys");}
                    else if(i>=2&&m is ServerMsg.Events events&&events.Tick<=meta.Tick)count=checked(count+(ulong)events.List.Count);
                    else if(i>=2&&m is ServerMsg.Fx fx&&fx.Tick<=meta.Tick)count=checked(count+(ulong)fx.List.Count);
                    else throw Bad("body role");
                }
                r.End();if(meta.CueFrom>ulong.MaxValue-count||meta.CueFrom+count!=meta.CueThrough)throw Bad("cue count");
            }
        }
        static void Prefix(BinaryWriter w,byte kind,ulong epoch,ulong scene){w.Write(Magic);w.Write((byte)1);w.Write(kind);w.Write(epoch);w.Write(scene);}
        static InvalidDataException Bad(string field){return new InvalidDataException("scene experiment: "+field);}
        sealed class R:IDisposable
        {
            readonly MemoryStream s; readonly BinaryReader r;
            internal R(byte[] b){if(b==null)throw Bad("null");s=new MemoryStream(b,false);r=new BinaryReader(s);}
            internal byte U8(){return r.ReadByte();}internal ushort U16(){return r.ReadUInt16();}internal uint U32(){return r.ReadUInt32();}internal ulong U64(){return r.ReadUInt64();}internal double F64(){return r.ReadDouble();}
            internal int Length32(){uint n=U32();if(n>int.MaxValue)throw Bad("size");return (int)n;}
            internal byte[] Bytes(int n){if(n<0||n>s.Length-s.Position)throw Bad("truncated");return r.ReadBytes(n);}
            internal (byte kind,ulong epoch,ulong scene) Header(){var b=Bytes(8);for(int i=0;i<8;i++)if(b[i]!=Magic[i])throw Bad("experiment");if(U8()!=1)throw Bad("experiment");return(U8(),U64(),U64());}
            internal void End(){if(s.Position!=s.Length)throw Bad("trailing");}
            public void Dispose(){r.Dispose();s.Dispose();}
        }
    }
}

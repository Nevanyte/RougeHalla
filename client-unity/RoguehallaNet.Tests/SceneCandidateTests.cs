using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Text.Json;
using Roguehalla.Net.Protocol;
using NUnit.Framework;

namespace Roguehalla.Net.Tests
{
    public class SceneCandidateTests
    {
        static JsonDocument Fixture(){return JsonDocument.Parse(File.ReadAllText(Path.Combine(Util.RepoRoot(),"protocol","fixtures","scene-candidate","full14.json")));}
        static byte[] Hex(string s){var b=new byte[s.Length/2];for(int i=0;i<b.Length;i++)b[i]=Convert.ToByte(s.Substring(i*2,2),16);return b;}
        static SceneCandidate.Limits Limits(JsonElement d){var l=d.GetProperty("limits");return new SceneCandidate.Limits(l.GetProperty("bodyBytes").GetInt32(),l.GetProperty("partBytes").GetInt32(),l.GetProperty("parts").GetInt32(),l.GetProperty("frames").GetInt32(),l.GetProperty("frameBytes").GetInt32(),l.GetProperty("retainedBodyBytes").GetInt32());}
        static SceneCandidate.Meta Meta(JsonElement c,ulong scene=1,ulong? from=null){var m=c.GetProperty("meta");ulong originalFrom=ulong.Parse(m.GetProperty("cueFrom").GetString()),originalThrough=ulong.Parse(m.GetProperty("cueThrough").GetString());ulong begin=from??originalFrom;return new SceneCandidate.Meta(ulong.Parse(m.GetProperty("epoch").GetString()),scene,m.GetProperty("tick").GetUInt32(),m.GetProperty("sourceTime").GetDouble(),begin,checked(begin+originalThrough-originalFrom));}
        static byte[][] Frames(JsonElement c){return c.GetProperty("inner14Hex").EnumerateArray().Select(x=>Hex(x.GetString())).ToArray();}
        static SceneCandidate.Receiver Prime(SceneCandidate.Prepared p,SceneCandidate.Limits l){var r=new SceneCandidate.Receiver(p.Metadata.Epoch,l);for(int i=0;i<p.RecordCount;i++)r.Push(p.Record(i));return r;}
        static void Put64(byte[] b,int offset,ulong value){for(int i=0;i<8;i++)b[offset+i]=(byte)(value>>(8*i));}
        static void Refuses(Action action){bool refused=false;try{action();}catch(Exception){refused=true;}Assert.IsTrue(refused);}
        [Test]public void SceneCandidateNativeOrDeclaredCasesMatchRustBytesAndOwnDtos()
        {
            using(var f=Fixture())foreach(var c in f.RootElement.GetProperty("cases").EnumerateArray())
            {
                var l=Limits(f.RootElement);var p=SceneCandidate.Prepare(Meta(c),Frames(c),l);var expected=c.GetProperty("recordsHex").EnumerateArray().ToArray();Assert.AreEqual(expected.Length,p.RecordCount);
                var r=new SceneCandidate.Receiver(p.Metadata.Epoch,l);for(int i=0;i<p.RecordCount;i++){var b=p.Record(i);Refuses(()=>ServerMsg.Decode(b));CollectionAssert.AreEqual(Hex(expected[i].GetString()),b);Assert.AreEqual(i==p.RecordCount-1,r.Push(b));Array.Clear(b,0,b.Length);if(i<p.RecordCount-1)Assert.IsNull(r.Current);}
                CollectionAssert.AreEqual(Hex(c.GetProperty("bodyHex").GetString()),r.Current.BodyCopy());Assert.AreEqual(c.GetProperty("framedBytes").GetInt64(),p.FramedBytes);
                var inner=r.Current.Messages();for(int i=0;i<inner.Length;i++)CollectionAssert.AreEqual(Frames(c)[i],inner[i].Encode());
                var snap=(ServerMsg.Snapshot)inner[0];if(snap.Me!=null){float hp=snap.Me.Hp;snap.Me.Hp=0;Assert.AreEqual(hp,((ServerMsg.Snapshot)r.Current.Messages()[0]).Me.Hp);}
                var bytes=r.Current.BodyCopy();Array.Clear(bytes,0,bytes.Length);CollectionAssert.AreEqual(p.BodyCopy(),r.Current.BodyCopy());
                var state=(ServerMsg.State)inner[1];Assert.AreEqual(11,state.Items.Length);
                if(c.GetProperty("name").GetString()=="synthetic-available-empty"){Assert.IsTrue(((QuestsState)state.Items[9]).Available);Assert.IsTrue(((TradeState)state.Items[10]).Available);}
                if(c.GetProperty("name").GetString()=="synthetic-clear-mirror-range"){Assert.AreEqual(WireOwnerLockKind.Clear,snap.OwnerCombat.Lock.Kind);Assert.AreEqual(BitConverter.DoubleToInt64Bits(double.MaxValue),BitConverter.DoubleToInt64Bits(snap.OwnerCombat.AsMilli));}
                if(c.GetProperty("name").GetString()=="synthetic-redacted-owner-lock"){Assert.AreEqual(WireOwnerLockKind.Held,snap.OwnerCombat.Lock.Kind);Assert.IsNull(snap.OwnerCombat.Lock.Target);}
            }
        }
        [Test]public void SceneCandidateEveryPrefixClosesAndKeepsPriorExposedObject()
        {
            using(var f=Fixture())foreach(var c in f.RootElement.GetProperty("cases").EnumerateArray())
            {
                var l=Limits(f.RootElement);var first=SceneCandidate.Prepare(Meta(c),Frames(c),l);var second=SceneCandidate.Prepare(Meta(c,2,first.Metadata.CueThrough),Frames(c),l);
                for(int index=0;index<second.RecordCount;index++){var whole=second.Record(index);for(int end=0;end<whole.Length;end++){var r=Prime(first,l);var held=r.Current;for(int i=0;i<index;i++)r.Push(second.Record(i));var prefix=new byte[end];Array.Copy(whole,prefix,end);Refuses(()=>r.Push(prefix));Assert.IsTrue(r.Closed);Assert.AreSame(held,r.Current);}}
            }
        }
        [Test]public void SceneCandidateReorderSizeTupleAndDanglingQuestRefuseAtomically()
        {
            using(var f=Fixture())
            {
                var l=Limits(f.RootElement);var c=f.RootElement.GetProperty("cases")[0];var first=SceneCandidate.Prepare(Meta(c),Frames(c),l);var second=SceneCandidate.Prepare(Meta(c,2,first.Metadata.CueThrough),Frames(c),l);
                foreach(var sequence in new[]{new[]{0,0},new[]{0,2},new[]{0,second.RecordCount-1},new[]{1}}){var r=Prime(first,l);var old=r.Current;Refuses(()=>{foreach(int i in sequence)r.Push(second.Record(i));});Assert.AreSame(old,r.Current);}
                foreach(int offset in new[]{10,18,38,65}){var r=Prime(first,l);var held=r.Current;var b=second.Record(0);b[offset]^=1;Refuses(()=>{r.Push(b);for(int i=1;i<second.RecordCount;i++)r.Push(second.Record(i));});Assert.AreSame(held,r.Current);}
                foreach(var q in f.RootElement.GetProperty("cases").EnumerateArray())foreach(var key in new[]{"badQuestRecordsHex","badArenaRecordsHex","badTimeRecordsHex"})if(q.TryGetProperty(key,out var bad))
                {
                    var valid=SceneCandidate.Prepare(Meta(q),Frames(q),l);var r=new SceneCandidate.Receiver(valid.Metadata.Epoch,l);Refuses(()=>{foreach(var b in bad.EnumerateArray())r.Push(Hex(b.GetString()));});Assert.IsNull(r.Current);
                    var prior=Prime(valid,l);var held=prior.Current;var through=valid.Metadata.CueThrough+(valid.Metadata.CueThrough-valid.Metadata.CueFrom);var malformed=bad.EnumerateArray().Select(x=>Hex(x.GetString())).ToArray();
                    foreach(var b in malformed){Put64(b,18,2);if(b[9]==1){Put64(b,47,valid.Metadata.CueThrough);Put64(b,55,through);}if(b[9]==3)Put64(b,32,through);}
                    for(int i=0;i<malformed.Length-1;i++)Assert.IsFalse(prior.Push(malformed[i]));Refuses(()=>prior.Push(malformed[malformed.Length-1]));Assert.AreSame(held,prior.Current);CollectionAssert.AreEqual(valid.BodyCopy(),prior.Current.BodyCopy());
                }
                var quota=new SceneCandidate.Limits(first.BodyCopy().Length,l.PartBytes,l.Parts,l.Frames,l.FrameBytes,first.BodyCopy().Length);var limited=Prime(first,quota);var oldView=limited.Current;Refuses(()=>limited.Push(second.Record(0)));Assert.AreSame(oldView,limited.Current);Assert.AreEqual(first.BodyCopy().Length,limited.OwnedBodyBytes);
                var exact=new SceneCandidate.Limits(first.BodyCopy().Length,l.PartBytes,l.Parts,l.Frames,l.FrameBytes,l.RetainedBodyBytes);SceneCandidate.Prepare(Meta(c),Frames(c),exact);
                var small=new SceneCandidate.Limits(first.BodyCopy().Length-1,l.PartBytes,l.Parts,l.Frames,l.FrameBytes,l.RetainedBodyBytes);Refuses(()=>SceneCandidate.Prepare(Meta(c),Frames(c),small));
                Refuses(()=>new SceneCandidate.Receiver(0,l));Refuses(()=>new SceneCandidate.Meta(1,ulong.MaxValue,0,0,0,0));
            }
        }
    }
}

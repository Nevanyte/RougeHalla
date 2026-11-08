using System;
using System.Collections.Generic;
using System.Runtime.InteropServices;
using NUnit.Framework;
using Roguehalla.Net.Protocol;
namespace Roguehalla.Net.Tests
{
    public class FirstPlayableProtocolTests
    {
        [Test] public void TypedCommandsQueueAndRoundtripWithoutPayloadAliases()
        {
            var sender=new InputSender();sender.UseConsumable();sender.Target(uint.MaxValue);byte seq=sender.AttackMove(12.5f,-2f);sender.Target(0);
            var commands=((ClientMsg.Input)ClientMsg.Decode(sender.Flush(0)[0].Encode())).Commands;
            Assert.AreEqual(3,commands.Count);Assert.AreEqual(CommandKind.UseConsumable,commands[0].Kind);
            Assert.AreEqual(uint.MaxValue,commands[1].ActorRef);Assert.AreEqual(CommandKind.AttackMove,commands[2].Kind);Assert.AreEqual(seq,commands[2].Seq);
            Assert.AreEqual(1,sender.Dropped);Assert.Throws<ArgumentException>(()=>WireCommand.Target(0));
            Assert.Throws<DecodeException>(()=>ClientMsg.Decode(new byte[]{2,0,0,0,0,1,0,10,0,0,0,0}));
            var frame=new ClientMsg.Input{Commands=new List<WireCommand>{WireCommand.UseConsumable()}}.Encode();Assert.AreEqual(8,frame.Length);
            var extra=new byte[frame.Length+1];Array.Copy(frame,extra,frame.Length);Assert.Throws<DecodeException>(()=>ClientMsg.Decode(extra));
        }
        [Test] public void ActorPaddingFullDeltaAndPresentationKeepMobIdentityAndSignature()
        {
            Assert.AreEqual(32,Marshal.SizeOf<WireActor>());
            var first=new ServerMsg.Snapshot{Tick=1,Me=new WireSelf{Id=1,Sig=255},Actors=new[]{new WireActor{Id=2,Kind=1,MobTypeCode=30,Sig=254,HpPct=100,Status=1}}};
            var tracker=new SnapshotTracker();var full=(ServerMsg.Snapshot)tracker.Decode(first.Encode(),first.Encode().Length,null);
            Assert.AreEqual(255,full.Me.Sig);Assert.AreEqual(30,full.Actors[0].MobTypeCode);
            var changed=new ServerMsg.SnapshotDelta{Tick=2,BaseTick=1,HasSelf=true,Me=new SelfDelta{Mask=SelfDelta.FSig,Sig=0},Changed=new[]{new ActorDelta{Id=2,Mask=ActorDelta.MMobType|ActorDelta.MSig,MobTypeCode=0,Sig=0}},ChangedCount=1};
            var next=(ServerMsg.Snapshot)tracker.Decode(changed.Encode(),changed.Encode().Length,null);Assert.AreEqual(0,next.Me.Sig);Assert.AreEqual(0,next.Actors[0].MobTypeCode);Assert.AreEqual(0,next.Actors[0].Sig);
            var buffer=new SnapshotBuffer();buffer.Add(first);var rows=new List<InterpActor>();buffer.Sample(50,rows);Assert.AreEqual(MobTypeId.Archon,rows[0].MobType);Assert.AreEqual(254,rows[0].SourceSig);
            Assert.Throws<ArgumentException>(()=>new ServerMsg.Snapshot{Actors=new[]{new WireActor{Id=1,MobTypeCode=31}}}.Encode());
            var zero=new ServerMsg.Snapshot{Tick=3,Me=new WireSelf{Id=1},Actors=new[]{new WireActor{Id=2}}}.Encode();
            var reused=(ServerMsg.Snapshot)ServerMsg.Decode(zero,zero.Length,first);Assert.AreEqual(0,reused.Me.Sig);Assert.AreEqual(0,reused.Actors[0].MobTypeCode);Assert.AreEqual(0,reused.Actors[0].Sig);
            var transport=new FakeTransport();var session=new Session(transport,new SessionOptions{Url="ws://x/ws",Profile="p",Ticket=new byte[0],Now=()=>0});session.Connect();transport.Open();
            transport.Deliver(new ServerMsg.Welcome{Protocol=Wire.ProtocolVersion,MatchId=new byte[16],Session=new byte[16],PlayerId=1,TickRate=20,Map=new MapBlob(4,4,new byte[16])});
            transport.Deliver(new ServerMsg.Snapshot{Tick=4,Me=new WireSelf{Id=1,Sig=37}});Assert.AreEqual(37,session.Me.SelfSig);

        }
        [Test] public void CampsAndPotionNoticeEnforceBoundsAndTruncation()
        {
            var camp=new WireCamp{MobType=0,Elite=30,Alive=0,State=2,ClearedAt=1000,RespawnAt=181000};
            var state=new ServerMsg.State{Items=new StateItem[]{new CampsState{Rows=new[]{camp}}}};var bytes=state.Encode();
            var decoded=(CampsState)((ServerMsg.State)ServerMsg.Decode(bytes)).Items[0];Assert.AreEqual(30,decoded.Rows[0].Elite);
            for(int i=0;i<bytes.Length;i++){var cut=new byte[i];Array.Copy(bytes,cut,i);Assert.Throws<DecodeException>(()=>ServerMsg.Decode(cut));}
            foreach(var bad in new[]{new WireCamp{MobType=30},new WireCamp{Elite=31},new WireCamp{Alive=513},new WireCamp{State=3},new WireCamp{ClearedAt=-1},new WireCamp{RespawnAt=double.NaN},new WireCamp{ClearedAt=2,RespawnAt=1}})
                Assert.Throws<EncodeException>(()=>new ServerMsg.State{Items=new StateItem[]{new CampsState{Rows=new[]{bad}}}}.Encode());
            Assert.Throws<DecodeException>(()=>ServerMsg.Decode(new byte[]{0x88,0,1,8}));Assert.Throws<DecodeException>(()=>ServerMsg.Decode(new byte[]{0x88,0,8}));
            for(byte n=1;n<=10;n++){var events=new ServerMsg.Events{List=new List<WireEvent>{new WireEvent{Kind=EventKind.PotionNotice,PotionNotice=n}}};Assert.AreEqual(n,((ServerMsg.Events)ServerMsg.Decode(events.Encode())).List[0].PotionNotice);}
            Assert.Throws<DecodeException>(()=>ServerMsg.Decode(new byte[]{0x84,0,0,0,0,1,0,7,0}));Assert.Throws<DecodeException>(()=>ServerMsg.Decode(new byte[]{0x84,0,0,0,0,1,0,7,11}));
        }

        [Test] public void ProjectileRowsPreserveOrderDuplicatesAndStrictOptionalOwners()
        {
            var p=new WireProjectile{Kind=0,X=800,Y=900,Facing=12345,Owner=1};
            var state=new ServerMsg.State{Items=new StateItem[]{new ProjectilesState{Rows=new[]{p,p,new WireProjectile{Kind=1,Owner=null}}}}};
            var bytes=state.Encode();var rows=((ProjectilesState)((ServerMsg.State)ServerMsg.Decode(bytes)).Items[0]).Rows;
            Assert.AreEqual(3,rows.Length);Assert.AreEqual(rows[0],rows[1]);Assert.IsNull(rows[2].Owner);
            foreach(var bad in new[]{new WireProjectile{Kind=2},new WireProjectile{Owner=0}}) Assert.Throws<EncodeException>(()=>new ServerMsg.State{Items=new StateItem[]{new ProjectilesState{Rows=new[]{bad}}}}.Encode());
            foreach(int index in new[]{5,12}) {var bad=(byte[])bytes.Clone();bad[index]=2;Assert.Throws<DecodeException>(()=>ServerMsg.Decode(bad));}
            for(int i=0;i<bytes.Length;i++){var cut=new byte[i];Array.Copy(bytes,cut,i);Assert.Throws<DecodeException>(()=>ServerMsg.Decode(cut));}
        }
    }
}

using System;
using System.Collections.Generic;
using System.IO;
using System.Text.Json;
using NUnit.Framework;
using Roguehalla.Net.Protocol;

namespace Roguehalla.Net.Tests
{
    public class StateTests
    {
        static ServerMsg.State Full(uint tick)
        {
            return new ServerMsg.State { Tick=tick, Items=new StateItem[] {
                new InventoryState { Value=new WireInventory { ActiveSlot=1,Slot0=null,Slot1=2,PotionSmall=5,PotionLarge=4,PotionsHealing=3 } },
                new PropsState { Rows=new [] {
                    new WireProp {Handle=new PickupHandle(1),X=800,Y=900,Kind=PropKind.Ground,GroundWeapon=0},
                    new WireProp {Handle=new PickupHandle(2),X=801,Y=902,Kind=PropKind.Chest,Open=true},
                    new WireProp {Handle=new PickupHandle(3),X=802,Y=903,Kind=PropKind.Body,BodyLabel="\ufeffBÖB"},
                    new WireProp {Handle=new PickupHandle(4),X=803,Y=904,Kind=PropKind.WindEmblem}
                },Focus=new WireFocus{Handle=new PickupHandle(3),BodyHint=4} },
                new FieldsState {Rows=new [] {new WireField {Kind=2,Ability=3,Owner=null,Subject=1,X=20,Y=30,X2=40,Y2=50,Radius=12,Vx=-2,Vy=0,StartedAt=1000.5,EndsAt=6000.5}}},
                new RewardChestsState {Rows=new [] {new WireRewardChest {Handle=new RewardChestHandle(uint.MaxValue),X=100,Y=200,ExpiresAt=15000,Options=new [] {
                    new WireRewardOption{Kind=1,Id=0,Taken=false,TakenBy=null},new WireRewardOption{Kind=2,Id=7,Taken=true,TakenBy=1}
                },Picked=false,CanChoose=true}}},
                new BuildState {Value=new WireBuild {Cards=BuildCards(),Boosts=new byte[]{0,1,2,3,0,1,2,3}}},
                new CampsState {Rows=new[]{new WireCamp{MobType=0,Elite=30,Alive=0,State=2,ClearedAt=1000,RespawnAt=181000}}},
                new ProjectilesState {Rows=new[]{new WireProjectile{Kind=0,X=800,Y=900,Facing=12345,Owner=1},new WireProjectile{Kind=0,X=800,Y=900,Facing=12345,Owner=1}}},
                new PlanState(), new ArenaState(), new QuestsState { Available = false }
            }};
        }
        static ServerMsg.Welcome Welcome()
        {
            return new ServerMsg.Welcome {Protocol=Wire.ProtocolVersion,MatchId=new byte[16],Session=new byte[16],PlayerId=1,TickRate=20,Map=new MapBlob(4,4,new byte[16])};
        }

        static byte[] BuildCards() { var c = new byte[80]; c[0] = 1; c[2] = 1; return c; }

        [Test]
        public void StateRoundtripPreservesBodiesFocusFieldsChoicesAndEveryTruncationFails()
        {
            var bytes=Full(200).Encode(); var result=(ServerMsg.State)ServerMsg.Decode(bytes);
            CollectionAssert.AreEqual(bytes,result.Encode());
            Assert.AreEqual("\ufeffBÖB",((PropsState)result.Items[1]).Rows[2].BodyLabel);
            Assert.IsNull(((FieldsState)result.Items[2]).Rows[0].Owner);
            Assert.AreEqual(5,((InventoryState)result.Items[0]).Value.Value.PotionSmall);
            for(int end=0;end<bytes.Length;end++) {var cut=new byte[end];Array.Copy(bytes,cut,end);Assert.Throws<DecodeException>(()=>ServerMsg.Decode(cut),"prefix "+end);}
            // Independently constructed C# facts must produce the Rust golden bytes, including multiplicity.
            var expected=Full(200); var fields=(FieldsState)expected.Items[2]; fields.Rows=new[]{fields.Rows[0],fields.Rows[0]};
            using(var fixture=JsonDocument.Parse(File.ReadAllText(Path.Combine(Util.RepoRoot(),"protocol","fixtures",Util.FixtureName))))
            {
                bool found=false;
                foreach(var v in fixture.RootElement.GetProperty("server").EnumerateArray())
                    if(v.GetProperty("name").GetString()=="state_all") {found=true;Assert.AreEqual(v.GetProperty("hex").GetString(),Util.ToHex(expected.Encode()));}
                Assert.IsTrue(found);
            }
        }

        [Test]
        public void ReliableStateUsesSocketOrderRetainsMissingKeysAndClearsAcrossWelcome()
        {
            var t=new FakeTransport();double now=0;
            var s=new Session(t,new SessionOptions{Url="ws://x/ws",Profile="p",Ticket=new byte[0],Now=()=>now});
            s.Connect();t.Open();t.Deliver(Welcome());t.Deliver(Full(10));
            Assert.IsTrue(s.Collections.HasFullState);Assert.AreEqual(MobTypeId.Archon,s.Collections.Camps[0].Elite);Assert.AreEqual(4,s.Collections.Props.Count);Assert.AreEqual(2,s.Collections.Projectiles.Count);
            Assert.AreEqual(new PickupHandle(3),s.Collections.Focus.Value.Handle);
            t.Deliver(new ServerMsg.Snapshot{Tick=100,Phase=1});
            t.Deliver(new ServerMsg.State{Tick=11,Items=new StateItem[]{new InventoryState{Value=null}}});
            Assert.AreEqual(11,s.Collections.Tick,"reliable state is not discarded against a newer snapshot");
            Assert.IsNull(s.Collections.Inventory);Assert.AreEqual(4,s.Collections.Props.Count,"missing key retains value");
            t.Deliver(new ServerMsg.State{Tick=12,Items=new StateItem[]{new PropsState()}});
            Assert.AreEqual(0,s.Collections.Props.Count);Assert.IsNull(s.Collections.Focus);
            t.Drop();now=1000;s.Update();t.Open();t.Deliver(Welcome());
            Assert.IsFalse(s.Collections.HasFullState);Assert.AreEqual(0,s.Collections.Camps.Count);Assert.AreEqual(0,s.Collections.Projectiles.Count);Assert.IsNull(s.Collections.Inventory);Assert.AreEqual(0,s.Collections.RewardChests.Count);Assert.IsFalse(s.Collections.HasBuild);
        }

        [Test]
        public void MalformedStateCannotPartiallyReplaceAnEarlierKey()
        {
            var t=new FakeTransport();var s=new Session(t,new SessionOptions{Url="ws://x/ws",Profile="p",Ticket=new byte[0],Now=()=>0});
            s.Connect();t.Open();t.Deliver(Welcome());t.Deliver(Full(10));
            var bad=new byte[]{0x88,11,2,1,0,2,1,0}; // inventory clear followed by a zero prop handle
            int errors=s.DecodeErrors;t.DeliverRaw(bad);
            Assert.Greater(s.DecodeErrors,errors);Assert.IsTrue(s.Collections.Inventory.HasValue);Assert.AreEqual(10,s.Collections.Tick);
            foreach(var raw in new[]{new byte[]{0x88,0,2,1,0,1,0},new byte[]{0x88,0,1,1,1,0,0,0,6,0},new byte[]{0x88,0,1,3,0x81,4}})
                Assert.Throws<DecodeException>(()=>ServerMsg.Decode(raw));
        }

        [Test]
        public void ExplicitDisplacementPreventsShortTeleportInterpolationAndKeepsStatusFacts()
        {
            var b=new SnapshotBuffer();
            b.Add(new ServerMsg.Snapshot{Tick=1,Actors=new[]{new WireActor{Id=2,X=100,Y=100,HpPct=100,Status=1,Kind=1,DisplaceSeq=0}}});
            b.Add(new ServerMsg.Snapshot{Tick=2,Actors=new[]{new WireActor{Id=2,X=120,Y=100,HpPct=100,Status=1,Kind=1,Effects=4096,DisplaceSeq=1}}});
            var rows=new List<InterpActor>();b.Sample(75,rows);
            Assert.AreEqual(120,rows[0].X);Assert.AreEqual(4096,rows[0].Effects);Assert.AreEqual(ActorKind.RegionalMob,rows[0].Kind);
        }
    }
}

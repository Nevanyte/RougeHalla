using System;
using System.Collections.Generic;
using System.Reflection;
using System.Threading;
using System.Threading.Tasks;
using System.IO;
using System.Security.Cryptography;
using System.Diagnostics;
using Roguehalla.Client;
using Roguehalla.Net;
using Roguehalla.Net.Protocol;
using TMPro;
using UnityEditor;
using UnityEditor.SceneManagement;
using UnityEngine.SceneManagement;
using SessionState = Roguehalla.Net.SessionState;
using UnityEngine;
using UnityEngine.EventSystems;
using UnityEngine.InputSystem.UI;
using UnityEngine.UI;
using System.Linq;
using Newtonsoft.Json.Linq;
using UnityEngine.Rendering;
#if UNITY_EDITOR
// Native layout observer preparation; no product-source import. Execute only after exact Resume98 native PASS and explicit stage approval.
                   
[ExecuteAlways]
public sealed class TrainingLayoutEventSystem : EventSystem { }
public sealed class TrainingLayoutStage {
    const string ExpectedProject = "/Users/nevinmckinnon/.codex/tools/rougehalla-stage2/return-cleanup-2026-11-08/unity-resume98-isolated/repo/client-unity/UnityProject";
    const string ExpectedSourceCommit = "6d5d9340a6b9f425a17d7ea4488b49291fff3dc1";
    const string ExpectedEditorBinary = "/Applications/Unity/Hub/Editor/6000.0.85f2/Unity.app/Contents/MacOS/Unity";
    const int ExpectedEditorPid = 46583;
    const int ForbiddenEditorPid = 9075;
    static readonly Dictionary<string,string> FrozenInputHashes = new Dictionary<string,string> {
        { "Assets/Scripts/Net/MatchClient.cs", "1449fcd431d37fced802da4d63bd46a8c00e0ae7b275f17ee9f27e06f2585553" },
        { "Assets/Scripts/Net/MatchClient.Accounts.cs", "5f10e9f85d522e530a0dff9679beed07cfda53a8662018231202c51a02b9e90f" },
        { "Assets/Scripts/Net/MatchClient.Resume.cs", "db7f2daf9acf031a1d8addbe722dda8417ea62e938fd7d9ef6f89f2438190912" },
        { "Assets/Scripts/Net/AccountCoordinator.cs", "ea11af18e91ce6f9ea025355fbc03e3930438aa6cdad91711060dda06c81dbbc" }
    };
    public sealed class StageState {
        public readonly string RootName;
        public readonly GameObject Root;
        public readonly MatchClient Client;
        public readonly MatchHud Hud;
        public readonly TrainingConsoleView Console;
        public readonly Canvas Canvas;
        public readonly CanvasScaler Scaler;
        public readonly EventSystem Events;
        public bool Ready { get; internal set; }
        public string[] CleanupErrors { get; internal set; } = Array.Empty<string>();
        public string Error { get; internal set; }
        internal readonly EventSystem PriorEvents;
        internal readonly GameObject PriorSelection;
        internal readonly float PriorTextScale;
        internal readonly bool HadTextScalePref;
        internal readonly float TextScalePref;
        internal readonly bool HadProfilePref;
        internal readonly string ProfilePref;
        internal readonly StageTransport Transport;
        internal StageAccountTransport AccountTransport;
        internal StageCredentials CredentialStore;
        internal StageMemorySeatStorage SeatStorage;
        internal bool WelcomeDelivered, SnapshotDelivered, Closed;
        internal int Updates;
        public readonly Camera Camera;
        internal MapBlob Map;
        internal StageState(string name, GameObject root, MatchClient client, MatchHud hud,
            EventSystem events, EventSystem priorEvents, GameObject priorSelection,
            StageTransport transport, MapBlob map, Camera camera, float priorScale, bool hadPref, float pref, bool hadProfile, string profilePref)
        {
            RootName=name; Root=root; Client=client; Hud=hud; Console=hud.TrainingConsole;
            Canvas=root.transform.Find("MatchUI").GetComponent<Canvas>();
            Scaler=Canvas.GetComponent<CanvasScaler>(); Events=events; Camera=camera;
            PriorEvents=priorEvents; PriorSelection=priorSelection; Transport=transport; Map=map;
            PriorTextScale=priorScale; HadTextScalePref=hadPref; TextScalePref=pref;
            HadProfilePref=hadProfile; ProfilePref=profilePref;
        }
        public RectTransform ConsoleRoot => Console != null ? Console.Root : null;
        public RectTransform Panel => Console != null ? Console.Panel : null; public float CanvasScaleFactor => Canvas != null ? Canvas.scaleFactor : 0;
        public bool Open() => Ready && Console != null && Console.SetOpen(true);
        public bool ClosePanel() => Console != null && Console.SetOpen(false);
        public bool SelectMob(int index) => Ready && Console.SelectMob(index); public bool SelectCard(int index) => Ready && Console.SelectCard(index);
        public bool SelectCopies(int index) => Ready && Console.SelectCopies(index); public bool SetStackText(string text) => Ready && Console.SetStatText(text);
        public bool SetTextScale(float scale)
        {
            if (Closed || Root == null) return false;
            var settings = Root.GetComponentInChildren<ShowcaseSettings>(true);
            if (settings == null || !ReferenceEquals(ShowcaseSettings.Current, settings)) return false;
            settings.SetTextScale(scale);
            Canvas.ForceUpdateCanvases();
            return true;
        }
        public string ReadTextSizes()
        {
            if (ConsoleRoot == null) return ""; var texts=ConsoleRoot.GetComponentsInChildren<TMP_Text>(true); var rows=new string[texts.Length];
            for(int i=0;i<texts.Length;i++) rows[i]=texts[i].name+"="+texts[i].fontSize.ToString("0.##"); return string.Join(";",rows);
        }
        public Rect ScreenBounds(RectTransform rect)
        {
            if(rect==null) return default; var corners=new Vector3[4]; rect.GetWorldCorners(corners);
            var a=RectTransformUtility.WorldToScreenPoint(null,corners[0]); var b=RectTransformUtility.WorldToScreenPoint(null,corners[2]); return Rect.MinMaxRect(a.x,a.y,b.x,b.y);
        }
    }
    internal sealed class StageAccountTransport : IAccountTransport
    {
        public int RequestCount;
        public Task<AccountHttpResponse> GetProfileAsync(string url,string ownerToken,string passcode,CancellationToken cancellation)
        {
            RequestCount++;
            if(new Uri(url).Host!="layout.invalid") throw new InvalidOperationException("Refusing non-stub account HTTP host.");
            return Task.FromResult(new AccountHttpResponse(200,new AccountReply { profile=new AccountProfile { name="LayoutAlice",gv=0,gvLifetime=0,
                stats=new AccountStats { runs=0,wins=0,draws=0,deaths=0,kills=0 } }, token=new string('c',64),created=true }));
        }
    }
    internal sealed class StageCredentials : IAccountCredentialStore
    {
        public int ReadCount, WriteCount;
        public string Read(string scope,string name) { ReadCount++; return null; }
        public bool WriteConfirmed(string scope,string name,string token) { WriteCount++; return false; }
    }
    internal sealed class StageMemorySeatStorage : IOwnedSeatCheckpointStorage
    {
        string _record;
        public int ReadCount, WriteCount, ClearCount;
        public SeatCheckpointReadStatus Read(out string canonicalRecord)
        { ReadCount++; canonicalRecord=_record; return _record==null ? SeatCheckpointReadStatus.Missing : SeatCheckpointReadStatus.Ready; }
        public SeatCheckpointWriteStatus Write(string canonicalRecord)
        { WriteCount++; if(string.IsNullOrEmpty(canonicalRecord)) return SeatCheckpointWriteStatus.Invalid; _record=canonicalRecord; return SeatCheckpointWriteStatus.Saved; }
        public SeatCheckpointClearStatus CompareAndClear(string expectedCanonicalRecord)
        { ClearCount++; if(_record==null) return SeatCheckpointClearStatus.Missing; if(!string.Equals(_record,expectedCanonicalRecord,StringComparison.Ordinal)) return SeatCheckpointClearStatus.Changed; _record=null; return SeatCheckpointClearStatus.Cleared; }
    }
    internal sealed class StageTransport : ITransport
    {
        public event Action Opened;
        public event Action<byte[]> Received;
        public event Action<string> Closed;
        public string ConnectedUrl;
        public int CloseCount, SendCount, ConnectCount;
        public bool StubOnly=true;
        public void Connect(string url) { ConnectCount++; var uri=new Uri(url); if(uri.Host!="layout.invalid") throw new InvalidOperationException("Refusing non-stub transport host."); ConnectedUrl=url; }
        public void Send(byte[] frame) { SendCount++; }
        public void Close() { CloseCount++; Closed?.Invoke("preview closed"); } public void Poll() { }
        public void Open() { Opened?.Invoke(); } public void Deliver(ServerMsg msg) { Received?.Invoke(msg.Encode()); }
    }
    static StageState _active; static Scene _priorScene, _stageScene; const string TextScaleKey = "roguehalla.showcase.textScale"; const string ProfileKey = "rh.ui.profile";
    const BindingFlags InstancePrivate = BindingFlags.Instance | BindingFlags.NonPublic;
    static string ResolveGitHead(string project)
    {
        string repo=Directory.GetParent(Directory.GetParent(project).FullName).FullName;
        string dotGit=Path.Combine(repo,".git"); string gitDir;
        if(Directory.Exists(dotGit)) gitDir=dotGit;
        else {
            string marker=File.ReadAllText(dotGit).Trim(); const string prefix="gitdir:";
            if(!marker.StartsWith(prefix,StringComparison.Ordinal)) throw new InvalidOperationException("Project .git marker is not a worktree gitdir.");
            string value=marker.Substring(prefix.Length).Trim();
            gitDir=Path.GetFullPath(Path.IsPathRooted(value)?value:Path.Combine(repo,value));
        }
        string head=File.ReadAllText(Path.Combine(gitDir,"HEAD")).Trim();
        if(!head.StartsWith("ref: ",StringComparison.Ordinal)) return head;
        string reference=head.Substring(5);
        string worktreeRef=Path.Combine(gitDir,"refs",reference.Replace('/',Path.DirectorySeparatorChar));
        if(File.Exists(worktreeRef)) return File.ReadAllText(worktreeRef).Trim();
        string commonDir=Directory.GetParent(Directory.GetParent(gitDir).FullName).FullName;
        string commonRef=Path.Combine(commonDir,"refs",reference.Replace('/',Path.DirectorySeparatorChar));
        if(File.Exists(commonRef)) return File.ReadAllText(commonRef).Trim();
        string packed=Path.Combine(commonDir,"packed-refs");
        if(File.Exists(packed)) foreach(string line in File.ReadAllLines(packed)) {
            if(line.Length>0 && line[0]!='#' && line[0]!='^') { var parts=line.Split(' '); if(parts.Length==2 && parts[1]==reference) return parts[0]; }
        }
        throw new FileNotFoundException("Could not resolve the frozen worktree HEAD ref.");
    }
    static void AssertFrozenEnvironment()
    {
        string project=Path.GetFullPath(Directory.GetParent(Application.dataPath).FullName);
        if(!string.Equals(project,ExpectedProject,StringComparison.Ordinal)) throw new InvalidOperationException("Layout stage project path is not the frozen 6d project.");
        if(!string.Equals(ResolveGitHead(project),ExpectedSourceCommit,StringComparison.Ordinal)) throw new InvalidOperationException("Project Git HEAD is not the exact frozen 6d source commit.");
        if(Application.unityVersion!="6000.0.85f2" || EditorUserBuildSettings.activeBuildTarget!=BuildTarget.WebGL) throw new InvalidOperationException("Unexpected Unity version or active target.");
        using(var process=Process.GetCurrentProcess()) {
            if(process.Id!=ExpectedEditorPid || process.Id==ForbiddenEditorPid) throw new InvalidOperationException("Layout stage Editor PID is not the approved new Editor.");
            string executable=process.MainModule==null?null:Path.GetFullPath(process.MainModule.FileName);
            if(!string.Equals(executable,ExpectedEditorBinary,StringComparison.Ordinal)) throw new InvalidOperationException("Layout stage Editor executable does not match Unity 6000.0.85f2.");
        }
        if(EditorApplication.isCompiling || EditorApplication.isUpdating || EditorApplication.isPlaying || EditorApplication.isPlayingOrWillChangePlaymode) throw new InvalidOperationException("Layout stage requires an idle stopped Editor.");
        foreach(var item in FrozenInputHashes) {
            string path=Path.Combine(project,item.Key.Replace('/',Path.DirectorySeparatorChar));
            if(!File.Exists(path) || HashFile(path)!=item.Value) throw new InvalidOperationException("Frozen source input differs: "+item.Key);
        }
    }
    static string HashFile(string path) { using(var sha=SHA256.Create()) using(var stream=File.OpenRead(path)) return BitConverter.ToString(sha.ComputeHash(stream)).Replace("-","").ToLowerInvariant(); }
    public static StageState Create()
    {
        AssertFrozenEnvironment();
        if (_active != null && !_active.Closed) throw new InvalidOperationException("A Training layout stage is already active.");
        if (ShowcaseSettings.Current != null) throw new InvalidOperationException("Layout stage requires the recorded null ShowcaseSettings singleton baseline.");
        if(EventSystem.current!=null) throw new InvalidOperationException("Layout retake requires the recorded null EventSystem baseline.");
        foreach(var existing in Resources.FindObjectsOfTypeAll<EventSystem>())
            if(existing.gameObject.scene.IsValid()) throw new InvalidOperationException("Unexpected scene EventSystem before layout setup.");
        var priorEvents=EventSystem.current;
        var priorSelection=priorEvents != null ? priorEvents.currentSelectedGameObject : null;
        bool hadPref=PlayerPrefs.HasKey(TextScaleKey);
        float pref=hadPref ? PlayerPrefs.GetFloat(TextScaleKey) : 1f;
        bool hadProfile=PlayerPrefs.HasKey(ProfileKey);
        string profilePref=hadProfile ? PlayerPrefs.GetString(ProfileKey) : null;
        float priorScale=pref;
        string name="TrainingLayoutStage-"+Guid.NewGuid().ToString("N");
        _priorScene=SceneManager.GetActiveScene(); _stageScene=default;
        GameObject root=null, eventGo=null, cameraGo=null;
        MatchClient client=null;
        StageState state=null;
        try
        {
            _stageScene=EditorSceneManager.NewScene(NewSceneSetup.EmptyScene,NewSceneMode.Additive);
            if(!SceneManager.SetActiveScene(_stageScene)) throw new InvalidOperationException("Could not activate the owned layout scene.");
            root=new GameObject(name); root.hideFlags=HideFlags.DontSave;
            eventGo=new GameObject(name+"-EventSystem",typeof(TrainingLayoutEventSystem),typeof(InputSystemUIInputModule));
            eventGo.transform.SetParent(root.transform,false);
            var events=eventGo.GetComponent<TrainingLayoutEventSystem>();
            if(EventSystem.current!=events) throw new InvalidOperationException("Automatic EditMode EventSystem registration did not make the owned system current.");
            client=root.AddComponent<MatchClient>(); client.enabled=false;
            cameraGo=new GameObject(name+"-Camera",typeof(Camera)); cameraGo.transform.SetParent(root.transform,false);
            var camera=cameraGo.GetComponent<Camera>(); camera.orthographic=true; camera.orthographicSize=220f;
            camera.transform.position=new Vector3(320,320,-10); camera.backgroundColor=new Color(.035f,.045f,.065f);
            camera.clearFlags=CameraClearFlags.SolidColor; client.Cam=camera;
            client.PageUrl="https://layout.invalid/play"; client.Url="wss://layout.invalid/arena/ws";
            client.TrainingUrl="wss://layout.invalid/training/ws"; client.Profile="LayoutAlice"; client.Faction=4;
            var owner=root.AddComponent<AccountCoordinator>();
            var fakeAccountTransport=new StageAccountTransport(); var fakeCredentials=new StageCredentials();
            owner.Initialize(AccountEndpoint.FromPage(client.PageUrl),fakeAccountTransport,fakeCredentials);
            if(owner.Api==null || owner.Flow==null || client.enabled) throw new InvalidOperationException("Injected fake account/API stack did not initialize before staging.");
            SetField(client,"<AccountOwner>k__BackingField",owner);
            var fakeSeatStorage=new StageMemorySeatStorage();
            var fakeSeatStore=new OwnedSeatCheckpointStore(fakeSeatStorage);
            SetField(client,"_seatStore",fakeSeatStore);
            InvokeNoArg(client,"InitializeSeatResume");
            if(!ReferenceEquals(GetFieldValue(client,"_seatStore"),fakeSeatStore)) throw new InvalidOperationException("Fake in-memory seat store was not retained.");
            var hud=root.AddComponent<MatchHud>(); hud.Initialize(client);
            SetField(client,"<Hud>k__BackingField",hud);
            var ownSettings=root.GetComponentInChildren<ShowcaseSettings>(true);
            if(ownSettings==null) throw new InvalidOperationException("Owned MatchHud settings component was not created.");
            if(ShowcaseSettings.Current==null) InvokeNoArg(ownSettings,"Awake");
            if(!ReferenceEquals(ShowcaseSettings.Current,ownSettings)) throw new InvalidOperationException("Owned MatchHud settings did not become the current singleton.");
            foreach(var audio in root.GetComponentsInChildren<AudioSource>(true)) audio.mute=true;
            MythicUi.Text(hud.transform.Find("MatchUI"),"StagedFactsLabel","STAGED OFFLINE FACTS · NO BACKEND APPLICATION",new Vector2(.34f,.90f),new Vector2(.66f,.94f),12,ShowcasePalette.Gold).alignment=TextAlignmentOptions.Center;
            var map=new MapBlob(32,32,new byte[1024]);
            var transport=new StageTransport();
            SetField(client,"_transportFactory",new Func<ITransport>(()=>{
                if(client.Arena!=null)
                {
                    if(GetFieldValue(client.Arena,"_actors")==null) InvokeNoArg(client.Arena,"Awake");
                    client.Arena.transform.SetParent(root.transform,false);
                }
                return transport;
            }));
            state=new StageState(name,root,client,hud,events,priorEvents,priorSelection,transport,map,camera,priorScale,hadPref,pref,hadProfile,profilePref);
            _active=state;
            EditorApplication.update += Tick;
            state.AccountTransport=fakeAccountTransport; state.CredentialStore=fakeCredentials; state.SeatStorage=fakeSeatStorage;
            if(!ReferenceEquals(client.AccountOwner,owner) || client.AccountFlow==null || !ReferenceEquals(GetFieldValue(client,"_seatStore"),fakeSeatStore) || transport.StubOnly!=true)
                throw new InvalidOperationException("Stub API/credentials/seat store/transport were not all installed before stage action.");
            client.Join("LayoutAlice",4,MatchLaunchMode.Training);
            Canvas.ForceUpdateCanvases();
            return state;
        }
        catch(Exception originalFailure)
        {
            // Every cleanup operation is independently guarded; report only after all were attempted.
            var errors=state!=null ? Close(state) : CleanupOwned(root,eventGo,cameraGo,client,
                priorScale,hadPref,pref,hadProfile,profilePref);
            var failures=new List<Exception> { originalFailure };
            foreach(var error in errors) failures.Add(new InvalidOperationException(error));
            throw new AggregateException("Layout setup failed; all independent owned cleanup steps were attempted.",failures);
        }
    }
    public static async Task<object> Run()
    {
        var s=Create();
        for(int i=0;i<500 && !s.Ready && s.Error==null;i++) await Task.Yield();
        if(!s.Ready) { var message=s.Error ?? "Stage did not become ready"; var errors=Close(s); throw new InvalidOperationException(message+"; cleanup="+string.Join(";",errors)); }
        return Describe();
    }
    public static object Describe()
    {
        var s=_active; if(s==null)return new {active=false};
        UnityEngine.Canvas.ForceUpdateCanvases();
        return new {active=true,ready=s.Ready,error=s.Error,rootName=s.RootName,expectedFrozenSourceCommit=ExpectedSourceCommit,stagedOfflineFacts=true,backendApplied=false,playing=EditorApplication.isPlaying,
          screen=new {width=Screen.width,height=Screen.height},cameraPixels=new {width=s.Camera.pixelWidth,height=s.Camera.pixelHeight,targetTexture=s.Camera.targetTexture==null?null:new {width=s.Camera.targetTexture.width,height=s.Camera.targetTexture.height}},
          canvasPixelRect=s.Canvas.pixelRect,canvasScaleFactor=s.Canvas.scaleFactor,canvasRenderMode=s.Canvas.renderMode.ToString(),canvasWorldCamera=s.Canvas.worldCamera==null?null:s.Canvas.worldCamera.name,
          textScale=s.Root.GetComponentInChildren<ShowcaseSettings>(true).TextScale,open=s.Console.IsOpen,actions=s.Console.ActionsAvailable,
          rootBounds=s.ScreenBounds(s.ConsoleRoot),panelBounds=s.ScreenBounds(s.Panel),fonts=s.ReadTextSizes(),cameraName=s.Camera.name,
          accountHttpStubCalls=s.AccountTransport==null?0:s.AccountTransport.RequestCount,credentialReadCalls=s.CredentialStore==null?0:s.CredentialStore.ReadCount,
          credentialWriteCalls=s.CredentialStore==null?0:s.CredentialStore.WriteCount,seatStoreMemoryOnly=true,seatStoreReadCalls=s.SeatStorage==null?0:s.SeatStorage.ReadCount,seatStoreWriteCalls=s.SeatStorage==null?0:s.SeatStorage.WriteCount,
          transportStubOnly=s.Transport.StubOnly,transportConnectCalls=s.Transport.ConnectCount,transportSendCalls=s.Transport.SendCount,connectedUrlIsReservedInvalid=s.Transport.ConnectedUrl!=null && new Uri(s.Transport.ConnectedUrl).Host=="layout.invalid"};
    }
    public static object ConfigureCase(int width,int height,float textScale,bool bottom)
    {
        bool allowed=(width==1280 && height==720 || width==2560 && height==1440) && (Math.Abs(textScale-1f)<0.0001f || Math.Abs(textScale-1.5f)<0.0001f);
        if(!allowed) throw new ArgumentOutOfRangeException("case","Only the finite 1280x720 and 2560x1440 × 100%/150% matrix is permitted.");
        var s=_active; if(s==null||!s.Ready)throw new InvalidOperationException("No ready stage");
        if(Screen.width!=width || Screen.height!=height || s.Camera.pixelWidth!=width || s.Camera.pixelHeight!=height)
            throw new InvalidOperationException("Actual Screen/Camera dimensions do not match requested case; no layout mutation was made.");
        var settings=s.Root.GetComponentInChildren<ShowcaseSettings>(true); settings.SetTextScale(textScale);
        s.Console.SetOpen(true); Canvas.ForceUpdateCanvases();
        var scroll=s.Console.Root.GetComponentInChildren<ScrollRect>(true);scroll.verticalNormalizedPosition=bottom?0f:1f;
        Canvas.ForceUpdateCanvases();
        if(Screen.width!=width || Screen.height!=height || s.Camera.pixelWidth!=width || s.Camera.pixelHeight!=height || Math.Abs(s.Canvas.pixelRect.width-width)>0.5f || Math.Abs(s.Canvas.pixelRect.height-height)>0.5f)
            throw new InvalidOperationException("Post-layout Screen/Camera/Canvas pixel dimensions do not match requested case.");
        return Describe();
    }
    public static string[] CloseActive() { return Close(_active); }
    static void Tick()
    {
        var s=_active;
        if(s==null || s.Closed) { EditorApplication.update-=Tick; return; }
        try
        {
            if(!s.Ready && ++s.Updates>600) { s.Error="Timed out waiting for local owned Join/decoded Training snapshot."; EditorApplication.update-=Tick; return; }
            if(s.Client.Session!=null && s.Transport.ConnectedUrl!=null)
            {
                if(!s.WelcomeDelivered)
                {
                    s.Transport.Open();
                    s.Transport.Deliver(new ServerMsg.Welcome { Protocol=Wire.ProtocolVersion,
                        MatchId=new byte[16], Session=new byte[16], PlayerId=3, TickRate=20, ServerMs=50, Map=s.Map });
                    s.WelcomeDelivered=true;
                }
                if(!s.SnapshotDelivered && s.Client.Session.State==SessionState.InMatch)
                {
                    s.Transport.Deliver(new ServerMsg.Snapshot { Tick=1, ServerTimeOverrideMs=50, Phase=1, Training=true,
                        Me=new WireSelf { Id=3, X=320, Y=320, Hp=100, MaxHp=100, Status=1, Weapon=0 } });
                    s.SnapshotDelivered=true;
                    if(s.Client.Arena!=null && s.Client.Session.Latest!=null)
                    {
                        s.Client.Arena.Build(s.Map);
                        var actors=new List<InterpActor>();
                        s.Client.Session.Snapshots.Sample(s.Client.Session.Snapshots.NewestMs,actors);
                        s.Client.Arena.RefreshVisibility(s.Client.Session);
                        s.Client.Arena.PresentCollections(s.Client.Session.Collections);
                        s.Client.Arena.Present(actors,s.Client.Session.Me,s.Client.Session.Motion,0);
                        if(s.Client.Session.Me!=null) s.Client.Arena.Follow(s.Camera,s.Client.Session.Me.X,s.Client.Session.Me.Y);
                    }
                }
            }
            if(!s.Ready && s.SnapshotDelivered && s.Client.ConfirmedPractice && s.Console.ActionsAvailable)
            {
                s.Ready=s.Console.SetOpen(true);
                if(!s.Ready) s.Error="Accepted local Training fact did not open the owned console.";
            }
            Canvas.ForceUpdateCanvases();
        }
        catch(Exception e) { s.Error=e.GetType().Name+": "+e.Message; EditorApplication.update-=Tick; }
    }
    public static string[] Close(StageState state)
    {
        if(state==null || state.Closed) return Array.Empty<string>();
        state.Closed=true;
        var eventRoot=state.Events!=null ? state.Events.gameObject : null;
        var cameraRoot=state.Camera!=null ? state.Camera.gameObject : null;
        state.CleanupErrors=CleanupOwned(state.Root,eventRoot,cameraRoot,state.Client,
            state.PriorTextScale,state.HadTextScalePref,state.TextScalePref,state.HadProfilePref,state.ProfilePref);
        if(_active==state) _active=null;
        return state.CleanupErrors;
    }
    public static string[] Close(string uniqueRootName)
    {
        return _active!=null && string.Equals(_active.RootName,uniqueRootName,StringComparison.Ordinal)
            ? Close(_active) : Array.Empty<string>();
    }
    static string[] CleanupOwned(GameObject root,GameObject eventRoot,GameObject cameraRoot,MatchClient client,
        float priorScale,bool hadTextPref,float textPref,bool hadProfilePref,string profilePref)
    {
        var errors=new List<string>();
        GameObject ownedArenaRoot=null;
        Capture(errors,"detach-owned-update",()=>EditorApplication.update-=Tick);
        Capture(errors,"capture-owned-arena",()=>{ if(client!=null && client.Arena!=null) ownedArenaRoot=client.Arena.gameObject; });
        Capture(errors,"client-leave",()=>{ if(client!=null) client.Leave(); });
        Capture(errors,"restore-owned-text-scale",()=>{
            if(root!=null) { var settings=root.GetComponentInChildren<ShowcaseSettings>(true); if(settings!=null) settings.SetTextScale(priorScale); }
        });
        Capture(errors,"destroy-owned-root",()=>DestroyOwnedObject(root,eventRoot));
        // These references can remain alive after partial setup or failed parent destruction.
        // If the parent already destroyed them, Unity's object-null check skips a second destruction.
        Capture(errors,"destroy-owned-event-system-fallback",()=>DestroyOwnedObject(eventRoot,eventRoot));
        Capture(errors,"destroy-owned-camera-fallback",()=>DestroyOwnedObject(cameraRoot,eventRoot));
        Capture(errors,"destroy-owned-arena-fallback",()=>DestroyOwnedObject(ownedArenaRoot,eventRoot));
        Capture(errors,"verify-null-event-system-baseline",()=>{
            if(EventSystem.current!=null) throw new InvalidOperationException("Owned cleanup did not restore the null EventSystem baseline; foreign systems are left untouched.");
        });
        Capture(errors,"restore-text-pref",()=>RestorePreference(hadTextPref,textPref));
        Capture(errors,"restore-profile-pref",()=>RestoreProfilePreference(hadProfilePref,profilePref));
        Capture(errors,"restore-active-scene",()=>{
            if(!_priorScene.IsValid() || !_priorScene.isLoaded || !SceneManager.SetActiveScene(_priorScene))
                throw new InvalidOperationException("The recorded original scene could not be made active.");
        });
        Capture(errors,"close-owned-additive-scene",()=>{
            if(!_stageScene.IsValid() || !_stageScene.isLoaded) return;
            foreach(var system in Resources.FindObjectsOfTypeAll<EventSystem>())
                if(system.gameObject.scene==_stageScene && (eventRoot==null || system.gameObject!=eventRoot))
                    throw new InvalidOperationException("Foreign EventSystem found in the owned scene; scene is retained for review.");
            if(!EditorSceneManager.CloseScene(_stageScene,true))
                throw new InvalidOperationException("The owned additive layout scene could not be closed.");
        });
        return errors.ToArray();
    }
    static void DestroyOwnedObject(GameObject owned,GameObject ownedEventRoot)
    {
        if(owned==null) return;
        foreach(var system in owned.GetComponentsInChildren<EventSystem>(true))
            if(ownedEventRoot==null || system.gameObject!=ownedEventRoot)
                throw new InvalidOperationException("Foreign EventSystem found beneath an owned object; it is retained for review.");
        UnityEngine.Object.DestroyImmediate(owned);
    }
    static void Capture(List<string> errors,string step,Action action)
    {
        try { action(); } catch(Exception e) { errors.Add(step+": "+e.ToString()); }
    }
    static void RestorePreference(bool had,float value)
    { if(had) PlayerPrefs.SetFloat(TextScaleKey,value); else PlayerPrefs.DeleteKey(TextScaleKey); PlayerPrefs.Save(); }
    static void RestoreProfilePreference(bool had,string value)
    { if(had) PlayerPrefs.SetString(ProfileKey,value ?? ""); else PlayerPrefs.DeleteKey(ProfileKey); PlayerPrefs.Save(); }
    static object GetFieldValue(object target,string name)
    {
        var field=target.GetType().GetField(name,InstancePrivate);
        if(field==null) throw new MissingFieldException(target.GetType().FullName,name);
        return field.GetValue(target);
    }
    static void InvokeNoArg(object target,string name)
    {
        var method=target.GetType().GetMethod(name,InstancePrivate);
        if(method==null) throw new MissingMethodException(target.GetType().FullName,name);
        method.Invoke(target,null);
    }
    static void SetField(object target,string name,object value)
    {
        var field=target.GetType().GetField(name,InstancePrivate);
        if(field==null) throw new MissingFieldException(target.GetType().FullName,name);
        field.SetValue(target,value);
    }
}
#endif

#if UNITY_EDITOR
// Source-only host for a finite off-screen layout raster campaign. Never changes Game View resolution.












public static class LayoutProofHost6d
{
    const string ProjectPath = "/Users/nevinmckinnon/.codex/tools/rougehalla-stage2/return-cleanup-2026-11-08/unity-resume98-isolated/repo/client-unity/UnityProject";
    const string EditorBinary = "/Applications/Unity/Hub/Editor/6000.0.85f2/Unity.app/Contents/MacOS/Unity";
    const string SourceCut = "6d5d9340a6b9f425a17d7ea4488b49291fff3dc1";
    const int EditorPid = 46583;
    const int ForbiddenPid = 9075;
    const int WaitFrames = 120;

    static TrainingLayoutStage.StageState _stage;
    static bool _started, _captureActive, _captureHandlerAttached, _closed;
    static string _firstFailure;
    static int _screenW, _screenH;
    static FullScreenMode _screenMode;
    static uint _viewW, _viewH;
    static string _viewType, _viewBaselineError, _viewFinalObservation;
    static int _caseWidth, _caseHeight;
    static float _caseScale;
    static bool _caseBottom;
    static CanvasRenderModeSnapshot _canvasBefore;
    static RenderTexture _cameraTargetBefore;
    static float _cameraAspectBefore;
    static readonly List<RenderTexture> OwnedTargets = new List<RenderTexture>();
    static readonly JArray CameraCaptureRows = new JArray();

    sealed class CanvasRenderModeSnapshot
    {
        public RenderMode Mode;
        public Camera WorldCamera;
        public float PlaneDistance;
    }

    static string ProjectRoot()
    {
        return Path.GetFullPath(Directory.GetParent(Application.dataPath).FullName);
    }

    static void AssertEditorIdentity()
    {
        if (!string.Equals(ProjectRoot(), ProjectPath, StringComparison.Ordinal))
            throw new InvalidOperationException("Layout proof host project path differs from frozen 6d project.");
        if (Application.unityVersion != "6000.0.85f2" || EditorUserBuildSettings.activeBuildTarget != BuildTarget.WebGL)
            throw new InvalidOperationException("Layout proof host Unity version or target differs.");
        using (var process = Process.GetCurrentProcess())
        {
            if (process.Id != EditorPid || process.Id == ForbiddenPid)
                throw new InvalidOperationException("Layout proof host Editor PID differs or is forbidden.");
            string binary = process.MainModule == null ? null : Path.GetFullPath(process.MainModule.FileName);
            if (!string.Equals(binary, EditorBinary, StringComparison.Ordinal))
                throw new InvalidOperationException("Layout proof host Editor executable differs.");
        }
        if (EditorApplication.isCompiling || EditorApplication.isUpdating || EditorApplication.isPlaying || EditorApplication.isPlayingOrWillChangePlaymode)
            throw new InvalidOperationException("Layout proof host requires idle Edit Mode.");
    }

    static void RecordFailure(Exception error)
    {
        if (string.IsNullOrEmpty(_firstFailure)) _firstFailure = error.GetType().Name + ": " + error.Message;
    }

    static JObject CurrentGameViewFacts()
    {
        uint w = 0, h = 0;
        PlayModeWindow.GetRenderingResolution(out w, out h);
        return new JObject
        {
            ["screenWidth"] = Screen.width,
            ["screenHeight"] = Screen.height,
            ["screenFullScreenMode"] = Screen.fullScreenMode.ToString(),
            ["playModeViewType"] = PlayModeWindow.GetViewType().ToString(),
            ["playModeRenderingWidth"] = w,
            ["playModeRenderingHeight"] = h
        };
    }

    public static async Task<JObject> Start()
    {
        try
        {
            if (_started || _stage != null) throw new InvalidOperationException("Layout proof host can start only once per assembly lifetime.");
            AssertEditorIdentity();
            _screenW = Screen.width; _screenH = Screen.height; _screenMode = Screen.fullScreenMode;
            try { PlayModeWindow.GetRenderingResolution(out _viewW, out _viewH); _viewType = PlayModeWindow.GetViewType().ToString(); }
            catch (Exception e) { _viewBaselineError = e.GetType().Name; }
            // Public Game View facts are observations; off-screen proof is bound to the actual RT, camera and Canvas.
            _started = true;
            _stage = TrainingLayoutStage.Create();
            await WaitEditorFrames(() => _stage != null && (_stage.Ready || !string.IsNullOrEmpty(_stage.Error)), WaitFrames);
            if (_stage == null || !_stage.Ready)
                throw new InvalidOperationException("Staged fixture did not reach ready state: " + (_stage == null ? "missing stage" : _stage.Error ?? "not ready"));
            JObject result = Describe();
            result["hostAssemblyName"] = typeof(LayoutProofHost6d).Assembly.GetName().Name;
            return result;
        }
        catch (Exception e)
        {
            RecordFailure(e);
            throw;
        }
    }

    public static async Task<JObject> RequestCase(int width, int height, float scale, bool bottom)
    {
        try
        {
            AssertEditorIdentity();
            if (!_started || _stage == null || !_stage.Ready || _closed)
                throw new InvalidOperationException("No ready open layout stage.");
            if (_captureActive) throw new InvalidOperationException("Cannot configure a case while capture observation is active.");
            bool acceptedSize = (width == 1280 && height == 720) || (width == 2560 && height == 1440);
            bool acceptedScale = Math.Abs(scale - 1f) < 0.0001f || Math.Abs(scale - 1.5f) < 0.0001f;
            if (!acceptedSize || !acceptedScale)
                throw new ArgumentOutOfRangeException("case", "Only 1280x720 and 2560x1440 at scales 1.0 or 1.5 are permitted.");

            if (_canvasBefore == null)
            {
                _canvasBefore = new CanvasRenderModeSnapshot
                {
                    Mode = _stage.Canvas.renderMode,
                    WorldCamera = _stage.Canvas.worldCamera,
                    PlaneDistance = _stage.Canvas.planeDistance
                };
                _cameraTargetBefore = _stage.Camera.targetTexture;
                _cameraAspectBefore = _stage.Camera.aspect;
            }

            var owned = new RenderTexture(width, height, 24, RenderTextureFormat.ARGB32)
            {
                name = "LayoutProofHost6d-" + width + "x" + height,
                hideFlags = HideFlags.HideAndDontSave,
                antiAliasing = 1,
                useMipMap = false,
                autoGenerateMips = false
            };
            OwnedTargets.Add(owned);
            if (!owned.Create() || !owned.IsCreated())
                throw new InvalidOperationException("Could not create the owned exact-size layout RenderTexture.");

            _stage.Camera.targetTexture = owned;
            _stage.Camera.aspect = (float)width / height;
            _stage.Canvas.renderMode = RenderMode.ScreenSpaceCamera;
            _stage.Canvas.worldCamera = _stage.Camera;
            _stage.Canvas.planeDistance = 1f;
            if (!_stage.SetTextScale(scale))
                throw new InvalidOperationException("Owned staged text-scale component was not available.");
            if (!_stage.Console.SetOpen(true))
                throw new InvalidOperationException("Owned training console did not open.");
            Canvas.ForceUpdateCanvases();
            var scroll = _stage.Console.Root.GetComponentInChildren<ScrollRect>(true);
            if (scroll == null) throw new InvalidOperationException("Owned training console ScrollRect is missing.");
            scroll.verticalNormalizedPosition = bottom ? 0f : 1f;
            Canvas.ForceUpdateCanvases();

            _caseWidth = width; _caseHeight = height; _caseScale = scale; _caseBottom = bottom;
            await WaitEditorFrames(() => DimensionsMatch(width, height), WaitFrames);
            if (!DimensionsMatch(width, height))
                throw new InvalidOperationException("Off-screen RT/Camera/Canvas dimensions did not settle to the requested case.");
            return Describe();
        }
        catch (Exception e)
        {
            RecordFailure(e);
            throw;
        }
    }

    static bool DimensionsMatch(int width, int height)
    {
        if (_stage == null || _stage.Camera == null || _stage.Canvas == null) return false;
        var target = _stage.Camera.targetTexture;
        var rect = _stage.Canvas.pixelRect;
        return target != null && target.IsCreated() && target.width == width && target.height == height &&
            _stage.Camera.pixelWidth == width && _stage.Camera.pixelHeight == height &&
            Math.Abs(rect.width - width) < 0.5f && Math.Abs(rect.height - height) < 0.5f;
    }

    public static JObject BeginCaptureObservation()
    {
        try
        {
            AssertEditorIdentity();
            if (!_started || _stage == null || !_stage.Ready || _closed || _caseWidth < 1 || _caseHeight < 1)
                throw new InvalidOperationException("A verified case must be configured before capture observation.");
            if (_captureActive) throw new InvalidOperationException("Capture observation is already active.");
            CameraCaptureRows.Clear();
            RenderPipelineManager.endCameraRendering += OnEndCameraRendering;
            _captureHandlerAttached = true;
            _captureActive = true;
            return new JObject { ["success"] = true, ["cameraName"] = _stage.Camera.name, ["expectedWidth"] = _caseWidth, ["expectedHeight"] = _caseHeight };
        }
        catch (Exception e) { RecordFailure(e); throw; }
    }

    static void OnEndCameraRendering(ScriptableRenderContext context, Camera camera)
    {
        if (!_captureActive || _stage == null || camera != _stage.Camera) return;
        var target = camera.targetTexture;
        // The Pipeline camera capture may temporarily assign its own RenderTexture.
        // Capture observation is scoped by Begin/End and this exact camera; retain
        // all non-null targets so the actual temporary target dimensions are visible.
        if (target == null) return;
        CameraCaptureRows.Add(new JObject
        {
            ["cameraName"] = camera.name,
            ["targetTexturePresent"] = target != null,
            ["targetTextureInstanceId"] = target == null ? 0 : target.GetInstanceID(),
            ["targetOwnedByHost"] = target != null && OwnedTargets.Contains(target),
            ["targetWidth"] = target == null ? 0 : target.width,
            ["targetHeight"] = target == null ? 0 : target.height,
            ["cameraPixelWidth"] = camera.pixelWidth,
            ["cameraPixelHeight"] = camera.pixelHeight
        });
    }

    public static JObject EndCaptureObservation()
    {
        var cleanup = new List<string>();
        try
        {
            if (_captureHandlerAttached)
            {
                RenderPipelineManager.endCameraRendering -= OnEndCameraRendering;
                _captureHandlerAttached = false;
            }
            _captureActive = false;
            bool valid = CameraCaptureRows.Count > 0;
            foreach (JObject row in CameraCaptureRows)
            {
                valid &= (bool)row["targetTexturePresent"] &&
                    (int)row["targetWidth"] == _caseWidth && (int)row["targetHeight"] == _caseHeight &&
                    (int)row["cameraPixelWidth"] == _caseWidth && (int)row["cameraPixelHeight"] == _caseHeight;
            }
            if (!valid) RecordFailure(new InvalidOperationException("Expected at least one own-camera render into an owned exact-size case target; every observed row must match the case."));
            return new JObject { ["success"] = valid, ["captureTargetRows"] = new JArray(CameraCaptureRows), ["firstFailure"] = _firstFailure };
        }
        catch (Exception e)
        {
            RecordFailure(e);
            cleanup.Add(e.GetType().Name + ": " + e.Message);
            return new JObject { ["success"] = false, ["cleanupErrors"] = new JArray(cleanup), ["captureTargetRows"] = new JArray(CameraCaptureRows), ["firstFailure"] = _firstFailure };
        }
    }

    public static JObject Describe()
    {
        JObject screen;
        try { screen = CurrentGameViewFacts(); }
        catch (Exception e) { screen = new JObject { ["available"] = false, ["errorType"] = e.GetType().Name }; }
        var camera = new JObject();
        var canvas = new JObject();
        bool stageObjectsLive = _stage != null && !_closed && _stage.Camera != null && _stage.Canvas != null;
        float textScale = -1f;
        string textSizes = null;
        JObject rootBounds = null;
        JObject panelBounds = null;
        if (stageObjectsLive)
        {
            var target = _stage.Camera.targetTexture;
            var rect = _stage.Canvas.pixelRect;
            var settings = _stage.Root == null ? null : _stage.Root.GetComponentInChildren<Roguehalla.Client.ShowcaseSettings>(true);
            textScale = settings == null ? -1f : settings.TextScale;
            textSizes = _stage.ReadTextSizes();
            rootBounds = ProjectedBounds(_stage.ConsoleRoot, _stage.Camera);
            panelBounds = ProjectedBounds(_stage.Panel, _stage.Camera);
            camera = new JObject
            {
                ["name"] = _stage.Camera.name,
                ["pixelWidth"] = _stage.Camera.pixelWidth,
                ["pixelHeight"] = _stage.Camera.pixelHeight,
                ["targetTexturePresent"] = target != null,
                ["targetWidth"] = target == null ? 0 : target.width,
                ["targetHeight"] = target == null ? 0 : target.height
            };
            canvas = new JObject
            {
                ["renderMode"] = _stage.Canvas.renderMode.ToString(),
                ["worldCamera"] = _stage.Canvas.worldCamera == null ? null : _stage.Canvas.worldCamera.name,
                ["pixelX"] = rect.x,
                ["pixelY"] = rect.y,
                ["pixelWidth"] = rect.width,
                ["pixelHeight"] = rect.height,
                ["scaleFactor"] = _stage.Canvas.scaleFactor
            };
        }
        return new JObject
        {
            ["hostAssemblyName"] = typeof(LayoutProofHost6d).Assembly.GetName().Name,
            ["sourceCutExpected"] = SourceCut,
            ["stageActive"] = stageObjectsLive,
            ["stageReady"] = stageObjectsLive && _stage.Ready,
            ["stageError"] = _stage == null ? null : _stage.Error,
            ["firstFailure"] = _firstFailure,
            ["backendApplied"] = false,
            ["presentationEvidence"] = "staged offline facts only; no backend/gameplay application",
            ["pointerClaims"] = "open; off-screen RT capture is not live Game View pointer evidence",
            ["configuredCase"] = new JObject { ["width"] = _caseWidth, ["height"] = _caseHeight, ["scale"] = _caseScale, ["bottom"] = _caseBottom },
            ["camera"] = camera,
            ["canvas"] = canvas,
            ["textScale"] = textScale,
            ["textSizes"] = textSizes,
            ["consoleRootProjectedBounds"] = rootBounds,
            ["panelProjectedBounds"] = panelBounds,
            ["gameViewBaseline"] = new JObject { ["screenWidth"] = _screenW, ["screenHeight"] = _screenH, ["fullScreenMode"] = _screenMode.ToString(), ["viewType"] = _viewType, ["renderWidth"] = _viewW, ["renderHeight"] = _viewH },
            ["gameViewBaselineError"] = _viewBaselineError,
            ["gameViewFinalObservation"] = _viewFinalObservation,
            ["gameViewCurrent"] = screen
        };
    }

    static JObject ProjectedBounds(RectTransform rect, Camera camera)
    {
        if (rect == null || camera == null) return null;
        var corners = new Vector3[4];
        rect.GetWorldCorners(corners);
        Vector2 min = RectTransformUtility.WorldToScreenPoint(camera, corners[0]);
        Vector2 max = min;
        for (int i = 1; i < corners.Length; i++)
        {
            Vector2 point = RectTransformUtility.WorldToScreenPoint(camera, corners[i]);
            min = Vector2.Min(min, point);
            max = Vector2.Max(max, point);
        }
        return new JObject { ["x"] = min.x, ["y"] = min.y, ["width"] = max.x - min.x, ["height"] = max.y - min.y };
    }

    public static Task<JObject> Close()
    {
        var cleanup = new List<string>();
        bool contextValid = true;
        try { AssertCleanupIdentity(); } catch (Exception e) { contextValid = false; cleanup.Add("identity-guard: " + e.GetType().Name + ": " + e.Message); RecordFailure(e); }
        try
        {
            if (_captureHandlerAttached) RenderPipelineManager.endCameraRendering -= OnEndCameraRendering;
        }
        catch (Exception e) { cleanup.Add("detach-camera-observer: " + e.Message); RecordFailure(e); }
        finally { _captureHandlerAttached = false; _captureActive = false; }

        if (contextValid)
        {
            try
            {
                if (_canvasBefore != null && _stage != null && _stage.Camera != null)
                {
                    _stage.Camera.targetTexture = _cameraTargetBefore;
                    _stage.Camera.aspect = _cameraAspectBefore;
                }
            }
            catch (Exception e) { cleanup.Add("restore-camera-target: " + e.Message); RecordFailure(e); }
            try
            {
                if (_stage != null && _stage.Canvas != null && _canvasBefore != null)
                {
                    _stage.Canvas.renderMode = _canvasBefore.Mode;
                    _stage.Canvas.worldCamera = _canvasBefore.WorldCamera;
                    _stage.Canvas.planeDistance = _canvasBefore.PlaneDistance;
                    Canvas.ForceUpdateCanvases();
                }
            }
            catch (Exception e) { cleanup.Add("restore-canvas: " + e.Message); RecordFailure(e); }
        }

        foreach (var rt in OwnedTargets.ToArray())
        {
            try { if (rt != null) { rt.Release(); UnityEngine.Object.DestroyImmediate(rt); } }
            catch (Exception e) { cleanup.Add("destroy-owned-rt: " + e.Message); RecordFailure(e); }
        }
        OwnedTargets.Clear();

        if (contextValid)
        {
            try
            {
                string[] errors = TrainingLayoutStage.CloseActive();
                if (errors != null && errors.Length > 0)
                {
                    cleanup.AddRange(errors);
                    RecordFailure(new InvalidOperationException("Staged fixture reported cleanup errors: " + string.Join("; ", errors)));
                }
            }
            catch (Exception e) { cleanup.Add("close-owned-stage: " + e.Message); RecordFailure(e); }
            finally { _stage = null; }
        }

        if (_started && contextValid)
        {
            try
            {
                JObject current = CurrentGameViewFacts();
                if ((int)current["screenWidth"] != _screenW || (int)current["screenHeight"] != _screenH ||
                    (uint)current["playModeRenderingWidth"] != _viewW || (uint)current["playModeRenderingHeight"] != _viewH ||
                    (string)current["playModeViewType"] != _viewType || (string)current["screenFullScreenMode"] != _screenMode.ToString())
                    _viewFinalObservation = "Public Screen/GameView state differs from baseline; this host called no GameView setter; pointer acceptance remains open.";
            }
            catch (Exception e) { _viewFinalObservation = "Public GameView comparison unavailable: " + e.GetType().Name; }
        }
        _closed = true;
        JObject result = new JObject
        {
            ["success"] = cleanup.Count == 0,
            ["cleanupErrors"] = new JArray(cleanup),
            ["firstFailure"] = _firstFailure,
            ["final"] = Describe()
        };
        return Task.FromResult(result);
    }

    static void AssertCleanupIdentity()
    {
        string project = ProjectRoot();
        if (!string.Equals(project, ProjectPath, StringComparison.Ordinal)) throw new InvalidOperationException("Cleanup project path differs.");
        if (Application.unityVersion != "6000.0.85f2" || EditorUserBuildSettings.activeBuildTarget != BuildTarget.WebGL) throw new InvalidOperationException("Cleanup Unity version or target differs.");
        using (var process = Process.GetCurrentProcess())
        {
            if (process.Id != EditorPid || process.Id == ForbiddenPid) throw new InvalidOperationException("Cleanup Editor PID differs or is forbidden.");
            string binary = process.MainModule == null ? null : Path.GetFullPath(process.MainModule.FileName);
            if (!string.Equals(binary, EditorBinary, StringComparison.Ordinal)) throw new InvalidOperationException("Cleanup Editor executable differs.");
        }
        // Deliberately does not check source hashes/HEAD: cleanup of already-owned transient state must still run after source drift.
    }

    static Task WaitEditorFrames(Func<bool> predicate, int maxFrames)
    {
        var completion = new TaskCompletionSource<bool>();
        int frames = 0;
        EditorApplication.CallbackFunction callback = null;
        callback = () =>
        {
            try
            {
                EditorApplication.QueuePlayerLoopUpdate();
                if (predicate())
                {
                    EditorApplication.update -= callback;
                    completion.TrySetResult(true);
                }
                else if (++frames >= maxFrames)
                {
                    EditorApplication.update -= callback;
                    completion.TrySetResult(false);
                }
            }
            catch (Exception e)
            {
                EditorApplication.update -= callback;
                completion.TrySetException(e);
            }
        };
        EditorApplication.update += callback;
        EditorApplication.QueuePlayerLoopUpdate();
        return completion.Task;
    }
}
#endif

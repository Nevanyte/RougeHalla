/*
 * Dependency-free loopback routing proposal for the sealed Unity Web artifact.
 * Importing this module has no side effects. Runtime startup requires the explicit
 * `--standalone` flag and a hash/size-pinned manifest. No request data is logged.
 */
import {createHash} from 'node:crypto';
import {open, lstat, realpath} from 'node:fs/promises';
import {constants as fsConstants} from 'node:fs';
import {createServer as createHttpServer, request as httpRequest} from 'node:http';
import {connect as tcpConnect} from 'node:net';
import {pipeline} from 'node:stream/promises';
import {extname, isAbsolute, relative, resolve, sep} from 'node:path';
import {pathToFileURL} from 'node:url';

export const LISTEN_HOSTS = Object.freeze(['127.0.0.1', '::1']);
export const LISTEN_PORT = 8888;
export const ROUTER_MANIFEST_SCHEMA = 'unity-router-assets/1';
const UPSTREAMS = Object.freeze({source:7777,training:7779});
const CLIENT_MAX_ASSET_BYTES = 256 * 1024 * 1024;
const MAX_ASSET_BYTES_TOTAL = 512 * 1024 * 1024;
const MAX_ASSET_COUNT = 4096;
const MAX_MANIFEST_BYTES = 1024 * 1024;
const HASH = /^[a-f0-9]{64}$/;
const HOSTS = new Set(['localhost:8888']);
const VERIFIED_TABLES = new WeakMap();
const BLOCKED = ['/control', '/probe'];
const TRAINING_BLOCKED = ['/training/api', '/training/readyz', '/training/control', '/training/probe'];
const STATIC_MIME = Object.freeze({
  '.html':'text/html; charset=utf-8', '.htm':'text/html; charset=utf-8',
  '.js':'application/javascript; charset=utf-8', '.mjs':'application/javascript; charset=utf-8',
  '.wasm':'application/wasm', '.data':'application/octet-stream', '.unityweb':'application/octet-stream',
  '.bundle':'application/octet-stream', '.json':'application/json; charset=utf-8',
  '.css':'text/css; charset=utf-8', '.symbols.json':'application/json; charset=utf-8',
  '.png':'image/png', '.jpg':'image/jpeg', '.jpeg':'image/jpeg', '.webp':'image/webp', '.svg':'image/svg+xml',
  '.ico':'image/x-icon', '.mp3':'audio/mpeg', '.ogg':'audio/ogg', '.wav':'audio/wav',
  '.license':'text/plain; charset=utf-8', '.txt':'text/plain; charset=utf-8', '.mem':'application/octet-stream',
});

const generic = Object.freeze({body:'Unavailable\n',type:'text/plain; charset=utf-8'});
const pathStarts = (path, prefix) => path === prefix || path.startsWith(`${prefix}/`);
const isBlocked = (path, prefixes) => prefixes.some(prefix => path.startsWith(prefix));

function originForm(target) {
  if (typeof target !== 'string' || !target.startsWith('/') || target.startsWith('//') || target.includes('#')) return null;
  const q = target.indexOf('?');
  const rawPath = q < 0 ? target : target.slice(0, q);
  const query = q < 0 ? '' : target.slice(q); // opaque suffix copied through; never parsed or logged.
  if (rawPath.includes('%') || rawPath.includes('\\') || /[\u0000-\u001f\u007f]/.test(rawPath)) return null;
  const segments = rawPath.split('/');
  if (segments.some(s => s === '.' || s === '..')) return null;
  return {path:rawPath, query};
}

/** Resolve only the fixed routes; unmatched paths can only be exact static manifest entries. */
export function classifyRoute(method, requestTarget) {
  const parsed = originForm(requestTarget);
  if (!parsed) return Object.freeze({kind:'reject',status:400});
  const {path, query} = parsed;
  if (isBlocked(path, BLOCKED) || isBlocked(path, TRAINING_BLOCKED) || path === '/training' || path.startsWith('/training/')) {
    const training = path.startsWith('/training/');
    if (training && path === '/training/ws') return Object.freeze({kind:'proxy',upstream:UPSTREAMS.training,path:`/ws${query}`});
    for (const suffix of ['/info','/ping','/healthz']) {
      if (path === `/training${suffix}`) return Object.freeze({kind:'proxy',upstream:UPSTREAMS.training,path:`${suffix}${query}`});
    }
    return Object.freeze({kind:'reject',status:404});
  }
  if (isBlocked(path, BLOCKED)) return Object.freeze({kind:'reject',status:404});
  if (path === '/ws' || path === '/info' || path === '/ping' || path === '/healthz' || path === '/readyz' ||
      path === '/api' || pathStarts(path, '/api')) {
    return Object.freeze({kind:'proxy',upstream:UPSTREAMS.source,path:`${path}${query}`});
  }
  if (method !== 'GET' && method !== 'HEAD') return Object.freeze({kind:'reject',status:405});
  return Object.freeze({kind:'static',path});
}
export function acceptsLocalHost(host) { return HOSTS.has(host); }
export function isWebSocketRoute(route) {
  return route?.kind==='proxy'&&typeof route.path==='string'&&(route.path==='/ws'||route.path.startsWith('/ws?'));
}
export function forwardedHeaders(incoming,port,peer) {
  const headers={...incoming,host:`127.0.0.1:${port}`};
  if(typeof peer==='string'&&peer.length>0) headers['x-forwarded-for']=peer;
  else delete headers['x-forwarded-for'];
  return headers;
}

function safeRelativeFile(file) {
  return typeof file === 'string' && file.length > 0 && !isAbsolute(file) && !file.includes('\\') &&
    !file.includes('%') && !/[\u0000-\u001f\u007f]/.test(file) &&
    file.split('/').every(part => part && part !== '.' && part !== '..');
}
function safeUrlPath(path) {
  if (path === '/') return true; // Root is available only when explicitly present in the sealed manifest.
  return typeof path === 'string' && path.startsWith('/') && path.length > 1 && !path.includes('?') &&
    !path.includes('#') && !path.includes('\\') && !path.includes('%') && !/[\u0000-\u001f\u007f]/.test(path) &&
    path.split('/').slice(1).every(part => part && part !== '.' && part !== '..');
}
function mimeFor(path) {
  if (path === '/') return 'text/html; charset=utf-8';
  const plain = path.endsWith('.br') ? path.slice(0,-3) : path.endsWith('.gz') ? path.slice(0,-3) : path;
  const basename = plain.slice(plain.lastIndexOf('/')+1).toLowerCase();
  if (basename === 'license') return STATIC_MIME['.license'];
  if (basename.endsWith('.symbols.json')) return STATIC_MIME['.symbols.json'];
  return STATIC_MIME[extname(basename)] ?? null;
}
function manifestRow(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const allowed = ['path','file','sha256','bytes','contentType','encoding'];
  if (Object.keys(value).some(k => !allowed.includes(k))) return false;
  if (!safeUrlPath(value.path) || !safeRelativeFile(value.file) || !HASH.test(value.sha256 ?? '') ||
      !Number.isSafeInteger(value.bytes) || value.bytes < 0 || value.bytes > CLIENT_MAX_ASSET_BYTES ||
      typeof value.contentType !== 'string' || value.contentType !== mimeFor(value.path)) return false;
  if (value.encoding !== undefined && !['gzip','br'].includes(value.encoding)) return false;
  if (value.path.endsWith('.gz') !== (value.encoding === 'gzip') || value.path.endsWith('.br') !== (value.encoding === 'br')) return false;
  return true;
}

/** Validate and freeze a manifest using an injected byte loader; useful for offline tests. */
export async function validateAssetManifest(manifest, loadBytes) {
  if (!manifest || typeof manifest !== 'object' || Array.isArray(manifest) ||
      Object.keys(manifest).some(k => !['schema','files'].includes(k)) ||
      manifest.schema !== ROUTER_MANIFEST_SCHEMA || !Array.isArray(manifest.files) ||
      manifest.files.length === 0 || manifest.files.length > MAX_ASSET_COUNT || typeof loadBytes !== 'function')
    throw new Error('asset manifest refused');
  const entries = new Map(); let total = 0;
  for (const row of manifest.files) {
    if (!manifestRow(row) || entries.has(row.path)) throw new Error('asset manifest refused');
    total += row.bytes;
    if (total > MAX_ASSET_BYTES_TOTAL) throw new Error('asset manifest refused');
    const supplied = await loadBytes(row.file);
    if (!(supplied instanceof Uint8Array) || supplied.byteLength !== row.bytes) throw new Error('asset integrity refused');
    const bytes = Buffer.from(supplied);
    const digest = createHash('sha256').update(bytes).digest('hex');
    if (digest !== row.sha256) throw new Error('asset integrity refused');
    entries.set(row.path,Object.freeze({bytes,contentType:row.contentType,encoding:row.encoding ?? null}));
  }
  return entries;
}

async function openSealedFile(root, file) {
  if (!safeRelativeFile(file)) throw new Error('asset integrity refused');
  const rootInfo = await lstat(root);
  if (rootInfo.isSymbolicLink() || !rootInfo.isDirectory()) throw new Error('asset integrity refused');
  const rootReal = await realpath(root);
  const parts = file.split('/'); let current = rootReal;
  for (let i=0;i<parts.length;i++) {
    current = resolve(current,parts[i]);
    const info = await lstat(current);
    if (info.isSymbolicLink() || (i < parts.length-1 && !info.isDirectory()) || (i === parts.length-1 && !info.isFile()))
      throw new Error('asset integrity refused');
  }
  const rel = relative(rootReal,current);
  if (!rel || rel.startsWith(`..${sep}`) || rel === '..' || isAbsolute(rel)) throw new Error('asset integrity refused');
  const handle = await open(current, fsConstants.O_RDONLY | (fsConstants.O_NOFOLLOW ?? 0));
  try {
    const stat = await handle.stat({bigint:true});
    if (!stat.isFile() || stat.size > BigInt(CLIENT_MAX_ASSET_BYTES)) throw new Error('asset integrity refused');
    return {handle,stat};
  } catch (error) { await handle.close(); throw error; }
}

function sameStat(a,b) {
  return a.dev===b.dev && a.ino===b.ino && a.size===b.size && a.mtimeNs===b.mtimeNs && a.ctimeNs===b.ctimeNs;
}
async function readManifestFile(file) {
  const info=await lstat(file);
  if(info.isSymbolicLink()||!info.isFile()||info.size>MAX_MANIFEST_BYTES) throw new Error('asset manifest refused');
  const handle=await open(file,fsConstants.O_RDONLY|(fsConstants.O_NOFOLLOW??0));
  try {
    const stat=await handle.stat();
    if(!stat.isFile()||stat.size>MAX_MANIFEST_BYTES) throw new Error('asset manifest refused');
    return await handle.readFile();
  } finally {await handle.close();}
}
async function hashHandle(handle) {
  const digest=createHash('sha256');
  const stream=handle.createReadStream({autoClose:false,start:0});
  for await(const chunk of stream) digest.update(chunk);
  return digest.digest('hex');
}
/** Startup-only streamed integrity check. No whole Unity asset is retained in memory. */
export async function loadSealedAssets(manifestPath, root) {
  let manifest;
  try { manifest=JSON.parse((await readManifestFile(manifestPath)).toString('utf8')); }
  catch (_) { throw new Error('asset manifest refused'); }
  if(!manifest||typeof manifest!=='object'||Array.isArray(manifest)||
     Object.keys(manifest).some(k=>!['schema','files'].includes(k))||manifest.schema!==ROUTER_MANIFEST_SCHEMA||
     !Array.isArray(manifest.files)||manifest.files.length===0||manifest.files.length>MAX_ASSET_COUNT)
    throw new Error('asset manifest refused');
  const rootInfo=await lstat(root);
  if(rootInfo.isSymbolicLink()||!rootInfo.isDirectory()) throw new Error('asset manifest refused');
  const entries=new Map();let total=0;
  for(const row of manifest.files){
    if(!manifestRow(row)||entries.has(row.path)) throw new Error('asset manifest refused');
    total+=row.bytes;if(total>MAX_ASSET_BYTES_TOTAL) throw new Error('asset manifest refused');
    const {handle,stat}=await openSealedFile(root,row.file);
    try{
      const digest=await hashHandle(handle);
      const after=await handle.stat({bigint:true});
      if(!sameStat(stat,after)||BigInt(row.bytes)!==after.size||digest!==row.sha256) throw new Error('asset integrity refused');
      const identity=Object.freeze({dev:after.dev,ino:after.ino,size:after.size,mtimeNs:after.mtimeNs,ctimeNs:after.ctimeNs});
      entries.set(row.path,Object.freeze({root,file:row.file,identity,bytes:row.bytes,sha256:row.sha256,
        contentType:row.contentType,encoding:row.encoding??null}));
    }finally{await handle.close();}
  }
  VERIFIED_TABLES.set(entries,new Map(entries));
  return entries;
}

function writeFixed(res,status,body=generic.body,type=generic.type) {
  if (res.headersSent) { res.destroy(); return; }
  res.writeHead(status,{'content-type':type,'content-length':Buffer.byteLength(body),'cache-control':'no-store'});
  res.end(body);
}
function upstreamHeaders(req, port) {
  // Header values are copied opaquely. Host and X-Forwarded-For are replaced with fixed/local facts.
  return forwardedHeaders(req.headers,port,req.socket.remoteAddress);
}
function proxyHttp(req,res,route,activeHttp) {
  let upstream;
  try {
    upstream = httpRequest({host:'127.0.0.1',port:route.upstream,method:req.method,path:route.path,
      headers:upstreamHeaders(req,route.upstream),agent:false}, upstreamRes=>{
      upstreamRes.on('error',()=>res.destroy());
      res.writeHead(upstreamRes.statusCode ?? 502,upstreamRes.headers); upstreamRes.pipe(res);
    });
  } catch (_) { writeFixed(res,502); return; }
  activeHttp.add(upstream);
  upstream.once('close',()=>activeHttp.delete(upstream));
  const cancel=()=>upstream.destroy();
  req.once('aborted',cancel);
  res.once('close',()=>{if(!res.writableFinished)cancel();});
  upstream.on('error',()=>writeFixed(res,502));
  req.pipe(upstream);
}
function proxyUpgrade(req,socket,head,route,activeTunnels) {
  const upstream = tcpConnect({host:'127.0.0.1',port:route.upstream});
  const pair={client:socket,upstream};activeTunnels.add(pair);
  let closed=false;
  const remove=()=>{if(closed)return;closed=true;activeTunnels.delete(pair);};
  const failBoth=()=>{remove();upstream.destroy();socket.destroy();};
  upstream.once('error',failBoth);socket.once('error',failBoth);
  upstream.once('connect',()=>{
    if(socket.destroyed){failBoth();return;}
    const rawHeaders=req.rawHeaders ?? [];
    let hostWritten=false;
    const lines=[];
    for(let i=0;i<rawHeaders.length;i+=2){
      const name=rawHeaders[i],value=rawHeaders[i+1];
      const lowerName=String(name).toLowerCase();
      if(lowerName==='x-forwarded-for') continue;
      if(lowerName==='host'){
        if(!hostWritten) lines.push(`Host: 127.0.0.1:${route.upstream}`);
        hostWritten=true;
      }else lines.push(`${name}: ${value}`);
    }
    if(!hostWritten) lines.push(`Host: 127.0.0.1:${route.upstream}`);
    const peer=req.socket.remoteAddress;
    if(peer) lines.push(`X-Forwarded-For: ${peer}`);
    upstream.write(`${req.method} ${route.path} HTTP/${req.httpVersion}\r\n${lines.join('\r\n')}\r\n\r\n`);
    if(head?.length) upstream.write(head);
    socket.pipe(upstream);upstream.pipe(socket);
  });
  socket.once('close',()=>{remove();upstream.destroy();});
  upstream.once('close',()=>{remove();socket.destroy();});
}

function handler(assets,activeHttp) {
  return (req,res)=>{
    if (!acceptsLocalHost(req.headers.host)) return writeFixed(res,421);
    const route=classifyRoute(req.method ?? 'GET',req.url ?? '');
    if(route.kind==='reject') return writeFixed(res,route.status,route.status===405?'Method Not Allowed\n':generic.body);
    if(route.kind==='proxy') return proxyHttp(req,res,route,activeHttp);
    const asset=assets.get(route.path);
    if(!asset) return writeFixed(res,404);
    void serveStatic(req,res,asset);
  };
}

async function serveStatic(req,res,asset) {
  let opened;
  try{
    opened=await openSealedFile(asset.root,asset.file);
    if(!sameStat(opened.stat,asset.identity)||opened.stat.size!==BigInt(asset.bytes)) throw new Error('asset changed');
    const etag=`"${asset.sha256}"`;
    const headers={'content-type':asset.contentType,'content-length':asset.bytes,'cache-control':'no-cache',
      'etag':etag,'x-content-type-options':'nosniff'};
    if(asset.encoding) headers['content-encoding']=asset.encoding;
    const conditional=req.headers['if-none-match'];
    if(typeof conditional==='string'&&conditional.split(',').some(tag=>tag.trim()==='*'||tag.trim()===etag)){
      delete headers['content-length'];await opened.handle.close();res.writeHead(304,headers);res.end();return;
    }
    res.writeHead(200,headers);
    if(req.method==='HEAD'||asset.bytes===0){res.end();await opened.handle.close();return;}
    const stream=opened.handle.createReadStream({autoClose:false,start:0,end:asset.bytes-1});
    try{await pipeline(stream,res);}finally{await opened.handle.close();}
  }catch(_){if(opened) await opened.handle.close().catch(()=>{});writeFixed(res,503);}
}

function upgradeHandler(activeTunnels) {
  return (req,socket,head)=>{
    if (!acceptsLocalHost(req.headers.host)) { socket.end('HTTP/1.1 421 Misdirected Request\r\nContent-Length: 0\r\n\r\n'); return; }
    const route=classifyRoute('GET',req.url ?? '');
    if(isWebSocketRoute(route))
      return proxyUpgrade(req,socket,head,route,activeTunnels);
    socket.end('HTTP/1.1 404 Not Found\r\nContent-Length: 0\r\n\r\n');
  };
}

/** Create listeners without starting them. Call listenLocalOnly explicitly. */
export function createLocalRouter(assets) {
  const verified=assets instanceof Map ? VERIFIED_TABLES.get(assets) : null;
  if (!verified || verified.size===0) throw new Error('sealed assets required');
  const sealedAssets=new Map(verified);
  const activeHttp=new Set();
  const activeTunnels=new Set();
  const ownedSockets=new Set();
  const servers=LISTEN_HOSTS.map(()=>createHttpServer(handler(sealedAssets,activeHttp)));
  for(const server of servers){
    server.on('upgrade',upgradeHandler(activeTunnels));
    server.on('connection',socket=>{
      ownedSockets.add(socket);
      socket.once('close',()=>ownedSockets.delete(socket));
    });
  }
  const closeOwned=async()=>{
    for(const upstream of activeHttp) upstream.destroy();
    activeHttp.clear();
    for(const pair of activeTunnels){pair.client.destroy();pair.upstream.destroy();}
    activeTunnels.clear();
    for(const socket of ownedSockets) socket.destroy();
    ownedSockets.clear();
    await Promise.all(servers.map(server=>new Promise(resolveClose=>{
      if(!server.listening)return resolveClose();
      try{server.close(()=>resolveClose());}catch(_){resolveClose();}
    })));
  };
  return Object.freeze({
    listenLocalOnly(){
      const attempts=servers.map((server,i)=>new Promise((resolveListen,reject)=>{
        const onError=error=>{server.off('listening',onListen);reject(error);};
        const onListen=()=>{server.off('error',onError);resolveListen(server);};
        server.once('error',onError);server.once('listening',onListen);
        server.listen({host:LISTEN_HOSTS[i],port:LISTEN_PORT,ipv6Only:LISTEN_HOSTS[i]==='::1'});
      }));
      return Promise.allSettled(attempts).then(async results=>{
        if(results.some(result=>result.status==='rejected')){
          await closeOwned();
          throw new Error('loopback listener unavailable');
        }
      });
    },
    close:closeOwned,
  });
}

async function standalone() {
  if (!process.argv.includes('--standalone')) throw new Error('explicit --standalone required');
  const manifestPath=process.env.RH_ROUTER_MANIFEST,root=process.env.RH_ROUTER_ROOT;
  if (!manifestPath || !root) throw new Error('sealed manifest and root required');
  const assets=await loadSealedAssets(manifestPath,root);
  const router=createLocalRouter(assets);
  await router.listenLocalOnly();
  process.stdout.write('Local router listening on localhost:8888.\n');
  // No request values are written to stdout/stderr.
  const stop=()=>{void router.close().finally(()=>process.exit(0));};
  process.once('SIGINT',stop);process.once('SIGTERM',stop);
}

if (process.argv[1] && import.meta.url===pathToFileURL(process.argv[1]).href) {
  if (!process.argv.includes('--standalone')) throw new Error('explicit --standalone required');
  void standalone().catch(()=>{process.stderr.write('Local router startup refused.\n');process.exitCode=1;});
}

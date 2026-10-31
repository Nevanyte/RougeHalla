import { build } from "esbuild";
import { convertV4MiniflareOptions, Miniflare } from "miniflare";
import path from "node:path";
import { expect, it } from "vitest";
import { networkProbeAuthorized, networkProbeLayer } from "../src/networkProbe";

it("requires a dedicated diagnostic credential", () => {
  const token = "a".repeat(64);
  expect(networkProbeAuthorized(new Request("https://game/"), token)).toBe(false);
  expect(networkProbeAuthorized(new Request("https://game/", { headers: { Authorization: `Bearer ${token}` } }), undefined)).toBe(false);
  expect(networkProbeAuthorized(new Request("https://game/", { headers: { Authorization: `Bearer ${token.slice(0,-1)}b` } }), token)).toBe(false);
  expect(networkProbeAuthorized(new Request("https://game/", { headers: { Authorization: `Bearer ${token}` } }), token)).toBe(true);
});

it("recognizes only exact diagnostic layers", () => {
  expect(networkProbeLayer("/_diagnostics/net/origin")).toBe("origin");
  expect(networkProbeLayer("/_diagnostics/net/coordinator")).toBe("coordinator");
  expect(networkProbeLayer("/_diagnostics/net/edge")).toBe("edge");
  expect(networkProbeLayer("/_diagnostics/net/origin/other")).toBeNull();
});
it("echoes bounded binary probe frames and closes malformed input", async () => {
  const built = await build({ stdin: { contents: "import {networkProbeEcho} from './src/networkProbe'; export default {fetch(){return networkProbeEcho('edge')}}", resolveDir:path.resolve("deployment/cloudflare") }, bundle:true,write:false,format:"esm",platform:"browser" });
  const mf = new Miniflare(convertV4MiniflareOptions({modules:true,script:built.outputFiles[0]!.text,compatibilityDate:"2026-10-28"}));
  try {
    const res = await mf.dispatchFetch("http://game.example/", {headers:{Upgrade:"websocket"}});
    expect(res.status).toBe(101);const ws=res.webSocket!;ws.accept();
    const data=new ArrayBuffer(8);new DataView(data).setUint32(0,0x52484c50,true);
    const received=new Promise(resolve=>ws.addEventListener("message",e=>resolve(e.data),{once:true}));ws.send(data);
    expect([...new Uint8Array(await received as ArrayBuffer)]).toEqual([...new Uint8Array(data)]);
    const closed=new Promise(resolve=>ws.addEventListener("close",e=>resolve(e.code),{once:true}));ws.send("not a probe");expect(await closed).toBe(1008);
  } finally {await mf.dispose()}
});

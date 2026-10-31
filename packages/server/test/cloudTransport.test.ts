import http from "node:http";
import type { AddressInfo } from "node:net";
import WebSocket from "ws";
import { expect, it } from "vitest";
import { CloudflareTransport } from "../src/CloudflareTransport";

class EchoTransport extends CloudflareTransport {
  protected override async onConnection(raw: WebSocket & { pingCount: number }): Promise<void> {
    raw.pingCount = 0;
    raw.on("pong", () => { raw.pingCount = 0; });
  }
}

it("keeps a proxy peer alive on application traffic but terminates it when all replies stop", async () => {
  const server = http.createServer();
  const transport = new EchoTransport({ server, pingInterval: 50, pingMaxRetries: 2 });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const client = new WebSocket(`ws://127.0.0.1:${(server.address() as AddressInfo).port}/test`, { autoPong: false });
  let timer: ReturnType<typeof setInterval> | undefined;
  try {
    await new Promise<void>((resolve, reject) => { client.once("open", resolve); client.once("error", reject); });
    const closed = new Promise<void>((resolve) => client.once("close", () => resolve()));
    timer = setInterval(() => { if (client.readyState === WebSocket.OPEN) client.send(new Uint8Array([20])); }, 20);
    await new Promise((resolve) => setTimeout(resolve, 400));
    expect(client.readyState).toBe(WebSocket.OPEN);
    expect(transport.diagnostics.pongs).toBe(0);
    clearInterval(timer);
    await Promise.race([closed, new Promise((_, reject) => setTimeout(() => reject(new Error("idle peer was not closed")), 1000))]);
    expect(client.readyState).toBe(WebSocket.CLOSED);
  } finally {
    clearInterval(timer);
    client.terminate();
    await transport.shutdown();
  }
});

it("measures origin echo work without claiming a room and rejects malformed frames", async () => {
  const server = http.createServer();
  const transport = new CloudflareTransport({ server });
  await new Promise<void>(resolve => server.listen(0,"127.0.0.1",resolve));
  const client = new WebSocket(`ws://127.0.0.1:${(server.address() as AddressInfo).port}/_diagnostics/net/origin`);
  try {
    await new Promise<void>((resolve,reject)=>{client.once("open",resolve);client.once("error",reject)});
    const request=Buffer.alloc(8);request.writeUInt32LE(0x52484c50,0);request.writeUInt32LE(7,4);
    const received=new Promise<Buffer>(resolve=>client.once("message",data=>resolve(data as Buffer)));client.send(request);
    const reply=await received;expect(reply.length).toBe(32);expect(reply.subarray(0,8)).toEqual(request);
    expect(reply.readDoubleLE(8)).toBeGreaterThanOrEqual(0);expect(reply.readDoubleLE(16)).toBeGreaterThanOrEqual(0);expect(reply.readDoubleLE(24)).toBe(0);
    const closed=new Promise<number>(resolve=>client.once("close",resolve));client.send("invalid");expect(await closed).toBe(1008);
  } finally {client.terminate();await transport.shutdown()}
});

it("bounds simultaneous origin probes before allocating another timing histogram", async () => {
  const server=http.createServer(),transport=new CloudflareTransport({server});
  await new Promise<void>(resolve=>server.listen(0,"127.0.0.1",resolve));
  const url=`ws://127.0.0.1:${(server.address() as AddressInfo).port}/_diagnostics/net/origin`;
  const clients: WebSocket[]=[];
  try {
    for(let i=0;i<4;i++){
      const client=new WebSocket(url);clients.push(client);
      await new Promise<void>((resolve,reject)=>{client.once("open",resolve);client.once("error",reject)});
    }
    const extra=new WebSocket(url);clients.push(extra);
    expect(await new Promise<number>((resolve,reject)=>{extra.once("close",resolve);extra.once("error",reject)})).toBe(1013);
  } finally {for(const client of clients)client.terminate();await transport.shutdown()}
});

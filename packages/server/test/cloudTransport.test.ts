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

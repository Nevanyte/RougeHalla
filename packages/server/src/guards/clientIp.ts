import { isIP } from "node:net";
import type { Server } from "node:http";

/**
 * Who is asking, for the per-address caps (new callsigns, wrong passcodes). Only the socket is trusted: the peer address, or,
 * when that peer is this machine, the address Cloudflare names in `CF-Connecting-IP`. cloudflared connects from loopback and
 * Cloudflare's edge overwrites the header, so through the tunnel it is the real visitor. A caller that reaches the port
 * directly (the LAN, a port forward, a VPS with no Cloudflare in front) can send any header it likes, so for a peer that
 * is not loopback the header is ignored and the socket's address counts. `X-Forwarded-For` and its cousins are never read.
 */
export function isLoopback(address: string | undefined): boolean {
  if (!address) return false;
  return address === "::1" || address === "127.0.0.1" || address === "::ffff:127.0.0.1" || /^127\.\d+\.\d+\.\d+$/.test(address);
}

/** The address a request counts under. `forwarded` is the raw CF-Connecting-IP header value (a repeated header counts as absent). */
export function clientAddress(peer: string | undefined, forwarded: string | string[] | undefined, trustProxy = false): string {
  if ((isLoopback(peer) || trustProxy) && typeof forwarded === "string") {
    const claimed = forwarded.trim();
    if (claimed.length <= 45 && isIP(claimed) !== 0) return claimed.toLowerCase();
  }
  return peer || "unknown";
}

/**
 * Colyseus hands a matchmaking request's `onAuth` its headers and an `ip` it takes from `X-Real-IP` or `X-Forwarded-For`
 * (anything the caller wrote), and not the socket. So every request is stamped with the address above in this header,
 * written by the server itself after dropping whatever the caller sent under that name, before Colyseus reads it.
 */
export const CLIENT_ADDRESS_HEADER = "x-raid-client-address";

/** Stamps every HTTP request the server receives (`emit` runs before any listener, Colyseus's own router included). */
export function stampClientAddress(server: Server, trustProxy = false): void {
  const emit = server.emit.bind(server) as (event: string | symbol, ...args: unknown[]) => boolean;
  (server as { emit: unknown }).emit = (event: string | symbol, ...args: unknown[]): boolean => {
    if (event === "request") {
      const req = args[0] as { headers: Record<string, string | string[] | undefined>; socket?: { remoteAddress?: string } };
      req.headers[CLIENT_ADDRESS_HEADER] = clientAddress(req.socket?.remoteAddress, req.headers["cf-connecting-ip"], trustProxy);
    }
    return emit(event, ...args);
  };
}

/** The stamped address of a matchmaking request ("unknown" for a call that did not come through the HTTP server). */
export function addressOfContext(context: { headers?: { get(name: string): string | null } } | undefined): string {
  return context?.headers?.get(CLIENT_ADDRESS_HEADER) || "unknown";
}

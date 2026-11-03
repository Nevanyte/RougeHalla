import { LOBBY_PRESENCE_TTL_MS, type LobbyGame, type LobbyPerson, type LobbySnapshot } from "@raid/shared";

const MAX_PROFILES = 512;
const MAX_TABS_PER_PROFILE = 8;

export interface RoomPresence {
  training: boolean;
  joinable: boolean;
  phase: LobbyGame["phase"];
  startedAt: number | null;
  players: LobbyGame["players"];
  joinedNames: string[];
}

/** In-memory lobby presence. Expiry is lazy, so an idle lobby creates no permanent timer. */
export class LobbyStatus {
  private readonly leases = new Map<string, Map<string, number>>();
  private readonly rooms = new Map<string, RoomPresence | (() => RoomPresence)>();

  touch(name: string, tabId: string, now = Date.now()): boolean {
    this.expire(now);
    let tabs = this.leases.get(name);
    if (!tabs) {
      if (this.leases.size >= MAX_PROFILES) return false;
      tabs = new Map();
      this.leases.set(name, tabs);
    }
    if (!tabs.has(tabId) && tabs.size >= MAX_TABS_PER_PROFILE) return false;
    tabs.set(tabId, now + LOBBY_PRESENCE_TTL_MS);
    return true;
  }

  leave(name: string, tabId: string): void {
    const tabs = this.leases.get(name);
    tabs?.delete(tabId);
    if (tabs?.size === 0) this.leases.delete(name);
  }

  updateRoom(id: string, room: RoomPresence): void { this.rooms.set(id, room); }
  registerRoomSource(id: string, room: () => RoomPresence): void { this.rooms.set(id, room); }
  removeRoom(id: string): void { this.rooms.delete(id); }

  snapshot(arenaLimit: number, arenaRoomCount: number, now = Date.now()): LobbySnapshot {
    this.expire(now);
    const rooms = [...this.rooms.values()].map(source => typeof source === "function" ? source() : source);
    const publicRoom = rooms.find(room => !room.training);
    const occupied = new Set(rooms.flatMap(room => room.joinedNames));
    const waiting: LobbyPerson[] = [...this.leases.keys()]
      .filter(name => !occupied.has(name))
      .sort((a, b) => a.localeCompare(b))
      .map(name => ({ name }));
    const unlimited = arenaLimit <= 0;
    const arenaAvailable = unlimited || arenaRoomCount < arenaLimit || rooms.some(room => !room.training && room.joinable);
    const visibleHumans = new Set(waiting.map(person => person.name));
    if (publicRoom) for (const player of publicRoom.players) if (player.kind === "human") visibleHumans.add(player.name);
    return {
      serverNow: now,
      activeGame: publicRoom ? {
        phase: publicRoom.phase,
        startedAt: publicRoom.startedAt,
        players: publicRoom.players.map(player => ({ ...player })),
      } : null,
      waiting,
      onlineCount: visibleHumans.size,
      arenaLimit: unlimited ? null : arenaLimit,
      arenaRoomCount,
      arenaAvailable,
    };
  }

  private expire(now: number): void {
    for (const [name, tabs] of this.leases) {
      for (const [tabId, expiresAt] of tabs) if (expiresAt <= now) tabs.delete(tabId);
      if (tabs.size === 0) this.leases.delete(name);
    }
  }
}

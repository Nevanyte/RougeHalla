import { el } from "./dom";
import { fetchLobbySnapshot, heartbeatLobbyPresence, releaseLobbyPresence, type LobbyGame, type LobbySnapshot } from "../net/lobby";
import "./lobbyActivity.css";

const SNAPSHOT_MS = 15_000;
const STALE_MS = 30_000;

function elapsed(ms: number): string {
  const seconds = Math.max(0, Math.floor(ms / 1000));
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor(seconds / 60) % 60;
  const remainder = seconds % 60;
  return hours > 0 ? `${hours}h ${String(minutes).padStart(2, "0")}m` : `${minutes}m ${String(remainder).padStart(2, "0")}s`;
}

function phaseName(game: LobbyGame): string {
  switch (game.phase) {
    case "lobby": return "Gathering players";
    case "planning": return "Planning";
    case "active": return "Run in progress";
    case "finished": return "Finished";
  }
}

export class LobbyActivity {
  readonly root = el("section", "lobby-activity");
  private readonly status = el("p", "lobby-status", "Checking lobby activity…");
  private readonly title = el("h2", undefined, "Lobby activity");
  private readonly capacity = el("p", "lobby-capacity");
  private readonly gameSection = el("section", "lobby-group");
  private readonly waitingSection = el("section", "lobby-group");
  private readonly heartbeatStatus = el("span", "lobby-presence");
  private snapshot: LobbySnapshot | null = null;
  private updatedAt = 0;
  private snapshotPerf = 0;
  private menuVisible = false;
  private profile: { name: string; token: string } | null = null;
  private hasLease = false;
  private pollTimer: ReturnType<typeof setInterval> | null = null;
  private clockTimer: ReturnType<typeof setInterval> | null = null;
  private pollController: AbortController | null = null;
  private pollSeq = 0;
  private staleShown: boolean | null = null;
  private rosterKey = "";
  private capacityKey = "";
  private duration: HTMLElement | null = null;
  private readonly onVisibility = (): void => {
    if (document.visibilityState === "hidden") this.pauseTimers();
    else this.resumeTimers();
  };

  constructor() {
    this.root.setAttribute("aria-label", "Lobby activity");
    const heading = el("div", "lobby-heading");
    heading.append(this.title, this.heartbeatStatus);
    this.gameSection.append(el("h3", undefined, "Active game"));
    this.waitingSection.append(el("h3", undefined, "Waiting in the hub"));
    this.root.append(heading, this.status, this.capacity, this.gameSection, this.waitingSection);
    document.addEventListener("visibilitychange", this.onVisibility);
  }

  /** Public snapshot polling runs before login too; presence starts only after the profile is authenticated. */
  show(): void {
    this.menuVisible = true;
    this.resumeTimers();
  }

  /** Stop polling on run entry/menu leave and release this tab's authenticated presence lease. */
  hide(): void {
    this.menuVisible = false;
    this.pauseTimers();
  }

  setIdentity(value: { name: string; token: string } | null): void {
    if (this.profile?.name === value?.name && this.profile?.token === value?.token) return;
    this.pollController?.abort();
    this.pollController = null;
    this.pollSeq++;
    this.releaseCurrentLease();
    this.profile = value;
    this.hasLease = false;
    this.heartbeatStatus.textContent = "";
    if (this.menuVisible && document.visibilityState !== "hidden") void this.updateSnapshot();
  }

  private resumeTimers(): void {
    if (!this.menuVisible || document.visibilityState === "hidden" || this.pollTimer !== null) return;
    void this.updateSnapshot();
    this.pollTimer = setInterval(() => void this.updateSnapshot(), SNAPSHOT_MS);
    this.clockTimer = setInterval(() => this.renderClock(), 1000);
  }

  private pauseTimers(): void {
    if (this.pollTimer !== null) clearInterval(this.pollTimer);
    if (this.clockTimer !== null) clearInterval(this.clockTimer);
    this.pollTimer = this.clockTimer = null;
    this.pollController?.abort(); this.pollController = null; this.pollSeq++;
    this.releaseCurrentLease();
  }

  private releaseCurrentLease(): void {
    if (!this.profile || !this.hasLease) return;
    const { name, token } = this.profile;
    this.hasLease = false;
    void releaseLobbyPresence(name, token);
  }

  private async updateSnapshot(): Promise<void> {
    if (this.pollController) return;
    const seq = ++this.pollSeq;
    const controller = new AbortController();
    this.pollController = controller;
    const profile = this.profile;
    if (profile) this.hasLease = true;
    const snapshot = profile
      ? await heartbeatLobbyPresence(profile.name, profile.token, controller.signal)
      : await fetchLobbySnapshot(controller.signal);
    if (seq !== this.pollSeq || controller.signal.aborted || this.profile !== profile) return;
    this.pollController = null;
    if (snapshot) {
      this.snapshot = snapshot;
      this.updatedAt = Date.now();
      this.snapshotPerf = performance.now();
      this.heartbeatStatus.textContent = profile ? "Presence active" : "";
    } else if (profile) {
      this.heartbeatStatus.textContent = "Presence not confirmed";
    }
    this.renderSnapshot();
  }

  private isStale(): boolean {
    return this.snapshot === null || Date.now() - this.updatedAt > STALE_MS;
  }

  private renderClock(): void {
    const stale = this.isStale();
    if (this.staleShown !== stale) this.renderSnapshot();
    if (stale) return;
    this.status.textContent = `Updated ${elapsed(Date.now() - this.updatedAt)} ago`;
    const game = this.snapshot?.activeGame;
    if (!game || !this.duration) return;
    const runMs = game.startedAt === null ? 0 : Math.max(0, this.snapshot!.serverNow - game.startedAt + (game.phase === "finished" ? 0 : performance.now() - this.snapshotPerf));
    this.duration.textContent = game.startedAt === null ? "Not started"
      : game.phase === "finished" ? `Finished · ${elapsed(runMs)} total` : `${elapsed(runMs)} playing`;
  }

  private renderSnapshot(): void {
    const stale = this.snapshot === null || Date.now() - this.updatedAt > STALE_MS;
    this.staleShown = stale;
    if (stale) this.title.textContent = "Lobby activity";
    this.status.textContent = stale
      ? (this.updatedAt ? "Lobby activity is out of date. Refreshing…" : "Lobby activity is unavailable. Retrying…")
      : `Updated ${elapsed(Date.now() - this.updatedAt)} ago`;
    this.status.classList.toggle("unavailable", stale);
    if (stale || !this.snapshot) {
      this.rosterKey = "";
      this.capacityKey = "";
      this.capacity.textContent = "Arena availability is unavailable.";
      this.gameSection.replaceChildren(el("h3", undefined, "Active game"), el("p", "lobby-empty", "Current players unavailable."));
      this.waitingSection.replaceChildren(el("h3", undefined, "Waiting in the hub"), el("p", "lobby-empty", "Current players unavailable."));
      this.duration = null;
      return;
    }

    const s = this.snapshot;
    this.title.textContent = `Lobby activity · ${s.onlineCount} online`;
    this.renderCapacity(s);

    const game = s.activeGame;
    const nextRosterKey = JSON.stringify([game, s.waiting]);
    if (nextRosterKey !== this.rosterKey) {
      this.rosterKey = nextRosterKey;
      if (!game) {
        this.gameSection.replaceChildren(el("h3", undefined, "Active game"), el("p", "lobby-empty", "No active game right now."));
        this.duration = null;
      } else {
        const humans = game.players.filter(player => player.kind === "human").length;
        const bots = game.players.length - humans;
        const summary = bots > 0 ? `${humans} humans · ${bots} bots` : `${humans} humans`;
        const heading = el("div", "lobby-game-head");
        this.duration = el("span", "lobby-duration");
        heading.append(el("strong", undefined, phaseName(game)), this.duration);
        const people = el("ul", "lobby-people");
        for (const player of game.players) {
          const item = el("li", "lobby-person");
          item.append(el("span", "lobby-person-name", player.name), el("span", `lobby-kind ${player.kind}`, player.kind === "bot" ? "Bot" : "Human"));
          if (!player.alive && (game.phase === "active" || game.phase === "finished")) item.append(el("span", "lobby-out", "Out"));
          people.append(item);
        }
        if (game.players.length === 0) people.append(el("li", "lobby-empty", "Waiting for players to join."));
        this.gameSection.replaceChildren(el("h3", undefined, `Active game · ${summary}`), heading, people);
      }

      const waiters = s.waiting;
      const list = el("ul", "lobby-people");
      for (const person of waiters) {
        const item = el("li", "lobby-person");
        item.append(el("span", "lobby-person-name", person.name), el("span", "lobby-kind human", "Human"));
        list.append(item);
      }
      if (waiters.length === 0) list.append(el("li", "lobby-empty", "No players waiting in the hub."));
      this.waitingSection.replaceChildren(el("h3", undefined, `Waiting in the hub · ${waiters.length}`), list);
    }
    this.renderClock();
  }

  private renderCapacity(snapshot: LobbySnapshot): void {
    const text = snapshot.arenaAvailable
      ? snapshot.arenaLimit !== null && snapshot.arenaRoomCount >= snapshot.arenaLimit
        ? "Current lobby is accepting players."
        : snapshot.arenaLimit === null
          ? "Arena currently available."
          : `Open arena slots: ${Math.max(0, snapshot.arenaLimit - snapshot.arenaRoomCount)} of ${snapshot.arenaLimit}.`
      : snapshot.arenaLimit === 1
        ? "Arena full: only one game can run at a time."
        : `Arena full: all ${snapshot.arenaLimit ?? snapshot.arenaRoomCount} game slots are occupied.`;
    const key = `${snapshot.arenaAvailable}|${snapshot.arenaLimit}|${snapshot.arenaRoomCount}|${text}`;
    if (key !== this.capacityKey) {
      this.capacityKey = key;
      this.capacity.textContent = text;
      this.capacity.classList.toggle("full", !snapshot.arenaAvailable);
    }
  }
}

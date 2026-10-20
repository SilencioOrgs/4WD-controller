import { RobotApi } from "./robot-api";
import { ROBOT_DEVICE_ID, ROBOT_HOST, type Direction, type Preset, type RobotStatus } from "./protocol";
import type { PlantConfig } from "./plant-plan";

export type Transport = "ws" | "http";
export type LinkHealth = {
  connected: boolean; transport: Transport; failures: number;
  lastRttMs: number | null; avgRttMs: number | null;
};
export type StatusListener = (status: RobotStatus) => void;
export type HealthListener = (health: LinkHealth) => void;

export function reconnectDelay(attempt: number) {
  return Math.min(1500, 250 * (2 ** Math.max(0, Math.min(attempt, 3))));
}
export function selectTransport(wsOpen: boolean, fallbackReady: boolean): Transport | null {
  return wsOpen ? "ws" : fallbackReady ? "http" : null;
}

export interface RobotLink {
  connect(): Promise<void>;
  drive(dir: Direction): Promise<void>;
  stop(): Promise<void>;
  heartbeat(): Promise<void>;
  gate(channel: 1 | 2, position: "open" | "close"): Promise<void>;
  startAutopilot(config: PlantConfig | { preset: "cruise" | "pulse" }): Promise<void>;
  onStatus(cb: StatusListener): () => void;
  onHealth(cb: HealthListener): () => void;
  close(): void;
  readonly transport: Transport;
  readonly health: LinkHealth;
}

export class HttpTransport {
  private driveAbort: AbortController | null = null;
  readonly api: RobotApi;
  constructor(api = new RobotApi()) { this.api = api; }
  status() { return this.api.status(); }
  drive(dir: Direction) {
    this.driveAbort?.abort();
    const ctrl = new AbortController();
    this.driveAbort = ctrl;
    return this.api.drive(dir, ctrl.signal).finally(() => {
      if (this.driveAbort === ctrl) this.driveAbort = null;
    });
  }
  stop() {
    this.driveAbort?.abort();
    this.driveAbort = null;
    return this.api.stop();
  }
  heartbeat() { return this.api.heartbeat(); }
  gate(channel: 1 | 2, position: "open" | "close") {
    return this.api.gate(channel, position);
  }
  startAutopilot(config: PlantConfig | { preset: "cruise" | "pulse" }) {
    return this.api.autopilot(config);
  }
  close() { this.driveAbort?.abort(); }
}

export class WsTransport {
  private socket: WebSocket | null = null;
  private intentional = false;
  private attempts = 0;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private statusListeners = new Set<(text: string) => void>();
  private closeListeners = new Set<() => void>();
  private openListeners = new Set<() => void>();
  private ackListeners = new Set<(seq: number) => void>();
  constructor(private readonly url = "ws://192.168.4.1:81") {}
  get open() { return this.socket?.readyState === WebSocket.OPEN; }
  onStatus(fn: (text: string) => void) { this.statusListeners.add(fn); return () => this.statusListeners.delete(fn); }
  onClose(fn: () => void) { this.closeListeners.add(fn); return () => this.closeListeners.delete(fn); }
  onOpen(fn: () => void) { this.openListeners.add(fn); return () => this.openListeners.delete(fn); }
  onAck(fn: (seq: number) => void) { this.ackListeners.add(fn); return () => this.ackListeners.delete(fn); }
  connect() {
    if (this.intentional || this.socket?.readyState === WebSocket.CONNECTING || this.open) return;
    try {
      const ws = new WebSocket(this.url);
      this.socket = ws;
      ws.onopen = () => {
        if (ws !== this.socket) return;
        this.attempts = 0;
        this.openListeners.forEach(fn => fn());
        this.send("Q");
      };
      ws.onmessage = event => {
        if (ws !== this.socket || typeof event.data !== "string") return;
        const raw = event.data;
        if (raw.startsWith("T:")) this.statusListeners.forEach(fn => fn(raw.slice(2)));
        else if (raw.startsWith("ACK:")) {
          const seq = Number(raw.slice(4));
          if (Number.isSafeInteger(seq)) this.ackListeners.forEach(fn => fn(seq));
        }
      };
      ws.onclose = () => {
        if (ws !== this.socket) return;
        this.socket = null;
        this.closeListeners.forEach(fn => fn());
        this.retry();
      };
      ws.onerror = () => { if (ws.readyState !== WebSocket.CLOSED) ws.close(); };
    } catch {
      this.retry();
    }
  }
  private retry() {
    if (this.intentional || this.reconnectTimer) return;
    const wait = reconnectDelay(this.attempts++);
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null; this.connect();
    }, wait);
  }
  send(frame: string) {
    if (!this.open) return false;
    try { this.socket!.send(frame); return true; } catch { return false; }
  }
  close() {
    this.intentional = true;
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.socket?.close();
    this.socket = null;
  }
}

export class HybridRobotLink implements RobotLink {
  private ws = new WsTransport();
  private http = new HttpTransport();
  private closed = false;
  private fallbackReady = false;
  private statusListeners = new Set<StatusListener>();
  private healthListeners = new Set<HealthListener>();
  private polling: ReturnType<typeof setInterval> | null = null;
  private pendingAck = new Map<number, number>();
  private rtts: number[] = [];
  private seq = 0;
  private driving = false;
  private mode: Transport = "http";
  private state: LinkHealth = { connected: false, transport: "http", failures: 0, lastRttMs: null, avgRttMs: null };

  constructor() {
    this.ws.onOpen(() => {
      this.mode = "ws";
      this.fallbackReady = true;
      this.publish({ connected: true, transport: "ws", failures: 0 });
      // A new socket must not resume previously held movement.
      this.driving = false;
    });
    this.ws.onClose(() => {
      this.driving = false;
      this.mode = "http";
      this.publish({ connected: false, transport: "http", failures: this.state.failures + 1 });
      // A stop attempt is best-effort; firmware also stops on disconnect.
      void this.http.stop().catch(() => {});
      void this.probeFallback();
    });
    this.ws.onStatus(text => {
      try {
        const status = JSON.parse(text) as unknown;
        const parsed = (status && typeof status === "object" &&
          (status as Record<string, unknown>).device === ROBOT_DEVICE_ID)
          ? status : null;
        if (!parsed) return;
        const { parseRobotStatus } = requireProtocol();
        const s = parseRobotStatus(parsed);
        this.statusListeners.forEach(fn => fn(s));
        this.publish({ connected: s.ready, failures: 0, transport: "ws" });
      } catch { this.recordFailure(); }
    });
    this.ws.onAck(seq => {
      const start = this.pendingAck.get(seq);
      if (start === undefined) return;
      this.pendingAck.delete(seq);
      const value = performance.now() - start;
      this.recordRtt(value);
    });
  }
  get transport() { return this.mode; }
  get health() { return this.state; }
  onStatus(cb: StatusListener) { this.statusListeners.add(cb); return () => this.statusListeners.delete(cb); }
  onHealth(cb: HealthListener) { this.healthListeners.add(cb); cb(this.state); return () => this.healthListeners.delete(cb); }
  private publish(update: Partial<LinkHealth>) {
    if (this.closed) return;
    this.state = { ...this.state, ...update };
    this.healthListeners.forEach(fn => fn(this.state));
  }
  private recordRtt(value: number) {
    this.rtts.push(value); if (this.rtts.length > 20) this.rtts.shift();
    this.publish({ lastRttMs: Math.round(value), avgRttMs: Math.round(this.rtts.reduce((a,b) => a+b,0) / this.rtts.length) });
  }
  private recordFailure() {
    this.publish({ failures: this.state.failures + 1 });
  }
  private async probeFallback() {
    if (this.closed || this.ws.open) return;
    try {
      const start = performance.now();
      const s = await this.http.status();
      if (this.ws.open || this.closed) return;
      this.fallbackReady = s.ready;
      this.mode = "http";
      this.statusListeners.forEach(fn => fn(s));
      this.publish({ connected: s.ready, transport: "http", failures: 0 });
      this.recordRtt(performance.now() - start);
    } catch {
      this.fallbackReady = false;
      this.publish({ connected: false, failures: this.state.failures + 1, transport: "http" });
    }
  }
  async connect() {
    this.ws.connect();
    await Promise.race([
      new Promise<void>(resolve => {
        const stop = this.ws.onOpen(() => { stop(); resolve(); });
        setTimeout(() => { stop(); resolve(); }, 1500);
      }),
      new Promise<void>(resolve => setTimeout(resolve, 1500))
    ]);
    if (!this.ws.open) await this.probeFallback();
    this.polling = setInterval(() => {
      if (this.ws.open) {
        // Status is pushed; ACK exchange measures actual command-path RTT.
        if (this.pendingAck.size > 15) this.pendingAck.clear();
      } else if (!this.driving) {
        void this.probeFallback();
      }
    }, 3000);
  }
  private wsCommand(frame: string): boolean {
    if (!this.ws.open) return false;
    const seq = ++this.seq;
    const stamped = frame === "S" ? `S:${seq}` : frame.startsWith("D:") ? `${frame}:${seq}` : frame;
    if (frame === "S" || frame.startsWith("D:")) this.pendingAck.set(seq, performance.now());
    const ok = this.ws.send(stamped);
    if (!ok) this.pendingAck.delete(seq);
    return ok;
  }
  async drive(dir: Direction) {
    this.driving = true;
    if (this.wsCommand("D:" + dir)) return;
    if (!this.fallbackReady) throw new Error("Robot is offline");
    const start = performance.now();
    try { await this.http.drive(dir); this.recordRtt(performance.now() - start); }
    catch (error) { this.recordFailure(); throw error; }
  }
  async stop() {
    this.driving = false;
    if (this.wsCommand("S")) return;
    // HTTP fallback aborts an in-flight drive request and sends stop now.
    try { await this.http.stop(); }
    catch (error) { this.recordFailure(); throw error; }
  }
  async heartbeat() {
    if (this.wsCommand("H")) return;
    if (!this.fallbackReady) throw new Error("Robot is offline");
    await this.http.heartbeat();
  }
  async gate(channel: 1 | 2, position: "open" | "close") {
    if (this.wsCommand(`G:${channel}:${position}`)) return;
    if (!this.fallbackReady) throw new Error("Robot is offline");
    await this.http.gate(channel, position);
  }
  async startAutopilot(config: PlantConfig | { preset: "cruise" | "pulse" }) {
    this.driving = false;
    if (this.wsCommand("A:" + JSON.stringify(config))) return;
    if (!this.fallbackReady) throw new Error("Robot is offline");
    await this.http.startAutopilot(config);
  }
  close() {
    if (this.closed) return;
    this.driving = false;
    if (this.ws.open) this.ws.send("S");
    this.ws.close();
    this.http.close();
    if (this.polling) clearInterval(this.polling);
    this.closed = true;
  }
}
// ESM import kept explicit for static Next.js bundling.
import { parseRobotStatus } from "./protocol";
function requireProtocol() { return { parseRobotStatus }; }

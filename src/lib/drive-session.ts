import type { Direction } from "./protocol";
export type DriveCommand = Direction | "stop";

/**
 * Single-flight, ordered motor requests. Every release queues a stop behind
 * the last in-flight drive response. Refreshes the ESP32 motion watchdog
 * while held, without flooding WebServer with overlapping commands.
 */
export class DriveSession {
  private wanted: Direction | null = null;
  private lastSent: DriveCommand = "stop";
  private pending: Promise<void> = Promise.resolve();
  private busy = false;
  private timer: ReturnType<typeof setInterval> | undefined;
  private disposed = false;

  private readonly send: (command: DriveCommand) => Promise<unknown>;
  private readonly onError: (error: unknown) => void;

  constructor(
    send: (command: DriveCommand) => Promise<unknown>,
    onError: (error: unknown) => void,
  ) {
    this.send = send;
    this.onError = onError;
  }

  press(direction: Direction) {
    if (this.disposed) return;
    this.wanted = direction;
    if (this.timer) clearInterval(this.timer);
    this.timer = setInterval(() => this.pump(true), 250);
    this.pump(true);
  }

  release() {
    if (this.timer) clearInterval(this.timer);
    this.timer = undefined;
    this.wanted = null;
    this.pump();
  }

  private pump(refresh = false) {
    if (this.disposed || this.busy) return;
    const next: DriveCommand = this.wanted ?? "stop";
    if (next === this.lastSent && !refresh) return;
    this.busy = true;
    this.lastSent = next;
    // The call starts immediately, on pointer-down, rather than a microtask later.
    let task: Promise<unknown>;
    try {
      task = this.send(next);
    } catch (error) {
      task = Promise.reject(error);
    }
    this.pending = Promise.resolve(task)
      .then(() => undefined)
      .catch(error => {
        this.wanted = null;
        if (this.timer) clearInterval(this.timer);
        this.timer = undefined;
        this.onError(error);
      })
      .finally(() => {
        this.busy = false;
        if (this.disposed) return;
        if ((this.wanted ?? "stop") !== next) this.pump();
      });
  }

  async whenSettled() {
    // Account for a queued stop after the current request finishes.
    while (this.busy) await this.pending;
  }

  dispose() {
    this.disposed = true;
    if (this.timer) clearInterval(this.timer);
    this.timer = undefined;
    this.wanted = null;
  }
}

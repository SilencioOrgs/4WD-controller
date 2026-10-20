import type { Direction } from "./protocol";
export type DriveCommand = Direction | "stop";

/**
 * One in-flight motor command at a time. A release always becomes the next
 * outgoing command, so no late drive response can overtake the stop request.
 * Repeated held commands refresh the board's 700ms watchdog without flooding.
 */
export class DriveSession {
  private wanted: Direction | null = null;
  private latest: DriveCommand = "stop";
  private pending: Promise<void> = Promise.resolve();
  private busy = false;
  private timer: ReturnType<typeof setInterval> | undefined;
  private disposed = false;

  constructor(
    private readonly send: (command: DriveCommand) => Promise<unknown>,
    private readonly onError: (error: unknown) => void,
  ) {}

  press(direction: Direction) {
    if (this.disposed) return;
    this.wanted = direction;
    if (this.timer) clearInterval(this.timer);
    this.timer = setInterval(() => this.pump(true), 230);
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
    const target: DriveCommand = this.wanted ?? "stop";
    if (target === this.latest && !refresh) return;
    this.busy = true;
    this.latest = target;
    let failed = false;
    this.pending = Promise.resolve().then(() => this.send(target))
      .then(() => undefined)
      .catch(error => {
        failed = true;
        this.wanted = null;
        if (this.timer) clearInterval(this.timer);
        this.timer = undefined;
        this.onError(error);
      })
      .finally(() => {
        this.busy = false;
        if (this.disposed) return;
        const next = this.wanted ?? "stop";
        if (failed || next !== target) this.pump();
      });
  }

  async whenSettled(): Promise<void> {
    while (this.busy) await this.pending;
  }

  dispose() {
    this.disposed = true;
    if (this.timer) clearInterval(this.timer);
    this.timer = undefined;
    this.wanted = null;
  }
}

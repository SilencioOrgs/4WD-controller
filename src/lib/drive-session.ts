import type { Direction } from "./protocol";
export type DriveCommand = Direction | "stop";

/** WS sends are immediate. For HTTP, transport.abortDrive() ensures the STOP
 * is dispatched immediately rather than waiting on a timed-out fetch. */
export class DriveSession {
  private held: Direction | null = null;
  private timer: ReturnType<typeof setInterval> | null = null;
  private disposed = false;
  private last: Promise<unknown> = Promise.resolve();
  private readonly send: (command: DriveCommand) => Promise<unknown>;
  private readonly onError: (error: unknown) => void;
  private readonly intervalMs: number;
  constructor(send: (command: DriveCommand) => Promise<unknown>,
              onError: (error: unknown) => void, intervalMs = 100) {
    this.send = send; this.onError = onError; this.intervalMs = intervalMs;
  }
  press(dir: Direction) {
    if (this.disposed) return;
    this.held = dir;
    if (this.timer) clearInterval(this.timer);
    this.dispatch(dir);
    this.timer = setInterval(() => {
      if (this.held === dir) this.dispatch(dir);
    }, this.intervalMs);
  }
  release() {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    if (this.held === null) return;
    this.held = null;
    this.dispatch("stop");
  }
  private dispatch(command: DriveCommand) {
    if (this.disposed) return;
    try {
      this.last = Promise.resolve(this.send(command)).catch(error => {
        if (command !== "stop") this.release();
        this.onError(error);
      });
    } catch (error) {
      if (command !== "stop") this.release();
      this.onError(error);
    }
  }
  async whenSettled() { await this.last; }
  dispose() {
    this.release(); this.disposed = true;
    if (this.timer) clearInterval(this.timer);
  }
}

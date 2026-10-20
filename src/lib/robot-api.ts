import { ROBOT_HOST, autopilotPath, directionPath, parseRobotStatus, servoPath,
  type Direction, type Preset, type RobotStatus } from "./protocol";
import type { PlantConfig } from "./plant-plan";

export class RobotApi {
  constructor(private readonly host: string = ROBOT_HOST) {}
  private async get(path: string, timeoutMs = 1600, external?: AbortSignal): Promise<unknown> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    const abort = () => controller.abort();
    external?.addEventListener("abort", abort, { once: true });
    try {
      const response = await fetch(this.host + path, {
        method: "GET", signal: controller.signal, cache: "no-store"
      });
      if (!response.ok) throw new Error("Robot HTTP " + response.status);
      if (path === "/status") return await response.json();
    } finally {
      clearTimeout(timer);
      external?.removeEventListener("abort", abort);
    }
  }
  async status(): Promise<RobotStatus> { return parseRobotStatus(await this.get("/status")); }
  drive(dir: Direction, signal?: AbortSignal) { return this.get(directionPath(dir), 900, signal); }
  stop() { return this.get("/stop", 900); }
  heartbeat() { return this.get("/heartbeat", 1000); }
  gate(ch: 1 | 2, pos: "open" | "close") { return this.get(servoPath(ch,pos), 1200); }
  autopilot(config: PlantConfig | { preset: "cruise" | "pulse" }) {
    return this.get(config.preset === "plant" ?
      "/auto?mode=plant&cycles=" + config.cycles + "&return=" + Number(config.returnToStart) +
       "&drive=" + config.driveMs + "&settle=" + config.settleMs +
       "&release=" + config.releaseMs + "&returnPause=" + config.returnPauseMs +
       "&sequence=" + (config.sequence ?? "move-first") +
       "&rake=" + Number(config.useRake === true) + "&rakeLift=" + (config.rakeLiftMs ?? 1000) :
      autopilotPath(config.preset), 1200);
  }
}

import {
  ROBOT_HOST, autopilotPath, directionPath, parseRobotStatus, servoPath,
  type Direction, type Preset, type RobotStatus
} from "./protocol";

export class RobotApi {
  constructor(private readonly host: string = ROBOT_HOST) {}

  private async get(path: string, timeoutMs = 1600): Promise<unknown> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      // Plain GET: no extra request headers or preflight, local-only network.
      const response = await fetch(this.host + path, {
        method: "GET", signal: controller.signal, cache: "no-store"
      });
      if (!response.ok) throw new Error("Robot error " + response.status);
      if (path === "/status") return await response.json();
      return undefined;
    } finally {
      clearTimeout(timer);
    }
  }

  async status(): Promise<RobotStatus> {
    return parseRobotStatus(await this.get("/status"));
  }
  drive(direction: Direction) { return this.get(directionPath(direction), 900); }
  stop() { return this.get("/stop", 1400); }
  heartbeat() { return this.get("/heartbeat", 1000); }
  autopilot(preset: Preset) { return this.get(autopilotPath(preset), 1400); }
  gate(channel: 1 | 2, state: "open" | "close") {
    return this.get(servoPath(channel, state), 1400);
  }
}

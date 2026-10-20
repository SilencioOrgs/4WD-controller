export const ROBOT_HOST = "http://192.168.4.1";
export const ROBOT_SSID = "ESP32-CAM Robot";
export const ROBOT_DEVICE_ID = "LAFVIN-4WD";

export type Direction = "go" | "back" | "left" | "right";
export type Preset = "plant" | "cruise" | "pulse";
export type Mode = "manual" | "auto";

export type RobotStatus = {
  device: string;
  ready: boolean;
  mode: Mode;
  motion: string;
  phase: string;
  phaseRemainingMs: number;
  servoEnabled: boolean;
  preset: Preset | null;
  uptimeMs: number;
  resetReason: string;
  servo2Enabled: boolean;
  cycle: number;
  returnSegment: number;
  seedDrops: number;
  plannedDrops: number;
  sequence: "dispense-first" | "move-first";
  rakeEnabled: boolean;
  totalCycles: number;
  direction: "forward" | "returning";
  returnToStart: boolean;
  state: "idle" | "running" | "done";
};

export const PRESETS = [
  { id: "plant", title: "Plant cycle", description: "Drive 3s, stop 3s, release gate", short: "GATE / MOVE" },
  { id: "cruise", title: "Cruise", description: "Forward continuously, toggle gate every 3s", short: "CONTINUOUS" },
  { id: "pulse", title: "Pulse drive", description: "Drive 3s, pause 3s, gate stays closed", short: "DRIVE / PAUSE" }
] as const;

export function parseRobotStatus(data: unknown): RobotStatus {
  if (typeof data !== "object" || data === null || Array.isArray(data)) {
    throw new Error("Invalid robot response");
  }
  const value = data as Record<string, unknown>;
  if (value.device !== ROBOT_DEVICE_ID) {
    throw new Error("This Wi-Fi network does not identify as the 4WD robot");
  }
  if (typeof value.ready !== "boolean" || (value.mode !== "manual" && value.mode !== "auto")) {
    throw new Error("Robot status is incomplete");
  }
  const rawPreset = value.preset;
  const preset: Preset | null = rawPreset === "plant" || rawPreset === "cruise" || rawPreset === "pulse"
    ? rawPreset : null;
  return {
    device: ROBOT_DEVICE_ID,
    ready: value.ready,
    mode: value.mode,
    motion: typeof value.motion === "string" ? value.motion : "stop",
    phase: typeof value.phase === "string" ? value.phase : "idle",
    phaseRemainingMs: typeof value.phaseRemainingMs === "number"
      ? Math.max(0, value.phaseRemainingMs) : 0,
    servoEnabled: value.servoEnabled === true,
    servo2Enabled: value.servo2Enabled === true,
    cycle: typeof value.cycle === "number" ? value.cycle : 0,
    returnSegment: typeof value.returnSegment === "number" ? value.returnSegment : 0,
    seedDrops: typeof value.seedDrops === "number" ? value.seedDrops : 0,
    plannedDrops: typeof value.plannedDrops === "number" ? value.plannedDrops : 0,
    sequence: value.sequence === "dispense-first" ? "dispense-first" : "move-first",
    rakeEnabled: value.rakeEnabled === true,
    totalCycles: typeof value.totalCycles === "number" ? value.totalCycles : 0,
    direction: value.direction === "returning" ? "returning" : "forward",
    returnToStart: value.returnToStart === true,
    state: value.state === "done" ? "done" : value.state === "running" ? "running" : "idle",
    uptimeMs: typeof value.uptimeMs === "number" ? Math.max(0, value.uptimeMs) : 0,
    resetReason: typeof value.resetReason === "string" ? value.resetReason : "UNKNOWN",
    preset
  };
}

export function directionPath(direction: Direction): string {
  if (!["go", "back", "left", "right"].includes(direction)) throw new Error("Invalid direction");
  return "/" + direction;
}
export function autopilotPath(preset: Preset): string {
  if (!["plant", "cruise", "pulse"].includes(preset)) throw new Error("Invalid preset");
  return "/auto?mode=" + preset;
}
export function servoPath(channel: 1 | 2, gate: "open" | "close"): string {
  if (![1, 2].includes(channel) || !["open", "close"].includes(gate)) throw new Error("Invalid servo command");
  return "/servo?channel=" + channel + "&gate=" + gate;
}


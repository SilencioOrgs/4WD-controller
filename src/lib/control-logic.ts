import type { Mode } from "./protocol";

export type LinkHealth = "connected" | "unstable" | "offline";
export function assessLink(failures: number): LinkHealth {
  if (failures <= 0) return "connected";
  if (failures < 3) return "unstable";
  return "offline";
}

// A UI tab never issues a movement command; Start is a separate action.
export function shouldStartAutopilotOnTab(_tab: Mode): boolean {
  return false;
}

export type SeedSequence = "dispense-first" | "move-first";
export type PlantConfig = {
  preset: "plant";
  cycles: number;
  returnToStart: boolean;
  driveMs: number;
  settleMs: number;
  releaseMs: number;
  returnPauseMs: number;
  sequence?: SeedSequence; // missing means legacy move-first
  useRake?: boolean;
  rakeLiftMs?: number; // when optional rake lifts during the forward segment
};
export type PlantPhase =
  "drive" | "settle" | "release" | "rakeDown" | "rakeUp" |
  "returning" | "returnPause" | "done";
export type PlantSegment = {
  phase: PlantPhase;
  cycle: number;
  direction: "forward" | "returning";
  durationMs: number;
};
const validDuration = (n: number, optional = false) =>
  Number.isSafeInteger(n) && ((optional && n === 0) || (n >= 100 && n <= 20000));

export function validatePlantConfig(config: PlantConfig): string | null {
  if (!Number.isSafeInteger(config.cycles) || config.cycles < 1 || config.cycles > 50)
    return "Forward moves must be between 1 and 50";
  if (typeof config.returnToStart !== "boolean") return "Return option must be selected";
  if (!validDuration(config.driveMs)) return "Drive duration must be 100–20000 ms";
  if (!validDuration(config.releaseMs)) return "Seed gate must remain open for 100–20000 ms";
  if (!validDuration(config.settleMs, true)) return "Waiting duration must be 0 or 100–20000 ms";
  if (!validDuration(config.returnPauseMs, true)) return "Return pause must be 0 or 100–20000 ms";
  if (config.sequence !== undefined && config.sequence !== "move-first" && config.sequence !== "dispense-first")
    return "Invalid dispensing sequence";
  if (config.useRake !== undefined && typeof config.useRake !== "boolean")
    return "Rake must be enabled or disabled";
  if (config.useRake && (!validDuration(config.rakeLiftMs ?? 1000) || (config.rakeLiftMs ?? 1000) > config.driveMs))
    return "Rake lift time must fit within one forward move";
  return null;
}

export function buildPlantPlan(config: PlantConfig): PlantSegment[] {
  const issue = validatePlantConfig(config);
  if (issue) throw new Error(issue);
  const sequence = config.sequence ?? "move-first";
  const rake = config.useRake === true;
  const plan: PlantSegment[] = [];
  const add = (phase: PlantPhase, cycle: number, durationMs: number, direction: "forward" | "returning" = "forward") =>
    plan.push({ phase, cycle, durationMs, direction });

  if (sequence === "dispense-first") add("release", 0, config.releaseMs);
  for (let cycle = 1; cycle <= config.cycles; cycle++) {
    if (rake) add("rakeDown", cycle, 150);
    add("drive", cycle, config.driveMs);
    if (rake) add("rakeUp", cycle, 0); // marker: lift occurs DURING the drive, at rakeLiftMs
    if (config.settleMs > 0) add("settle", cycle, config.settleMs);
    add("release", cycle, config.releaseMs);
  }
  if (config.returnToStart) {
    for (let segment = 1; segment <= config.cycles; segment++) {
      add("returning", segment, config.driveMs, "returning");
      if (segment < config.cycles && config.returnPauseMs > 0)
        add("returnPause", segment, config.returnPauseMs, "returning");
    }
  }
  add("done", config.cycles, 0, config.returnToStart ? "returning" : "forward");
  return plan;
}

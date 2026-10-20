export type PlantConfig = {
  preset: "plant";
  cycles: number;
  returnToStart: boolean;
  driveMs: number;
  settleMs: number;
  releaseMs: number;
  returnPauseMs: number;
};
export type PlantPhase = "drive" | "settle" | "release" | "returning" | "returnPause" | "done";
export type PlantSegment = {
  phase: PlantPhase;
  cycle: number;
  direction: "forward" | "returning";
  durationMs: number;
};
function durationOK(n: number, optional=false) {
  return Number.isSafeInteger(n) && (optional && n === 0 || n >= 100 && n <= 20000);
}
export function validatePlantConfig(config: PlantConfig): string | null {
  if (!Number.isSafeInteger(config.cycles) || config.cycles < 1 || config.cycles > 50)
    return "Cycles must be 1–50";
  if (typeof config.returnToStart !== "boolean") return "Return must be a boolean";
  if (!durationOK(config.driveMs)) return "Drive time must be 100–20000 ms";
  if (!durationOK(config.releaseMs)) return "Gate release must be 100–20000 ms";
  if (!durationOK(config.settleMs, true)) return "Settle must be 0 or 100–20000 ms";
  if (!durationOK(config.returnPauseMs, true)) return "Return pause must be 0 or 100–20000 ms";
  return null;
}
export function buildPlantPlan(config: PlantConfig): PlantSegment[] {
  const issue=validatePlantConfig(config);
  if(issue) throw new Error(issue);
  const result: PlantSegment[] = [];
  for(let cycle=1; cycle<=config.cycles; cycle++) {
    result.push({phase:"drive",cycle,direction:"forward",durationMs:config.driveMs});
    if(config.settleMs>0) result.push({phase:"settle",cycle,direction:"forward",durationMs:config.settleMs});
    result.push({phase:"release",cycle,direction:"forward",durationMs:config.releaseMs});
  }
  if(config.returnToStart) for(let i=1;i<=config.cycles;i++) {
    result.push({phase:"returning",cycle:i,direction:"returning",durationMs:config.driveMs});
    if(i<config.cycles && config.returnPauseMs>0)
      result.push({phase:"returnPause",cycle:i,direction:"returning",durationMs:config.returnPauseMs});
  }
  result.push({phase:"done",cycle:config.cycles,direction:config.returnToStart?"returning":"forward",durationMs:0});
  return result;
}

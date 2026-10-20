export type PlantConfig = {
  preset: "plant";
  cycles: number; returnToStart: boolean;
  driveMs: number; settleMs: number; releaseMs: number; returnPauseMs: number;
};
// Phase 2's pure planner will be added here.

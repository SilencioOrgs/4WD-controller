import type { PlantConfig } from "./plant-plan";
export type PlantPreset = {
  id: string; name: string; spacingCm: number;
  driveMs: number; settleMs: number; releaseMs: number;
};
export const EXAMPLE_PLANTS: PlantPreset[] = [
  {id:"corn",name:"Corn",spacingCm:0,driveMs:3000,settleMs:250,releaseMs:800},
  {id:"tomato",name:"Tomato",spacingCm:0,driveMs:3000,settleMs:250,releaseMs:800},
  {id:"lettuce",name:"Lettuce",spacingCm:0,driveMs:3000,settleMs:250,releaseMs:800},
  {id:"eggplant",name:"Eggplant",spacingCm:0,driveMs:3000,settleMs:250,releaseMs:800},
  {id:"custom",name:"Custom",spacingCm:0,driveMs:3000,settleMs:250,releaseMs:800},
];
export const DEFAULT_ROBOT_SPEED_CM_S = 10; // calibration placeholder, not measured
export function toPlantConfig(plant: PlantPreset, cycles: number, returnToStart: boolean, speedCmPerSec: number): PlantConfig {
  const raw = plant.spacingCm > 0 && Number.isFinite(speedCmPerSec) && speedCmPerSec > 0
    ? Math.round(plant.spacingCm / speedCmPerSec * 1000)
    : plant.driveMs;
  return {
    preset:"plant", cycles, returnToStart,
    driveMs:Math.max(100, Math.min(20000,raw)),
    settleMs:plant.settleMs,
    releaseMs:plant.releaseMs,
    returnPauseMs:350, // Visible stop between reverse segments
    sequence:"move-first", // consumer UI overrides with selected preference
    useRake:false,
    rakeLiftMs:1000,
  };
}

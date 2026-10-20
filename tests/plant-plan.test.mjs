import test from "node:test";
import assert from "node:assert/strict";
import {buildPlantPlan,validatePlantConfig} from "../src/lib/plant-plan.ts";
import {toPlantConfig, EXAMPLE_PLANTS} from "../src/lib/plants.ts";

const five={preset:"plant",cycles:5,returnToStart:true,driveMs:3000,settleMs:250,releaseMs:800,returnPauseMs:0};
test("5 cycles with return generates 5 forward, 5 gate releases, 5 backward, done",()=>{
 const p=buildPlantPlan(five);
 assert.equal(p.filter(s=>s.phase==="drive").length,5);
 assert.equal(p.filter(s=>s.phase==="release").length,5);
 assert.equal(p.filter(s=>s.phase==="returning").length,5);
 assert.equal(p.at(-1).phase,"done");
});
test("5 cycles without return only travels forward",()=>{
 const p=buildPlantPlan({...five,returnToStart:false});
 assert.equal(p.filter(s=>s.phase==="returning").length,0);
 assert.equal(p.at(-1).phase,"done");
});
test("validation rejects potentially unsafe missing/out-of-range durations",()=>{
 assert.match(validatePlantConfig({...five,cycles:51}),/Forward moves/);
 assert.match(validatePlantConfig({...five,driveMs:0}),/Drive/);
 assert.match(validatePlantConfig({...five,settleMs:25}),/Waiting/);
 assert.equal(validatePlantConfig({...five,settleMs:0,returnPauseMs:0}),null);
});
test("spacing time is derived from user-measured speed, with safe clamp",()=>{
 const corn={...EXAMPLE_PLANTS[0],spacingCm:30};
 assert.equal(toPlantConfig(corn,5,false,10).driveMs,3000);
 assert.equal(toPlantConfig(corn,5,false,5).driveMs,6000);
 assert.equal(toPlantConfig(corn,5,false,0).driveMs,corn.driveMs);
});

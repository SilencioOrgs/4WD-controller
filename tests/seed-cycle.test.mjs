import test from "node:test";
import assert from "node:assert/strict";
import { buildPlantPlan, validatePlantConfig } from "../src/lib/plant-plan.ts";

const base={preset:"plant",cycles:2,returnToStart:true,driveMs:3000,settleMs:250,releaseMs:800,returnPauseMs:250,useRake:false,rakeLiftMs:1000};

test("dispense-first: two forward moves dispense three times and reverse twice",()=>{
 const p=buildPlantPlan({...base,sequence:"dispense-first"});
 assert.deepEqual(p.map(s=>s.phase),["release","drive","settle","release","drive","settle","release","returning","returnPause","returning","done"]);
 assert.equal(p.filter(s=>s.phase==="release").length,3);
 assert.equal(p.filter(s=>s.phase==="returning").length,2);
});

test("move-first: two forward moves dispense twice then reverse twice",()=>{
 const p=buildPlantPlan({...base,sequence:"move-first"});
 assert.deepEqual(p.map(s=>s.phase),["drive","settle","release","drive","settle","release","returning","returnPause","returning","done"]);
});

test("no-return and no-rake preserve safe defaults",()=>{
 const p=buildPlantPlan({...base,returnToStart:false,sequence:"dispense-first"});
 assert.equal(p.filter(s=>s.phase==="returning").length,0);
 assert.equal(p.filter(s=>s.phase==="rakeDown").length,0);
 assert.equal(p.at(-1).phase,"done");
});

test("future rake only inserts lowering and lifting when explicitly opted in",()=>{
 const p=buildPlantPlan({...base,sequence:"dispense-first",useRake:true,returnToStart:false});
 assert.equal(p.filter(s=>s.phase==="rakeDown").length,2);
 assert.equal(p.filter(s=>s.phase==="rakeUp").length,2);
 assert.equal(p.filter(s=>s.phase==="release").length,3);
});

test("fails closed on invalid lift times and requires sufficient movement for rake",()=>{
 assert.match(validatePlantConfig({...base,sequence:"move-first",useRake:true,rakeLiftMs:4000}),/rake/i);
 assert.match(validatePlantConfig({...base,sequence:"unknown"}),/sequence/i);
 assert.equal(validatePlantConfig({...base,sequence:"move-first",useRake:false}),null);
});

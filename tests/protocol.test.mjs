import test from "node:test";
import assert from "node:assert/strict";
import {
  parseRobotStatus, directionPath, autopilotPath, servoPath, ROBOT_DEVICE_ID
} from "../src/lib/protocol.ts";

test("recognizes the expected robot only", () => {
  const s = parseRobotStatus({
    device: ROBOT_DEVICE_ID, ready: true, mode: "manual",
    motion: "stop", phase: "idle", phaseRemainingMs: 0, servoEnabled: true
  });
  assert.equal(s.ready, true);
  assert.equal(s.mode, "manual");
  assert.equal(s.preset, null);
  assert.throws(() => parseRobotStatus({ device: "unknown", ready: true, mode: "manual" }));
});
test("normalizes an automatic status", () => {
  const s = parseRobotStatus({
    device: ROBOT_DEVICE_ID, ready: true, mode: "auto", phase: "release",
    preset: "plant", phaseRemainingMs: -4
  });
  assert.equal(s.preset, "plant");
  assert.equal(s.phaseRemainingMs, 0);
  assert.equal(s.motion, "stop");
});
test("rejects invalid status and incomplete data", () => {
  for (const value of [null, [], 4, {}, { device: ROBOT_DEVICE_ID }]) {
    assert.throws(() => parseRobotStatus(value));
  }
});
test("only approved motor commands and autopilot presets", () => {
  assert.equal(directionPath("go"), "/go");
  assert.equal(directionPath("right"), "/right");
  assert.equal(autopilotPath("cruise"), "/auto?mode=cruise");
  assert.equal(servoPath(2, "close"), "/servo?channel=2&gate=close");
  assert.throws(() => directionPath("spin"));
  assert.throws(() => autopilotPath("random"));
  assert.throws(() => servoPath(3, "open"));
});

test("plant progress status parses cycle and done state", () => {
  const done=parseRobotStatus({
    device:ROBOT_DEVICE_ID,ready:true,mode:"auto",preset:"plant",
    cycle:5,totalCycles:5,direction:"returning",returnToStart:true,
    state:"done",phase:"done",phaseRemainingMs:0
  });
  assert.equal(done.cycle,5);
  assert.equal(done.totalCycles,5);
  assert.equal(done.direction,"returning");
  assert.equal(done.returnToStart,true);
  assert.equal(done.state,"done");
});

import test from "node:test";
import assert from "node:assert/strict";
import { assessLink, shouldStartAutopilotOnTab } from "../src/lib/control-logic.ts";
import { calibrationPath, parseRobotStatus, ROBOT_DEVICE_ID } from "../src/lib/protocol.ts";
import { DriveSession } from "../src/lib/drive-session.ts";

test("one missed poll means unstable, not disconnected", () => {
  assert.equal(assessLink(1), "unstable");
  assert.equal(assessLink(2), "unstable");
  assert.equal(assessLink(3), "offline");
  assert.equal(assessLink(0), "connected");
});

test("opening autopilot tab NEVER starts moving", () => {
  assert.equal(shouldStartAutopilotOnTab("auto"), false);
  assert.equal(shouldStartAutopilotOnTab("manual"), false);
});

test("calibration command validates all settings", () => {
  assert.equal(calibrationPath({ leftInverted: true, rightInverted: false, swappedSides: true }),
    "/calibrate?left=1&right=0&swap=1");
  assert.throws(() => calibrationPath({ leftInverted: 1, rightInverted: false, swappedSides: false }));
});

test("status carries motor inversion and ESP32 uptime / last reset", () => {
  const result = parseRobotStatus({
    device: ROBOT_DEVICE_ID, ready: true, mode: "manual",
    uptimeMs: 3012, resetReason: "BROWNOUT",
    calibration: { leftInverted: true, rightInverted: false, swappedSides: false }
  });
  assert.equal(result.uptimeMs, 3012);
  assert.equal(result.resetReason, "BROWNOUT");
  assert.deepEqual(result.calibration, { leftInverted: true, rightInverted: false, swappedSides: false });
});

test("drive release queues stop after in-flight drive, with no stale extra drive", async () => {
  let finish;
  const calls = [];
  const session = new DriveSession(command => {
    calls.push(command);
    if (command === "go") return new Promise(resolve => { finish = resolve; });
    return Promise.resolve();
  }, () => {});
  session.press("go");
  assert.deepEqual(calls, ["go"]);
  session.release();
  assert.deepEqual(calls, ["go"]);
  finish();
  await session.whenSettled();
  assert.deepEqual(calls, ["go", "stop"]);
  session.dispose();
});

test("directions preserve requested direction when quickly switching", async () => {
  const calls = [];
  const session = new DriveSession(async command => { calls.push(command); }, () => {});
  session.press("left");
  await session.whenSettled();
  session.press("right");
  await session.whenSettled();
  session.release();
  await session.whenSettled();
  assert.deepEqual(calls, ["left", "right", "stop"]);
  session.dispose();
});

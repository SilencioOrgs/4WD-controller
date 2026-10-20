import test from "node:test";
import assert from "node:assert/strict";
import { assessLink } from "../src/lib/control-logic.ts";
import { parseRobotStatus, ROBOT_DEVICE_ID } from "../src/lib/protocol.ts";
import { DriveSession } from "../src/lib/drive-session.ts";

test("a transient poll error does not mark a board disconnected", () => {
  assert.equal(assessLink(0), "connected");
  assert.equal(assessLink(1), "unstable");
  assert.equal(assessLink(2), "unstable");
  assert.equal(assessLink(3), "offline");
});
test("diagnostics identify a possible brownout restart", () => {
  const status = parseRobotStatus({
    device: ROBOT_DEVICE_ID, ready: true, mode: "manual",
    uptimeMs: 3012, resetReason: "BROWNOUT"
  });
  assert.equal(status.uptimeMs, 3012);
  assert.equal(status.resetReason, "BROWNOUT");
});
test("release queues stop behind the in-flight direction", async () => {
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
test("switching direction and releasing never loses the final stop", async () => {
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
test("a single command error stops transmission and requests a stop", async () => {
  const calls = [];
  let failures = 0;
  const session = new DriveSession(command => {
    calls.push(command);
    if (command === "go") return Promise.reject(new Error("Temporary Wi-Fi delay"));
    return Promise.resolve();
  }, () => { failures++; });
  session.press("go");
  await session.whenSettled();
  assert.deepEqual(calls, ["go", "stop"]);
  assert.equal(failures, 1);
  session.dispose();
});

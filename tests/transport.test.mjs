import test from "node:test";
import assert from "node:assert/strict";
import { reconnectDelay, selectTransport } from "../src/lib/robot-link.ts";
import { DriveSession } from "../src/lib/drive-session.ts";

test("reconnect backs off but stays under 1.5 seconds", () => {
  assert.deepEqual([0,1,2,3,4].map(reconnectDelay), [250,500,1000,1500,1500]);
});
test("open WS takes priority over fallback", () => {
  assert.equal(selectTransport(true,true), "ws");
  assert.equal(selectTransport(false,true), "http");
  assert.equal(selectTransport(false,false), null);
});
test("release sends S immediately without waiting on unresolved drive", async () => {
  let resolveDrive;
  const commands = [];
  const drive = new DriveSession(cmd => {
    commands.push(cmd);
    return cmd === "go" ? new Promise(resolve => { resolveDrive = resolve; }) : Promise.resolve();
  }, () => {});
  drive.press("go");
  drive.release();
  assert.deepEqual(commands, ["go","stop"]);
  resolveDrive();
  await drive.whenSettled();
  drive.dispose();
});
test("direction changes are immediate even with in-flight request", () => {
  const commands = [];
  const drive = new DriveSession(cmd => {
    commands.push(cmd);
    return new Promise(() => {});
  }, () => {});
  drive.press("left");
  drive.press("right");
  assert.deepEqual(commands, ["left","right"]);
  drive.release();
  assert.deepEqual(commands, ["left","right","stop"]);
  drive.dispose();
});

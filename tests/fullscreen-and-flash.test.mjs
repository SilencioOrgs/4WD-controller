import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { DriveSession } from "../src/lib/drive-session.ts";

const firmware = readFileSync(new URL("../firmware/ESP32_CAM_4WD_Controller/ESP32_CAM_4WD_Controller.ino", import.meta.url), "utf8");
const css = readFileSync(new URL("../app/globals.css", import.meta.url), "utf8");
const controller = readFileSync(new URL("../src/components/Controller.tsx", import.meta.url), "utf8");
const drivePad = readFileSync(new URL("../src/components/DrivePad.tsx", import.meta.url), "utf8");
const modePanel = readFileSync(new URL("../src/components/ModePanel.tsx", import.meta.url), "utf8");

test("ESP32 onboard flash GPIO4 is held low when second servo is disabled", () => {
  assert.match(firmware, /ENABLE_SERVO_2\s*=\s*false/);
  assert.match(firmware, /if\s*\(!ENABLE_SERVO_2\)\s*\{[\s\S]*?pinMode\(4,\s*OUTPUT\)/);
  assert.match(firmware, /if\s*\(i\s*==\s*1\s*&&\s*!ENABLE_SERVO_2\)\s*continue/);
});

test("fullscreen responsive interface uses large touch targets and no PSP shell", () => {
  assert.match(css, /\.control-layout\s*\{/);
  assert.match(css, /min-height:\s*100dvh/);
  assert.match(css, /touch-action:\s*none/);
  assert.match(drivePad, /label:"Forward"/);
  assert.match(drivePad, /aria-label=\{label\+" — hold to drive"\}/);
  assert.doesNotMatch(controller, /className="handheld"/);
});

test("autopilot opens configuration without dispatching movement", () => {
  assert.match(modePanel, /onClick=\{\(\) => r\.setView\("auto"\)\}/);
  assert.match(modePanel, /START AUTOPILOT/);
});

test("DriveSession drives on press and sends final stop on release", async () => {
  const received = [];
  const drive = new DriveSession(async command => { received.push(command); }, () => {});
  drive.press("go");
  assert.deepEqual(received, ["go"]);
  await drive.whenSettled();
  drive.release();
  await drive.whenSettled();
  assert.deepEqual(received, ["go", "stop"]);
  drive.dispose();
});

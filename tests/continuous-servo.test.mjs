import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const firmware = readFileSync(
  new URL("../firmware/ESP32_CAM_4WD_Controller/ESP32_CAM_4WD_Controller.ino", import.meta.url),
  "utf8"
);

test("continuous gate defaults are fixed to the requested calibration values", () => {
  assert.match(firmware, /static const bool SERVO_CONTINUOUS\s*=\s*true;/);
  assert.match(firmware, /static const int\s+GATE_STOP_US\s*=\s*1500;/);
  assert.match(firmware, /static const int\s+GATE_SPIN_US\s*=\s*300;/);
  assert.match(firmware, /static const uint32_t\s+GATE_TRAVEL_MS\s*=\s*500;/);
  assert.match(firmware, /static const bool\s+GATE_OPEN_IS_CW\s*=\s*false;/);
});

test("gate PWM is timed and stops pulses, and tick precedes autopilot", () => {
  assert.match(firmware, /void writeServoPulse\(int index, uint32_t pulseUs\)/);
  assert.match(firmware, /void gateTick\(uint32_t now\)/);
  assert.match(firmware, /if \(gatePosMs == gateTargetMs\)\s*\{\s*setGatePulse\(0\);\s*return;/);
  assert.match(firmware, /if \(dt > 50\) dt = 50;/);
  const loop = firmware.slice(firmware.indexOf("void loop()"));
  assert.match(loop, /uint32_t now = millis\(\);\s*gateTick\(now\);\s*if \(mode != Mode::Manual\) runAuto\(now\);/);
});

test("positional fallback, rake, flashlight and motor pins stay unchanged", () => {
  assert.match(firmware, /static const int SERVO_OPEN_DEGREES = 0;/);
  assert.match(firmware, /static const int SERVO_CLOSED_DEGREES = 90;/);
  assert.match(firmware, /if \(SERVO_CONTINUOUS && index == 0\)/);
  assert.match(firmware, /writeServo\(index, open \? SERVO_OPEN_DEGREES : SERVO_CLOSED_DEGREES\);/);
  assert.match(firmware, /writeServo\(1, down \? RAKE_DOWN_DEGREES : RAKE_UP_DEGREES\);/);
  assert.match(firmware, /ENABLE_SERVO_2 = false;/);
  assert.match(firmware, /if \(!ENABLE_SERVO_2\)\s*\{[\s\S]*?pinMode\(4, OUTPUT\)/);
  assert.match(firmware, /motorPins\[4\] = \{13, 12, 14, 15\};/);
  assert.match(firmware, /servoPins\[2\] = \{2, 4\};/);
  assert.match(firmware, /gate\(false, 0\);\s*gate\(false, 1\);/);
  assert.match(firmware, /GATE_CLOSE_WAIT_MS\s*=\s*\(SERVO_CONTINUOUS && GATE_TRAVEL_MS > 220\) \? GATE_TRAVEL_MS : 220;/);
});

test("HTTP and WebSocket servo endpoints and plant state machine stay in place", () => {
  assert.match(firmware, /server\.on\("\/servo", HTTP_GET,/);
  assert.match(firmware, /frame\.startsWith\("G:"\)/);
  for (const phase of ["release", "gateClose", "returning"]) {
    assert.ok(firmware.includes('phase == "' + phase + '"') ||
      firmware.includes('phase=="' + phase + '"'), phase + " phase missing");
  }
  for (const path of ["/status", "/auto", "/stop", "/heartbeat"]) {
    assert.ok(firmware.includes('server.on("' + path + '"'), path + " endpoint missing");
  }
});

// Mirrors the firmware position math independently of motor hardware.
// No encoder feedback: this verifies arithmetic, NOT real angular position.
function gateStep(state, target, deltaMs, travelMs = 500) {
  const dt = Math.min(Math.max(deltaMs, 0), 50);
  const opening = target > state;
  if (target === state) return { position: state, spinning: false };
  const position = opening
    ? Math.min(target, state + dt)
    : Math.max(target, state - dt);
  assert.ok(position >= 0 && position <= travelMs);
  return { position, spinning: position !== target };
}

test("estimated open motion reaches full calibrated travel and stops", () => {
  let pos = 0;
  for (let i = 0; i < 10; i++) pos = gateStep(pos, 500, 50).position;
  assert.equal(pos, 500);
  assert.equal(gateStep(pos, 500, 50).spinning, false);
});

test("close motion reaches 0 and a mid-move reversal undoes only elapsed travel", () => {
  let pos = 0;
  for (let i = 0; i < 4; i++) pos = gateStep(pos, 500, 50).position;
  assert.equal(pos, 200);
  for (let i = 0; i < 4; i++) pos = gateStep(pos, 0, 50).position;
  assert.equal(pos, 0);
  assert.equal(gateStep(pos, 0, 50).spinning, false);
});

test("long tick stalls advance the estimate by at most 50ms", () => {
  assert.equal(gateStep(0, 500, 250).position, 50);
});

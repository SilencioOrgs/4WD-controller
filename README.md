# 4WD Controller

Local-only, landscape-first robot control: **Next.js 15 static export + Capacitor 7 Android + AI Thinker ESP32-CAM**. Camera and flashlight are disabled. No Arduino Uno, accounts, cloud server, or Flutter SDK.

## Architecture and prerequisites

- Phone connects to the ESP32-CAM access point **ESP32-CAM Robot** (default password `robotcontrol`, change this in firmware).
- **Primary:** persistent WebSocket at `ws://192.168.4.1:81`. Direct small text command frames; status pushed every 500ms or when the state changes.
- **Fallback:** the original HTTP GET API on `http://192.168.4.1`, selected if WebSocket connection is unavailable after 1.5 seconds. WS automatically retries with 250/500/1000/1500 ms backoff.
- In Android Studio, Capacitor WebView uses `https://localhost`; `capacitor.config.ts` already allows mixed content for local `ws://` and `http://` connections. Actual mixed-content behavior still needs testing on your phone.
- WebSocket Manual deadman stops after **350ms without a driving frame**; HTTP fallback uses **700ms**. Auto stops when heartbeats are missing for **1400ms**. Socket disconnect sends an immediate stop. App also stops on background, and STOP cancels any routine. **These are software failsafes; retain an accessible physical motor power switch.**
- Hardware: ESP32-CAM 4WD kit, L298N, MG90S with suitable **regulated external 5V**, common grounds, multimeter. Core Arduino **ESP32 3.x**.

**Arduino IDE library requirements:** Boards Manager install **esp32 by Espressif Systems 3.x** (tested in CI with **3.3.2**). In Library Manager install **WebSockets by Markus Sattler / Links2004** (header `WebSocketsServer.h`) and **ArduinoJson by Benoit Blanchon v7** (`ArduinoJson.h`). Board: **AI Thinker ESP32-CAM**, Arduino-ESP32 FQBN `esp32:esp32:esp32cam`.

## Wiring — unchanged

| ESP32-CAM | Component |
| --- | --- |
| GPIO15 | L298N IN1 |
| GPIO14 | L298N IN2 |
| GPIO13 | L298N IN3 |
| GPIO12 | L298N IN4 |
| GPIO2 | MG90S #1 signal |
| GPIO4 | **Flash LED held LOW**, second servo disabled (`ENABLE_SERVO_2 = false`) |
| 5V | Correctly regulated 5V supply |
| GND | Common L298N/XL4016/servo ground |

No motor direction mapping or motor output wiring was changed. Keep L298N ENA/ENB motor-enable jumpers fitted, and retain your existing four DC motor connections. GPIO2 is a boot-strapping pin; do not connect the SD card. Servo 2 cannot be enabled on GPIO4 without also driving the flash LED.

**Power caution:** Three 18650 cells in series reach 12.6V fully charged; the L298N onboard 5V regulator must **not** be used on this fully charged pack. Do not feed two regulator outputs together. The recommended single XL4016 5V supply can power the ESP32-CAM and servo, and the L298N logic **with its 5V-EN regulator jumper removed**. Check 5V output using a multimeter before connecting. The motor power still comes from the 3S pack through a suitable switch/protection.

## Run Next.js locally

```bash
git pull origin main
npm install
npm run test
npm run typecheck
npm run dev
```

Open `http://localhost:3000`. Offline from the robot the UI reports "Offline". No hosted server is required. The app is a Next.js **static export**.

## Install on Android

First install Node.js 22+, Android Studio and Android SDK. Enable USB debugging on your phone.

```bash
npm install
npm run cap:add:android
npm run cap:open
```

Select the USB-connected Android device and click **Run** in Android Studio. Later: `git pull origin main && npm run cap:sync && npm run cap:open`, then Run again.

The Android project is **generated** and intentionally excluded from Git. The prepare script enables immersive landscape, Internet permission and cleartext local networking.

Connect your phone to **ESP32-CAM Robot** Wi-Fi (SSID); Android may show **Connected without Internet**. Stay on the network. If commands cannot connect, temporarily disable mobile data and Android "switch to mobile data"/network-assist so traffic stays on the no-internet ESP32 AP.

## Continuous-rotation servo gate (Servo 1 / GPIO2)

The mounted **360° continuous-rotation seed-gate servo is not positional**: a PWM
value makes it rotate continuously, rather than move to that angle. Firmware
sets `SERVO_CONTINUOUS = true` so opening/closing uses a **timed movement**
instead. Setting `SERVO_CONTINUOUS = false` restores the existing
`SERVO_OPEN_DEGREES` / `SERVO_CLOSED_DEGREES` positional behavior for a
normal 180° servo. **Servo 2 (future seed-covering rake) always uses the
original positional `writeServo(1, angle)` path**, and remains disabled on
GPIO4 to keep the ESP32-CAM flash LED LOW.

**Before every power-up, manually put the gate fully CLOSED.** The software
initializes its estimated position to closed (zero) and will not home it or
detect its true position. No encoder or limit switch provides feedback:
skipped motion, wheel vibration, a stall, a long loop stall or a reboot can
make the estimate drift. A *suitably engineered, non-damaging* closed-end
physical stop provides a reference, but a continuous servo can keep
pushing against a stop until its timed command ends. Avoid prolonged
stalls; verify the mounting and calibration without seeds first.

### Calibrate in the Arduino firmware

Constants are near `SERVO_CLOSED_DEGREES` in
`firmware/ESP32_CAM_4WD_Controller/ESP32_CAM_4WD_Controller.ino`:

| Constant | Initial value | Calibration |
| --- | --- | --- |
| `SERVO_CONTINUOUS` | `true` | Enable timed control for the 360° gate; `false` for a normal positional gate. |
| `GATE_STOP_US` | `1500` | Approximate neutral pulse in microseconds. With calibration tools, find the value at which the servo does not creep. |
| `GATE_SPIN_US` | `300` | Offset from neutral, typically 50–500 µs. It affects rotation speed. |
| `GATE_TRAVEL_MS` | `500` | Measured travel time to move from fully closed to fully open. |
| `GATE_OPEN_IS_CW` | `false` | Opening uses counter-clockwise rotation (pulse above neutral). Flip to `true` if your physical mechanism opens clockwise. |

If using a timed-servo calibration sketch with `travel180` and the
positional angles, compute:

```text
GATE_TRAVEL_MS = travel180 * abs(SERVO_CLOSED_DEGREES - SERVO_OPEN_DEGREES) / 180
```

Measure the real gate opening on your mounted mechanism; the formula is a
starting estimate, **not positional feedback**. With the committed values,
an opening command uses `1800 µs`, and closing uses `1200 µs`. At the
target estimate the servo PWM duty is set to **zero** (no repeated pulses)
so it stops receiving a rotation command. Depending on servo electronics,
lack of pulses may let the mechanism freewheel, so check that the gate
remains physically closed.

**Plant Cycle's "Keep seed gate open" / Gate release duration must be at
least `GATE_TRAVEL_MS` plus the required seed-fall time.** For example,
with `GATE_TRAVEL_MS = 500` and a release setting of `800 ms`, the
nominal time fully open is only about 300 ms. The firmware waits at least
`GATE_TRAVEL_MS` after commanding close, before driving again. The
app-side `220 ms` plan marker is just a progress estimate and can be
slightly shorter than the actual firmware phase; it does not control the
servo.

### Power and safe bench testing

Power the gate servo from its **own suitable regulated 5 V supply**
(or a dedicated, adequately rated 5 V servo rail) with **common ground**
to the ESP32-CAM and motor driver. **Do not supply servo power from
the L298N on-board regulator or the ESP32-CAM 5 V pin.** Servo peak
currents and motor startup surges can cause brownouts.

With the **wheels raised**, power on with the gate mechanically CLOSED.
First test open and close without a full seed load, watch that it rotates
in the correct direction and stops, and verify that the physical travel
matches `GATE_TRAVEL_MS`. If opening goes the wrong way, **power down**
before changing `GATE_OPEN_IS_CW` and reflash. Confirm that STOP, app
backgrounding and lost Wi-Fi request closing, and that return movement
never begins before the gate finishes its estimated closure. Repeat for
the mounted hopper only after a low-load bench test. If it stalls against
the physical stop, shorten or recalibrate the travel time. There is no
automatic homing or fault detection.

## Seed dispensing — easy setup (October 2026)

The Plant Cycle editor now leads with four questions: **Select plant**, **Dispense first / Move first**, **Forward moves**, and **Stop there / Go back**. It shows a readable route summary. Advanced fields are optional and displayed in **seconds**, not milliseconds.

- **Dispense first** with 2 forward moves: drop at the start → close gate → forward step 1 → drop → close gate → forward step 2 → drop → close gate → optionally reverse step 1 → pause → reverse step 2 → STOP. Total: **3 seed drops, 2 forward moves, 2 reverse moves**.
- **Move first** with 2 forward moves: forward step 1 → drop → close gate → forward step 2 → drop → close gate → optionally reverse two timed steps. Total: **2 seed drops, 2 forward moves, 2 reverse moves**.
- The software waits **220 ms** after commanding the dispensing gate closed before any next movement. Check this experimentally against your MG90S linkage; it may require a longer delay for your hardware.
- Return is **timed reverse**, not GPS/odometry: it does not guarantee returning to the same physical point. The updated app explicitly displays **Reverse move 1 of 2 / 2 of 2**, and the firmware stops for **350 ms** between return steps by default.
- **Rake, future Servo 2**: still **disabled** until the hardware is safely added, including a signal-pinning solution that does not light GPIO4's flash LED. The UI shows a disabled rake toggle for now. Once installed and deliberately enabled in firmware, its experimental sequence is lower rake after seed gate closes, start forward, lift after about 1 second of movement. Validate the positions and clearances before physically enabling it.

### Meaning of the legacy advanced values

| Setting | In everyday terms |
| --- | --- |
| Spacing (cm) | Optional target travel distance. 0 means use the timer instead. Requires real wheel-speed calibration. |
| Drive (ms) | Forward/reverse motor-on time per step (e.g. 3000 ms = 3 seconds). |
| Settle (ms) | Pause between reaching the next spot and opening the seed gate (250 ms = 0.25 seconds). |
| Gate release (ms) | Time Servo 1 keeps the gate open (800 ms = 0.8 seconds). |
| Forward moves / Cycles | Count of **actual forward segments**, not number of seed drops. |
| Stop / Return | End in place, or reverse the same number of timed segments. |

**If Return does not move backward:** The firmware sends exactly the same `drive("back")` motor command as your Manual Reverse button. Test Manual Reverse with wheels raised first. If it spins or moves forward instead, correct the existing physical wheel polarity/direction mapping before trusting Return; the new sequence deliberately does **not** change GPIO assignments or invert your motor outputs.

### HTTP / WebSocket controls

WebSocket `A:` plant JSON now accepts optional `sequence: "dispense-first" | "move-first"`, `useRake: false`, and `rakeLiftMs: 1000`. The old JSON remains valid, using the legacy move-first default. HTTP accepts `&sequence=dispense-first&returnPause=350&rake=0&rakeLift=1000` in addition to the previous plant parameters. New status fields include `returnSegment`, `seedDrops`, `plannedDrops`, `sequence`, and `rakeEnabled`.

## Operating modes

**Manual:** Hold an arrow; pressing sends WS motion immediately, then every ~100 ms; release sends STOP immediately. A degraded HTTP fallback does not flood overlapping motor requests: it aborts in-flight HTTP drive on STOP or direction change and sends stop separately. Keep the board within range.

**Autopilot:** Select the mode first; selection alone does not move the robot. Tap **Start Autopilot** to begin. The ESP32 executes the timed schedule without a phone timer. A 350ms phone heartbeat refreshes the 1400ms auto watchdog. STOP immediately cancels the routine.

**Utility:**
- **Cruise:** drives forward continuously and toggles gate every three seconds.
- **Pulse:** drives for three seconds, stops for three seconds; gate closed.

**Plant Cycle:** Select Corn, Tomato, Lettuce, Eggplant or Custom. All sample timings and spacing are **editable placeholders, not agronomic recommendations**. Edit spacing or drive time, settle time and gate release time. Configure **1–50 cycles**, default 5. Finish with **Stop** or **Return**.

One cycle is: drive forward `driveMs`, stop for optional `settleMs`, open gate for `releaseMs`, close gate; repeat. Return drives backward the same number of `driveMs` segments with gate closed and then stops. An optional `returnPauseMs` configuration (firmware-level, default 0) inserts pauses. **Return is time-based dead reckoning, not actual localization:** wheel slip, turning error, and battery level cause drift. It cannot guarantee reaching the starting position.

**Calibrating time and spacing:** Put robot wheels on the surface you intend to test, in a cleared supervised area. Measure the real distance traveled over 3 seconds, then set **Robot speed (cm/s)** in Settings. The shipped 10 cm/s value is purely illustrative. When spacing is >0, `driveMs = spacingCm / robotSpeedCmPerSec × 1000` (clamped to 100–20,000 ms); spacing 0 uses directly edited drive time. Do not assume the supplied sample timings or crop spacing are suitable.

**Progress:** Shows cycle X/N, Forward/Returning direction, phase, remaining phase time, and Done. The gate closes when done, and the firmware returns to Manual after 10 seconds (or immediately on STOP).

**Settings:** vibration, latency debug (last/average command RTT and failures; off by default), optional servo 2 display (firmware disabled), calibrated speed. Theme turns soft green when Plant Cycle is selected, returns to neutral in Manual or Utility. Reduced motion and high-contrast text are supported.

## WebSocket protocol (port 81)

Client → ESP32 text frames:

| Frame | Function |
| --- | --- |
| `D:go`, `D:back`, `D:left`, `D:right` | Drive command repeated ~100ms while held |
| `S` | Immediate stop and cancel routine |
| `H` | Autopilot heartbeat |
| `G:1:open`, `G:1:close` | Servo 1 (servo 2 disabled) |
| `A:{"preset":"plant","cycles":5,"returnToStart":false,"driveMs":3000,"settleMs":250,"releaseMs":800,"returnPauseMs":0}` | Start validated Plant Cycle |
| `A:{"preset":"cruise"}` / `A:{"preset":"pulse"}` | Utility routine |
| `Q` | Request status |

Robot → client: `T:<json>` (pushed at least every 500ms plus state changes), optional `ACK:<seq>` for frames `D:go:<seq>` / `S:<seq>`, and `E:<message>` on rejected commands. One controller WebSocket client; a new one drops the old and stops motors.

The `/status` JSON includes original fields `device`, `ready`, `mode`, `motion`, `preset`, `phase`, `phaseRemainingMs`, `servoEnabled`, `servo2Enabled`, `uptimeMs`, `resetReason`, plus `cycle`, `totalCycles`, `direction`, `returnToStart`, and `state` (idle/running/done).

HTTP fallback endpoints remain: `/status /go /back /left /right /stop /heartbeat /auto /servo`. Plant HTTP example:
`/auto?mode=plant&cycles=5&return=1&drive=3000&settle=250&release=800&returnPause=0`.
`/auto?mode=plant` continues to use a safe default cycle configuration. Utility `/auto?mode=cruise|pulse` is unchanged.

## Test and safety procedure

1. With motors **disconnected or wheels raised**, upload firmware and test ESP32 boot, 5V, flash LED off, servo without horn.
2. Join the robot AP, open Android app. Enable **Settings → Latency overlay** and note last and average RTT. Compare `WS` and degraded `HTTP` fallback if available. **Under 60ms** is a design target on a healthy local AP, not a verified measurement.
3. Hold and release each directional button. Verify motor mapping separately. Do not attach the mechanical gate until servo directions are confirmed.
4. Turn the app off or disconnect Wi-Fi during a held command. Confirm wheels stop **within the specified deadman** (350ms WS; 700ms HTTP). During Auto disconnect, verify stop within 1400ms. Physical timing must be measured.
5. Only then test a **single** Plant Cycle with Return disabled. Verify STOP and phases, then multi-cycle/Return in a clear area. Never operate unattended; **no obstacle sensors/encoders**.

`npm run test`, `npm run typecheck`, `npm run build`, and `npm run cap:add:android` are run in CI. Arduino firmware compilation is a separate CI job; physical Android WebView WebSocket mixed-content, radio latency, actual servo timing, and motor power/brownouts require bench testing.

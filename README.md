# 4WD / FIELD CONTROLLER

Android-first Next.js + Capacitor controller for the **LAFVIN ESP32-CAM 4WD Robot Car Kit V3**. No Flutter, no Arduino Uno, no cloud inference, and no camera streaming for this version.

The complete Next.js app and matching ESP32 firmware are in this repository. The interface is an original PSP-inspired graphite-and-silver landscape handheld controller, with flat Lucide SVG icons (no emoji) and system typography.

## Requirements

- Node.js 22+ and npm
- Android Studio with Android SDK + a USB-connected Android phone for an APK
- Arduino IDE with the Espressif ESP32 boards package 3.x to flash the firmware
- ESP32-CAM kit already wired to L298N, and properly powered 5V MG90S servo(s) when ready
- A multimeter to verify the XL4016 5V output **before** connecting servo power

## Run as a website first

```bash
git pull origin main
npm install
npm run test
npm run dev
```

Visit `http://localhost:3000` on a computer. The UI is available even without the board, but shows **Robot not connected** until the ESP32 is running the updated firmware and the computer is joined to its Wi-Fi hotspot. Browser-to-ESP32 requests are CORS-enabled by the bundled firmware.

## Build the Android app with Capacitor

The old Flutter `android/` files were removed. Capacitor generates a new Android project from the Next.js static export.

```bash
npm install
npm run cap:add:android
npm run cap:open
```

`cap:add:android` runs `next build`, creates the Android project and applies the required manifest settings. Android Studio then opens the generated project. From Android Studio, build or install the app onto your phone.

**Later code updates:** `npm run cap:sync` followed by `npm run cap:open`. Capacitor embeds the `out/` files in the APK. **No online website/server is required on the phone.**

Android configuration:
- Landscape orientation on the native Activity, with an in-app rotate prompt for web portrait
- `INTERNET` permission and local cleartext HTTP support
- Mixed content enabled because the Capacitor WebView's `https://localhost` origin fetches `http://192.168.4.1`
- Capacitor Haptics and App lifecycle plugins

The Android platform and APK are generated locally and intentionally not committed to Git. **Flutter is not needed.**

## Connect to the robot

1. Open `firmware/ESP32_CAM_4WD_Controller/ESP32_CAM_4WD_Controller.ino` in Arduino IDE; select AI Thinker ESP32-CAM and ESP32 core 3.x.
2. Flash the updated firmware. The camera is disabled.
3. Join the phone Wi-Fi network **ESP32-CAM Robot**, password **robotcontrol** (change the default in the firmware before deployment).
4. If Android reports **No internet**, remain connected to that network. If HTTP requests still fail, temporarily disable mobile data / switch-to-mobile-data assistance.
5. Open the Capacitor app; status detection checks the `device: LAFVIN-4WD` marker at `192.168.4.1/status`.
6. Test driving with the **wheels raised** and servo horn removed. Verify every direction and STOP before enabling Autopilot.

The controller never claims the robot is connected based only on Wi-Fi state; it waits for a valid ESP32 status response.

## Fullscreen touch controller (current)

The handheld/PSP frame has been replaced with a flat, minimal, edge-to-edge
three-column landscape controller. Drive buttons are large touch targets.
Manual driving uses the existing single-flight hold-to-drive stream and the
ESP32's 700ms stop watchdog. Releasing a button sends STOP; status polling
does not compete with held commands. The app tolerates isolated delayed
responses instead of instantly reporting offline. The Android preparation
script also configures immersive fullscreen navigation/status bars where
supported.

**Flashlight behavior:** AI Thinker ESP32-CAM uses **GPIO4** for its white flash
LED. The firmware now sets `ENABLE_SERVO_2 = false` by default, holds GPIO4
LOW, and skips configuring its servo PWM channel entirely. This prevents
the flashlight turning on as a side effect of initializing an unused
second servo. Servo 1 remains on GPIO2. If you later change
`ENABLE_SERVO_2 = true` to control a second servo on GPIO4, PWM on that
pin will also drive the onboard LED; use a different controller/pin
arrangement to avoid that hardware conflict. Settings cannot override
the firmware's disabled second-servo state.

The existing L298N IN1–IN4 pins and drive-direction mapping have **not
been modified**. If Forward/Reverse/Left/Right do not match the physical
robot, test with wheels raised and correct the wiring/firmware separately.
The app cannot fix ESP32 brownouts from inadequate 5V motor-driver power.

## Controls

| Control | Behavior |
| --- | --- |
| D-pad | Hold to drive Forward / Back / Left / Right; release to stop |
| A / B | Servo gate 1 open / close in Manual mode |
| Second servo | Disabled by default; requires physical wiring and firmware opt-in |
| Manual | Cancels Autopilot, stops motors |
| Auto preset | Start selected timed routine |
| Stop / Override | Explicit software motor stop and switch to Manual |
| Settings | Local haptic vibration and optional second-servo UI |

Autopilot presets operate **on the ESP32**, not via a phone timer:

- **Plant cycle:** Gate closed and move forward for 3 seconds (250ms settling delay), then stop and open the gate for 3 seconds, repeat.
- **Cruise:** Move forward continuously while toggling gate state every 3 seconds.
- **Pulse drive:** Move forward 3 seconds, stop 3 seconds, gate stays closed.

App sends a heartbeat every ~350ms while automatic mode is active. The ESP32 watchdog stops autopilot if heartbeats disappear for 1400ms, and stops manual movement when directional commands stop for 700ms. App also sends stop on background/blur. These are **software-only**, and do not replace an accessible physical motor power switch. Autopilot has **no obstacle detection**.

## ESP32-CAM wiring (original LAFVIN mapping)

| ESP32-CAM pin | Destination |
| --- | --- |
| GPIO15 | L298N IN1 |
| GPIO14 | L298N IN2 |
| GPIO13 | L298N IN3 |
| GPIO12 | L298N IN4 |
| GPIO2 | MG90S #1 signal orange |
| GPIO4 | Onboard flash LED held LOW by default; second servo disabled in firmware |
| GND | Common L298N and XL4016 GND |
| 5V | Proper regulated 5V power |

Keep L298N ENA/ENB motor-enable jumpers as installed. Batteries remain on L298N motor power.

### Critical power limitations

Your three 18650 cells **in series** reach **12.6V fully charged**. The L298N onboard 5V regulator should not be used above 12V motor supply. Although your old wiring supplied ESP32 5V from L298N, **do not rely on this as the safe permanent configuration**; moving only servo power to XL4016 does not eliminate that risk.

Recommended single-XL4016 final setup: switched protected 3S battery feeds both L298N motor input and XL4016 input. Adjust XL4016 output to **5.0V with multimeter**. XL4016 OUT+ feeds ESP32-CAM 5V, the MG90S servos, and L298N logic 5V input **only after removing its 5V-EN onboard-regulator jumper**. XL4016 OUT− joins all grounds. Do not connect two separate 5V regulator outputs together.

Set each servo's open and closed angles in the firmware with its horn removed, and verify current headroom for simultaneous stalls. GPIO2 is a boot strapping pin; GPIO4 is shared with flash LED. No SD card should be installed. Confirm ESP32 reliably boots with the signal wires connected before loading the mechanism.

## API

Local ESP32 HTTP GET endpoints: `/status`, `/go`, `/back`, `/left`, `/right`, `/stop`, `/heartbeat`, `/auto?mode=plant|cruise|pulse`, `/servo?channel=1|2&gate=open|close`.

Status reports `device`, `ready`, `mode`, `motion`, `phase`, `phaseRemainingMs`, `servoEnabled`, and `preset`. CORS is enabled for local Capacitor WebView access. Only an ESP32 with this firmware will pass the app's device identity check. The Wi-Fi is local; anyone connected to the AP may send commands. Change the default Wi-Fi password.

## Validation

`npm run test` runs the protocol regression tests using Node 22. `npm run build` exports the static Next.js application; `npm run cap:sync` copies it to the native Android project. No hardware/electronics behavior should be considered tested until validated on the physical robot.

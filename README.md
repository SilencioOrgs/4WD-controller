# 4WD / FIELD UNIT

Minimal, landscape-first Flutter controller for the **LAFVIN ESP32-CAM 4WD Robot Car Kit V3**. The ESP32-CAM is the sole controller; **no Arduino Uno** is required. Camera initialization is deliberately disabled for this version.

## App

- Handheld PSP-inspired matte graphite shell with left D-pad, right action keys and center display
- Manual: press-and-hold D-pad to drive, release to stop; A opens servo gate 1, B closes it
- Auto: three selectable presets
  - **Plant Cycle:** gate closed / drive forward for 3 seconds, then stop / gate open for 3 seconds
  - **Cruise:** drive continuously forward, toggle the gate open/closed every 3 seconds
  - **Pulse:** drive forward 3 seconds, then stop 3 seconds, gate kept closed
- Hardware-enforced watchdog: manual drive stops within 700ms of missed commands; autopilot stops within 1400ms of missed app heartbeats
- Wi-Fi status checks and connection instructions, manually retryable
- Haptic toggle and optional second-servo controls; red Emergency Stop button
- Offline / unreachable state prevents new movement commands

**Important:** Timed autopilot is NOT obstacle avoidance. Use only in a cleared, supervised area. The emergency stop is a software command, not a substitute for a physical power switch.

## Pin map (original LAFVIN motor pins)

| ESP32-CAM | Destination |
| --- | --- |
| GPIO15 | L298N IN1 |
| GPIO14 | L298N IN2 |
| GPIO13 | L298N IN3 |
| GPIO12 | L298N IN4 |
| GPIO2 | MG90S #1 signal (orange) |
| GPIO4 | Optional MG90S #2 signal (orange); onboard flash LED not usable |
| GND | L298N GND and XL4016 OUT- (all grounds common) |
| 5V | Existing regulated 5V power path (see warning below) |

L298N ENA/ENB motor-enable jumpers remain installed. Keep the four DC motors connected as in the kit's original wiring diagram.

### Power — read before connecting any servo

The 3×18650 **series** battery pack is nominal 11.1V, **12.6V fully charged**. It powers the L298N motor input and an XL4016 converter input **in parallel**, via switched, protected wiring.

Set the XL4016 output with a multimeter to **5.0V BEFORE connecting servos**. Servo red wires → XL4016 OUT+; brown wires → XL4016 OUT-. The converter needs enough current for both servos' peak loads. Its PWM product name refers to the converter's switching circuit, not a servo signal generator.

Your former L298N 5V → ESP32-CAM connection is documented but **not recommended** on 3S cells: the L298N onboard regulator should not be used above 12V (fully charged pack = 12.6V). Safer final wiring: XL4016 5V → ESP32-CAM 5V **and** L298N 5V logic input, with the L298N **5V-EN regulator jumper removed**. Keep motor-enable ENA/ENB jumpers installed. **Do not connect two 5V regulator outputs together.**

GPIO2 is a boot strapping pin and GPIO4 doubles as the camera board's flash LED. This version requires **no microSD**; test boot reliability with servo signal connected and no motor load. Never supply servo current from ESP32 3.3V or L298N onboard 5V.

## Install and run Flutter

This repo includes Flutter source and Android project settings. Use Flutter 3.24+ / Dart 3.5+, Java 17, and an Android SDK. Android generated wrapper files may need regeneration on a clean checkout:

```bash
flutter create --platforms=android .
flutter pub get
flutter run
```

Then verify `android/app/src/main/AndroidManifest.xml` still specifies landscape, `INTERNET` permission and `usesCleartextTraffic="true"` (needed for local HTTP). Android builds have not been executed in this session, because Flutter SDK is not available.

The app hardcodes `192.168.4.1`. Connect the phone to the robot Wi-Fi first (it may report “No Internet”; remain connected).

## Upload firmware

1. Arduino IDE → Boards Manager: Espressif ESP32 core 3.x.
2. Select **AI Thinker ESP32-CAM**, suitable upload port.
3. Open `firmware/ESP32_CAM_4WD_Controller/ESP32_CAM_4WD_Controller.ino`.
4. Adjust servo `SERVO_OPEN_DEGREES` and `SERVO_CLOSED_DEGREES` for your actual mechanism with the servo horn removed.
5. Upload over the programmer connection. Power-cycle the board.
6. Connect phone to SSID **ESP32-CAM Robot** with password **robotcontrol** (change `AP_PASS` in sketch before deployment). Open Flutter app; tap Retry if necessary.
7. Confirm status, test stop, then individual direction buttons **with the wheels raised**, and test gate angles with horn removed.

Original legacy URLs `/go`, `/back`, `/left`, `/right`, `/stop` are kept. New endpoints: `/status`, `/heartbeat`, `/auto?mode=plant|cruise|pulse`, `/servo?channel=1|2&gate=open|close`. Wi-Fi is AP-mode local-only and camera is deliberately disabled.

## Development and verification

Flutter test entrypoint: `flutter test`. Firmware compile: Arduino IDE **Verify** with ESP32 core 3.x. These builds and physical behaviors require local tooling/hardware and are **not verified** in this environment.

The implemented safeguards are best-effort software controls, not a safety-rated system. Test only under direct supervision and retain physical power isolation.

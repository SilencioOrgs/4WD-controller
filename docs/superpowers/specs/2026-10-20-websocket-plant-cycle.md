# WebSocket robot control and timed Plant Cycle — October 2026

## Goals
Primary communication via WS at `ws://192.168.4.1:81`, fallback to original HTTP on port 80. No camera, SD, cloud or Arduino Uno. Unchanged physical GPIO mapping and flash LED off on GPIO4.

## Protocol
Drive: `D:<direction>[:seq]` at 100ms held cadence; `S[:seq]` stop immediately; `H` autopilot heartbeat; `G:<channel>:<open|close>`; `A:<json>` start routine; `Q[:seq]` request status. Board pushes `T:<status-json>` every 500ms and state changes; acknowledges sequenced motor commands with `ACK:<seq>` and rejects invalid commands with `E:<reason>`.

Board keeps one WS controller and stops when replacing or disconnecting. WS deadman 350ms, HTTP 700ms, auto heartbeat 1400ms; these are independent firmware watchdogs. Phone removes background control on visibility and native app pause, but no blur stop on ordinary UI focus shifts.

## Plant planner
Client calculates `driveMs` from `spacingCm/speedCmPerSec*1000` if spacing > 0, else uses manually configured `driveMs`. Samples are timing placeholders; not planting guidance. Config includes cycles 1–50, `returnToStart`, `driveMs`, `settleMs`, `releaseMs`, `returnPauseMs`. Firmware validates all fields: required drive/release duration 100–20000ms, optional settle/pause 0 or 100–20000ms. A cycle is drive → optional settle → release. On final release: either done or backward drive for the same number of timed segments with gate closed. Software stop always cancels. Done state lasts at most 10s; return-to-start is approximate due to no encoders.

## Verification
Tests cover immediate stop, direction changes, reconnect backoff/fallback, planner segment counts and validation. CI checks Next.js static build, typecheck, Capacitor generation, and ESP32 core 3.x compile with ArduinoJson v7 and Links2004 WebSockets.

## Risks
Mixed content in the Android WebView, RTT under physical AP load and drive stop timing need a device. Historical L298N 5V supply may brownout and is not safe at full 3S charge (12.6V). Protect cells and use proper 5V regulation. Firmware is not a certified safety controller.

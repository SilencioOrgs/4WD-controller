# Next.js + Capacitor conversion design

## Context
Flutter is not available to the developer. Retain the landscape gamepad controller and direct phone-to-robot ESP32-CAM Wi-Fi architecture. User has explicitly authorized direct edits to the repository main branch.

## Choice
Use Next.js App Router with `output: "export"`, Capacitor Android to embed static web assets, and CSS to render a grayscale PSP-inspired shell. Use system fonts and Lucide icons rather than external assets.

## Protocol
Keep existing ESP32-CAM motor GPIO12/13/14/15, autopilot modes, two possible servo signal outputs GPIO2/4, and HTTP GET command endpoints. Augment firmware with CORS and a device identity marker. App polls `/status`; controls are disabled until a valid response arrives.

## Fail-safe control
D-pad is press-and-hold, repeated commands every 240ms, release sends explicit stop after any in-flight drive request. The board independently stops on missing motion commands within 700ms. Autopilot state is managed on board and requires app heartbeats at 350ms intervals; ESP32 stops within 1400ms without them. Background/blur triggers stop. Separate physical power isolation remains necessary.

## Packaging
Android project is generated with `cap add android` and not tracked. Post-generation script ensures landscape orientation, Internet permission, and cleartext local network access. Flutter files are removed from source control. No external server or account is required.

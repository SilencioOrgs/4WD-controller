/*
 * LAFVIN ESP32-CAM 4WD controller — phone app bridge, camera disabled.
 * Board: AI Thinker ESP32-CAM, Arduino ESP32 core 3.x.
 * Existing L298N: GPIO15 -> IN1, GPIO14 -> IN2,
 * GPIO13 -> IN3, GPIO12 -> IN4. ENA/ENB motor jumpers installed.
 * Servo 1 signal GPIO2; optional servo 2 signal GPIO4 (flash LED pin).
 * Both MG90S servos REQUIRE external regulated 5V, shared GND.
 * GPIO2 and GPIO4 are boot/SD-related: remove SD, test startup with
 * servo power disconnected first, ensure signal not forced high at boot.
 * The L298N onboard 5V regulator is NOT a servo power supply.
 */
#include <Arduino.h>
#include <WiFi.h>
#include <WebServer.h>
#include "driver/ledc.h"
#include "esp_system.h"

static const char* AP_SSID = "ESP32-CAM Robot";
static const char* AP_PASS = "robotcontrol"; // change before first deployment
static const uint32_t MOTION_TIMEOUT_MS = 700;
static const uint32_t AUTO_TIMEOUT_MS = 1400;
static const uint32_t PERIOD_MS = 3000;
static const uint8_t MOTOR_PWM = 150;
static const int motorPins[4] = {13, 12, 14, 15};
static const ledc_channel_t motorChannels[4] = {
  LEDC_CHANNEL_4, LEDC_CHANNEL_5, LEDC_CHANNEL_6, LEDC_CHANNEL_7
};
static const int servoPins[2] = {2, 4};
// The AI Thinker ESP32-CAM flash LED is on GPIO4. Leave this false unless
// servo 2 is actually installed: PWM on GPIO4 otherwise lights the flash.
static const bool ENABLE_SERVO_2 = false;
static const ledc_channel_t servoChannels[2] = {LEDC_CHANNEL_2, LEDC_CHANNEL_3};
static const int SERVO_OPEN_DEGREES = 0;
static const int SERVO_CLOSED_DEGREES = 90;

WebServer server(80);
String resetCause = "UNKNOWN";
enum class Mode { Manual, Plant, Cruise, Pulse };
Mode mode = Mode::Manual;
String motion = "stop";
String phase = "idle";
bool motorReady = false;
bool servoReady = false;
uint32_t lastMove = 0;
uint32_t lastHeartbeat = 0;
uint32_t phaseStart = 0;

void writeMotor(uint8_t a, uint8_t b, uint8_t c, uint8_t d) {
  if (!motorReady) return;
  uint8_t values[4] = {a, b, c, d};
  for (int i = 0; i < 4; ++i) {
    ledc_set_duty(LEDC_LOW_SPEED_MODE, motorChannels[i], values[i]);
    ledc_update_duty(LEDC_LOW_SPEED_MODE, motorChannels[i]);
  }
}
void stopMotor() { writeMotor(0, 0, 0, 0); motion = "stop"; }
void drive(const String& direction) {
  if (direction == "go") {
    writeMotor(0, MOTOR_PWM, 0, MOTOR_PWM);
    motion = "forward";
  } else if (direction == "back") {
    writeMotor(MOTOR_PWM, 0, MOTOR_PWM, 0);
    motion = "backward";
  } else if (direction == "left") {
    writeMotor(MOTOR_PWM, 0, 0, MOTOR_PWM);
    motion = "left";
  } else if (direction == "right") {
    writeMotor(0, MOTOR_PWM, MOTOR_PWM, 0);
    motion = "right";
  } else { stopMotor(); }
}
void writeServo(int index, int angle) {
  if (!servoReady || index < 0 || index > 1 || (index == 1 && !ENABLE_SERVO_2)) return;
  angle = constrain(angle, 0, 180);
  // 50Hz 16-bit PWM: 500–2500 microseconds.
  uint32_t pulseUs = 500 + (uint32_t)angle * 2000 / 180;
  uint32_t duty = (uint32_t)((uint64_t)pulseUs * 65535 / 20000);
  ledc_set_duty(LEDC_LOW_SPEED_MODE, servoChannels[index], duty);
  ledc_update_duty(LEDC_LOW_SPEED_MODE, servoChannels[index]);
}
void gate(bool open, int index = 0) {
  writeServo(index, open ? SERVO_OPEN_DEGREES : SERVO_CLOSED_DEGREES);
}
void enterManual() {
  mode = Mode::Manual;
  stopMotor();
  phase = "idle";
}
void enterAuto(Mode next) {
  stopMotor();
  mode = next;
  phase = "drive";
  phaseStart = millis();
  lastHeartbeat = millis();
  gate(false);
}
void runAuto(uint32_t now) {
  if (mode == Mode::Manual) return;
  if ((uint32_t)(now - lastHeartbeat) > AUTO_TIMEOUT_MS) {
    enterManual();
    return;
  }
  uint32_t elapsed = now - phaseStart;
  if (elapsed >= PERIOD_MS) {
    phaseStart = now;
    phase = phase == "drive" ? "release" : "drive";
  }
  if (mode == Mode::Cruise) {
    // Continuous forward driving; toggle gate on three-second phases.
    gate(phase == "release");
    drive("go");
  } else if (mode == Mode::Pulse) {
    // Motor pulse test: three seconds forward then three seconds stopped.
    gate(false);
    if (phase == "drive") drive("go");
    else stopMotor();
  } else if (phase == "drive") {
    // Plant cycle: gate closed and forward for 3 s; pause before advancing.
    gate(false);
    if ((uint32_t)(now - phaseStart) >= 250) drive("go");
    else stopMotor();
  } else {
    stopMotor();
    gate(true);
  }
}
String modeName() {
  switch (mode) {
    case Mode::Plant: return "auto";
    case Mode::Cruise: return "auto";
    case Mode::Pulse: return "auto";
    default: return "manual";
  }
}
void addCorsHeaders() {
  // Capacitor uses https://localhost; Android WebView otherwise rejects
  // GET requests to the local ESP32 Wi-Fi access point.
  server.sendHeader("Access-Control-Allow-Origin", "*");
  server.sendHeader("Cache-Control", "no-store");
}
void respondOK() { addCorsHeaders(); server.send(200, "text/plain", "OK"); }
void registerDrive(const char* endpoint) {
  server.on(String("/") + endpoint, HTTP_GET, [endpoint]() {
    addCorsHeaders();
    if (!motorReady) { server.send(503, "text/plain", "Motor PWM unavailable"); return; }
    if (mode != Mode::Manual) { server.send(409, "text/plain", "Switch to manual"); return; }
    lastMove = millis();
    drive(String(endpoint));
    respondOK();
  });
}
void initMotors() {
  ledc_timer_config_t timer = {};
  timer.speed_mode = LEDC_LOW_SPEED_MODE;
  timer.duty_resolution = LEDC_TIMER_8_BIT;
  timer.timer_num = LEDC_TIMER_1;
  timer.freq_hz = 2000;
  timer.clk_cfg = LEDC_AUTO_CLK;
  if (ledc_timer_config(&timer) != ESP_OK) return;
  for (int i = 0; i < 4; ++i) {
    ledc_channel_config_t channel = {};
    channel.gpio_num = motorPins[i];
    channel.speed_mode = LEDC_LOW_SPEED_MODE;
    channel.channel = motorChannels[i];
    channel.intr_type = LEDC_INTR_DISABLE;
    channel.timer_sel = LEDC_TIMER_1;
    channel.duty = 0;
    channel.hpoint = 0;
    if (ledc_channel_config(&channel) != ESP_OK) return;
  }
  motorReady = true;
  stopMotor();
}
void initServos() {
  if (!ENABLE_SERVO_2) {
    // Keep the onboard flashlight OFF when servo 2 is not used.
    digitalWrite(4, LOW);
    pinMode(4, OUTPUT);
    digitalWrite(4, LOW);
  }
  ledc_timer_config_t timer = {};
  timer.speed_mode = LEDC_LOW_SPEED_MODE;
  timer.duty_resolution = LEDC_TIMER_16_BIT;
  timer.timer_num = LEDC_TIMER_2;
  timer.freq_hz = 50;
  timer.clk_cfg = LEDC_AUTO_CLK;
  if (ledc_timer_config(&timer) != ESP_OK) return;
  for (int i = 0; i < 2; ++i) {
    if (i == 1 && !ENABLE_SERVO_2) continue;
    ledc_channel_config_t channel = {};
    channel.gpio_num = servoPins[i];
    channel.speed_mode = LEDC_LOW_SPEED_MODE;
    channel.channel = servoChannels[i];
    channel.intr_type = LEDC_INTR_DISABLE;
    channel.timer_sel = LEDC_TIMER_2;
    channel.duty = 0;
    channel.hpoint = 0;
    if (ledc_channel_config(&channel) != ESP_OK) return;
  }
  servoReady = true;
  gate(false, 0);
  gate(false, 1);
}
String resetCauseName() {
  switch (esp_reset_reason()) {
    case ESP_RST_BROWNOUT: return "BROWNOUT";
    case ESP_RST_POWERON: return "POWER_ON";
    case ESP_RST_PANIC: return "PANIC";
    case ESP_RST_WDT: return "WATCHDOG";
    case ESP_RST_SW: return "SOFTWARE";
    default: return "OTHER";
  }
}
void configureRoutes() {
  server.on("/status", HTTP_GET, []() {
    addCorsHeaders();
    String result = "{\"device\":\"LAFVIN-4WD\",\"ready\":";
    result += motorReady ? "true" : "false";
    result += ",\"mode\":\"" + modeName() + "\"";
    result += ",\"motion\":\"" + motion + "\"";
    result += ",\"phase\":\"" + phase + "\"";
    result += ",\"phaseRemainingMs\":";
    result += mode == Mode::Manual ? 0 : (int)max(0L, (long)PERIOD_MS - (long)(millis() - phaseStart));
    result += ",\"servoEnabled\":";
    result += servoReady ? "true" : "false";
    result += ",\"servo2Enabled\":";
    result += ENABLE_SERVO_2 ? "true" : "false";
    result += ",\"uptimeMs\":" + String(millis());
    result += ",\"resetReason\":\"" + resetCause + "\"";
    result += ",\"preset\":";
    if (mode == Mode::Plant) result += "\"plant\"";
    else if (mode == Mode::Cruise) result += "\"cruise\"";
    else if (mode == Mode::Pulse) result += "\"pulse\"";
    else result += "null";
    result += "}";
    server.send(200, "application/json", result);
  });
  registerDrive("go");
  registerDrive("back");
  registerDrive("left");
  registerDrive("right");
  server.on("/stop", HTTP_GET, []() { enterManual(); respondOK(); });
  server.on("/heartbeat", HTTP_GET, []() {
    lastHeartbeat = millis();
    respondOK();
  });
  server.on("/auto", HTTP_GET, []() {
    addCorsHeaders();
    if (!motorReady) { server.send(503, "text/plain", "Motor PWM unavailable"); return; }
    const String requested = server.arg("mode");
    if (requested == "plant") enterAuto(Mode::Plant);
    else if (requested == "cruise") enterAuto(Mode::Cruise);
    else if (requested == "pulse") enterAuto(Mode::Pulse);
    else { server.send(400, "text/plain", "Unknown preset"); return; }
    respondOK();
  });
  server.on("/servo", HTTP_GET, []() {
    addCorsHeaders();
    if (mode != Mode::Manual) { server.send(409, "text/plain", "Switch to manual"); return; }
    const int channel = server.arg("channel").toInt();
    const String position = server.arg("gate");
    if (channel < 1 || channel > 2 || (position != "open" && position != "close")) {
      server.send(400, "text/plain", "Bad servo parameters"); return;
    }
    if (channel == 2 && !ENABLE_SERVO_2) {
      server.send(409, "text/plain", "Servo 2 disabled to keep flashlight off"); return;
    }
    gate(position == "open", channel - 1);
    respondOK();
  });
  // Older page compatibility. Disabled camera endpoints are intentional.
  server.on("/ledon", HTTP_GET, []() { addCorsHeaders(); server.send(410, "text/plain", "Flashlight disabled"); });
  server.on("/ledoff", HTTP_GET, []() { addCorsHeaders(); server.send(410, "text/plain", "GPIO4 assigned to servo 2"); });
  server.on("/", HTTP_GET, []() {
    addCorsHeaders();
    server.send(200, "text/plain", "4WD FIELD UNIT online. Connect using the Capacitor controller. /status");
  });
  server.onNotFound([]() { addCorsHeaders(); server.send(404, "text/plain", "Unknown command"); });
}
void setup() {
  Serial.begin(115200);
  resetCause = resetCauseName();
  Serial.printf("[BOOT] reason=%s\\n", resetCause.c_str());
  initMotors();
  initServos();
  WiFi.mode(WIFI_AP);
  WiFi.softAP(AP_SSID, AP_PASS);
  configureRoutes();
  server.begin();
  Serial.printf("Robot AP: %s  IP: %s\n", AP_SSID, WiFi.softAPIP().toString().c_str());
}
void loop() {
  server.handleClient();
  uint32_t now = millis();
  if (mode != Mode::Manual) runAuto(now);
  else if (motion != "stop" && (uint32_t)(now - lastMove) > MOTION_TIMEOUT_MS) stopMotor();
  delay(5);
}

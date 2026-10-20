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
#include <WebSocketsServer.h>
#include <ArduinoJson.h>

static const char* AP_SSID = "ESP32-CAM Robot";
static const char* AP_PASS = "robotcontrol"; // change before first deployment
static const uint32_t MOTION_TIMEOUT_MS = 700;
static const uint32_t WS_MOTION_TIMEOUT_MS = 350;
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
WebSocketsServer webSocket(81);
uint8_t controllerClient = 255;
bool wsDriving = false;
uint32_t lastStatusPush = 0;
String lastStateKey = "";
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
void gate(bool open, int index=0);
void rake(bool down);
struct PlantTiming {
  uint8_t cycles = 5;
  bool returnToStart = false;
  uint32_t driveMs = 3000;
  uint32_t settleMs = 250;
  uint32_t releaseMs = 3000;
  uint32_t returnPauseMs = 350;
  bool dispenseFirst = false; // legacy clients still move first
  bool useRake = false; // optional future hardware
  uint32_t rakeLiftMs = 1000;
};
PlantTiming planting;
uint8_t cycleNumber = 0;
uint8_t returnSegment = 0;
uint8_t seedDrops = 0;
static const uint32_t RAKE_LOWER_WAIT_MS = 150;
static const uint32_t GATE_CLOSE_WAIT_MS = 220; // Allow MG90S gate to reach closed position before wheels move.
// Adjust only after servo 2 has its own safe signal output and mechanical calibration.
static const int RAKE_UP_DEGREES = 0;
static const int RAKE_DOWN_DEGREES = 90;
uint32_t doneAt = 0;
String autopilotState = "idle";
String travelDirection = "forward";
bool durationOK(uint32_t value, bool optional=false) {
  return (optional && value == 0) || (value >= 100 && value <= 20000);
}
bool validPlant(const PlantTiming& p) {
  return p.cycles >= 1 && p.cycles <= 50 && durationOK(p.driveMs) &&
    durationOK(p.releaseMs) && durationOK(p.settleMs,true) &&
    durationOK(p.returnPauseMs,true) &&
    (!p.useRake || (ENABLE_SERVO_2 && durationOK(p.rakeLiftMs) && p.rakeLiftMs <= p.driveMs));
}
uint32_t phaseLimit() {
  if (mode != Mode::Plant) return PERIOD_MS;
  if (phase == "drive" || phase == "returning") return planting.driveMs;
  if (phase == "settle") return planting.settleMs;
  if (phase == "release") return planting.releaseMs;
  if (phase == "returnPause") return planting.returnPauseMs;
  if (phase == "rakeDown") return RAKE_LOWER_WAIT_MS;
  if (phase == "gateClose") return GATE_CLOSE_WAIT_MS;
  return 0;
}
void nextPlantPhase(const String &next, uint32_t now) {
  phase=next; phaseStart=now;
}
void finishPlant(uint32_t now) {
  stopMotor(); gate(false); rake(false);
  nextPlantPhase("done",now);
  autopilotState="done"; doneAt=now;
}
void enterAuto(Mode next);  // Explicit forward declaration for Arduino .ino preprocessing.
void startPlant(const PlantTiming& p) {
  if(!validPlant(p)) return;
  planting=p; cycleNumber=p.dispenseFirst ? 0 : 1; returnSegment=0; seedDrops=0;
  enterAuto(Mode::Plant);
  autopilotState="running"; travelDirection="forward";
  nextPlantPhase(p.dispenseFirst ? "release" : (p.useRake ? "rakeDown" : "drive"),millis());
}

uint8_t lastMotorDuty[4] = {255,255,255,255};
void writeMotor(uint8_t a, uint8_t b, uint8_t c, uint8_t d) {
  if (!motorReady) return;
  uint8_t values[4] = {a, b, c, d};
  for (int i=0; i<4; ++i) {
    if(lastMotorDuty[i] == values[i]) continue;
    lastMotorDuty[i]=values[i];
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
int lastServoAngle[2]={-1,-1};
void writeServo(int index, int angle) {
  if (!servoReady || index < 0 || index > 1 || (index == 1 && !ENABLE_SERVO_2)) return;
  angle = constrain(angle, 0, 180);
  if(lastServoAngle[index] == angle) return;
  lastServoAngle[index] = angle;
  // 50Hz 16-bit PWM: 500–2500 microseconds.
  uint32_t pulseUs = 500 + (uint32_t)angle * 2000 / 180;
  uint32_t duty = (uint32_t)((uint64_t)pulseUs * 65535 / 20000);
  ledc_set_duty(LEDC_LOW_SPEED_MODE, servoChannels[index], duty);
  ledc_update_duty(LEDC_LOW_SPEED_MODE, servoChannels[index]);
}
void gate(bool open, int index) {
  writeServo(index, open ? SERVO_OPEN_DEGREES : SERVO_CLOSED_DEGREES);
}
void rake(bool down) {
  if (!ENABLE_SERVO_2) return;
  writeServo(1, down ? RAKE_DOWN_DEGREES : RAKE_UP_DEGREES);
}
void enterManual() {
  mode = Mode::Manual;
  wsDriving = false;
  stopMotor();
  gate(false);
  rake(false);
  phase = "idle";
  autopilotState="idle";
}
void enterAuto(Mode next) {
  stopMotor();
  mode = next;
  phase = "drive";
  phaseStart = millis();
  lastHeartbeat = millis();
  gate(false);
  autopilotState="running";
}
void runAuto(uint32_t now) {
  if (mode == Mode::Manual) return;
  if(mode == Mode::Plant && phase=="done") {
    stopMotor();
    if((uint32_t)(now-doneAt)>10000) enterManual();
    return;
  }
  if ((uint32_t)(now - lastHeartbeat) > AUTO_TIMEOUT_MS) {
    enterManual();
    return;
  }
  uint32_t elapsed = now - phaseStart;
  if (mode == Mode::Plant) {
    // A complete planting operation can start with a seed drop at the origin.
    if (phase == "rakeDown") {
      stopMotor(); gate(false); rake(true);
      if (elapsed >= RAKE_LOWER_WAIT_MS) nextPlantPhase("drive", now);
    } else if (phase == "drive") {
      gate(false);
      if (planting.useRake && elapsed >= planting.rakeLiftMs) rake(false);
      drive("go");
      if (elapsed >= planting.driveMs) {
        stopMotor(); rake(false);
        nextPlantPhase(planting.settleMs > 0 ? "settle" : "release", now);
      }
    } else if (phase == "settle") {
      stopMotor(); gate(false); rake(false);
      if (elapsed >= planting.settleMs) nextPlantPhase("release", now);
    } else if (phase == "release") {
      stopMotor(); rake(false); gate(true);
      if (elapsed >= planting.releaseMs) {
        gate(false);
        seedDrops++;
        nextPlantPhase("gateClose", now);
      }
    } else if (phase == "gateClose") {
      stopMotor(); gate(false);
      if (elapsed >= GATE_CLOSE_WAIT_MS) {
        // Initial drop is position 0. Count only the forward moves.
        if (planting.dispenseFirst && cycleNumber == 0) {
          cycleNumber = 1;
          nextPlantPhase(planting.useRake ? "rakeDown" : "drive", now);
        } else if (cycleNumber < planting.cycles) {
          cycleNumber++;
          nextPlantPhase(planting.useRake ? "rakeDown" : "drive", now);
        } else if (planting.returnToStart) {
          travelDirection = "returning";
          returnSegment = 1;
          nextPlantPhase("returning", now);
        } else finishPlant(now);
      }
    } else if (phase == "returning") {
      gate(false); rake(false);
      drive("back");
      if (elapsed >= planting.driveMs) {
        stopMotor();
        if (returnSegment >= planting.cycles) finishPlant(now);
        else if (planting.returnPauseMs > 0) nextPlantPhase("returnPause", now);
        else { returnSegment++; nextPlantPhase("returning", now); }
      }
    } else if (phase == "returnPause") {
      stopMotor(); gate(false); rake(false);
      if (elapsed >= planting.returnPauseMs) {
        returnSegment++;
        nextPlantPhase("returning", now);
      }
    }
    return;
  }
  if (elapsed >= PERIOD_MS) {
    phaseStart=now;
    phase=phase=="drive" ? "release" : "drive";
  }
  if(mode==Mode::Cruise) { gate(phase=="release"); drive("go"); }
  else if(mode==Mode::Pulse) { gate(false); if(phase=="drive") drive("go"); else stopMotor(); }
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
    wsDriving = false;
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
String statusJSON() {
  String result = "{\"device\":\"LAFVIN-4WD\",\"ready\":";
  result += motorReady ? "true" : "false";
  result += ",\"mode\":\"" + modeName() + "\"";
  result += ",\"motion\":\"" + motion + "\"";
  result += ",\"phase\":\"" + phase + "\"";
  result += ",\"phaseRemainingMs\":";
  uint32_t limit=mode==Mode::Manual ? 0 : phaseLimit();
  uint32_t spent=(uint32_t)(millis()-phaseStart);
  result += String(limit>spent ? limit-spent : 0);
  result += ",\"servoEnabled\":";
  result += servoReady ? "true" : "false";
  result += ",\"servo2Enabled\":";
  result += ENABLE_SERVO_2 ? "true" : "false";
  result += ",\"uptimeMs\":" + String(millis());
  result += ",\"resetReason\":\"" + resetCause + "\"";
  result += ",\"cycle\":" + String(cycleNumber);
  result += ",\"returnSegment\":" + String(returnSegment);
  result += ",\"seedDrops\":" + String(seedDrops);
  result += ",\"plannedDrops\":" + String(planting.cycles + (planting.dispenseFirst ? 1 : 0));
  result += ",\"sequence\":\"" + String(planting.dispenseFirst ? "dispense-first" : "move-first") + "\"";
  result += ",\"rakeEnabled\":";
  result += ENABLE_SERVO_2 ? "true" : "false";
  result += ",\"totalCycles\":" + String(planting.cycles);
  result += ",\"returnToStart\":";
  result += planting.returnToStart ? "true" : "false";
  result += ",\"direction\":\"" + travelDirection + "\"";
  result += ",\"state\":\"" + autopilotState + "\"";
  result += ",\"preset\":";
  if (mode == Mode::Plant) result += "\"plant\"";
  else if (mode == Mode::Cruise) result += "\"cruise\"";
  else if (mode == Mode::Pulse) result += "\"pulse\"";
  else result += "null";
  result += "}";
  return result;
}
String currentStateKey() {
  return modeName() + "|" + motion + "|" + phase;
}
void sendStatus() {
  if (controllerClient != 255) webSocket.sendTXT(controllerClient, "T:" + statusJSON());
}
void configureRoutes() {
  server.on("/status", HTTP_GET, []() {
    addCorsHeaders();
    server.client().setNoDelay(true);
    server.send(200, "application/json", statusJSON());
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
    if (requested == "plant") {
      PlantTiming p;
      // Old /auto?mode=plant remains supported with safe placeholder defaults.
      if(server.hasArg("cycles") || server.hasArg("drive")) {
        if(!server.hasArg("cycles") || !server.hasArg("return") ||
           !server.hasArg("drive") || !server.hasArg("settle") ||
           !server.hasArg("release")) {
          server.send(400,"text/plain","Missing plant settings"); return;
        }
        String ret=server.arg("return");
        if(ret!="0" && ret!="1") {server.send(400,"text/plain","Bad return flag");return;}
        p.returnToStart=ret=="1";
        int cycles=server.arg("cycles").toInt();
        if(cycles<1 || cycles>50) { server.send(400,"text/plain","Cycle count must be 1–50"); return; }
        p.cycles=(uint8_t)cycles;
        p.driveMs=server.arg("drive").toInt();
        p.settleMs=server.arg("settle").toInt();
        p.releaseMs=server.arg("release").toInt();
        if(server.hasArg("returnPause")) p.returnPauseMs=server.arg("returnPause").toInt();
        if(server.hasArg("sequence")) {
          String sequence=server.arg("sequence");
          if(sequence!="dispense-first" && sequence!="move-first") {
            server.send(400,"text/plain","Invalid seed sequence"); return;
          }
          p.dispenseFirst=sequence=="dispense-first";
        }
        if(server.hasArg("rake")) {
          String use=server.arg("rake");
          if(use!="0" && use!="1") {server.send(400,"text/plain","Invalid rake flag");return;}
          p.useRake=use=="1";
        }
        if(server.hasArg("rakeLift")) p.rakeLiftMs=server.arg("rakeLift").toInt();
      }
      if(!validPlant(p)) { server.send(400,"text/plain","Bad plant timing"); return; }
      startPlant(p);
    }
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
  server.on("/ledoff", HTTP_GET, []() { addCorsHeaders(); server.send(410, "text/plain", "Flashlight disabled"); });
  server.on("/", HTTP_GET, []() {
    addCorsHeaders();
    server.send(200, "text/plain", "4WD FIELD UNIT online. Connect using the Capacitor controller. /status");
  });
  server.onNotFound([]() { addCorsHeaders(); server.send(404, "text/plain", "Unknown command"); });
}
void handleWs(uint8_t num, WStype_t event, uint8_t *data, size_t length) {
  if (event == WStype_CONNECTED) {
    if (controllerClient != 255 && controllerClient != num) {
      enterManual();
      webSocket.disconnect(controllerClient);
    }
    controllerClient = num;
    enterManual(); // never resume motion on reconnect
    sendStatus();
    return;
  }
  if (event == WStype_DISCONNECTED) {
    if (num == controllerClient) {
      enterManual();
      controllerClient = 255;
    }
    return;
  }
  if (event != WStype_TEXT || num != controllerClient || length == 0 || length > 480) return;
  String frame;
  frame.reserve(length);
  for (size_t i=0; i<length; ++i) frame += (char)data[i];
  if (frame.startsWith("D:")) {
    String tail = frame.substring(2);
    const int colon = tail.indexOf(':');
    String seq = colon >= 0 ? tail.substring(colon+1) : "";
    String direction = colon >= 0 ? tail.substring(0,colon) : tail;
    if (mode == Mode::Manual && motorReady &&
        (direction == "go" || direction == "back" || direction == "left" || direction == "right")) {
      wsDriving = true;
      lastMove = millis();
      drive(direction);
      if (seq.length()) webSocket.sendTXT(num,"ACK:"+seq);
    } else webSocket.sendTXT(num, "E:Invalid drive command");
  } else if (frame == "S" || frame.startsWith("S:")) {
    enterManual();
    if (frame.startsWith("S:")) webSocket.sendTXT(num,"ACK:"+frame.substring(2));
  } else if (frame == "H") {
    lastHeartbeat = millis();
  } else if (frame.startsWith("G:")) {
    const int channel = frame.substring(2,3).toInt();
    const String pos = frame.substring(4);
    if (mode == Mode::Manual && (channel == 1 || (channel == 2 && ENABLE_SERVO_2)) &&
       (pos=="open" || pos=="close")) gate(pos=="open",channel-1);
    else webSocket.sendTXT(num,"E:Servo unavailable");
  } else if (frame.startsWith("A:")) {
    JsonDocument doc;
    const auto err=deserializeJson(doc, frame.substring(2));
    if (err) { webSocket.sendTXT(num,"E:Invalid JSON"); return; }
    String preset=doc["preset"] | "";
    if (preset=="cruise") enterAuto(Mode::Cruise);
    else if (preset=="pulse") enterAuto(Mode::Pulse);
    else if (preset=="plant") {
      PlantTiming p;
      if(!doc["cycles"].is<int>() || !doc["returnToStart"].is<bool>() ||
         !doc["driveMs"].is<int>() || !doc["settleMs"].is<int>() ||
         !doc["releaseMs"].is<int>() || !doc["returnPauseMs"].is<int>()) {
        webSocket.sendTXT(num,"E:Missing or invalid plant fields"); return;
      }
      int cycles=doc["cycles"].as<int>();
      int driveMs=doc["driveMs"].as<int>();
      int settleMs=doc["settleMs"].as<int>();
      int releaseMs=doc["releaseMs"].as<int>();
      int pause=doc["returnPauseMs"].as<int>();
      if(cycles<1 || cycles>50 || driveMs<0 || settleMs<0 || releaseMs<0 || pause<0 ||
         driveMs>20000 || settleMs>20000 || releaseMs>20000 || pause>20000) {
        webSocket.sendTXT(num,"E:Plant duration out of range"); return;
      }
      p.cycles=(uint8_t)cycles;
      p.driveMs=(uint32_t)driveMs;
      p.settleMs=(uint32_t)settleMs;
      p.releaseMs=(uint32_t)releaseMs;
      p.returnPauseMs=(uint32_t)pause;
      p.returnToStart=doc["returnToStart"].as<bool>();
      if(!doc["sequence"].isNull()) {
        String sequence=doc["sequence"].as<String>();
        if(sequence!="move-first" && sequence!="dispense-first") {
          webSocket.sendTXT(num,"E:Unknown seed sequence"); return;
        }
        p.dispenseFirst=sequence=="dispense-first";
      }
      if(!doc["useRake"].isNull()) {
        if(!doc["useRake"].is<bool>()) {webSocket.sendTXT(num,"E:Invalid rake option");return;}
        p.useRake=doc["useRake"].as<bool>();
      }
      if(!doc["rakeLiftMs"].isNull()) {
        if(!doc["rakeLiftMs"].is<int>() || doc["rakeLiftMs"].as<int>()<0) {
          webSocket.sendTXT(num,"E:Invalid rake timing");return;
        }
        p.rakeLiftMs=doc["rakeLiftMs"].as<uint32_t>();
      }
      if(!validPlant(p)) { webSocket.sendTXT(num,"E:Invalid plant settings"); return; }
      startPlant(p);
    }
    else { webSocket.sendTXT(num,"E:Unknown preset"); return; }
  } else if (frame=="Q" || frame.startsWith("Q:")) {
    if(frame.startsWith("Q:")) webSocket.sendTXT(num,"ACK:"+frame.substring(2));
  }
  sendStatus();
}
void setup() {
  Serial.begin(115200);
  resetCause = resetCauseName();
  Serial.printf("[BOOT] reason=%s\n", resetCause.c_str());
  initMotors();
  initServos();
  WiFi.mode(WIFI_AP);
  WiFi.setSleep(false);
  WiFi.softAP(AP_SSID, AP_PASS, 1, 0, 2);
  configureRoutes();
  server.begin();
  webSocket.begin();
  webSocket.onEvent(handleWs);
  Serial.printf("Robot AP: %s  IP: %s\n", AP_SSID, WiFi.softAPIP().toString().c_str());
}
void loop() {
  webSocket.loop();
  server.handleClient();
  uint32_t now = millis();
  if (mode != Mode::Manual) runAuto(now);
  else if (motion != "stop" && (uint32_t)(now - lastMove) > (wsDriving ? WS_MOTION_TIMEOUT_MS : MOTION_TIMEOUT_MS)) stopMotor();
  if (controllerClient != 255) {
    const String state = currentStateKey();
    if (state != lastStateKey || (uint32_t)(now-lastStatusPush)>=500) {
      lastStatusPush=now;
      lastStateKey=state;
      sendStatus();
    }
  }
  delay(1);
}

"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  Activity, ArrowDown, ArrowLeft, ArrowRight, ArrowUp, Check, ChevronDown,
  CircleHelp, CirclePower, Cpu, Gauge, LockKeyhole, Play,
  Radio, RefreshCw, RotateCcw, Settings2, ShieldAlert, SlidersHorizontal,
  Square, Vibrate, Wifi, WifiOff, X
} from "lucide-react";
import { App as CapacitorApp } from "@capacitor/app";
import { RobotApi } from "@/lib/robot-api";
import { DriveSession } from "@/lib/drive-session";
import { assessLink, type LinkHealth } from "@/lib/control-logic";
import { tapFeedback } from "@/lib/haptics";
import {
  PRESETS, ROBOT_SSID, type Direction, type Mode, type Preset, type RobotStatus
} from "@/lib/protocol";

const api = new RobotApi();
const directions: { id: Direction; label: string; Icon: typeof ArrowUp }[] = [
  { id: "go", label: "Forward", Icon: ArrowUp },
  { id: "left", label: "Left", Icon: ArrowLeft },
  { id: "right", label: "Right", Icon: ArrowRight },
  { id: "back", label: "Reverse", Icon: ArrowDown }
];

function HandheldKey({
  direction, disabled, active, onPress, onRelease, Icon
}: {
  direction: Direction;
  disabled: boolean;
  active: boolean;
  onPress: (direction: Direction) => void;
  onRelease: () => void;
  Icon: typeof ArrowUp;
}) {
  return <button
    className={`dpad-key dpad-${direction} ${active ? "is-held" : ""}`}
    type="button"
    aria-label={direction === "go" ? "Forward, hold to drive" : direction + ", hold to drive"}
    disabled={disabled}
    onPointerDown={event => {
      if (disabled) return;
      event.preventDefault();
      event.currentTarget.setPointerCapture(event.pointerId);
      onPress(direction);
    }}
    onPointerUp={event => {
      if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
      onRelease();
    }}
    onPointerCancel={onRelease}
    onLostPointerCapture={onRelease}
    onContextMenu={event => event.preventDefault()}
  ><Icon size={25} strokeWidth={2.5} /></button>;
}

function FaceKey({ label, hint, disabled, onClick, tone }: {
  label: string; hint: string; disabled: boolean; onClick: () => void; tone?: string;
}) {
  return <button
    type="button"
    className={`face-key face-key-${label.toLowerCase()} ${tone ?? ""}`}
    onClick={onClick}
    disabled={disabled}
    aria-label={hint}
    title={hint}
  ><span>{label}</span></button>;
}

export default function Controller() {
  const [connected, setConnected] = useState(false);
  const [linkHealth, setLinkHealth] = useState<LinkHealth>("offline");
  const [powerWarning, setPowerWarning] = useState(false);
  const [robotStatus, setRobotStatus] = useState<RobotStatus | null>(null);
  const [mode, setMode] = useState<Mode>("manual");
  const [preset, setPreset] = useState<Preset>("plant");
  const [heldDirection, setHeldDirection] = useState<Direction | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [hapticsEnabled, setHapticsEnabled] = useState(true);
  const [servo2Enabled, setServo2Enabled] = useState(false);
  const [transitioning, setTransitioning] = useState(false);
  const [lastChecked, setLastChecked] = useState<Date | null>(null);

  const aliveRef = useRef(false);
  const modeRef = useRef<Mode>("manual");
  const heldRef = useRef<Direction | null>(null);
  const driveRef = useRef<DriveSession | null>(null);
  const checkingRef = useRef(false);
  const failedRequestsRef = useRef(0);
  const lastUptimeRef = useRef<number | null>(null);

  const setCurrentMode = useCallback((value: Mode) => {
    modeRef.current = value;
    setMode(value);
  }, []);

  const markDisconnected = useCallback(() => {
    if (!aliveRef.current) return;
    setConnected(false);
    setLinkHealth("offline");
    setRobotStatus(null);
    setCurrentMode("manual");
    heldRef.current = null;
    setHeldDirection(null);
    driveRef.current?.release();
  }, [setCurrentMode]);

  const noteRequestFailure = useCallback(() => {
    if (!aliveRef.current) return;
    failedRequestsRef.current++;
    const health = assessLink(failedRequestsRef.current);
    setLinkHealth(health);
    if (health === "offline") markDisconnected();
  }, [markDisconnected]);

  const syncStatus = useCallback(async () => {
    // Avoid competing with realtime D-pad commands on ESP32's single HTTP loop.
    if (checkingRef.current || heldRef.current) return;
    checkingRef.current = true;
    try {
      const next = await api.status();
      if (!aliveRef.current) return;
      failedRequestsRef.current = 0;
      setLinkHealth("connected");
      setLastChecked(new Date());
      if (lastUptimeRef.current !== null && next.uptimeMs + 1000 < lastUptimeRef.current) {
        setPowerWarning(true);
      }
      if (next.resetReason === "BROWNOUT") setPowerWarning(true);
      lastUptimeRef.current = next.uptimeMs;
      setRobotStatus(next);
      setConnected(next.ready);
      setCurrentMode(next.mode);
      if (next.preset) setPreset(next.preset);
      if (!next.ready) markDisconnected();
    } catch {
      noteRequestFailure();
    } finally {
      checkingRef.current = false;
    }
  }, [markDisconnected, noteRequestFailure, setCurrentMode]);

  const releaseHold = useCallback(() => {
    if (!heldRef.current) return;
    heldRef.current = null;
    if (aliveRef.current) setHeldDirection(null);
    driveRef.current?.release();
  }, []);

  const emergencyStop = useCallback(async () => {
    releaseHold();
    setCurrentMode("manual");
    void tapFeedback(hapticsEnabled);
    try {
      await api.stop();
      await syncStatus();
    } catch { noteRequestFailure(); }
  }, [hapticsEnabled, noteRequestFailure, releaseHold, setCurrentMode, syncStatus]);

  useEffect(() => {
    driveRef.current = new DriveSession(
      command => command === "stop" ? api.stop() : api.drive(command),
      () => {
        if (!aliveRef.current) return;
        heldRef.current = null;
        setHeldDirection(null);
        noteRequestFailure();
      }
    );
    return () => {
      driveRef.current?.dispose();
      driveRef.current = null;
    };
  }, [noteRequestFailure]);

  useEffect(() => {
    aliveRef.current = true;
    const savedHaptics = localStorage.getItem("fourwd-haptics");
    const savedServo2 = localStorage.getItem("fourwd-servo2");
    if (savedHaptics !== null) setHapticsEnabled(savedHaptics === "true");
    if (savedServo2 !== null) setServo2Enabled(savedServo2 === "true");

    void syncStatus();
    const poll = setInterval(() => void syncStatus(), 1800);
    const heartbeat = setInterval(() => {
      if (modeRef.current === "auto") {
        void api.heartbeat().catch(noteRequestFailure);
      }
    }, 350);
    const stopWhenHidden = () => {
      if (document.hidden) {
        releaseHold();
        setCurrentMode("manual");
        void api.stop().catch(() => {});
      }
    };
    const stopWhenBlurred = () => {
      releaseHold();
      setCurrentMode("manual");
      void api.stop().catch(() => {});
    };
    window.addEventListener("blur", stopWhenBlurred);
    document.addEventListener("visibilitychange", stopWhenHidden);
    let active = true;
    let removeNative: (() => void) | undefined;
    void CapacitorApp.addListener("appStateChange", state => {
      if (!state.isActive) stopWhenBlurred();
      else void syncStatus();
    }).then(handle => {
      if (active) removeNative = () => void handle.remove();
      else void handle.remove();
    }).catch(() => {});
    return () => {
      aliveRef.current = false;
      active = false;
      removeNative?.();
      clearInterval(poll);
      clearInterval(heartbeat);
      driveRef.current?.release();
      document.removeEventListener("visibilitychange", stopWhenHidden);
      window.removeEventListener("blur", stopWhenBlurred);
      void api.stop().catch(() => {});
    };
  }, [noteRequestFailure, releaseHold, setCurrentMode, syncStatus]);

  function pressDrive(direction: Direction) {
    if (!connected || modeRef.current !== "manual" || settingsOpen) return;
    if (heldRef.current === direction) return;
    heldRef.current = direction;
    setHeldDirection(direction);
    void tapFeedback(hapticsEnabled);
    // Immediate request on touch-down; serialize retries while held.
    driveRef.current?.press(direction);
  }

  async function startAutopilot(nextPreset: Preset) {
    if (!connected || transitioning) return;
    releaseHold();
    await driveRef.current?.whenSettled();
    setTransitioning(true);
    void tapFeedback(hapticsEnabled);
    try {
      await api.autopilot(nextPreset);
      setPreset(nextPreset);
      setCurrentMode("auto");
      await api.heartbeat();
      await syncStatus();
    } catch { noteRequestFailure(); }
    finally { if (aliveRef.current) setTransitioning(false); }
  }

  async function setManualMode() {
    if (!connected || transitioning) return;
    releaseHold();
    setCurrentMode("manual");
    void tapFeedback(hapticsEnabled);
    try {
      await api.stop();
      await syncStatus();
    } catch { noteRequestFailure(); }
  }

  async function moveGate(channel: 1 | 2, position: "open" | "close") {
    if (!connected || mode !== "manual" || settingsOpen) return;
    void tapFeedback(hapticsEnabled);
    try { await api.gate(channel, position); }
    catch { noteRequestFailure(); }
  }

  function toggleHaptics() {
    setHapticsEnabled(prev => {
      localStorage.setItem("fourwd-haptics", String(!prev));
      void tapFeedback(!prev);
      return !prev;
    });
  }

  function toggleServo2() {
    setServo2Enabled(prev => {
      localStorage.setItem("fourwd-servo2", String(!prev));
      return !prev;
    });
  }

  const canDrive = connected && mode === "manual" && !settingsOpen;
  const selected = PRESETS.find(p => p.id === preset) ?? PRESETS[0];

  return <>
    <div className="ambient ambient-one" aria-hidden="true" />
    <div className="ambient ambient-two" aria-hidden="true" />
    <div className="handheld" role="application" aria-label="4WD robot remote controller">
      <div className="shoulder left-shoulder" aria-hidden="true">L</div>
      <div className="shoulder right-shoulder" aria-hidden="true">R</div>

      <header className="device-header">
        <div className="brand-mark"><Cpu size={16} strokeWidth={1.8} /> <span>4WD <b>/ FIELD UNIT</b></span></div>
        <div className="device-serial">SERIES 01 <span>—</span> REMOTE SYSTEM</div>
        <button className="header-settings" onClick={() => { releaseHold(); setSettingsOpen(true); }}
          aria-label="Open settings" title="Settings"><Settings2 size={19} /></button>
      </header>

      <div className="device-body">
        <section className="side-controls left-controls" aria-label="Driving controls">
          <div className="cluster-kicker">DIRECTIONAL INPUT <span>01</span></div>
          <div className="dpad" role="group" aria-label="Hold to drive">
            {directions.map(({ id, Icon }) =>
              <HandheldKey key={id} direction={id} Icon={Icon}
                disabled={!canDrive} active={heldDirection === id}
                onPress={pressDrive} onRelease={releaseHold} />)}
            <div className="dpad-center" aria-hidden="true"><div /></div>
          </div>
          <span className="cluster-instruction">HOLD TO DRIVE <span>·</span> RELEASE TO STOP</span>
        </section>

        <section className="display-housing" aria-label="Robot control display">
          <div className="display-inner">
            <div className="display-topbar">
              <div className="display-id"><Radio size={13} /> UNIT_01 <span>/</span> LOCAL LINK</div>
              <div className={`connection-pill ${connected ? (linkHealth === "unstable" ? "link-unstable" : "link-online") : "link-offline"}`}>
                <span className="connection-dot" />
                {connected ? (linkHealth === "unstable" ? "SIGNAL DELAY" : "CONNECTED") : "OFFLINE"}
              </div>
            </div>

            {settingsOpen ? <div className="settings-screen">
              <div className="section-heading">
                <div><span className="eyebrow">SYSTEM PREFERENCES</span><h2>Controller settings</h2></div>
                <button className="icon-button" onClick={() => setSettingsOpen(false)} aria-label="Close settings"><X size={18} /></button>
              </div>
              <button className="setting-row" onClick={toggleHaptics} role="switch" aria-checked={hapticsEnabled}>
                <div className="setting-icon"><Vibrate size={18} /></div>
                <div><strong>Haptic feedback</strong><small>Physical feedback on button presses</small></div>
                <span className={`toggle-track ${hapticsEnabled ? "on" : ""}`}><i /></span>
              </button>
              <button className="setting-row" onClick={toggleServo2} role="switch" aria-checked={servo2Enabled}>
                <div className="setting-icon"><SlidersHorizontal size={18} /></div>
                <div><strong>Second servo</strong><small>Enable X / Y gate buttons after wiring GPIO4</small></div>
                <span className={`toggle-track ${servo2Enabled ? "on" : ""}`}><i /></span>
              </button>
              <div className="settings-footnote"><LockKeyhole size={12} /> Local connection only. No cloud or account needed.</div>
            </div> : !connected ? <div className="connection-screen">
              <div className="offline-icon"><WifiOff size={28} strokeWidth={1.5} /></div>
              <span className="eyebrow">CONNECTION REQUIRED</span>
              <h2>Robot not connected</h2>
              <p>Join <strong>{ROBOT_SSID}</strong> in your phone&apos;s Wi-Fi settings. Stay connected even if Android reports no internet.</p>
              <button className="retry-button" onClick={() => void syncStatus()}><RefreshCw size={15} /> Retry connection</button>
            </div> : <div className="active-screen">
              <div className="mode-tabs" role="group" aria-label="Control mode">
                <button className={mode === "manual" ? "active" : ""} onClick={() => void setManualMode()}
                  disabled={transitioning}><Gauge size={15} /> Manual</button>
                <button className={mode === "auto" ? "active" : ""} onClick={() => void startAutopilot(preset)}
                  disabled={transitioning}><Activity size={15} /> Autopilot</button>
              </div>
              <div className="screen-content">
                {mode === "manual" ? <div className="manual-info">
                  <span className="eyebrow">DIRECT DRIVE / CHANNEL 01</span>
                  <h2>Manual control</h2>
                  <p>Press and hold a direction to drive. Release to stop. A / B control the gate.</p>
                  {powerWarning && <div className="reset-alert" role="status">ESP32 restart detected. Check 5V supply and common ground.</div>}
                  <div className="motion-state">
                    <span>DRIVE STATUS</span>
                    <strong><span className="motion-signal" /> {heldDirection ? heldDirection.toUpperCase() : "STANDBY"}</strong>
                  </div>
                </div> : <div className="auto-info">
                  <span className="eyebrow">SEQUENCE ACTIVE / AUTO</span>
                  <div className="auto-title"><div><h2>{selected.title}</h2><p>{selected.description}</p></div>
                    <div className="cycle-time"><b>{((robotStatus?.phaseRemainingMs ?? 0) / 1000).toFixed(1)}</b><small>SEC</small></div>
                  </div>
                  <div className="phase-meter"><i style={{ width: `${Math.min(100, Math.max(0, 100 - ((robotStatus?.phaseRemainingMs ?? 0) / 3000) * 100))}%` }} /></div>
                  <div className="phase-label"><span>{robotStatus?.phase === "drive" ? "DRIVE FORWARD" : "RELEASE / HOLD"}</span><span>3.0S CYCLE</span></div>
                </div>}
                <div className="presets-block">
                  <div className="presets-heading"><span>AUTOPILOT PRESETS</span><span>{mode === "manual" ? "SELECT + START" : "TAP TO SWITCH"}</span></div>
                  <div className="preset-list">
                    {PRESETS.map((item, index) => <button key={item.id} type="button"
                      className={`preset-button ${preset === item.id ? "selected" : ""}`}
                      onClick={() => {
                        if (mode === "auto") void startAutopilot(item.id);
                        else { setPreset(item.id); void tapFeedback(hapticsEnabled); }
                      }} disabled={transitioning}>
                      <span className="preset-index">0{index + 1}</span>
                      <span className="preset-name">{item.title}</span>
                      {preset === item.id && <Check size={13} />}
                    </button>)}
                  </div>
                  {mode === "manual" && <button className="start-preset" onClick={() => void startAutopilot(preset)}
                    disabled={transitioning}><Play size={13} fill="currentColor" /> START SELECTED PRESET</button>}
                </div>
              </div>
            </div>}

            <footer className="display-statusbar">
              <span><span className={`status-indicator ${connected ? "online" : ""}`} /> SYSTEM {connected ? (linkHealth === "unstable" ? "SIGNAL DELAY" : "READY") : "WAITING"}</span>
              <span>192.168.4.1</span>
            </footer>
          </div>
        </section>

        <section className="side-controls right-controls" aria-label="Servo and stop controls">
          <div className="cluster-kicker">ACTUATOR INPUT <span>02</span></div>
          <div className="face-pad" role="group" aria-label="Gate control">
            <FaceKey label="Y" hint="Open gate 2" disabled={!canDrive || !servo2Enabled}
              onClick={() => void moveGate(2, "open")} />
            <FaceKey label="X" hint="Close gate 2" disabled={!canDrive || !servo2Enabled}
              onClick={() => void moveGate(2, "close")} />
            <FaceKey label="B" hint="Close gate 1" disabled={!canDrive}
              onClick={() => void moveGate(1, "close")} />
            <FaceKey label="A" hint="Open gate 1" disabled={!canDrive}
              onClick={() => void moveGate(1, "open")} />
          </div>
          <span className="cluster-instruction">A / B <span>·</span> GATE OPEN / CLOSE</span>
        </section>
      </div>

      <footer className="device-footer">
        <div className="footer-left"><span className="engraved-pip" /> 4WD CONTROL SYSTEM</div>
        <button className="emergency-button" onClick={() => void emergencyStop()}
          aria-label="Emergency stop robot motors"><Square size={13} fill="currentColor" /> STOP / OVERRIDE</button>
        <div className="footer-right"><CirclePower size={14} /> LOCAL <span>·</span> REV 02</div>
      </footer>
    </div>
    <div className="rotate-prompt"><RotateCcw size={34} /><h2>Rotate your device</h2><p>Controller is designed for landscape orientation.</p></div>
  </>;
}

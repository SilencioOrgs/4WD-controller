"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Activity, ArrowDown, ArrowLeft, ArrowRight, ArrowUp, Check, CircleStop,
  Gauge, Pause, Play, RefreshCw, Settings2, Signal, Vibrate, WifiOff, X } from "lucide-react";
import { App as CapacitorApp } from "@capacitor/app";
import { DriveSession } from "@/lib/drive-session";
import { assessLink, type LinkHealth } from "@/lib/control-logic";
import { RobotApi } from "@/lib/robot-api";
import { tapFeedback } from "@/lib/haptics";
import { PRESETS, ROBOT_SSID, type Direction, type Mode, type Preset, type RobotStatus } from "@/lib/protocol";

const api = new RobotApi();
const driveKeys: { direction: Direction; label: string; Icon: typeof ArrowUp }[] = [
  { direction: "go", label: "Forward", Icon: ArrowUp },
  { direction: "left", label: "Left", Icon: ArrowLeft },
  { direction: "right", label: "Right", Icon: ArrowRight },
  { direction: "back", label: "Reverse", Icon: ArrowDown }
];

type DriveKeyProps = {
  direction: Direction; label: string; Icon: typeof ArrowUp;
  disabled: boolean; active: boolean;
  press: (direction: Direction) => void; release: () => void;
};

function DriveKey({ direction, label, Icon, disabled, active, press, release }: DriveKeyProps) {
  return <button
    type="button"
    className={`drive-key key-${direction} ${active ? "pressed" : ""}`}
    aria-label={`${label} — hold to drive`}
    disabled={disabled}
    onPointerDown={event => {
      if (disabled) return;
      event.preventDefault();
      event.currentTarget.setPointerCapture(event.pointerId);
      press(direction);
    }}
    onPointerUp={event => {
      if (event.currentTarget.hasPointerCapture(event.pointerId)) {
        event.currentTarget.releasePointerCapture(event.pointerId);
      }
      release();
    }}
    onPointerCancel={release}
    onLostPointerCapture={release}
    onContextMenu={event => event.preventDefault()}
  >
    <Icon size={34} strokeWidth={2.2} aria-hidden />
    <span>{label}</span>
  </button>;
}

function ServoButton({ label, action, disabled, onPress }: {
  label: string; action: string; disabled: boolean; onPress: () => void;
}) {
  return <button className="servo-button" type="button" aria-label={action}
    disabled={disabled} onClick={onPress}>
    <strong>{label}</strong>
    <span>{action}</span>
  </button>;
}

export default function Controller() {
  const [connected, setConnected] = useState(false);
  const [linkHealth, setLinkHealth] = useState<LinkHealth>("offline");
  const [robotStatus, setRobotStatus] = useState<RobotStatus | null>(null);
  const [mode, setMode] = useState<Mode>("manual");
  const [view, setView] = useState<Mode>("manual");
  const [preset, setPreset] = useState<Preset>("plant");
  const [heldDirection, setHeldDirection] = useState<Direction | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [hapticsEnabled, setHapticsEnabled] = useState(true);
  const [servo2Visible, setServo2Visible] = useState(false);
  const [transitioning, setTransitioning] = useState(false);
  const [powerWarning, setPowerWarning] = useState(false);

  const aliveRef = useRef(false);
  const modeRef = useRef<Mode>("manual");
  const heldRef = useRef<Direction | null>(null);
  const driveRef = useRef<DriveSession | null>(null);
  const checkingRef = useRef(false);
  const failureCount = useRef(0);
  const lastUptime = useRef<number | null>(null);

  const setHardwareMode = useCallback((value: Mode) => {
    modeRef.current = value;
    setMode(value);
  }, []);

  const disconnect = useCallback(() => {
    if (!aliveRef.current) return;
    setConnected(false);
    setLinkHealth("offline");
    setRobotStatus(null);
    setHardwareMode("manual");
    heldRef.current = null;
    setHeldDirection(null);
    driveRef.current?.release();
  }, [setHardwareMode]);

  const reportFailure = useCallback(() => {
    if (!aliveRef.current) return;
    failureCount.current++;
    const next = assessLink(failureCount.current);
    setLinkHealth(next);
    if (next === "offline") disconnect();
  }, [disconnect]);

  const syncStatus = useCallback(async () => {
    if (checkingRef.current || heldRef.current) return;
    checkingRef.current = true;
    try {
      const next = await api.status();
      if (!aliveRef.current) return;
      failureCount.current = 0;
      setLinkHealth("connected");
      setConnected(next.ready);
      setRobotStatus(next);
      if (next.resetReason === "BROWNOUT" ||
          (lastUptime.current !== null && next.uptimeMs + 1000 < lastUptime.current)) {
        setPowerWarning(true);
      }
      lastUptime.current = next.uptimeMs;
      setHardwareMode(next.mode);
      if (next.mode === "auto") {
        setView("auto");
        if (next.preset) setPreset(next.preset);
      }
      if (!next.ready) disconnect();
    } catch { reportFailure(); }
    finally { checkingRef.current = false; }
  }, [disconnect, reportFailure, setHardwareMode]);

  const releaseHold = useCallback(() => {
    if (!heldRef.current) return;
    heldRef.current = null;
    if (aliveRef.current) setHeldDirection(null);
    driveRef.current?.release();
  }, []);

  useEffect(() => {
    aliveRef.current = true;
    driveRef.current = new DriveSession(
      command => command === "stop" ? api.stop() : api.drive(command),
      reportFailure,
    );
    const savedHaptics = localStorage.getItem("fourwd-haptics");
    const savedServo2 = localStorage.getItem("fourwd-servo2");
    if (savedHaptics !== null) setHapticsEnabled(savedHaptics === "true");
    if (savedServo2 !== null) setServo2Visible(savedServo2 === "true");
    void syncStatus();
    const polling = setInterval(() => void syncStatus(), 1800);
    const heartbeat = setInterval(() => {
      if (modeRef.current === "auto") void api.heartbeat().catch(reportFailure);
    }, 350);

    const stopOnBackground = () => {
      releaseHold();
      setHardwareMode("manual");
      void api.stop().catch(() => {});
    };
    const onVisibility = () => { if (document.hidden) stopOnBackground(); };
    window.addEventListener("blur", stopOnBackground);
    document.addEventListener("visibilitychange", onVisibility);
    let mounted = true;
    let removeNative: (() => void) | undefined;
    void CapacitorApp.addListener("appStateChange", state => {
      if (!state.isActive) stopOnBackground();
      else void syncStatus();
    }).then(listener => {
      if (mounted) removeNative = () => void listener.remove();
      else void listener.remove();
    }).catch(() => {});

    return () => {
      aliveRef.current = false;
      mounted = false;
      clearInterval(polling);
      clearInterval(heartbeat);
      window.removeEventListener("blur", stopOnBackground);
      document.removeEventListener("visibilitychange", onVisibility);
      removeNative?.();
      driveRef.current?.release();
      driveRef.current?.dispose();
      driveRef.current = null;
      void api.stop().catch(() => {});
    };
  }, [reportFailure, releaseHold, setHardwareMode, syncStatus]);

  const pressDrive = (direction: Direction) => {
    if (!connected || modeRef.current !== "manual" || view !== "manual" || settingsOpen) return;
    if (heldRef.current === direction) return;
    heldRef.current = direction;
    setHeldDirection(direction);
    void tapFeedback(hapticsEnabled);
    driveRef.current?.press(direction);
  };

  const stopRobot = async () => {
    releaseHold();
    setView("manual");
    setHardwareMode("manual");
    void tapFeedback(hapticsEnabled);
    try {
      await driveRef.current?.whenSettled();
      await api.stop();
      await syncStatus();
    } catch { reportFailure(); }
  };

  const chooseManual = () => {
    setView("manual");
    if (modeRef.current === "auto") void stopRobot();
  };

  const startAuto = async () => {
    if (!connected || transitioning) return;
    releaseHold();
    setTransitioning(true);
    void tapFeedback(hapticsEnabled);
    try {
      await driveRef.current?.whenSettled();
      await api.autopilot(preset);
      setHardwareMode("auto");
      await api.heartbeat();
      await syncStatus();
    } catch { reportFailure(); }
    finally { if (aliveRef.current) setTransitioning(false); }
  };

  const gate = async (channel: 1 | 2, position: "open" | "close") => {
    if (!connected || modeRef.current !== "manual" || view !== "manual") return;
    void tapFeedback(hapticsEnabled);
    try { await api.gate(channel, position); }
    catch { reportFailure(); }
  };

  const setHaptics = () => {
    const next = !hapticsEnabled;
    setHapticsEnabled(next);
    localStorage.setItem("fourwd-haptics", String(next));
    void tapFeedback(next);
  };
  const setServo2 = () => {
    const next = !servo2Visible;
    setServo2Visible(next);
    localStorage.setItem("fourwd-servo2", String(next));
  };

  const canDrive = connected && mode === "manual" && view === "manual" && !settingsOpen;
  const servo2Ready = robotStatus?.servo2Enabled === true && servo2Visible;
  const activePreset = PRESETS.find(item => item.id === preset) ?? PRESETS[0];

  return <div className="control-layout" role="application" aria-label="4WD field controller">
    <header className="topbar">
      <div className="identity"><span className="brand-symbol"><Gauge size={19} /></span>
        <div><strong>4WD Controller</strong><small>LOCAL ROBOT CONTROL</small></div></div>
      <div className="top-actions">
        <div className={`board-state ${!connected ? "is-offline" : linkHealth === "unstable" ? "is-lagging" : ""}`}
          role="status">
          <Signal size={17} />
          <span>{!connected ? "Not connected" : linkHealth === "unstable" ? "Signal delay" : "Connected"}</span>
        </div>
        <button className="settings-trigger" type="button" aria-label="Controller settings"
          onClick={() => { releaseHold(); setSettingsOpen(true); }}><Settings2 size={20} /></button>
      </div>
    </header>

    <main className="controller-grid">
      <section className="control-panel movement-panel" aria-label="Movement">
        <div className="panel-label"><span>Drive</span><small>PRESS AND HOLD</small></div>
        <div className="direction-grid">
          {driveKeys.map(item => <DriveKey key={item.direction} {...item}
            disabled={!canDrive} active={heldDirection === item.direction}
            press={pressDrive} release={releaseHold} />)}
          <div className="direction-center" aria-hidden><span>4WD</span></div>
        </div>
      </section>

      <section className="control-panel operations-panel" aria-label="Robot modes and status">
        <div className="mode-select" aria-label="Controller mode">
          <button className={view === "manual" ? "selected" : ""}
            type="button" onClick={chooseManual}><Gauge size={17} /> Manual</button>
          <button className={view === "auto" ? "selected" : ""}
            type="button" onClick={() => setView("auto")}><Activity size={17} /> Autopilot</button>
        </div>
        {view === "manual" ? <div className="mode-content manual-content">
          <div className="mode-headline"><small>CONTROL STATUS</small>
            <h1>{heldDirection ? heldDirection === "go" ? "Forward" : heldDirection === "back" ? "Reverse" :
              heldDirection === "left" ? "Left" : "Right" : "Ready to drive"}</h1>
            <p>{connected ? "Hold an arrow to drive. Release to stop." :
              `Connect your phone to ${ROBOT_SSID}, then retry.`}</p></div>
          {powerWarning && <p className="power-warning">ESP32 restarted. Check its 5V power supply.</p>}
          {!connected && <button type="button" className="retry-action" onClick={() => void syncStatus()}>
            <RefreshCw size={16} /> Retry connection
          </button>}
          <div className="mini-readout"><span>ROBOT</span><strong>{connected ? "192.168.4.1" : "OFFLINE"}</strong></div>
        </div> : <div className="mode-content auto-content">
          <div className="mode-headline"><small>AUTOMATIC ROUTINES</small><h1>Autopilot</h1></div>
          <div className="preset-options" role="group" aria-label="Autopilot preset">
            {PRESETS.map(item => <button key={item.id} type="button"
              className={`preset-option ${preset === item.id ? "active" : ""}`}
              onClick={() => {
                setPreset(item.id);
                void tapFeedback(hapticsEnabled);
              }}>
              <span><strong>{item.title}</strong><small>{item.short}</small></span>
              {preset === item.id && <Check size={18}/>}
            </button>)}
          </div>
          {mode === "auto" && <div className="active-routine" role="status">
            <span><span className="pulse-dot" /> RUNNING — {activePreset.title}</span>
            <strong>{((robotStatus?.phaseRemainingMs ?? 0) / 1000).toFixed(1)}s</strong>
          </div>}
          <button type="button" className="start-auto" disabled={!connected || transitioning}
            onClick={() => void startAuto()}><Play size={17} fill="currentColor" />
            {mode === "auto" ? "RESTART SELECTED PRESET" : "START AUTOPILOT"}</button>
        </div>}
        <button className="stop-action" type="button" onClick={() => void stopRobot()}
          aria-label="Stop motors and cancel autopilot"><CircleStop size={21}/> STOP</button>
      </section>

      <section className="control-panel actuator-panel" aria-label="Servo gates">
        <div className="panel-label"><span>Servo gate</span><small>MANUAL MODE</small></div>
        <div className="servo-grid">
          <ServoButton label="OPEN" action="Open gate 1" disabled={!canDrive}
            onPress={() => void gate(1, "open")} />
          <ServoButton label="CLOSE" action="Close gate 1" disabled={!canDrive}
            onPress={() => void gate(1, "close")} />
        </div>
        {servo2Visible && <div className="extra-servos">
          <div className="extra-heading">SECOND SERVO {servo2Ready ? "· READY" : "· DISABLED IN FIRMWARE"}</div>
          <div className="servo-grid secondary">
            <ServoButton label="OPEN 2" action="Open gate 2" disabled={!canDrive || !servo2Ready}
              onPress={() => void gate(2, "open")} />
            <ServoButton label="CLOSE 2" action="Close gate 2" disabled={!canDrive || !servo2Ready}
              onPress={() => void gate(2, "close")} />
          </div>
        </div>}
      </section>
    </main>
    {settingsOpen && <div className="settings-backdrop" role="presentation">
      <section className="settings-dialog" role="dialog" aria-modal="true" aria-label="Controller settings">
        <div className="settings-title"><div><small>PREFERENCES</small><h2>Settings</h2></div>
          <button type="button" aria-label="Close settings" onClick={() => setSettingsOpen(false)}><X size={22}/></button>
        </div>
        <button type="button" className="setting-option" onClick={setHaptics} role="switch"
          aria-checked={hapticsEnabled}>
          <Vibrate size={21}/><span><strong>Vibration</strong><small>Haptic feedback on press</small></span>
          <span className={`switch ${hapticsEnabled ? "on" : ""}`}/>
        </button>
        <button type="button" className="setting-option" onClick={setServo2} role="switch"
          aria-checked={servo2Visible}>
          <Settings2 size={21}/><span><strong>Show second servo</strong><small>Requires separately enabled GPIO4 firmware</small></span>
          <span className={`switch ${servo2Visible ? "on" : ""}`}/>
        </button>
        <p className="setting-footnote">The camera and flashlight are disabled. Robot control is local to ESP32-CAM Wi-Fi.</p>
      </section>
    </div>}
    <div className="portrait-notice"><Pause size={26}/><strong>Rotate to landscape</strong><span>Large control buttons are designed for landscape use.</span></div>
  </div>;
}

import {Settings2,Wifi,WifiOff} from "lucide-react";
import type {LinkHealth} from "@/lib/robot-link";
export function TopBar({health,onSettings,debug}:{health:LinkHealth;onSettings:()=>void;debug:boolean}) {
  return <header className="topbar">
    <div className="brand"><strong>4WD Controller</strong><span>Local control</span></div>
    <div className="topbar-actions">
      {debug&&<div className="rtt-overlay" role="status" aria-label="Robot connection latency">
        <strong>{health.lastRttMs??"—"} ms</strong>
        <span>AVG {health.avgRttMs??"—"} · FAIL {health.failures}</span>
      </div>}
      <div role="status" className={"connection " + (!health.connected?"offline":health.failures?"weak":"online")}>
        {health.connected?<Wifi size={16}/>:<WifiOff size={16}/>}
        <span>{!health.connected?"Offline":health.failures?"Weak signal":"Connected"}</span>
        <small>{health.transport.toUpperCase()}</small>
      </div>
      <button className="icon-button" aria-label="Settings" onClick={onSettings}><Settings2 size={21}/></button>
    </div>
  </header>;
}

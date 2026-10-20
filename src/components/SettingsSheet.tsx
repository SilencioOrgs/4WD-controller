import {X,Vibrate,Activity,SlidersHorizontal} from "lucide-react";
import type {ReturnTypeUseRobot} from "@/components/robot-types";
export function SettingsSheet({robot:r}:{robot:ReturnTypeUseRobot}) {
 if(!r.settingsOpen)return null;
 return <div className="settings-backdrop">
  <section className="settings-sheet" role="dialog" aria-modal="true" aria-label="Controller settings">
   <div className="settings-title"><h2>Settings</h2><button aria-label="Close settings" onClick={()=>r.setSettingsOpen(false)}><X size={22}/></button></div>
   <button className="setting-row" role="switch" aria-checked={r.haptics} onClick={r.toggleHaptics}><Vibrate size={21}/> Vibration <span>{r.haptics?"On":"Off"}</span></button>
   <button className="setting-row" role="switch" aria-checked={r.debug} onClick={r.toggleDebug}><Activity size={21}/> Latency overlay <span>{r.debug?"On":"Off"}</span></button>
   <button className="setting-row" role="switch" aria-checked={r.servo2Visible} onClick={r.toggleServo2}><SlidersHorizontal size={21}/> Show servo 2 <span>{r.servo2Visible?"On":"Off"}</span></button>
   <label className="number-field">Robot speed (cm/s, calibrated)
    <input type="number" min="0.1" max="500" step="0.1" value={r.speed}
      onChange={e=>r.setSpeed(Math.max(.1,Math.min(500,Number(e.target.value)||.1)))}/>
   </label>
   <p className="disclaimer">10 cm/s is a placeholder. Measure your robot's actual distance in 3 seconds. Do not assume crop spacing from sample values.</p>
   {r.debug&&<div className="latency-readout" role="status">
    <span>Transport: {r.health.transport.toUpperCase()}</span>
    <span>Last RTT: {r.health.lastRttMs??"—"} ms</span>
    <span>Avg RTT: {r.health.avgRttMs??"—"} ms</span>
    <span>Failures: {r.health.failures}</span>
   </div>}
  </section>
 </div>;
}

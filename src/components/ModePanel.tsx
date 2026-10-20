import {Activity,Gauge,Play,Square,RotateCcw} from "lucide-react";
import type {ReturnTypeUseRobot} from "@/components/robot-types";
export function ModePanel({robot:r}:{robot:ReturnTypeUseRobot}) {
 const running=r.status?.mode==="auto"&&r.status.state==="running";
 const done=r.status?.state==="done";
 return <section className="zone mode-zone" aria-label="Mode and control status">
   <div className="tabs" role="group" aria-label="Robot mode">
     <button type="button" className={r.view==="manual"?"selected":""}
       onClick={r.chooseManual}><Gauge size={17}/>Manual</button>
     <button type="button" className={r.view==="auto"?"selected":""}
       onClick={r.selectAutoView}><Activity size={17}/>Autopilot</button>
   </div>
   {r.view==="manual"?<div className="mode-main">
     <div><div className="section-kicker">Manual control</div>
       <h1>{r.held ? r.held==="go"?"Forward":r.held==="back"?"Reverse":r.held==="left"?"Left":"Right":"Ready to drive"}</h1>
       <p>{r.connected?"Use the large direction keys. The robot stops when you release.":"Connect your phone to "+r.ssid+" Wi-Fi, then retry."}</p>
     </div>
     {r.powerWarning&&<p className="power-alert">ESP32 restarted; inspect 5V power.</p>}
     {!r.connected&&<button className="outlined-button" onClick={r.retry}>Retry connection</button>}
   </div>:<div className="mode-main auto-main">
     <div className="section-kicker">Select routine</div>
     <div className="routine-choice">
       <button className={r.routine==="plant"?"selected":""} onClick={()=>r.setRoutine("plant")}>Plant cycle</button>
       <button className={r.routine!=="plant"?"selected":""} onClick={()=>r.setRoutine("cruise")}>Utility</button>
     </div>
     {r.routine!=="plant"&&<div className="utility-choice" role="group" aria-label="Utility routine">
       {(["cruise","pulse"] as const).map(p=><button key={p} className={r.routine===p?"selected":""}
         onClick={()=>r.setRoutine(p)}>{p==="cruise"?"Cruise":"Pulse drive"}</button>)}
     </div>}
     {running?<div className="live-progress" role="status">
       <strong>{r.routine==="plant"?`Cycle ${r.status?.cycle||1} / ${r.status?.totalCycles||r.cycles}`:"Routine running"}</strong>
       <div className="progress-sub">{r.status?.direction==="returning"?"Returning":"Forward"} · {r.status?.phase} · {((r.status?.phaseRemainingMs||0)/1000).toFixed(1)} s</div>
       <div className="progress-rail" aria-label="Current cycle progress"><span style={{width:`${Math.min(100,Math.max(0,100*((r.status?.cycle||1)-1)/(r.status?.totalCycles||1)))}%`}}/></div>
     </div>:done?<div className="live-progress completed" role="status">
       <strong>Done</strong><p>Cycle finished. Gate closed and motors stopped.</p>
       <button className="outlined-button" onClick={r.chooseManual}>Back to manual</button>
     </div>:<p className="routine-hint">{r.routine==="plant"?"Set plant timing, cycles, and finish behavior on the right.":"Select the utility routine, then start."}</p>}
     {r.error&&<p role="alert" className="error-copy">{r.error}</p>}
     <button className="primary-action" onClick={()=>void r.run()} disabled={!r.connected||r.runningCommand||!!r.configurationError&&r.routine==="plant"}>
       {done?<RotateCcw size={17}/>:<Play size={17}/>}
       {done?"Run again":running?"Restart routine":"START AUTOPILOT"}
     </button>
   </div>}
   <button className="stop-action" onClick={()=>void r.stop()} aria-label="Emergency stop and cancel autopilot"><Square fill="currentColor" size={16}/> STOP</button>
 </section>;
}

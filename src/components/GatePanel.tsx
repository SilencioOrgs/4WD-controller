import type {ReturnTypeUseRobot} from "@/components/robot-types";
import {PlantSettings} from "./PlantSettings";
export function GatePanel({robot:r}:{robot:ReturnTypeUseRobot}) {
 const enabled=r.connected && r.status?.mode==="manual" && r.view==="manual" && !r.settingsOpen;
 return <section className="zone gate-zone" aria-label="Gate controls and plant settings">
  {r.view==="auto"&&r.routine==="plant"?
    <PlantSettings plants={r.plants} selectedId={r.plantId} onSelect={r.setPlantId}
      selected={r.selectedPlant} onEdit={r.editPlant} cycles={r.cycles} setCycles={r.setCycles}
      returnToStart={r.returnToStart} setReturnToStart={r.setReturnToStart} speed={r.speed}
      sequence={r.sequence} setSequence={r.setSequence}
      useRake={r.useRake} setUseRake={r.setUseRake} rakeAvailable={r.status?.servo2Enabled===true}/>:
    <><div className="zone-heading"><h2>Gate</h2><small>Manual mode</small></div>
      <div className="gate-buttons">
       <button disabled={!enabled} onClick={()=>void r.gate(1,"open")}>OPEN</button>
       <button disabled={!enabled} onClick={()=>void r.gate(1,"close")}>CLOSE</button>
      </div>
      {r.servo2Visible&&<div className="gate-secondary">
        <p>Servo 2 {r.status?.servo2Enabled?"":"— disabled in firmware"}</p>
        <button disabled={!enabled || !r.status?.servo2Enabled} onClick={()=>void r.gate(2,"open")}>Open 2</button>
        <button disabled={!enabled || !r.status?.servo2Enabled} onClick={()=>void r.gate(2,"close")}>Close 2</button>
      </div>}
    </>}
 </section>;
}

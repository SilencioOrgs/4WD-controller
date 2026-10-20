"use client";
import { ArrowRight, Info, PackageOpen, RotateCcw } from "lucide-react";
import type {PlantPreset} from "@/lib/plants";
import type { SeedSequence } from "@/lib/plant-plan";

export function PlantSettings({plants,selectedId,onSelect,selected,onEdit,cycles,setCycles,
  returnToStart,setReturnToStart,speed,sequence,setSequence,useRake,setUseRake,rakeAvailable}:{
  plants:PlantPreset[];selectedId:string;onSelect:(id:string)=>void;selected:PlantPreset;
  onEdit:(patch:Partial<PlantPreset>)=>void;
  cycles:number;setCycles:(n:number)=>void;returnToStart:boolean;
  setReturnToStart:(x:boolean)=>void;speed:number;
  sequence:SeedSequence;setSequence:(next:SeedSequence)=>void;
  useRake:boolean;setUseRake:(enabled:boolean)=>void;rakeAvailable:boolean;
}) {
 const dispenseCount = cycles + (sequence==="dispense-first" ? 1 : 0);
 const timeField=(label:string,key:"spacingCm"|"driveMs"|"settleMs"|"releaseMs",description:string,seconds=false)=>{
   const value=seconds ? selected[key]/1000 : selected[key];
   return <label className="simple-field">
     <span>{label}</span>
     <input aria-label={label} type="number" inputMode="decimal" min="0"
       max={seconds?20:20000} step={seconds?"0.1":"1"} value={value}
       onChange={e=>{
         if(e.target.value==="") return;
         const next=Number(e.target.value);
         if(Number.isFinite(next))onEdit({[key]:Math.max(0,Math.min(20000,Math.round(next*(seconds?1000:1))))});
       }}/>
     <small>{description}</small>
   </label>;
 };
 return <div className="plant-form beginner">
    <div className="form-title"><strong>Set up seed planting</strong><small>Choose how the robot should work</small></div>

    <label className="simple-field">
      <span>1. Select a plant</span>
      <select aria-label="Plant example" value={selectedId} onChange={e=>onSelect(e.target.value)}>
        {plants.map(p=><option key={p.id} value={p.id}>{p.name}</option>)}
      </select>
    </label>
    <div className="simple-section">
      <div className="simple-label">2. What should happen first?</div>
      <div className="finish-toggle two-choices" role="group" aria-label="Seed dispensing order">
        <button type="button" className={sequence==="dispense-first"?"active":""}
          aria-pressed={sequence==="dispense-first"} onClick={()=>setSequence("dispense-first")}>
          <PackageOpen size={15}/> Dispense first
        </button>
        <button type="button" className={sequence==="move-first"?"active":""}
          aria-pressed={sequence==="move-first"} onClick={()=>setSequence("move-first")}>
          <ArrowRight size={15}/> Move first
        </button>
      </div>
      <p className="field-help">{sequence==="dispense-first"
        ?"Drop seeds where the robot starts, then after each forward move."
        :"Move to the first planting spot, then dispense seeds."}</p>
    </div>
    <div className="cycles-row simple-section">
      <div className="simple-label">3. Forward moves <small>How many steps forward?</small></div>
      <div className="stepper">
        <button type="button" aria-label="One fewer forward move" disabled={cycles<=1}
          onClick={()=>setCycles(Math.max(1,cycles-1))}>−</button>
        <output aria-live="polite">{cycles}</output>
        <button type="button" aria-label="One more forward move" disabled={cycles>=50}
          onClick={()=>setCycles(Math.min(50,cycles+1))}>+</button>
      </div>
    </div>
    <div className="simple-section">
      <div className="simple-label">4. When finished?</div>
      <div className="finish-toggle two-choices" role="group" aria-label="After planting">
        <button type="button" className={!returnToStart?"active":""} aria-pressed={!returnToStart}
          onClick={()=>setReturnToStart(false)}>Stop there</button>
        <button type="button" className={returnToStart?"active":""} aria-pressed={returnToStart}
          onClick={()=>setReturnToStart(true)}><RotateCcw size={15}/> Go back</button>
      </div>
      {returnToStart&&<p className="field-help">Will reverse {cycles} timed move{cycles===1?"":"s"} after planting, with the gate closed. Approximate only—no position sensor.</p>}
    </div>
    <div className="sequence-summary" role="status">
      <strong>Your planned route</strong>
      <span>{dispenseCount} seed drops · {cycles} forward moves · {returnToStart?cycles+" reverse moves":"stop at end"}</span>
      <small>{sequence==="dispense-first"?"Dispense → move → dispense":"Move → dispense"} → {returnToStart?"reverse → finish":"finish"}</small>
    </div>

    <details className="advanced-plant">
      <summary>Adjust timing and spacing <small>Optional</small></summary>
      <div className="advanced-fields">
        {timeField("Forward distance (cm)","spacingCm","0 = use the movement timer; distance requires speed calibration")}
        {timeField("Forward movement (seconds)","driveMs","Example 3 means drive for 3 seconds",true)}
        {timeField("Wait before dispensing (seconds)","settleMs","Example 0.25 = quarter-second pause",true)}
        {timeField("Keep seed gate open (seconds)","releaseMs","Time allowed to drop the seeds",true)}
        <div className="field-help"><Info size={13}/> Speed currently {speed} cm/s (placeholder). Measure it before using distance mode.</div>
      </div>
    </details>
    <div className="future-rake">
      <label>
        <input type="checkbox" checked={useRake && rakeAvailable}
          disabled={!rakeAvailable} onChange={e=>setUseRake(e.target.checked)}/>
        <span>Use seed-covering rake (Servo 2)</span>
      </label>
      <small>{rakeAvailable
        ?"After dropping seeds, the rake lowers, stays down as the robot starts moving, then lifts after 1 second."
        :"Coming later — the second servo is not connected/enabled. Planting works with Servo 1 only."}</small>
    </div>
  </div>;
}

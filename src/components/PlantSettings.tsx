import type {PlantPreset} from "@/lib/plants";
export function PlantSettings({plants,selectedId,onSelect,selected,onEdit,cycles,setCycles,returnToStart,setReturnToStart,speed}:{
 plants:PlantPreset[];selectedId:string;onSelect:(id:string)=>void;selected:PlantPreset;
 onEdit:(patch:Partial<PlantPreset>)=>void;
 cycles:number;setCycles:(n:number)=>void;returnToStart:boolean;setReturnToStart:(x:boolean)=>void;speed:number;
}) {
 const numberField=(label:string,key:"spacingCm"|"driveMs"|"settleMs"|"releaseMs",min=0)=>
  <label className="number-field"><span>{label}</span>
    <input aria-label={label} type="number" min={min} max={20000} step="1"
      value={selected[key]} onChange={event=>{
        const num=Number(event.target.value);
        if(Number.isFinite(num))onEdit({[key]:Math.max(min,Math.min(20000,Math.round(num)))});
      }}/>
  </label>;
 return <div className="plant-form">
  <div className="section-kicker">Plant preset <span>Editable placeholders</span></div>
  <div className="plant-chips" role="group" aria-label="Select plant">
    {plants.map(p=><button key={p.id} type="button" className={p.id===selectedId?"active":""}
      onClick={()=>onSelect(p.id)} aria-pressed={p.id===selectedId}>{p.name}</button>)}
  </div>
  <div className="field-grid">
    {numberField("Spacing (cm; 0 = use drive time)","spacingCm")}
    {numberField("Drive (ms)","driveMs",100)}
    {numberField("Settle (ms)","settleMs")}
    {numberField("Gate release (ms)","releaseMs",100)}
  </div>
  <div className="cycles-row"><span>Cycles</span><div className="stepper">
    <button aria-label="Decrease cycles" disabled={cycles<=1} onClick={()=>setCycles(Math.max(1,cycles-1))}>−</button>
    <output aria-live="polite">{cycles}</output>
    <button aria-label="Increase cycles" disabled={cycles>=50} onClick={()=>setCycles(Math.min(50,cycles+1))}>+</button>
  </div></div>
  <div className="section-kicker">After finishing</div>
  <div className="finish-toggle" role="group" aria-label="After finishing">
    <button type="button" className={!returnToStart?"active":""} aria-pressed={!returnToStart} onClick={()=>setReturnToStart(false)}>Stop</button>
    <button type="button" className={returnToStart?"active":""} aria-pressed={returnToStart} onClick={()=>setReturnToStart(true)}>Return</button>
  </div>
  {returnToStart&&<p className="disclaimer">Return is time-based dead reckoning, not accurate navigation. Wheel slip and battery charge cause drift.</p>}
  <p className="disclaimer">Calibrate: measure how far the robot moves in 3 s, then set robot speed. Current speed: {speed} cm/s (placeholder).</p>
 </div>;
}

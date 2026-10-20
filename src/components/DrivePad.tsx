import {ArrowDown,ArrowLeft,ArrowRight,ArrowUp} from "lucide-react";
import type {Direction} from "@/lib/protocol";
const keys=[
  {dir:"go",label:"Forward",Icon:ArrowUp},{dir:"left",label:"Left",Icon:ArrowLeft},
  {dir:"right",label:"Right",Icon:ArrowRight},{dir:"back",label:"Back",Icon:ArrowDown}
] as const;
export function DrivePad({enabled,held,press,release}:{
  enabled:boolean;held:Direction|null;press:(dir:Direction)=>void;release:(dir:Direction)=>void;
}) {
  return <section className="zone drive-zone" aria-label="Manual driving">
    <div className="zone-heading"><h2>Drive</h2><small>Hold to move · Release to stop</small></div>
    <div className="direction-grid">
      {keys.map(({dir,label,Icon})=><button
        type="button" key={dir} className={"drive-key key-"+dir+(held===dir?" pressed":"")}
        aria-label={label+" — hold to drive"} disabled={!enabled}
        onPointerDown={event=>{
          if(!enabled)return;
          event.preventDefault();event.currentTarget.setPointerCapture(event.pointerId);press(dir);
        }}
        onPointerUp={event=>{
          if(event.currentTarget.hasPointerCapture(event.pointerId))
            event.currentTarget.releasePointerCapture(event.pointerId);
          release(dir);
        }}
        onLostPointerCapture={()=>release(dir)}
        onPointerCancel={()=>release(dir)}
        onContextMenu={event=>event.preventDefault()}>
        <Icon size={36} strokeWidth={2.2}/><span>{label}</span>
      </button>)}
      <span className="dpad-middle" aria-hidden="true"/>
    </div>
  </section>;
}

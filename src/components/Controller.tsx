"use client";
import {useRobot} from "@/hooks/useRobot";
import {TopBar} from "./TopBar";
import {DrivePad} from "./DrivePad";
import {ModePanel} from "./ModePanel";
import {GatePanel} from "./GatePanel";
import {SettingsSheet} from "./SettingsSheet";
import {RotateCcw} from "lucide-react";

export default function Controller() {
 const robot=useRobot();
 return <div className="control-layout" role="application" aria-label="4WD controller">
  <TopBar health={robot.health} onSettings={()=>{robot.release();robot.setSettingsOpen(true);}}/>
  <main className="controller-grid">
   <DrivePad enabled={robot.connected && robot.view==="manual" && robot.status?.mode==="manual" && !robot.settingsOpen}
     held={robot.held} press={robot.drive} release={robot.release}/>
   <ModePanel robot={robot}/>
   <GatePanel robot={robot}/>
  </main>
  <SettingsSheet robot={robot}/>
  <div className="portrait-notice"><RotateCcw size={30}/><strong>Rotate to landscape</strong>
    <span>Use landscape orientation for the full-size controller.</span></div>
 </div>;
}

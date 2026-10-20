"use client";
import { useCallback,useEffect,useRef,useState } from "react";
import { App as CapacitorApp } from "@capacitor/app";
import { HybridRobotLink, type LinkHealth } from "@/lib/robot-link";
import { DriveSession } from "@/lib/drive-session";
import { tapFeedback } from "@/lib/haptics";
import { ROBOT_SSID, type Direction, type Mode, type Preset, type RobotStatus } from "@/lib/protocol";
import { EXAMPLE_PLANTS, DEFAULT_ROBOT_SPEED_CM_S, toPlantConfig, type PlantPreset } from "@/lib/plants";
import { validatePlantConfig } from "@/lib/plant-plan";

export function useRobot() {
  const [status,setStatus]=useState<RobotStatus|null>(null);
  const [health,setHealth]=useState<LinkHealth>({connected:false,transport:"http",failures:0,lastRttMs:null,avgRttMs:null});
  const [view,setView]=useState<Mode>("manual");
  const [routine,setRoutine]=useState<Preset>("plant");
  const [held,setHeld]=useState<Direction|null>(null);
  const [haptics,setHaptics]=useState(true);
  const [debug,setDebug]=useState(false);
  const [settingsOpen,setSettingsOpen]=useState(false);
  const [servo2Visible,setServo2Visible]=useState(false);
  const [powerWarning,setPowerWarning]=useState(false);
  const [runningCommand,setRunningCommand]=useState(false);
  const [plants,setPlants]=useState<PlantPreset[]>(EXAMPLE_PLANTS.map(p=>({...p})));
  const [plantId,setPlantId]=useState("corn");
  const [cycles,setCycles]=useState(5);
  const [returnToStart,setReturnToStart]=useState(false);
  const [speed,setSpeed]=useState(DEFAULT_ROBOT_SPEED_CM_S);
  const [error,setError]=useState<string|null>(null);
  const linkRef=useRef<HybridRobotLink|null>(null);
  const driveRef=useRef<DriveSession|null>(null);
  const heldRef=useRef<Direction|null>(null);
  const modeRef=useRef<Mode>("manual");
  const latestUptime=useRef<number|null>(null);
  const alive=useRef(false);
  const backgroundStopped=useRef(false);
  const selectedPlant=plants.find(p=>p.id===plantId) ?? plants[0];
  const configuration=toPlantConfig(selectedPlant,cycles,returnToStart,speed);
  const configurationError=validatePlantConfig(configuration);
  const connected=health.connected && status?.ready===true;

  const release=useCallback((direction?:Direction)=>{
    if(direction && heldRef.current!==direction)return;
    if(!heldRef.current)return;
    heldRef.current=null; setHeld(null);
    driveRef.current?.release();
  },[]);
  const stop=useCallback(async()=>{
    release(); setView("manual"); modeRef.current="manual";
    try { await linkRef.current?.stop(); setError(null); } catch {
      setError("Stop command not acknowledged. Power off if the robot does not stop.");
    }
  },[release]);

  useEffect(()=>{
    alive.current=true;
    const link=new HybridRobotLink(); linkRef.current=link;
    const session=new DriveSession(
      cmd=>cmd==="stop" ? link.stop() : link.drive(cmd),
      ()=>{heldRef.current=null;setHeld(null);},100
    ); driveRef.current=session;
    try {
      const values=JSON.parse(localStorage.getItem("fourwd-plants")||"null");
      if(Array.isArray(values)&&values.length===EXAMPLE_PLANTS.length&&values.every(p=>typeof p.id==="string" && typeof p.name==="string" && Number.isFinite(p.driveMs) && Number.isFinite(p.settleMs) && Number.isFinite(p.releaseMs) && Number.isFinite(p.spacingCm)))
        setPlants(values);
    } catch {}
    const cached=localStorage.getItem("fourwd-speed");
    if(cached && Number(cached)>0) setSpeed(Number(cached));
    setHaptics(localStorage.getItem("fourwd-haptics")!=="false");
    setDebug(localStorage.getItem("fourwd-debug")==="true");
    setServo2Visible(localStorage.getItem("fourwd-servo2")==="true");
    const unsubHealth=link.onHealth(next=>{
      if(!alive.current) return;
      setHealth(next);
      if(!next.connected) {heldRef.current=null;setHeld(null);}
    });
    const unsubStatus=link.onStatus(next=>{
      if(!alive.current)return;
      setStatus(next); modeRef.current=next.mode;
      if(next.mode==="auto"){
        setView("auto");
        if(next.preset)setRoutine(next.preset);
      }
      if(next.resetReason==="BROWNOUT" || (latestUptime.current!==null && next.uptimeMs+1000<latestUptime.current))
        setPowerWarning(true);
      latestUptime.current=next.uptimeMs;
    });
    void link.connect();
    const heart=setInterval(()=>{
      if(modeRef.current==="auto") void link.heartbeat().catch(()=>{});
    },350);
    const background=()=>{
      if(backgroundStopped.current)return;
      backgroundStopped.current=true; release();modeRef.current="manual";
      void link.stop().catch(()=>{});
    };
    const visibility=()=>{if(document.hidden) background(); else backgroundStopped.current=false;};
    document.addEventListener("visibilitychange",visibility);
    let subscribed=true; let remove:(()=>void)|undefined;
    void CapacitorApp.addListener("appStateChange",event=>{
      if(!event.isActive) background(); else backgroundStopped.current=false;
    }).then(l=>{if(subscribed)remove=()=>void l.remove();else void l.remove();}).catch(()=>{});
    return ()=>{
      alive.current=false;subscribed=false;clearInterval(heart);
      document.removeEventListener("visibilitychange",visibility);remove?.();
      session.release();session.dispose();link.close();
      driveRef.current=null;linkRef.current=null;
    };
  },[release]);

  useEffect(()=>{localStorage.setItem("fourwd-plants",JSON.stringify(plants));},[plants]);
  useEffect(()=>{localStorage.setItem("fourwd-speed",String(speed));},[speed]);
  useEffect(()=>{document.documentElement.dataset.theme=view==="auto"&&routine==="plant"?"plant":"default";
    return ()=>{delete document.documentElement.dataset.theme;};
  },[routine,view]);

  const drive=(direction:Direction)=>{
    if(!connected || modeRef.current!=="manual" || view!=="manual" || settingsOpen)return;
    if(heldRef.current===direction)return;
    heldRef.current=direction;setHeld(direction);void tapFeedback(haptics);
    driveRef.current?.press(direction);
  };
  const chooseManual=()=>{
    setView("manual");
    if(modeRef.current==="auto")void stop();
  };
  const run=async()=>{
    if(!connected||runningCommand||settingsOpen)return;
    if(routine==="plant" && configurationError){setError(configurationError);return;}
    release();setRunningCommand(true);setError(null);
    try {
      await linkRef.current?.startAutopilot(routine==="plant" ? configuration : {preset:routine});
      modeRef.current="auto";setView("auto");
      await linkRef.current?.heartbeat();
      void tapFeedback(haptics);
    } catch {setError("Could not start. Check Wi-Fi connection and robot status.");}
    finally{setRunningCommand(false);}
  };
  const gate=async(ch:1|2,pos:"open"|"close")=>{
    if(!connected || modeRef.current!=="manual" || view!=="manual")return;
    void tapFeedback(haptics);
    try{await linkRef.current?.gate(ch,pos);}catch{setError("Servo command failed.");}
  };
  const retry=()=>void linkRef.current?.connect();
  const toggleHaptics=()=>{const next=!haptics;setHaptics(next);localStorage.setItem("fourwd-haptics",String(next));void tapFeedback(next);};
  const toggleDebug=()=>{const next=!debug;setDebug(next);localStorage.setItem("fourwd-debug",String(next));};
  const toggleServo2=()=>{const next=!servo2Visible;setServo2Visible(next);localStorage.setItem("fourwd-servo2",String(next));};
  const editPlant=(patch:Partial<PlantPreset>)=>setPlants(old=>old.map(p=>p.id===plantId?{...p,...patch}:p));
  return {status,health,connected,view,setView,chooseManual,routine,setRoutine,held,drive,release,stop,run,gate,
    haptics,debug,settingsOpen,setSettingsOpen,servo2Visible,toggleHaptics,toggleDebug,toggleServo2,
    retry,powerWarning,runningCommand,plants,plantId,setPlantId,selectedPlant,editPlant,
    cycles,setCycles,returnToStart,setReturnToStart,speed,setSpeed,configuration,configurationError,error,
    ssid:ROBOT_SSID};
}

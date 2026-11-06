import React, { useEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import './style.css';

const TAU = 2*Math.PI;
const clamp=(n,a,b)=>Math.max(a,Math.min(b,n));
const smooth=(a,b,t)=>a+(b-a)*t;
const rand=(i)=>{let n=Math.sin(i*127.1+78.233)*43758.5453;return n-Math.floor(n)};

// Replace this function with mapped API/WebSocket telemetry later.
// Values update at discrete intervals; the rendering layer stays alive between samples.
function createFakeSource(){
  let step=0, latency=12.4, throughput=318, error=0.003, heat=0.23;
  return ()=>{
    step++;
    const incident=step%47>=31 && step%47<=38;
    latency=clamp(latency+(Math.random()-.5)*1.4+(12.4-latency)*.15+(incident?1.8:0),4,42);
    throughput=clamp(throughput+(Math.random()-.5)*24+(318-throughput)*.17-(incident?8:0),130,450);
    error=clamp(error+(Math.random()-.5)*.003+(0.003-error)*.21+(incident?.004:0),0,.12);
    heat=clamp(heat+((incident?.85:.2)-heat)*.14,0,1);
    return {timestamp:Date.now(),latency,throughput,error,heat,incident};
  };
}
const telemetrySource=createFakeSource();

function Instrument({live,mode,activity,phosphor,onInspect,inspect,telemetry}){
 const canvasRef=useRef(null), dataRef=useRef({latency:12.4,throughput:318,error:.003,heat:.23,incident:false});
 const targetRef=useRef({...dataRef.current});
 const stateRef=useRef({live,mode,activity,phosphor,inspect});
 useEffect(()=>{stateRef.current={live,mode,activity,phosphor,inspect}},[live,mode,activity,phosphor,inspect]);
 useEffect(()=>{ targetRef.current=telemetry; },[telemetry]);
 useEffect(()=>{
  const canvas=canvasRef.current,ctx=canvas.getContext('2d',{alpha:false});
  let w=0,h=0,dpr=1,raf,prev=performance.now(),clock=0, sampleHistory=[],particles=[];
  const resize=()=>{const r=canvas.getBoundingClientRect();dpr=Math.min(window.devicePixelRatio||1,2);w=r.width;h=r.height;canvas.width=Math.max(1,Math.round(w*dpr));canvas.height=Math.max(1,Math.round(h*dpr));ctx.setTransform(dpr,0,0,dpr,0,0);};
  const observer=new ResizeObserver(resize);observer.observe(canvas);resize();
  for(let i=0;i<410;i++)particles.push({u:rand(i+6),v:rand(i+806),phase:rand(i+1700)*TAU,size:.45+rand(i+2500)*1.2,speed:.4+rand(i+3700)*.9,bright:rand(i+4700)});
  function frame(now){
    const dt=Math.min((now-prev)/1000,.05);prev=now;clock+=dt;
    const settings=stateRef.current, target=targetRef.current,current=dataRef.current;
    for(const k of ['latency','throughput','error','heat'])current[k]=smooth(current[k],target[k],1-Math.exp(-dt*1.4));
    current.incident=target.incident;
    const W=w,H=h,cx=W*.5,cy=H*.52,rx=Math.min(W*.35,H*.56),ry=Math.min(H*.28,W*.20);
    ctx.fillStyle='#030707';ctx.fillRect(0,0,W,H);
    const amp=settings.activity/100;
    const color=settings.mode==='amber'?[242,178,100]:settings.mode==='blue'?[118,191,210]:[150,218,191];
    const rgb=(a=1)=>`rgba(${color[0]},${color[1]},${color[2]},${a})`;
    // Instrument calibration: quiet geometry, never dominant.
    ctx.lineWidth=.65;ctx.strokeStyle=rgb(.10);
    ctx.beginPath();ctx.moveTo(cx,cy-ry*1.33);ctx.lineTo(cx,cy+ry*1.33);ctx.moveTo(cx-rx*1.14,cy);ctx.lineTo(cx+rx*1.14,cy);ctx.stroke();
    for(const s of [-1,1]){ctx.beginPath();ctx.moveTo(cx+s*rx*1.2,cy-8);ctx.lineTo(cx+s*rx*1.2,cy+8);ctx.stroke();}
    const latencyNorm=clamp((current.latency-4)/32,0,1);
    const throughputNorm=clamp((current.throughput-130)/320,0,1);
    const deviation=amp*(.08+.12*latencyNorm);
    const wave=(u,t)=>Math.sin(u*TAU*1.65-t*.44)*.37+Math.sin(u*TAU*3.7+t*.26)*.11+Math.sin(u*TAU*7.3-t*.17)*.038;
    // Soft luminous field comprised of many faint individual particle trajectories.
    const count=particles.length;
    const t=clock;
    ctx.globalCompositeOperation='lighter';
    for(let i=0;i<count;i++){
      const p=particles[i];
      const u=p.u;
      const drift=t*(.007+.017*p.speed)*(settings.live?1:.42);
      const pos=((u+drift)%1);
      const x=cx+(pos-.5)*2*rx;
      const envelope=Math.pow(Math.sin(Math.PI*pos),1.25);
      const v=p.v*2-1;
      const ribbon=wave(pos,t)+Math.sin(pos*16+p.phase+t*.18)*deviation;
      const spread=(.07+throughputNorm*.2)*ry;
      const y=cy-ribbon*ry*1.1+v*spread*envelope+Math.sin(t*.9+p.phase)*(.5+amp*1.5);
      const hot=clamp(latencyNorm*.6+current.heat*.6,0,1);
      let alpha=(.1+p.bright*.45)*envelope*(.7+amp*.5);
      if(pos>.48&&pos<.64)alpha*=1+hot*.55;
      const r=p.size*(.6+settings.phosphor/180);
      ctx.fillStyle=rgb(alpha);
      ctx.beginPath();ctx.arc(x,y,r,0,TAU);ctx.fill();
      if(p.bright>.94 && settings.phosphor>40){ctx.fillStyle=rgb(alpha*.16);ctx.beginPath();ctx.arc(x,y,r*4,0,TAU);ctx.fill();}
    }
    ctx.globalCompositeOperation='source-over';
    // Central spine: mathematical signal contour, not decorative oscillation.
    ctx.beginPath();
    for(let j=0;j<=240;j++){
      const u=j/240,x=cx+(u-.5)*2*rx;
      const y=cy-(wave(u,t)+Math.sin(u*16+t*.18)*deviation)*ry*1.1;
      j?ctx.lineTo(x,y):ctx.moveTo(x,y);
    }
    ctx.strokeStyle=rgb(.37);ctx.lineWidth=.85;ctx.stroke();
    // Signal origin and current sample pointer.
    const pos=(t*.023)%1, px=cx+(pos-.5)*2*rx;
    const py=cy-(wave(pos,t)+Math.sin(pos*16+t*.18)*deviation)*ry*1.1;
    ctx.strokeStyle=rgb(.23);ctx.beginPath();ctx.moveTo(px,py-15);ctx.lineTo(px,py+15);ctx.stroke();
    ctx.fillStyle=rgb(.95);ctx.beginPath();ctx.arc(px,py,2.1,0,TAU);ctx.fill();
    // Tiny baseline ticks, spatial reference only.
    ctx.font='10px ui-monospace, SFMono-Regular, Menlo, monospace';ctx.textAlign='left';ctx.fillStyle=rgb(.45);
    ctx.fillText('− 300 S',cx-rx,cy+ry*1.28);ctx.textAlign='right';ctx.fillText('NOW',cx+rx,cy+ry*1.28);
    if(settings.phosphor>0){
      // A restrained CRT texture rather than a monitor-shaped decorative border.
      ctx.fillStyle=`rgba(0,0,0,${settings.phosphor/1500})`;
      for(let y=0;y<H;y+=4)ctx.fillRect(0,y,W,1);
    }
    raf=requestAnimationFrame(frame);
  }
  raf=requestAnimationFrame(frame);
  return ()=>{cancelAnimationFrame(raf);observer.disconnect()};
 },[]);
 return <canvas ref={canvasRef} onClick={onInspect} className="instrument" aria-label="Animated signal particle field, click to inspect"/>;
}

function App(){
 const [live,setLive]=useState(true),[mode,setMode]=useState('phosphor'),[activity,setActivity]=useState(55),[phosphor,setPhosphor]=useState(30),[inspect,setInspect]=useState(false),[isFull,setIsFull]=useState(false);
 const shell=useRef(); const liveRef=useRef(live); const [data,setData]=useState({latency:12.4,throughput:318,error:.003,heat:.23,incident:false});
 useEffect(()=>{liveRef.current=live},[live]);
 useEffect(()=>{const id=setInterval(()=>{if(liveRef.current)setData(telemetrySource())},1100);return()=>clearInterval(id)},[]);
 const full=()=>{if(!document.fullscreenElement){shell.current?.requestFullscreen?.();setIsFull(true)}else{document.exitFullscreen?.();setIsFull(false)}};
 return <div className="page"><div ref={shell} className="shell">
   <header className="top"><div className="wordmark">MARS <span className="dash">/</span> <span className="submark">PULSE</span></div><span className="descriptor">MEASURE ANY REMOTE SYSTEM</span><span className="topright">INSTRUMENT 001 <i className={'status '+(live?'':'paused')}></i> {live?'SIMULATING':'HOLD'}</span></header>
   <section className="main"><div className="section-label">01 / SIGNAL OBSERVATORY <span className="dot">•</span> INFERENCE-01</div>
     <Instrument live={live} mode={mode} activity={activity} phosphor={phosphor} telemetry={data} inspect={inspect} onInspect={()=>setInspect(v=>!v)}/>
     <div className="overline"><span>STREAM / INFERENCE.LATENCY</span><span>300 S WINDOW <span className="pale">—</span> PARTICLE FIELD</span></div>
   </section>
   <div className="readouts"><div className="measure"><span>LATENCY <b>01</b></span><strong>{data.latency.toFixed(3)} <small>ms</small></strong><em>MEAN RESPONSE</em></div><div className="measure"><span>THROUGHPUT <b>02</b></span><strong>{data.throughput.toFixed(1)} <small>req/s</small></strong><em>REQUEST FREQUENCY</em></div><div className="measure"><span>ERROR RATE <b>03</b></span><strong>{data.error.toFixed(3)} <small>%</small></strong><em>INFERENCE ERRORS</em></div><div className="last"><span>RENDER STATE</span><b>{live?'ACTIVE':'DATA HELD'}</b><span>PARTICLES 410</span></div></div>
   {inspect&&<section className="inspector"><span>INSPECT / SIGNAL</span><p>The wave is a visual encoding of mock telemetry. Each point drifts independently, while measured throughput controls the field width and latency affects its agitation. Motion persists when ingestion is paused.</p><button onClick={()=>setInspect(false)}>CLOSE ×</button></section>}
   <footer className="controls"><div className="controlgroup"><button onClick={()=>setLive(v=>!v)}>{live?'Ⅱ PAUSE SOURCE':'▶ RESUME SOURCE'}</button><button onClick={full}>{isFull?'⤢ EXIT FULLSCREEN':'⤢ FULLSCREEN'}</button></div><div className="controlgroup"><label>PHOSPHOR <input aria-label="Phosphor strength" type="range" min="0" max="100" value={phosphor} onChange={e=>setPhosphor(+e.target.value)}/></label><label>MOTION <input aria-label="Motion intensity" type="range" min="0" max="100" value={activity} onChange={e=>setActivity(+e.target.value)}/></label><select aria-label="Instrument palette" value={mode} onChange={e=>setMode(e.target.value)}><option value="phosphor">SAGE / 01</option><option value="amber">AMBER / 02</option><option value="blue">CYAN / 03</option></select></div></footer>
 </div><div className="below">MARS / PULSE — SIMULATED TELEMETRY. CLICK THE FIELD TO INSPECT.</div></div>
}
createRoot(document.getElementById('root')).render(<App/>);

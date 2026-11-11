import React,{useEffect,useRef,useState} from 'react';
import {createRoot} from 'react-dom/client';
import jsQR from 'jsqr';
import {api,ApiError} from './api';
import './style.css';

type Preferences={successSound:boolean;rejectionSound:boolean;successVibration:boolean;rejectionVibration:boolean};
type State={staff:string;event:{id:number;name:string;eventDate:string;venue:string;status:string;endsAt:string;archived:boolean};entrances:{id:number;name:string}[];entranceId:number|null;preferences:Preferences;accepted:number;rejected:number;total:number;checked:number;remaining:number;recent:{guestName:string;ticketNumber:string;accepted:boolean;createdAt:string;message:string}[]};
type Result={accepted:boolean;message:string;guestName?:string;ticketNumber?:string;eventName?:string;eventDate?:string;category?:string;entrance?:string;originalTime?:string;originalEntrance?:string};
type TorchConstraint=MediaTrackConstraints & {advanced:{torch:boolean}[]};

function App() {
  const [token,setToken]=useState(()=>sessionStorage.getItem('aast-scanner-token') ?? '');
  const [state,setState]=useState<State|null>(null);
  const [online,setOnline]=useState(navigator.onLine);
  const [error,setError]=useState('');
  const [busy,setBusy]=useState(false);
  const [challenge,setChallenge]=useState('');
  const [mode,setMode]=useState<'ready'|'camera'|'waiting'|'result'>('ready');
  const [result,setResult]=useState<Result|null>(null);
  const [nextReady,setNextReady]=useState(false);
  const [settings,setSettings]=useState(false);
  const [torch,setTorch]=useState(false);
  const [torchSupported,setTorchSupported]=useState(false);
  const [lowBattery,setLowBattery]=useState(false);
  const stream=useRef<MediaStream|null>(null),video=useRef<HTMLVideoElement|null>(null),frame=useRef<number>(0);
  const audio=useRef<AudioContext|null>(null),modeRef=useRef(mode),opened=useRef(false),working=useRef(false);
  modeRef.current=mode;

  function stopCamera() {
    cancelAnimationFrame(frame.current);
    stream.current?.getTracks().forEach(t=>t.stop());
    stream.current=null;
    setTorch(false);setTorchSupported(false);
  }
  function signedOut() {stopCamera();sessionStorage.removeItem('aast-scanner-token');setToken('');setChallenge('');setState(null);setMode('ready');setResult(null);opened.current=false;}
  function saveToken(value:string) {sessionStorage.setItem('aast-scanner-token',value);setToken(value);setChallenge('');setError('');}
  function failed(e:unknown) {
    if (e instanceof ApiError && e.status===401) {signedOut();setError(e.message || 'Your scanner session expired. Sign in again.');return;}
    setError(e instanceof ApiError ? e.message : 'The backend is unavailable. No offline check-in is accepted.');
  }
  async function refresh() {
    const latest=await api<State>('state',token);
    setState(latest);setOnline(true);
    return latest;
  }
  useEffect(()=>{
    if (!token) return;
    let disposed=false,inFlight=false;
    async function update() {
      if (inFlight) return;
      inFlight=true;
      try {const latest=await api<State>('state',token);if(!disposed){setState(latest);setOnline(true);}}
      catch(e) {if(!disposed){setOnline(false);stopCamera();failed(e);}}
      finally {inFlight=false;}
    }
    void update(); const timer=setInterval(update,5000);
    return ()=>{disposed=true;clearInterval(timer);stopCamera();};
  },[token]);
  useEffect(()=>{
    const offline=()=>{setOnline(false);stopCamera();};
    const restore=()=>{if(token) void refresh().catch(failed);};
    window.addEventListener('offline',offline);window.addEventListener('online',restore);
    return ()=>{window.removeEventListener('offline',offline);window.removeEventListener('online',restore);};
  },[token]);
  useEffect(()=>{
    let stopped=false,cleanup:(()=>void)|undefined;
    const batteryNavigator=navigator as Navigator & {getBattery?:()=>Promise<EventTarget & {level:number;charging:boolean}>};
    if(batteryNavigator.getBattery) void batteryNavigator.getBattery().then(battery=>{
      if(stopped)return;
      const update=()=>setLowBattery(battery.level<0.2 && !battery.charging);
      update();battery.addEventListener('levelchange',update);battery.addEventListener('chargingchange',update);
      cleanup=()=>{battery.removeEventListener('levelchange',update);battery.removeEventListener('chargingchange',update);};
    }).catch(()=>{});
    return ()=>{stopped=true;cleanup?.();};
  },[]);
  useEffect(()=>{
    if(!result)return;
    setNextReady(false);const timer=setTimeout(()=>setNextReady(true),3000);
    return ()=>clearTimeout(timer);
  },[result]);

  function feedback(accepted:boolean) {
    const prefs=state?.preferences;
    if(!prefs)return;
    if((accepted ? prefs.successVibration:prefs.rejectionVibration) && navigator.vibrate) navigator.vibrate(accepted ? 100:[100,80,100]);
    if((accepted ? prefs.successSound:prefs.rejectionSound) && audio.current) {
      const tone=audio.current.createOscillator(),volume=audio.current.createGain();
      tone.frequency.value=accepted ? 880:220;volume.gain.value=0.08;
      tone.connect(volume);volume.connect(audio.current.destination);tone.start();tone.stop(audio.current.currentTime+0.2);
    }
  }
  async function decoded(qr:string) {
    if(modeRef.current!=='camera'||working.current)return;
    working.current=true;stopCamera();modeRef.current='waiting';setMode('waiting');
    let response:Result;
    try {
      if(!navigator.onLine)throw new Error('offline');
      response=await api<Result>('checkin',token,{qr});
    } catch(e) {
      if(e instanceof ApiError && e.status===401){signedOut();working.current=false;return;}
      response={accepted:false,message:e instanceof ApiError ? e.message:'Connection interrupted. The server may already have processed this QR. Check connectivity before scanning it again.'};
    }
    setResult(response);feedback(response.accepted);setMode('result');working.current=false;
    void refresh().catch(failed);
  }

  useEffect(()=>{
    if(mode!=='camera'||!online||!token)return;
    let disposed=false,retrying:ReturnType<typeof setTimeout>|undefined,wake:WakeLockSentinel|undefined;
    const canvas=document.createElement('canvas'),context=canvas.getContext('2d',{willReadFrequently:true})!;
    let last=0;
    function read(now:number) {
      if(disposed||modeRef.current!=='camera'||!stream.current)return;
      frame.current=requestAnimationFrame(read);
      const view=video.current;
      if(!view||view.readyState<2||now-last<180)return;
      last=now;
      const scale=Math.min(1,1280/view.videoWidth);
      canvas.width=Math.round(view.videoWidth*scale);canvas.height=Math.round(view.videoHeight*scale);
      if(!canvas.width||!canvas.height)return;
      context.drawImage(view,0,0,canvas.width,canvas.height);
      const pixels=context.getImageData(0,0,canvas.width,canvas.height);
      const value=jsQR(pixels.data,pixels.width,pixels.height,{inversionAttempts:'attemptBoth'});
      if(value?.data)void decoded(value.data);
    }
    async function start() {
      if(disposed||document.hidden||!navigator.onLine||modeRef.current!=='camera')return;
      stopCamera();
      try {
        await refresh(); // authorization must be current before resuming
        const openedStream=await navigator.mediaDevices.getUserMedia({audio:false,video:{facingMode:{exact:'environment'},width:{ideal:1280},height:{ideal:720}}});
        if(disposed||document.hidden||modeRef.current!=='camera'){openedStream.getTracks().forEach(t=>t.stop());return;}
        stream.current=openedStream;
        const track=openedStream.getVideoTracks()[0];
        setTorchSupported(Boolean((track.getCapabilities() as MediaTrackCapabilities & {torch?:boolean}).torch));
        track.onended=()=>{stopCamera();if(!disposed){setError('Camera access lost. Waiting to reconnect.');retrying=setTimeout(start,2500);}};
        if(video.current){video.current.srcObject=openedStream;await video.current.play();}
        setError('');frame.current=requestAnimationFrame(read);
        if('wakeLock' in navigator)wake=await navigator.wakeLock.request('screen').catch(()=>undefined);
      } catch(e) {
        stopCamera();
        if(e instanceof ApiError){failed(e);return;}
        const denied=e instanceof DOMException && ['NotAllowedError','SecurityError'].includes(e.name);
        setError(denied ? 'Allow camera access in browser settings. Remote phones require HTTPS.':'The rear camera is unavailable. Close other camera apps. Scanning will resume when access returns.');
        if(!disposed)retrying=setTimeout(start,3000);
      }
    }
    const visibility=()=>{if(document.hidden){stopCamera();void wake?.release();}else void start();};
    void start();document.addEventListener('visibilitychange',visibility);
    return ()=>{disposed=true;clearTimeout(retrying);stopCamera();void wake?.release();document.removeEventListener('visibilitychange',visibility);};
  },[mode,online,token]);

  async function startNext() {
    try {
      if(!audio.current)audio.current=new AudioContext();
      await audio.current.resume();await refresh();opened.current=true;
      setResult(null);setMode('camera');
    }catch(e){failed(e);}
  }
  if(!token) return <main><h1>Dream Events Scanner</h1><p>Sign in with your staff account and event access code.</p>{error&&<p role="alert" className="error">{error}</p>}
    {challenge ? <form onSubmit={async e=>{e.preventDefault();setBusy(true);const data=new FormData(e.currentTarget);try{const result=await api<{token:string}>('temporary-password',undefined,{challenge,newPassword:data.get('password')});saveToken(result.token);}catch(e){failed(e);}finally{setBusy(false);}}}>
      <h2>Set your new password</h2><label>New password<input name="password" type="password" minLength={12} maxLength={256} autoComplete="new-password" required/></label><button disabled={busy}>Save and sign in</button></form> :
    <form onSubmit={async e=>{e.preventDefault();setBusy(true);setError('');const data=new FormData(e.currentTarget);try{const result=await api<{token?:string;challenge?:string;requiresPasswordChange:boolean}>('login',undefined,Object.fromEntries(data));if(result.requiresPasswordChange)setChallenge(result.challenge!);else saveToken(result.token!);}catch(e){failed(e);}finally{setBusy(false);}}}>
      <label>Username<input name="username" autoComplete="username" maxLength={80} required/></label><label>Password<input name="password" type="password" autoComplete="current-password" maxLength={256} required/></label><label>Event access code<input name="eventCode" autoComplete="off" maxLength={100} required/></label><button disabled={busy}>{busy?'Signing in…':'Sign in'}</button></form>}</main>;

  if(result) return <main className={'result '+(result.accepted?'approved':'rejected')} role="status" aria-live="assertive"><h1>{result.accepted?'Entry approved':'Entry rejected'}</h1><h2>{result.guestName}</h2><p>{result.message}</p><p>{result.ticketNumber}</p><p>{result.eventName}</p>{result.eventDate&&<p>{new Date(result.eventDate).toLocaleDateString('en-GB',{timeZone:'UTC'})}</p>}<p>{result.category} {result.entrance&&'· '+result.entrance}</p>{result.originalTime&&<p>Original entry: {new Date(result.originalTime).toLocaleString('en-GB')} · {result.originalEntrance}</p>}<button disabled={!nextReady||!online} onClick={()=>void startNext()}>{nextReady?'Scan Next Ticket':'Wait 3 seconds…'}</button>{!online&&<p>Offline Mode — reconnect before scanning.</p>}</main>;
  return <main><header><h1>{state?.event.name ?? 'Loading event…'}</h1><button className="secondary" onClick={async()=>{if(confirm('Sign out of this scanner?')){try{await api('logout',token,{});signedOut();}catch(e){failed(e);}}}}>Sign out</button></header>
    <p className={online?'online':'error'} role="status">{online?'Online':'Offline Mode — no check-ins accepted'}</p>{lowBattery&&<p className="error">Low battery: below 20%.</p>}{error&&<p role="alert" className="error">{error}</p>}
    {state&&<><p>{new Date(state.event.eventDate).toLocaleDateString('en-GB',{timeZone:'UTC'})} · {state.event.venue} · {state.event.status}</p><p>{state.staff}</p><label>Entrance<select aria-label="Entrance" value={state.entranceId ?? ''} onChange={async e=>{const id=Number(e.target.value);if(id&&confirm('Switch to this entrance?')){stopCamera();setMode('ready');try{await api('entrance',token,{entranceId:id});await refresh();if(opened.current)setMode('camera');}catch(e){failed(e);}}}}><option value="">Select entrance</option>{state.entrances.map(e=><option key={e.id} value={e.id}>{e.name}</option>)}</select></label>
    {mode==='ready'&&<button onClick={()=>void startNext()} disabled={!online||!state.entranceId}>Start camera</button>}{mode==='waiting'&&<p role="status">Verifying with server…</p>}
    {mode==='camera'&&<><video ref={video} playsInline muted autoPlay aria-label="Rear camera QR scanner"/>{torchSupported&&<button onClick={async()=>{try{await stream.current?.getVideoTracks()[0].applyConstraints({advanced:[{torch:!torch}]} as TorchConstraint);setTorch(!torch);}catch{setError('Flashlight is not available on this camera.');}}}>{torch?'Turn flashlight off':'Turn flashlight on'}</button>}<p>Show the complete QR and its white border. Hold steady.</p></>}
    <dl><div><dt>My accepted scans</dt><dd>{state.accepted}</dd></div><div><dt>My rejected scans</dt><dd>{state.rejected}</dd></div><div><dt>Registered guests</dt><dd>{state.total}</dd></div><div><dt>Checked in</dt><dd>{state.checked}</dd></div><div><dt>Remaining</dt><dd>{state.remaining}</dd></div></dl>
    <button className="secondary" onClick={()=>setSettings(!settings)}>Sound and vibration</button>{settings&&<form onSubmit={async e=>{e.preventDefault();const values=new FormData(e.currentTarget);try{await api('preferences',token,Object.fromEntries(['successSound','rejectionSound','successVibration','rejectionVibration'].map(k=>[k,values.has(k)])));await refresh();setSettings(false);}catch(e){failed(e);}}}>{(['successSound','rejectionSound','successVibration','rejectionVibration'] as const).map(key=><label className="checkbox" key={key}><input type="checkbox" name={key} defaultChecked={state.preferences[key]}/>{key.replace(/([A-Z])/g,' $1')}</label>)}<button>Save preferences</button></form>}
    <h2>My last 10 scans</h2><ul className="recent">{state.recent.map((item,index)=><li key={index}><strong>{item.accepted?'Approved':'Rejected'}</strong> {item.guestName}<br/>{item.ticketNumber}<br/><small>{new Date(item.createdAt).toLocaleTimeString('en-GB')} · {item.message}</small></li>)}</ul></>}
  </main>;
}
createRoot(document.getElementById('root')!).render(<App/>);

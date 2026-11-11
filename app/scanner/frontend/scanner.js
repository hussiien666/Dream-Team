export default function(component) {
  const {parentElement, data, setTriggerValue} = component;
  const root = parentElement.querySelector('.scanner');
  root.innerHTML = `<div class="status" role="status" aria-live="polite"></div>
    <video playsinline muted hidden></video>
    <div class="controls"><button type="button" class="start">Start camera</button>
      <button type="button" class="secondary stop" disabled>Stop camera</button></div>
    <label>Camera <select aria-label="Camera"><option value="">Rear camera (recommended)</option></select></label>
    <p class="help">Show the whole QR code, including its white border. Hold it steady 15–30 cm from the rear camera. Scanning happens automatically; no photo button is needed.</p>`;
  const video = root.querySelector('video');
  const startButton = root.querySelector('.start');
  const stopButton = root.querySelector('.stop');
  const cameras = root.querySelector('select');
  const status = root.querySelector('.status');
  const canvas = document.createElement('canvas');
  const context = canvas.getContext('2d', {willReadFrequently:true});
  let stream = null, frame = null, disposed = false, paused = true, busy = false, lastFrame = 0, startedAt = 0;
  function show(text, kind='') {status.textContent=text;status.className='status '+kind;}
  if (data?.feedback) {
    show(data.feedback.message, data.feedback.accepted ? 'success' : 'error');
    startButton.textContent='Scan next ticket';
  }
  function stop() {
    paused=true;
    if(frame!==null) cancelAnimationFrame(frame);
    if(stream) stream.getTracks().forEach(track=>track.stop());
    stream=null;video.srcObject=null;video.hidden=true;
    stopButton.disabled=true;startButton.disabled=false;
  }
  function scan(time) {
    if(disposed || paused || !stream) return;
    frame=requestAnimationFrame(scan);
    if(busy || time-lastFrame<180 || video.readyState<2 || !video.videoWidth) return;
    lastFrame=time;busy=true;
    try {
      const scale=Math.min(1,1280/video.videoWidth);
      canvas.width=Math.round(video.videoWidth*scale);
      canvas.height=Math.round(video.videoHeight*scale);
      context.drawImage(video,0,0,canvas.width,canvas.height);
      const pixels=context.getImageData(0,0,canvas.width,canvas.height);
      const code=decodeQR(pixels.data,pixels.width,pixels.height,{inversionAttempts:'attemptBoth'});
      if(code && code.data) {
        paused=true;
        stop();show('QR read. Checking entry permission…');
        startButton.disabled=true;
        setTriggerValue('scan',{text:code.data,id:crypto.randomUUID ? crypto.randomUUID() : Date.now()+'-'+Math.random()});
      } else if(time-startedAt>12000 && status.textContent==='Camera ready. Point at the ticket QR code.') {
        show('Still looking for a QR. Move the ticket slightly farther away, improve the lighting, and keep all four white edges visible. You can also use Upload QR image below.');
      }
    } catch(error) {show('The camera frame could not be read. Stop the camera and try again, or use Upload QR image.','error');}
    finally {busy=false;}
  }
  async function start() {
    stop();show('Opening camera…');startButton.disabled=true;
    if(!navigator.mediaDevices?.getUserMedia || !window.isSecureContext) {
      show('Camera scanning needs HTTPS on a phone. Open the secure app address, or use Upload QR image below.','error');startButton.disabled=false;return;
    }
    try {
      const videoConstraints=cameras.value ? {deviceId:{exact:cameras.value}} : {facingMode:{ideal:'environment'},width:{ideal:1280},height:{ideal:720}};
      const opened=await navigator.mediaDevices.getUserMedia({audio:false,video:videoConstraints});
      if(disposed) {opened.getTracks().forEach(track=>track.stop());return;}
      stream=opened;video.srcObject=stream;video.hidden=false;await video.play();
      paused=false;stopButton.disabled=false;show('Camera ready. Point at the ticket QR code.');
      startButton.textContent='Restart camera';startButton.disabled=false;
      const devices=await navigator.mediaDevices.enumerateDevices();
      const selected=stream.getVideoTracks()[0]?.getSettings().deviceId || '';
      cameras.replaceChildren();
      devices.filter(device=>device.kind==='videoinput').forEach((device,index)=>{
        const option=document.createElement('option');option.value=device.deviceId;
        option.textContent=device.label || `Camera ${index+1}`;cameras.appendChild(option);
      });
      if(selected) cameras.value=selected;
      lastFrame=0;startedAt=performance.now();frame=requestAnimationFrame(scan);
    } catch(error) {
      stop();
      const denied=['NotAllowedError','SecurityError'].includes(error.name);
      show(denied ? 'Camera permission was denied. Allow the camera in your browser settings, then tap Start camera.' : 'Could not open this camera. Close other camera apps, choose another camera, or upload a QR image.','error');
    }
  }
  startButton.onclick=start;
  stopButton.onclick=()=>{stop();show('Camera stopped.');};
  cameras.onchange=start;
  const visibility=()=>{if(document.hidden) stop();};
  document.addEventListener('visibilitychange',visibility);
  return ()=>{disposed=true;stop();document.removeEventListener('visibilitychange',visibility);};
}

(() => {
  'use strict';
  const WINDOWS_BRIDGE='http://127.0.0.1:51338';
  function androidBridge(){ return window.NexitNativeAndroid && typeof window.NexitNativeAndroid.syncState==='function' ? window.NexitNativeAndroid : null; }
  async function windowsHealth(timeoutMs=500){
    const ctl=new AbortController(); const timer=setTimeout(()=>ctl.abort(),timeoutMs);
    try{const r=await fetch(`${WINDOWS_BRIDGE}/health`,{signal:ctl.signal,cache:'no-store'});return r.ok?await r.json():null;}catch{return null;}finally{clearTimeout(timer);}
  }
  async function backend(){ if(androidBridge())return{kind:'android',available:true,label:'Android · alarma local'}; const w=await windowsHealth(); if(w?.ok)return{kind:'windows',available:true,label:'Windows · alarma local'}; return{kind:'web',available:false,label:'Web · sin alarma local'}; }
  async function activate(){ const a=androidBridge(); if(a){a.requestAlarmPermissions();return{kind:'android',ok:true};} const w=await windowsHealth(1000); if(w?.ok)return{kind:'windows',ok:true}; throw new Error('En Windows ejecuta NexitAlarmBridge.exe. En Android usa la aplicación nativa de Nexit.'); }
  async function reconcile(payload){ const json=JSON.stringify(payload); const a=androidBridge(); if(a){const r=a.syncState(json); if(String(r).startsWith('error'))throw new Error(r); return{kind:'android',ok:true};} const w=await windowsHealth(); if(w?.ok){const r=await fetch(`${WINDOWS_BRIDGE}/state`,{method:'POST',headers:{'Content-Type':'application/json'},body:json}); if(!r.ok)throw new Error('No se pudo actualizar el reloj local de Windows.'); return{kind:'windows',ok:true};} return{kind:'web',ok:false}; }
  async function test(){ const a=androidBridge(); if(a){const r=a.testAlarm60s(); if(r!=='ok')throw new Error('Android no pudo programar la prueba.'); return{kind:'android',ok:true};} const w=await windowsHealth(900); if(w?.ok){const r=await fetch(`${WINDOWS_BRIDGE}/test`,{method:'POST'}); if(!r.ok)throw new Error('Windows no pudo programar la prueba.'); return{kind:'windows',ok:true};} throw new Error('No hay motor local de alarmas disponible.'); }
  window.NexitLocalAlarms={backend,activate,reconcile,test};
})();

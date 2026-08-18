
(() => {
  'use strict';

  const cfg = window.NEXIT_CONFIG;
  if (!cfg || !window.supabase) {
    document.getElementById('app').innerHTML = '<div class="login-wrap"><div class="login-card"><h2>Nexit</h2><p>No se pudo cargar la configuración.</p></div></div>';
    return;
  }

  const client = window.supabase.createClient(cfg.SUPABASE_URL, cfg.SUPABASE_PUBLISHABLE_KEY, {
    auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
  });

  const DAYS = ['lunes','martes','miercoles','jueves','viernes','sabado','domingo'];
  const DAY_LABELS = {lunes:'Lunes',martes:'Martes',miercoles:'Miércoles',jueves:'Jueves',viernes:'Viernes',sabado:'Sábado',domingo:'Domingo'};
  const CACHE_KEY = 'nexit_cache_v3';
  const UI_KEY = 'nexit_ui_v3';
  const appRoot = document.getElementById('app');
  const toastNode = document.getElementById('toast');

  const state = {
    session: null,
    records: [],
    selectedDay: currentDayKey(),
    bankCategoryId: '',
    settingsOpen: false,
    reminderDay: null,
    syncState: 'local',
    loginError: '',
    syncing: false,
    syncTimer: null,
    toastTimer: null,
    alarmBackend: {kind:'web',available:false,label:'Comprobando…'},
    alarmTimer: null,
  };

  function stripAccents(value='') { return String(value).normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase(); }
  function currentDayKey(){ const w=new Intl.DateTimeFormat('es-ES',{weekday:'long'}).format(new Date()); const k=stripAccents(w); return DAYS.includes(k)?k:'lunes'; }
  function escapeHtml(value=''){ return String(value).replace(/[&<>'"]/g, ch => ({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[ch])); }
  function uid(prefix='id'){ return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2,8)}`; }
  function nowIso(){ return new Date().toISOString(); }
  function parseIso(value){ const t=Date.parse(value||''); return Number.isFinite(t)?t:0; }

  function loadLocal(){
    try { const raw=JSON.parse(localStorage.getItem(CACHE_KEY)||'[]'); if(Array.isArray(raw)) state.records=raw; } catch{}
    try { const ui=JSON.parse(localStorage.getItem(UI_KEY)||'{}'); if(DAYS.includes(ui.selectedDay)) state.selectedDay=ui.selectedDay; } catch{}
  }
  function persistLocal(){ localStorage.setItem(CACHE_KEY, JSON.stringify(state.records)); localStorage.setItem(UI_KEY, JSON.stringify({selectedDay:state.selectedDay})); }

  function getRecord(id){ return state.records.find(r=>r.record_id===id) || null; }
  function activeRecords(type){ return state.records.filter(r=>r.record_type===type && !r.deleted_at); }
  function getSettings(){ return getRecord('settings:main')?.payload || {appEnabled:true,alarmsEnabled:true,snoozeMinutes:10,appearance:'dark',timezone:'Europe/Madrid'}; }
  function getSchedule(day){ return getRecord(`schedule:${day}`)?.payload || {targetDay:day,showOnDay:day,showAt:'06:00',categoryIds:[],items:[]}; }
  function getCategory(id){ return getRecord(id)?.payload || null; }
  function getDayState(day){ return getRecord(`state:${day}`)?.payload || {targetDay:day,checkedEntries:[],collapsedCategoryIds:[],snoozedUntil:null}; }
  function categories(){ return activeRecords('category').map(r=>r.payload).sort((a,b)=>String(a.name).localeCompare(String(b.name),'es')); }

  function localAlarmPayload(){
    return {version:1,updatedAt:nowIso(),settings:getSettings(),schedules:DAYS.map(day=>getSchedule(day)),dayStates:DAYS.map(day=>getDayState(day))};
  }
  function scheduleAlarmReconcile(){
    clearTimeout(state.alarmTimer);
    state.alarmTimer=setTimeout(()=>reconcileLocalAlarms(false),500);
  }
  async function reconcileLocalAlarms(showFeedback=false){
    if(!window.NexitLocalAlarms)return;
    try{
      state.alarmBackend=await window.NexitLocalAlarms.backend();
      const r=await window.NexitLocalAlarms.reconcile(localAlarmPayload());
      if(r.ok) state.alarmBackend=await window.NexitLocalAlarms.backend();
      if(showFeedback) toast(r.ok?'Alarmas locales actualizadas.':'Datos guardados; este navegador no controla alarmas locales.');
    }catch(e){console.warn('Alarmas locales',e);if(showFeedback)toast(e.message||String(e));}
    if(state.settingsOpen)render();
  }

  function saveRecord(type,id,payload,{deletedAt=null,render=true}={}){
    const stamp=nowIso();
    const idx=state.records.findIndex(r=>r.record_id===id);
    const row={record_id:id,record_type:type,payload,client_updated_at:stamp,deleted_at:deletedAt,dirty:true};
    if(idx>=0) state.records[idx]={...state.records[idx],...row}; else state.records.push(row);
    persistLocal();
    state.syncState='pending';
    if(render) render();
    scheduleSync();
    scheduleAlarmReconcile();
  }

  function markDeleted(id){ const r=getRecord(id); if(!r)return; saveRecord(r.record_type,id,r.payload,{deletedAt:nowIso()}); }

  function scheduleSync(){
    clearTimeout(state.syncTimer);
    state.syncTimer=setTimeout(()=>syncAll(false),700);
  }

  async function flushDirty(){
    if(!state.session || !navigator.onLine) return;
    const dirty=state.records.filter(r=>r.dirty);
    if(!dirty.length) return;
    const rows=dirty.map(r=>({
      user_id:state.session.user.id,
      record_id:r.record_id,
      record_type:r.record_type,
      payload:r.payload||{},
      client_updated_at:r.client_updated_at||nowIso(),
      deleted_at:r.deleted_at||null,
    }));
    const {error}=await client.from('nexit_records').upsert(rows,{onConflict:'user_id,record_id'});
    if(error) throw error;
    const sentIds=new Set(dirty.map(r=>r.record_id));
    state.records=state.records.map(r=>sentIds.has(r.record_id)?{...r,dirty:false}:r);
    persistLocal();
  }

  async function pullRemote(){
    if(!state.session || !navigator.onLine) return;
    const {data,error}=await client.from('nexit_records').select('record_id,record_type,payload,client_updated_at,server_updated_at,deleted_at').eq('user_id',state.session.user.id);
    if(error) throw error;
    const local=new Map(state.records.map(r=>[r.record_id,r]));
    for(const remote of data||[]){
      const l=local.get(remote.record_id);
      if(l?.dirty && parseIso(l.client_updated_at)>parseIso(remote.client_updated_at)) continue;
      local.set(remote.record_id,{...remote,dirty:false});
    }
    state.records=[...local.values()];
    persistLocal();
  }

  async function syncAll(showFeedback=false){
    if(state.syncing || !state.session) return;
    if(!navigator.onLine){ state.syncState='offline'; renderStatusOnly(); return; }
    state.syncing=true; state.syncState='syncing'; renderStatusOnly();
    try{
      await flushDirty();
      await pullRemote();
      scheduleAlarmReconcile();
      state.syncState='synced';
      render();
      if(showFeedback) toast('Datos sincronizados');
    }catch(err){
      console.error(err); state.syncState='error'; renderStatusOnly();
      if(showFeedback) toast(`No se pudo sincronizar: ${err.message||err}`);
    }finally{ state.syncing=false; }
  }

  function renderStatusOnly(){
    const el=document.querySelector('[data-sync-status]'); if(!el)return;
    el.innerHTML=syncStatusHtml();
  }
  function syncStatusHtml(){
    const map={
      synced:['ok','Sincronizado'], syncing:['warn','Sincronizando…'], pending:['warn','Cambios pendientes'], offline:['','Sin conexión'], error:['','Error de sincronización'], local:['','Datos locales']
    };
    const [cls,text]=map[state.syncState]||map.local;
    return `<span class="dot ${cls}"></span><span>${text}</span>`;
  }

  function entryKeyCategory(categoryId,itemId){ return `category:${categoryId}:item:${itemId}`; }
  function entryKeyLoose(itemId){ return `loose:${itemId}`; }

  function categoryProgress(day,category){
    const ds=getDayState(day); const active=(category.items||[]).filter(i=>i.active);
    if(!active.length) return {text:'Sin ítems activos',cls:'inactive',done:0,total:0};
    const done=active.filter(i=>ds.checkedEntries?.includes(entryKeyCategory(category.id,i.id))).length;
    return done===active.length ? {text:`Completa (${done}/${active.length})`,cls:'done',done,total:active.length} : {text:`Pendiente (${done}/${active.length})`,cls:'pending',done,total:active.length};
  }

  function render(){
    if(!state.session){ renderLogin(); return; }
    const settings=getSettings();
    document.body.dataset.theme=settings.appearance==='light'?'light':'dark';
    const schedule=getSchedule(state.selectedDay); const ds=getDayState(state.selectedDay); const cats=categories();
    if(!state.bankCategoryId || !cats.some(c=>c.id===state.bankCategoryId)) state.bankCategoryId=cats[0]?.id||'';
    const assigned=(schedule.categoryIds||[]).map(getCategory).filter(Boolean);
    appRoot.innerHTML=`
      <div class="app-shell">
        <aside class="sidebar">
          <div class="brand"><img src="./icon-192.png" alt=""><div><h1>Nexit</h1><small>Preparación diaria</small></div></div>
          <nav class="day-nav">${DAYS.map(d=>dayButton(d)).join('')}</nav>
          <div class="sidebar-bottom">
            <button class="btn" data-action="open-settings">⚙ Ajustes</button>
            <button class="btn" data-action="sync-now">↻ Sincronizar</button>
            <div class="status-pill" data-sync-status>${syncStatusHtml()}</div>
          </div>
        </aside>
        <main class="main">
          <div class="mobile-days">${DAYS.map(d=>dayButton(d)).join('')}</div>
          <header class="topbar">
            <div><h2>${DAY_LABELS[state.selectedDay]}</h2><div class="muted">Preparación objetivo para ${DAY_LABELS[state.selectedDay].toLowerCase()}</div></div>
            <div class="actions"><button class="btn primary" data-action="open-reminder" data-day="${state.selectedDay}">🔔 Ver recordatorio</button><button class="btn" data-action="open-settings">⚙</button></div>
          </header>
          <section class="panel">
            <div class="section-head"><h3>Horario del recordatorio</h3><span class="muted">Se guarda automáticamente</span></div>
            <div class="grid two">
              <div class="field"><label>Mostrar el día</label><select class="select" data-field="show-on-day">${DAYS.map(d=>`<option value="${d}" ${schedule.showOnDay===d?'selected':''}>${DAY_LABELS[d]}</option>`).join('')}</select></div>
              <div class="field"><label>Hora</label><input class="input" type="time" value="${escapeHtml(schedule.showAt||'06:00')}" data-field="show-at"></div>
            </div>
          </section>
          <section class="panel">
            <div class="section-head"><h3>Banco global de categorías</h3></div>
            <div class="bank-row">
              <select class="select" data-field="bank-category">${cats.map(c=>`<option value="${escapeHtml(c.id)}" ${c.id===state.bankCategoryId?'selected':''}>${escapeHtml(c.name)}</option>`).join('')}</select>
              <button class="btn primary" data-action="add-category-to-day">Agregar al día</button>
              <button class="btn" data-action="create-category">Nueva</button>
              <button class="btn" data-action="manage-category">Editar</button>
            </div>
          </section>
          <section class="panel">
            <div class="section-head"><h3>Contenido del día</h3><div class="actions"><button class="btn small" data-action="activate-all">Activar todo</button><button class="btn small" data-action="deactivate-all">Desactivar todo</button></div></div>
            <div class="cards">
              ${assigned.length?assigned.map(c=>categoryCardHtml(c,ds)).join(''):'<div class="empty">No hay categorías asignadas a este día.</div>'}
              ${looseCardHtml(schedule,ds)}
            </div>
          </section>
        </main>
      </div>
      ${state.settingsOpen?settingsModalHtml(settings):''}
      ${state.reminderDay?reminderModalHtml(state.reminderDay):''}
    `;
  }

  function dayButton(day){ return `<button class="day-btn ${state.selectedDay===day?'active':''}" data-action="select-day" data-day="${day}">${DAY_LABELS[day]}</button>`; }

  function categoryCardHtml(category,ds){
    const p=categoryProgress(state.selectedDay,category); const collapsed=(ds.collapsedCategoryIds||[]).includes(category.id);
    const rows=collapsed?'':(category.items||[]).map(item=>{
      const key=entryKeyCategory(category.id,item.id); const checked=(ds.checkedEntries||[]).includes(key);
      const cls=!item.active?'inactive':checked?'done':'pending';
      return `<div class="item-row">
        <input type="checkbox" ${checked?'checked':''} ${!item.active?'disabled':''} data-field="check-entry" data-key="${escapeHtml(key)}">
        <input class="item-name ${cls}" value="${escapeHtml(item.name)}" data-field="category-item-name" data-category="${escapeHtml(category.id)}" data-item="${escapeHtml(item.id)}">
        <label class="active-label"><input type="checkbox" ${item.active?'checked':''} data-field="category-item-active" data-category="${escapeHtml(category.id)}" data-item="${escapeHtml(item.id)}"> Activo</label>
        <button class="btn small danger delete-item" data-action="delete-category-item" data-category="${escapeHtml(category.id)}" data-item="${escapeHtml(item.id)}">Eliminar</button>
      </div>`;
    }).join('');
    return `<article class="card"><div class="card-head">
      <button class="btn small" data-action="toggle-category" data-category="${escapeHtml(category.id)}">${collapsed?'Mostrar':'Ocultar'}</button>
      <h4>${escapeHtml(category.name)}</h4><span class="state ${p.cls}">${p.text}</span>
      <button class="btn small" data-action="rename-category" data-category="${escapeHtml(category.id)}">Editar</button>
      <button class="btn small" data-action="remove-category-from-day" data-category="${escapeHtml(category.id)}">Quitar</button>
      </div>${rows}${collapsed?'':`<div class="footer-actions"><button class="btn small" data-action="add-category-item" data-category="${escapeHtml(category.id)}">+ Añadir ítem</button></div>`}</article>`;
  }

  function looseCardHtml(schedule,ds){
    const rows=(schedule.items||[]).map(item=>{ const key=entryKeyLoose(item.id), checked=(ds.checkedEntries||[]).includes(key), cls=!item.active?'inactive':checked?'done':'pending'; return `<div class="item-row">
      <input type="checkbox" ${checked?'checked':''} ${!item.active?'disabled':''} data-field="check-entry" data-key="${escapeHtml(key)}">
      <input class="item-name ${cls}" value="${escapeHtml(item.name)}" data-field="loose-item-name" data-item="${item.id}">
      <label class="active-label"><input type="checkbox" ${item.active?'checked':''} data-field="loose-item-active" data-item="${item.id}"> Activo</label>
      <button class="btn small danger delete-item" data-action="delete-loose-item" data-item="${item.id}">Eliminar</button></div>`; }).join('');
    return `<article class="card"><div class="card-head"><h4>Ítems sueltos</h4></div>${rows||'<div class="muted" style="margin-top:10px">No hay ítems sueltos.</div>'}<div class="footer-actions"><button class="btn small" data-action="add-loose-item">+ Añadir ítem suelto</button></div></article>`;
  }

  function settingsModalHtml(settings){
    const backend=state.alarmBackend||{label:'Comprobando…',available:false};
    return `<div class="modal-backdrop" data-action="backdrop-settings"><section class="modal" role="dialog" aria-modal="true"><div class="section-head"><h3>Ajustes</h3><button class="btn small" data-action="close-settings">Cerrar</button></div>
      <div class="settings-list">
        <div class="setting-row"><div><strong>Recordatorios activos</strong><div class="muted">Control global de los avisos de Nexit.</div></div><input class="switch" type="checkbox" ${settings.appEnabled!==false?'checked':''} data-field="setting-app-enabled"></div>
        <div class="setting-row"><div><strong>Alarmas locales</strong><div class="muted">${escapeHtml(backend.label)}. Los horarios se sincronizan; cada dispositivo dispara su propia alarma.</div></div><input class="switch" type="checkbox" ${settings.alarmsEnabled!==false?'checked':''} data-field="setting-alarms-enabled"></div>
        <div class="setting-row"><div><strong>Motor de este dispositivo</strong><div class="muted">${backend.available?'Disponible y local.':'La web pura no garantiza alarmas con Nexit cerrado.'}</div></div><div class="actions"><button class="btn primary small" data-action="activate-local-alarms">Activar</button><button class="btn small" data-action="test-local-alarm">Probar 1 min</button></div></div>
        <div class="setting-row"><div><strong>Posposición</strong><div class="muted">Minutos al pulsar “Posponer”.</div></div><input class="input" style="width:110px" type="number" min="1" max="240" value="${Number(settings.snoozeMinutes)||10}" data-field="setting-snooze"></div>
        <div class="setting-row"><div><strong>Apariencia</strong></div><select class="select" style="width:150px" data-field="setting-appearance"><option value="light" ${settings.appearance==='light'?'selected':''}>Claro</option><option value="dark" ${settings.appearance!=='light'?'selected':''}>Oscuro</option></select></div>
        <div class="setting-row"><div><strong>Cuenta</strong><div class="muted">${escapeHtml(state.session.user.email||'')}</div></div><button class="btn danger" data-action="sign-out">Cerrar sesión</button></div>
      </div></section></div>`;
  }

  function reminderModalHtml(day){
    const schedule=getSchedule(day), ds=getDayState(day), assigned=(schedule.categoryIds||[]).map(getCategory).filter(Boolean);
    let total=0,done=0;
    const groups=[];
    for(const c of assigned){
      const active=(c.items||[]).filter(i=>i.active); if(!active.length)continue; total+=active.length;
      const rows=active.map(i=>{const key=entryKeyCategory(c.id,i.id),checked=(ds.checkedEntries||[]).includes(key); if(checked)done++; return `<div class="item-row"><input type="checkbox" ${checked?'checked':''} data-field="reminder-check" data-day="${day}" data-key="${escapeHtml(key)}"><div class="item-name ${checked?'done':'pending'}">${escapeHtml(i.name)}</div></div>`;}).join('');
      groups.push(`<div class="card"><div class="card-head"><h4>${escapeHtml(c.name)}</h4></div>${rows}</div>`);
    }
    const loose=(schedule.items||[]).filter(i=>i.active); if(loose.length){ total+=loose.length; const rows=loose.map(i=>{const key=entryKeyLoose(i.id),checked=(ds.checkedEntries||[]).includes(key); if(checked)done++; return `<div class="item-row"><input type="checkbox" ${checked?'checked':''} data-field="reminder-check" data-day="${day}" data-key="${escapeHtml(key)}"><div class="item-name ${checked?'done':'pending'}">${escapeHtml(i.name)}</div></div>`;}).join(''); groups.push(`<div class="card"><div class="card-head"><h4>Ítems sueltos</h4></div>${rows}</div>`); }
    return `<div class="modal-backdrop"><section class="modal reminder"><div class="reminder-title"><div><h3>Preparación para ${DAY_LABELS[day]}</h3><div class="count">${done}/${total} listos</div></div><button class="btn" data-action="close-reminder">Cerrar</button></div><div class="reminder-groups">${groups.join('')||'<div class="empty">No hay elementos activos para este día.</div>'}</div><div class="footer-actions"><button class="btn primary" data-action="snooze-reminder" data-day="${day}">Posponer ${Number(getSettings().snoozeMinutes)||10} min</button></div></section></div>`;
  }

  function renderLogin(){
    document.body.dataset.theme='dark';
    appRoot.innerHTML=`<div class="login-wrap"><section class="login-card"><div class="brand"><img src="./icon-192.png" alt=""><div><h1>Nexit</h1><small>Preparación diaria</small></div></div><h2>Iniciar sesión</h2><p>Usa la misma cuenta de tus otras aplicaciones sincronizadas.</p><form data-login-form><div class="field"><label>Correo</label><input class="input" type="email" name="email" autocomplete="email" required></div><div class="field"><label>Contraseña</label><input class="input" type="password" name="password" autocomplete="current-password" required></div>${state.loginError?`<div class="error">${escapeHtml(state.loginError)}</div>`:''}<button class="btn primary" type="submit">Entrar</button></form></section></div>`;
  }

  async function login(form){
    const fd=new FormData(form); state.loginError='';
    const {data,error}=await client.auth.signInWithPassword({email:String(fd.get('email')||'').trim(),password:String(fd.get('password')||'')});
    if(error){state.loginError=error.message;render();return;} state.session=data.session; await afterLogin();
  }

  async function afterLogin(){
    parseReminderFromUrl();
    state.syncState=navigator.onLine?'syncing':'offline'; render();
    await syncAll(false);
    await registerServiceWorker();
    await reconcileLocalAlarms(false);
  }

  function parseReminderFromUrl(){
    const u=new URL(location.href); const d=stripAccents(u.searchParams.get('reminder')||''); if(DAYS.includes(d))state.reminderDay=d;
  }
  function clearReminderUrl(){ const u=new URL(location.href); u.searchParams.delete('reminder'); history.replaceState({},'',u); }

  async function registerServiceWorker(){
    if('serviceWorker' in navigator){ try{ await navigator.serviceWorker.register('./sw.js',{scope:'./'}); }catch(e){console.warn('SW',e);} }
  }


  function toast(message){ clearTimeout(state.toastTimer); toastNode.textContent=message; toastNode.classList.add('show'); state.toastTimer=setTimeout(()=>toastNode.classList.remove('show'),2800); }

  function updateSchedule(patch){ const s={...getSchedule(state.selectedDay),...patch}; saveRecord('schedule',`schedule:${state.selectedDay}`,s); }
  function updateDayState(day,patch){ const ds={...getDayState(day),...patch,targetDay:day}; saveRecord('day_state',`state:${day}`,ds); }
  function updateSettings(patch){ const s={...getSettings(),...patch,updatedAt:nowIso()}; saveRecord('settings','settings:main',s); }

  function toggleChecked(day,key,value){ const ds=getDayState(day), set=new Set(ds.checkedEntries||[]); value?set.add(key):set.delete(key); updateDayState(day,{checkedEntries:[...set]}); }
  function removeCheckedKeys(predicate){ for(const day of DAYS){const ds=getDayState(day);const next=(ds.checkedEntries||[]).filter(k=>!predicate(k)); if(next.length!==(ds.checkedEntries||[]).length) updateDayState(day,{checkedEntries:next});} }

  appRoot.addEventListener('submit',e=>{ if(e.target.matches('[data-login-form]')){e.preventDefault();login(e.target);} });

  appRoot.addEventListener('click',async e=>{
    const b=e.target.closest('[data-action]'); if(!b)return; const action=b.dataset.action;
    try{
      if(action==='select-day'){state.selectedDay=b.dataset.day;persistLocal();render();}
      else if(action==='open-settings'){state.settingsOpen=true;state.alarmBackend=await window.NexitLocalAlarms.backend();render();}
      else if(action==='close-settings'){state.settingsOpen=false;render();}
      else if(action==='sync-now'){await syncAll(true);}
      else if(action==='open-reminder'){state.reminderDay=b.dataset.day;render();}
      else if(action==='close-reminder'){state.reminderDay=null;clearReminderUrl();render();}
      else if(action==='snooze-reminder'){const day=b.dataset.day, mins=Math.max(1,Number(getSettings().snoozeMinutes)||10);updateDayState(day,{snoozedUntil:new Date(Date.now()+mins*60000).toISOString()});state.reminderDay=null;clearReminderUrl();toast(`Recordatorio pospuesto ${mins} min.`);render();}
      else if(action==='create-category'){const name=prompt('Nombre de la nueva categoría:');if(!name?.trim())return;const id=uid('cat');saveRecord('category',id,{id,name:name.trim(),items:[]});state.bankCategoryId=id;}
      else if(action==='add-category-to-day'){if(!state.bankCategoryId)return;const s=getSchedule(state.selectedDay), ids=[...(s.categoryIds||[])];if(!ids.includes(state.bankCategoryId))ids.push(state.bankCategoryId);updateSchedule({categoryIds:ids});}
      else if(action==='manage-category'||action==='rename-category'){const id=b.dataset.category||state.bankCategoryId,c=getCategory(id);if(!c)return;const name=prompt('Nombre de la categoría:',c.name);if(name?.trim())saveRecord('category',id,{...c,name:name.trim()});}
      else if(action==='remove-category-from-day'){const id=b.dataset.category,s=getSchedule(state.selectedDay);updateSchedule({categoryIds:(s.categoryIds||[]).filter(x=>x!==id)});}
      else if(action==='toggle-category'){const id=b.dataset.category,ds=getDayState(state.selectedDay),set=new Set(ds.collapsedCategoryIds||[]);set.has(id)?set.delete(id):set.add(id);updateDayState(state.selectedDay,{collapsedCategoryIds:[...set]});}
      else if(action==='add-category-item'){const id=b.dataset.category,c=getCategory(id),name=prompt('Nombre del nuevo ítem:');if(!c||!name?.trim())return;const item={id:uid(`${id}_item`),name:name.trim(),active:true};saveRecord('category',id,{...c,items:[...(c.items||[]),item]});}
      else if(action==='delete-category-item'){const id=b.dataset.category,itemId=b.dataset.item,c=getCategory(id);if(!c||!confirm('¿Eliminar este ítem?'))return;saveRecord('category',id,{...c,items:(c.items||[]).filter(i=>i.id!==itemId)});removeCheckedKeys(k=>k===entryKeyCategory(id,itemId));}
      else if(action==='delete-loose-item'){const itemId=b.dataset.item,s=getSchedule(state.selectedDay);if(!confirm('¿Eliminar este ítem suelto?'))return;updateSchedule({items:(s.items||[]).filter(i=>String(i.id)!==String(itemId))});removeCheckedKeys(k=>k===entryKeyLoose(itemId));}
      else if(action==='add-loose-item'){const name=prompt('Nombre del nuevo ítem suelto:');if(!name?.trim())return;const s=getSchedule(state.selectedDay), max=Math.max(0,...(s.items||[]).map(i=>Number(i.id)||0));updateSchedule({items:[...(s.items||[]),{id:max+1,name:name.trim(),active:true}]});}
      else if(action==='activate-all'||action==='deactivate-all'){const value=action==='activate-all',s=getSchedule(state.selectedDay);updateSchedule({items:(s.items||[]).map(i=>({...i,active:value}))});for(const id of s.categoryIds||[]){const c=getCategory(id);if(c)saveRecord('category',id,{...c,items:(c.items||[]).map(i=>({...i,active:value}))},{render:false});}render();scheduleSync();}
      else if(action==='activate-local-alarms'){await window.NexitLocalAlarms.activate();await reconcileLocalAlarms(true);}
      else if(action==='test-local-alarm'){await window.NexitLocalAlarms.activate();await reconcileLocalAlarms(false);await window.NexitLocalAlarms.test();toast('Prueba local programada para dentro de 1 minuto.');}
      else if(action==='sign-out'){await flushDirty();await client.auth.signOut();state.session=null;state.settingsOpen=false;render();}
      else if(action==='backdrop-settings' && e.target===b){state.settingsOpen=false;render();}
    }catch(err){console.error(err);toast(err.message||String(err));}
  });

  appRoot.addEventListener('change',e=>{
    const el=e.target, f=el.dataset.field; if(!f)return;
    if(f==='bank-category'){state.bankCategoryId=el.value;return;}
    if(f==='show-on-day')updateSchedule({showOnDay:el.value});
    else if(f==='show-at')updateSchedule({showAt:el.value||'06:00'});
    else if(f==='check-entry')toggleChecked(state.selectedDay,el.dataset.key,el.checked);
    else if(f==='reminder-check')toggleChecked(el.dataset.day,el.dataset.key,el.checked);
    else if(f==='category-item-active'){const c=getCategory(el.dataset.category);if(!c)return;saveRecord('category',c.id,{...c,items:(c.items||[]).map(i=>i.id===el.dataset.item?{...i,active:el.checked}:i)});}
    else if(f==='category-item-name'){const c=getCategory(el.dataset.category);if(!c)return;const name=el.value.trim();if(name)saveRecord('category',c.id,{...c,items:(c.items||[]).map(i=>i.id===el.dataset.item?{...i,name}:i)});}
    else if(f==='loose-item-active'){const s=getSchedule(state.selectedDay),id=String(el.dataset.item);updateSchedule({items:(s.items||[]).map(i=>String(i.id)===id?{...i,active:el.checked}:i)});}
    else if(f==='loose-item-name'){const s=getSchedule(state.selectedDay),id=String(el.dataset.item),name=el.value.trim();if(name)updateSchedule({items:(s.items||[]).map(i=>String(i.id)===id?{...i,name}:i)});}
    else if(f==='setting-app-enabled')updateSettings({appEnabled:el.checked});
    else if(f==='setting-alarms-enabled')updateSettings({alarmsEnabled:el.checked});
    else if(f==='setting-snooze')updateSettings({snoozeMinutes:Math.max(1,Number(el.value)||10)});
    else if(f==='setting-appearance')updateSettings({appearance:el.value==='light'?'light':'dark'});
  });

  window.addEventListener('online',()=>{state.syncState='pending';syncAll(false)}); window.addEventListener('offline',()=>{state.syncState='offline';renderStatusOnly()});
  document.addEventListener('visibilitychange',()=>{if(!document.hidden)syncAll(false)});
  setInterval(()=>syncAll(false),20000);

  async function init(){
    loadLocal();
    await registerServiceWorker();
    const {data:{session}}=await client.auth.getSession(); state.session=session;
    client.auth.onAuthStateChange((_event,session)=>{state.session=session;if(!session)render();});
    if(session) await afterLogin(); else render();
  }
  init();
})();

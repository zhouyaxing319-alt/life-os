'use strict';
const $ = id => document.getElementById(id);
const dbReady = new Promise((resolve, reject) => {
  const request = indexedDB.open('lifeos-mobile-records', 2);
  request.onupgradeneeded = () => { const db=request.result; if(!db.objectStoreNames.contains('activities'))db.createObjectStore('activities', {keyPath:'id'}); if(!db.objectStoreNames.contains('sessions'))db.createObjectStore('sessions', {keyPath:'id'}); if(!db.objectStoreNames.contains('reflections'))db.createObjectStore('reflections', {keyPath:'date'}); if(!db.objectStoreNames.contains('audit'))db.createObjectStore('audit', {keyPath:'id'}); };
  request.onsuccess = () => resolve(request.result);
  request.onerror = () => reject(request.error);
});
const uuid = () => crypto.randomUUID();
const now = () => new Date().toISOString();
const today = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`; };
let busy = false;
function msg(text, error=false) { $('message').textContent=text; $('message').classList.toggle('error',error); }
function requestValue(request) { return new Promise((resolve,reject) => { request.onsuccess=()=>resolve(request.result); request.onerror=()=>reject(request.error); }); }
async function read(store) { const db=await dbReady; return requestValue(db.transaction(store).objectStore(store).getAll()); }
async function readSnapshot() { const db=await dbReady;const tx=db.transaction(['activities','sessions','reflections','audit'],'readonly');const names=['activities','sessions','reflections','audit'];const values=await Promise.all(names.map(name=>requestValue(tx.objectStore(name).getAll())));return Object.fromEntries(names.map((name,i)=>[name,values[i]])); }
async function change(fn) {
  if (busy) return false;
  busy=true;
  try {
    const db=await dbReady;
    await new Promise((resolve,reject) => {
      const tx=db.transaction(['activities','sessions','reflections','audit'],'readwrite');
      tx.oncomplete=resolve; tx.onerror=()=>reject(tx.error); tx.onabort=()=>reject(tx.error || new Error('保存失败'));
      try { fn(tx); } catch (error) { tx.abort(); reject(error); }
    });
    await render();
    return true;
  } catch (error) { msg('保存失败，请检查手机存储空间。',true); return false; }
  finally { busy=false; }
}
function stopOpen(tx, at, excludeSessionId=null, onlyActivityId=null) {
  const sessions=tx.objectStore('sessions'), activities=tx.objectStore('activities');
  const cursor=sessions.openCursor();
  cursor.onsuccess=()=>{ const c=cursor.result; if (!c) return; const session=c.value;
    if (!session.endedAt && session.id!==excludeSessionId && (!onlyActivityId || session.activityId===onlyActivityId)) { session.endedAt=at; c.update(session); const req=activities.get(session.activityId); req.onsuccess=()=>{ if(req.result && req.result.status==='active'){const a=req.result;a.status='paused';a.updatedAt=at;activities.put(a);} }; }
    c.continue();
  };
}
function formatDuration(ms) { const s=Math.max(0,Math.floor(ms/1000)); const h=Math.floor(s/3600),m=Math.floor(s%3600/60),sec=s%60; return h ? `${h}小时 ${m}分 ${sec}秒` : `${m}分 ${sec}秒`; }
function node(tag,text,cls) { const n=document.createElement(tag); if(text!==undefined)n.textContent=text;if(cls)n.className=cls;return n; }
function button(text,cls,click) { const b=node('button',text,cls);b.type='button';b.addEventListener('click',click);return b; }
function elapsed(a, sessions) { return sessions.filter(s=>s.activityId===a.id).reduce((sum,s)=>sum+Math.max(0,(s.endedAt?Date.parse(s.endedAt):Date.now())-Date.parse(s.startedAt)),0); }
function todayElapsed(a,sessions) { const start=new Date();start.setHours(0,0,0,0);const end=new Date(start);end.setDate(end.getDate()+1);return sessions.filter(s=>s.activityId===a.id).reduce((total,s)=>total+Math.max(0,Math.min(s.endedAt?Date.parse(s.endedAt):Date.now(),end.getTime())-Math.max(Date.parse(s.startedAt),start.getTime())),0); }
function localInput(iso) { const date=new Date(iso),pad=n=>String(n).padStart(2,'0');return `${date.getFullYear()}-${pad(date.getMonth()+1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`; }
function sessionEditor(activity,sessions) {
  const details=node('details'),summary=node('summary','查看和修改时间','meta');details.append(summary);
  const items=sessions.filter(s=>s.activityId===activity.id).sort((a,b)=>a.startedAt.localeCompare(b.startedAt));
  for(const session of items){const box=node('div',undefined,'result-form');if(!session.endedAt){box.append(node('p',`进行中：${new Date(session.startedAt).toLocaleString('zh-CN')} 开始。请先暂停或结束，再修改时间。`,'meta'));details.append(box);continue;}
    const form=node('form');const startLabel=node('label','开始时间'),start=node('input');start.type='datetime-local';start.step='1';start.required=true;start.value=localInput(session.startedAt);startLabel.append(start);
    const endLabel=node('label','结束时间'),end=node('input');end.type='datetime-local';end.step='1';end.required=true;end.value=localInput(session.endedAt);endLabel.append(end);const save=node('button','保存时间','secondary');save.type='submit';form.append(startLabel,endLabel,save);form.addEventListener('submit',e=>{e.preventDefault();const from=new Date(start.value),to=new Date(end.value);if(!Number.isFinite(from.getTime())||!Number.isFinite(to.getTime())||to<=from||to.getTime()>Date.now()){msg('时间不正确：结束时间须晚于开始时间，且不能在未来。',true);return;}const fromIso=from.toISOString(),toIso=to.toISOString();let issue='';change(tx=>{const store=tx.objectStore('sessions'),req=store.getAll();req.onsuccess=()=>{const all=req.result,old=all.find(s=>s.id===session.id);if(!old||!old.endedAt){issue='记录状态已变化，请重新打开页面。';tx.abort();return;}if(all.some(s=>s.id!==old.id&&Date.parse(s.startedAt)<to.getTime()&&(s.endedAt?Date.parse(s.endedAt):Date.now())>from.getTime())){issue='这段时间与另一项活动重叠，请调整后再保存。';tx.abort();return;}const updated={...old,startedAt:fromIso,endedAt:toIso};store.put(updated);tx.objectStore('audit').add({id:uuid(),kind:'session_time',changedAt:now(),before:old,after:updated});};}).then(ok=>{if(ok)msg('时间已更新，原时间保留在手机修改历史中。');else if(issue)msg(issue,true);});});box.append(form);details.append(box);
  }return details;
}
function endActivity(id, finish) { const at=now(); change(tx=>{ stopOpen(tx,at,null,id); const store=tx.objectStore('activities'),req=store.get(id); req.onsuccess=()=>{const a=req.result;if(a){a.status=finish?'completed':'paused';a.updatedAt=at;store.put(a);}}; }).then(ok=>{if(ok)msg(finish?'活动已结束，可以补充结果。':'活动已暂停，之后可以继续。');}); }
function resume(id) { const at=now(),sessionId=uuid(); change(tx=>{stopOpen(tx,at,sessionId);const store=tx.objectStore('activities'),req=store.get(id);req.onsuccess=()=>{const a=req.result;if(!a||a.status!=='paused')return;a.status='active';a.updatedAt=at;store.put(a);tx.objectStore('sessions').add({id:sessionId,activityId:id,startedAt:at,endedAt:null});};}).then(ok=>{if(ok)msg('已继续活动。');}); }
async function render() {
  const [activities,sessions,reflections]=await Promise.all([read('activities'),read('sessions'),read('reflections')]);
  activities.sort((a,b)=>b.createdAt.localeCompare(a.createdAt));
  const active=activities.find(a=>a.status==='active'); const current=$('current');current.replaceChildren();
  const totals=$('today-summary');totals.replaceChildren();const todayActivities=activities.map(a=>({activity:a,ms:todayElapsed(a,sessions)})).filter(x=>x.ms>0).sort((a,b)=>b.ms-a.ms);if(!todayActivities.length)totals.append(node('p','今天还没有时间记录。','empty'));for(const entry of todayActivities){const row=node('div',undefined,'item-title');row.append(node('strong',entry.activity.name),node('span',formatDuration(entry.ms),'pill'));totals.append(row);}
  $('active-indicator').textContent=active?'● 进行中':'● 等待开始';
  if(!active) current.append(node('p','现在没有进行中的活动。','empty'));
  else { current.append(node('div',active.name,'activity-name'));const timer=node('div',formatDuration(elapsed(active,sessions)),'timer');timer.dataset.timerId=active.id;current.append(timer,node('p',`${active.category||'未分类'} · 已记录在手机`, 'meta'));const actions=node('div',undefined,'actions');actions.append(button('暂停','secondary',()=>endActivity(active.id,false)),button('结束活动','quiet',()=>endActivity(active.id,true)));current.append(actions); }
  $('count').textContent=`${activities.length} 项`;const list=$('activities');list.replaceChildren();
  if(!activities.length) list.append(node('p','还没有活动，先开始一项吧。','empty'));
  for(const a of activities){const item=node('article',undefined,'item'),head=node('div',undefined,'item-title');head.append(node('strong',a.name),node('span',({active:'进行中',paused:'已暂停',completed:'已结束'})[a.status]||a.status,'pill'));item.append(head);
    const parts=[a.category||'未分类',`累计 ${formatDuration(elapsed(a,sessions))}`];if(a.plannedMinutes)parts.push(`预计 ${a.plannedMinutes} 分钟`);item.append(node('p',parts.join(' · '),'meta'));if(a.goal)item.append(node('p',`目标：${a.goal}`,'meta'));
    const actions=node('div',undefined,'actions');if(a.status==='paused'){actions.append(button('继续','secondary',()=>resume(a.id)),button('结束','quiet',()=>endActivity(a.id,true)));}item.append(actions,sessionEditor(a,sessions));
    const details=node('details'),summary=node('summary','结果与证据','meta');details.append(summary);const form=node('form',undefined,'result-form');const result=node('textarea');result.placeholder='最终结果';result.rows=2;result.maxLength=5000;result.value=a.result||'';const evidence=node('textarea');evidence.placeholder='验证证据';evidence.rows=2;evidence.maxLength=5000;evidence.value=a.evidence||'';const save=node('button','保存结果','secondary');save.type='submit';form.append(result,evidence,save);form.addEventListener('submit',e=>{e.preventDefault();const resultText=result.value,evidenceText=evidence.value;change(tx=>{const store=tx.objectStore('activities'),req=store.get(a.id);req.onsuccess=()=>{const activity=req.result;if(activity){activity.result=resultText;activity.evidence=evidenceText;activity.updatedAt=now();store.put(activity);}};}).then(ok=>{if(ok)msg('结果和证据已保存在手机。');});});details.append(form);item.append(details);list.append(item);
  }
  if(document.activeElement!==$('reflection')) $('reflection').value=reflections.find(r=>r.date===today())?.content||'';
}
$('start-form').addEventListener('submit',e=>{e.preventDefault();const form=e.currentTarget,at=now(),name=form.elements.name.value.trim();if(!name)return;const planned=form.elements.planned.value,sessionId=uuid();const activity={id:uuid(),name,category:form.elements.category.value.trim(),plannedMinutes:planned?Number(planned):null,goal:form.elements.goal.value.trim(),status:'active',createdAt:at,updatedAt:at};change(tx=>{stopOpen(tx,at,sessionId);tx.objectStore('activities').add(activity);tx.objectStore('sessions').add({id:sessionId,activityId:activity.id,startedAt:at,endedAt:null});}).then(ok=>{if(ok){form.reset();msg('活动已开始，记录保存在手机。');}});});
$('save-reflection').addEventListener('click',()=>{const content=$('reflection').value;change(tx=>tx.objectStore('reflections').put({date:today(),content,updatedAt:now()})).then(ok=>{if(ok)msg('心得已保存在手机。');});});
$('catchup-form').addEventListener('submit',e=>{e.preventDefault();const form=e.currentTarget,name=form.elements.name.value.trim(),from=new Date(form.elements.start.value),to=new Date(form.elements.end.value);if(!name||!Number.isFinite(from.getTime())||!Number.isFinite(to.getTime())||to<=from||to.getTime()>Date.now()){msg('请填写活动名称和有效的过去时间。',true);return;}const at=now(),activityId=uuid(),sessionId=uuid();let issue='';change(tx=>{const store=tx.objectStore('sessions'),req=store.getAll();req.onsuccess=()=>{if(req.result.some(s=>Date.parse(s.startedAt)<to.getTime()&&(s.endedAt?Date.parse(s.endedAt):Date.now())>from.getTime())){issue='补录时间与其他活动重叠，请调整后再保存。';tx.abort();return;}const activity={id:activityId,name,category:form.elements.category.value.trim(),plannedMinutes:null,goal:'',status:'completed',createdAt:at,updatedAt:at};const session={id:sessionId,activityId,startedAt:from.toISOString(),endedAt:to.toISOString()};tx.objectStore('activities').add(activity);store.add(session);tx.objectStore('audit').add({id:uuid(),kind:'manual_session',changedAt:at,after:session});};}).then(ok=>{if(ok){form.reset();msg('补录已保存在手机。');}else if(issue)msg(issue,true);});});
$('export').addEventListener('click',async()=>{try{const data=await readSnapshot();const file=new Blob([JSON.stringify({format:'lifeos-mobile-backup',version:2,exportedAt:now(),...data},null,2)],{type:'application/json'});const url=URL.createObjectURL(file),a=document.createElement('a');a.href=url;a.download=`lifeos-${today()}.json`;document.body.append(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),60000);msg('已请求导出，请检查手机的下载或文件位置。');}catch{msg('导出失败，请重试。',true);}});
$('restore').addEventListener('click',async()=>{const file=$('restore-file').files[0];if(!file||file.size>20*1024*1024){msg('请选择不超过 20 MB 的记录文件。',true);return;}try{const data=JSON.parse(await file.text());if(data.format!=='lifeos-mobile-backup'||![1,2].includes(data.version)||!['activities','sessions','reflections'].every(k=>Array.isArray(data[k]))||!Array.isArray(data.audit||[]))throw Error();let reason='';const ok=await change(tx=>{const stores=['activities','sessions','reflections','audit'];let remaining=stores.length,occupied=false;for(const name of stores){const count=tx.objectStore(name).count();count.onsuccess=()=>{if(count.result)occupied=true;if(--remaining)return;if(occupied){reason='手机已有记录，为避免覆盖，不能直接恢复。';tx.abort();return;}try{for(const name of stores)for(const item of (data[name]||[]))tx.objectStore(name).add(item);}catch{reason='文件内容不正确，未恢复。';tx.abort();}};}});if(ok)msg('记录已恢复到手机。');else if(reason)msg(reason,true);}catch{msg('文件无法读取或格式不正确，未恢复。',true);}});
dbReady.then(render).catch(()=>msg('手机存储不可用，请检查浏览器设置。',true));
setInterval(async()=>{const timer=document.querySelector('[data-timer-id]');if(!timer)return;try{const [activities,sessions]=await Promise.all([read('activities'),read('sessions')]);const a=activities.find(x=>x.id===timer.dataset.timerId);if(a)timer.textContent=formatDuration(elapsed(a,sessions));}catch{}},1000);
if('serviceWorker' in navigator) navigator.serviceWorker.register('./sw.js').catch(()=>{});

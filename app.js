'use strict';
const $ = id => document.getElementById(id);
const dbReady = new Promise((resolve, reject) => {
  const request = indexedDB.open('lifeos-mobile-records', 1);
  request.onupgradeneeded = () => { request.result.createObjectStore('activities', {keyPath:'id'}); request.result.createObjectStore('sessions', {keyPath:'id'}); request.result.createObjectStore('reflections', {keyPath:'date'}); };
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
async function change(fn) {
  if (busy) return false;
  busy=true;
  try {
    const db=await dbReady;
    await new Promise((resolve,reject) => {
      const tx=db.transaction(['activities','sessions','reflections'],'readwrite');
      tx.oncomplete=resolve; tx.onerror=()=>reject(tx.error); tx.onabort=()=>reject(tx.error || new Error('保存失败'));
      try { fn(tx); } catch (error) { tx.abort(); reject(error); }
    });
    await render();
    return true;
  } catch (error) { msg('保存失败，请检查手机存储空间。',true); return false; }
  finally { busy=false; }
}
function stopOpen(tx, at, excludeSessionId=null) {
  const sessions=tx.objectStore('sessions'), activities=tx.objectStore('activities');
  const cursor=sessions.openCursor();
  cursor.onsuccess=()=>{ const c=cursor.result; if (!c) return; const session=c.value;
    if (!session.endedAt && session.id!==excludeSessionId) { session.endedAt=at; c.update(session); const req=activities.get(session.activityId); req.onsuccess=()=>{ if(req.result && req.result.status==='active'){const a=req.result;a.status='paused';a.updatedAt=at;activities.put(a);} }; }
    c.continue();
  };
}
function formatDuration(ms) { const s=Math.max(0,Math.floor(ms/1000)); const h=Math.floor(s/3600),m=Math.floor(s%3600/60),sec=s%60; return h ? `${h}小时 ${m}分 ${sec}秒` : `${m}分 ${sec}秒`; }
function node(tag,text,cls) { const n=document.createElement(tag); if(text!==undefined)n.textContent=text;if(cls)n.className=cls;return n; }
function button(text,cls,click) { const b=node('button',text,cls);b.type='button';b.addEventListener('click',click);return b; }
function elapsed(a, sessions) { return sessions.filter(s=>s.activityId===a.id).reduce((sum,s)=>sum+Math.max(0,(s.endedAt?Date.parse(s.endedAt):Date.now())-Date.parse(s.startedAt)),0); }
function endActivity(id, finish) { const at=now(); change(tx=>{ stopOpen(tx,at); const store=tx.objectStore('activities'),req=store.get(id); req.onsuccess=()=>{const a=req.result;if(a){a.status=finish?'completed':'paused';a.updatedAt=at;store.put(a);}}; }).then(ok=>{if(ok)msg(finish?'活动已结束，可以补充结果。':'活动已暂停，之后可以继续。');}); }
function resume(id) { const at=now(),sessionId=uuid(); change(tx=>{stopOpen(tx,at,sessionId);const store=tx.objectStore('activities'),req=store.get(id);req.onsuccess=()=>{const a=req.result;if(!a||a.status!=='paused')return;a.status='active';a.updatedAt=at;store.put(a);tx.objectStore('sessions').add({id:sessionId,activityId:id,startedAt:at,endedAt:null});};}).then(ok=>{if(ok)msg('已继续活动。');}); }
async function render() {
  const [activities,sessions,reflections]=await Promise.all([read('activities'),read('sessions'),read('reflections')]);
  activities.sort((a,b)=>b.createdAt.localeCompare(a.createdAt));
  const active=activities.find(a=>a.status==='active'); const current=$('current');current.replaceChildren();
  $('active-indicator').textContent=active?'● 进行中':'● 等待开始';
  if(!active) current.append(node('p','现在没有进行中的活动。','empty'));
  else { current.append(node('div',active.name,'activity-name'));const timer=node('div',formatDuration(elapsed(active,sessions)),'timer');timer.dataset.timerId=active.id;current.append(timer,node('p',`${active.category||'未分类'} · 已记录在手机`, 'meta'));const actions=node('div',undefined,'actions');actions.append(button('暂停','secondary',()=>endActivity(active.id,false)),button('结束活动','quiet',()=>endActivity(active.id,true)));current.append(actions); }
  $('count').textContent=`${activities.length} 项`;const list=$('activities');list.replaceChildren();
  if(!activities.length) list.append(node('p','还没有活动，先开始一项吧。','empty'));
  for(const a of activities){const item=node('article',undefined,'item'),head=node('div',undefined,'item-title');head.append(node('strong',a.name),node('span',({active:'进行中',paused:'已暂停',completed:'已结束'})[a.status]||a.status,'pill'));item.append(head);
    const parts=[a.category||'未分类',`累计 ${formatDuration(elapsed(a,sessions))}`];if(a.plannedMinutes)parts.push(`预计 ${a.plannedMinutes} 分钟`);item.append(node('p',parts.join(' · '),'meta'));if(a.goal)item.append(node('p',`目标：${a.goal}`,'meta'));
    const actions=node('div',undefined,'actions');if(a.status==='paused'){actions.append(button('继续','secondary',()=>resume(a.id)),button('结束','quiet',()=>endActivity(a.id,true)));}item.append(actions);
    const details=node('details'),summary=node('summary','结果与证据','meta');details.append(summary);const form=node('form',undefined,'result-form');const result=node('textarea');result.placeholder='最终结果';result.rows=2;result.maxLength=5000;result.value=a.result||'';const evidence=node('textarea');evidence.placeholder='验证证据';evidence.rows=2;evidence.maxLength=5000;evidence.value=a.evidence||'';const save=node('button','保存结果','secondary');save.type='submit';form.append(result,evidence,save);form.addEventListener('submit',e=>{e.preventDefault();const resultText=result.value,evidenceText=evidence.value;change(tx=>{const store=tx.objectStore('activities'),req=store.get(a.id);req.onsuccess=()=>{const activity=req.result;if(activity){activity.result=resultText;activity.evidence=evidenceText;activity.updatedAt=now();store.put(activity);}};}).then(ok=>{if(ok)msg('结果和证据已保存在手机。');});});details.append(form);item.append(details);list.append(item);
  }
  if(document.activeElement!==$('reflection')) $('reflection').value=reflections.find(r=>r.date===today())?.content||'';
}
$('start-form').addEventListener('submit',e=>{e.preventDefault();const form=e.currentTarget,at=now(),name=form.elements.name.value.trim();if(!name)return;const planned=form.elements.planned.value,sessionId=uuid();const activity={id:uuid(),name,category:form.elements.category.value.trim(),plannedMinutes:planned?Number(planned):null,goal:form.elements.goal.value.trim(),status:'active',createdAt:at,updatedAt:at};change(tx=>{stopOpen(tx,at,sessionId);tx.objectStore('activities').add(activity);tx.objectStore('sessions').add({id:sessionId,activityId:activity.id,startedAt:at,endedAt:null});}).then(ok=>{if(ok){form.reset();msg('活动已开始，记录保存在手机。');}});});
$('save-reflection').addEventListener('click',()=>{const content=$('reflection').value;change(tx=>tx.objectStore('reflections').put({date:today(),content,updatedAt:now()})).then(ok=>{if(ok)msg('心得已保存在手机。');});});
dbReady.then(render).catch(()=>msg('手机存储不可用，请检查浏览器设置。',true));
setInterval(async()=>{const timer=document.querySelector('[data-timer-id]');if(!timer)return;try{const [activities,sessions]=await Promise.all([read('activities'),read('sessions')]);const a=activities.find(x=>x.id===timer.dataset.timerId);if(a)timer.textContent=formatDuration(elapsed(a,sessions));}catch{}},1000);
if('serviceWorker' in navigator) navigator.serviceWorker.register('./sw.js').catch(()=>{});

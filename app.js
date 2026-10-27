'use strict';
const ENDPOINT = 'https://fbtrxymjdgrysfclqsaz.supabase.co';
const PUBLIC_KEY = 'sb_publishable_q5Jns_kZYfOaODDluleOUg_ntqML3tY';
const el = id => document.getElementById(id);
let currentSession = null;
let indexedDBReady;

function openDatabase() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open('lifeos-independent-test', 1);
    request.onupgradeneeded = () => request.result.createObjectStore('events', {keyPath: 'operation_id'});
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}
async function allEvents() {
  const db = await indexedDBReady;
  return new Promise((resolve, reject) => {
    const req = db.transaction('events', 'readonly').objectStore('events').getAll();
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}
async function saveEvent(event) {
  const db = await indexedDBReady;
  return new Promise((resolve, reject) => {
    const tx = db.transaction('events', 'readwrite');
    tx.objectStore('events').put(event);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error || new Error('本地保存失败'));
  });
}
function message(text, error = false) {
  el('message').textContent = text;
  el('message').classList.toggle('error', error);
}
function updateNetwork() { el('network-state').textContent = navigator.onLine ? '网络可用' : '当前离线'; }
function headers(token) {
  return {'apikey': PUBLIC_KEY, 'Authorization': 'Bearer ' + token, 'Content-Type': 'application/json'};
}
async function render() {
  const events = await allEvents();
  events.sort((a, b) => b.created_at.localeCompare(a.created_at));
  el('record-count').textContent = `${events.length} 条`;
  el('records').replaceChildren();
  if (!events.length) {
    const empty = document.createElement('p'); empty.className = 'empty'; empty.textContent = '还没有测试记录'; el('records').append(empty);
  }
  const labels = {local: '已存手机／浏览器', uploaded: '已上传，等待电脑', saved_pending: '已存电脑，等待清理', completed: '已存电脑，中转已清理'};
  for (const event of events) {
    const row = document.createElement('div'); row.className = 'record';
    const left = document.createElement('div');
    const name = document.createElement('strong'); name.textContent = event.payload.name;
    const time = document.createElement('small'); time.textContent = new Date(event.created_at).toLocaleString('zh-CN');
    left.append(name, time);
    const state = document.createElement('span'); state.className = 'record-status'; state.textContent = labels[event.status] || '状态未知';
    row.append(left, state); el('records').append(row);
  }

}

el('login-form').addEventListener('submit', async event => {
  event.preventDefault();
  const form = event.currentTarget;
  const email = form.elements.email.value.trim();
  const password = form.elements.password.value;
  el('login-button').disabled = true;
  try {
    const response = await fetch(`${ENDPOINT}/auth/v1/token?grant_type=password`, {method:'POST', headers: {'apikey':PUBLIC_KEY, 'Content-Type':'application/json'}, body:JSON.stringify({email, password})});
    const result = await response.json();
    if (!response.ok || !result.access_token || !result.user?.id) throw new Error('登录失败，请检查邮箱和密码');
    currentSession = {token:result.access_token, owner:result.user.id};
    form.reset(); form.hidden = true; el('logout-button').hidden = false;
    el('login-state').textContent = '已登录';
    message('登录成功。现在可以生成并上传一条虚拟记录。');
  } catch (error) { message(error.message || '登录失败，请检查网络', true); }
  finally { form.elements.password.value = ''; el('login-button').disabled = false; }
});
el('logout-button').addEventListener('click', () => {
  currentSession = null; el('login-form').hidden = false; el('logout-button').hidden = true; el('login-state').textContent = '未登录';
  message('已从本次测试退出。');
});
el('create-button').addEventListener('click', async () => {
  try {
    const now = new Date();
    const event = {operation_id:crypto.randomUUID(), entity_id:crypto.randomUUID(), entity_version:1, entity_type:'lifeos_test_activity', created_at:now.toISOString(), status:'local', payload:{name:'模拟学习 JavaScript', planned_minutes:60, actual_minutes:30, ended_at:now.toISOString(), test_only:true}};
    await saveEvent(event); await render(); message('虚拟记录已保存在当前浏览器。');
  } catch { message('本地保存失败，请检查浏览器存储空间。', true); }
});
el('upload-button').addEventListener('click', async () => {
  if (!currentSession) return message('请先登录 Life OS 账户。', true);
  const button = el('upload-button'); button.disabled = true;
  try {
    const pending = (await allEvents()).filter(item => item.status === 'local');
    if (!pending.length) return message('没有等待上传的测试记录。');
    for (const item of pending) {
      const record = {operation_id:item.operation_id, owner_id:currentSession.owner, entity_type:item.entity_type, entity_id:item.entity_id, entity_version:item.entity_version, payload:item.payload};
      const response = await fetch(`${ENDPOINT}/rest/v1/relay_inbox`, {method:'POST', headers:{...headers(currentSession.token), 'Prefer':'return=minimal'}, body:JSON.stringify(record)});
      if (response.status === 409) {
        const check = await fetch(`${ENDPOINT}/rest/v1/relay_inbox?operation_id=eq.${encodeURIComponent(item.operation_id)}&select=operation_id,owner_id,entity_id,entity_version,entity_type,payload`, {headers:headers(currentSession.token)});
        const rows = await check.json();
        if (!check.ok || rows.length !== 1 || rows[0].owner_id !== record.owner_id || rows[0].entity_id !== record.entity_id || rows[0].entity_version !== record.entity_version || rows[0].entity_type !== record.entity_type || JSON.stringify(rows[0].payload, Object.keys(rows[0].payload).sort()) !== JSON.stringify(record.payload, Object.keys(record.payload).sort())) throw new Error('重复编号的记录不一致，请停止测试');
      } else if (!response.ok) throw new Error(response.status === 401 ? '登录已失效，请重新登录' : '上传失败，记录仍保存在本地');
      item.status = 'uploaded'; await saveEvent(item);
    }
    await render(); message(`已上传 ${pending.length} 条测试记录，等待电脑接收。`);
  } catch (error) { message(error.message || '上传失败，记录仍保存在本地。', true); }
  finally { button.disabled = false; }
});
window.addEventListener('online', updateNetwork); window.addEventListener('offline', updateNetwork);
indexedDBReady = openDatabase(); updateNetwork();
indexedDBReady.then(render).catch(() => message('浏览器存储不可用，无法进行测试。', true));

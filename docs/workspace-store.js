// One storage contract for the personal board (GitHub Pages, IndexedDB) and the team server (server/, /api/*).
// Address of the deployed team server; leave empty until it is published (the "team mode" links stay hidden).
export const TEAM_URL='https://zadachimantckd.ru';
// Team mode = this page is served by the team server (PHP hosting). GitHub Pages and plain static hosting answer 404 on /api/me.
// On the team domain itself never fall back to the personal board: explain what is wrong instead, so the login screen is not silently skipped.
const teamHost=TEAM_URL?new URL(TEAM_URL).hostname:'';
const onTeamHost=!!teamHost&&location.hostname.replace(/^www\./,'')===teamHost;
const broken=why=>onTeamHost?{team:true,serverError:why}:null;
async function detectTeam(){if(location.protocol==='file:'||/\.github\.io$/.test(location.hostname))return null;let r;try{r=await fetch('/api/me',{cache:'no-store',credentials:'same-origin'})}catch{return broken('Не удалось связаться с сервером сайта. Проверьте интернет и обновите страницу.')}
  if(r.status===404)return broken('Сервер не нашёл адрес /api/me. Похоже, на хостинг не попали папка api или файл .htaccess. Запустите в GitHub выкладку Deploy to hosting с галочкой «Загрузить все файлы заново».');
  let x=null;try{x=await r.json()}catch{}
  if(x&&x.team===true)return x;
  if(x&&x.error)return broken(`Сервер ответил ошибкой (код ${r.status}): ${x.error}`);
  return broken(`Сервер вернул не то, что ожидалось (код ${r.status}). Проверьте в панели хостинга, что для сайта выбран PHP 8.1 или новее и что в папке сайта нет заглушки index.php от хостинга.`)}
export const auth=await detectTeam();
export const hosted=!!auth;
export const session={me:null,team:[],revision:0};
let database,queue=Promise.resolve(),pending=0,conflict=false;
function localDb(){return database||(database=new Promise((resolve,reject)=>{const r=indexedDB.open('living-project-hq',1);r.onupgradeneeded=()=>{if(!r.result.objectStoreNames.contains('workspace'))r.result.createObjectStore('workspace')};r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error)}))}
export async function api(path,body){const r=await fetch(path,{method:body?'POST':'GET',headers:body?{'Content-Type':'application/json'}:undefined,body:body?JSON.stringify(body):undefined,cache:'no-store'});let result;try{result=await r.json()}catch{throw new Error('Не удалось подключиться. Обновите страницу и войдите в аккаунт.')}if(!r.ok){const e=new Error(result.error||'Не удалось выполнить действие');e.status=r.status;if(r.status===401&&hosted&&!path.startsWith('/api/login')&&!path.startsWith('/api/setup'))setTimeout(()=>location.reload(),1200);throw e}return result}
export async function loadWorkspace(){if(hosted){const x=await api('/api/workspace');Object.assign(session,{me:x.me,team:x.team,revision:x.revision});return x.data}const d=await localDb();return new Promise((res,rej)=>{const r=d.transaction('workspace','readonly').objectStore('workspace').get('main');r.onsuccess=()=>res(r.result||null);r.onerror=()=>rej(r.error)})}
export function isAdmin(){return !hosted||session.me?.role==='admin'}
export function canEditTask(t){return isAdmin()||t.assigneeEmail===session.me?.email||t.assigneeEmails?.includes(session.me?.email)||t.createdBy===session.me?.email}
export function isPending(){return pending>0}
export function hasConflict(){return conflict}
export function saveWorkspace(state){const data=structuredClone(state);pending++;const run=queue.catch(()=>{}).then(async()=>{if(hosted){if(conflict)throw new Error('Сначала обновите общую базу: есть конфликт изменений.');try{const x=await api('/api/workspace',{action:'sync',data,revision:session.revision});session.revision=x.revision;if(x.data){if(JSON.stringify(state)===JSON.stringify(data))Object.assign(state,x.data);else{for(const t of state.tasks){const sent=data.tasks.find(n=>n.id===t.id),saved=x.data.tasks.find(n=>n.id===t.id);if(sent&&saved)for(const k of ['assignees','assigneeEmails','assigneeEmail','createdAt','createdBy','requiresReview','lead','contributors'])if(JSON.stringify(t[k])===JSON.stringify(sent[k]))t[k]=saved[k];}if(JSON.stringify(state.archive)===JSON.stringify(data.archive))state.archive=x.data.archive;}}}catch(e){if(e.status===409)conflict=true;throw e}}else{const d=await localDb();await new Promise((res,rej)=>{const tx=d.transaction('workspace','readwrite');tx.objectStore('workspace').put(data,'main');tx.oncomplete=res;tx.onerror=()=>rej(tx.error)})}}).finally(()=>pending--);queue=run;return run}
export async function settle(){await queue;}
// Contract-generator data (parties with bank and passport details, deals). Team mode: admins only on the server.
let docsRevision=0;
export async function loadDocs(){if(hosted){const x=await api('/api/docs');docsRevision=x.revision;return x.data}const d=await localDb();return new Promise((res,rej)=>{const r=d.transaction('workspace','readonly').objectStore('workspace').get('docs');r.onsuccess=()=>res(r.result||null);r.onerror=()=>rej(r.error)})}
export async function saveDocs(data){if(hosted){const x=await api('/api/docs',{data,revision:docsRevision});docsRevision=x.revision;return}const d=await localDb();await new Promise((res,rej)=>{const tx=d.transaction('workspace','readwrite');tx.objectStore('workspace').put(structuredClone(data),'docs');tx.oncomplete=res;tx.onerror=()=>rej(tx.error)})}


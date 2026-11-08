import {apiUrl,hosted} from './workspace-store.js?v=63';
// Server-owned Google connection; secrets and OAuth tokens never reach this module.
const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
async function api(path,body){
 const response=await fetch(apiUrl('/api/google-drive/'+path),{method:body===undefined?'GET':'POST',credentials:'same-origin',headers:body===undefined?{}:{'Content-Type':'application/json','X-HQ-Drive':'1'},body:body===undefined?undefined:JSON.stringify(body)});
 const data=await response.json().catch(()=>({error:'Сервер Google Диска недоступен. Проверьте публикацию обновления.'}));
 if(!response.ok||data.error)throw new Error(data.error||'Не удалось выполнить запрос.');return data;
}
export async function saveToDrive(blob,name,project,year){
 if(!hosted||!project)return {skipped:true};
 const status=await api('status');
 const bound=status.bindings?.some(b=>b.project===project&&b.year===String(year));
 if(!bound)return {skipped:true};
 if(!status.connected)throw new Error('Google Диск отключён. Подключите его в разделе «Документы».');
 if(blob.size>10*1024*1024)throw new Error('Для Google Диска документ должен быть до 10 МБ.');
 const content=await new Promise((resolve,reject)=>{const r=new FileReader();r.onload=()=>resolve(String(r.result).split(',')[1]);r.onerror=()=>reject(new Error('Не удалось прочитать файл.'));r.readAsDataURL(blob);});
 return api('upload',{project,year:String(year),name,content});
}
export function openDriveManager({folders,flush,toast}){
 const dialog=document.createElement('dialog');dialog.style.cssText='max-width:680px;width:calc(100% - 32px);max-height:85vh;overflow:auto;border:1px solid #ddd;border-radius:20px;padding:24px';dialog.setAttribute('aria-label','Google Диск');
 document.body.append(dialog);dialog.addEventListener('close',()=>dialog.remove());dialog.showModal();
 let busy=false;
 const run=async fn=>{if(busy)return;busy=true;dialog.querySelectorAll('button,input,select').forEach(b=>b.disabled=true);try{await fn();}catch(e){const error=dialog.querySelector('[data-error]');if(error)error.textContent=e.message;else toast(e.message);}finally{busy=false;dialog.querySelectorAll('button,input,select').forEach(b=>b.disabled=false);}};
 async function render(){
  dialog.innerHTML='<p>Проверяю подключение…</p><button class="btn" data-close>Закрыть</button><p data-error role="alert"></p>';dialog.querySelector('[data-close]').onclick=()=>dialog.close();
  const s=await api('status');if(!dialog.isConnected)return;
  const projects=folders.filter(f=>f.organization==='МАНТ');
  dialog.innerHTML=`<div class="home-panel-head"><h2>Google Диск</h2><button class="btn" data-close>Закрыть</button></div><p>${s.connected?'Подключён: '+esc(s.account):'Google Диск не подключён'}</p><p><a target="_blank" rel="noopener" href="https://drive.google.com/drive/folders/${esc(s.root)}">Общая папка МАНТ ↗</a></p>${!s.configured?'<p class="docs-warn">На сервере ещё не настроен секретный ключ Google. Добавьте его в закрытые настройки хостинга по инструкции server/GOOGLE-DRIVE.md.</p>':`<p>Google запрашивает доступ ко всему Диску. Сайт использует его для работы внутри папки МАНТ. Файлы не удаляются и не перезаписываются.</p><button class="btn primary" data-connect>${s.connected?'Подключить заново / другой аккаунт':'Подключить Google Диск'}</button>${s.connected?' <button class="btn" data-disconnect>Отключить от сайта</button>':''}`}<h3>Папки проектов</h3><p>После привязки при скачивании договора, акта, счёта, УПД, платёжного поручения, сметы или реестра копия сохраняется в папку проекта. Изменения сметы на Диске пока не загружаются на сайт.</p>${(s.bindings||[]).map((b,i)=>`<p>${esc(projects.find(f=>f.id===b.project)?.name||b.project)} · ${esc(b.year)} — <a target="_blank" rel="noopener" href="https://drive.google.com/drive/folders/${esc(b.folder)}">${esc(b.name)}</a> <button class="btn ghost" data-unbind="${i}">Отвязать</button></p>`).join('')}${s.connected?`<form data-bind class="docs-grid"><label class="field"><span>Проект МАНТ</span><select name="project" required>${projects.map(f=>`<option value="${esc(f.id)}">${esc(f.name)}</option>`).join('')}</select></label><label class="field"><span>Год</span><input name="year" type="number" min="2000" max="9999" value="2026" required></label><label class="field wide"><span>Ссылка на папку проекта внутри МАНТ</span><input name="folder" type="url" required placeholder="https://drive.google.com/drive/folders/…"></label><button class="btn primary" type="submit">Привязать папку</button></form>`:''}<p data-error role="alert" class="docs-warn"></p><small>В тестовом режиме Google подключение действует до 7 дней. При истечении доступа подключитесь заново. Отключение от сайта не удаляет файлы и не отзывает разрешение в Google-аккаунте.</small>`;
  dialog.querySelector('[data-close]').onclick=()=>dialog.close();
  dialog.querySelector('[data-connect]')?.addEventListener('click',()=>run(async()=>{await flush();const r=await api('connect',{});location.assign(r.url);}));
  dialog.querySelector('[data-disconnect]')?.addEventListener('click',()=>run(async()=>{await api('disconnect',{});await render();}));
  dialog.querySelector('[data-bind]')?.addEventListener('submit',ev=>{ev.preventDefault();const form=Object.fromEntries(new FormData(ev.target));run(async()=>{await flush();await api('bind',form);await render();});});
  dialog.querySelectorAll('[data-unbind]').forEach(b=>b.onclick=()=>run(async()=>{const binding=s.bindings[+b.dataset.unbind];await api('unbind',{project:binding.project,year:binding.year});await render();}));
 }
 run(render);
}

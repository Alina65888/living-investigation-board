// Text drafts are local to this browser and namespaced by account. Passwords and files are never stored.
export const draftKey=(email,key)=>'living-draft:v1:'+encodeURIComponent(email||'local')+':'+key;
export function saveDraft(key,value,storage=localStorage){try{storage.setItem(key,JSON.stringify({at:Date.now(),value}));return true}catch{return false}}
export function loadDraft(key,storage=localStorage){try{const x=JSON.parse(storage.getItem(key));if(!x)return null;if(Date.now()-x.at>30*864e5){storage.removeItem(key);return null}return x.value}catch{return null}}
export function clearDraft(key,storage=localStorage){try{storage.removeItem(key)}catch{}}
export function bindDraft(form,key){
 const controls=()=>[...form.querySelectorAll('input,textarea,select')].filter(x=>!['password','file','submit','button','hidden'].includes(x.type)&&!x.disabled&&(x.name||x.id));
 const identity=x=>x.name||x.id;
 const values=()=>{const out={};for(const x of controls()){const k=identity(x);if(x.type==='checkbox'||x.type==='radio'){(out[k]??=[]);if(x.checked)out[k].push(x.value)}else out[k]=x.value}return out};
 let stored=loadDraft(key);const restore=(only=null)=>{if(stored)for(const x of controls().filter(x=>!only||identity(x)===only)){const v=stored[identity(x)];if(v===undefined)continue;if(x.type==='checkbox'||x.type==='radio')x.checked=Array.isArray(v)&&v.includes(x.value);else if(x.tagName!=='SELECT'||[...x.options].some(o=>o.value===v))x.value=v;}};restore();
 const hint=document.createElement('p');hint.className='team-note draft-hint';hint.setAttribute('role','status');hint.textContent=stored?'Черновик восстановлен. Файлы при необходимости выберите заново.':'Текст сохраняется как черновик в этом браузере. Файлы нужно выбирать заново.';form.append(hint);const discard=document.createElement('button');discard.type='button';discard.className='btn ghost';discard.textContent='Удалить черновик';discard.onclick=()=>{if(!confirm('Удалить черновик этой формы?'))return;clearDraft(key);stored=null;form.reset();form.querySelectorAll('select,input[type=checkbox]').forEach(x=>x.dispatchEvent(new Event('change')));hint.textContent='Черновик удалён';form.closest('.modal-backdrop')?.removeAttribute('data-changed');};form.append(discard);
 let cleared=false;const save=()=>{if(cleared)return;hint.textContent=saveDraft(key,values())?'Черновик сохранён в этом браузере':'Не удалось сохранить черновик. Не закрывайте страницу.';};form.addEventListener('input',save);form.addEventListener('change',save);
 return {clear(){cleared=true;clearDraft(key)},save,restore,restored:!!stored};
}

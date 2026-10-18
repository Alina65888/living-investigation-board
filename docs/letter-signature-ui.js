// A modal around the real, sandboxed letter renderer. No copied canvas layout.
export async function signatureLayoutDialog({dialog,api,template,onSave}){
 const focus=document.activeElement,m=dialog(`<h2 id="signature-layout-title">Расположите подпись</h2><p class="muted">Перетащите подпись на нужное место. Размер меняется ползунком. Сохраните один раз для этого макета — при согласовании подпись встанет сюда автоматически.</p><div class="signature-editor-grid"><div><iframe class="signature-preview" title="Настройка подписи на макете" sandbox="allow-scripts" data-signature-frame></iframe><p class="preview-caption" data-signature-state>Загружаю макет…</p></div><div class="signature-controls"><label class="field"><span>Размер подписи</span><input type="range" min="3" max="50" step="0.2" value="18" data-signature-size disabled><output data-signature-size-label></output></label><div class="two-fields"><label class="field"><span>Слева, мм</span><input type="number" min="0" step="0.5" data-signature-x disabled></label><label class="field"><span>Сверху, мм</span><input type="number" min="0" step="0.5" data-signature-y disabled></label></div><button type="button" data-signature-reset disabled>Вернуть в место макета</button><p class="file-hint">Настройка применяется ко всем новым согласованиям этого макета с вашей подписью. Уже подписанные письма не изменятся.</p><p class="error" role="alert" data-signature-error></p><div class="actions"><button type="button" data-close>Отмена</button><button type="button" class="primary" data-confirm disabled>Сохранить положение</button></div></div></div>`);
 const q=s=>m.querySelector(s),frame=q('[data-signature-frame]'),button=q('[data-confirm]');
 q('#signature-layout-title').textContent='Подпись на макете «'+template.name+'»';
 q('.dialog').classList.add('signature-layout-dialog');q('.dialog').setAttribute('aria-labelledby','signature-layout-title');
 let placement=null,version=null,pageW=297,pageH=210,saving=false,layoutFits=false,ready=false;
 const sizing=new ResizeObserver(()=>{const height=Math.max(210,(frame.clientWidth-24)*pageH/pageW+34);if(Math.abs(frame.getBoundingClientRect().height-height)>1)frame.style.height=height+'px';});sizing.observe(frame);
 const close=()=>{if(saving)return;sizing.disconnect();window.removeEventListener('message',onMessage);m.remove();focus?.focus();};
 // Override the generic dialog's close handlers while saving.
 q('[data-close]').onclick=close;
 m.addEventListener('keydown',e=>{if(e.key==='Escape'){e.preventDefault();e.stopImmediatePropagation();close();}if(e.key==='Tab'){const items=[...m.querySelectorAll('button,input,iframe')].filter(n=>!n.disabled&&n.getClientRects().length),first=items[0],last=items.at(-1);if(e.shiftKey&&document.activeElement===first){e.preventDefault();last?.focus();}else if(!e.shiftKey&&document.activeElement===last){e.preventDefault();first?.focus();}}},true);
 const send=()=>{frame.contentWindow.postMessage({type:'letter-signature-set',placement},'*');};
 const enabled=()=>button.disabled=saving||!ready||!layoutFits||!version;
 function onMessage(e){
  if(!m.isConnected){window.removeEventListener('message',onMessage);return;}
  if(e.source!==frame.contentWindow)return;
  if(e.data?.type==='letter-signature-error'){q('[data-signature-error]').textContent=e.data.message;ready=false;enabled();}
  if(e.data?.type==='letter-layout'){
   layoutFits=e.data.ready===true&&e.data.fits===true;
   q('[data-signature-state]').textContent=layoutFits?'Предпросмотр макета. Настройка не подписывает письма.':'Загружаю макет или проверяю, помещается ли текст…';
   if(e.data.ready===true&&!e.data.fits)q('[data-signature-state]').textContent='Текст выходит за границы листа. Проверьте исходный макет.';
   enabled();
  }
  if(e.data?.type==='letter-signature-position'){
   const p=e.data.placement;if(!p||!['x','y','width'].every(k=>Number.isFinite(p[k])))return;
   placement=p;ready=e.data.ready===true;
   q('[data-signature-size]').value=p.width;q('[data-signature-size-label]').textContent=(p.width*pageW/100).toFixed(1)+' мм по ширине';
   for(const axis of ['x','y']){const input=q(`[data-signature-${axis}]`);if(document.activeElement!==input)input.value=(p[axis]*(axis==='x'?pageW:pageH)/100).toFixed(1);}
   m.querySelectorAll('.signature-controls input,[data-signature-reset]').forEach(x=>x.disabled=!ready||saving);enabled();
  }
 }
 window.addEventListener('message',onMessage);
 q('[data-signature-size]').oninput=e=>{if(placement){placement={...placement,width:Number(e.target.value)};send();}};
 for(const axis of ['x','y'])q(`[data-signature-${axis}]`).onchange=e=>{if(placement){placement={...placement,[axis]:Number(e.target.value)/(axis==='x'?pageW:pageH)*100};send();}};
 q('[data-signature-reset]').onclick=()=>frame.contentWindow.postMessage({type:'letter-signature-reset'},'*');
 button.onclick=async()=>{
  if(button.disabled)return;saving=true;enabled();q('.signature-controls').inert=true;frame.inert=true;
  try{await onSave({placement,signatureVersion:version});saving=false;close();}
  catch(e){saving=false;q('.signature-controls').inert=false;frame.inert=false;q('[data-signature-error]').textContent=e.message;enabled();}
 };
 try{
  const result=await api('/api/letter-signature-preview',{templateId:template.id});if(!m.isConnected)return;
  version=result.signatureVersion;pageW=result.orientation==='portrait'?210:297;pageH=result.orientation==='portrait'?297:210;
  frame.style.aspectRatio=String(pageW/pageH);frame.style.height=Math.max(210,(frame.clientWidth-24)*pageH/pageW+34)+'px';frame.srcdoc=result.html;enabled();
 }catch(e){if(m.isConnected)q('[data-signature-error]').textContent=e.message;}
}

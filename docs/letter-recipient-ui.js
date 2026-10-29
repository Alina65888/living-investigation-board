import {readRecipientFile,suggestColumns,recipientsFromSheet,nameLines,checkNames,duplicateCount,MAX_RECIPIENTS} from './letter-recipients.js?v=61';
const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const columnName=n=>{let s='';for(n++;n>0;n=Math.floor((n-1)/26))s=String.fromCharCode(65+(n-1)%26)+s;return s;};

export function recipientImportDialog({dialog,existing,onApply}){
  const returnFocus=document.activeElement;
  const m=dialog(`<h2 id="recipient-import-title">Загрузить список получателей</h2><p class="muted">Один получатель — одно письмо. Макет, текст и приказ будут общими для всего комплекта.</p><label class="field"><span>Файл со списком</span><input type="file" data-recipient-file accept=".xlsx,.csv,.txt"><small>Excel (.xlsx), CSV или TXT, до 5 МБ. До ${MAX_RECIPIENTS} получателей в комплекте.</small></label><p class="error" role="alert" data-import-error></p><div data-import-content hidden><label class="field" data-sheet-field><span>Лист Excel</span><select data-sheet></select></label><details data-column-settings><summary data-column-summary>Настроить столбцы</summary><div data-mapping></div></details><label class="field"><span>Проверьте получателей</span><textarea rows="8" data-import-names aria-describedby="recipient-case-help"></textarea><small id="recipient-case-help">Для бланка МАНТ: кому? Например, «Иванову Ивану Ивановичу». Падеж не меняется автоматически. Каждое имя можно исправить здесь.</small></label><p class="file-hint" data-source-info></p>${existing.length?'<label class="field"><span>В письме уже есть получатели</span><select data-import-action><option value="append">Добавить к текущему списку</option><option value="replace">Заменить текущий список</option></select></label>':''}<p class="note" data-import-count role="status"></p></div><div class="actions import-actions"><button type="button" data-close>Отмена</button><button type="button" class="primary" data-import-apply disabled>Добавить получателей</button></div>`);
  m.querySelector('.dialog').setAttribute('aria-labelledby','recipient-import-title');
  m.querySelector('.dialog').classList.add('recipient-import');
  const q=s=>m.querySelector(s),error=q('[data-import-error]'),apply=q('[data-import-apply]'),preview=q('[data-import-names]');
  let workbook=null,options=null,readToken=0,sourceValid=false;
  const close=()=>{m.remove();returnFocus?.focus();};
  q('[data-close]').onclick=close;
  m.addEventListener('keydown',e=>{
    if(e.key==='Escape'){e.preventDefault();close();}
    if(e.key==='Tab'){
      const items=[...m.querySelectorAll('button,input,select,textarea')].filter(n=>!n.disabled&&n.getClientRects().length),first=items[0],last=items.at(-1);
      if(e.shiftKey&&document.activeElement===first){e.preventDefault();last?.focus();}
      else if(!e.shiftKey&&document.activeElement===last){e.preventDefault();first?.focus();}
    }
  });
  const combined=()=>q('[data-import-action]')?.value==='append'?[...existing,...nameLines(preview.value)]:nameLines(preview.value);
  function count(){
    if(!sourceValid){apply.disabled=true;return;}
    const imported=nameLines(preview.value),names=combined(),duplicates=duplicateCount(names);
    q('[data-import-count]').textContent=`Из файла: ${imported.length}. Всего писем в комплекте: ${names.length}.${duplicates?` Повторяющихся ФИО: ${duplicates}. Они сохранены; удалите лишние строки, если это не тезки.`:''}`;
    error.textContent='';try{checkNames(imported);checkNames(names);apply.disabled=false;}catch(e){error.textContent=e.message;apply.disabled=true;}
    apply.textContent=q('[data-import-action]')?.value==='replace'?'Заменить список':'Добавить получателей';
  }
  function buildNames(){
    const sheet=workbook.sheets[Number(q('[data-sheet]').value)];
    options.header=q('[data-header]').checked;options.mode=q('[data-name-mode]').value;
    for(const key of ['full','last','given','middle'])options[key]=Number(q(`[data-column="${key}"]`).value);
    const used=options.mode==='split'?[options.last,options.given,options.middle].filter(n=>n>=0):[options.full].filter(n=>n>=0);q('[data-column-summary]').textContent=used.length?'Столбцы: '+used.map(columnName).join(' + ')+' · изменить':'Выбрать столбцы с именами';q('[data-full-column]').hidden=options.mode!=='full';q('[data-split-columns]').hidden=options.mode!=='split';
    try{
      const result=recipientsFromSheet(sheet,options);preview.value=result.names.join('\n');sourceValid=true;
      q('[data-source-info]').textContent=[result.blank?`Строк без ФИО пропущено: ${result.blank}.`:'',result.incomplete?`Не хватает фамилии или имени: ${result.incomplete}. Проверьте список.`:'',result.formulaCount?`Строк с формулами: ${result.formulaCount}. Показаны сохраненные Excel значения; проверьте их актуальность.`:''].filter(Boolean).join(' ');
      count();
    }catch(e){sourceValid=false;preview.value='';q('[data-source-info]').textContent='';q('[data-import-count]').textContent='Выберите столбцы, чтобы увидеть список.';error.textContent=e.message;apply.disabled=true;}
  }
  function sheetChanged(){
    const sheet=workbook.sheets[Number(q('[data-sheet]').value)];options=suggestColumns(sheet.rows);
    const width=Math.max(...sheet.rows.map(r=>r.length)),first=sheet.rows[options.start]||[];q('[data-column-settings]').open=!(options.header||width===1);
    const selector=(key,label)=>`<label class="field"><span>${label}</span><select data-column="${key}"><option value="-1">${key==='middle'?'Не использовать':'Выберите столбец'}</option>${Array.from({length:width},(_,i)=>`<option value="${i}" ${i===options[key]?'selected':''}>${columnName(i)} · ${esc((first[i]||'Пусто').slice(0,65))}</option>`).join('')}</select></label>`;
    q('[data-mapping]').innerHTML=`<label class="import-check"><input type="checkbox" data-header ${options.header?'checked':''}>Первая заполненная строка — заголовки</label><label class="field"><span>Как записаны имена</span><select data-name-mode><option value="full" ${options.mode==='full'?'selected':''}>ФИО в одном столбце</option><option value="split" ${options.mode==='split'?'selected':''}>Фамилия, имя и отчество отдельно</option></select></label><div data-full-column>${selector('full','Столбец с ФИО')}</div><div data-split-columns class="import-columns">${selector('last','Фамилия')}${selector('given','Имя')}${selector('middle','Отчество (если есть)')}</div>`;
    q('[data-mapping]').onchange=buildNames;buildNames();
  }
  q('[data-sheet]').onchange=sheetChanged;
  preview.oninput=count;q('[data-import-action]')?.addEventListener('change',count);
  q('[data-recipient-file]').onchange=async e=>{
    const token=++readToken,file=e.target.files[0];sourceValid=false;apply.disabled=true;workbook=null;q('[data-import-content]').hidden=true;error.textContent='';
    if(!file)return;
    try{
      q('[data-import-count]').textContent='Читаю список…';const result=await readRecipientFile(file);
      if(token!==readToken||!m.isConnected)return;workbook=result;
      q('[data-sheet]').innerHTML=result.sheets.map((s,i)=>`<option value="${i}">${esc(s.name)}${s.hidden?' (скрытый лист)':''}</option>`).join('');
      q('[data-sheet]').value=String(Math.max(0,result.sheets.findIndex(s=>!s.hidden)));
      q('[data-sheet-field]').hidden=result.sheets.length===1;q('[data-import-content]').hidden=false;sheetChanged();
    }catch(x){if(token===readToken&&m.isConnected)error.textContent=x.message;}
  };
  apply.onclick=()=>{try{if(!sourceValid)return;const names=checkNames(combined());onApply(names);close();}catch(e){error.textContent=e.message;}};
}

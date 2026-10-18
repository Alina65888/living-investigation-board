// Local Word editing for approved NPD and business templates. No document contents
// are sent to a third-party service; active/previous versions live in /api/docs.
import * as G from './docgen.js?v=56';
import {loadTemplate,templateName,contractAvailability} from './docx-templates.js?v=56';

const enc=new TextEncoder(),dec=new TextDecoder();
const W='http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const MAX_BYTES=2*1024*1024;
export const EDITABLE_TEMPLATES={services:'Договор и спецификация СЗН','act-npd':'Акт СЗН','supply-ip':'Поставка — договор и спецификация ИП','services-business':'Услуги — договор и спецификация ИП и ООО','invoice-ip':'Счет ИП','invoice-org':'Счет ООО'};
const documentKind=key=>key.startsWith('invoice-')?'invoice':key==='act-npd'?'act':'contract';
const docParts=name=>/^word\/(document|header\d+|footer\d+)\.xml$/.test(name);
const parse=s=>{if(/<!DOCTYPE|<!ENTITY/i.test(s))throw new Error('Файл содержит неподдерживаемую структуру XML.');const d=new DOMParser().parseFromString(s,'application/xml');if(d.querySelector('parsererror'))throw new Error('Не удалось прочитать структуру Word. Сохраните файл в формате DOCX.');return d;};
const serial=d=>new XMLSerializer().serializeToString(d);
const texts=node=>[...node.getElementsByTagNameNS(W,'t')];
const visible=node=>texts(node).map(t=>t.textContent).join('');
const tokens=s=>[...s.matchAll(/\{\{(\w+)\}\}/g)].map(m=>m[1]);
export const templateBytes=entry=>{const binary=atob(entry.data),bytes=Uint8Array.from(binary,c=>c.charCodeAt(0));return bytes.buffer;};
export function templateRecord(buffer,name){const bytes=new Uint8Array(buffer);let binary='';for(let i=0;i<bytes.length;i+=8192)binary+=String.fromCharCode(...bytes.subarray(i,i+8192));return {name,data:btoa(binary),updatedAt:new Date().toISOString()};}

// Normal DOCX files use DEFLATE. Read the central directory so Word's data
// descriptors are supported too, with limits before and during decompression.
export async function readWordZip(buffer){
  if(buffer.byteLength>MAX_BYTES)throw new Error('Выберите DOCX размером до 2 МБ.');
  const view=new DataView(buffer),bytes=new Uint8Array(buffer),files=Object.create(null);
  const u16=o=>view.getUint16(o,true),u32=o=>view.getUint32(o,true);
  let end=-1;
  for(let i=bytes.length-22;i>=Math.max(0,bytes.length-65557);i--)if(u32(i)===0x06054b50&&i+22+u16(i+20)===bytes.length){end=i;break;}
  if(end<0)throw new Error('Это не файл DOCX. Откройте документ в Word и сохраните как DOCX.');
  const count=u16(end+10);let pos=u32(end+16),total=0;
  if(u16(end+4)||u16(end+6)||count>180||pos+u32(end+12)!==end)throw new Error('Неподдерживаемый архив Word.');
  for(let i=0;i<count;i++){
    if(pos+46>end||u32(pos)!==0x02014b50)throw new Error('Поврежден файл Word.');
    const flags=u16(pos+8),method=u16(pos+10),packed=u32(pos+20),size=u32(pos+24),nl=u16(pos+28),extra=u16(pos+30),comment=u16(pos+32),local=u32(pos+42);
    const name=dec.decode(bytes.subarray(pos+46,pos+46+nl));
    if(!name||name.includes('..')||name.startsWith('/')||name.includes('\\')||Object.hasOwn(files,name))throw new Error('Неподдерживаемая структура файла.');
    if((flags&1)||![0,8].includes(method))throw new Error('Снимите пароль с документа и сохраните его как DOCX.');
    total+=size;if(total>MAX_BYTES)throw new Error('Содержимое шаблона превышает 2 МБ. Удалите лишние изображения и вложения.');
    if(local+30>pos||u32(local)!==0x04034b50)throw new Error('Поврежден файл Word.');
    const start=local+30+u16(local+26)+u16(local+28);
    if(start+packed>u32(end+16))throw new Error('Поврежден файл Word.');
    let data=bytes.slice(start,start+packed);
    if(method===8){
      let stream;try{stream=new DecompressionStream('deflate-raw');}catch{throw new Error('Для загрузки шаблона обновите браузер до последней версии.');}
      const reader=new Blob([data]).stream().pipeThrough(stream).getReader(),parts=[];let received=0;
      try{while(true){const {value,done}=await reader.read();if(done)break;received+=value.length;if(received>size||received>MAX_BYTES){await reader.cancel();throw new Error('Некорректный размер шаблона.');}parts.push(value);}}finally{reader.releaseLock();}
      data=new Uint8Array(received);let offset=0;for(const part of parts){data.set(part,offset);offset+=part.length;}
    }
    if(data.length!==size||G.crc32(data)!==u32(pos+16))throw new Error('Поврежден файл Word.');
    files[name]=data;pos+=46+nl+extra+comment;
  }
  if(pos!==end||!files['word/document.xml']||!files['[Content_Types].xml'])throw new Error('В файле нет документа Word.');
  return files;
}

// Word can split a placeholder across runs after editing. Coalesce the token
// only, preserving the first character's formatting and all surrounding text.
function replaceText(node,start,length,value){let pos=0,inserted=false;for(const t of texts(node)){const s=t.textContent,a=pos,b=pos+s.length;pos=b;if(b<=start||a>=start+length)continue;t.textContent=s.slice(0,Math.max(0,start-a))+(inserted?'':value)+s.slice(Math.max(0,start+length-a));t.setAttributeNS('http://www.w3.org/XML/1998/namespace','xml:space','preserve');inserted=true;}}
function coalesce(doc){for(const p of doc.getElementsByTagNameNS(W,'p')){for(const match of [...visible(p).matchAll(/\{\{[^{}]+\}\}/g)].reverse())replaceText(p,match.index,match[0].length,match[0]);}}
function counts(list){const m=new Map();for(const t of list)m.set(t,(m.get(t)||0)+1);return m;}

export async function editableTemplate(name,buffer){
  if(!EDITABLE_TEMPLATES[name])throw new Error('Неизвестный шаблон.');
  const files=G.unzipStored(buffer||await loadTemplate(name));
  let document=dec.decode(files['word/document.xml']);
  document=document.replace(/<!--items:\d+:start-->([\s\S]*?)<!--items:\d+:end-->/g,(_,row)=>{
    let first=true;row=row.replace(/(<w:t(?:\s[^>]*)?>)([\s\S]*?)(<\/w:t>)/g,(all,a,b,c)=>{if(!first)return all;first=false;return a+'{{#items}}'+b+c;});
    const at=row.lastIndexOf('</w:t>');return row.slice(0,at)+'{{/items}}'+row.slice(at);
  });
  files['word/document.xml']=enc.encode(document);
  return new Blob([G.zip(files)],{type:'application/vnd.openxmlformats-officedocument.wordprocessingml.document'});
}

export async function prepareTemplate(name,buffer,baseline){
  if(!EDITABLE_TEMPLATES[name])throw new Error('Неизвестный шаблон.');
  const original=G.unzipStored(baseline||await loadTemplate(name));
  const required=counts(Object.entries(original).filter(([n])=>docParts(n)).flatMap(([,data])=>tokens(dec.decode(data))));
  const files=await readWordZip(buffer),found=[],itemKeys=new Set([...required.keys()].filter(k=>(k.startsWith('item')&&k!=='itemGroup')||k==='invoiceItemNumber'));
  const hasItems=dec.decode(original['word/document.xml']).includes('<!--items:');
  for(const [path,data] of Object.entries(files)){
    if(/vbaProject|embeddings\/|activeX\//i.test(path))throw new Error('Загрузите DOCX без макросов и вложенных объектов.');
    if(!/\.xml$|\.rels$/.test(path))continue;
    const document=parse(dec.decode(data));
    if(path.endsWith('.rels')&&[...document.getElementsByTagName('Relationship')].some(r=>r.getAttribute('TargetMode')==='External'))throw new Error('Удалите внешние ссылки и связанные объекты из шаблона.');
    if(!docParts(path))continue;
    if(['ins','del','moveFrom','moveTo'].some(tag=>document.getElementsByTagNameNS(W,tag).length))throw new Error('Примите исправления в Word перед загрузкой шаблона.');
    if([...document.getElementsByTagNameNS(W,'instrText')].some(t=>/\b(DDE|DDEAUTO|INCLUDETEXT|INCLUDEPICTURE|LINK)\b/i.test(t.textContent)))throw new Error('Удалите связанные поля из шаблона.');
    coalesce(document);
    let repeated=null;
    const all=visible(document),starts=[...all.matchAll(/\{\{#items\}\}/g)],ends=[...all.matchAll(/\{\{\/items\}\}/g)];
    // Editable downloads use visible markers. Raw bundled templates may instead
    // carry XML comments; only accept those after the same row/field checks.
    if(hasItems&&path==='word/document.xml'){
      if(starts.length===1&&ends.length===1){
        repeated=[...document.getElementsByTagNameNS(W,'tr')].find(row=>visible(row).includes('{{#items}}')&&visible(row).includes('{{/items}}'));
        if(!repeated||starts[0].index>=ends[0].index)throw new Error('Начало и конец позиций должны оставаться в одной строке спецификации.');
        const rowText=visible(repeated);replaceText(repeated,rowText.indexOf('{{/items}}'),10,'');replaceText(repeated,visible(repeated).indexOf('{{#items}}'),10,'');
        repeated.before(document.createComment('items:0:start'));repeated.after(document.createComment('items:0:end'));
      }else if(!starts.length&&!ends.length){
        const rows=[...document.getElementsByTagNameNS(W,'tr')];
        repeated=rows.find(r=>r.previousSibling?.nodeType===8&&/^items:0:start$/.test(r.previousSibling.data)&&r.nextSibling?.nodeType===8&&/^items:0:end$/.test(r.nextSibling.data));
      }
      if(!repeated)throw new Error('Не найдена строка спецификации. Скачайте шаблон для редактирования и сохраните поля {{#items}} и {{/items}}.');
      const rowTokens=tokens(visible(repeated));
      for(const key of itemKeys)if(!rowTokens.includes(key))throw new Error('В строке спецификации отсутствует поле {{'+key+'}}.');
      for(const key of itemKeys)if(tokens(visible(document)).filter(k=>k===key).length!==rowTokens.filter(k=>k===key).length)throw new Error('Поля позиций должны находиться только в строке спецификации.');
    }else if(starts.length||ends.length)throw new Error('В этом документе не должно быть полей повторения позиций.');
    const plain=visible(document),keys=tokens(plain);found.push(...keys);
    if(/\{\{|\}\}/.test(plain.replace(/\{\{\w+\}\}/g,'')))throw new Error('Повреждено поле шаблона. Сохраните двойные фигурные скобки и название поля.');
    if(keys.some(k=>!required.has(k)))throw new Error('Неизвестное поле: {{'+keys.find(k=>!required.has(k))+'}}. Используйте поля скачанного шаблона.');
    const result=serial(document);
    const markers=[...result.matchAll(/<!--items:[\s\S]*?-->/g)].map(m=>m[0]);
    if(hasItems&&path==='word/document.xml'){
      if(markers.join('')!=='<!--items:0:start--><!--items:0:end-->')throw new Error('В шаблоне должна быть одна строка для повторения позиций.');
    }else if(markers.length)throw new Error('В этом документе не должно быть строк повторения позиций.');
    // Reject split tokens that could not be repaired (e.g. across paragraphs).
    if(tokens(result).length!==keys.length)throw new Error('Поле шаблона разорвано. Введите его целиком в одном абзаце.');
    files[path]=enc.encode(result);
  }
  const have=counts(found),missing=[...required].filter(([k,n])=>(have.get(k)||0)<n).map(([k])=>'{{'+k+'}}');
  if(missing.length)throw new Error('Не хватает полей: '+missing.slice(0,5).join(', ')+'. Скачайте шаблон для редактирования: обычный заполненный договор не подойдет.');
  return G.zip(files).arrayBuffer();
}

const esc=s=>String(s??'').replace(/[&<>"']/g,m=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m]));
function download(blob,name){const a=document.createElement('a');a.href=URL.createObjectURL(blob);a.download=name;document.body.append(a);a.click();setTimeout(()=>{URL.revokeObjectURL(a.href);a.remove();},2000);}
const sample={
  customer:{kind:'org',name:'Региональная молодежная общественная организация «Пример»',signer:'Иванов Иван Иванович',signerPosition:'председатель совета',basis:'устава',inn:'0000000000',kpp:'000000000',ogrn:'0000000000000',address:'г. Казань, пример адреса',account:'00000000000000000000',bank:'Банк — пример',bik:'000000000',corr:'00000000000000000000'},
  executor:{kind:'npd',fio:'Петрова Анна Ивановна',npdDate:'2026-03-01',npdNumber:'00000000',passport:'0000 000000, выдан 01.03.2026',inn:'000000000000',address:'г. Казань, пример адреса',account:'00000000000000000000',bank:'Банк — пример',bik:'000000000',corr:'00000000000000000000'},
  deal:{type:'services',number:'ПРИМЕР',date:'2026-03-01',actDate:'2026-03-09',deadline:'2026-03-09',subject:'руководителя проекта «Пример»',period:'с 1 по 9 марта 2026 г.',items:[{name:'Руководитель проекта',description:'Координация участников и контроль сроков проекта.',unit:'услуга',qty:1,price:1000}],paid:false}
};

function sampleFor(key){
  const example=structuredClone(sample);
  if(key==='services'||key==='act-npd')return example;
  const ip=key==='supply-ip'||key==='invoice-ip';
  example.executor={...example.customer,kind:ip?'ip':'org',name:'Общество с ограниченной ответственностью «Пример»',shortName:'ООО «Пример»',fio:'Иванов Иван Иванович',signerPosition:'директор',inn:ip?'000000000000':'0000000000',ogrn:ip?'000000000000000':'0000000000000'};
  example.deal={...example.deal,type:ip?'supply':'services',subject:ip?'выставочных стендов для проекта «Пример»':'логистические услуги для проекта «Пример»',items:[{name:ip?'Выставочный стенд':'Логистические услуги',description:'Описание позиции для проверки шаблона.',unit:ip?'штука':'услуга',qty:2,price:1000}]};
  return example;
}
function matchesTemplate(key,deal,parties){
  const customer=parties.find(p=>p.id===deal.customerId),executor=parties.find(p=>p.id===deal.executorId),kind=documentKind(key);
  if(!customer||!executor||contractAvailability(deal,customer,executor))return false;
  return templateName(kind,deal,executor)===key;
}

export function renderTemplateManager(main,{data,save,back,toast}){
  let pending=null,busy=false,previewed=false;
  main.innerHTML=`<div class="main-scroll docs-page"><button class="btn ghost" data-back>← Документы</button><h1>Шаблоны документов</h1><p>Скачайте шаблон, измените текст или оформление в Word и загрузите его обратно. Сохраните поля в двойных фигурных скобках: сайт подставляет в них данные сделки.</p><p>После проверки и применения шаблон будет использоваться при следующих скачиваниях документов, в том числе для существующих сделок. Ранее скачанные файлы не изменятся.</p><div data-template-cards></div><section class="home-panel" data-template-review hidden></section><p class="docs-warn" data-template-error role="alert" hidden></p></div>`;
  main.querySelector('[data-back]').onclick=()=>{if(!busy)back();};
  const error=message=>{const el=main.querySelector('[data-template-error]');el.hidden=!message;el.textContent=message;};
  const entries=()=>data.templates||{};
  function cards(){main.querySelector('[data-template-cards]').innerHTML=Object.entries(EDITABLE_TEMPLATES).map(([key,title])=>{const entry=entries()[key];return `<section class="home-panel docs-template-card"><h2>${title}</h2><p>${entry?'Загружен: '+esc(entry.name)+' · '+esc(new Date(entry.updatedAt).toLocaleDateString('ru-RU')):'Встроенный образец от 11.10.2026'}</p><div class="docs-buttons"><button class="btn" data-template-download="${key}">Скачать для редактирования</button><label class="btn docs-upload">Загрузить обновленный DOCX<input type="file" accept=".docx" data-template-upload="${key}" aria-label="Загрузить ${title}"></label>${entry?`<button class="btn" data-template-restore="${key}">${entry.previous?'Вернуть предыдущую версию':'Вернуть встроенный образец'}</button>`:''}</div></section>`;}).join('');
    main.querySelectorAll('[data-template-download]').forEach(b=>b.onclick=async()=>{if(busy)return;busy=true;b.disabled=true;error('');try{const key=b.dataset.templateDownload;download(await editableTemplate(key,entries()[key]?templateBytes(entries()[key]):null),EDITABLE_TEMPLATES[key]+' — шаблон.docx');}catch(e){error(e.message);}finally{busy=false;b.disabled=false;}});
    main.querySelectorAll('[data-template-upload]').forEach(input=>input.onchange=async()=>{const file=input.files[0];if(!file||busy)return;busy=true;input.disabled=true;error('');pending=null;main.querySelector('[data-template-review]').hidden=true;try{if(!/\.docx$/i.test(file.name))throw new Error('Выберите файл DOCX.');if(file.size>MAX_BYTES)throw new Error('Выберите DOCX размером до 2 МБ.');const buffer=await prepareTemplate(input.dataset.templateUpload,await file.arrayBuffer());pending={key:input.dataset.templateUpload,buffer,name:file.name};review();}catch(e){error(e.message);}finally{busy=false;input.disabled=false;input.value='';}});
    main.querySelectorAll('[data-template-restore]').forEach(b=>b.onclick=async()=>{if(busy)return;const key=b.dataset.templateRestore,entry=entries()[key];if(!confirm('Вернуть '+(entry.previous?'предыдущую версию':'встроенный образец')+'? Следующие скачивания будут использовать ее.'))return;busy=true;b.disabled=true;error('');try{const next=structuredClone(entries());if(entry.previous)next[key]=entry.previous;else delete next[key];await save(next);data.templates=next;pending=null;main.querySelector('[data-template-review]').hidden=true;cards();toast('Шаблон восстановлен');}catch(e){error(e.message);}finally{busy=false;b.disabled=false;}});
  }
  function review(){
    previewed=false;const el=main.querySelector('[data-template-review]');el.hidden=false;
    const deals=(data.deals||[]).filter(d=>matchesTemplate(pending.key,d,data.parties||[]));
    el.innerHTML=`<h2>Проверьте перед применением</h2><p>${esc(pending.name)}: поля распознаны. Скачайте контрольный документ и проверьте текст, переносы и таблицы в Word.</p><label class="field"><span>Данные для проверки</span><select data-template-deal><option value="">Пример с вымышленными данными</option>${deals.map(d=>`<option value="${esc(d.id)}">№ ${esc(d.number)} · ${esc(d.subject)}</option>`).join('')}</select></label><button class="btn" data-template-preview>Скачать контрольный документ</button><label class="check-row"><input type="checkbox" data-template-checked disabled> Я проверила текст и оформление контрольного документа</label><div class="docs-buttons"><button class="btn primary" data-template-apply disabled>Применить шаблон</button><button class="btn" data-template-cancel>Отмена</button></div>`;
    const checkbox=el.querySelector('[data-template-checked]'),apply=el.querySelector('[data-template-apply]');
    checkbox.onchange=()=>apply.disabled=!previewed||!checkbox.checked;
    el.querySelector('[data-template-deal]').onchange=()=>{previewed=false;checkbox.checked=false;checkbox.disabled=true;apply.disabled=true;};
    el.querySelector('[data-template-preview]').onclick=async e=>{if(busy)return;busy=true;e.target.disabled=true;error('');try{const example=sampleFor(pending.key),deal=deals.find(d=>d.id===el.querySelector('[data-template-deal]').value),d=deal||example.deal,c=deal?data.parties.find(p=>p.id===d.customerId):example.customer,x=deal?data.parties.find(p=>p.id===d.executorId):example.executor;const fn=G[documentKind(pending.key)+'Docx'];download(await fn(d,c,x,pending.buffer),'Проверка — '+EDITABLE_TEMPLATES[pending.key]+'.docx');previewed=true;checkbox.disabled=false;}catch(err){error(err.message);}finally{busy=false;e.target.disabled=false;}};
    apply.onclick=async()=>{if(busy||!previewed||!checkbox.checked)return;busy=true;apply.disabled=true;error('');try{const next=structuredClone(entries()),old=next[pending.key];next[pending.key]={...templateRecord(pending.buffer,pending.name),previous:old?{name:old.name,data:old.data,updatedAt:old.updatedAt}:null};await save(next);data.templates=next;pending=null;el.hidden=true;cards();toast('Шаблон обновлен. Он будет использован при следующем скачивании.');}catch(e){error(e.message);}finally{busy=false;apply.disabled=false;}};
    el.querySelector('[data-template-cancel]').onclick=()=>{if(busy)return;pending=null;el.hidden=true;error('');};el.scrollIntoView({block:'start'});
  }
  cards();
}

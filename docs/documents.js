// «Документы»: party cards + deals → contract, invoice, act and UPD (docgen.js builds the files in the browser).
import {loadDocs,saveDocs} from './workspace-store.js?v=35';
import * as G from './docgen.js?v=35';

const esc=s=>String(s??'').replace(/[&<>"']/g,m=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m]));
const uid=()=>crypto.randomUUID?.()||Math.random().toString(36).slice(2)+Date.now().toString(36);
const today=()=>{const d=new Date();d.setMinutes(d.getMinutes()-d.getTimezoneOffset());return d.toISOString().slice(0,10)};
const TYPE_HINT={services:'результат — само действие: ведущий, аренда, логистика, консультация',works:'результат — созданная вещь или итог работы: изготовление, ремонт, монтаж',supply:'готовый товар: цветы, наборы, сувениры, канцелярия'};
const KIND_HINT={org:'ООО, НКО, общественная организация — ИНН из 10 цифр',ip:'индивидуальный предприниматель — ИНН из 12 цифр и ОГРНИП',npd:'самозанятый — договор, акт и чек из «Мой налог», без счёта и УПД',person:'гражданин без статуса — организация удерживает НДФЛ и платит взносы'};
const UNITS=['услуга','штука','комплект','набор','упаковка','час','килограмм','метр','литр','лист','экземпляр','пара'];

export function createDocumentsUI(ctx){
  let data=null,tab='deals',editing=null,saveTimer=null,loadError='',loading=null,saving=Promise.resolve(),dirty=false,renderGeneration=0,pendingSaves=0,saveFailed=false;
  const workspace=()=>ctx.getState?.()||{projects:[],tasks:[],organizations:[]};
  const currentProject=()=>ctx.getProject?.()||'all';
  const visibleDeals=()=>deals().filter(d=>!['all','inbox'].includes(currentProject())?d.projectId===currentProject():true);
  const parties=()=>data.parties,deals=()=>data.deals,party=id=>data.parties.find(p=>p.id===id);
  const title=p=>p?G.partyTitle(p):'—';
  async function ensure(){if(data)return;if(!loading)loading=loadDocs().then(x=>{data=x||{};data.version=1;data.parties??=[];data.deals??=[];}).catch(e=>{loadError=e.message;throw e;}).finally(()=>loading=null);await loading;}
  function saveState(text){document.querySelectorAll('[data-doc-save]').forEach(el=>el.textContent=text);}
  function persist(){dirty=true;saveState('Сохраняем…');clearTimeout(saveTimer);saveTimer=setTimeout(()=>flush().catch(e=>ctx.toast(e.message)),500);}
  async function flush(){
    clearTimeout(saveTimer);if(saveFailed)throw new Error(loadError+' Скопируйте введённые данные и обновите страницу.');if(!dirty)return saving;
    const snapshot=structuredClone(data);dirty=false;pendingSaves++;
    saving=saving.then(()=>saveDocs(snapshot));
    try{await saving;saveState(dirty?'Сохраняем…':'Сохранено');}catch(e){dirty=true;saveFailed=true;loadError=e.message;saveState('Не сохранено · '+e.message);throw e;}finally{pendingSaves--;}
  }
  function route(){ctx.routeChanged?.();}
  function writeRoute(q){if(tab==='parties')q.set('docsTab','parties');if(editing){q.set(editing.kind,editing.id);if(editing.returnTo)q.set('returnTo',editing.returnTo);if(editing.step)q.set('step',editing.step);}}
  function restoreRoute(q){tab=q.get('docsTab')==='parties'?'parties':'deals';editing=q.get('party')?{kind:'party',id:q.get('party'),returnTo:q.get('returnTo')||''}:q.get('deal')?{kind:'deal',id:q.get('deal'),step:Math.min(3,Math.max(1,+q.get('step')||1))}:null;}
  function newDeal(task){
    const projectId=task?.projectId||(!['all','inbox'].includes(currentProject())?currentProject():'');
    const own=parties().filter(p=>p.own),previous=deals().find(d=>d.projectId===projectId&&party(d.customerId)?.own);
    const d={id:uid(),projectId,taskId:task?.id||'',type:'services',customerId:previous?.customerId||(own.length===1?own[0].id:''),executorId:'',number:'',date:today(),city:'Казань',subject:'',period:'',deadline:'',payDays:15,items:[{id:uid(),name:'',description:'',unit:'услуга',qty:1,price:0}],paid:false,createdAt:new Date().toISOString()};
    data.deals.unshift(d);persist();editing={kind:'deal',id:d.id,step:1};
    if(!own.length){const p={id:uid(),own:true,kind:'org',signerPosition:'директор',basis:'устава'};data.parties.push(p);d.customerId=p.id;editing={kind:'party',id:p.id,returnTo:d.id};persist();}
    return d;
  }
  async function mountLinks(el,t){
    const target=document.createElement('section');target.className='ins-section task-documents';target.innerHTML='<h3>Документы</h3><p>Загружаем…</p>';el.querySelector('.inspector-inner')?.append(target);
    try{await ensure();if(!target.isConnected)return;const linked=deals().filter(d=>t.id?d.taskId===t.id:d.projectId===t.projectId);
      target.innerHTML=`<h3>Документы ${t.id?'задачи':'проекта'}</h3>${linked.map(d=>`<p><a href="#view=docs&deal=${encodeURIComponent(d.id)}${d.projectId?'&project='+encodeURIComponent(d.projectId):''}">${esc(d.subject||'Комплект документов')}${d.number?' · № '+esc(d.number):''}</a></p>`).join('')||'<p>Документов пока нет.</p>'}${t.id?'<button class="btn" data-create-doc>Создать документы</button>':''}`;
      target.querySelector('[data-create-doc]')?.addEventListener('click',async()=>{try{newDeal(t);await flush();location.hash='view=docs&deal='+encodeURIComponent(editing.kind==='party'?editing.returnTo:editing.id)+(t.projectId?'&project='+encodeURIComponent(t.projectId):'')+(editing.kind==='party'?'&party='+encodeURIComponent(editing.id)+'&returnTo='+encodeURIComponent(editing.returnTo):'');}catch(e){ctx.toast(e.message);}});
    }catch(e){if(target.isConnected)target.querySelector('p').textContent=e.message;}
  }
  async function render(main){
    main.innerHTML='<div class="main-scroll"><div class="loading-state">Открываю документы…</div></div>';
    const generation=++renderGeneration;try{await ensure();}catch(e){main.innerHTML='<div class="main-scroll"><h1>Документы не загрузились</h1><p class="docs-warn"></p></div>';main.querySelector('p').textContent=e.message;return;}if(generation!==renderGeneration||!main.isConnected)return;
    if(editing?.kind==='deal')return renderDeal(main,editing.id);
    if(editing?.kind==='party')return renderParty(main,editing.id);
    route();
    main.innerHTML=`<div class="main-scroll docs-page"><div class="page-head"><div><div class="eyebrow">Договоры · счета · акты · УПД</div><h1>Документы</h1>${!['all','inbox'].includes(currentProject())?`<p>${esc(workspace().projects.find(p=>p.id===currentProject())?.name||'Проект')} · <button class="link" data-all-docs>Все документы</button></p>`:''}<p>Карточки сторон заполняются один раз — дальше комплект документов собирается из сделки.</p></div><button class="btn primary" data-new-deal >Создать документы</button></div>${loadError?`<div class="docs-warn">${esc(loadError)}</div>`:''}<div class="docs-tabs" role="tablist"><button class="${tab==='deals'?'active':''}" data-tab="deals">Сделки <span>${visibleDeals().length}</span></button><button class="${tab==='parties'?'active':''}" data-tab="parties">Организации и контрагенты <span>${parties().length}</span></button></div>${tab==='deals'?dealsList():partiesList()}</div>`;
    main.querySelector('[data-all-docs]')?.addEventListener('click',()=>ctx.showAll?.());
    main.querySelectorAll('[data-tab]').forEach(b=>b.onclick=()=>{tab=b.dataset.tab;render(main)});
    main.querySelector('[data-new-deal]')?.addEventListener('click',()=>{newDeal();render(main);});
    main.querySelectorAll('[data-deal]').forEach(b=>b.onclick=()=>{editing={kind:'deal',id:b.dataset.deal,step:1};render(main)});
    main.querySelectorAll('[data-party]').forEach(b=>b.onclick=()=>{editing={kind:'party',id:b.dataset.party};render(main)});
    main.querySelectorAll('[data-new-party]').forEach(b=>b.onclick=()=>{const p={id:uid(),own:b.dataset.newParty==='own',kind:'org',signerPosition:'директор',basis:'устава'};data.parties.push(p);persist();editing={kind:'party',id:p.id};render(main)});
  }

  function dealsList(){
    if(!parties().some(p=>p.own))return `<section class="home-panel docs-empty"><h2>С чего начать</h2><ol><li>Нажмите «Создать документы» и заполните свою организацию один раз.</li><li>Добавьте исполнителя: организацию, ИП или самозанятого.</li><li>Создайте сделку: тип, предмет, спецификация — и скачайте комплект документов.</li></ol></section>`;
    if(!visibleDeals().length)return '<section class="home-panel docs-empty"><h2>Сделок пока нет</h2><p>Нажмите «Создать документы» — договор, счёт, акт и УПД соберутся из неё.</p></section>';
    return `<section class="home-panel docs-list">${visibleDeals().map(d=>{const e=party(d.executorId),c=party(d.customerId),warn=G.checkDeal(d,c,e).filter(w=>!/черновик/.test(w)).length;return `<button class="docs-row" data-deal="${d.id}"><span class="docs-type t-${d.type}">${G.DEAL_TYPES[d.type].short}</span><span class="docs-main"><b>${esc(d.subject||'Без предмета')}</b><small>${d.number?'№ '+esc(d.number)+' · ':''}${esc(title(e))} → ${esc(title(c))}</small></span><span class="docs-sum">${G.money(G.sumItems(d.items))} ₽</span><span class="docs-state ${warn?'warn':'ok'}">${warn?`${warn} ${G.plural(warn,'замечание','замечания','замечаний')}`:'готово'}</span></button>`}).join('')}</section>`;
  }
  function partiesList(){
    const card=p=>{const w=G.checkParty(p).length;return `<button class="docs-card" data-party="${p.id}"><span class="docs-kind k-${p.kind}">${G.PARTY_KINDS[p.kind]}</span><b>${esc(title(p)||'Новая карточка')}</b><small>${p.inn?'ИНН '+esc(p.inn):'ИНН не указан'}</small><em class="${w?'warn':'ok'}">${w?`${w} ${G.plural(w,'замечание','замечания','замечаний')}`:'реквизиты в порядке'}</em></button>`};
    return `<section class="home-panel"><div class="home-panel-head"><div><span class="eyebrow">От чьего имени заключаем</span><h2>Наши организации</h2></div><button class="btn" data-new-party="own">+ Добавить</button></div><div class="docs-cards">${parties().filter(p=>p.own).map(card).join('')||'<p class="home-empty">Добавьте свою организацию — она будет заказчиком в договорах.</p>'}</div></section><section class="home-panel"><div class="home-panel-head"><div><span class="eyebrow">Исполнители и поставщики</span><h2>Контрагенты</h2></div><button class="btn" data-new-party="other">+ Добавить</button></div><div class="docs-cards">${parties().filter(p=>!p.own).map(card).join('')||'<p class="home-empty">Пока никого. Добавьте организацию, ИП или самозанятого.</p>'}</div></section>`;
  }

  // ---------- party editor ----------
  function renderParty(main,id){
    const p=party(id);if(!p){editing=null;return render(main)}
    const f=(key,label,o={})=>`<label class="field ${o.wide?'wide':''}"><span>${label}</span>${o.area?`<textarea data-k="${key}" rows="2" placeholder="${esc(o.ph||'')}">${esc(p[key]||'')}</textarea>`:`<input data-k="${key}" value="${esc(p[key]||'')}" placeholder="${esc(o.ph||'')}" ${o.type?`type="${o.type}"`:''} ${o.mode?`inputmode="${o.mode}"`:''}>`}${o.hint?`<small>${o.hint}</small>`:''}</label>`;
    const person=p.kind!=='org';
    main.innerHTML=`<div class="main-scroll docs-page"><button class="btn ghost docs-back" data-back>${editing?.returnTo?'Продолжить со сделкой →':'← Все стороны'}</button><div class="page-head"><div><div class="eyebrow">${p.own?'Наша организация':'Контрагент'}</div><small data-doc-save role="status">${dirty||pendingSaves?'Сохраняем…':'Сохранено'}</small><h1>${esc(title(p)||'Новая карточка')}</h1></div><button class="btn" data-del>Удалить</button></div>
    <section class="home-panel docs-form"><h2>Кто это</h2><div class="docs-seg">${Object.entries(G.PARTY_KINDS).map(([k,n])=>`<button class="${p.kind===k?'active':''}" data-kind="${k}"><b>${n}</b><small>${KIND_HINT[k]}</small></button>`).join('')}</div><label class="check-row"><input type="checkbox" data-own ${p.own?'checked':''}> Это наша организация — выступает заказчиком</label></section>
    <section class="home-panel docs-form"><h2>${person?'Человек':'Организация и подписант'}</h2><div class="docs-grid">${person?`${f('fio','ФИО полностью',{wide:true,ph:'Иванова Мария Петровна'})}<label class="field"><span>Пол (для согласования слов)</span><select data-k="gender"><option value="">определить по отчеству</option><option value="m" ${p.gender==='m'?'selected':''}>мужской</option><option value="f" ${p.gender==='f'?'selected':''}>женский</option></select></label>`:`${f('name','Полное название',{wide:true,ph:'Общество с ограниченной ответственностью «Ромашка»'})}${f('shortName','Краткое название для реквизитов',{wide:true,ph:'если не указано — полное название'})}${f('signer','Руководитель (ФИО полностью)',{ph:'Соколов Сергей Владимирович'})}${f('signerPosition','Должность',{ph:'директор / председатель'})}${f('basis','Действует на основании',{ph:'устава',hint:'родительный падеж: «устава», «доверенности № 5 от 01.02.2026»'})}${f('signerGen','В лице (родительный падеж)',{ph:G.fioGenitive(p.signer||''),hint:'заполнено автоматически — исправьте, если склонение неточное'})}<label class="field"><span>Пол руководителя</span><select data-k="signerGender"><option value="">определить по отчеству</option><option value="m" ${p.signerGender==='m'?'selected':''}>мужской</option><option value="f" ${p.signerGender==='f'?'selected':''}>женский</option></select></label>${f('accountant','Главный бухгалтер (для УПД)',{ph:'если не указан — руководитель'})}`}</div></section>
    <section class="home-panel docs-form"><h2>Реквизиты</h2><div class="docs-grid">${f('inn','ИНН',{mode:'numeric'})}${p.kind==='org'?f('kpp','КПП',{mode:'numeric'}):''}${p.kind==='org'||p.kind==='ip'?f('ogrn',p.kind==='ip'?'ОГРНИП':'ОГРН',{mode:'numeric'}):''}${p.kind==='npd'?f('npdDate','Плательщик НПД с',{type:'date'})+f('npdNumber','Номер постановки на учёт',{hint:'в «Мой налог» → Прочее → Справки'}):''}${p.kind==='npd'||p.kind==='person'?f('passport','Паспорт',{wide:true,ph:'0000 000000, выдан 01.01.2020 МВД по Республике Татарстан'}):''}${f('address','Адрес',{wide:true,area:true})}${f('account','Расчётный счёт',{mode:'numeric'})}${f('bik','БИК',{mode:'numeric'})}${f('bank','Банк',{wide:true})}${f('corr','Корр. счёт',{mode:'numeric'})}${f('email','E-mail',{type:'email'})}${f('phone','Телефон',{type:'tel'})}</div>${p.kind==='org'||p.kind==='ip'?`<label class="check-row"><input type="checkbox" data-vat ${p.vat?'checked':''}> Плательщик НДС</label><label class="field docs-vat" ${p.vat?'':'hidden'}><span>Ставка НДС, %</span><select data-k="vatRate">${[20,10,7,5].map(r=>`<option ${+p.vatRate===r?'selected':''}>${r}</option>`).join('')}</select></label>`:''}</section>
    <section class="home-panel docs-preview"><h2>Так будет в договоре</h2><p data-preamble></p><ul data-checks></ul></section></div>`;
    const sync=()=>{main.querySelector('[data-preamble]').textContent=G.partyPreamble(p,p.own?'Заказчик':'Исполнитель');const w=G.checkParty(p);main.querySelector('[data-checks]').innerHTML=w.map(x=>`<li class="warn">${esc(x)}</li>`).join('')||'<li class="ok">Реквизиты прошли проверку: длина и контрольные суммы ИНН, ОГРН, счетов и БИК.</li>';main.querySelector('h1').textContent=title(p)||'Новая карточка'};
    main.querySelectorAll('[data-k]').forEach(el=>el.oninput=()=>{p[el.dataset.k]=el.value.trim();if(el.dataset.k==='signer'){const g=main.querySelector('[data-k="signerGen"]');if(g&&!g.dataset.touched){p.signerGen='';g.placeholder=G.fioGenitive(p.signer)}}if(el.dataset.k==='signerGen')el.dataset.touched='1';persist();sync()});
    main.querySelectorAll('[data-kind]').forEach(b=>b.onclick=()=>{p.kind=b.dataset.kind;persist();renderParty(main,id)});
    main.querySelector('[data-own]').onchange=e=>{p.own=e.target.checked;persist();sync()};
    main.querySelector('[data-vat]')?.addEventListener('change',e=>{p.vat=e.target.checked;p.vatRate??=20;main.querySelector('.docs-vat').hidden=!p.vat;persist();sync()});
    main.querySelector('[data-back]').onclick=()=>{const back=editing?.returnTo;editing=back?{kind:'deal',id:back,step:1}:null;tab=back?'deals':'parties';render(main)};
    main.querySelector('[data-del]').onclick=()=>{if(deals().some(d=>d.customerId===id||d.executorId===id))return ctx.toast('Карточка используется в сделках — сначала удалите их');if(!confirm('Удалить карточку?'))return;data.parties=data.parties.filter(x=>x.id!==id);persist();editing=null;render(main)};
    route();sync();
  }

  // ---------- deal editor ----------
  function renderDeal(main,id){
    const d=deals().find(x=>x.id===id);if(!d){editing=null;return render(main)}
    const own=parties().filter(p=>p.own),others=parties().filter(p=>!p.own);
    const opt=(list,sel)=>`<option value="">— выберите —</option>`+list.map(p=>`<option value="${p.id}" ${p.id===sel?'selected':''}>${esc(title(p)||'Без названия')} · ${G.PARTY_KINDS[p.kind]}</option>`).join('');
    const t=G.DEAL_TYPES[d.type];
    const step=Math.min(3,Math.max(1,editing?.step||1));editing={kind:'deal',id,step};route();
    main.innerHTML=`<div class="main-scroll docs-page"><button class="btn ghost docs-back" data-back>← Все сделки</button>${d.taskId&&workspace().tasks.some(t=>t.id===d.taskId)?'<button class="btn ghost" data-source-task>Вернуться к задаче</button>':''}<div class="page-head"><div><div class="eyebrow">Комплект документов</div><small data-doc-save role="status">${dirty||pendingSaves?'Сохраняем…':'Сохранено'}</small><h1>${esc(d.subject||'Новая сделка')}</h1></div><button class="btn" data-copy>Повторить сделку</button><button class="btn" data-del>Удалить</button></div>
    <nav class="docs-steps" aria-label="Подготовка документов">${['Стороны','Предмет и стоимость','Документы'].map((name,i)=>`<button class="btn ${step===i+1?'primary':''}" data-step="${i+1}" aria-current="${step===i+1?'step':'false'}">${i+1}. ${name}</button>`).join('')}</nav>
    <section class="home-panel docs-form" data-doc-step="1"><h2>Проект и задача</h2><div class="docs-grid"><label class="field"><span>Проект</span><select data-f="projectId"><option value="">Без проекта</option>${workspace().projects.map(p=>`<option value="${esc(p.id)}" ${p.id===d.projectId?'selected':''}>${esc(p.name)}</option>`).join('')}</select></label><label class="field"><span>Задача</span><select data-f="taskId"><option value="">Без задачи</option>${workspace().tasks.filter(t=>t.projectId===(d.projectId||'')).map(t=>`<option value="${esc(t.id)}" ${t.id===d.taskId?'selected':''}>${esc(t.title)}</option>`).join('')}</select></label></div></section>
    <section class="home-panel docs-form" data-doc-step="2"><h2>Что покупаем</h2><div class="docs-seg three">${Object.entries(G.DEAL_TYPES).map(([k,v])=>`<button class="${d.type===k?'active':''}" data-type="${k}"><b>${v.short}${v.draft?' <i>черновик</i>':''}</b><small>${TYPE_HINT[k]}</small></button>`).join('')}</div></section>
    <section class="home-panel docs-form" data-doc-step="1"><h2>Стороны</h2><div class="docs-grid"><label class="field"><span>${t.cust} (наша организация)</span><select data-f="customerId">${opt(own,d.customerId)}</select><small><button class="link" data-new-own>+ наша организация</button> · <button class="link" data-edit-own>Реквизиты</button></small></label><label class="field"><span>${t.exec}</span><select data-f="executorId">${opt(others,d.executorId)}</select><small><button class="link" data-new-exec>+ новый контрагент</button> · <button class="link" data-edit-exec>Реквизиты</button></small></label></div><p class="docs-note" data-exec-note></p></section>
    <section class="home-panel docs-form" data-doc-step="2"><h2>Договор</h2><div class="docs-grid"><label class="field"><span>Номер</span><input data-f="number" value="${esc(d.number)}" placeholder="04-26/1"></label><label class="field"><span>Дата</span><input type="date" data-f="date" value="${esc(d.date)}"></label><label class="field"><span>Город</span><input data-f="city" value="${esc(d.city)}"></label><label class="field"><span>${t.term}</span><input type="date" data-f="deadline" value="${esc(d.deadline)}"></label><label class="field wide"><span>Предмет: что и для чего</span><textarea data-f="subject" rows="2" placeholder="услуги по логистике и аренде звука для молодежной поэтической акции, приуроченной ко Дню Победы">${esc(d.subject)}</textarea><small>Продолжает фразу «${t.exec} обязуется ${t.verb} ${t.objAcc} согласно Спецификации: …»</small></label><label class="field wide"><span>Период (необязательно)</span><input data-f="period" value="${esc(d.period)}" placeholder="в период с 28 апреля по 20 мая 2026 года"></label><label class="field"><span>Оплата в течение, рабочих дней</span><input type="number" min="1" data-f="payDays" value="${esc(d.payDays)}"></label></div></section>
    <section class="home-panel docs-form" data-doc-step="2"><h2>Спецификация</h2><div class="docs-items" data-items></div><button class="btn" data-add-item>+ Позиция</button><p class="docs-total" data-total></p></section>
    <details class="home-panel docs-form" data-doc-step="3"><summary>Даты и номера счёта, акта и УПД</summary><div class="docs-grid"><label class="field"><span>Номер счёта</span><input data-f="invoiceNumber" value="${esc(d.invoiceNumber||'')}" placeholder="как в договоре"></label><label class="field"><span>Дата счёта</span><input type="date" data-f="invoiceDate" value="${esc(d.invoiceDate||'')}"><small>если пусто — дата договора</small></label><label class="field"><span>Номер УПД</span><input data-f="updNumber" value="${esc(d.updNumber||'')}" placeholder="как в договоре"></label><label class="field"><span>Дата акта и УПД</span><input type="date" data-f="actDate" value="${esc(d.actDate||'')}"><small>если пусто — ${t.term.toLowerCase()}</small></label><label class="check-row"><input type="checkbox" data-paid ${d.paid?'checked':''}> Оплачено — в акте будет «оплатил в полном объёме»</label></div></details>
    <section class="home-panel docs-check" data-doc-step="3"><h2>Проверка</h2><ul data-checks></ul></section>
    <section class="home-panel docs-out" data-doc-step="3"><h2>Скачать</h2><p class="docs-note">Договоры, счета и УПД — по вашим образцам. Акт — в оформлении договора.</p><div class="docs-buttons" data-out></div></section><footer class="docs-footer"><span data-step-hint></span><div><button class="btn" data-prev-step>Назад</button><button class="btn primary" data-next-step>Далее</button></div></footer></div>`;
    main.querySelectorAll('[data-doc-step]').forEach(el=>el.hidden=+el.dataset.docStep!==step);
    const itemsEl=main.querySelector('[data-items]');
    const drawItems=()=>{itemsEl.innerHTML=`<div class="docs-item head"><span>Наименование</span><span>Описание</span><span>Ед.</span><span>Кол-во</span><span>Цена, ₽</span><span>Сумма</span><span></span></div>`+d.items.map((it,i)=>`<div class="docs-item" data-i="${i}"><input data-it="name" value="${esc(it.name)}" placeholder="Аренда звукового комплекса" aria-label="Наименование"><input data-it="description" value="${esc(it.description||'')}" placeholder="подробности для спецификации" aria-label="Описание"><input data-it="unit" list="docs-units" value="${esc(it.unit)}" aria-label="Единица"><input data-it="qty" type="number" min="0" step="any" value="${esc(it.qty)}" aria-label="Количество"><input data-it="price" type="number" min="0" step="any" value="${esc(it.price)}" aria-label="Цена"><b data-sum>${G.money((+it.qty||0)*(+it.price||0))}</b><button class="icon-btn" data-rm aria-label="Удалить позицию">×</button></div>`).join('')+`<datalist id="docs-units">${UNITS.map(u=>`<option value="${u}">`).join('')}</datalist>`;
      itemsEl.querySelectorAll('[data-it]').forEach(el=>el.oninput=()=>{const it=d.items[+el.closest('[data-i]').dataset.i];it[el.dataset.it]=el.type==='number'?+el.value:el.value;el.closest('[data-i]').querySelector('[data-sum]').textContent=G.money((+it.qty||0)*(+it.price||0));changed()});
      itemsEl.querySelectorAll('[data-rm]').forEach(b=>b.onclick=()=>{d.items.splice(+b.closest('[data-i]').dataset.i,1);drawItems();changed()})};
    const changed=(save=true)=>{if(save){d.updatedAt=new Date().toISOString();persist();}const c=party(d.customerId),e=party(d.executorId),total=G.sumItems(d.items);
      main.querySelector('[data-total]').textContent=`Итого: ${G.money(total)} ₽${e?' · '+G.vatLine(total,e):''}`;
      main.querySelector('[data-exec-note]').textContent=e?`${G.PARTY_KINDS[e.kind]}: ${KIND_HINT[e.kind]}.`:'';
      const w=G.checkDeal(d,c,e);main.querySelector('[data-step-hint]').textContent=step===3?(w.filter(x=>!/черновик|НДФЛ/.test(x)).length?'Проверьте замечания перед скачиванием':'Можно скачивать'):`Шаг ${step} из 3 · изменения сохраняются автоматически`;main.querySelector('[data-checks]').innerHTML=w.map(x=>`<li class="${/черновик|НДФЛ/.test(x)?'info':'warn'}">${esc(x)}</li>`).join('')||'<li class="ok">Всё проверено: реквизиты, суммы и даты сходятся.</li>';
      const set=G.documentSet(e);main.querySelector('[data-out]').innerHTML=set.length&&c?set.map(s=>`<button class="btn ${s.id==='contract'?'primary':''}" data-make="${s.id}">${s.title} <small>.${s.ext}</small></button>`).join(''):'<p class="home-empty">Выберите заказчика и исполнителя.</p>';
      main.querySelectorAll('[data-make]').forEach(b=>b.onclick=async()=>{b.disabled=true;try{await flush();await make(b.dataset.make,structuredClone(d),structuredClone(c),structuredClone(e),w)}catch(e){ctx.toast(e.message);}finally{b.disabled=false}})};
    main.querySelectorAll('[data-f]').forEach(el=>el.oninput=()=>{d[el.dataset.f]=el.type==='number'?+el.value:el.value;if(el.dataset.f==='projectId'){d.taskId='';persist();renderDeal(main,id);return;}if(el.dataset.f==='subject')main.querySelector('h1').textContent=d.subject||'Новая сделка';changed()});
    main.querySelectorAll('select[data-f]').forEach(el=>el.onchange=el.oninput);
    main.querySelectorAll('[data-type]').forEach(b=>b.onclick=()=>{d.type=b.dataset.type;for(const it of d.items)if(!it.name&&!it.price)it.unit=d.type==='services'?'услуга':'штука';persist();renderDeal(main,id)});
    main.querySelector('[data-paid]').onchange=e=>{d.paid=e.target.checked;changed()};
    main.querySelector('[data-add-item]').onclick=()=>{d.items.push({id:uid(),name:'',description:'',unit:d.type==='services'?'услуга':'штука',qty:1,price:0});drawItems();changed();itemsEl.querySelector('.docs-item:last-of-type input')?.focus()};
    main.querySelector('[data-new-exec]').onclick=e=>{e.preventDefault();const p={id:uid(),own:false,kind:'org',signerPosition:'директор',basis:'устава'};data.parties.push(p);d.executorId=p.id;persist();editing={kind:'party',id:p.id,returnTo:id};renderParty(main,p.id)};
    main.querySelector('[data-back]').onclick=()=>{editing=null;tab='deals';render(main)};
    main.querySelector('[data-del]').onclick=()=>{if(!confirm('Удалить сделку?'))return;data.deals=data.deals.filter(x=>x.id!==id);persist();editing=null;render(main)};
    const goStep=n=>{editing.step=n;renderDeal(main,id);main.querySelector('.main-scroll').scrollTop=0;};
    main.querySelectorAll('[data-step]').forEach(b=>b.onclick=()=>goStep(+b.dataset.step));
    main.querySelector('[data-prev-step]').hidden=step===1;main.querySelector('[data-prev-step]').onclick=()=>goStep(step-1);
    main.querySelector('[data-next-step]').hidden=step===3;main.querySelector('[data-next-step]').textContent=step===2?'К документам':'Далее';main.querySelector('[data-next-step]').onclick=()=>goStep(step+1);
    main.querySelector('[data-source-task]')?.addEventListener('click',async()=>{try{await flush();ctx.openTask(d.taskId);}catch(e){ctx.toast(e.message);}});
    main.querySelector('[data-copy]').onclick=()=>{const copy=structuredClone(d);Object.assign(copy,{id:uid(),number:'',date:today(),deadline:'',period:'',invoiceNumber:'',invoiceDate:'',updNumber:'',actDate:'',paid:false,taskId:'',createdAt:new Date().toISOString(),updatedAt:new Date().toISOString()});copy.items=copy.items.map(i=>({...i,id:uid()}));data.deals.unshift(copy);editing={kind:'deal',id:copy.id,step:2};persist();render(main);ctx.toast('Копия создана. Проверьте номер, сроки и стоимость.');};
    main.querySelector('[data-new-own]').onclick=()=>{const p={id:uid(),own:true,kind:'org',signerPosition:'директор',basis:'устава'};data.parties.push(p);d.customerId=p.id;persist();editing={kind:'party',id:p.id,returnTo:id};renderParty(main,p.id);};
    for(const [key,field] of [['own','customerId'],['exec','executorId']])main.querySelector(`[data-edit-${key}]`).onclick=()=>{if(!party(d[field]))return ctx.toast('Сначала выберите сторону');editing={kind:'party',id:d[field],returnTo:id};renderParty(main,d[field]);};
    drawItems();changed(false);
  }

  async function make(kind,d,c,e,warnings){
    const serious=warnings.filter(w=>!/черновик|НДФЛ/.test(w));
    if(serious.length&&!confirm(`Есть замечания (${serious.length}):\n\n• ${serious.slice(0,6).join('\n• ')}\n\nВсё равно скачать документ?`))return;
    try{
      let blob;
      if(kind==='contract')blob=await G.contractDocx(d,c,e);
      if(kind==='invoice')blob=await G.invoiceDocx(d,c,e);
      if(kind==='act')blob=await G.actDocx(d,c,e);
      if(kind==='upd'){const url=new URL('./templates/upd.xlsx',import.meta.url);url.search=new URL(import.meta.url).search;const r=await fetch(url);if(!r.ok)throw new Error('Не найден шаблон УПД');blob=G.updXlsx(await r.arrayBuffer(),d,c,e)}
      const names={contract:'Договор',invoice:'Счет',act:'Акт',upd:'УПД'},who=(e.kind==='org'?(e.name.match(/«([^»]+)»/)?.[1]||e.name):e.fio||'').slice(0,40);
      const number=(kind==='invoice'?d.invoiceNumber:kind==='upd'?d.updNumber:'')||d.number||'б-н';
      const file=`${names[kind]} ${number} ${who}`.replace(/[\\/:*?"<>|]+/g,'-').trim()+(kind==='upd'?'.xlsx':'.docx');
      const a=document.createElement('a');a.href=URL.createObjectURL(blob);a.download=file;document.body.append(a);a.click();setTimeout(()=>{URL.revokeObjectURL(a.href);a.remove()},2000);
      ctx.toast(`Готово: ${file}`);
    }catch(err){ctx.toast(err.message)}
  }
  return {render,mountLinks,writeRoute,restoreRoute,flush,isPending:()=>dirty||pendingSaves>0,cancelRender(){renderGeneration++;},reset(){editing=null;tab='deals';}};
}

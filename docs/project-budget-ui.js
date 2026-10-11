import * as G from './docgen.js?v=52';
import {BUDGET_FORMATS,budgetFormat,budgetGroups,budgetItemLinks,lineAmount,projectDeals,registryRows} from './project-budget.js?v=52';
import {estimateDocx,registryDocx} from './project-docx.js?v=52';
import {projectCode,projectDocumentFilename} from './document-library.js?v=52';
const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const units=['услуга','штука','комплект','набор','час','день','месяц','поездка','экземпляр','рубль'];
const field=(e,key,label,type='text')=>`<label class="field"><span>${label}</span><input data-budget-field="${key}" type="${type}" value="${esc(e[key]||'')}"></label>`;
function download(blob,name){const a=document.createElement('a');a.href=URL.createObjectURL(blob);a.download=name;document.body.append(a);a.click();setTimeout(()=>{URL.revokeObjectURL(a.href);a.remove();},2000);}
export function renderProjectBudget(main,{estimate:e,folder,data,view='estimate',persist,flush,back,remove,onView,createDeal,openDeal,openParties,toast}){
 let selected=new Set(),busy=false;
 const customer=()=>data.parties.find(p=>p.id===e.customerId);
 const save=()=>{e.updatedAt=new Date().toISOString();persist();};
 const links=()=>budgetItemLinks(e,data.deals);
 main.innerHTML=`<div class="main-scroll docs-page budget-page"><button class="btn ghost" data-budget-back>← ${esc(folder.name)}</button><div class="page-head"><div><small>${esc(folder.organization)} · ${esc(projectCode(folder))} · <span data-doc-save>Сохранено</span></small><h1>${view==='register'?'Реестр документов':'Смета проекта'}</h1><p>${esc(folder.name)} · ${esc(e.year)}</p></div><button class="btn primary" data-budget-download>${view==='register'?'Скачать реестр':'Скачать смету'} .docx</button></div><div class="docs-tabs"><button data-budget-view="estimate" class="${view==='estimate'?'active':''}">1. Смета</button><button data-budget-view="deals">2. Договоры</button><button data-budget-view="register" class="${view==='register'?'active':''}">3. Реестр</button></div>
 <details class="home-panel" ${!e.items.length?'open':''}><summary>Оформление и реквизиты</summary><div class="docs-grid">
 ${field(e,'year','Год проекта','number')}<label class="field"><span>Наша организация</span><select data-budget-field="customerId"><option value="">Выберите организацию</option>${data.parties.filter(p=>p.own&&p.kind==='org').map(p=>`<option value="${esc(p.id)}" ${p.id===e.customerId?'selected':''}>${esc(G.partyShortTitle(p))}</option>`).join('')}</select><small>Реестр включает договоры этой организации в папке проекта за выбранный год. <button class="link" data-budget-parties>Добавить или изменить организацию</button></small></label>
 <label class="field"><span>Вид сметы</span><select data-budget-format>${Object.entries(BUDGET_FORMATS).map(([k,v])=>`<option value="${k}" ${e.format===k?'selected':''}>${v.title}</option>`).join('')}</select></label>${field(e,'heading','Заголовок сметы')}
 <label class="field wide"><span>Подзаголовок сметы субсидии</span><textarea data-budget-field="subtitle" rows="2">${esc(e.subtitle||'')}</textarea></label><label class="field wide"><span>Название проекта в реестре</span><textarea data-budget-field="registryTitle" rows="2">${esc(e.registryTitle||'')}</textarea></label>
 ${field(e,'agreementNumber','Номер соглашения (для приложения)')}${field(e,'agreementDate','Дата соглашения','date')}${field(e,'signerPosition','Должность в подписи (если отличается от карточки)')}${field(e,'signerName','Инициалы и фамилия (если отличаются от карточки)')}
 </div><button class="btn ghost" data-budget-delete>Удалить смету</button></details><div data-budget-summary class="home-panel"></div><div data-budget-content></div><p class="docs-warn" data-budget-error hidden role="alert"></p></div>`;
 main.querySelector('[data-budget-back]').onclick=back;
 main.querySelector('[data-budget-parties]').onclick=openParties;
 main.querySelector('[data-budget-delete]').onclick=remove;
 main.querySelectorAll('[data-budget-view]').forEach(b=>b.onclick=()=>b.dataset.budgetView==='deals'?back():onView(b.dataset.budgetView));
 const error=s=>{const el=main.querySelector('[data-budget-error]');el.hidden=!s;el.textContent=s;};
 const summary=()=>{
  const total=G.sumItems(e.items),deals=projectDeals(e,data.deals),contractTotal=G.sumItems(deals.flatMap(d=>d.items||[])),difference=Math.round((total-contractTotal)*100)/100;
  main.querySelector('[data-budget-summary]').innerHTML=`<div class="budget-totals"><span>Смета <b>${G.money(total)} ₽</b></span><span>По договорам <b>${G.money(contractTotal)} ₽</b></span><span>${difference<0?'Превышение':'Остаток'} <b>${G.money(Math.abs(difference))} ₽</b></span></div><small>Договоры учитываются по папке, году и выбранной организации. Сумма договора считается один раз.</small>`;
 };
 const render=()=>{summary();view==='register'?renderRegister():renderEstimate();};
 main.querySelectorAll('[data-budget-field]').forEach(el=>{
  el.oninput=()=>{e[el.dataset.budgetField]=el.value;save();summary();if(view==='register')renderRegister();};
  if(el.tagName==='SELECT'||el.dataset.budgetField==='year')el.onchange=()=>{el.oninput();selected.clear();render();};
 });
 main.querySelector('[data-budget-format]').onchange=ev=>{
  if(e.items.length&&!confirm('В новом виде сметы другие разделы. Все позиции сохранятся, но для каждой нужно будет заново выбрать раздел. Продолжить?')){ev.target.value=e.format;return;}
  e.format=ev.target.value;e.heading=budgetFormat(e).heading;for(const i of e.items)i.section=-1;
  main.querySelector('[data-budget-field=heading]').value=e.heading;save();render();
 };
 function renderEstimate(){
  const linked=links(),sections=budgetFormat(e).sections;
  const content=main.querySelector('[data-budget-content]');
  content.innerHTML=`<section class="home-panel"><div class="home-panel-head"><h2>Позиции сметы</h2><button class="btn" data-budget-add>+ Позиция</button></div><p>Заполните позицию один раз. Выберите нужные позиции и создайте договор: данные попадут в спецификацию.</p><div class="budget-items">${e.items.map((i,n)=>`<article class="budget-item" data-budget-item="${esc(i.id)}"><div class="home-panel-head"><label class="check-row"><input type="checkbox" data-budget-select ${selected.has(i.id)?'checked':''} ${linked.has(i.id)?'disabled':''}><b>Позиция ${n+1}</b></label><button class="btn ghost" data-budget-remove>Удалить</button></div><label class="field"><span>Раздел</span><select data-budget-it="section"><option value="-1">Выберите раздел</option>${sections.map((s,k)=>`<option value="${k}" ${+i.section===k?'selected':''}>${k+1}. ${esc(s)}</option>`).join('')}</select></label><label class="field"><span>Наименование</span><input data-budget-it="name" value="${esc(i.name)}" placeholder="Руководитель проекта"></label><label class="field"><span>Описание</span><textarea data-budget-it="description" rows="3" placeholder="Состав работ, характеристики или занятость">${esc(i.description||'')}</textarea></label><div class="budget-numbers"><label class="field"><span>Единица</span><input data-budget-it="unit" list="budget-units" value="${esc(i.unit)}"></label><label class="field"><span>Количество</span><input data-budget-it="qty" type="number" min="0.001" step="any" value="${esc(i.qty)}"></label><label class="field"><span>Цена, ₽</span><input data-budget-it="price" type="number" min="0" step="0.01" value="${esc(i.price)}"></label><span class="field"><span>Сумма</span><b data-budget-amount>${G.money(lineAmount(i))} ₽</b></span></div>${linked.has(i.id)?`<p>В договоре: ${linked.get(i.id).map(d=>`<button class="link" data-budget-deal="${esc(d.id)}">${esc(d.number?'№ '+d.number:'без номера')}</button>`).join(', ')}</p>`:''}</article>`).join('')||'<p>Добавьте первую позицию сметы.</p>'}</div><datalist id="budget-units">${units.map(u=>`<option value="${u}">`).join('')}</datalist></section>
 <section class="home-panel"><h2>Итоги по разделам</h2><div data-budget-sections></div></section>
 <section class="home-panel budget-create"><h2>Создать договор из сметы</h2><p data-budget-selected></p><label class="field"><span>Тип сделки</span><select data-budget-deal-type><option value="services">Услуги</option><option value="supply">Поставка</option></select></label><button class="btn primary" data-budget-create>Создать договор</button><small>На следующем шаге выберите контрагента, номер и сроки. Позиции уже будут заполнены. Готовые договоры не меняются при редактировании сметы.</small></section>`;
  const totals=()=>{main.querySelector('[data-budget-sections]').innerHTML=budgetGroups(e).map(g=>`<p class="budget-section-total"><span>${g.index+1}. ${esc(g.name)}</span><b>${G.money(g.total)} ₽</b></p>`).join('');};
  const selection=()=>{main.querySelector('[data-budget-selected]').textContent=`Выбрано позиций: ${selected.size}`;main.querySelector('[data-budget-create]').disabled=!selected.size;};
  content.querySelector('[data-budget-add]').onclick=()=>{e.items.push({id:crypto.randomUUID(),section:0,name:'',description:'',unit:'услуга',qty:1,price:0});save();renderEstimate();content.querySelector('.budget-item:last-child [data-budget-it=name]').focus();};
  content.querySelectorAll('[data-budget-item]').forEach(row=>{
   const item=e.items.find(i=>i.id===row.dataset.budgetItem);
   row.querySelectorAll('[data-budget-it]').forEach(el=>{el.oninput=()=>{const k=el.dataset.budgetIt;item[k]=['qty','price','section'].includes(k)?(el.value===''?null:Number(el.value)):el.value;save();row.querySelector('[data-budget-amount]').textContent=G.money(lineAmount(item))+' ₽';summary();totals();};if(el.tagName==='SELECT')el.onchange=el.oninput;});
   row.querySelector('[data-budget-select]').onchange=ev=>{ev.target.checked?selected.add(item.id):selected.delete(item.id);selection();};
   row.querySelector('[data-budget-remove]').onclick=()=>{if((item.name||linked.has(item.id))&&!confirm('Удалить позицию из сметы? Существующие договоры сохранятся.'))return;e.items=e.items.filter(i=>i.id!==item.id);selected.delete(item.id);save();render();};
  });
  content.querySelectorAll('[data-budget-deal]').forEach(b=>b.onclick=()=>openDeal(b.dataset.budgetDeal));
  content.querySelector('[data-budget-create]').onclick=async()=>{if(busy)return;busy=true;try{error('');await flush();await createDeal([...selected],content.querySelector('[data-budget-deal-type]').value);}catch(err){error(err.message);}finally{busy=false;}};
  totals();selection();
 }
 function renderRegister(){
  const rows=registryRows(e,data.deals,data.parties),content=main.querySelector('[data-budget-content]');
  content.innerHTML=`<section class="home-panel"><h2>Документы в реестре</h2><div class="docs-buttons">${[['invoice','Счета'],['contract','Договоры'],['act','Акты'],['upd','УПД']].map(([k,label])=>`<label class="check-row"><input type="checkbox" data-reg-type="${k}" ${(e.registerTypes||['invoice','contract']).includes(k)?'checked':''}>${label}</label>`).join('')}</div><p>Номера и даты берутся из текущих карточек сделок. Если отдельный номер счета не указан, используется номер договора. Для СЗН счет и УПД не добавляются.</p></section><section class="home-panel"><h2>Реестр за ${esc(e.year)} год</h2>${rows.map(r=>`<article class="budget-reg-row"><div><b>${r.number}. ${esc(r.name)}</b><p>${esc(r.counterparty)}</p><p class="budget-pre">${esc(r.documents)}</p>${r.issues.length?`<p class="docs-warn">${esc(r.issues.join('. '))}</p>`:''}</div><div><b>${G.money(r.total)} ₽</b><button class="btn" data-budget-deal="${esc(r.id)}">Открыть договор</button></div></article>`).join('')||'<p>В этой папке за выбранный год пока нет договоров.</p>'}</section>`;
  content.querySelectorAll('[data-reg-type]').forEach(el=>el.onchange=()=>{e.registerTypes=[...content.querySelectorAll('[data-reg-type]:checked')].map(x=>x.dataset.regType);save();renderRegister();});
  content.querySelectorAll('[data-budget-deal]').forEach(b=>b.onclick=()=>openDeal(b.dataset.budgetDeal));
 }
 main.querySelector('[data-budget-download]').onclick=async ev=>{if(busy)return;busy=true;ev.target.disabled=true;error('');try{if(!e.customerId)throw new Error('Выберите нашу организацию в разделе «Оформление и реквизиты».');if(!/^\d{4}$/.test(String(e.year)))throw new Error('Укажите год проекта.');await flush();const blob=view==='register'?await registryDocx(e,data.deals,data.parties,customer()):await estimateDocx(e,customer());download(blob,projectDocumentFilename(view==='register'?'register':'estimate',folder,e.year));toast('Документ готов');}catch(err){error(err.message);}finally{busy=false;ev.target.disabled=false;}};
 render();
}

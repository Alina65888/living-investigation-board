// Budget values are planning data; copying into a deal never changes the source.
import * as G from './docgen.js?v=55';
import {dealYear} from './document-library.js?v=55';
export const BUDGET_FORMATS={
 competition:{title:'Конкурсная процедура',heading:'Смета по конкурсной процедуре',sections:['Оплата труда','Страховые взносы','Командировочные расходы','Закупка непроизведенных активов, нематериальных активов, материальных запасов и основных средств','Уплата налогов, сборов и иных платежей в бюджеты бюджетной системы Российской Федерации','Закупка работ и услуг','Иные расходы']},
 subsidy:{title:'Субсидия',heading:'Смета расходов',sections:['Оплата труда привлеченных специалистов','Аренда и приобретение оборудования и расходных материалов','Услуги по содействию в организации мероприятия','Издательские, полиграфические и сопутствующие расходы']}
};
export const budgetFormat=e=>BUDGET_FORMATS[e.format]||BUDGET_FORMATS.competition;
export const lineAmount=i=>G.sumItems([i]);
export function budgetGroups(e){return budgetFormat(e).sections.map((name,index)=>{const items=(e.items||[]).filter(i=>+i.section===index);return {name,index,items,total:G.sumItems(items)};});}
export function budgetIssues(e){
 const errors=[];
 if(!/^\d{4}$/.test(String(e.year)))errors.push('Укажите год проекта.');
 if(!e.items?.length)errors.push('Добавьте хотя бы одну позицию сметы.');
 for(const [n,i] of (e.items||[]).entries()){
  if(i.sourceConflict&&!i.sourceConflict.resolved)errors.push(`Позиция ${n+1}: уточните расхождение цены и суммы в исходной смете.`);
  if(!String(i.name||'').trim())errors.push(`Позиция ${n+1}: укажите наименование.`);
  if(!String(i.unit||'').trim())errors.push(`Позиция ${n+1}: укажите единицу измерения.`);
  if(!Number.isInteger(+i.section)||+i.section<0||+i.section>=budgetFormat(e).sections.length)errors.push(`Позиция ${n+1}: выберите раздел сметы.`);
  if(i.qty===null||i.qty===''||i.price===null||i.price===''||!Number.isFinite(+i.qty)||+i.qty<=0||!Number.isFinite(+i.price)||+i.price<0)errors.push(`Позиция ${n+1}: проверьте количество и цену.`);
 }
 return errors;
}
export function projectDeals(e,deals){return deals.filter(d=>d.folderId===e.folderId&&dealYear(d)===String(e.year)&&(!e.customerId||d.customerId===e.customerId));}
export function budgetItemLinks(e,deals){
 const links=new Map();
 for(const d of projectDeals(e,deals))for(const item of d.items||[])if(item.estimateId===e.id&&item.estimateItemId){if(!links.has(item.estimateItemId))links.set(item.estimateItemId,[]);if(!links.get(item.estimateItemId).some(x=>x.id===d.id))links.get(item.estimateItemId).push(d);}
 return links;
}
export function itemsForDeal(e,ids){
 const selected=(e.items||[]).filter(i=>ids.includes(i.id));
 if(!selected.length)throw new Error('Выберите позиции сметы.');
 const issues=budgetIssues({...e,items:selected});if(issues.length)throw new Error(issues.join('\n'));
 return selected.map(i=>({id:crypto.randomUUID(),estimateId:e.id,estimateItemId:i.id,name:i.name,description:i.description||'',unit:i.unit,qty:+i.qty,price:+i.price,contractName:i.contractName||''}));
}
export function refreshEstimateItems(deal,estimate){
 let changed=0;
 const items=(deal.items||[]).map(old=>{
  if(old.estimateId!==estimate.id)return old;
  const source=estimate.items.find(i=>i.id===old.estimateItemId);if(!source)return old;
  const {name,description='',unit,qty,price,contractName=''}=source;changed++;
  return {...old,name,description,unit,qty:+qty,price:+price,contractName};
 });
 if(!changed)throw new Error('Связанные позиции больше не найдены в смете.');
 return items;
}
export function registryParty(p){if(!p)return 'Контрагент не выбран';if(p.kind==='npd')return 'Самозанятый '+p.fio;if(p.kind==='ip')return 'ИП '+p.fio;return G.partyShortTitle(p).replace(/^Общество с ограниченной ответственностью\s+/i,'ООО ');}
const numbered=n=>/^(б[\/\s-]?н|без номера)$/i.test(String(n||'').trim())?'БН':'№ '+String(n||'').replace(/^№\s*/,'');
export function registryRows(e,deals,parties){
 const selected=e.registerTypes||['invoice','contract'];
 return projectDeals(e,deals).sort((a,b)=>String(a.date||'').localeCompare(String(b.date||''))||String(a.number||'').localeCompare(String(b.number||''),'ru',{numeric:true})).map((d,index)=>{
  const p=parties.find(p=>p.id===d.executorId),documents=[],issues=[];
  if(!p)issues.push('Выберите контрагента');
  if(!String(d.number||'').trim())issues.push('Укажите номер договора или БН');
  if(!/^\d{4}-\d{2}-\d{2}$/.test(d.date||''))issues.push('Укажите дату договора');
  if(!(d.items||[]).length||d.items.some(i=>!i.name||i.qty===null||i.qty===''||i.price===null||i.price===''||!Number.isFinite(+i.qty)||+i.qty<=0||!Number.isFinite(+i.price)||+i.price<0))issues.push('Проверьте позиции и суммы');
  const available=new Set(p?G.documentSet(p).map(x=>x.id):[]);
  for(const kind of selected){
   if(!available.has(kind))continue;
   const number=kind==='invoice'?(d.invoiceNumber||d.number):kind==='upd'?(d.updNumber||d.number):kind==='act'?(d.actNumber||'БН'):d.number;
   const date=kind==='invoice'?(d.invoiceDate||d.date):kind==='upd'?(d.updDate||d.actDate||d.deadline||d.date):kind==='act'?(d.actDate||d.deadline||d.date):d.date;
   documents.push(`${{invoice:'Счет',contract:'Договор',act:'Акт',upd:'УПД'}[kind]} ${number?numbered(number):'№ не указан'} от ${date?G.shortDate(date):'дата не указана'}`);
  }
  if(!documents.length)issues.push('Выберите документы, доступные этому контрагенту');
  return {id:d.id,number:String(index+1),name:(d.items||[]).map(i=>i.name).filter(Boolean).join('\n'),counterparty:registryParty(p),documents:documents.join('\n'),total:G.sumItems(d.items||[]),issues};
 });
}

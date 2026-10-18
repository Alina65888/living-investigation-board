import * as G from './docgen.js?v=57';
import {loadTemplate} from './docx-templates.js?v=57';
import {budgetGroups,budgetIssues,registryRows} from './project-budget.js?v=57';
const enc=new TextEncoder(),dec=new TextDecoder();
const escape=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&apos;'}[c]));
const fill=(s,v)=>s.replace(/\{\{(\w+)\}\}/g,(_,k)=>{if(!Object.hasOwn(v,k))throw new Error('Не заполнено поле '+k);return String(v[k]??'').split(/\r?\n/).map(escape).join('</w:t><w:br/><w:t xml:space="preserve">');});
const prototype=(xml,name)=>{const r=new RegExp(`<!--${name}:start-->([\\s\\S]*?)<!--${name}:end-->`),m=xml.match(r);if(!m)throw new Error('Поврежден шаблон: '+name);return m[1];};
const money=n=>G.money(n).replace(/\u00a0/g,' ');
function fields(e,customer={}){return {heading:e.heading||'Смета расходов',subtitle:e.subtitle||'',agreementNumber:e.agreementNumber||'_____________',agreementDate:e.agreementDate?G.longDate(e.agreementDate):`«__» ________ ${e.year} г.`,registryTitle:e.registryTitle||e.subtitle||'',signerPosition:e.signerPosition||customer.signerPosition||'Должность',signerName:e.signerName||G.initials(customer.signer||'')||'И. О. Фамилия'};}
async function generate(template,values,makeRows,buffer){
 const files=G.unzipStored(buffer||await loadTemplate(template));let xml=dec.decode(files['word/document.xml']);
 const rows=makeRows(xml);xml=xml.replace(/<!--body:start-->[\s\S]*?<!--body:end-->/,'<!--filled-body-->');
 xml=fill(xml,values).replace('<!--filled-body-->',rows);files['word/document.xml']=enc.encode(xml);
 return new Blob([G.zip(files)],{type:'application/vnd.openxmlformats-officedocument.wordprocessingml.document'});
}
export async function estimateDocx(e,customer,buffer){
 const issues=budgetIssues(e);if(issues.length)throw new Error(issues.join('\n'));
 return generate(e.format==='subsidy'?'estimate-subsidy':'estimate-competition',{...fields(e,customer),total:money(G.sumItems(e.items))},xml=>{
  const section=prototype(xml,'section'),item=prototype(xml,'item'),subtotal=prototype(xml,'subtotal');
  return budgetGroups(e).map(g=>fill(section,{sectionNumber:String(g.index+1)+(e.format==='subsidy'?'':'.'),sectionName:g.name})+(g.items.length?g.items:[null]).map((i,n)=>fill(item,{itemNumber:`${g.index+1}.${n+1}`,itemText:i?[i.name,i.description].filter(Boolean).join('\n'):'–',itemName:i?.name||'–',itemDescription:i?.description||'',itemUnit:i?.unit||'',itemQuantity:i?G.qty(i.qty):'',itemPrice:i?money(i.price):'',itemTotal:i?money(G.sumItems([i])):''})).join('')+fill(subtotal,{subtotal:money(g.total)})).join('');
 },buffer);
}
export async function registryDocx(e,deals,parties,customer,buffer){
 const rows=registryRows(e,deals,parties);if(!rows.length)throw new Error('В проекте за выбранный год еще нет договоров.');
 if(rows.some(r=>r.issues.length))throw new Error('Заполните номера, даты, контрагентов и позиции договоров перед скачиванием реестра.');
 return generate('project-register',{...fields(e,customer),total:money(G.sumItems(rows.map(r=>({qty:1,price:r.total}))))},xml=>rows.map(r=>fill(prototype(xml,'registry'),{rowNumber:r.number,rowName:r.name,rowParty:r.counterparty,rowDocuments:r.documents,rowTotal:money(r.total)})).join(''),buffer);
}

import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {budgetGroups,budgetIssues,itemsForDeal,refreshEstimateItems,registryRows,budgetItemLinks} from '../docs/project-budget.js';
import {projectCode,fillProjectCodes,projectDocumentFilename} from '../docs/document-library.js';
import {estimateDocx,registryDocx} from '../docs/project-docx.js';
import {unzipStored} from '../docs/docgen.js';
const estimate=()=>({id:'e',folderId:'mant-pearl',year:'2026',format:'competition',customerId:'c',heading:'Смета',items:[{id:'i',section:0,name:'Руководитель <проекта>',description:'Описание & детали',unit:'месяц',qty:3,price:10.115}]});
const parties=[{id:'p',kind:'npd',fio:'Иванова Анна Ивановна'},{id:'o',kind:'org',name:'ООО «Тест»'}];
const deal=()=>({id:'d',folderId:'mant-pearl',customerId:'c',executorId:'p',number:'1/ЖМ',date:'2026-03-01',items:itemsForDeal(estimate(),['i'])});
const buffer=async name=>{const b=await readFile(new URL('../docs/templates/'+name+'.docx',import.meta.url));return b.buffer.slice(b.byteOffset,b.byteOffset+b.byteLength);};
const xml=async blob=>new TextDecoder().decode(unzipStored(await blob.arrayBuffer())['word/document.xml']);
test('budget groups calculate rounded lines and reject missing values or sections',()=>{
 const e=estimate();assert.equal(budgetGroups(e).length,7);assert.equal(budgetGroups(e)[0].total,30.35);assert.deepEqual(budgetIssues(e),[]);
 for(const patch of [{section:-1},{qty:0},{price:null},{name:''},{unit:''}])assert.ok(budgetIssues({...e,items:[{...e.items[0],...patch}]}).length);
});
test('selected budget positions are copied and refresh is explicit, retaining manual deal positions',()=>{
 const e=estimate(),d=deal();e.items[0].price=100;assert.equal(d.items[0].price,10.115);
 d.items.push({id:'manual',name:'Дополнение',qty:1,price:1});d.items=refreshEstimateItems(d,e);
 assert.equal(d.items[0].price,100);assert.equal(d.items[1].id,'manual');assert.equal(budgetItemLinks(e,[d]).get('i').length,1);
 assert.throws(()=>itemsForDeal(e,[]));
});
test('registry is scoped to folder, year and customer, keeps separate numbers and counts each deal once',()=>{
 const e=estimate(),d=deal(),business={...d,id:'b',executorId:'o',invoiceNumber:'02/26',invoiceDate:'2026-02-28'};
 const rows=registryRows(e,[d,business,{...d,id:'wrong-folder',folderId:'other'},{...d,id:'old',date:'2025-03-01'},{...d,id:'other-customer',customerId:'other'}],parties);
 assert.equal(rows.length,2);assert.equal(rows[0].documents,'Договор № 1/ЖМ от 01.03.2026');assert.match(rows[0].counterparty,/Самозанятый Иванова Анна/);
 assert.equal(rows[1].documents,'Счет № 02/26 от 28.02.2026\nДоговор № 1/ЖМ от 01.03.2026');assert.equal(rows.reduce((n,r)=>n+r.total,0),60.7);
 assert.ok(registryRows(e,[{...d,number:''}],parties)[0].issues.length);
});
test('project codes migrate only blanks and all filenames use short codes',()=>{
 const folders=[{id:'mant-pearl',name:'Жемчужина мира',code:''},{id:'mant-mt',code:'МОЙ'}];fillProjectCodes(folders);
 assert.equal(folders[0].code,'ЖМ');assert.equal(folders[1].code,'МОЙ');assert.equal(projectCode({name:'Новый проект'}),'НП');assert.equal(projectDocumentFilename('estimate',folders[0],2026),'Смета 2026 (ЖМ).docx');
});
test('Word exports repeat sections and rows with escaped text, exact margins and no unresolved fields',async()=>{
 const e=estimate();const x=await xml(await estimateDocx(e,{},await buffer('estimate-competition')));
 assert.equal((x.match(/ИТОГО:/g)||[]).length,7);assert.match(x,/Руководитель &lt;проекта&gt;/);assert.match(x,/Описание &amp; детали/);assert.doesNotMatch(x,/\{\{/);assert.match(x,/w:left="720"/);
 const r=await xml(await registryDocx(e,[deal()],parties,{},await buffer('project-register')));assert.match(r,/№ 1\/ЖМ от 01.03.2026/);assert.doesNotMatch(r,/\{\{/);
 const template=await buffer('project-register');await assert.rejects(()=>registryDocx(e,[{...deal(),number:''}],parties,{},template));
});

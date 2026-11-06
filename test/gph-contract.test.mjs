import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,writeFileSync} from 'node:fs';
import * as G from '../docs/docgen.js';
const c={kind:'org',name:'Региональная молодежная общественная организация «Пример»',shortName:'РМОО «Пример»',signer:'Петрова Анна Ивановна',signerGen:'Петровой Анны Ивановны',signerPosition:'председатель',basis:'устава',inn:'0000000000',kpp:'000000000',ogrn:'0000000000000',address:'г. Казань, пример адреса',account:'00000000000000000000',bik:'000000000',corr:'00000000000000000000',bank:'Пример банка'};
const e={kind:'person',fio:'Иванова Анна Петровна',snils:'00000000000',passport:'0000 000000, выдан 01.01.2020',address:'г. Казань, пример адреса',inn:'000000000000',account:'00000000000000000000',bik:'000000000',corr:'00000000000000000000',bank:'Пример банка'};
const d={type:'services',number:'2/Т',city:'Казань',date:'2026-03-02',period:'с 2 по 9 марта 2026 г.',subject:'руководителя образовательного проекта',gphPayment:'monthly',items:[{name:'Руководитель проекта',description:'Планирование и проведение мероприятий.',unit:'услуга',qty:1,price:15000},{name:'Координатор',description:'Координация участников программы.',unit:'услуга',qty:2,price:5000}]};
const bytes=readFileSync(new URL('../docs/templates/services-gph.docx',import.meta.url));
const template=bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength);
const xml=b=>new TextDecoder().decode(G.unzipStored(b)['word/document.xml']);
const visible=s=>s.replace(/<[^>]+>/g,'');
test('ГПХ выбирается только для услуг физлица; обязательные поля ведут на нужный шаг',()=>{
 assert.equal(G.templateName('contract',d,e),'services-gph');assert.equal(G.templateName('contract',d,{kind:'npd'}),'services');
 assert.equal(G.contractAvailability(d,c,e),null);assert.equal(G.contractAvailability({...d,type:'supply'},c,e).field,'type');assert.equal(G.contractAvailability({...d,gphPayment:''},c,e).field,'gphPayment');assert.equal(G.contractAvailability({...d,gphTaxRate:'abc'},c,e).field,'gphTaxRate');assert.equal(G.contractAvailability(d,c,{...e,snils:''}).party,'executorId');
 assert.deepEqual(G.documentSet(e).map(x=>x.id),['contract','act']);
});
test('договор, реквизиты, обе позиции, сумма и одинаковые условия в приложении',async()=>{
 const original=G.unzipStored(template);
 for(const [basis,term] of [['monthly','с момента окончания расчетного месяца'],['act','с момента подписания Акта об оказании услуг']]){
  const rate=basis==='monthly'?'13':'',buf=await (await G.contractDocx({...d,gphPayment:basis,gphTaxRate:rate},c,e,template)).arrayBuffer();
  const x=xml(buf),t=visible(x);
  for(const [k,v] of Object.entries(original))if(k!=='word/document.xml')assert.deepEqual(G.unzipStored(buf)[k],v,k);
  assert.ok(t.includes('Договор возмездного оказания услуг № 2/Т'));assert.match(t,/Гражданка Иванова Анна Петровна, именуемая/);assert.ok(t.includes('02 марта 2026'));assert.ok(t.includes('с 02 по 09 марта'));assert.ok(t.includes('000-000-000 00'));assert.ok(t.includes(c.shortName));assert.ok(t.includes(e.passport));
  assert.ok(t.includes('руководителя образовательного проекта'));assert.ok(t.includes('Руководитель проекта'));assert.ok(t.includes('Координатор'));assert.ok(t.replace(/\u00a0/g,' ').includes('25 000'));assert.equal(t.split(term).length-1,2);assert.equal(t.split('Сумма указана с учетом НДФЛ'+(rate?' (13%)':'')+'.').length-1,2);
  assert.doesNotMatch(t,/\{\{|профессиональный доход|УПД/);
  if(basis==='monthly'&&process.env.GPH_QA)writeFileSync(process.env.GPH_QA,Buffer.from(buf));
 }
});
test('акт к договору ГПХ берет номер, дату и формулировку НДФЛ из той же сделки',async()=>{
 const act=readFileSync(new URL('../docs/templates/act.docx',import.meta.url));
 const t=visible(xml(await (await G.actDocx({...d,gphTaxRate:''},c,e,act.buffer.slice(act.byteOffset,act.byteOffset+act.byteLength))).arrayBuffer()));
 assert.match(t,/Договору возмездного оказания услуг № 2\/Т от 02 марта 2026 года/);
 assert.match(t,/Сумма указана с учетом НДФЛ\./);assert.doesNotMatch(t,/НПД|НДС|13%/);
});

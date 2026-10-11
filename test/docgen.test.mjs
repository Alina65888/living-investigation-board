// Contract generator: grammar, amounts in words, requisites checks and file assembly (no browser needed).
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as G from '../docs/docgen.js';

// Valid 12-digit INN built from the official checksum, so tests never carry a real person's number.
function personInn(base = '7707083') {
  const d = (base + '000').slice(0, 10).split('').map(Number), k = w => w.reduce((s, x, i) => s + x * d[i], 0) % 11 % 10;
  d[10] = k([7, 2, 4, 10, 3, 5, 9, 4, 6, 8]); d[11] = k([3, 7, 2, 4, 10, 3, 5, 9, 4, 6, 8]);
  return d.join('');
}
const bank = { bank: 'ПАО Сбербанк', bik: '044525225', corr: '30101810400000000225' };
// Public requisites of a large bank, used as a well-known valid organisation.
const org = { kind: 'org', name: 'Общество с ограниченной ответственностью «Пример»', inn: '7707083893', kpp: '773601001', ogrn: '1027700132195', address: 'г. Москва', account: '40702810938000000001', ...bank, signer: 'Иванов Пётр Сергеевич', signerPosition: 'генеральный директор' };
const ngo = { ...org, name: 'Региональная общественная организация «Пример»', signer: 'Петрова Анна Ильинична', signerPosition: 'председатель' };
const npd = { kind: 'npd', fio: 'Смирнова Елена Олеговна', inn: personInn(), npdDate: '2022-01-10', npdNumber: '123456', passport: '0000 000000, выдан 01.01.2020', address: 'г. Казань', account: '40817810738000000002', ...bank };

test('preamble words agree with the organisation and the signatory', () => {
  assert.equal(G.partyPreamble(org, 'Исполнитель'), 'Общество с ограниченной ответственностью «Пример», в лице генерального директора Иванова Петра Сергеевича, действующего на основании устава, именуемое в дальнейшем «Исполнитель»');
  assert.match(G.partyPreamble(ngo, 'Заказчик'), /в лице председателя Петровой Анны Ильиничны, действующей на основании устава, именуемая/);
  assert.match(G.partyPreamble(npd, 'Исполнитель'), /^Самозанятый Смирнова Елена Олеговна, зарегистрированный .* именуемый/);
  for(const gender of ['f','m'])assert.match(G.partyPreamble({...npd,gender},'Исполнитель'),/^Самозанятый .* зарегистрированный .* именуемый/);
  assert.equal(G.fioGenitive('Сабирова Лиля Ринатовна'), 'Сабировой Лили Ринатовны');
  assert.equal(G.fioGenitive('Соколов Сергей Владимирович'), 'Соколова Сергея Владимировича');
  assert.equal(G.initials('Соколов Сергей Владимирович'), 'С. В. Соколов');
});

test('amounts in words', () => {
  assert.equal(G.amountWithWords(24000), '24 000 (Двадцать четыре тысячи) руб. – 00 коп.');
  assert.equal(G.amountWords(202560), 'Двести две тысячи пятьсот шестьдесят руб. – 00 коп.');
  assert.equal(G.numberWords(1001021), 'один миллион одна тысяча двадцать один');
});

test('requisites checks catch real-life mistakes', () => {
  assert.deepEqual(G.checkParty(org), []);
  assert.deepEqual(G.checkParty(npd), []);
  assert.match(G.checkParty({ ...npd, inn: '7707083893' })[0], /12 цифр/, 'an organisation INN pasted into a self-employed card');
  assert.ok(G.checkParty({ ...org, inn: '7707083894' }).some(w => /контрольной суммы/.test(w)));
  assert.ok(G.checkParty({ ...org, account: '40702810938000000009' }).some(w => /не сходится с БИК/.test(w)));
  assert.ok(G.checkDeal({ type: 'services', number: '1', date: '2026-05-01', deadline: '2026-04-01', subject: 'x', items: [{ name: 'a', qty: 1, price: 1 }] }, ngo, org).some(w => /раньше даты/.test(w)));
});

test('documents per executor status', () => {
  assert.deepEqual(G.documentSet(npd).map(d => d.id), ['contract', 'act']);
  assert.deepEqual(G.documentSet(org).map(d => d.id), ['contract', 'invoice', 'act', 'upd']);
});

const bufferOf = path => { const b = readFileSync(new URL(path, import.meta.url)); return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength); };
const template = (kind, deal, executor) => bufferOf(`../docs/templates/${G.templateName(kind, deal, executor)}.docx`);
const word = async (kind, deal, customer=ngo, executor=org) => G.unzipStored(await (await G[kind+'Docx'](deal, customer, executor, template(kind,deal,executor))).arrayBuffer());
const text = bytes => new TextDecoder().decode(bytes);
const deal = { type:'supply', number:'7', date:'2026-04-28', deadline:'2026-05-20', actDate:'2026-05-21', subject:'цветы', items:[{name:'Гвоздики',description:'Живые цветы для поздравления',unit:'штука',qty:400,price:150}] };

test('Word fills approved templates and preserves styles, fonts, margins and bank header', async () => {
  for (const executor of [org,{...npd,kind:'ip',ogrn:'123456789012345'},npd]) {
    for (const type of ['supply','services','works']) {
      const d={...deal,type,period:'с 28 апреля по 20 мая 2026 г.'};
      for (const kind of ['contract','invoice','act']) {
        if(kind==='contract'&&!G.templateName(kind,d,executor)){await assert.rejects(()=>G.contractDocx(d,ngo,executor),/образец|другой тип/);continue;}
        const result=await word(kind,d,ngo,executor);
        const source=G.unzipStored(template(kind,d,executor));
        const document=text(result['word/document.xml']);
        assert.doesNotMatch(document, /<!--items:|\{\{\w+\}\}/);
        for (const path of ['word/styles.xml','word/settings.xml','word/fontTable.xml','word/theme/theme1.xml']) assert.deepEqual(result[path],source[path],path);
        const section = xml => xml.match(/<w:sectPr[\s\S]*?<\/w:sectPr>/)[0];
        assert.equal(section(document),section(text(source['word/document.xml'])));
        assert.match(document, /60[ \u00a0]000/);
        if(kind!=='invoice')assert.match(document,/Петрова|Петровой/);
        if(kind!=='act')assert.match(document,/Гвоздики/);
        if(kind==='contract')assert.match(document,/Живые цветы/);
        if(kind==='invoice') {
          assert.match(text(result['word/header2.xml']),/Банк получателя/);
          assert.match(text(result['word/header2.xml']),/044525225/);
          assert.match(document, /w:val="36"/); // source invoice heading: 18 pt
        }
      }
    }
  }
});

test('Word repeats styled rows, escapes user text and keeps separate invoice fields', async () => {
  const items=Array.from({length:12},(_,i)=>({...deal.items[0],name:`Позиция ${i+1} <&> {{total}}`,qty:1,price:10.01}));
  const d={...deal,invoiceNumber:'12/2',invoiceDate:'2026-05-02',items};
  const result=await word('invoice',d),document=text(result['word/document.xml']);
  assert.match(document,/№ 12\/2 от 02 мая 2026 г/);
  assert.match(document,/Договор поставки № 7 от 28.04.2026/);
  assert.match(document,/Позиция 12 &lt;&amp;&gt; \{\{total\}\}/);
  assert.match(document,/120,12/);
  assert.equal((document.match(/Позиция /g)||[]).length,12);
  const act=text((await word('act',deal))['word/document.xml']);
  assert.match(act,/21 мая 2026 г/);
  assert.doesNotMatch(act,/Оплачена .* в полном объеме/);
  assert.match(text((await word('act',{...deal,paid:true}))['word/document.xml']),/Оплачена Покупателем в полном объеме/);
});

test('UPD preserves the approved style package, expands rows, descriptions and closing dates', async () => {
  const tpl=bufferOf('../docs/templates/upd.xlsx');
  const source=G.unzipStored(tpl);
  for(const count of [1,6,9,41]) {
    const items=Array.from({length:count},(_,i)=>({...deal.items[0],name:`Позиция ${i+1}`,qty:2,price:10.25}));
    const d={...deal,items,updNumber:'БН'};
    const result=G.unzipStored(await G.updXlsx(tpl,d,ngo,org).arrayBuffer());
    assert.deepEqual(result['xl/styles.xml'],source['xl/styles.xml']);
    const sheet=text(result['xl/worksheets/sheet1.xml']),total=21+Math.max(count,6),shift=Math.max(0,count-6);
    assert.match(sheet,/<c r="C6"[^>]*><is><t[^>]*>2<\/t>/);
    assert.match(sheet,/21.05.2026/);
    assert.match(sheet,/Живые цветы для поздравления/);
    assert.match(sheet,new RegExp(`<c r="BJ${total}"[^>]*><v>${20.5*count}<`));
    assert.match(sheet,new RegExp(`<c r="W${34+shift}"[^>]*>.*?Договор поставки № 7`,'s'));
    assert.match(sheet,new RegExp(`<c r="Q${41+shift}"[^>]*><is><t[^>]*>21<`));
    assert.match(text(result['xl/workbook.xml']),new RegExp('CG\\$'+(51+shift)));
    const rowIds=[...sheet.matchAll(/<row r="(\d+)"/g)].map(m=>+m[1]);
    assert.equal(new Set(rowIds).size,rowIds.length,'unique row numbers');
    assert.deepEqual(rowIds,[...rowIds].sort((a,b)=>a-b),'row order');
    if(count===1) assert.match(sheet,/<row r="22"[^>]* hidden="1"/);
    else assert.match(sheet,new RegExp(`Позиция ${count}\\n`));
    const merges=[...sheet.matchAll(/<mergeCell ref="([^"]+)"/g)].map(m=>m[1]);
    assert.equal(new Set(merges).size,merges.length,'unique merged ranges');
    assert.equal(+sheet.match(/<mergeCells count="(\d+)"/)[1],merges.length);
  }
});

test('all template packages are anonymous; no original signers or bank details remain', () => {
  for(const name of ['services.docx','services-business.docx','supply-ip.docx','supply-org.docx','invoice-org.docx','invoice-ip.docx','act.docx','act-npd.docx','upd.xlsx']) {
    const files=G.unzipStored(bufferOf('../docs/templates/'+name));
    const xml=Object.entries(files).filter(([name])=>name.endsWith('.xml')).map(([,v])=>text(v)).join('');
    const visible=[...xml.matchAll(/<(?:w:)?t(?:\s[^>]*)?>([^<]*)<\//g)].map(m=>m[1]).join(' ');
    assert.doesNotMatch(visible,/@(?:gmail|yandex|vk)\.|\b\d{20}\b|\b\d{12,15}\b/);
  }
});

test('line totals and grand total use the same kopeck rounding', () => {
  assert.equal(G.sumItems([{qty:1,price:0.335},{qty:1,price:0.335}]),0.68);
});

test('long UPD names wrap without changing fonts', async () => {
  const tpl=bufferOf('../docs/templates/upd.xlsx');
  const name='Региональная общественная организация «Объединение участников культурных и образовательных проектов региона»';
  const result=G.unzipStored(await G.updXlsx(tpl,deal,{...ngo,name},org).arrayBuffer());
  const original=text(G.unzipStored(tpl)['xl/styles.xml']),updated=text(result['xl/styles.xml']);
  assert.equal(updated.match(/<fonts[\s\S]*?<\/fonts>/)[0],original.match(/<fonts[\s\S]*?<\/fonts>/)[0]);
  assert.match(text(result['xl/worksheets/sheet1.xml']),/<row r="49"[^>]* ht="36"/);
  assert.ok(text(result['xl/worksheets/sheet1.xml']).includes(name));
});


test('only the new service contract is used, with fixed approved terms and repeated rows', async () => {
  const d={...deal,type:'services',period:'с 28 апреля по 20 мая 2026 г.',payDays:99,items:[...deal.items,{name:'Другая услуга <&>',description:'Детали',unit:'час',qty:2,price:100}]};
  const output=await word('contract',d,ngo,npd),document=text(output['word/document.xml']);
  assert.equal(G.templateName('contract',d,npd),'services');
  assert.match(document,/15 \(Пятнадцати\) календарных дней/);
  assert.match(document,/подписания Акта об оказании услуг/);
  assert.match(document,/Налог на профессиональный доход/);
  assert.match(document,/Самозанятый/);
  assert.doesNotMatch(document,/Гражданин|Гражданка/);
  assert.match(document,/4.1. Исполнитель обязуется передать сведения/);
  assert.match(document,/1.2/);assert.match(document,/Другая услуга &lt;&amp;&gt;/);
  assert.doesNotMatch(document,/99.*рабочих|\{\{\w+\}\}|<!--items:/);
  await assert.rejects(()=>word('contract',{...d,period:''},ngo,npd),/период оказания услуг/);
  // The original borderless requisites and bordered specification remain distinct.
  const source=G.unzipStored(template('contract',d,npd));
  for(const path of Object.keys(source).filter(p=>p!=='word/document.xml')) assert.deepEqual(output[path],source[path],path);
});


test('supplied IP and organisation contracts use their own supply template and fixed payment terms', async () => {
  for(const executor of [org,{...npd,kind:'ip',ogrn:'123456789012345'}]) {
    const d={...deal,payDays:99,period:'',items:[...deal.items,{name:'Товар <&>',description:'Детали {{не поле}}',unit:'штука',qty:2,price:100}]};
    assert.equal(G.templateName('contract',d,executor),'supply-'+executor.kind);
    assert.equal(G.contractAvailability(d,ngo,executor),null);
    const output=await word('contract',d,ngo,executor),document=text(output['word/document.xml']);
    assert.match(document,/поставки № 7/);
    assert.match(document,/15 \(Пятнадцати\) рабочих дней/);
    assert.match(document,/Акта об исполнении обязательств и\/или УПД/);
    assert.doesNotMatch(document,/Налог на профессиональный доход|Самозанятый|НПД|99 \(/);
    assert.match(document,/Товар &lt;&amp;&gt;/);
    assert.match(document,/Детали \{\{не поле\}\}/);
    assert.match(document,/60[ \u00a0]200/);
    assert.match(G.contractTemplateInfo(d,executor).payment,/рабочих дней/);
    const source=G.unzipStored(template('contract',d,executor));
    for(const path of Object.keys(source).filter(p=>p!=='word/document.xml'))assert.deepEqual(output[path],source[path],path);
  }
});

test('unsupported combinations direct to deal type without changing the counterparty status', () => {
  for(const executor of [org,{...npd,kind:'ip'}]) {
    const d={...deal,type:'works'},issue=G.contractAvailability(d,ngo,executor);
    assert.equal(G.templateName('contract',d,executor),null);
    assert.equal(issue.field,'type');assert.equal(issue.party,undefined);
    assert.match(issue.message,/статус контрагента менять не нужно/);
  }
  assert.equal(G.contractAvailability(deal,ngo,npd).field,'type');
  assert.equal(G.contractAvailability(deal,{...ngo,kind:'ip'},org).party,'customerId');
});


test('IP and organisations can provide services as well as goods, with matching supporting documents', async () => {
  for(const executor of [org,{...npd,kind:'ip',ogrn:'123456789012345'}])for(const vat of [false,true]) {
    const e={...executor,vat,vatRate:10,...(executor.kind==='ip'?{shortName:'Старое название организации'}:{})};
    const d={...deal,type:'services',payDays:99,period:'с 1 по 20 мая 2026 г.',subject:'сопровождение мероприятия',items:[{name:'Услуги ведущего',description:'Открытие и награждение',unit:'услуга',qty:1,price:10000}]};
    assert.equal(G.contractAvailability(d,ngo,e),null);
    assert.equal(G.templateName('contract',d,e),'services-business');
    const output=await word('contract',d,ngo,e),xml=text(output['word/document.xml']);
    const plain=xml.replace(/<[^>]*>/g,'');
    assert.match(plain,/оказания услуг № 7/);
    assert.match(plain,/Заказчик/);assert.match(plain,/Исполнитель/);
    assert.doesNotMatch(plain,/Покупатель|Поставщик|Товар|Самозанятый|Гражданка|Паспорт|НПД|профессиональный доход|99 \(/);
    assert.match(plain,/15 \(Пятнадцати\) рабочих дней/);
    assert.match(plain,/Акта об исполнении обязательств и\/или УПД/);
    assert.match(plain,/3.1. Стоимость оказываемых услуг по настоящему договору составляет:/);
    assert.match(plain,/3.4. На сумму предоплаты или аванса проценты/);
    assert.match(plain,/3.5. В случае несвоевременного исполнения/);
    assert.doesNotMatch(plain,/6.4. Разногласия|поставляемого|Срок оказания поставки/);
    assert.match(plain,/с 01 по 20 мая 2026 года/);
    assert.match(plain,/Срок оказания услуг: 20 мая 2026 г./);
    assert.match(G.contractTemplateInfo(d,e).payment,/15 рабочих дней.*Акта об исполнении обязательств и\/или УПД/);
    assert.match(plain,executor.kind==='ip'?/ОГРНИП/:/ИНН \/ КПП/);
    assert.ok(plain.includes(e.ogrn));
    assert.doesNotMatch(plain,/Старое название организации/);
    assert.match(plain,vat?/В том числе НДС 10%/:/НДС не облагается/);
    assert.match(plain,/Открытие и награждение/);
    assert.doesNotMatch(xml,/<!--items:|\{\{\w+\}\}/);
    for(const key of Object.keys(output).filter(k=>k!=='word/document.xml'))assert.deepEqual(output[key],G.unzipStored(template('contract',d,e))[key]);
    const invoice=text((await word('invoice',d,ngo,e))['word/document.xml']);
    const act=text((await word('act',d,ngo,e))['word/document.xml']);
    assert.match(invoice,/Договор оказания услуг № 7/);
    assert.match(act,/Договору оказания услуг № 7/);
    assert.doesNotMatch(act,/Поставщик|Покупатель|НПД/);
    const upd=G.unzipStored(await G.updXlsx(bufferOf('../docs/templates/upd.xlsx'),d,ngo,e).arrayBuffer());
    assert.match(text(upd['xl/worksheets/sheet1.xml']),/Договор оказания услуг № 7/);
    assert.equal(G.templateName('contract',{...d,type:'supply'},e),'supply-'+e.kind);
    assert.equal(G.templateName('contract',d,e),'services-business');
  }
});

test('Baylyk services retain the six-column specification with complete descriptions and repeated rows', async () => {
  for(const count of [4,12]) {
    const items=Array.from({length:count},(_,i)=>({name:`Услуга ${i+1}.`,description:`Описание ${i+1} <&>`,unit:'час',qty:2,price:100}));
    const d={...deal,type:'services',period:'с 1 по 20 мая 2026 г.',items};
    const document=text((await word('contract',d))['word/document.xml']);
    const tables=[...document.matchAll(/<w:tbl[\s>][\s\S]*?<\/w:tbl>/g)].map(m=>m[0]);
    const specification=tables.find(t=>t.includes('Наименование'));
    const rows=[...specification.matchAll(/<w:tr[\s>][\s\S]*?<\/w:tr>/g)].map(m=>m[0]);
    assert.equal(rows.length,count+3);
    assert.equal((rows[0].match(/<w:tc[\s>]/g)||[]).length,6);
    assert.doesNotMatch(rows[0],/>Описание</);
    for(let i=1;i<=count;i++)assert.ok(document.replace(/<[^>]*>/g,'').includes(`Услуга ${i}.Описание ${i} &lt;&amp;&gt;`));
    assert.match(document,new RegExp(G.money(count*200).replace(/\u00a0/g,'[ \\u00a0]')));
  }
});

test('invoice quantity and unit values match their column headings for IP and organisations', async () => {
  for(const executor of [org,{...npd,kind:'ip'}]){
    const document=text((await word('invoice',{...deal,items:[{name:'Услуги',unit:'час',qty:3,price:100}]},ngo,executor))['word/document.xml']);
    const rows=[...document.matchAll(/<w:tr[\s>][\s\S]*?<\/w:tr>/g)].map(m=>m[0]);
    const row=rows.find(r=>r.includes('Услуги'));
    const cells=[...row.matchAll(/<w:tc[\s>][\s\S]*?<\/w:tc>/g)].map(m=>m[0].replace(/<[^>]*>/g,''));
    const header=rows.find(r=>r.includes('Наименование товаров'));const headings=[...header.matchAll(/<w:tc[\s>][\s\S]*?<\/w:tc>/g)].map(m=>m[0].replace(/<[^>]*>/g,''));
    assert.equal(cells[headings.indexOf('Кол-во')],'3');assert.equal(cells[headings.indexOf('Ед. изм.')],'час');
  }
});

test('September references calculate clause 3.1, separate requisites, and remove sample seals', async()=>{
  const customer={...ngo,name:'Региональная молодежная общественная организация «Полное название»',shortName:'РМОО «Краткое название»',address:'АДРЕС ЗАКАЗЧИКА'};
  for(const executor of [org,{...npd,kind:'ip',ogrn:'123456789012345'}]){
    const d={...deal,type:executor.kind==='ip'?'supply':'services',date:'2026-03-01',period:'с 1 по 9 марта 2026 г.',deadline:'2026-03-09',items:[{name:'Первая позиция',description:'Подробное описание',unit:'час',qty:2,price:1500.25}],itemGroup:'Раздел по смете'};
    const output=await word('contract',d,customer,executor),xml=text(output['word/document.xml']),plain=xml.replace(/<[^>]*>/g,'');
    assert.match(plain,/3.1. Стоимость (поставляемых товаров|оказываемых услуг) по настоящему договору составляет: 3[ \u00a0]000/);
    assert.match(plain,/Раздел по смете/);assert.match(plain,/РМОО «Краткое название»/);
    assert.match(plain,/01 марта 2026/);assert.match(plain,/в период с 01 по 09 марта 2026 года/);
    assert.doesNotMatch(plain,/года в период в период|г\. в период|Срок оказания поставки/);
    if(executor.kind==='ip')assert.doesNotMatch(plain,/данную услугу/);
    const rows=[...xml.matchAll(/<w:tr[\s>][\s\S]*?<\/w:tr>/g)].map(m=>m[0]);
    const cells=r=>[...r.matchAll(/<w:tc[\s>][\s\S]*?<\/w:tc>/g)].map(m=>m[0].replace(/<[^>]*>/g,''));
    assert.equal(cells(rows.find(r=>cells(r)[0]==='ИНН / КПП'))[1],`${customer.inn} / ${customer.kpp}`);
    assert.equal(cells(rows.find(r=>cells(r)[0]==='Адрес'))[1],customer.address);
    for(const kind of ['contract','invoice']){
      const files=await word(kind,d,customer,executor);
      assert.equal(Object.keys(files).some(p=>p.startsWith('word/media/')),false);
      assert.doesNotMatch(text(files['word/document.xml']),/<w:drawing|<v:imagedata/);
      const all=Object.entries(files).filter(([n])=>n.endsWith('.xml')).map(([,v])=>text(v)).join('');
      assert.doesNotMatch(all,/Байлык|Шейлан|Габдуллин|Шаталов/);
    }
  }
});

test('single-digit days are padded in headings and free-text periods, without changing quantities', async()=>{
  assert.equal(G.longDate('2026-03-01'),'01 марта 2026 г.');
  assert.equal(G.longDate('2026-03-09'),'09 марта 2026 г.');
  assert.equal(G.longDate('2026-03-20'),'20 марта 2026 г.');
  for(const [from,to] of [['с 1 по 9 марта 2026 г.','с 01 по 09 марта 2026 г.'],['с 8 марта по 2 апреля 2026 года','с 08 марта по 02 апреля 2026 года'],['с 01 по 09 марта','с 01 по 09 марта'],['25 часов, 9-го числа, 1 услуга','25 часов, 9-го числа, 1 услуга']])assert.equal(G.padDateDays(from),to);
  const d={...deal,type:'services',date:'2026-03-01',actDate:'2026-03-09',subject:'руководителя проекта',period:'с 1 по 9 марта 2026 г.'};
  for(const kind of ['contract','act']){
    const doc=text((await word(kind,d,ngo,npd))['word/document.xml']);
    assert.match(doc,/01 марта 2026/);assert.match(doc,/с 01 по 09 марта 2026/);
  }
});

test('NPD uses the new separate act, explicit title break and conditional payment statement', async()=>{
  const customer={...ngo,name:'Региональная молодежная общественная организация «Пример»'},d={...deal,type:'services',period:'с 28 апреля по 20 мая 2026 г.'};
  assert.equal(G.templateName('act',d,npd),'act-npd');
  for(const paid of [false,true]){
    const doc=text((await word('act',{...d,paid},customer,npd))['word/document.xml']);
    assert.match(doc,/об исполнении обязательств по <\/w:t><w:br[^>]*\/><w:t[^>]*>Договору оказания услуг № 7 от 28 апреля 2026 года/);
    assert.match(doc,/РМОО «Пример»/);assert.match(doc,/Самозанятый Смирнова Елена Олеговна/);
    assert.doesNotMatch(doc,/Гражданин|Гражданка|27\.11\.2028/);
    assert.match(doc,/27\.11\.2018/);
    if(paid)assert.match(doc,/Оплачена Заказчиком в полном объеме/);
    else{assert.doesNotMatch(doc,/Оплачена Заказчиком|Обязательства Заказчика .* выполнены/);assert.match(doc,/Договором и Спецификацией/);}
    assert.match(doc,/действующей на основании устава, именуемая/);
  }
  assert.equal(G.templateName('act',d,org),'act','business acts retain their separate layout');
  assert.equal(G.partyShortTitle(customer),'РМОО «Пример»');
  assert.equal(G.partyShortTitle({...customer,shortName:'Другое сокращение'}),'Другое сокращение');
  assert.equal(G.partyShortTitle(org),org.name);
  const doc=text((await word('contract',d,customer,npd))['word/document.xml']);
  assert.ok(doc.includes(customer.name));assert.match(doc,/РМОО «Пример»/);
});

test('service wording uses an editable form without altering specification names',async()=>{
  assert.equal(G.serviceForm('Руководитель проекта'),'руководителя проекта');
  assert.equal(G.serviceForm('Ведущий мероприятия'),'ведущего мероприятия');
  assert.equal(G.serviceForm('Фотограф'),'фотографа');
  assert.equal(G.serviceForm('Неизвестное название'),'');
  const items=[{name:'Руководитель проекта',contractName:'',description:'Координация',unit:'услуга',qty:1,price:1000},{name:'Дизайн',contractName:'разработки макетов',unit:'услуга',qty:1,price:500}];
  const subject=G.serviceSubjectFromItems(items);assert.equal(subject,'руководителя проекта, разработки макетов');
  const doc=text((await word('contract',{...deal,type:'services',subject,period:'с 1 по 9 марта 2026 г.',items},ngo,npd))['word/document.xml']);
  assert.match(doc,/оказать услугу: руководителя проекта, разработки макетов/);
  assert.match(doc,/>Руководитель проекта</);assert.match(doc,/>Дизайн</);
});

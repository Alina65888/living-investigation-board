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
  assert.match(G.partyPreamble(npd, 'Исполнитель'), /^Гражданка Смирнова Елена Олеговна, зарегистрированная .* именуемая/);
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
      const d={...deal,type};
      for (const kind of ['contract','invoice','act']) {
        const result=await word(kind,d,ngo,executor);
        const source=G.unzipStored(template(kind,d,executor));
        const document=text(result['word/document.xml']);
        assert.doesNotMatch(document, /<!--items:|\{\{\w+\}\}/);
        for (const path of ['word/styles.xml','word/settings.xml','word/fontTable.xml','word/theme/theme1.xml']) assert.deepEqual(result[path],source[path],path);
        const section = xml => xml.match(/<w:sectPr[\s\S]*?<\/w:sectPr>/)[0];
        assert.equal(section(document),section(text(source['word/document.xml'])));
        assert.match(document, /60 000/);
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
  assert.match(document,/№ 12\/2 от 2 мая 2026 г/);
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
  for(const name of ['supply-org.docx','supply-ip.docx','services.docx','invoice-org.docx','invoice-ip.docx','act.docx','upd.xlsx']) {
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

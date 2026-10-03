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

test('files are valid zip packages with the expected content', async () => {
  const deal = { type: 'supply', number: '7', date: '2026-04-28', deadline: '2026-05-20', subject: 'цветы', items: [{ name: 'Гвоздики', unit: 'штука', qty: 400, price: 150 }] };
  const xmlOf = async make => new TextDecoder().decode(G.unzipStored(await make(deal, ngo, org).arrayBuffer())['word/document.xml']);
  for (const make of [G.contractDocx, G.invoiceDocx]) {
    const xml = await xmlOf(make);
    assert.match(xml, /Гвоздики/); assert.match(xml, /60 000,00/);
  }
  // The act follows the sample: no item table, the amount in words, a numbered list.
  const act = await xmlOf(G.actDocx);
  assert.match(act, /60 000 \(Шестьдесят тысяч\) руб\. – 00 коп\./); assert.match(act, /<w:numId w:val="1"\/>/); assert.doesNotMatch(act, /\.;/);
  // Layout copied from the samples: A4, margins 709/709/850, Times New Roman 12.
  assert.match(act, /<w:pgMar w:top="709" w:right="709" w:bottom="850" w:left="709"/);
  const invoice = G.unzipStored(await G.invoiceDocx(deal, ngo, org).arrayBuffer());
  assert.match(new TextDecoder().decode(invoice['word/header2.xml']), /Банк получателя/, 'bank block in the first-page header');
  const tpl = readFileSync(new URL('../docs/templates/upd.xlsx', import.meta.url));
  const upd = G.unzipStored(await G.updXlsx(tpl.buffer.slice(tpl.byteOffset, tpl.byteOffset + tpl.byteLength), deal, ngo, org).arrayBuffer());
  const sheet = new TextDecoder().decode(upd['xl/worksheets/sheet1.xml']);
  assert.match(sheet, /<c r="C6"[^>]*><is><t[^>]*>2<\/t>/, 'status 2 for a non-VAT seller');
  assert.match(sheet, /Договор поставки № 7 от 28\.04\.2026/);
  assert.match(sheet, /<row r="22"[^>]* hidden="1"/, 'unused item rows are hidden');
});

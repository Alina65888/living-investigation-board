import test from 'node:test';
import assert from 'node:assert/strict';
import {DEFAULT_FOLDERS,documentFilename,dealYear} from '../docs/document-library.js';
test('download names follow archive dates, counterparties and project codes',()=>{
  const d={date:'2026-09-20',number:'1/МТ',invoiceDate:'2026-09-21',invoiceNumber:'7/МТ',actDate:'2026-10-31',updNumber:'8'};
  const p={kind:'npd',fio:'Иванова Анна Ивановна'},project={code:'МТ'};
  assert.equal(documentFilename('contract',d,p,project),'2026.09.20 Договор № 1_МТ Иванова А. И. (МТ).docx');
  assert.equal(documentFilename('act',d,p,project),'2026.10.31 Акт БН Иванова А. И. (МТ).docx');
  assert.equal(documentFilename('invoice',d,{...p,kind:'ip'},project),'2026.09.21 Счет № 7_МТ ИП Иванова А. И. (МТ).docx');
  assert.equal(documentFilename('upd',d,{kind:'org',name:'Полное название',shortName:'Компания'},project),'2026.10.31 УПД № 8 Компания (МТ).xlsx');
  assert.match(documentFilename('upd',{...d,updDate:'2026-11-01'},p,project),/^2026\.11\.01 УПД/);
  assert.equal(d.number,'1/МТ','file sanitization must not change legal number');
});
test('archive names handle missing numbers, dates, unsafe symbols and unknown project codes',()=>{
  const p={kind:'org',shortName:'Тест: «А/Б»'};
  assert.equal(documentFilename('contract',{date:'2025-01-02',number:'Б/Н'},p,{name:'Проект'}),'2025.01.02 Договор БН Тест_ «А_Б» (Проект).docx');
  assert.match(documentFilename('contract',{},p),/^Без даты Договор БН /);
  assert.equal(dealYear({date:'2026-09-20'}),'2026');
  assert.equal(dealYear({}),'Без даты');
  assert.equal(DEFAULT_FOLDERS.length,19);
  assert.equal(new Set(DEFAULT_FOLDERS.map(f=>f.id)).size,19);
});

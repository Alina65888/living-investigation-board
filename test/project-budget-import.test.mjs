import test from 'node:test';
import assert from 'node:assert/strict';
import {budgetNumber,parseBudgetTables} from '../docs/project-budget-import.js';
const header=['№','Наименование расходов','Ед. изм.','Кол-во','Стоимость за ед. (руб.)','Сумма (руб.)'];
test('Word numbers accept Russian separators and do not guess missing or ambiguous numbers',()=>{
 for(const [s,n] of [['15 280,00',15280],['1\u202f200,50 ₽',1200.5],['0',0],['',null],['2 шт.',null],['—',null],['1,2,3',null],['-3',null]])assert.equal(budgetNumber(s),n);
});
test('Word rows map sections, split descriptions, skip subtotals and detect discrepancies',()=>{
 const result=parseBudgetTables([[header,['1','Оплата труда привлеченных специалистов','','','',''],['1.1','Руководитель проекта\nКоординация команды','месяц','2','10 000,00','20 000,00'],['1.2','–','','','',''],['','ВСЕГО:','','','','20 000,00'],['2','Услуги по содействию в организации мероприятия'],['2.1','Кейтеринг','услуга','2','7 910','15 280'],['Общий ИТОГ:','','','','','35 280']]]);
 assert.equal(result.format,'subsidy');assert.equal(result.items.length,2);
 assert.equal(result.items[0].description,'Координация команды');assert.equal(result.items[0].section,0);assert.equal(result.items[1].section,2);
 assert.deepEqual(result.items[1].sourceConflict,{price:7910,total:15280,resolved:false});assert.equal(result.warnings.length,2);
});
test('Word supports reordered columns, separate descriptions and repeated headers',()=>{
 const h=['Наименование','Описание','Цена','Количество','Единица измерения','Всего'];
 const result=parseBudgetTables([[h,['Оплата труда'],['Ведущий','Проведение','1 500','3','час','4500'],h,['1','2','3','4','5','6'],['Фотограф','Съемка','2000','1','час','2000']]]);
 assert.equal(result.items.length,2);assert.equal(result.items[0].price,1500);assert.equal(result.items[0].description,'Проведение');assert.equal(result.items[1].section,0);
});
test('unknown sections require mapping; missing numeric values remain empty',()=>{
 const result=parseBudgetTables([[header,['9','Мой раздел'],['9.1','Печать','штука','не указано','','']]]);
 assert.equal(result.items[0].section,-1);assert.equal(result.items[0].sourceSection,'Мой раздел');assert.equal(result.items[0].qty,null);assert.equal(result.items[0].price,null);assert.ok(result.warnings.length);
 assert.throws(()=>parseBudgetTables([[['Фото сметы']]]),/Не найдена таблица/);
});
test('Стоимость за единицу is a price, not the unit column; forum sections and amount-only rows survive',()=>{
 const h=['№ п/п','Наименование','Ед. изм.','Кол-во','Стоимость за единицу, руб.','Итоговая сумма, руб.'];
 const rows=[h,['1','Изготовление раздаточной и полиграфической продукции','','','',''],['1.1','Баннер\nОписание баннера','штука','1','15 000,00','15 000,00'],['2','Фото- и видеосъемка мероприятия','','','',''],['2.1','Фотосъемка\nОписание съемки','услуга','1','30 000,00','30 000,00'],['3','Оплата труда привлеченных специалистов','','','',''],['3.1','Руководитель форума','услуга','1','20 000,00','20 000,00'],['3.2','ЕНП (7,6%)','','','','1 520,00'],['Общий ИТОГ:','','','','','66 520,00']];
 const r=parseBudgetTables([rows]);assert.equal(r.format,'forum');assert.equal(r.items.length,4);assert.equal(r.items[0].unit,'штука');assert.equal(r.items[0].price,15000);assert.equal(r.items[0].description,'Описание баннера');assert.deepEqual(r.items.map(i=>i.section),[0,1,2,2]);assert.equal(r.items[3].qty,1);assert.equal(r.items[3].price,1520);assert.equal(r.items[3].sourceTotalOnly,true);assert.equal(r.items.reduce((s,i)=>s+i.qty*i.price,0),66520);assert.equal(r.warnings.length,1);assert.match(r.warnings[0],/только сумма/);
});
test('Amount-only rows without a number are not mistaken for section headings; invalid values are not guessed',()=>{
 const h=['Наименование','Ед. изм.','Количество','Цена','Сумма'];
 const r=parseBudgetTables([[h,['Оплата труда','','','',''],['Взносы','','','','1520'],['Неясная цена','услуга','?','','3000']]]);
 assert.equal(r.items.length,2);assert.equal(r.items[0].price,1520);assert.equal(r.items[1].qty,null);assert.equal(r.items[1].price,null);assert.equal(r.items[1].sourceTotalOnly,undefined);
});

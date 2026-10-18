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
